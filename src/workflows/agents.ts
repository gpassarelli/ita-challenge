import { getWorkflowMetadata } from "workflow";
import {
  claimRun,
  analyzeCompany,
  failCompany,
  finishRun,
} from "@/lib/server/agent-steps";
export async function runAgents(runId: string) {
  "use workflow";
  const companyIds = await claimRun(runId, getWorkflowMetadata().workflowRunId);
  if (!companyIds) return;
  for (let i = 0; i < companyIds.length; i += 3) {
    await Promise.all(
      companyIds.slice(i, i + 3).map(async (companyId) => {
        try {
          await analyzeCompany(runId, companyId);
        } catch {
          await failCompany(runId, companyId);
        }
      }),
    );
  }
  await finishRun(runId);
}
