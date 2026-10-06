import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/supabase";
import { mutateWorkspace, readWorkspace } from "@/lib/server/store";
import { needsRecalculation } from "@/lib/domain/scoring";
import { errorResponse } from "@/lib/server/http";
export async function GET() {
  try {
    const user = await requireUser();
    // Refresh time-dependent scores and preserve their dated history.
    let state = await readWorkspace();
    if (needsRecalculation(state))
      state = (await mutateWorkspace(user.id, () => {})).state;
    return NextResponse.json(
      {
        state,
        user: { id: user.id, email: user.email },
        aiReady: Boolean(
          process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL,
        ),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
