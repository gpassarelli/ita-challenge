import { NextResponse } from "next/server";
import { z } from "zod";
import { adminClient, requireUser } from "@/lib/server/supabase";
import { errorResponse } from "@/lib/server/http";
export async function GET(request: Request) {
  try {
    await requireUser();
    const id = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get("companyId"));
    const { data, error } = await adminClient()
      .from("score_history")
      .select("id,evaluated_at,payload")
      .eq("company_id", id)
      .order("evaluated_at", { ascending: false })
      .limit(30);
    if (error)
      throw new Error("Não foi possível consultar o histórico de avaliações.");
    return NextResponse.json({ history: data });
  } catch (e) {
    return errorResponse(e);
  }
}
