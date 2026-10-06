import { DATASETS, fieldsFor } from "../src/lib/domain/catalog.ts";
import { readFileSync, writeFileSync } from "node:fs";

const migration = "202610040001_contracts_portfolio.sql";
const directory = new URL("../supabase/migrations/", import.meta.url);
const base = readFileSync(
  new URL("202610030001_workspace.sql", directory),
  "utf8",
);
const legacy = readFileSync(
  new URL("202610030002_typed_views.sql", directory),
  "utf8",
);
const names = {
  Prospects: "companies",
  Clientes_Atuais: "customer_profiles",
  Decisores_Canais: "contacts",
  Sinais_Publicos: "signals",
  Portfolio: "products",
  Oportunidades_Historico: "opportunities",
  ICP_Criterios: "icp_criteria",
  Regras_Score_Exemplo: "commercial_rules",
  Desqualificadores: "disqualifiers",
};
let sql =
  "-- Additive projections for contracts and portfolio links. No stored data is changed.\n";
for (const dataset of Object.keys(DATASETS)) {
  const name = names[dataset];
  const previous = legacy
    .split("create view public." + name + " ")[1]
    .split(";")[0];
  const keys = [...previous.matchAll(/ as (\w+)(?=,|\n)/g)].map(
    (match) => match[1],
  );
  const fields = fieldsFor(dataset);
  const added = fields.filter((field) => !keys.includes(field.key));
  if (!added.length) continue;
  // PostgreSQL requires existing view columns to keep their names and order.
  const ordered = [
    ...keys.map((key) => fields.find((field) => field.key === key)),
    ...added,
  ];
  if (ordered.some((field) => !field))
    throw new Error(
      "Removing existing view columns requires an explicit migration.",
    );
  const columns = ordered.map((field) => {
    const expression = "data->>'" + field.key + "'";
    const type = { integer: "integer", number: "numeric", date: "date" }[
      field.type
    ];
    return (
      "  " +
      (type ? "nullif(" + expression + ",'')::" + type : expression) +
      " as " +
      field.key
    );
  });
  sql +=
    "create or replace view public." +
    name +
    " with (security_invoker=true) as\n" +
    "select id,company_id,product_id,contact_id,version,origins,field_sources,created_at,updated_at,\n" +
    columns.join(",\n") +
    "\nfrom public.records where dataset='" +
    dataset +
    "';\n" +
    "grant select on public." +
    name +
    " to authenticated,service_role;\n\n";
}
writeFileSync(new URL(migration, directory), sql);
writeFileSync(
  new URL("../supabase/setup.sql", import.meta.url),
  "-- Instalação inicial. Execute uma vez em uma base nova. Sem carga de dados.\nbegin;\n\n" +
    base +
    "\n" +
    legacy +
    "\n" +
    sql +
    "\ncommit;\n",
);
