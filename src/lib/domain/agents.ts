import { contactKind, normalizedValue } from "./values";
import { z } from "zod";
import { ALLOWED_AI_FIELDS } from "./mutations";
import { fieldsFor, parseCell } from "./catalog";
import type { AgentRun, Change, DataRecord, Workspace } from "./types";
export const signalOutputSchema = z.object({
  explanation: z.string().min(1).max(4000),
  warnings: z.array(z.string().max(1000)).max(20),
  changes: z
    .array(
      z.object({
        field: z.enum(ALLOWED_AI_FIELDS),
        after: z.string().nullable(),
        reason: z.string().min(1).max(2000),
        evidenceIds: z.array(z.string()).min(1).max(30),
      }),
    )
    .max(ALLOWED_AI_FIELDS.length),
});
export const messageOutputSchema = z.object({
  subject: z.string().max(300),
  body: z.string().min(1).max(12000),
  rationale: z.string().min(1).max(4000),
  evidenceIds: z.array(z.string()).min(1).max(30),
  warnings: z.array(z.string().max(1000)).max(20),
});
export function agentContext(
  state: Workspace,
  run: AgentRun,
  companyId: string,
) {
  const company = state.records.find(
    (r) => r.id === companyId && r.dataset === "Prospects",
  );
  if (!company) throw new Error("Empresa não encontrada.");
  const evaluation = state.evaluations.find((e) => e.companyId === companyId);
  const related = state.records.filter(
    (r) =>
      r.companyId === companyId &&
      [
        "Sinais_Publicos",
        "Decisores_Canais",
        "Oportunidades_Historico",
        "Clientes_Atuais",
      ].includes(r.dataset),
  );
  const product = run.productId
    ? state.records.find(
        (r) => r.id === run.productId && r.dataset === "Portfolio",
      )
    : null;
  const contact = run.contactId
    ? related.find(
        (r) => r.id === run.contactId && r.dataset === "Decisores_Canais",
      )
    : null;
  if (run.agent === "outreach" && !product)
    throw new Error("Selecione um produto do portfólio.");
  if (run.contactId && !contact)
    throw new Error("O contato selecionado não pertence à empresa.");
  if (contact && !contactKind(contact.data))
    throw new Error("O contato selecionado não tem nome nem canal informado.");
  if (contact && evaluation?.blockedContactIds.includes(contact.id))
    throw new Error("Este contato está bloqueado pelas regras globais.");
  const records = [
    company,
    ...related.filter((r) => !evaluation?.blockedContactIds.includes(r.id)),
    ...(product ? [product] : []),
  ];
  return {
    company,
    product,
    contact,
    records,
    input: {
      company: project(company),
      records: records.filter((r) => r.id !== company.id).map(project),
      scores: evaluation ?? null,
      selectedProductId: product?.id ?? null,
      selectedContactId: contact?.id ?? null,
      channel: run.channel,
    },
  };
}
function project(r: DataRecord) {
  return {
    id: r.id,
    type: r.dataset,
    version: r.version,
    data: Object.fromEntries(
      Object.entries(r.data).map(([key, value]) => [
        key,
        normalizedValue(value),
      ]),
    ),
    ...(r.dataset === "Decisores_Canais"
      ? { contactKind: contactKind(r.data) }
      : {}),
    fieldSources: r.fieldSources,
    origins: r.origins.map((o) => ({
      batchId: o.batchId,
      fileName: o.fileName,
      row: o.row,
      importedAt: o.importedAt,
    })),
  };
}
export function validateEvidence(ids: string[], allowed: DataRecord[]) {
  if (ids.some((id) => !allowed.some((r) => r.id === id)))
    throw new Error(
      "O agente citou uma evidência inexistente ou fora do contexto.",
    );
}
export function validatedChanges(
  raw: z.infer<typeof signalOutputSchema>,
  company: DataRecord,
  records: DataRecord[],
): Change[] {
  if (new Set(raw.changes.map((c) => c.field)).size !== raw.changes.length)
    throw new Error("O agente repetiu o mesmo campo na proposta.");
  return raw.changes
    .map((c) => {
      validateEvidence(c.evidenceIds, records);
      const field = fieldsFor("Prospects").find((f) => f.key === c.field)!;
      return {
        ...c,
        before: company.data[c.field] ?? null,
        after: parseCell(c.after, field),
      };
    })
    .filter((c) => c.before !== c.after);
}
