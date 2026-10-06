-- Instalação inicial. Execute uma vez em uma base nova. Sem carga de dados.
begin;

-- Empty shared workspace. This migration inserts no business data or users.
create table public.workspace_meta (
  singleton boolean primary key default true check (singleton),
  version bigint not null default 0
);
insert into public.workspace_meta(singleton,version) values (true,0);

create table public.records (
  id uuid primary key,
  dataset text not null check (dataset in ('Prospects','Clientes_Atuais','Decisores_Canais','Sinais_Publicos','Portfolio','Oportunidades_Historico','ICP_Criterios','Regras_Score_Exemplo','Desqualificadores','Ranking_Referencia','Casos_Validacao','Indicadores_Atuais','Dicionario_Dados')),
  external_key text not null,
  company_id uuid references public.records(id) deferrable initially deferred,
  product_id uuid references public.records(id) deferrable initially deferred,
  contact_id uuid references public.records(id) deferrable initially deferred,
  data jsonb not null check (jsonb_typeof(data)='object'),
  version integer not null check (version>0),
  origins jsonb not null default '[]'::jsonb,
  field_sources jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique(dataset,external_key)
);
create index records_company_idx on public.records(company_id,dataset);
create index records_dataset_idx on public.records(dataset);
create index records_data_idx on public.records using gin(data);

create table public.workspace_entries (
  collection text not null check (collection in ('rulesets','evaluations','lists','revisions','runs','audits','imports')),
  id uuid not null,
  payload jsonb not null,
  primary key(collection,id)
);
create index entries_company_idx on public.workspace_entries((payload->>'companyId'));
create table public.score_history (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.records(id),
  evaluated_at timestamptz not null default now(),
  payload jsonb not null
);
create function public.capture_score_history() returns trigger language plpgsql set search_path=public as $$
begin
  if new.collection='evaluations' then
    if tg_op='INSERT' or old.payload is distinct from new.payload then
      insert into public.score_history(company_id,payload) values ((new.payload->>'companyId')::uuid,new.payload);
    end if;
  end if;
  return new;
end $$;
create trigger score_history_capture after insert or update on public.workspace_entries for each row execute function public.capture_score_history();

alter table public.records enable row level security;
alter table public.workspace_entries enable row level security;
alter table public.workspace_meta enable row level security;
alter table public.score_history enable row level security;
create policy members_read_records on public.records for select to authenticated using (true);
create policy members_read_entries on public.workspace_entries for select to authenticated using (true);
create policy members_read_meta on public.workspace_meta for select to authenticated using (true);
create policy members_read_scores on public.score_history for select to authenticated using (true);
revoke all on public.records,public.workspace_entries,public.workspace_meta,public.score_history from anon,authenticated;
grant select on public.records,public.workspace_entries,public.workspace_meta,public.score_history to authenticated;
grant all on public.records,public.workspace_entries,public.workspace_meta,public.score_history to service_role;
grant usage,select on sequence public.score_history_id_seq to service_role;

create function public.read_workspace() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
   'version',(select version from public.workspace_meta where singleton),
   'records',coalesce((select jsonb_agg(jsonb_build_object('id',id,'dataset',dataset,'externalKey',external_key,'companyId',company_id,'productId',product_id,'contactId',contact_id,'data',data,'version',version,'origins',origins,'fieldSources',field_sources,'createdAt',created_at,'updatedAt',updated_at) order by created_at,id) from public.records),'[]'::jsonb),
   'rulesets',coalesce((select jsonb_agg(payload order by coalesce(payload->>'createdAt',payload->>'requestedAt',payload->>'at',payload->>'updatedAt'),id) from public.workspace_entries where collection='rulesets'),'[]'::jsonb),
   'evaluations',coalesce((select jsonb_agg(payload order by coalesce(payload->>'createdAt',payload->>'requestedAt',payload->>'at',payload->>'updatedAt'),id) from public.workspace_entries where collection='evaluations'),'[]'::jsonb),
   'lists',coalesce((select jsonb_agg(payload order by coalesce(payload->>'createdAt',payload->>'requestedAt',payload->>'at',payload->>'updatedAt'),id) from public.workspace_entries where collection='lists'),'[]'::jsonb),
   'revisions',coalesce((select jsonb_agg(payload order by coalesce(payload->>'createdAt',payload->>'requestedAt',payload->>'at',payload->>'updatedAt'),id) from public.workspace_entries where collection='revisions'),'[]'::jsonb),
   'runs',coalesce((select jsonb_agg(payload order by coalesce(payload->>'createdAt',payload->>'requestedAt',payload->>'at',payload->>'updatedAt'),id) from public.workspace_entries where collection='runs'),'[]'::jsonb),
   'audits',coalesce((select jsonb_agg(payload order by coalesce(payload->>'createdAt',payload->>'requestedAt',payload->>'at',payload->>'updatedAt'),id) from public.workspace_entries where collection='audits'),'[]'::jsonb),
   'imports',coalesce((select jsonb_agg(payload order by coalesce(payload->>'createdAt',payload->>'requestedAt',payload->>'at',payload->>'updatedAt'),id) from public.workspace_entries where collection='imports'),'[]'::jsonb)
 )
