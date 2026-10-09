import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { agentRequestSchema } from "@/lib/domain/commands";
import { queueAgentRun } from "@/lib/domain/agent-run-mutations";
import { isoNow } from "@/lib/domain/types";
import { requireUser } from "@/lib/server/supabase";
import { mutateWorkspace } from "@/lib/server/store";
import { assertSameOrigin, errorResponse } from "@/lib/server/http";
import { runAgents } from "@/workflows/agents";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = agentRequestSchema.parse(await request.json());
    if (!process.env.OPENAI_MODEL || !process.env.OPENAI_API_KEY)
      throw new Error("Conecte a IA antes de executar os agentes.");
    const { state, result } = await mutateWorkspace(user.id, (state) =>
      queueAgentRun(state, user.id, input),
    );
    if (result) {
      try {
        await start(runAgents, [input.id]);
      } catch {
        await mutateWorkspace(user.id, (state) => {
          const run = state.runs.find((r) => r.id === input.id)!;
          run.status = "failed";
          run.items.forEach((i) => {
            i.status = "failed";
            i.error = "Não foi possível iniciar a execução.";
          });
        });
        throw new Error("Não foi possível iniciar o agente. Tente novamente.");
      }
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
