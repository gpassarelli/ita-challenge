import { NextResponse } from "next/server";
import { getRun } from "workflow/api";
import { z } from "zod";
import { reconcileAgentRun } from "@/lib/domain/agent-run-mutations";
import { requireUser } from "@/lib/server/supabase";
import { readAgentRun, mutateWorkspace } from "@/lib/server/store";
import { assertSameOrigin, errorResponse } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = z
      .object({ id: z.uuid() })
      .strict()
      .parse(await request.json());
    const run = await readAgentRun(id);
    if (!run) throw new Error("Execução não encontrada.");
    if (!run.workflowId)
      throw new Error(
        "Esta execução ainda não tem workflow. Cancele-a antes de iniciar outra.",
      );
    const status = await getRun(run.workflowId).status;
    if (status !== "completed" && status !== "failed" && status !== "cancelled")
      return NextResponse.json(
        {
          active: true,
          message:
            "O workflow ainda está ativo. Use Cancelar execução para interrompê-lo.",
        },
        { status: 409 },
      );
    const { state } = await mutateWorkspace(user.id, (state) =>
      reconcileAgentRun(state, user.id, id, status),
    );
    return NextResponse.json({ state, workflowStatus: status });
  } catch (error) {
    return errorResponse(error);
  }
}
