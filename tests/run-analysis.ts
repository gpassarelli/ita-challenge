// Exercise one attempt with the real durable step implementations; retry
// orchestration itself is covered by workflow.test.ts.
import {
  prepareCompany,
  beginGeneration,
  generateCompany,
  recordGeneration,
  saveCompany,
  failCompany,
} from "../src/lib/server/agent-steps";
import { PendingDataRevisionError } from "../src/lib/domain/agent-runs";
import { agentErrorMessage } from "../src/lib/server/diagnostics";
export async function analyzeCompany(runId: string, companyId: string) {
  let generationError: string | null = null;
  try {
    const prepared = await prepareCompany(runId, companyId);
    if (!prepared || !(await beginGeneration(prepared, 1))) return;
    const generated = await generateCompany(prepared);
    if (generated.cancelled) return;
    await recordGeneration(prepared, generated, 1);
    if (generated.error) {
      generationError = generated.error;
      throw new Error(generated.error);
    }
    if (generated.revision) await saveCompany(prepared, generated.revision);
  } catch (error) {
    const message = generationError ?? agentErrorMessage(error);
    await failCompany(runId, companyId, message);
    if (!(error instanceof PendingDataRevisionError)) throw error;
  }
}
