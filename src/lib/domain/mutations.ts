import { DATASETS, validateData, type Cell, type Dataset } from "./catalog";
import {
  canonical,
  matchingRecord,
  recordKey,
  resolveRelations,
  type Preview,
} from "./csv";
import { contactKind } from "./values";
import {
  contractFor,
  customerOpportunityKey,
  originatingContract,
} from "./contracts";
import { LIST_FIELDS } from "./lists";
import { recalculate, validateRuleset, conditionNumber } from "./scoring";
import {
  isoNow,
  uid,
  type DataRecord,
  type RuleSet,
  type SavedList,
  type Workspace,
} from "./types";
export function audit(
  state: Workspace,
  actor: string,
  action: string,
  entityId: string,
  before: unknown,
  after: unknown,
) {
  state.audits.push({
    id: uid(),
    actor,
    action,
    entityId,
    before,
    after,
    at: isoNow(),
  });
}
export function touchCompany(state: Workspace, companyId: string | null) {
  const company = state.records.find(
    (r) => r.id === companyId && r.dataset === "Prospects",
  );
  if (company) {
    company.version++;
    company.updatedAt = isoNow();
  }
}
function updateCustomer(state: Workspace, companyId: string | null) {
  const company = state.records.find(
    (r) => r.id === companyId && r.dataset === "Prospects",
  );
  if (!company) return;
  const active = state.records.find(
    (r) =>
      r.dataset === "Clientes_Atuais" &&
      r.companyId === company.id &&
      r.data.customer_status === "Cliente ativo",
  );
  const churn = state.records.find(
    (r) =>
      r.dataset === "Clientes_Atuais" &&
      r.companyId === company.id &&
      r.data.customer_status === "Churn",
  );
  const status = active ? "Cliente ativo" : churn ? "Ex-cliente" : "Prospect";
  if (company.data.commercial_status !== status) {
    company.data.commercial_status = status;
    company.fieldSources = {
      ...company.fieldSources,
      commercial_status: {
        kind: "manual",
        detail: active
          ? "Contratação ativa: " + active.data.solution_external_id
          : churn
            ? "Churn informado: " + churn.externalKey
            : "Nenhuma contratação ativa vinculada",
        at: isoNow(),
      },
    };
  }
}
export function saveRecord(
  state: Workspace,
  actor: string,
  dataset: Dataset,
  input: Record<string, unknown>,
  id?: string,
  expectedVersion?: number,
): DataRecord {
  return writeRecord(state, actor, dataset, input, id, expectedVersion, true);
}

function writeRecord(
  state: Workspace,
  actor: string,
  dataset: Dataset,
  input: Record<string, unknown>,
  id?: string,
  expectedVersion?: number,
  synchronize = false,
) {
  const data = validateData(dataset, input);
  if (dataset === "Decisores_Canais" && !contactKind(data))
    throw new Error("Informe o nome da pessoa ou um canal de contato.");
  const old = id ? state.records.find((r) => r.id === id) : undefined;
  if (id && !old) throw new Error("Registro não encontrado.");
  if (old && old.dataset !== dataset)
    throw new Error("Tipo de registro inválido.");
  if (old && old.version !== expectedVersion)
    throw new Error(
      "Este registro foi alterado. Atualize a página antes de salvar.",
    );
  if (dataset === "Clientes_Atuais" && synchronize) {
    if (data.opportunity_id && data.opportunity_id !== old?.data.opportunity_id)
      throw new Error(
        "O vínculo com a oportunidade é preenchido automaticamente.",
      );
    data.opportunity_id = old?.data.opportunity_id ?? null;
  }
  const relations = resolveRelations(state, dataset, data, old);
  if (
    old?.dataset === "Oportunidades_Historico" &&
    originatingContract(state, old.id) &&
    (data.outcome !== "Ganha" ||
      relations.companyId !== old.companyId ||
      relations.productId !== old.productId)
  )
    throw new Error(
      "Esta oportunidade originou uma contratação. Para registrar cancelamento, altere a contratação para Churn; a venda permanece ganha.",
    );
  const key = old?.externalKey ?? recordKey(dataset, data);
  const matching =
    !old || dataset === "Clientes_Atuais"
      ? matchingRecord(state, dataset, data)
      : undefined;
  if (matching && matching.id !== old?.id)
    throw new Error("Já existe um registro com este identificador.");
  if (dataset === "Prospects" && !data.commercial_status)
    data.commercial_status = "Prospect";
  const record: DataRecord = {
    id: old?.id ?? uid(),
    dataset,
    externalKey: key,
    data,
    ...relations,
    version: (old?.version ?? 0) + 1,
    origins: old?.origins ?? [],
    createdAt: old?.createdAt ?? isoNow(),
    updatedAt: isoNow(),
  };
  record.fieldSources = { ...old?.fieldSources };
  for (const [field, value] of Object.entries(data))
    if (!old || canonical(old.data[field]) !== canonical(value))
      record.fieldSources[field] = {
        kind: "manual",
        detail: "Cadastro manual · usuário " + actor,
        at: record.updatedAt,
      };
  const before = old ? structuredClone(old) : null;
  if (old) state.records[state.records.indexOf(old)] = record;
  else state.records.push(record);
  if (synchronize && dataset === "Clientes_Atuais")
    linkCustomerOpportunity(state, actor, record);
  if (
    synchronize &&
    dataset === "Oportunidades_Historico" &&
    data.outcome === "Ganha"
  )
    activateContract(state, actor, record, old);
  if (record.dataset === "Prospects") updateCustomer(state, record.id);
  if (["Clientes_Atuais", "Oportunidades_Historico"].includes(record.dataset)) {
    updateCustomer(state, record.companyId);
    if (old?.companyId && old.companyId !== record.companyId)
      updateCustomer(state, old.companyId);
  }
  touchCompany(state, record.companyId);
  if (old?.companyId && old.companyId !== record.companyId)
    touchCompany(state, old.companyId);
  audit(
    state,
    actor,
    old ? "Registro atualizado" : "Registro criado",
    record.id,
    before,
    record,
  );
  recalculate(state);
  return record;
}

