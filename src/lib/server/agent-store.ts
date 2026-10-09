import "server-only";
import { adminClient } from "./supabase";
import { emptyWorkspace, type Workspace } from "@/lib/domain/types";
import { workspacePatch } from "@/lib/domain/workspace-patch";
import { databaseError } from "./diagnostics";

export async function readAgentContext(
  runId: string,
  companyId: string | null,
): Promise<Workspace> {
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    const { data, error, status } = await adminClient()
      .rpc("read_agent_context", { run_id: runId, company_id: companyId })
      .abortSignal(AbortSignal.timeout(20000));
    console.info("database_operation", {
      operation: "read_agent_context",
      runId,
      companyId,
      durationMs: Date.now() - started,
      attempt: attempt + 1,
      code: error?.code,
    });
    if (!error) return { ...emptyWorkspace(), ...data } as Workspace;
    const failure = databaseError("read_agent_context", error, status);
    if (!failure.retryable || attempt >= 1) throw failure;
    await new Promise((resolve) =>
      setTimeout(resolve, 250 + Math.random() * 250),
    );
  }
}

// This snapshot contains one run and, when needed, one company's context.
// The RPC compares only changed items, merging parallel company updates.
export async function mutateAgentWorkspace<T>(
  actor: string,
  runId: string,
  companyId: string | null,
  fn: (state: Workspace) => T | Promise<T>,
): Promise<{ state: Workspace; result: T }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await readAgentContext(runId, companyId);
    const before = structuredClone(state);
    const result = await fn(state);
    const patch = workspacePatch(before, state);
    if (!Object.keys(patch).length) return { state, result };
    if (
      Object.keys(patch).some(
        (key) => !["runs", "revisions", "audits"].includes(key),
      )
    )
      throw new Error("Uma etapa de agente tentou alterar dados comerciais.");
    const beforeRun = before.runs.find((run) => run.id === runId)!;
    const nextRun = state.runs.find((run) => run.id === runId)!;
    const changedItems = nextRun.items.filter(
      (item) =>
        JSON.stringify(item) !==
        JSON.stringify(
          beforeRun.items.find(
            (previous) => previous.companyId === item.companyId,
          ),
        ),
    );
    const changedIds = new Set(changedItems.map((item) => item.companyId));
    const started = Date.now();
    const { data, error, status } = await adminClient()
      .rpc("commit_agent_patch", {
        actor_id: actor,
        run_id: runId,
        before_run: {
          ...beforeRun,
          items: beforeRun.items.filter((item) =>
            changedIds.has(item.companyId),
          ),
        },
        next_run: { ...nextRun, items: changedItems },
        new_revisions: patch.revisions ?? [],
        new_audits: patch.audits ?? [],
      })
      .abortSignal(AbortSignal.timeout(20000));
    console.info("database_operation", {
      operation: "commit_agent_patch",
      runId,
      companyId,
      durationMs: Date.now() - started,
      attempt: attempt + 1,
      code: error?.code,
    });
    if (error?.code === "PT409") {
      if (attempt < 3)
        await new Promise((resolve) =>
          setTimeout(resolve, 50 * 2 ** attempt + Math.random() * 100),
        );
      continue;
    }
    if (error) throw databaseError("commit_agent_patch", error, status);
    state.version = Number(data);
    return { state, result };
  }
  throw new Error("O progresso recebeu outras alterações. Tente novamente.");
}
