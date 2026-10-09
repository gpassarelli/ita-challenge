import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { actor, company, emptyWorkspace } from "./fixtures";
import * as scoring from "../src/lib/domain/scoring";
import {
  agentErrorMessage,
  databaseError,
} from "../src/lib/server/diagnostics";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), response: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/server/supabase", () => ({
  adminClient: () => ({ rpc: mocks.rpc }),
}));
import { readWorkspace, mutateWorkspace } from "../src/lib/server/store";

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.rpc.mockImplementation(() => ({ abortSignal: mocks.response }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("repete uma leitura interrompida e devolve os dados recuperados", async () => {
  const state = emptyWorkspace();
  mocks.response
    .mockResolvedValueOnce({ status: 0, error: { message: "fetch failed" } })
    .mockResolvedValueOnce({ status: 200, error: null, data: state });
  const pending = readWorkspace();
  const assertion = expect(pending).resolves.toEqual(state);
  await vi.runAllTimersAsync();
  await assertion;
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  expect(mocks.response).toHaveBeenCalledWith(expect.any(AbortSignal));
});

it("limita tentativas e informa DNS sem recomendar migrações ou expor detalhes", async () => {
  mocks.response.mockResolvedValue({
    status: 0,
    error: {
      message: "fetch failed",
      details: "ENOTFOUND internal-host secret-token",
    },
  });
  const pending = readWorkspace();
  const assertion = expect(pending).rejects.toThrow("DNS_ERROR");
  await vi.runAllTimersAsync();
  await assertion;
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  expect(console.error).not.toHaveBeenCalledWith(
    expect.stringContaining("secret-token"),
  );
});

it.each([
  [401, "PGRST301", "autorização"],
  [403, "42501", "autorização"],
  [404, "PGRST202", "migrações"],
  [400, "42P01", "migrações"],
] as const)(
  "não repete erro permanente %s/%s",
  async (status, code, message) => {
    mocks.response.mockResolvedValue({
      status,
      error: { code, message: "private data" },
    });
    await expect(readWorkspace()).rejects.toThrow(message);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  },
);

it("não repete gravação com resultado incerto nem promete que nada foi aplicado", async () => {
  mocks.response.mockResolvedValue({
    status: 200,
    error: null,
    data: emptyWorkspace(),
  });
  mocks.rpc.mockImplementation((operation: string) =>
    operation === "read_workspace"
      ? { abortSignal: mocks.response }
      : {
          abortSignal: async () => ({
            status: 0,
            error: { message: "fetch failed" },
          }),
        },
  );
  await expect(
    mutateWorkspace("actor", (state) => {
      state.audits.push({
        id: "test",
        action: "test",
        actor: "actor",
        entityId: "test",
        at: new Date().toISOString(),
        before: null,
        after: null,
      });
    }),
  ).rejects.toThrow("NETWORK_ERROR");
  expect(
    mocks.rpc.mock.calls.filter(
      ([operation]) => operation === "commit_workspace_patch",
    ),
  ).toHaveLength(1);
});

it("classifica timeout e indisponibilidade como temporários", () => {
  expect(databaseError("read_workspace", { code: "57014" }, 500)).toMatchObject(
    { code: "TIMEOUT", retryable: true },
  );
  expect(databaseError("read_workspace", {}, 503)).toMatchObject({
    code: "HTTP_503",
    retryable: true,
  });
});

it("não expõe corpo do provedor nem valores de campos no diagnóstico", () => {
  const error = {
    name: "AI_RetryError",
    lastError: { statusCode: 429, message: "sk-secret prompt private" },
  };
  expect(agentErrorMessage(error)).toContain("AI_RATE_LIMIT");
  expect(agentErrorMessage(error)).not.toContain("secret");
  expect(
    agentErrorMessage(new Error("campo: opção inválida (private)")),
  ).toContain("AI_FIELD");
  expect(agentErrorMessage(new Error("private raw stack"))).not.toContain(
    "private",
  );
});

it("recalcula só quando os dados ou regras mudam, ou as avaliações vencem", async () => {
  const state = emptyWorkspace();
  company(state);
  scoring.recalculate(state);
  const recalculate = vi.spyOn(scoring, "recalculate");
  mocks.rpc.mockImplementation((operation: string) => ({
    abortSignal: async () => ({
      status: 200,
      error: null,
      data: operation === "read_workspace" ? structuredClone(state) : 1,
    }),
  }));
  await mutateWorkspace(actor, (s) => {
    s.audits.push({
      id: "audit",
      action: "test",
      actor,
      entityId: "test",
      at: new Date().toISOString(),
      before: null,
      after: null,
    });
  });
  expect(recalculate).not.toHaveBeenCalled();
  await mutateWorkspace(actor, (s) => {
    s.records[0].data.employees = 500;
  });
  expect(recalculate).toHaveBeenCalledTimes(1);
  state.evaluations[0].date = "2000-01-01";
  await mutateWorkspace(actor, () => {});
  expect(recalculate).toHaveBeenCalledTimes(2);
});

it("relê o estado após PT409 antes de repetir a alteração", async () => {
  const initial = emptyWorkspace();
  company(initial);
  scoring.recalculate(initial);
  const latest = structuredClone(initial);
  latest.version = 1;
  latest.records[0].data.name = "Edição simultânea";
  scoring.recalculate(latest);
  let reads = 0,
    writes = 0;
  mocks.rpc.mockImplementation((operation: string) => ({
    abortSignal: async () =>
      operation === "read_workspace"
        ? {
            status: 200,
            error: null,
            data: structuredClone(reads++ ? latest : initial),
          }
        : ++writes === 1
          ? {
              status: 409,
              error: { code: "PT409", message: "WORKSPACE_CONFLICT" },
            }
          : { status: 200, error: null, data: 2 },
  }));
  const mutation = vi.fn((s: typeof initial) => {
    s.audits.push({
      id: "audit",
      action: "test",
      actor,
      entityId: "test",
      at: new Date().toISOString(),
      before: null,
      after: null,
    });
  });
  const pending = mutateWorkspace(actor, mutation);
  await vi.runAllTimersAsync();
  const saved = await pending;
  expect(saved.state.records[0].data.name).toBe("Edição simultânea");
  expect(mutation).toHaveBeenCalledTimes(2);
  expect(
    mocks.rpc.mock.calls
      .filter(([op]) => op === "commit_workspace_patch")
      .map(([, args]) => args.expected_version),
  ).toEqual([0, 1]);
});

it("encerra conflitos persistentes após quatro tentativas", async () => {
  mocks.rpc.mockImplementation((operation: string) => ({
    abortSignal: async () =>
      operation === "read_workspace"
        ? { status: 200, error: null, data: emptyWorkspace() }
        : {
            status: 409,
            error: { code: "PT409", message: "WORKSPACE_CONFLICT" },
          },
  }));
  const pending = mutateWorkspace(actor, (s) => {
    s.audits.push({
      id: "audit",
      action: "test",
      actor,
      entityId: "test",
      at: new Date().toISOString(),
      before: null,
      after: null,
    });
  });
  const assertion = expect(pending).rejects.toThrow("outras alterações");
  await vi.runAllTimersAsync();
  await assertion;
  expect(
    mocks.rpc.mock.calls.filter(([op]) => op === "commit_workspace_patch"),
  ).toHaveLength(4);
});