$$;
revoke all on function public.read_workspace() from public,anon,authenticated;
grant execute on function public.read_workspace() to service_role;

create function public.commit_workspace(expected_version bigint, actor_id uuid, document jsonb)
returns bigint language plpgsql security definer set search_path=public as $$
declare current_version bigint; r jsonb; c text; result_version bigint;
begin
  if not exists (select 1 from auth.users where id=actor_id) then
    raise exception 'Usuário não encontrado.';
  end if;
  select version into current_version from public.workspace_meta where singleton for update;
  if current_version<>expected_version then
    raise exception 'WORKSPACE_CONFLICT' using errcode='40001';
  end if;
  for r in select value from jsonb_array_elements(document->'records') loop
    insert into public.records(id,dataset,external_key,company_id,product_id,contact_id,data,version,origins,field_sources,created_at,updated_at)
    values ((r->>'id')::uuid,r->>'dataset',r->>'externalKey',(r->>'companyId')::uuid,(r->>'productId')::uuid,(r->>'contactId')::uuid,r->'data',(r->>'version')::integer,r->'origins',coalesce(r->'fieldSources','{}'::jsonb),(r->>'createdAt')::timestamptz,(r->>'updatedAt')::timestamptz)
    on conflict(id) do update set data=excluded.data,company_id=excluded.company_id,product_id=excluded.product_id,contact_id=excluded.contact_id,version=excluded.version,origins=excluded.origins,field_sources=excluded.field_sources,updated_at=excluded.updated_at
    where records.data is distinct from excluded.data or records.version<>excluded.version or records.origins is distinct from excluded.origins or records.field_sources is distinct from excluded.field_sources or records.company_id is distinct from excluded.company_id or records.product_id is distinct from excluded.product_id or records.contact_id is distinct from excluded.contact_id;
  end loop;
  if exists(select 1 from public.records r join public.records c on r.company_id=c.id where c.dataset<>'Prospects')
     or exists(select 1 from public.records r join public.records p on r.product_id=p.id where p.dataset<>'Portfolio')
     or exists(select 1 from public.records r join public.records p on r.contact_id=p.id where p.dataset<>'Decisores_Canais' or p.company_id is distinct from r.company_id) then
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

-- Typed relational projections. Generated from the same catalog used by CSV validation and forms.
create view public.companies with (security_invoker=true) as
select id,company_id,product_id,contact_id,version,origins,field_sources,created_at,updated_at,
  data->>'external_id' as external_id,
  data->>'name' as name,
  data->>'domain' as domain,
  data->>'segment' as segment,
  nullif(data->>'employees','')::integer as employees,
  data->>'state' as state,
  data->>'structured_hr' as structured_hr,
  data->>'multi_region' as multi_region,
  data->>'growth' as growth,
  data->>'employer_branding' as employer_branding,
  data->>'retention_pain' as retention_pain,
  data->>'renewal' as renewal,
  data->>'permitted_source' as permitted_source,
  data->>'operating_status' as operating_status,
  data->>'commercial_status' as commercial_status,
  data->>'benefits_fit' as benefits_fit,
  data->>'operates_brazil' as operates_brazil,
  data->>'renewed_24_months' as renewed_24_months,
  data->>'notes' as notes
