import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/supabase";
import { mutateWorkspace } from "@/lib/server/store";
import { assertSameOrigin, errorResponse } from "@/lib/server/http";
import { commandSchema } from "@/lib/domain/commands";
import { executeCommand } from "@/lib/domain/execute";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const c = commandSchema.parse(await request.json());
    const requestId = z
      .string()
      .uuid()
      .parse(request.headers.get("Idempotency-Key"));
    const { state } = await mutateWorkspace(user.id, (state) =>
      executeCommand(state, user.id, c, requestId),
    );
    return NextResponse.json({ state });
  } catch (e) {
    return errorResponse(e);
  }
}
