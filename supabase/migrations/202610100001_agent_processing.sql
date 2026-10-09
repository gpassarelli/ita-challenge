-- Company-scoped reads and item-scoped progress writes. Keep the legacy JSON
-- run shape and global version protocol for compatibility with human edits.
create or replace function public.read_agent_context(run_id uuid, company_id uuid default null)
returns jsonb language sql stable security definer set search_path=public as $$
  with execution as (
    select case when $2 is null then payload else jsonb_set(payload,'{items}',
      coalesce((select jsonb_agg(i) from jsonb_array_elements(payload->'items') i
        where i->>'companyId'=$2::text),'[]'::jsonb)) end payload
    from public.workspace_entries where collection='runs' and id=$1
  )
  select jsonb_build_object(
    'version',(select version from public.workspace_meta where singleton),
    'runs',coalesce((select jsonb_agg(payload) from execution),'[]'::jsonb),
    'records',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'dataset',r.dataset,'externalKey',r.external_key,
      'companyId',r.company_id,'productId',r.product_id,'contactId',r.contact_id,
      'data',r.data,'version',r.version,'origins',r.origins,'fieldSources',r.field_sources,
      'createdAt',r.created_at,'updatedAt',r.updated_at) order by r.created_at,r.id)
      from public.records r where $2 is not null and (
        r.id=$2 or (r.company_id=$2 and r.dataset in ('Sinais_Publicos','Decisores_Canais','Oportunidades_Historico','Clientes_Atuais'))
        or r.id=(select (payload->>'productId')::uuid from execution)
      )),'[]'::jsonb),
    'evaluations',coalesce((select jsonb_agg(payload) from public.workspace_entries
      where collection='evaluations' and payload->>'companyId'=$2::text),'[]'::jsonb),
    'revisions',coalesce((select jsonb_agg(payload) from public.workspace_entries
      where collection='revisions' and payload->>'companyId'=$2::text
      and (payload->>'status'='pending' or payload->>'runId'=$1::text)),'[]'::jsonb)
  )
$$;
revoke all on function public.read_agent_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_agent_context(uuid,uuid) to service_role;

create or replace function public.commit_agent_patch(
  actor_id uuid, run_id uuid, before_run jsonb, next_run jsonb,
  new_revisions jsonb default '[]'::jsonb, new_audits jsonb default '[]'::jsonb
)
returns bigint language plpgsql security definer set search_path=public as $$
declare current_run jsonb; merged jsonb; previous_item jsonb; current_item jsonb;
  next_item jsonb; item_index integer; k text; v jsonb; r jsonb; existing jsonb;
  current_version bigint; changed boolean := false;
