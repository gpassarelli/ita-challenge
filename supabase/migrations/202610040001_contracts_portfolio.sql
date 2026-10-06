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

