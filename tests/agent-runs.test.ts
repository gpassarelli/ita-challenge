import { describe, expect, it } from "vitest";
import { agentEligibility } from "../src/lib/domain/agent-runs";
import {
  archiveRun,
  cancelAgentRun,
  reconcileAgentRun,
  queueAgentRun,
} from "../src/lib/domain/agent-run-mutations";
import { executeCommand } from "../src/lib/domain/execute";
import { decideRevision } from "../src/lib/domain/mutations";
import { actor, company, emptyWorkspace, revision, run, uid } from "./fixtures";

function request(companyIds: string[]) {
  return {
    id: uid(),
    agent: "signals" as const,
    companyIds,
    productId: null,
    contactId: null,
    channel: "E-mail" as const,
  };
}

describe("fila de agentes", () => {
  it("exclui apenas revisões de dados pendentes e deduplica empresas", () => {
    const s = emptyWorkspace();
    const blocked = company(s),
      eligible = company(s),
      reviewed = company(s);
    const pending = revision(blocked);
    s.revisions.push(
      pending,
      revision(eligible, { type: "message" }),
      revision(reviewed, { status: "rejected" }),
    );
    const input = request([blocked.id, eligible.id, eligible.id, reviewed.id]);
    expect(queueAgentRun(s, actor, input)).toBe(true);
    expect(s.runs[0].companyIds).toEqual([eligible.id, reviewed.id]);
    expect(s.runs[0].items).toHaveLength(2);
    expect(s.runs[0].skippedCompanies).toEqual([
      { companyId: blocked.id, revisionIds: [pending.id] },
    ]);
    expect(agentEligibility(s, "outreach", [blocked.id]).companyIds).toEqual([
      blocked.id,
    ]);
  });

  it("não cria execução vazia; aprovação ou recusa libera a empresa", () => {
    for (const decision of ["approved", "rejected"] as const) {
      const s = emptyWorkspace(),
        c = company(s),
        pending = revision(c);
      s.revisions.push(pending);
      expect(() => queueAgentRun(s, actor, request([c.id]))).toThrow(
        "Todas as empresas",
      );
      expect(s.runs).toHaveLength(0);
      decideRevision(s, actor, pending.id, decision, "Revisado");
      expect(queueAgentRun(s, actor, request([c.id]))).toBe(true);
    }
  });

  it("replay mantém seleção e exclusões originais mesmo após resolver pendências", () => {
    const s = emptyWorkspace(),
      a = company(s),
      b = company(s);
    const pending = revision(a);
    s.revisions.push(pending);
    const input = request([a.id, b.id]);
    queueAgentRun(s, actor, input);
    decideRevision(s, actor, pending.id, "rejected", "Rever evidências");
    const snapshot = structuredClone(s.runs[0]);
    expect(queueAgentRun(s, actor, input)).toBe(true);
    expect(s.runs).toEqual([snapshot]);
    s.runs[0].workflowId = "workflow";
    expect(queueAgentRun(s, actor, input)).toBe(false);
    s.runs[0].status = "completed";
    expect(queueAgentRun(s, actor, input)).toBe(false);
    expect(s.runs[0].companyIds).toEqual([b.id]);
  });

  it("mantém o limite de uma execução ativa e valida empresas desconhecidas", () => {
    const s = emptyWorkspace(),
      c = company(s);
    expect(() => queueAgentRun(s, actor, request([uid()]))).toThrow(
      "Empresa não encontrada",
    );
    queueAgentRun(s, actor, request([c.id]));
    expect(() => queueAgentRun(s, actor, request([c.id]))).toThrow(
      "Aguarde a execução",
    );
  });
});

