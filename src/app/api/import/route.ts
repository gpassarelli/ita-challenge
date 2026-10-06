import { NextResponse } from "next/server";
import { z } from "zod";
import { datasetNames } from "@/lib/domain/catalog";
import { previewCSV } from "@/lib/domain/csv";
import { importPreview } from "@/lib/domain/mutations";
import { requireUser } from "@/lib/server/supabase";
import { mutateWorkspace, readWorkspace } from "@/lib/server/store";
import { assertSameOrigin, errorResponse } from "@/lib/server/http";
export const maxDuration = 60;
const schema = z
  .object({
    mode: z.enum(["preview", "commit"]),
    dataset: z.enum(datasetNames),
    fileName: z.string().max(255),
    text: z.string().max(5 * 1024 * 1024),
    requestId: z.string().uuid(),
  })
  .strict();
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = schema.parse(await request.json());
    if (input.mode === "preview")
      return NextResponse.json({
        preview: previewCSV(
          input.dataset,
          input.fileName,
          input.text,
          await readWorkspace(),
        ),
      });
    const { state } = await mutateWorkspace(user.id, (state) => {
      const preview = previewCSV(
        input.dataset,
        input.fileName,
        input.text,
        state,
      );
      importPreview(state, user.id, preview, input.requestId);
    });
    return NextResponse.json({ state });
  } catch (e) {
    return errorResponse(e);
  }
}
