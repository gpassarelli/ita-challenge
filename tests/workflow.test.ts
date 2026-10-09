import { it, expect, vi, beforeEach } from "vitest";
const mock = vi.hoisted(() => ({
  active: 0,
  peak: 0,
  done: [] as string[],
  failures: [] as string[],
  finish: vi.fn(),
  claim: vi.fn(),
  isActive: vi.fn(),
  failRun: vi.fn(),
  generate: vi.fn(),
  save: vi.fn(),
  record: vi.fn(),
  begin: vi.fn(),
  settings: vi.fn(),
  cooldown: vi.fn(),
  sleep: vi.fn(),
}));
vi.mock("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "workflow-test" }),
  sleep: mock.sleep,
}));
vi.mock("@/lib/server/agent-steps", () => ({
  claimRun: mock.claim,
  executionSettings: mock.settings,
  generationCooldown: mock.cooldown,
  isRunActive: mock.isActive,
  prepareCompany: async (runId: string, companyId: string) => ({
    runId,
    companyId,
  }),
  beginGeneration: mock.begin,
  generateCompany: mock.generate,
  recordGeneration: mock.record,
  saveCompany: mock.save,
  failCompany: async (_run: string, id: string) => {
    mock.failures.push(id);
  },
  finishRun: mock.finish,
  failRun: mock.failRun,
}));
import { runAgents } from "../src/workflows/agents";
beforeEach(() => {
  vi.resetAllMocks();
  mock.settings.mockResolvedValue({ concurrency: 3, timeoutMs: 60000 });
  mock.cooldown.mockResolvedValue(0);
  mock.active = 0;
  mock.peak = 0;
  mock.done = [];
  mock.failures = [];
  mock.isActive.mockResolvedValue(true);
  mock.begin.mockResolvedValue(true);
  mock.generate.mockImplementation(
    async ({ companyId }: { companyId: string }) => {
      mock.active++;
      mock.peak = Math.max(mock.peak, mock.active);
      await new Promise((resolve) => setTimeout(resolve, 3));
      mock.active--;
      return companyId === "4"
        ? { error: "AI_AUTH", retryable: false }
        : { revision: { id: companyId } };
    },
  );
  mock.save.mockImplementation(async ({ companyId }: { companyId: string }) => {
    mock.done.push(companyId);
  });
});
it("registra falha do lote se não conseguir iniciar o workflow", async () => {
  mock.claim.mockRejectedValue(new Error("base indisponível"));
  await expect(runAgents("batch-test")).rejects.toThrow("base indisponível");
  expect(mock.failRun).toHaveBeenCalledWith(
    "batch-test",
    expect.stringContaining("AGENT_ERROR"),
  );
  expect(mock.done).toEqual([]);
});
it("executa no máximo três empresas simultâneas, isola falhas e conclui o lote", async () => {
  mock.claim.mockResolvedValue(["1", "2", "3", "4", "5", "6", "7", "8"]);
  await runAgents("batch-test");
  expect(mock.peak).toBe(3);
  expect(mock.active).toBe(0);
  expect(mock.done).toHaveLength(7);
  expect(mock.failures).toEqual(["4"]);
  expect(mock.finish).toHaveBeenCalledOnce();
});
it("não executa um lote já assumido por outro workflow", async () => {
  mock.claim.mockResolvedValue(null);
  await runAgents("batch-test");
  expect(mock.done).toEqual([]);
  expect(mock.finish).not.toHaveBeenCalled();
});
it("não agenda o próximo lote depois do cancelamento", async () => {
  mock.claim.mockResolvedValue(["1", "2", "3", "4", "5"]);
  mock.isActive
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockResolvedValue(false);
  await runAgents("batch-test");
  expect(mock.done).toEqual(["1", "2", "3"]);
  expect(mock.finish).not.toHaveBeenCalled();
});
it("repete somente uma vez erros temporários do modelo", async () => {
  mock.claim.mockResolvedValue(["1"]);
  mock.generate.mockResolvedValue({ error: "AI_TIMEOUT", retryable: true });
  await runAgents("batch-test");
  expect(mock.generate).toHaveBeenCalledTimes(2);
  expect(mock.failures).toEqual(["1"]);
  expect(mock.save).not.toHaveBeenCalled();
});
it("não repete geração se a gravação ou o progresso falhar", async () => {
  mock.claim.mockResolvedValue(["1"]);
  mock.record.mockRejectedValue(new Error("database timeout"));
  await runAgents("batch-test");
  expect(mock.generate).toHaveBeenCalledOnce();
  expect(mock.failures).toEqual(["1"]);
});
it("não repete erros permanentes e mantém o motivo final", async () => {
  mock.claim.mockResolvedValue(["4"]);
  await runAgents("batch-test");
  expect(mock.generate).toHaveBeenCalledOnce();
  expect(mock.failures).toEqual(["4"]);
});

it("processa 120 empresas com oito vagas e resultados independentes", async () => {
  mock.settings.mockResolvedValue({ concurrency: 8, timeoutMs: 60000 });
  mock.claim.mockResolvedValue(
    Array.from({ length: 120 }, (_, i) => String(i + 1)),
  );
  await runAgents("batch-test");
  expect(mock.peak).toBe(8);
  expect(mock.done).toHaveLength(119);
  expect(mock.failures).toEqual(["4"]);
});

it("reabastece a vaga livre sem esperar a empresa lenta", async () => {
  mock.settings.mockResolvedValue({ concurrency: 2, timeoutMs: 60000 });
  mock.claim.mockResolvedValue(["slow", "fast", "next"]);
  let release!: () => void;
  const slow = new Promise<void>((resolve) => {
    release = resolve;
  });
  let nextStarted!: () => void;
  const ready = new Promise<void>((resolve) => {
    nextStarted = resolve;
  });
  mock.generate.mockImplementation(async ({ companyId }) => {
    if (companyId === "slow") await slow;
    if (companyId === "next") nextStarted();
    return { revision: { id: companyId } };
  });
  const work = runAgents("batch-test");
  await ready;
  expect(mock.done).not.toContain("slow");
  release();
  await work;
  expect(mock.done).toHaveLength(3);
});

it("envia feedback na única tentativa corretiva e respeita o cooldown", async () => {
  mock.claim.mockResolvedValue(["1"]);
  mock.cooldown.mockResolvedValueOnce(7000).mockResolvedValue(0);
  mock.generate
    .mockResolvedValueOnce({
      error: "AI_OUTPUT",
      retryable: true,
      feedback: "Campo growth: use Baixo, Médio, Alto.",
      retryDelayMs: 1200,
    })
    .mockResolvedValueOnce({ revision: { id: "1" } });
  await runAgents("batch-test");
  expect(mock.sleep.mock.calls.map(([ms]) => ms)).toEqual([7000, 1200]);
  expect(mock.generate).toHaveBeenNthCalledWith(
    2,
    expect.anything(),
    2,
    "Campo growth: use Baixo, Médio, Alto.",
  );
  expect(mock.done).toEqual(["1"]);
});