begin
  if not exists(select 1 from auth.users where id=actor_id) then
    raise exception 'Usuário não encontrado.';
  end if;
  if jsonb_typeof(before_run) is distinct from 'object'
    or jsonb_typeof(next_run) is distinct from 'object'
    or jsonb_typeof(new_revisions) is distinct from 'array'
    or jsonb_typeof(new_audits) is distinct from 'array'
    or before_run->>'id' is distinct from run_id::text
    or next_run->>'id' is distinct from run_id::text then
    raise exception 'Patch de agente inválido.';
  end if;
  -- Same lock order as commit_workspace: short writes serialize, but no
  -- full-workspace read or version-conflict retry is required between companies.
  select version into current_version from public.workspace_meta where singleton for update;
  select payload into current_run from public.workspace_entries where collection='runs' and id=run_id for update;
  if current_run is null then raise exception 'Execução não encontrada.'; end if;
  if current_run->>'requestedBy' is distinct from actor_id::text then
    raise exception 'Ator de execução inválido.' using errcode='42501';
  end if;
  if current_run->'status' is distinct from before_run->'status'
    or current_run->'workflowId' is distinct from before_run->'workflowId' then
    raise exception 'AGENT_CONFLICT' using errcode='PT409';
  end if;
  if (next_run - array['items','status','workflowId','startedAt','finishedAt','error','settings','rateLimitUntil'])
    is distinct from (before_run - array['items','status','workflowId','startedAt','finishedAt','error','settings','rateLimitUntil'])
    or jsonb_typeof(next_run->'items') is distinct from 'array'
    or jsonb_array_length(next_run->'items') is distinct from jsonb_array_length(before_run->'items')
    or jsonb_array_length(next_run->'items') <> (select count(distinct value->>'companyId') from jsonb_array_elements(next_run->'items')) then
    raise exception 'Identidade da execução protegida.';
  end if;
  merged := current_run;
  for k,v in select key,value from jsonb_each(next_run - 'items') loop
    if v is distinct from before_run->k then
      if current_run->k is distinct from before_run->k and current_run->k is distinct from v then
        raise exception 'AGENT_CONFLICT' using errcode='PT409';
      end if;
      merged := jsonb_set(merged,array[k],v);
    end if;
  end loop;
  for next_item in select value from jsonb_array_elements(next_run->'items') loop
    select value into previous_item from jsonb_array_elements(before_run->'items') where value->'companyId'=next_item->'companyId';
    select value,(ordinality-1)::integer into current_item,item_index from jsonb_array_elements(current_run->'items') with ordinality where value->'companyId'=next_item->'companyId';
    if previous_item is null or current_item is null then
      raise exception 'Empresa da execução protegida.';
    end if;
    if next_item is distinct from previous_item then
      if current_item is distinct from previous_item and current_item is distinct from next_item then
        raise exception 'AGENT_CONFLICT' using errcode='PT409';
      end if;
      -- Recheck eligibility in the transaction, including a pending revision
      -- inserted after preparation/beginGeneration read their snapshots.
      if current_run->>'agent'='signals' and next_item->>'status'='running'
        and next_item->'steps'->-1->>'phase' in ('preparing','generating')
        and exists(select 1 from public.workspace_entries where collection='revisions'
          and payload->>'companyId'=next_item->>'companyId' and payload->>'type'='data'
          and payload->>'status'='pending') then
        raise exception 'PENDING_REVISION' using errcode='PT422';
      end if;
      merged := jsonb_set(merged,array['items',item_index::text],next_item);
    end if;
  end loop;
  for r in select value from jsonb_array_elements(new_revisions) loop
    if current_run->>'status' not in ('queued','running')
      or r->>'runId' is distinct from run_id::text or r->>'createdBy' is distinct from actor_id::text
      or r->>'status' is distinct from 'pending'
      or not exists(select 1 from jsonb_array_elements(merged->'items') i
        where i->>'companyId'=r->>'companyId' and i->>'revisionId'=r->>'id' and i->>'status'='completed') then
      raise exception 'Revisão de agente inválida.';
    end if;
    select payload into existing from public.workspace_entries where collection='revisions'
      and (id=(r->>'id')::uuid or (payload->>'runId'=run_id::text and payload->>'companyId'=r->>'companyId')) limit 1;
    if existing is not null then
      if existing is distinct from r then raise exception 'AGENT_CONFLICT' using errcode='PT409'; end if;
    else
      if current_run->>'agent'='signals' and exists(select 1 from public.workspace_entries where collection='revisions'
        and payload->>'companyId'=r->>'companyId' and payload->>'type'='data' and payload->>'status'='pending') then
        raise exception 'PENDING_REVISION' using errcode='PT422';
      end if;
      insert into public.workspace_entries(collection,id,payload) values('revisions',(r->>'id')::uuid,r);
      changed := true;
    end if;
  end loop;
  for r in select value from jsonb_array_elements(new_audits) loop
    if r->>'actor' is distinct from actor_id::text then raise exception 'Ator de auditoria inválido.'; end if;
    insert into public.workspace_entries(collection,id,payload) values('audits',(r->>'id')::uuid,r) on conflict do nothing;
    if found then changed := true; end if;
  end loop;
  if merged is distinct from current_run then
    update public.workspace_entries set payload=merged where collection='runs' and id=run_id;
    changed := true;
  end if;
  if changed then update public.workspace_meta set version=version+1 where singleton returning version into current_version; end if;
  return current_version;
end $$;
revoke all on function public.commit_agent_patch(uuid,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commit_agent_patch(uuid,uuid,jsonb,jsonb,jsonb,jsonb) to service_role;

create index if not exists entries_revision_run_company_idx
  on public.workspace_entries ((payload->>'runId'),(payload->>'companyId')) where collection='revisions';
notify pgrst, 'reload schema';