function linkCustomerOpportunity(
  state: Workspace,
  actor: string,
  customer: DataRecord,
) {
  if (customer.data.opportunity_id) return;
  let opportunity = state.records
    .filter(
      (record) =>
        record.dataset === "Oportunidades_Historico" &&
        record.companyId === customer.companyId &&
        record.productId === customer.productId &&
        record.data.outcome === "Ganha",
    )
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )[0];
  if (!opportunity) {
    opportunity = writeRecord(state, actor, "Oportunidades_Historico", {
      external_id: customerOpportunityKey(customer.id),
      company_external_id: customer.data.company_external_id,
      company_name:
        customer.data.company_name ??
        state.records.find((record) => record.id === customer.companyId)?.data
          .name,
      solution_external_id: customer.data.solution_external_id,
      outcome: "Ganha",
      estimated_ticket: customer.data.annual_ticket,
      source: "Cadastro de clientes atuais",
    });
  }
  customer.data.opportunity_id = opportunity.id;
  customer.fieldSources = {
    ...customer.fieldSources,
    opportunity_id: {
      kind: "manual",
      detail: "Contratação vinculada à oportunidade " + opportunity.externalKey,
      at: isoNow(),
    },
  };
}

function activateContract(
  state: Workspace,
  actor: string,
  opportunity: DataRecord,
  old?: DataRecord,
) {
  const existing = contractFor(state, opportunity);
  const newlyWon =
    old?.data.outcome !== "Ganha" ||
    old.productId !== opportunity.productId ||
    old.companyId !== opportunity.companyId;
  if (
    existing &&
    existing.data.opportunity_id &&
    (!newlyWon || existing.data.customer_status === "Cliente ativo")
  )
    return;
  const company = state.records.find(
    (record) => record.id === opportunity.companyId,
  )!;
  writeRecord(
    state,
    actor,
    "Clientes_Atuais",
    {
      ...(existing?.data ?? {
        company_external_id: company.externalKey,
        company_name: company.data.name,
        segment: company.data.segment,
        employees: company.data.employees,
        state: company.data.state,
        solution_external_id: opportunity.data.solution_external_id,
        annual_ticket: opportunity.data.estimated_ticket,
      }),
      customer_status:
        newlyWon || !existing ? "Cliente ativo" : existing.data.customer_status,
      opportunity_id: existing?.data.opportunity_id ?? opportunity.id,
    },
    existing?.id,
    existing?.version,
  );
}
export function importPreview(
  state: Workspace,
  actor: string,
  preview: Preview,
  idempotencyKey: string,
) {
  if (state.imports.some((b) => b.id === idempotencyKey)) return;
  if (
    preview.errors.length ||
    preview.counts.invalid ||
    preview.counts.conflict
  )
    throw new Error("Corrija todos os erros e conflitos antes de importar.");
  if (!preview.counts.new && !preview.counts.duplicate)
    throw new Error(
      "Não há registros para importar. As linhas sem nome ou canal foram ignoradas.",
    );
  for (const row of preview.rows) {
    if (row.status === "ignored") continue;
    let record = matchingRecord(state, preview.dataset, row.data);
    if (
      record &&
      ((preview.dataset === "Clientes_Atuais" && !record.data.opportunity_id) ||
        (preview.dataset === "Oportunidades_Historico" &&
          record.data.outcome === "Ganha" &&
          !contractFor(state, record)))
    )
      record = saveRecord(
        state,
        actor,
        record.dataset,
        record.data,
        record.id,
        record.version,
      );
    if (!record) {
      record = saveRecord(state, actor, preview.dataset, row.data);
      for (const field of DATASETS[preview.dataset].fields)
        record.fieldSources![field.key] = {
          kind: "import",
          detail:
            preview.fileName +
            ", linha " +
            row.line +
            " · lote " +
            idempotencyKey,
          at: isoNow(),
        };
    }
    record.origins.push({
      batchId: idempotencyKey,
      fileName: preview.fileName,
      row: row.line,
      raw: row.raw,
      actor,
      importedAt: isoNow(),
    });
    if (record.dataset === "Clientes_Atuais") {
      const generated = state.records.find(
        (candidate) =>
          candidate.dataset === "Oportunidades_Historico" &&
          candidate.externalKey === customerOpportunityKey(record.id) &&
          candidate.id === record.data.opportunity_id,
      );
      if (generated) {
        generated.origins.push(structuredClone(record.origins.at(-1)!));
        for (const [field, sourceField] of Object.entries({
          company_external_id: "company_external_id",
          company_name: "company_name",
          solution_external_id: "solution_external_id",
          estimated_ticket: "annual_ticket",
        }))
          generated.fieldSources![field] = {
            kind: "import",
            detail:
              preview.fileName +
              ", linha " +
              row.line +
              " · contratação " +
              record.id +
              " · " +
              sourceField,
            at: isoNow(),
          };
      }
    }
    if (record.dataset === "Oportunidades_Historico") {
      const contract = contractFor(state, record);
      if (contract?.data.opportunity_id === record.id) {
        contract.origins.push(structuredClone(record.origins.at(-1)!));
        for (const field of [
          "company_external_id",
          "company_name",
          "solution_external_id",
          "annual_ticket",
        ])
          if (
            !contract.fieldSources?.[field] ||
            contract.createdAt === contract.updatedAt
          )
            contract.fieldSources![field] = {
              kind: "import",
              detail:
                preview.fileName +
                ", linha " +
                row.line +
                " · oportunidade " +
                record.externalKey,
              at: isoNow(),
            };
      }
    }
  }
  state.imports.push({
    id: idempotencyKey,
    dataset: preview.dataset,
    fileName: preview.fileName,
    count: preview.counts.new,
    skipped: preview.counts.duplicate + preview.counts.ignored,
    ignored: preview.counts.ignored,
    actor,
    at: isoNow(),
  });
  audit(state, actor, "CSV importado", idempotencyKey, null, {
    dataset: preview.dataset,
    fileName: preview.fileName,
    ...preview.counts,
  });
  recalculate(state);
}
export function saveRules(
  state: Workspace,
  actor: string,
  input: Omit<RuleSet, "version" | "createdAt" | "createdBy">,
) {
  const version =
    Math.max(
      0,
      ...state.rulesets
        .filter((r) => r.kind === input.kind)
        .map((r) => r.version),
    ) + 1;
  const set: RuleSet = {
    ...input,
    id: uid(),
    version,
    createdAt: isoNow(),
    createdBy: actor,
  };
  validateRuleset(set);
  const sourceDataset =
    set.kind === "icp"
      ? "ICP_Criterios"
      : set.kind === "commercial"
        ? "Regras_Score_Exemplo"
        : "Desqualificadores";
  if (
    [...set.criteria, ...set.exclusions].some(
      (c) =>
        c.sourceRecordId &&
        !state.records.some(
          (r) => r.id === c.sourceRecordId && r.dataset === sourceDataset,
        ),
    )
  )
    throw new Error("O registro de origem da regra não foi encontrado.");
  if (set.active)
    state.rulesets
      .filter((r) => r.kind === set.kind && r.active)
      .forEach((r) => (r.active = false));
  state.rulesets.push(set);
  audit(
    state,
    actor,
    set.active ? "Regras ativadas" : "Rascunho de regras salvo",
    set.id,
    null,
    set,
  );
  recalculate(state);
  return set;
}
export function saveList(state: Workspace, actor: string, list: SavedList) {
  if (!list.name.trim()) throw new Error("Informe o nome da lista.");
  if (
    list.filters.some(
      (f) =>
        !LIST_FIELDS.some((x) => x.key === f.field) ||
        (["gte", "lte"].includes(f.operator) &&
          !Number.isFinite(conditionNumber(f.value))),
    )
  )
    throw new Error("Filtro inválido.");
  if (
    !list.sort.length ||
    list.sort.length > 2 ||
    list.sort.some((s) => !LIST_FIELDS.some((f) => f.key === s.field))
  )
    throw new Error("Escolha até duas ordenações válidas.");
  const old = state.lists.find((l) => l.id === list.id);
  const saved = {
    ...list,
    createdBy: old?.createdBy ?? actor,
    updatedAt: isoNow(),
  };
  if (old) state.lists[state.lists.indexOf(old)] = saved;
  else state.lists.push(saved);
  audit(state, actor, "Lista salva", saved.id, old ?? null, saved);
}
export function moveOpportunity(
  state: Workspace,
  actor: string,
  id: string,
  outcome: string,
  version: number,
) {
  const record = state.records.find(
    (r) => r.id === id && r.dataset === "Oportunidades_Historico",
  );
  if (!record) throw new Error("Oportunidade não encontrada.");
  if (record.data.outcome === outcome) return;
  const before = record.data.outcome;
  saveRecord(
    state,
    actor,
    record.dataset,
    { ...record.data, outcome },
    id,
    version,
  );
  audit(
    state,
    actor,
    "Oportunidade movimentada",
    id,
    { outcome: before },
    { outcome },
  );
}
export const ALLOWED_AI_FIELDS = [
  "employees",
  "segment",
  "state",
  "operating_status",
  "structured_hr",
  "multi_region",
  "growth",
  "employer_branding",
  "retention_pain",
  "renewal",
  "benefits_fit",
  "operates_brazil",
  "renewed_24_months",
] as const;
export function decideRevision(
  state: Workspace,
  actor: string,
  id: string,
  decision: "approved" | "rejected",
  reason: string,
  editedMessage?: { subject: string; body: string },
) {
  const r = state.revisions.find((r) => r.id === id);
  if (!r) throw new Error("Revisão não encontrada.");
  if (r.status === decision) return;
  if (r.status !== "pending") throw new Error("Esta revisão já foi decidida.");
  if (decision === "rejected" && !reason.trim())
    throw new Error("Informe o motivo da recusa.");
  const company = state.records.find((c) => c.id === r.companyId)!;
  if (decision === "approved" && r.type === "data") {
    if (company.version !== r.companyVersion)
      throw new Error(
        "A empresa mudou após a análise. Execute o agente novamente.",
      );
    const updates = { ...company.data };
    for (const change of r.changes) {
      if (
        !ALLOWED_AI_FIELDS.includes(
          change.field as (typeof ALLOWED_AI_FIELDS)[number],
        )
      )
        throw new Error("A revisão contém um campo não permitido.");
      if (
        canonical(company.data[change.field] ?? null) !==
        canonical(change.before)
      )
        throw new Error(
          "Os valores originais desta revisão estão desatualizados.",
        );
      updates[change.field] = change.after;
    }
    if (r.changes.length) {
      const saved = saveRecord(
        state,
        actor,
        "Prospects",
        updates,
        company.id,
        company.version,
      );
      for (const change of r.changes)
        saved.fieldSources![change.field] = {
          kind: "revision",
          detail: "Revisão aprovada " + r.id + " · usuário " + actor,
          at: isoNow(),
        };
    }
  }
  if (r.type === "message" && editedMessage) {
    if (
      decision === "approved" &&
      (!editedMessage.body.trim() || editedMessage.body.length > 12000)
    )
      throw new Error("A mensagem deve conter entre 1 e 12.000 caracteres.");
    r.message = { ...r.message!, ...editedMessage };
    r.edited =
      r.originalMessage?.body !== editedMessage.body ||
      r.originalMessage?.subject !== editedMessage.subject;
  }
  r.status = decision;
  r.reason = reason;
  r.reviewedBy = actor;
  r.reviewedAt = isoNow();
  audit(
    state,
    actor,
    decision === "approved" ? "Revisão aprovada" : "Revisão recusada",
    id,
    { status: "pending" },
    { status: decision, reason, edited: r.edited },
  );
  recalculate(state);
}
