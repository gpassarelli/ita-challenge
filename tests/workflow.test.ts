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
}));
vi.mock("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "workflow-test" }),
}));
vi.mock("@/lib/server/agent-steps", () => ({
  claimRun: mock.claim,
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
  mock.isActive.mockResolvedValueOnce(true).mockResolvedValue(false);
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
