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

