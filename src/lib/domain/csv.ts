import Papa from "papaparse";
import { createHash } from "node:crypto";
import {
  DATASETS,
  isDataset,
  parseCell,
  type Cell,
  type Dataset,
} from "./catalog";
import { contactKind, normalizedValue } from "./values";
import type { DataRecord, Workspace } from "./types";
export type ImportRow = {
  line: number;
  data: Record<string, Cell>;
  raw: Record<string, string>;
  key: string;
  status: "new" | "duplicate" | "conflict" | "invalid" | "ignored";
  issues: string[];
};
export type Preview = {
  dataset: Dataset;
  fileName: string;
  headers: string[];
  rows: ImportRow[];
  errors: string[];
  counts: {
    new: number;
    duplicate: number;
    conflict: number;
    invalid: number;
    ignored: number;
  };
};
import { canonical } from "./json";
export { canonical } from "./json";
export function recordKey(
  dataset: Dataset,
  data: Record<string, Cell>,
): string {
  data = comparableData(dataset, data);
  const key = DATASETS[dataset].key;
  if (key) return String(data[key] ?? "");
  let identity: unknown = data;
  if (dataset === "Clientes_Atuais")
    identity = [data.company_external_id, data.solution_external_id];
  if (dataset === "Decisores_Canais")
    identity = [data.company_external_id, data.channel, data.role, data.name];
  if (dataset === "Sinais_Publicos" && data.url)
    identity = [
      data.company_external_id,
      data.signal_type,
      data.date,
      data.url,
    ];
  return createHash("sha256").update(canonical(identity)).digest("hex");
}
export function comparableData(dataset: Dataset, data: Record<string, Cell>) {
  return Object.fromEntries(
    DATASETS[dataset].fields.map((field) => [
      field.key,
      normalizedValue(data[field.key]),
    ]),
  );
}
export function matchingRecord(
  state: Workspace,
  dataset: Dataset,
  data: Record<string, Cell>,
) {
  const key = recordKey(dataset, data);
  const matches = state.records.filter(
    (record) =>
      record.dataset === dataset &&
      (record.externalKey === key || recordKey(dataset, record.data) === key),
  );
  if (matches.length > 1)
    throw new Error(
      "Há vários registros equivalentes após normalizar os valores ausentes. Revise os cadastros antes de importar.",
    );
  return matches[0];
}
export function resolveRelations(
  state: Workspace,
  dataset: Dataset,
  data: Record<string, Cell>,
  old?: DataRecord,
) {
  const companyId = data.company_external_id
    ? state.records.find(
        (r) =>
          r.dataset === "Prospects" &&
          r.externalKey === data.company_external_id,
      )?.id
    : null;
  const productId = data.solution_external_id
    ? state.records.find(
        (r) =>
          r.dataset === "Portfolio" &&
          r.externalKey === data.solution_external_id,
      )?.id
    : null;
  if (data.company_external_id && !companyId)
    throw new Error(
      "Empresa " +
        data.company_external_id +
        " não encontrada. Importe ou cadastre a empresa primeiro.",
    );
  if (data.solution_external_id && !productId)
    throw new Error(
      "Produto " +
        data.solution_external_id +
        " não encontrado. Importe ou cadastre o produto primeiro.",
    );
  if (
    old?.dataset === "Clientes_Atuais" &&
    old.productId &&
    (old.companyId !== companyId || old.productId !== productId)
  )
    throw new Error(
      "A empresa e a solução de uma contratação não podem ser alteradas. Cadastre outra contratação.",
    );
  if (dataset === "Clientes_Atuais" && data.opportunity_id) {
    const opportunity = state.records.find(
      (record) =>
        record.id === data.opportunity_id &&
        record.dataset === "Oportunidades_Historico",
    );
    if (
      !opportunity ||
      opportunity.companyId !== companyId ||
      opportunity.productId !== productId ||
      opportunity.data.outcome !== "Ganha"
    )
      throw new Error(
        "A contratação deve estar vinculada a uma oportunidade ganha da mesma empresa e solução.",
      );
  }
  if (
    old &&
    old.dataset === dataset &&
    DATASETS[dataset].key &&
    String(data[DATASETS[dataset].key!]) !== old.externalKey
  )
    throw new Error("O identificador original não pode ser alterado.");
  const contact = data.sponsor_contact_id
    ? state.records.find(
        (r) =>
          r.id === data.sponsor_contact_id && r.dataset === "Decisores_Canais",
      )
    : null;
  if (data.sponsor_contact_id && (!contact || contact.companyId !== companyId))
    throw new Error(
      "A pessoa patrocinadora deve pertencer à empresa da oportunidade.",
    );
  if (
    contact &&
    contactKind(contact.data) !== "person" &&
    old?.contactId !== contact.id
  )
    throw new Error(
      "A pessoa patrocinadora deve ter um nome informado. Canais institucionais não são pessoas.",
    );
  return {
    companyId: companyId ?? null,
    productId: productId ?? null,
    contactId: contact?.id ?? null,
  };
}
export function previewCSV(
  dataset: Dataset,
  fileName: string,
  text: string,
  state: Workspace,
): Preview {
  if (!isDataset(dataset)) throw new Error("Tipo de dados não permitido.");
  if (!fileName.toLowerCase().endsWith(".csv"))
    throw new Error("Selecione um arquivo CSV. XLSX não é aceito.");
  if (Buffer.byteLength(text, "utf8") > 5 * 1024 * 1024)
    throw new Error("O arquivo excede 5 MB.");
  if (text.includes("\u0000") || text.includes("\uFFFD"))
    throw new Error("Use um CSV em UTF-8 para preservar todos os caracteres.");
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    skipEmptyLines: false,
  });
  const errors = parsed.errors
    .filter((e) => e.code !== "UndetectableDelimiter")
    .map(
      (e) =>
        "CSV inválido: confira as aspas e os separadores na linha " +
        ((e.row ?? 0) + 1) +
        ".",
    );
  const lines = physicalLines(text);
  const def = DATASETS[dataset];
  const expected = def.fields.map((f) => f.label);
  const headerIndex = parsed.data.findIndex(
    (row, i) =>
      i < 5 && expected.every((h) => row.map((c) => c.trim()).includes(h)),
  );
  const headers = (parsed.data[headerIndex >= 0 ? headerIndex : 0] ?? []).map(
    (h) => h.trim(),
  );
  if (headerIndex < 0)
    errors.push(
      "Cabeçalhos ausentes: " +
        expected.filter((h) => !headers.includes(h)).join(", ") +
        ". Baixe o modelo desta aba.",
    );
  if (new Set(headers).size !== headers.length)
    errors.push("Há cabeçalhos repetidos.");
  const extra = headers.filter((h) => !expected.includes(h));
  if (extra.length)
    errors.push(
      "Colunas não reconhecidas: " +
        extra.join(", ") +
        ". Nenhuma coluna será descartada.",
    );
  const rows: ImportRow[] = [];
  const seen = new Map<string, string>();
  if (!errors.length)
    for (let i = headerIndex + 1; i < parsed.data.length; i++) {
      const values = parsed.data[i];
      if (values.every((v) => !v.trim())) continue;
      const raw = Object.fromEntries(
        headers.map((h, j) => [h, values[j] ?? ""]),
      );
      const data: Record<string, Cell> = {};
      const issues: string[] = [];
      if (values.length !== headers.length)
        issues.push("Quantidade de colunas diferente do cabeçalho.");
      for (const field of def.fields) {
        try {
          data[field.key] = parseCell(raw[field.label], field);
        } catch (e) {
          issues.push((e as Error).message);
        }
      }
      let key = recordKey(dataset, data);
      if (!key) key = "invalid-" + i;
      try {
        resolveRelations(state, dataset, data);
      } catch (e) {
        issues.push((e as Error).message);
      }
      let existing: DataRecord | undefined;
      try {
        if (dataset !== "Decisores_Canais" || contactKind(data))
          existing = matchingRecord(state, dataset, data);
      } catch (e) {
        issues.push((e as Error).message);
      }
      const content = canonical(comparableData(dataset, data));
      const previous = seen.get(key);
      let status: ImportRow["status"] = issues.length ? "invalid" : "new";
      if (
        !issues.length &&
        dataset === "Decisores_Canais" &&
        !contactKind(data)
      ) {
        status = "ignored";
        issues.push(
          "Ignorado: não há nome de pessoa nem canal de contato informado.",
        );
      } else if (!issues.length && (existing || previous)) {
        const existingContent = existing
          ? canonical(comparableData(dataset, existing.data))
          : previous;
        status = content === existingContent ? "duplicate" : "conflict";
        if (status === "conflict")
          issues.push(
            "O mesmo identificador já contém valores diferentes. Revise o cadastro antes de importar.",
          );
      }
      if (!previous && status !== "ignored" && status !== "invalid")
        seen.set(key, content);
      rows.push({ line: lines[i] ?? i + 1, data, raw, key, status, issues });
    }
  if (rows.length > 5000)
    errors.push("Importe até 5.000 registros por arquivo.");
  if (!rows.length && !errors.length)
    errors.push("O CSV não contém registros.");
  return {
    dataset,
    fileName,
    headers,
    rows,
    errors,
    counts: {
      new: rows.filter((r) => r.status === "new").length,
      duplicate: rows.filter((r) => r.status === "duplicate").length,
      conflict: rows.filter((r) => r.status === "conflict").length,
      invalid: rows.filter((r) => r.status === "invalid").length,
      ignored: rows.filter((r) => r.status === "ignored").length,
    },
  };
}
function physicalLines(text: string) {
  const starts = [1];
  let quoted = false;
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') {
        i++;
        continue;
      }
      quoted = !quoted;
    }
    if (text[i] === "\n" || text[i] === "\r") {
      if (text[i] === "\r" && text[i + 1] === "\n") i++;
      line++;
      if (!quoted) starts.push(line);
    }
  }
  return starts;
}
