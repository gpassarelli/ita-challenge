import { beforeEach, expect, it, vi } from "vitest";
import { actor, company, emptyWorkspace, revision, uid } from "./fixtures";
import type { Workspace } from "../src/lib/domain/types";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
  getRun: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("workflow/api", () => ({ start: mock.start, getRun: mock.getRun }));
vi.mock("../src/workflows/agents", () => ({ runAgents: vi.fn() }));
vi.mock("../src/lib/server/agents", () => ({ configuredAgent: vi.fn() }));
vi.mock("../src/lib/server/supabase", () => ({
  requireUser: async () => ({ id: "00000000-0000-4000-8000-000000000001" }),
  adminClient: () => ({ rpc: mock.rpc }),
}));
import { POST } from "../src/app/api/agents/route";
import { POST as cancel } from "../src/app/api/agents/cancel/route";

let state: Workspace;
let beforeCommit: (() => boolean) | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  mock.start.mockResolvedValue({ runId: "workflow-test", cancel: vi.fn() });
  mock.getRun.mockReturnValue({ cancel: mock.cancel });
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
    b = company(state);
  const pending = revision(a);
  state.revisions.push(pending);
  const id = uid();
  const response = await post([a.id, b.id, b.id], id);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    runId: id,
    skippedCompanies: [{ companyId: a.id, revisionIds: [pending.id] }],
  });
  expect(state.runs[0].companyIds).toEqual([b.id]);
  expect(mock.start).toHaveBeenCalledOnce();
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
  expect(state.runs[0].skippedCompanies?.[0].companyId).toBe(a.id);
  expect(mock.start).toHaveBeenCalledOnce();
});

it("cancela o workflow e o lote, preserva resultados e permite nova execução", async () => {
  const c = company(state);
  const id = uid();
  await post([c.id], id);
  const request = () =>
    new Request("http://localhost/api/agents/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  expect((await cancel(request())).status).toBe(200);
  expect(mock.getRun).toHaveBeenCalledWith("workflow-test");
  expect(mock.cancel).toHaveBeenCalledOnce();
  expect(state.runs[0].status).toBe("cancelled");
  expect((await cancel(request())).status).toBe(200);
  expect(
    state.audits.filter((a) => a.action === "Execução cancelada"),
  ).toHaveLength(1);
  expect((await post([c.id])).status).toBe(200);
});