describe("arquivamento compartilhado", () => {
  it("exige lote e itens finalizados e todas as revisões resolvidas", () => {
    const s = emptyWorkspace(),
      c = company(s);
    const execution = run(c, {
      items: [
        { companyId: c.id, status: "running", error: null, revisionId: null },
      ],
    });
    s.runs.push(execution);
    expect(() => archiveRun(s, actor, execution.id)).toThrow("Aguarde");
    execution.status = "completed";
    expect(() => archiveRun(s, actor, execution.id)).toThrow("Aguarde");
    execution.items[0].status = "completed";
    const data = revision(c, { runId: execution.id });
    const message = revision(c, { runId: execution.id, type: "message" });
    s.revisions.push(data, message);
    decideRevision(s, actor, data.id, "approved", "");
    expect(() => archiveRun(s, actor, execution.id)).toThrow(
      "todas as revisões",
    );
    decideRevision(s, actor, message.id, "rejected", "Rever texto");
    const before = structuredClone(s.records);
    const command = { type: "archiveRun" as const, id: execution.id };
    const requestId = uid();
    executeCommand(s, actor, command, requestId);
    const archivedAt = execution.archivedAt;
    executeCommand(s, actor, command, requestId);
    executeCommand(s, actor, command, uid());
    expect(execution.archivedBy).toBe(actor);
    expect(execution.archivedAt).toBe(archivedAt);
    expect(archivedAt).toBeTruthy();
    expect(s.records).toEqual(before);
    expect(s.revisions).toHaveLength(2);
    expect(
      s.audits.filter((a) => a.action === "Execução arquivada"),
    ).toHaveLength(1);
  });

  it("permite arquivar falhas sem revisões e registros antigos sem metadados", () => {
    const s = emptyWorkspace(),
      c = company(s);
    const execution = run(c, {
      status: "failed",
      items: [
        { companyId: c.id, status: "failed", error: "Falha", revisionId: null },
      ],
    });
    s.runs.push(execution);
    archiveRun(s, actor, execution.id);
    expect(execution.archivedAt).toBeTruthy();
    expect(execution.items[0].error).toBe("Falha");
    expect(() => archiveRun(s, actor, uid())).toThrow("não encontrada");
  });
});

it("cancelamento preserva resultados concluídos e exige revisar antes de arquivar", () => {
  const s = emptyWorkspace();
  const a = company(s),
    b = company(s);
  const execution = run(a, {
    status: "running",
    companyIds: [a.id, b.id],
    items: [
      {
        companyId: a.id,
        status: "completed",
        revisionId: "saved",
        error: null,
      },
      { companyId: b.id, status: "queued", revisionId: null, error: null },
    ],
  });
  s.runs.push(execution);
  const saved = revision(a, { runId: execution.id });
  s.revisions.push(saved);
  const before = structuredClone(execution.items[0]);
  cancelAgentRun(s, actor, execution.id);
  expect(execution.items[0]).toEqual(before);
  expect(s.revisions).toEqual([saved]);
  expect(() => archiveRun(s, actor, execution.id)).toThrow("todas as revisões");
  saved.status = "rejected";
  archiveRun(s, actor, execution.id);
  expect(execution.archivedAt).toBeTruthy();
});

it("reconcilia workflow encerrado sem retomar IA e preserva o erro original", () => {
  const state = emptyWorkspace();
  const c = company(state);
  const execution = run(c, {
    status: "running",
    items: [
      {
        companyId: c.id,
        status: "running",
        error: "Código: TIMEOUT.",
        revisionId: null,
      },
    ],
  });
  state.runs.push(execution);
  reconcileAgentRun(state, actor, execution.id, "failed");
  expect(execution.status).toBe("failed");
  expect(execution.items[0].error).toBe("Código: TIMEOUT.");
  expect(execution.items[0].finishedAt).toBeTruthy();
  reconcileAgentRun(state, actor, execution.id, "failed");
  expect(
    state.audits.filter((a) => a.action === "Execução reconciliada"),
  ).toHaveLength(1);
});

it("repete somente falhas e preserva a execução e revisão bem-sucedidas", () => {
  const state = emptyWorkspace();
  const first = company(state),
    second = company(state),
    blocked = company(state);
  const original = run(first, {
    status: "completed",
    companyIds: [first.id, second.id, blocked.id],
    items: [
      {
        companyId: first.id,
        status: "completed",
        error: null,
        revisionId: null,
      },
      {
        companyId: second.id,
        status: "failed",
        error: "AI_FIELD",
        revisionId: null,
      },
      {
        companyId: blocked.id,
        status: "failed",
        error: "AI_TIMEOUT",
        revisionId: null,
      },
    ],
  });
  state.runs.push(original);
  state.revisions.push(revision(first), revision(blocked));
  const snapshot = structuredClone(original);
  expect(() =>
    queueAgentRun(state, actor, {
      ...request([first.id]),
      retryOf: original.id,
    }),
  ).toThrow("somente");
  expect(() =>
    queueAgentRun(state, actor, {
      ...request([second.id]),
      retryOf: original.id,
      channel: "LinkedIn",
    }),
  ).toThrow("mesma configuração");
  queueAgentRun(
    state,
    actor,
    { ...request([second.id, blocked.id]), retryOf: original.id },
    { concurrency: 8, timeoutMs: 60000 },
  );
  expect(state.runs[1].companyIds).toEqual([second.id]);
  expect(state.runs[1].retryOf).toBe(original.id);
  expect(original).toEqual(snapshot);
  expect(state.revisions).toHaveLength(2);
});
