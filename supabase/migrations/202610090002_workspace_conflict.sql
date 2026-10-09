-- Return optimistic conflicts to the caller instead of triggering API retry storms.
-- Keep the version lock, actor permissions, deferred FKs and score-history trigger.
create or replace function public.commit_workspace(expected_version bigint, actor_id uuid, document jsonb)
returns bigint language plpgsql security definer set search_path=public as $$
declare current_version bigint; r jsonb; c text; result_version bigint;
begin
  if not exists (select 1 from auth.users where id=actor_id) then
    raise exception 'Usuário não encontrado.';
  end if;
  select version into current_version from public.workspace_meta where singleton for update;
  if current_version<>expected_version then
    -- 40001 makes PostgREST retry the same stale expected_version forever.
    -- PT409 returns immediately so the application can re-read and retry.
    raise exception 'WORKSPACE_CONFLICT' using errcode='PT409';
  end if;
  for r in select value from jsonb_array_elements(document->'records') loop
    insert into public.records(id,dataset,external_key,company_id,product_id,contact_id,data,version,origins,field_sources,created_at,updated_at)
    values ((r->>'id')::uuid,r->>'dataset',r->>'externalKey',(r->>'companyId')::uuid,(r->>'productId')::uuid,(r->>'contactId')::uuid,r->'data',(r->>'version')::integer,r->'origins',coalesce(r->'fieldSources','{}'::jsonb),(r->>'createdAt')::timestamptz,(r->>'updatedAt')::timestamptz)
    on conflict(id) do update set data=excluded.data,company_id=excluded.company_id,product_id=excluded.product_id,contact_id=excluded.contact_id,version=excluded.version,origins=excluded.origins,field_sources=excluded.field_sources,updated_at=excluded.updated_at
    where records.data is distinct from excluded.data or records.version<>excluded.version or records.origins is distinct from excluded.origins or records.field_sources is distinct from excluded.field_sources or records.company_id is distinct from excluded.company_id or records.product_id is distinct from excluded.product_id or records.contact_id is distinct from excluded.contact_id;
  end loop;
  if jsonb_array_length(coalesce(document->'records','[]'::jsonb)) > 0 and (
     exists(select 1 from public.records r join public.records c on r.company_id=c.id where c.dataset<>'Prospects')
     or exists(select 1 from public.records r join public.records p on r.product_id=p.id where p.dataset<>'Portfolio')
     or exists(select 1 from public.records r join public.records p on r.contact_id=p.id where p.dataset<>'Decisores_Canais' or p.company_id is distinct from r.company_id)) then
    raise exception 'Relacionamento inválido.';
  end if;
  foreach c in array array['rulesets','evaluations','lists','revisions','runs','audits','imports'] loop
    for r in select value from jsonb_array_elements(document->c) loop
      insert into public.workspace_entries(collection,id,payload) values (c,(r->>'id')::uuid,r)
      on conflict(collection,id) do update set payload=excluded.payload where workspace_entries.payload is distinct from excluded.payload;
    end loop;
  end loop;
  update public.workspace_meta set version=version+1 where singleton returning version into result_version;
  return result_version;
end $$;
revoke all on function public.commit_workspace(bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.commit_workspace(bigint,uuid,jsonb) to service_role;