from public.records where dataset='Prospects';
grant select on public.companies to authenticated,service_role;

create view public.customer_profiles with (security_invoker=true) as
select id,company_id,product_id,contact_id,version,origins,field_sources,created_at,updated_at,
  data->>'company_external_id' as company_external_id,
  data->>'company_name' as company_name,
  data->>'segment' as segment,
  nullif(data->>'employees','')::integer as employees,
  data->>'state' as state,
  data->>'solution_external_id' as solution_external_id,
  nullif(data->>'annual_ticket','')::numeric as annual_ticket,
  data->>'internal_fit' as internal_fit,
  data->>'customer_status' as customer_status,
  nullif(data->>'nps','')::integer as nps
from public.records where dataset='Clientes_Atuais';
grant select on public.customer_profiles to authenticated,service_role;

create view public.contacts with (security_invoker=true) as
select id,company_id,product_id,contact_id,version,origins,field_sources,created_at,updated_at,
  data->>'company_external_id' as company_external_id,
  data->>'company_name' as company_name,
  data->>'role' as role,
  data->>'name' as name,
  data->>'channel_type' as channel_type,
  data->>'channel' as channel,
  data->>'source' as source,
  data->>'identified' as identified
from public.records where dataset='Decisores_Canais';
grant select on public.contacts to authenticated,service_role;

create view public.signals with (security_invoker=true) as
select id,company_id,product_id,contact_id,version,origins,field_sources,created_at,updated_at,
  data->>'company_external_id' as company_external_id,
  data->>'company_name' as company_name,
  data->>'signal_type' as signal_type,
  data->>'evidence' as evidence,
  data->>'strength' as strength,
  nullif(data->>'date','')::date as date,
  data->>'source' as source,
  data->>'url' as url
from public.records where dataset='Sinais_Publicos';
grant select on public.signals to authenticated,service_role;

create view public.products with (security_invoker=true) as
select id,company_id,product_id,contact_id,version,origins,field_sources,created_at,updated_at,
  data->>'external_id' as external_id,
  data->>'name' as name,
  data->>'category' as category,
  data->>'problem' as problem,
  data->>'value_proposition' as value_proposition,
  data->>'ideal_profile' as ideal_profile,
  data->>'ticket_range' as ticket_range
from public.records where dataset='Portfolio';
grant select on public.products to authenticated,service_role;

create view public.opportunities with (security_invoker=true) as
select id,company_id,product_id,contact_id,version,origins,field_sources,created_at,updated_at,
  data->>'external_id' as external_id,
  data->>'company_external_id' as company_external_id,
  data->>'company_name' as company_name,
  data->>'outcome' as outcome,
  nullif(data->>'cycle_days','')::integer as cycle_days,
  nullif(data->>'estimated_ticket','')::numeric as estimated_ticket,
  data->>'reason' as reason,
  data->>'sponsor' as sponsor,
  data->>'source' as source,
  data->>'sponsor_contact_id' as sponsor_contact_id
from public.records where dataset='Oportunidades_Historico';
grant select on public.opportunities to authenticated,service_role;

create view public.icp_criteria with (security_invoker=true) as
select id,company_id,product_id,contact_id,version,origins,field_sources,created_at,updated_at,
  data->>'criterion' as criterion,
  data->>'description' as description,
  nullif(data->>'weight','')::numeric as weight,
  data->>'rationale' as rationale
from public.records where dataset='ICP_Criterios';
grant select on public.icp_criteria to authenticated,service_role;

create view public.commercial_rules with (security_invoker=true) as
select id,company_id,product_id,contact_id,version,origins,field_sources,created_at,updated_at,
  data->>'external_id' as external_id,
  data->>'criterion' as criterion,
  nullif(data->>'weight','')::numeric as weight,
  data->>'rationale' as rationale
from public.records where dataset='Regras_Score_Exemplo';
grant select on public.commercial_rules to authenticated,service_role;

