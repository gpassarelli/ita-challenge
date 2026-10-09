import { getWorkflowMetadata, sleep } from "workflow";
import {
  claimRun,
  isRunActive,
  executionSettings,
  generationCooldown,
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
    const settings = await executionSettings(runId);
    let next = 0;
    let cancelled = false;
    await Promise.all(
      Array.from(
        { length: Math.min(settings.concurrency, companyIds.length) },
        async () => {
          while (next < companyIds.length && !cancelled) {
            const companyId = companyIds[next++];
            if (!(await isRunActive(runId))) {
              cancelled = true;
              return;
            }
            try {
              const prepared = await prepareCompany(runId, companyId);
              if (!prepared) continue;
              let feedback: string | undefined;
              for (let attempt = 1; attempt <= 2; attempt++) {
                let cooldown = await generationCooldown(runId);
                while (cooldown > 0) {
                  await sleep(cooldown);
                  if (!(await isRunActive(runId))) {
                    cancelled = true;
                    return;
                  }
                  cooldown = await generationCooldown(runId);
                }
                if (!(await beginGeneration(prepared, attempt))) break;
                const generated = await generateCompany(
                  prepared,
                  attempt,
                  feedback,
                );
                if (generated.cancelled) {
                  cancelled = true;
                  return;
                }
                await recordGeneration(prepared, generated, attempt);
                if (generated.revision) {
                  await saveCompany(prepared, generated.revision);
                  break;
                }
                if (!generated.retryable || attempt === 2) {
                  await failCompany(
                    runId,
                    companyId,
                    generated.error ?? undefined,
                  );
                  break;
                }
                feedback = generated.feedback;
                await sleep(generated.retryDelayMs ?? 1000);
              }
            } catch (error) {
              await failCompany(runId, companyId, agentErrorMessage(error));
            }
          }
        },
      ),
    );
    if (cancelled || !(await isRunActive(runId))) return;
    await finishRun(runId);
  } catch (error) {
    await failRun(runId, agentErrorMessage(error));
    throw error;
  }
}
