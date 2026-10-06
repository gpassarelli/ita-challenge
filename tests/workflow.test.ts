import { it, expect, vi, beforeEach } from "vitest";
const mock = vi.hoisted(() => ({
  active: 0,
  peak: 0,
  done: [] as string[],
  failures: [] as string[],
  finish: vi.fn(),
  claim: vi.fn(),
}));
vi.mock("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "workflow-test" }),
}));
vi.mock("@/lib/server/agent-steps", () => ({
  claimRun: mock.claim,
  analyzeCompany: async (_run: string, id: string) => {
    mock.active++;
    mock.peak = Math.max(mock.peak, mock.active);
    await new Promise((resolve) => setTimeout(resolve, 3));
    mock.active--;
    if (id === "4") throw new Error("Falha simulada");
    mock.done.push(id);
  },
  failCompany: async (_run: string, id: string) => {
    mock.failures.push(id);
  },
  finishRun: mock.finish,
}));
import { runAgents } from "../src/workflows/agents";
beforeEach(() => {
  mock.active = 0;
  mock.peak = 0;
  mock.done = [];
  mock.failures = [];
  mock.finish.mockClear();
  mock.claim.mockReset();
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