create view public.disqualifiers with (security_invoker=true) as
select id,company_id,product_id,contact_id,version,origins,field_sources,created_at,updated_at,
  data->>'external_id' as external_id,
  data->>'condition' as condition,
  data->>'reason' as reason,
  data->>'action' as action
from public.records where dataset='Desqualificadores';
grant select on public.disqualifiers to authenticated,service_role;

create view public.reference_rankings with (security_invoker=true) as
select id,company_id,product_id,contact_id,version,origins,field_sources,created_at,updated_at,
  data->>'company_external_id' as company_external_id,
  data->>'company_name' as company_name,
  data->>'segment' as segment,
  nullif(data->>'employees','')::integer as employees,
  nullif(data->>'reference_score','')::numeric as reference_score,
  data->>'priority' as priority,
  data->>'fit_evidence' as fit_evidence,
  data->>'role' as role,
  data->>'channel' as channel
from public.records where dataset='Ranking_Referencia';
grant select on public.reference_rankings to authenticated,service_role;

create view public.validation_cases with (security_invoker=true) as
select id,company_id,product_id,contact_id,version,origins,field_sources,created_at,updated_at,
  data->>'case_id' as case_id,
  data->>'company_external_id' as company_external_id,
  data->>'company_name' as company_name,
  data->>'known_situation' as known_situation,
  nullif(data->>'reference_score','')::numeric as reference_score,
  data->>'expected_result' as expected_result,
  data->>'test_objective' as test_objective
from public.records where dataset='Casos_Validacao';
grant select on public.validation_cases to authenticated,service_role;

create view public.reference_metrics with (security_invoker=true) as
select id,company_id,product_id,contact_id,version,origins,field_sources,created_at,updated_at,
  data->>'indicator' as indicator,
  data->>'current_value' as current_value,
  data->>'target' as target,
  data->>'frequency' as frequency,
  data->>'owner' as owner
from public.records where dataset='Indicadores_Atuais';
grant select on public.reference_metrics to authenticated,service_role;

create view public.data_dictionary with (security_invoker=true) as
select id,company_id,product_id,contact_id,version,origins,field_sources,created_at,updated_at,
  data->>'sheet' as sheet,
  data->>'field' as field,
  data->>'type' as type,
  data->>'definition' as definition,
  data->>'source' as source,
  data->>'frequency' as frequency,
  data->>'sensitive' as sensitive
from public.records where dataset='Dicionario_Dados';
grant select on public.data_dictionary to authenticated,service_role;


-- Additive projections for contracts and portfolio links. No stored data is changed.
create or replace view public.customer_profiles with (security_invoker=true) as
select id,company_id,product_id,contact_id,version,origins,field_sources,created_at,updated_at,
  data->>'company_external_id' as company_external_id,
  data->>'company_name' as company_name,
  data->>'segment' as segment,
  nullif(data->>'employees','')::integer as employees,
  data->>'state' as state,
  data->>'solution_external_id' as solution_external_id,
  nullif(data->>'annual_ticket','')::numeric as annual_ticket,
  data->>'internal_fit' as internal_fit,
  data->>'customer_status' as customer_status,
  nullif(data->>'nps','')::integer as nps,
  data->>'opportunity_id' as opportunity_id
from public.records where dataset='Clientes_Atuais';
grant select on public.customer_profiles to authenticated,service_role;

create or replace view public.opportunities with (security_invoker=true) as
select id,company_id,product_id,contact_id,version,origins,field_sources,created_at,updated_at,
  data->>'external_id' as external_id,
  data->>'company_external_id' as company_external_id,
  data->>'company_name' as company_name,
  data->>'outcome' as outcome,
  nullif(data->>'cycle_days','')::integer as cycle_days,
  nullif(data->>'estimated_ticket','')::numeric as estimated_ticket,
  data->>'reason' as reason,
  data->>'sponsor' as sponsor,
  data->>'source' as source,
  data->>'sponsor_contact_id' as sponsor_contact_id,
  data->>'solution_external_id' as solution_external_id
from public.records where dataset='Oportunidades_Historico';
grant select on public.opportunities to authenticated,service_role;


commit;
