export type Cell = string | number | boolean | null;

export function isMissing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  const text = value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
  return text === "" || text === "nao identificado";
}

export type Field = {
  key: string;
  label: string;
  type: "text" | "number" | "integer" | "date" | "choice";
  required?: boolean;
  choices?: string[];
  min?: number;
  max?: number;
  currency?: "BRL";
  readOnly?: boolean;
  hidden?: boolean;
};
const f = (
  key: string,
  label: string,
  type: Field["type"] = "text",
  extra: Partial<Field> = {},
): Field => ({ key, label, type, ...extra });
const yesNo = ["Sim", "Não"];
const levels = ["Baixo", "Médio", "Alto"];
const company = [
  f("company_external_id", "ID Empresa", "text", { required: true }),
  f("company_name", "Empresa"),
];
export const DATASETS = {
  Prospects: {
    label: "Empresas",
    singular: "empresa",
    key: "external_id",
    fields: [
      f("external_id", "ID Empresa", "text", { required: true }),
      f("name", "Empresa", "text", { required: true }),
      f("domain", "Domínio fictício"),
      f("segment", "Segmento"),
      f("employees", "Colaboradores", "integer", { min: 0 }),
      f("state", "UF"),
      f("structured_hr", "RH estruturado", "choice", { choices: yesNo }),
      f("multi_region", "Multi-região", "choice", { choices: yesNo }),
      f("growth", "Sinal crescimento", "choice", { choices: levels }),
      f("employer_branding", "Employer branding", "choice", {
        choices: levels,
      }),
      f("retention_pain", "Dor retenção", "choice", { choices: levels }),
      f("renewal", "Renovação provável", "choice", {
        choices: ["0-3 meses", "4-6 meses", "7-12 meses", ">12 meses"],
      }),
      f("permitted_source", "Fonte permitida"),
      f("operating_status", "Status", "choice", {
        choices: ["Ativa", "Inativa", "Encerrada"],
      }),
    ],
  },
  Clientes_Atuais: {
    label: "Contratações",
    singular: "contratação",
    key: null,
    fields: [
      ...company,
      f("segment", "Segmento"),
      f("employees", "Colaboradores", "integer", { min: 0 }),
      f("state", "UF"),
      f("solution_external_id", "Solução", "text", { required: true }),
      f("annual_ticket", "Ticket anual", "number", { min: 0, currency: "BRL" }),
      f("internal_fit", "Fit interno", "choice", { choices: levels }),
      f("customer_status", "Status", "choice", {
        required: true,
        choices: ["Cliente ativo", "Churn"],
      }),
      f("nps", "NPS fictício", "integer", { min: 0, max: 10 }),
    ],
  },
  Decisores_Canais: {
    label: "Pessoas e canais",
    singular: "pessoa ou canal",
    key: null,
    fields: [
      ...company,
      f("role", "Cargo provável"),
      f("name", "Contato fictício"),
      f("channel_type", "Tipo canal"),
      f("channel", "Canal/contato fictício"),
      f("source", "Origem"),
      f("identified", "Decisor identificado?", "choice", { choices: yesNo }),
    ],
  },
  Sinais_Publicos: {
    label: "Sinais",
    singular: "sinal",
    key: null,
    fields: [
      ...company,
      f("signal_type", "Tipo sinal"),
      f("evidence", "Evidência fictícia"),
      f("strength", "Força", "choice", { choices: levels }),
      f("date", "Data", "date"),
      f("source", "Fonte"),
      f("url", "URL fictícia"),
    ],
  },
  Portfolio: {
    label: "Portfólio",
    singular: "produto",
    key: "external_id",
    fields: [
      f("external_id", "ID", "text", { required: true }),
      f("name", "Solução fictícia", "text", { required: true }),
      f("category", "Categoria"),
      f("problem", "Problema resolvido"),
      f("value_proposition", "Proposta de valor"),
      f("ideal_profile", "Perfil típico"),
      f("ticket_range", "Faixa de ticket fictícia"),
    ],
  },
  Oportunidades_Historico: {
    label: "Oportunidades",
    singular: "oportunidade",
    key: "external_id",
    fields: [
      f("external_id", "ID Oportunidade", "text", { required: true }),
      ...company,
      f("solution_external_id", "Solução", "text", { required: true }),
      f("outcome", "Resultado", "choice", {
        required: true,
        choices: ["Em negociação", "Ganha", "Perdida"],
      }),
      f("cycle_days", "Ciclo (dias)", "integer", { min: 0 }),
      f("estimated_ticket", "Ticket estimado", "number", {
        min: 0,
        currency: "BRL",
      }),
      f("reason", "Motivo/Status"),
      f("sponsor", "Sponsor/Decisor"),
      f("source", "Origem"),
    ],
  },
  ICP_Criterios: {
    label: "Critérios de ICP",
    singular: "critério de ICP",
    key: "criterion",
    fields: [
      f("criterion", "Critério", "text", { required: true }),
      f("description", "Regra fictícia"),
      f("weight", "Peso (%)", "number", { min: 0, max: 100 }),
      f("rationale", "Justificativa"),
    ],
  },
  Regras_Score_Exemplo: {
    label: "Regras de prioridade",
    singular: "regra de prioridade",
    key: "external_id",
    fields: [
      f("external_id", "ID", "text", { required: true }),
      f("criterion", "Critério fictício"),
      f("weight", "Peso máximo", "number", { min: 0, max: 100 }),
      f("rationale", "Racional"),
    ],
  },
  Desqualificadores: {
    label: "Desqualificadores",
    singular: "desqualificador",
    key: "external_id",
    fields: [
      f("external_id", "ID", "text", { required: true }),
      f("condition", "Condição"),
      f("reason", "Motivo"),
      f("action", "Ação"),
    ],
  },
} as const satisfies Record<
  string,
  { label: string; singular: string; key: string | null; fields: Field[] }
