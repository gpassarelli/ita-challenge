import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { agentRequestSchema } from "@/lib/domain/commands";
import { agentContext } from "@/lib/domain/agents";
import { isoNow, type AgentRun } from "@/lib/domain/types";
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
    const { state, result } = await mutateWorkspace(user.id, (state) => {
      const previous = state.runs.find((r) => r.id === input.id);
      if (previous) return previous.status === "queued" && !previous.workflowId;
      if (state.runs.some((r) => ["queued", "running"].includes(r.status)))
        throw new Error(
          "Aguarde a execução atual terminar antes de iniciar outra.",
        );
      const companyIds = [...new Set(input.companyIds)];
      if (input.contactId && companyIds.length !== 1)
        throw new Error(
          "Selecione uma empresa para usar um destinatário específico.",
        );
      const run: AgentRun = {
        ...input,
        companyIds,
        requestedBy: user.id,
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
      companyIds.forEach((id) => agentContext(state, run, id));
      state.runs.push(run);
      return true;
    });
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
    return NextResponse.json({ state });
  } catch (e) {
    return errorResponse(e);
  }
}
