import "server-only";
import { adminClient } from "./supabase";
import type { AgentRun, Workspace } from "@/lib/domain/types";
import { needsRecalculation, recalculate } from "@/lib/domain/scoring";
import { activeWorkspace } from "@/lib/domain/workspace";
import { workspacePatch } from "@/lib/domain/workspace-patch";
import { databaseError } from "./diagnostics";
export async function readWorkspace(): Promise<Workspace> {
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    const { data, error, status } = await adminClient()
      .rpc("read_workspace")
      .abortSignal(AbortSignal.timeout(20000));
    console.info(
      "database_operation",
      JSON.stringify({
        operation: "read_workspace",
        durationMs: Date.now() - started,
        attempt: attempt + 1,
        code: error?.code,
      }),
    );
    if (!error) return activeWorkspace(data as Workspace);
    const failure = databaseError("read_workspace", error, status);
    console.error("read_workspace", {
      code: failure.code,
      status,
      attempt: attempt + 1,
    });
    if (!failure.retryable || attempt >= 1) throw failure;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
export async function mutateWorkspace<T>(
  actor: string,
  fn: (state: Workspace) => T | Promise<T>,
): Promise<{ state: Workspace; result: T }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await readWorkspace();
    const before = structuredClone(state);
    const previous = state.version;
    const result = await fn(state);
    // Progress, reviews and audit entries do not change scoring inputs.
    // Preserve the daily/version refresh, and recalculate after business edits.
    if (
      needsRecalculation(state) ||
      JSON.stringify(before.records) !== JSON.stringify(state.records) ||
      JSON.stringify(before.rulesets) !== JSON.stringify(state.rulesets)
    )
      recalculate(state);
    const patch = workspacePatch(before, state);
    if (!Object.keys(patch).length) return { state, result };
    const started = Date.now();
    const { data, error, status } = await adminClient()
      .rpc("commit_workspace_patch", {
        expected_version: previous,
        actor_id: actor,
        patch,
      })
      .abortSignal(AbortSignal.timeout(20000));
    console.info(
      "database_operation",
      JSON.stringify({
        operation: "commit_workspace_patch",
        durationMs: Date.now() - started,
        attempt: attempt + 1,
        code: error?.code,
        runId: patch.runs?.length === 1 ? patch.runs[0].id : undefined,
      }),
    );
    if (
      error?.code === "PT409" ||
      error?.code === "40001" ||
      error?.message.includes("WORKSPACE_CONFLICT")
    ) {
      // Fresh reads must happen between attempts; jitter avoids synchronized
      // progress writers repeatedly colliding with each other.
      if (attempt < 3)
        await new Promise((resolve) =>
          setTimeout(resolve, 100 * 2 ** attempt + Math.random() * 150),
        );
      continue;
    }
    if (error) {
      console.error("commit_workspace_patch", error.code);
      // A lost response cannot prove that the transaction was not committed.
      throw databaseError("commit_workspace_patch", error, status);
    }
    state.version = Number(data);
    return { state, result };
  }
  throw new Error(
    "A base recebeu outras alterações. Atualize e tente novamente.",
  );
}

// A cancellation poll should never aggregate the entire business workspace.
export async function readAgentRun(runId: string): Promise<AgentRun | null> {
  const started = Date.now();
  const { data, error, status } = await adminClient()
    .rpc("read_agent_run", { run_id: runId })
    .abortSignal(AbortSignal.timeout(20000));
  console.info(
    "database_operation",
    JSON.stringify({
      operation: "read_agent_run",
      durationMs: Date.now() - started,
      attempt: 1,
      runId,
      code: error?.code,
    }),
  );
  if (error) throw databaseError("read_agent_run", error, status);
  return data as AgentRun | null;
}
