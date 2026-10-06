import "server-only";
import { adminClient } from "./supabase";
import type { Workspace } from "@/lib/domain/types";
import { recalculate } from "@/lib/domain/scoring";
import { activeWorkspace } from "@/lib/domain/workspace";
export async function readWorkspace(): Promise<Workspace> {
  const { data, error } = await adminClient().rpc("read_workspace");
  if (error) {
    console.error("read_workspace", error.code);
    throw new Error(
      "Não foi possível ler a base. Verifique a conexão e aplique as migrações do banco.",
    );
  }
  return activeWorkspace(data as Workspace);
}
export async function mutateWorkspace<T>(
  actor: string,
  fn: (state: Workspace) => T | Promise<T>,
): Promise<{ state: Workspace; result: T }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await readWorkspace();
    const previous = state.version;
    const result = await fn(state);
    recalculate(state);
    const { data, error } = await adminClient().rpc("commit_workspace", {
      expected_version: previous,
      actor_id: actor,
      document: state,
    });
    if (
      error?.code === "40001" ||
      error?.message.includes("WORKSPACE_CONFLICT")
    )
      continue;
    if (error) {
      console.error("commit_workspace", error.code);
      throw new Error(
        "Não foi possível salvar a alteração. Nenhum dado foi aplicado.",
      );
    }
    state.version = Number(data);
    return { state, result };
  }
  throw new Error(
    "A base recebeu outras alterações. Atualize e tente novamente.",
  );
}
