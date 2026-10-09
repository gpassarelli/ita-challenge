import type { AgentRun, Workspace } from "./types";

export function pendingDataRevisions(state: Workspace, companyId: string) {
  return state.revisions.filter(
    (r) =>
      r.companyId === companyId && r.type === "data" && r.status === "pending",
  );
}

export function agentEligibility(
  state: Workspace,
  agent: AgentRun["agent"],
  selection: string[],
) {
  const companyIds: string[] = [];
  const skippedCompanies: NonNullable<AgentRun["skippedCompanies"]> = [];
  for (const companyId of new Set(selection)) {
    const revisions =
      agent === "signals" ? pendingDataRevisions(state, companyId) : [];
    if (revisions.length)
      skippedCompanies.push({
        companyId,
        revisionIds: revisions.map((r) => r.id),
      });
    else companyIds.push(companyId);
  }
  return { companyIds, skippedCompanies };
}

export class PendingDataRevisionError extends Error {
  constructor() {
    super(
      "Esta empresa tem uma revisão de dados pendente. Aprove ou recuse a revisão antes de analisar os sinais novamente.",
    );
  }
}

export function assertSignalsEligible(
  state: Workspace,
  run: AgentRun,
  companyId: string,
) {
  if (
    run.agent === "signals" &&
    pendingDataRevisions(state, companyId).length
  ) {
    throw new PendingDataRevisionError();
  }
}
