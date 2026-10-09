import type { z } from "zod";
import type { agentRequestSchema } from "./commands";
import { agentContext } from "./agents";
import { agentEligibility } from "./agent-runs";
import { isoNow, type AgentRun, type Workspace } from "./types";

// Called inside mutateWorkspace so conflicts recompute eligibility from fresh data.
export function queueAgentRun(
  state: Workspace,
  actor: string,
  input: z.infer<typeof agentRequestSchema>,
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
