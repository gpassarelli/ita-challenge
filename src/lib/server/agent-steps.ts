import { assertSignalsEligible } from "@/lib/domain/agent-runs";
import { agentContext } from "@/lib/domain/agents";
import { configuredAgent } from "./agents";
import {
  isoNow,
  uid,
  type Revision,
  type AgentPhase,
  type AgentRun,
} from "@/lib/domain/types";
import { agentErrorMessage } from "./diagnostics";
import { audit } from "@/lib/domain/mutations";
import { readAgentRun } from "./store";
import { mutateAgentWorkspace } from "./agent-store";
import { agentExecutionSettings } from "./agent-config";
import { retryPolicy } from "./agent-retry";
import {
  errorUsage,
  type AgentContext,
  type AgentUsage,
} from "./agents/shared";

export async function claimRun(runId: string, workflowId: string) {
  "use step";
  const run = await readAgentRun(runId);
  if (!run) throw new Error("Execução não encontrada.");
  const { result } = await mutateAgentWorkspace(
    run.requestedBy,
    runId,
    null,
    (state) => {
      const current = state.runs.find((r) => r.id === runId)!;
      if (current.workflowId && current.workflowId !== workflowId) return null;
      if (current.status !== "queued" && current.status !== "running")
        return null;
      current.workflowId = workflowId;
      current.status = "running";
      current.startedAt ??= isoNow();
      current.settings ??= agentExecutionSettings();
      return current.companyIds;
    },
  );
  return result;
}
export async function isRunActive(runId: string) {
  "use step";
  const run = await readAgentRun(runId);
  return run?.status === "queued" || run?.status === "running";
}
export async function executionSettings(runId: string) {
  "use step";
  return (await readAgentRun(runId))?.settings ?? agentExecutionSettings();
}
export async function generationCooldown(runId: string) {
  "use step";
  const run = await readAgentRun(runId);
  return run?.rateLimitUntil
    ? Math.max(0, Date.parse(run.rateLimitUntil) - Date.now())
    : 0;
}
function closeStep(
  item: AgentRun["items"][number],
  error?: string,
  at = isoNow(),
) {
  const step = item.steps?.at(-1);
  if (step?.status === "running") {
    step.status = error ? "failed" : "completed";
    step.finishedAt = at;
    if (error) step.error = error;
  }
}
function phase(
  item: AgentRun["items"][number],
  name: AgentPhase,
  attempt: number,
  at = isoNow(),
) {
  closeStep(item);
  item.steps ??= [];
  item.steps.push({ phase: name, attempt, startedAt: at, status: "running" });
}
function stopped(run: AgentRun, companyId: string) {
  const item = run.items.find((i) => i.companyId === companyId)!;
  return (
    (run.status !== "queued" && run.status !== "running") ||
    item.status === "failed" ||
    item.status === "completed" ||
    item.status === "cancelled"
  );
}
export type PreparedAnalysis = {
  runId: string;
  companyId: string;
  actor: string;
  agent: AgentRun["agent"];
  model: string;
  promptVersion: string;
  context: AgentContext;
  revisionId: string;
  timeoutMs: number;
};
export type GeneratedAnalysis = {
  revision: Revision | null;
  error: string | null;
  retryable: boolean;
  cancelled?: boolean;
  validatingAt?: string;
  finishedAt: string;
  feedback?: string;
  retryDelayMs?: number;
  rateLimitUntil?: string;
  usage?: AgentUsage;
};

export async function prepareCompany(
  runId: string,
  companyId: string,
): Promise<PreparedAnalysis | null> {
  "use step";
  const run = await readAgentRun(runId);
  if (!run) throw new Error("Execução não encontrada.");
  if (stopped(run, companyId)) return null;
  const { result } = await mutateAgentWorkspace(
    run.requestedBy,
    runId,
    companyId,
    (state) => {
      const current = state.runs.find((r) => r.id === runId)!;
      if (stopped(current, companyId)) return null;
      const item = current.items.find((i) => i.companyId === companyId)!;
      // Replays after an uncertain commit do not create another preparing step.
      if (
        item.steps?.at(-1)?.phase !== "preparing" ||
        item.steps.at(-1)?.status !== "running"
      )
        phase(item, "preparing", (item.attempts ?? 0) + 1);
      item.status = "running";
      item.startedAt ??= isoNow();
      assertSignalsEligible(state, current, companyId);
      const context = agentContext(state, current, companyId);
      const { model, promptVersion } = configuredAgent(current.agent);
      item.input = context.input;
      item.model = model;
      item.promptVersion = promptVersion;
      return {
        runId,
        companyId,
        actor: run.requestedBy,
        agent: current.agent,
        model,
        promptVersion,
        context,
        revisionId: uid(),
        timeoutMs:
          current.settings?.timeoutMs ?? agentExecutionSettings().timeoutMs,
      };
    },
  );
  return result;
}
prepareCompany.maxRetries = 1;

