import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { actor, company, emptyWorkspace, revision, uid } from "./fixtures";
import { queueAgentRun } from "../src/lib/domain/agent-run-mutations";
import type { Workspace } from "../src/lib/domain/types";
const mock = vi.hoisted(() => ({
  read: vi.fn(),
  mutate: vi.fn(),
  generate: vi.fn(),
}));
vi.mock("../src/lib/server/store", () => ({
  readWorkspace: mock.read,
  mutateWorkspace: mock.mutate,
}));
vi.mock("ai", () => ({
  generateText: mock.generate,
  Output: { object: vi.fn() },
}));
vi.mock("@ai-sdk/openai", () => ({ openai: vi.fn() }));
import { analyzeCompany } from "../src/lib/server/agent-steps";
let state: Workspace;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPENAI_MODEL", "test");
  vi.stubEnv("OPENAI_API_KEY", "test");
  state = emptyWorkspace();
  mock.read.mockImplementation(async () => structuredClone(state));
  mock.mutate.mockImplementation(async (_actor, fn) => {
    const copy = structuredClone(state);
    const result = await fn(copy);
    state = copy;
    return { state, result };
  });
  mock.generate.mockResolvedValue({
    output: { changes: [], explanation: "Sem alterações", warnings: [] },
  });
});
afterEach(() => vi.unstubAllEnvs());
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
  expect(mock.generate).not.toHaveBeenCalled();
  expect(state.revisions).toHaveLength(1);
  expect(state.runs[0].items[0]).toMatchObject({
    status: "failed",
    error: expect.stringContaining("Aprove ou recuse"),
  });
});
it("não salva proposta duplicada se surgir pendência durante a geração", async () => {
  const { c, id } = setup();
  mock.generate.mockImplementation(async () => {
    state.revisions.push(revision(c));
    return { output: { changes: [], explanation: "Proposta", warnings: [] } };
  });
  await analyzeCompany(id, c.id);
  expect(mock.generate).toHaveBeenCalledOnce();
  expect(state.revisions).toHaveLength(1);
  expect(state.runs[0].items[0].status).toBe("failed");
});
it("salva uma única revisão e não repete item concluído", async () => {
  const { c, id } = setup();
  await analyzeCompany(id, c.id);
  await analyzeCompany(id, c.id);
  expect(mock.generate).toHaveBeenCalledOnce();
  expect(state.revisions).toHaveLength(1);
  expect(state.runs[0].items[0]).toMatchObject({
    status: "completed",
    revisionId: state.revisions[0].id,
  });
});
