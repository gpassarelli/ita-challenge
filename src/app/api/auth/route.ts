import { NextResponse } from "next/server";
import { z } from "zod";
import { authClient } from "@/lib/server/supabase";
import { assertSameOrigin, errorResponse } from "@/lib/server/http";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = z
      .object({
        action: z.enum(["login", "logout"]),
        email: z.string().optional(),
        password: z.string().optional(),
      })
      .parse(await request.json());
    const client = await authClient();
    if (body.action === "logout") {
      await client.auth.signOut();
      return NextResponse.json({ ok: true });
    }
    if (!body.email || !body.password)
      throw new Error("Informe seu e-mail e senha.");
    const { error } = await client.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });
    if (error)
      throw new Error("Não foi possível entrar. Confira seu e-mail e senha.");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