export async function beginGeneration(
  prepared: PreparedAnalysis,
  attempt: number,
) {
  "use step";
  const { result } = await mutateAgentWorkspace(
    prepared.actor,
    prepared.runId,
    prepared.companyId,
    (state) => {
      const run = state.runs.find((r) => r.id === prepared.runId)!;
      if (stopped(run, prepared.companyId)) return false;
      assertSignalsEligible(state, run, prepared.companyId);
      const item = run.items.find((i) => i.companyId === prepared.companyId)!;
      if (
        item.steps?.at(-1)?.phase === "generating" &&
        item.steps.at(-1)?.attempt === attempt &&
        item.steps.at(-1)?.status === "running"
      )
        return true;
      phase(item, "generating", attempt);
      item.attempts = attempt;
      item.error = null;
      return true;
    },
  );
  return result;
}
beginGeneration.maxRetries = 1;

// This durable step never writes UI progress to the database. Its successful
// return is checkpointed before any saving step can fail or retry.
export async function generateCompany(
  prepared: PreparedAnalysis,
  attempt = 1,
  feedback?: string,
): Promise<GeneratedAnalysis> {
  "use step";
  const { runId, companyId, actor, context, model, promptVersion } = prepared;
  const controller = new AbortController();
  let checking = false;
  let validatingAt: string | undefined;
  let usage: AgentUsage | undefined;
  const started = Date.now();
  const timer = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      if ((await readAgentRun(runId))?.status === "cancelled")
        controller.abort(new Error("RUN_CANCELLED"));
    } catch {
      /* A transient read failure must not fail the AI request. */
    } finally {
      checking = false;
    }
  }, 2000);
  const timeout = setTimeout(
    () => controller.abort(new DOMException("AI timeout", "TimeoutError")),
    prepared.timeoutMs,
  );
  let onAbort: () => void = () => {};
  try {
    if ((await readAgentRun(runId))?.status === "cancelled")
      return {
        revision: null,
        error: null,
        retryable: false,
        cancelled: true,
        finishedAt: isoNow(),
      };
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(controller.signal.reason);
      if (controller.signal.aborted) onAbort();
      else controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    const result = await Promise.race([
      configuredAgent(prepared.agent).execute(
        context,
        model,
        async () => {
          validatingAt = isoNow();
        },
        controller.signal,
        {
          timeoutMs: prepared.timeoutMs,
          feedback,
          onUsage: (value) => {
            usage = value;
          },
        },
      ),
      aborted,
    ]);
    const finishedAt = isoNow();
    console.info("agent_generation", {
      operation: "generate_company",
      runId,
      companyId,
      attempt,
      durationMs: Date.now() - started,
      code: "OK",
      usage,
    });
    return {
      revision: {
        id: prepared.revisionId,
        companyId,
        companyVersion: context.company.version,
        runId,
        status: "pending",
        input: context.input,
        model,
        promptVersion,
        createdBy: actor,
        createdAt: finishedAt,
        reviewedBy: null,
        reviewedAt: null,
        reason: "",
        edited: false,
        ...result,
      },
      error: null,
      retryable: false,
      validatingAt,
      finishedAt,
      usage,
    };
  } catch (error) {
    const cancelled =
      controller.signal.aborted &&
      (controller.signal.reason as Error)?.message === "RUN_CANCELLED";
    const policy = retryPolicy(error);
    usage ??= errorUsage(error);
    if (policy.feedback) validatingAt ??= isoNow();
    const message = cancelled
      ? null
      : agentErrorMessage(error) +
        (policy.feedback?.startsWith("Campo ") ? ` ${policy.feedback}` : "");
    console.info("agent_generation", {
      runId,
      companyId,
      operation: "generate_company",
      attempt,
      durationMs: Date.now() - started,
      code: message?.match(/Código: ([A-Z_]+)/)?.[1],
      cancelled,
      retryable: policy.retryable,
      usage,
    });
    return {
      revision: null,
      error: message,
      retryable: !cancelled && policy.retryable,
      cancelled,
      validatingAt,
      finishedAt: isoNow(),
      feedback: policy.feedback,
      retryDelayMs: policy.retryDelayMs,
      rateLimitUntil: policy.rateLimited
        ? new Date(Date.now() + policy.retryDelayMs).toISOString()
        : undefined,
      usage,
    };
  } finally {
    clearInterval(timer);
    clearTimeout(timeout);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
generateCompany.maxRetries = 0;

export async function recordGeneration(
  prepared: PreparedAnalysis,
  generated: GeneratedAnalysis,
  attempt: number,
) {
  "use step";
  await mutateAgentWorkspace(
    prepared.actor,
    prepared.runId,
    prepared.companyId,
    (state) => {
      const run = state.runs.find((r) => r.id === prepared.runId)!;
      if (stopped(run, prepared.companyId) || generated.cancelled) return;
      const item = run.items.find((i) => i.companyId === prepared.companyId)!;
      const latest = item.steps?.at(-1);
      if (
        latest?.attempt === attempt &&
        latest.finishedAt === generated.finishedAt &&
        item.error === generated.error
      )
        return;
      if (
        item.steps?.at(-1)?.phase === "saving" &&
        item.steps.at(-1)?.status === "running"
      )
        return;
      closeStep(
        item,
        generated.validatingAt ? undefined : (generated.error ?? undefined),
        generated.validatingAt ?? generated.finishedAt,
      );
      if (generated.validatingAt) {
        phase(item, "validating", attempt, generated.validatingAt);
        closeStep(item, generated.error ?? undefined, generated.finishedAt);
      }
      item.error = generated.error;
      if (generated.usage) {
        const previous = item.usage ?? {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        };
        item.usage = {
          inputTokens: previous.inputTokens + generated.usage.inputTokens,
          outputTokens: previous.outputTokens + generated.usage.outputTokens,
          totalTokens: previous.totalTokens + generated.usage.totalTokens,
        };
      }
      if (
        generated.rateLimitUntil &&
        (!run.rateLimitUntil || generated.rateLimitUntil > run.rateLimitUntil)
      )
        run.rateLimitUntil = generated.rateLimitUntil;
      if (generated.revision)
        phase(item, "saving", attempt, generated.finishedAt);
    },
  );
}
recordGeneration.maxRetries = 1;

export async function saveCompany(
  prepared: PreparedAnalysis,
  revision: Revision,
) {
  "use step";
  await mutateAgentWorkspace(
    prepared.actor,
    prepared.runId,
    prepared.companyId,
    (state) => {
      const run = state.runs.find((r) => r.id === prepared.runId)!;
      if (stopped(run, prepared.companyId)) return;
      const existing = state.revisions.find(
        (r) =>
          r.id === revision.id ||
          (r.runId === run.id && r.companyId === prepared.companyId),
      );
      if (!existing) {
        assertSignalsEligible(state, run, prepared.companyId);
        state.revisions.push(revision);
        audit(state, prepared.actor, "Análise concluída", revision.id, null, {
          runId: run.id,
          companyId: prepared.companyId,
          type: revision.type,
        });
      }
      const item = run.items.find((i) => i.companyId === prepared.companyId)!;
      closeStep(item);
      item.status = "completed";
      item.revisionId = existing?.id ?? revision.id;
      item.error = null;
      item.finishedAt = isoNow();
    },
  );
}
saveCompany.maxRetries = 1;

export async function failCompany(
  runId: string,
  companyId: string,
  message?: string,
) {
  "use step";
  const run = await readAgentRun(runId);
  if (!run) return;
  await mutateAgentWorkspace(run.requestedBy, runId, companyId, (state) => {
    const current = state.runs.find((r) => r.id === runId)!;
    if (stopped(current, companyId)) return;
    const item = current.items.find((i) => i.companyId === companyId)!;
    if (!item.steps?.length) phase(item, "preparing", (item.attempts ?? 0) + 1);
    item.status = "failed";
    item.finishedAt = isoNow();
    item.error =
      message ??
      item.error ??
      "A execução falhou antes de concluir a etapa. Consulte os logs pelo ID da execução.";
    closeStep(item, item.error);
  });
}
failCompany.maxRetries = 1;
export async function finishRun(runId: string) {
  "use step";
  const run = await readAgentRun(runId);
  if (!run) return;
  await mutateAgentWorkspace(run.requestedBy, runId, null, (state) => {
    const current = state.runs.find((r) => r.id === runId)!;
    if (current.status === "cancelled") return;
    if (
      current.items.some((i) => i.status === "queued" || i.status === "running")
    )
      throw new Error("Ainda existem empresas em processamento.");
    current.finishedAt = isoNow();
    current.status = current.items.every((i) => i.status === "failed")
      ? "failed"
      : "completed";
    console.info("agent_batch", {
      runId,
      companyCount: current.items.length,
      concurrency: current.settings?.concurrency,
      durationMs:
        Date.parse(current.finishedAt) - Date.parse(current.requestedAt),
      completed: current.items.filter((item) => item.status === "completed")
        .length,
      failed: current.items.filter((item) => item.status === "failed").length,
      attempts: current.items.reduce(
        (total, item) => total + (item.attempts ?? 0),
        0,
      ),
      totalTokens: current.items.reduce(
        (total, item) => total + (item.usage?.totalTokens ?? 0),
        0,
      ),
    });
  });
}
finishRun.maxRetries = 1;
export async function failRun(runId: string, message?: string) {
  "use step";
  const run = await readAgentRun(runId);
  if (!run) return;
  await mutateAgentWorkspace(run.requestedBy, runId, null, (state) => {
    const current = state.runs.find((r) => r.id === runId)!;
    if (current.status !== "queued" && current.status !== "running") return;
    current.status = "failed";
    current.finishedAt = isoNow();
    current.error =
      message ??
      "O workflow não conseguiu iniciar ou finalizar a execução. Consulte os logs pelo ID abaixo.";
    for (const item of current.items) {
      if (item.status !== "queued" && item.status !== "running") continue;
      item.status = "failed";
      item.finishedAt = isoNow();
      item.error ??= current.error;
      closeStep(item, item.error);
    }
  });
}
failRun.maxRetries = 1;
