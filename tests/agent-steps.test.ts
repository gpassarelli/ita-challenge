import { analyzeCompany } from "./run-analysis";
import { beforeEach, expect, it, vi } from "vitest";
import { actor, company, emptyWorkspace, revision, uid } from "./fixtures";
import {
  cancelAgentRun,
  queueAgentRun,
} from "../src/lib/domain/agent-run-mutations";
import type { Workspace } from "../src/lib/domain/types";

const mock = vi.hoisted(() => ({
  read: vi.fn(),
  mutate: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("../src/lib/server/store", () => ({
  readWorkspace: mock.read,
  readAgentRun: async (id: string) =>
    structuredClone(state.runs.find((r) => r.id === id) ?? null),
  mutateWorkspace: mock.mutate,
}));
vi.mock("../src/lib/server/agents", () => ({
  configuredAgent: () => ({
    model: "test",
    promptVersion: "test",
    execute: mock.execute,
  }),
}));
vi.mock("../src/lib/server/agent-store", () => ({
  mutateAgentWorkspace: (
    actor: string,
    _runId: string,
    _companyId: string | null,
    fn: (state: Workspace) => unknown,
  ) => mock.mutate(actor, fn),
}));
import {
  prepareCompany,
  beginGeneration,
  generateCompany,
  recordGeneration,
  saveCompany,
  claimRun,
  failCompany,
  failRun,
  finishRun,
} from "../src/lib/server/agent-steps";

let state: Workspace;
beforeEach(() => {
  vi.resetAllMocks();
  state = emptyWorkspace();
  mock.read.mockImplementation(async () => structuredClone(state));
  mock.mutate.mockImplementation(async (_actor, fn) => {
    const copy = structuredClone(state);
    const result = await fn(copy);
    state = copy;
    return { state, result };
  });
  mock.execute.mockResolvedValue({
    type: "data",
    changes: [],
    message: null,
    originalMessage: null,
    explanation: "Sem alterações",
    warnings: [],
  });
});

function setup() {
  const c = company(state);
  const id = uid();
  queueAgentRun(state, actor, {
    id,
    companyIds: [c.id],
    agent: "signals",
    productId: null,
    contactId: null,
    channel: "E-mail",
  });
  return { c, id };
}

it("bloqueia antes da chamada ao modelo e registra orientação acionável", async () => {
  const { c, id } = setup();
  state.revisions.push(revision(c));
  await analyzeCompany(id, c.id);
  expect(mock.execute).not.toHaveBeenCalled();
  expect(state.revisions).toHaveLength(1);
  expect(state.runs[0].items[0]).toMatchObject({
    status: "failed",
    error: expect.stringContaining("Aprove ou recuse"),
  });
});

it("revalida pendências antes de gerar depois da preparação", async () => {
  const { c, id } = setup();
  const prepared = await prepareCompany(id, c.id);
  state.revisions.push(revision(c));
  await expect(beginGeneration(prepared!, 1)).rejects.toThrow(
    "Aprove ou recuse",
  );
  expect(mock.execute).not.toHaveBeenCalled();
});

it("não salva proposta duplicada se surgir pendência durante a geração", async () => {
  const { c, id } = setup();
  mock.execute.mockImplementation(async () => {
    state.revisions.push(revision(c));
    return {
      type: "data",
      changes: [],
      message: null,
      originalMessage: null,
      explanation: "Proposta",
      warnings: [],
    };
  });
  await analyzeCompany(id, c.id);
  expect(mock.execute).toHaveBeenCalledOnce();
  expect(state.revisions).toHaveLength(1);
  expect(state.runs[0].items[0].status).toBe("failed");
});

it("salva uma única revisão e não repete item concluído", async () => {
  const { c, id } = setup();
  await analyzeCompany(id, c.id);
  await analyzeCompany(id, c.id);
  expect(mock.execute).toHaveBeenCalledOnce();
  expect(state.revisions).toHaveLength(1);
  expect(state.runs[0].items[0]).toMatchObject({
    status: "completed",
    revisionId: state.revisions[0].id,
  });
});

it("não inicia execução cancelada nem permite que finalizadores alterem o cancelamento", async () => {
  const { c, id } = setup();
  cancelAgentRun(state, actor, id);
  expect(await claimRun(id, "late-workflow")).toBeNull();
  await analyzeCompany(id, c.id);
  await failCompany(id, c.id);
  await failRun(id);
  await finishRun(id);
  expect(mock.execute).not.toHaveBeenCalled();
  expect(state.runs[0].status).toBe("cancelled");
  expect(state.runs[0].items[0].status).toBe("cancelled");
});

it("descarta resposta recebida depois de cancelar e fecha as etapas", async () => {
  const { c, id } = setup();
  mock.execute.mockImplementation(async () => {
    cancelAgentRun(state, actor, id);
    return {
      type: "data",
      changes: [],
      explanation: "Resposta tardia",
      warnings: [],
    };
  });
  await analyzeCompany(id, c.id);
  expect(state.revisions).toHaveLength(0);
  expect(state.runs[0].items[0]).toMatchObject({
    status: "cancelled",
    finishedAt: expect.any(String),
  });
  expect(state.runs[0].items[0].steps?.at(-1)?.status).toBe("cancelled");
});

it("aborta a requisição ao modelo quando outra instância cancela o lote", async () => {
  vi.useFakeTimers();
  try {
    const { c, id } = setup();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    mock.execute.mockImplementation(
      (_context, _model, _progress, signal: AbortSignal) => {
        started();
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
    );
    const work = analyzeCompany(id, c.id);
    await ready;
    cancelAgentRun(state, actor, id);
    await vi.advanceTimersByTimeAsync(2000);
    await work;
    expect(state.revisions).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("repete a gravação incerta sem gerar novamente nem duplicar revisão", async () => {
  const { c, id } = setup();
  const prepared = (await prepareCompany(id, c.id))!;
  await beginGeneration(prepared, 1);
  const generated = await generateCompany(prepared);
  await recordGeneration(prepared, generated, 1);
  const mutate = mock.mutate.getMockImplementation()!;
  mock.mutate.mockImplementationOnce(async (...args) => {
    await mutate(...args);
    throw new Error("Resposta perdida depois do commit");
  });
  await expect(saveCompany(prepared, generated.revision!)).rejects.toThrow(
    "Resposta perdida",
  );
  await saveCompany(prepared, generated.revision!);
  expect(mock.execute).toHaveBeenCalledOnce();
  expect(state.revisions).toHaveLength(1);
  expect(
    state.audits.filter((a) => a.action === "Análise concluída"),
  ).toHaveLength(1);
});

it("limita a geração a 60 segundos mesmo se o provedor ignorar o sinal", async () => {
  vi.useFakeTimers();
  try {
    const { c, id } = setup();
    const prepared = (await prepareCompany(id, c.id))!;
    await beginGeneration(prepared, 1);
    mock.execute.mockImplementation(() => new Promise(() => {}));
    const work = generateCompany(prepared);
    await vi.advanceTimersByTimeAsync(60000);
    const result = await work;
    expect(result).toMatchObject({
      revision: null,
      retryable: true,
      error: expect.stringContaining("AI_TIMEOUT"),
    });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("não retoma itens nem lotes que já esgotaram as tentativas", async () => {
  const { c, id } = setup();
  await failCompany(id, c.id, "Código: AI_AUTH.");
  expect(await prepareCompany(id, c.id)).toBeNull();
  await finishRun(id);
  expect(await claimRun(id, "late-workflow")).toBeNull();
  expect(state.runs[0].status).toBe("failed");
  expect(mock.execute).not.toHaveBeenCalled();
});

it("registra tokens de uma resposta inválida uma vez e conserva feedback seguro", async () => {
  const { c, id } = setup();
  const prepared = (await prepareCompany(id, c.id))!;
  await beginGeneration(prepared, 1);
  mock.execute.mockRejectedValue({
    name: "AI_NoObjectGeneratedError",
    text: "secret",
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  });
  const generated = await generateCompany(prepared);
  expect(generated).toMatchObject({
    retryable: true,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  });
  expect(generated.feedback).not.toContain("secret");
  await recordGeneration(prepared, generated, 1);
  await recordGeneration(prepared, generated, 1);
  expect(state.runs[0].items[0].usage?.totalTokens).toBe(15);
  expect(state.runs[0].items[0].steps?.at(-1)?.phase).toBe("validating");
});