>;
export type Dataset = keyof typeof DATASETS;
export const datasetNames = Object.keys(DATASETS) as Dataset[];
export const configurationDatasets: Dataset[] = [
  "ICP_Criterios",
  "Regras_Score_Exemplo",
  "Desqualificadores",
];
export const companyFields: Field[] = [
  ...DATASETS.Prospects.fields,
  f("commercial_status", "Status comercial", "choice", {
    choices: ["Prospect", "Cliente ativo", "Ex-cliente"],
    readOnly: true,
  }),
  f("benefits_fit", "Benefícios aderentes", "choice", {
    choices: yesNo,
  }),
  f("operates_brazil", "Operação no Brasil", "choice", {
    choices: yesNo,
  }),
  f("renewed_24_months", "Contrato renovado por 24+ meses", "choice", {
    choices: yesNo,
  }),
  f("notes", "Notas da equipe"),
];
export function fieldsFor(dataset: Dataset): Field[] {
  return dataset === "Prospects"
    ? companyFields
    : dataset === "Clientes_Atuais"
      ? [
          ...DATASETS[dataset].fields,
          f("opportunity_id", "Oportunidade de origem", "text", {
            readOnly: true,
            hidden: true,
          }),
        ]
      : dataset === "Oportunidades_Historico"
        ? [
            ...DATASETS[dataset].fields,
            f("sponsor_contact_id", "Pessoa patrocinadora vinculada"),
          ]
        : DATASETS[dataset].fields;
}
export function isDataset(value: string): value is Dataset {
  return Object.hasOwn(DATASETS, value);
}
export function parseCell(value: unknown, field: Field): Cell {
  if (isMissing(value)) {
    if (field.required) throw new Error(field.label + ": campo obrigatório.");
    return null;
  }
  const text = String(value).trim();
  if (text.length > 12000)
    throw new Error(field.label + ": máximo de 12.000 caracteres.");
  if (field.type === "number" || field.type === "integer") {
    const numericText = field.currency ? text.replace(/^R\$\s*/i, "") : text;
    const validCurrency =
      !field.currency ||
      typeof value === "number" ||
      /^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(numericText) ||
      /^[+-]?\d+\.\d{1,2}$/.test(numericText);
    const normalized =
      typeof value === "number"
        ? value
        : Number(
            numericText.includes(",")
              ? numericText.replace(/\./g, "").replace(",", ".")
              : /^[+-]?\d{1,3}(\.\d{3})+$/.test(numericText)
                ? numericText.replace(/\./g, "")
                : numericText,
          );
    if (
      !validCurrency ||
      !Number.isFinite(normalized) ||
      (field.type === "integer" && !Number.isInteger(normalized))
    )
      throw new Error(
        field.label +
          ": informe um número " +
          (field.type === "integer" ? "inteiro." : "válido."),
      );
    if (
      (field.min !== undefined && normalized < field.min) ||
      (field.max !== undefined && normalized > field.max)
    )
      throw new Error(field.label + ": valor fora do intervalo permitido.");
    return normalized;
  }
  if (field.type === "date") {
    const iso = /^\d{2}\/\d{2}\/\d{4}$/.test(text)
      ? text.split("/").reverse().join("-")
      : text;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(iso) ||
      !Number.isFinite(Date.parse(iso)) ||
      new Date(iso).toISOString().slice(0, 10) !== iso
    )
      throw new Error(
        field.label + ": use uma data válida no formato DD/MM/AAAA.",
      );
    return iso;
  }
  if (field.choices && !field.choices.includes(text))
    throw new Error(field.label + ": opção inválida (" + text + ").");
  if (
    field.key === "state" &&
    ![
      "AC",
      "AL",
      "AP",
      "AM",
      "BA",
      "CE",
      "DF",
      "ES",
      "GO",
      "MA",
      "MT",
      "MS",
      "MG",
      "PA",
      "PB",
      "PR",
      "PE",
      "PI",
      "RJ",
      "RN",
      "RS",
      "RO",
      "RR",
      "SC",
      "SP",
      "SE",
      "TO",
    ].includes(text.toUpperCase())
  )
    throw new Error("UF inválida.");
  return field.key === "state" ? text.toUpperCase() : text;
}
export function validateData(
  dataset: Dataset,
  input: Record<string, unknown>,
): Record<string, Cell> {
  if (!isDataset(dataset)) throw new Error("Tipo de dados não permitido.");
  const fields = fieldsFor(dataset);
  for (const key of Object.keys(input))
    if (!fields.some((f) => f.key === key))
      throw new Error("Campo não permitido: " + key);
  return Object.fromEntries(
    fields.map((field) => [field.key, parseCell(input[field.key], field)]),
  );
}
