import {
  emptyWorkspace,
  uid,
  isoNow,
  type Criterion,
  type RuleSet,
  type Workspace,
  type DataRecord,
  type Revision,
  type AgentRun,
} from "../src/lib/domain/types";
import { saveRecord, saveRules } from "../src/lib/domain/mutations";
export const actor = "00000000-0000-4000-8000-000000000001";
export function company(s: Workspace, extra: Record<string, unknown> = {}) {
  return saveRecord(s, actor, "Prospects", {
    external_id: "TEST-" + uid(),
    name: "Empresa de teste isolado",
    segment: "Tecnologia",
    ...extra,
  });
}
export function product(s: Workspace, extra: Record<string, unknown> = {}) {
  return saveRecord(s, actor, "Portfolio", {
    external_id: "PROD-" + uid(),
    name: "Solução de teste",
    ...extra,
  });
}
export function criterion(extra: Partial<Criterion> = {}): Criterion {
  const {
    field = "employees",
    operator = "gte",
    value = "200",
    recentDays,
    alternatives,
    ...metadata
  } = extra;
  return {
    id: uid(),
    name: "Porte",
    weight: 100,
    rationale: "Regra de teste",
    ...metadata,
    ...(alternatives
      ? { alternatives }
      : {
          field,
          operator,
          value,
          ...(recentDays === undefined ? {} : { recentDays }),
        }),
  };
}
export function activate(
  s: Workspace,
  criteria: Criterion[],
  kind: RuleSet["kind"] = "icp",
) {
  return saveRules(s, actor, {
    id: uid(),
    kind,
    active: true,
    criteria,
    exclusions: [],
  });
}
export function revision(
  c: DataRecord,
  extra: Partial<Revision> = {},
): Revision {
  return {
    id: uid(),
    type: "data",
    companyId: c.id,
    companyVersion: c.version,
    runId: uid(),
    status: "pending",
    changes: [
      {
        field: "structured_hr",
        before: c.data.structured_hr ?? null,
        after: "Sim",
        reason: "Evidência de teste",
        evidenceIds: [c.id],
      },
    ],
    message: null,
    originalMessage: null,
    explanation: "Teste isolado",
    warnings: [],
    input: { company: c.data },
    promptVersion: "teste-v1",
    model: "modelo-de-teste",
    createdBy: actor,
    createdAt: isoNow(),
    reviewedBy: null,
    reviewedAt: null,
    reason: "",
    edited: false,
    ...extra,
  };
}
export function run(c: DataRecord, extra: Partial<AgentRun> = {}): AgentRun {
  return {
    id: uid(),
    agent: "signals",
    companyIds: [c.id],
    productId: null,
    contactId: null,
    channel: "E-mail",
    requestedBy: actor,
    requestedAt: isoNow(),
    workflowId: null,
    status: "queued",
    items: [],
    ...extra,
  };
}
export { emptyWorkspace, uid };
