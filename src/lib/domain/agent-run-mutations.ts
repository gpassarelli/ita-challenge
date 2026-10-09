import type { z } from "zod";
import type { agentRequestSchema } from "./commands";
import { agentContext } from "./agents";
import { audit } from "./mutations";
import { agentEligibility, archiveBlockReason } from "./agent-runs";
import { isoNow, type AgentRun, type Workspace, type AgentExecutionSettings } from "./types";

// Called inside mutateWorkspace so conflicts recompute eligibility from fresh data.
export function queueAgentRun(
  state: Workspace,
  actor: string,
  input: z.infer<typeof agentRequestSchema>,
  settings?: AgentExecutionSettings,
) {
  const previous = state.runs.find((r) => r.id === input.id);
  if (previous) return previous.status === "queued" && !previous.workflowId;
  if (state.runs.some((r) => r.status === "queued" || r.status === "running"))
    throw new Error(
      "Aguarde a execução atual terminar antes de iniciar outra.",
    );
  const selection = [...new Set(input.companyIds)];
  if (input.contactId && selection.length !== 1)
    throw new Error(
      "Selecione uma empresa para usar um destinatário específico.",
    );
  const { companyIds, skippedCompanies } = agentEligibility(
    state,
    input.agent,
    selection,
  );
  if (!companyIds.length)
    throw new Error(
      "Todas as empresas selecionadas têm revisões de dados pendentes. Aprove ou recuse essas revisões antes de analisar os sinais novamente.",
    );
  const run: AgentRun = {
    ...input,
    settings,
    companyIds,
    skippedCompanies,
    requestedBy: actor,
    requestedAt: isoNow(),
    workflowId: null,
    status: "queued",
    items: companyIds.map((companyId) => ({
      companyId,
      status: "queued",
      error: null,
      revisionId: null,
    })),
  };
  // Validate the original selection too: filtering must not hide invalid inputs.
  selection.forEach((id) => agentContext(state, run, id));
  state.runs.push(run);
  return true;
}

export function archiveRun(state: Workspace, actor: string, id: string) {
  const run = state.runs.find((r) => r.id === id);
  if (!run) throw new Error("Execução não encontrada.");
  if (run.archivedAt) return;
  const reason = archiveBlockReason(state, run);
  if (reason) throw new Error(reason);
  run.archivedAt = isoNow();
  run.archivedBy = actor;
  audit(state, actor, "Execução arquivada", id, null, {
    archivedAt: run.archivedAt,
    archivedBy: actor,
  });
}

export function cancelAgentRun(state: Workspace, actor: string, id: string) {
  const run = state.runs.find((r) => r.id === id);
  if (!run) throw new Error("Execução não encontrada.");
  if (run.status === "cancelled") return run.workflowId;
  if (run.status !== "queued" && run.status !== "running") return null;
  const at = isoNow();
  run.status = "cancelled";
  run.finishedAt = at;
  for (const item of run.items) {
    if (item.status !== "queued" && item.status !== "running") continue;
    item.status = "cancelled";
    item.finishedAt = at;
    item.error = null;
    for (const step of item.steps ?? []) {
      if (step.status !== "running") continue;
      step.status = "cancelled";
      step.finishedAt = at;
    }
  }
  audit(state, actor, "Execução cancelada", id, null, { cancelledAt: at });
  return run.workflowId;
}

// Reconcile only workflows whose runtime has already reached a terminal state.
export function reconcileAgentRun(
  state: Workspace,
  actor: string,
  id: string,
  workflowStatus: "completed" | "failed" | "cancelled",
) {
  const run = state.runs.find((r) => r.id === id);
  if (!run) throw new Error("Execução não encontrada.");
  if (run.status !== "queued" && run.status !== "running") return;
  if (workflowStatus === "cancelled") {
    cancelAgentRun(state, actor, id);
    return;
  }
  const at = isoNow();
  const reason =
    "A execução anterior terminou sem concluir esta empresa. Inicie uma nova execução. Código: WORKFLOW_FINISHED.";
  for (const item of run.items) {
    if (item.status !== "queued" && item.status !== "running") continue;
    item.status = "failed";
    item.finishedAt = at;
    item.error ??= reason;
    for (const step of item.steps ?? []) {
      if (step.status !== "running") continue;
      step.status = "failed";
      step.finishedAt = at;
      step.error ??= item.error;
    }
  }
  run.status =
    workflowStatus === "failed" || run.items.every((i) => i.status === "failed")
      ? "failed"
      : "completed";
  run.finishedAt = at;
  if (run.status === "failed")
    run.error ??=
      "As tentativas da execução anterior terminaram. Consulte o erro da empresa e inicie uma nova execução.";
  audit(state, actor, "Execução reconciliada", id, null, {
    workflowStatus,
    status: run.status,
  });
}
