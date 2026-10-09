import { NextResponse } from "next/server";
import { getRun } from "workflow/api";
import { z } from "zod";
import { cancelAgentRun } from "@/lib/domain/agent-run-mutations";
import { requireUser } from "@/lib/server/supabase";
import { mutateWorkspace } from "@/lib/server/store";
import { assertSameOrigin, errorResponse } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = z
      .object({ id: z.uuid() })
      .strict()
      .parse(await request.json());
    // Persist first so an in-flight step cannot save results after cancellation.
    const { state, result: workflowId } = await mutateWorkspace(
      user.id,
      (state) => cancelAgentRun(state, user.id, id),
    );
    if (workflowId) await getRun(workflowId).cancel();
    return NextResponse.json({ state });
  } catch (error) {
    return errorResponse(error);
  }
}
