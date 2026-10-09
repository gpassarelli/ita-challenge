import { getWorkflowMetadata } from "workflow";
import {
  claimRun,
  isRunActive,
  prepareCompany,
  beginGeneration,
  generateCompany,
  recordGeneration,
  saveCompany,
  failCompany,
  finishRun,
  failRun,
} from "@/lib/server/agent-steps";
import { agentErrorMessage } from "@/lib/server/diagnostics";

export async function runAgents(runId: string) {
  "use workflow";
  try {
    const companyIds = await claimRun(
      runId,
      getWorkflowMetadata().workflowRunId,
    );
    if (!companyIds) return;
    for (let i = 0; i < companyIds.length; i += 3) {
      if (!(await isRunActive(runId))) return;
      await Promise.all(
        companyIds.slice(i, i + 3).map(async (companyId) => {
          try {
            const prepared = await prepareCompany(runId, companyId);
            if (!prepared) return;
            for (let attempt = 1; attempt <= 2; attempt++) {
              if (!(await beginGeneration(prepared, attempt))) return;
              const generated = await generateCompany(prepared, attempt);
              if (generated.cancelled) return;
              await recordGeneration(prepared, generated, attempt);
              if (generated.revision) {
                await saveCompany(prepared, generated.revision);
                return;
              }
              if (!generated.retryable || attempt === 2) {
                await failCompany(
                  runId,
                  companyId,
                  generated.error ?? undefined,
                );
                return;
              }
            }
          } catch (error) {
            await failCompany(runId, companyId, agentErrorMessage(error));
          }
        }),
      );
    }
    await finishRun(runId);
  } catch (error) {
    await failRun(runId, agentErrorMessage(error));
    throw error;
  }
}
