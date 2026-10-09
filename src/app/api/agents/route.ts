import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { agentRequestSchema } from "@/lib/domain/commands";
import { queueAgentRun } from "@/lib/domain/agent-run-mutations";
import { isoNow } from "@/lib/domain/types";
import { requireUser } from "@/lib/server/supabase";
import { mutateWorkspace } from "@/lib/server/store";
import { assertSameOrigin, errorResponse } from "@/lib/server/http";
import { configuredAgent } from "@/lib/server/agents";
import { runAgents } from "@/workflows/agents";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = agentRequestSchema.parse(await request.json());
    configuredAgent(input.agent);
    let { state, result } = await mutateWorkspace(user.id, (state) =>
      queueAgentRun(state, user.id, input),
    );
    if (result) {
      let workflow;
      try {
        workflow = await start(runAgents, [input.id]);
      } catch {
        await mutateWorkspace(user.id, (state) => {
          const run = state.runs.find((r) => r.id === input.id)!;
          if (run.status === "cancelled") return;
          run.status = "failed";
          run.finishedAt = isoNow();
          run.items.forEach((i) => {
            i.status = "failed";
            i.finishedAt = isoNow();
            i.error = "Não foi possível iniciar a execução.";
          });
        });
        throw new Error("Não foi possível iniciar o agente. Tente novamente.");
      }
      const persisted = await mutateWorkspace(user.id, (state) => {
        const run = state.runs.find((r) => r.id === input.id)!;
        run.workflowId ??= workflow.runId;
        return run.status === "cancelled";
      });
      state = persisted.state;
      if (persisted.result) await workflow.cancel();
    }
    const run = state.runs.find((r) => r.id === input.id)!;
    return NextResponse.json({
      state,
      runId: run.id,
      skippedCompanies: run.skippedCompanies ?? [],
    });
  } catch (e) {
    return errorResponse(e);
  }
}
