import { beforeEach, expect, it, vi } from "vitest";
import { actor, company, emptyWorkspace, run } from "./fixtures";
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/server/supabase", () => ({
  adminClient: () => ({ rpc: mock.rpc }),
}));
import { mutateAgentWorkspace } from "../src/lib/server/agent-store";
beforeEach(() => vi.resetAllMocks());
it("envia somente o item alterado e relê conflitos antes de recalcular", async () => {
  const state = emptyWorkspace();
  const companies = Array.from({ length: 120 }, () => company(state));
  const execution = run(companies[0], {
    status: "running",
    companyIds: companies.map((c) => c.id),
    items: companies.map((c) => ({
      companyId: c.id,
      status: "queued",
      error: null,
      revisionId: null,
    })),
  });
  state.runs.push(execution);
  let commits = 0;
  mock.rpc.mockImplementation((name, args) => ({
    abortSignal: async () => {
      if (name === "read_agent_context")
        return { data: structuredClone(state), error: null, status: 200 };
      expect(name).toBe("commit_agent_patch");
      expect(args.before_run.items).toHaveLength(1);
      expect(args.next_run.items).toHaveLength(1);
      expect(args.next_run.items[0].companyId).toBe(companies[80].id);
      if (++commits === 1) {
        execution.items[0].status = "completed";
        return { data: null, error: { code: "PT409" }, status: 409 };
      }
      return { data: 5, error: null, status: 200 };
    },
  }));
  const result = await mutateAgentWorkspace(
    actor,
    execution.id,
    companies[80].id,
    (snapshot) => {
      snapshot.runs[0].items[80].status = "running";
    },
  );
  expect(result.state.version).toBe(5);
  expect(result.state.runs[0].items[0].status).toBe("completed");
  expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual([
    "read_agent_context",
    "commit_agent_patch",
    "read_agent_context",
    "commit_agent_patch",
  ]);
});
