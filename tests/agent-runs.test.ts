import { describe, expect, it } from "vitest";
import { agentEligibility } from "../src/lib/domain/agent-runs";
import { queueAgentRun } from "../src/lib/domain/agent-run-mutations";
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
