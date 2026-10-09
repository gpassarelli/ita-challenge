import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { actor, company, emptyWorkspace, revision, uid } from "./fixtures";
import type { Workspace } from "../src/lib/domain/types";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), start: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("workflow/api", () => ({ start: mock.start }));
vi.mock("../src/workflows/agents", () => ({ runAgents: vi.fn() }));
vi.mock("../src/lib/server/supabase", () => ({
  requireUser: async () => ({ id: "00000000-0000-4000-8000-000000000001" }),
  adminClient: () => ({ rpc: mock.rpc }),
}));
import { POST } from "../src/app/api/agents/route";
let state: Workspace;
let beforeCommit: (() => boolean) | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPENAI_MODEL", "test");
  vi.stubEnv("OPENAI_API_KEY", "test");
  state = emptyWorkspace();
  beforeCommit = undefined;
  mock.rpc.mockImplementation((operation, args) => {
    if (operation === "read_workspace")
      return {
        abortSignal: async () => ({
          data: structuredClone(state),
          error: null,
        }),
      };
    if (beforeCommit?.())
      return {
        abortSignal: async () => ({
          error: { code: "40001", message: "WORKSPACE_CONFLICT" },
        }),
      };
    for (const [collection, entries] of Object.entries(args.patch)) {
      const target = state[collection as keyof Workspace] as { id: string }[];
      for (const entry of entries as { id: string }[]) {
        const index = target.findIndex((e) => e.id === entry.id);
        if (index < 0) target.push(structuredClone(entry));
        else target[index] = structuredClone(entry);
      }
    }
    state.version++;
    return { abortSignal: async () => ({ data: state.version, error: null }) };
  });
});
afterEach(() => vi.unstubAllEnvs());
function post(companyIds: string[], id = uid()) {
  return POST(
    new Request("http://localhost/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        agent: "signals",
        companyIds,
        productId: null,
        contactId: null,
        channel: "E-mail",
      }),
    }),
  );
}
it("API exclui pendências e devolve o mesmo lote em replays", async () => {
  const a = company(state),
    b = company(state),
    pending = revision(a);
  state.revisions.push(pending);
  const id = uid();
  const response = await post([a.id, b.id, b.id], id);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    runId: id,
    skippedCompanies: [{ companyId: a.id, revisionIds: [pending.id] }],
  });
  expect(state.runs[0].companyIds).toEqual([b.id]);
  state.runs[0].workflowId = "claimed";
  state.revisions[0].status = "rejected";
  const replay = await post([a.id, b.id], id);
  expect(await replay.json()).toMatchObject({
    runId: id,
    skippedCompanies: [{ companyId: a.id, revisionIds: [pending.id] }],
  });
  expect(mock.start).toHaveBeenCalledOnce();
  expect(state.runs).toHaveLength(1);
});
it("API não inicia workflow quando todas as empresas estão bloqueadas", async () => {
  const c = company(state);
  state.revisions.push(revision(c));
  const response = await post([c.id]);
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain("Todas as empresas");
  expect(state.runs).toHaveLength(0);
  expect(mock.start).not.toHaveBeenCalled();
});
it("recalcula elegibilidade quando a gravação concorre com uma nova revisão", async () => {
  const a = company(state),
    b = company(state);
  let commits = 0;
  beforeCommit = () => {
    if (commits++ > 0) return false;
    state.revisions.push(revision(a));
    state.version++;
    return true;
  };
  const response = await post([a.id, b.id]);
  expect(response.status).toBe(200);
  expect(state.runs[0].companyIds).toEqual([b.id]);
  expect(state.runs[0].requestedBy).toBe(actor);
  expect(mock.start).toHaveBeenCalledOnce();
});
