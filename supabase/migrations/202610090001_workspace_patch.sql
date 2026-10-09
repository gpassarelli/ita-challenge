-- Sparse, atomic commits reuse the canonical transaction and its validation,
-- permissions, version lock, and score-history trigger. Omitted collections
-- contain no writes; this endpoint never deletes entries.
create or replace function public.commit_workspace_patch(expected_version bigint, actor_id uuid, patch jsonb)
returns bigint language plpgsql security definer set search_path=public as $$
declare k text; v jsonb;
begin
  if jsonb_typeof(patch) is distinct from 'object' then
    raise exception 'Patch inválido.';
  end if;
  for k,v in select key,value from jsonb_each(patch) loop
    if k not in ('records','rulesets','evaluations','lists','revisions','runs','audits','imports')
       or jsonb_typeof(v) is distinct from 'array' then
      raise exception 'Coleção inválida.';
    end if;
  end loop;
  return public.commit_workspace(expected_version, actor_id, patch);
end $$;
revoke all on function public.commit_workspace_patch(bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.commit_workspace_patch(bigint,uuid,jsonb) to service_role;

create or replace function public.read_agent_run(run_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select payload from public.workspace_entries where collection='runs' and id=run_id
$$;
revoke all on function public.read_agent_run(uuid) from public,anon,authenticated;
grant execute on function public.read_agent_run(uuid) to service_role;
