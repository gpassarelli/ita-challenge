import { describe, it, expect } from "vitest";
import { agentContext, validatedChanges } from "../src/lib/domain/agents";
import { decideRevision, saveRecord } from "../src/lib/domain/mutations";
import {
  actor,
  company,
  criterion,
  activate,
  emptyWorkspace,
  revision,
  run,
  uid,
} from "./fixtures";
describe("agentes e revisão humana", () => {
  it("aprova o conjunto inteiro, recalcula e mantém origem por revisão, uma única vez", () => {
    const s = emptyWorkspace();
    const c = company(s);
    activate(s, [
      criterion({ field: "structured_hr", operator: "equals", value: "Sim" }),
    ]);
    const r = revision(c);
    s.revisions.push(r);
    decideRevision(s, actor, r.id, "approved", "");
    const saved = s.records.find((x) => x.id === c.id)!;
    expect(saved.data.structured_hr).toBe("Sim");
    expect(saved.fieldSources!.structured_hr.kind).toBe("revision");
    expect(s.evaluations[0].icp.value).toBe(100);
    expect(s.evaluations[0].icp.criteria[0].evidence[0].detail).toContain(r.id);
    const version = saved.version;
    decideRevision(s, actor, r.id, "approved", "");
    expect(saved.version).toBe(version);
  });
  it("recusa exige motivo e não altera a empresa", () => {
    const s = emptyWorkspace();
    const c = company(s);
    const r = revision(c);
    s.revisions.push(r);
    expect(() => decideRevision(s, actor, r.id, "rejected", "")).toThrow(
      "motivo",
    );
    const before = structuredClone(c);
    decideRevision(s, actor, r.id, "rejected", "Evidência insuficiente");
    expect(s.records.find((x) => x.id === c.id)).toEqual(before);
    expect(r.reason).toBe("Evidência insuficiente");
  });
  it("bloqueia revisão desatualizada inclusive após mudança em sinais relacionados", () => {
    const s = emptyWorkspace();
    const c = company(s);
    const r = revision(c);
    s.revisions.push(r);
    saveRecord(s, actor, "Sinais_Publicos", {
      company_external_id: c.externalKey,
      evidence: "Sinal novo",
    });
    expect(() => decideRevision(s, actor, r.id, "approved", "")).toThrow(
      "mudou",
    );
    expect(s.records.find((x) => x.id === c.id)!.data.structured_hr).toBeNull();
    expect(r.status).toBe("pending");
  });
  it("não aplica nenhum campo se a revisão inteira contém uma alteração inválida", () => {
    const s = emptyWorkspace();
    const c = company(s);
    const r = revision(c);
    r.changes.push({
      field: "commercial_status",
      before: "Prospect",
      after: "Cliente ativo",
      reason: "Não permitido",
      evidenceIds: [c.id],
    });
    s.revisions.push(r);
    expect(() => decideRevision(s, actor, r.id, "approved", "")).toThrow(
      "não permitido",
    );
    expect(c.data.structured_hr).toBeNull();
  });
  it("preserva original e edição da mensagem; aprovar não altera cadastro ou notas", () => {
    const s = emptyWorkspace();
    const c = company(s);
    const original = {
      subject: "Assunto original",
      body: "Texto original",
      rationale: "Teste",
      evidenceIds: [c.id],
      warnings: [],
      productId: uid(),
      contactId: null,
      channel: "E-mail",
    };
    const r = revision(c, {
      type: "message",
      changes: [],
      message: original,
      originalMessage: structuredClone(original),
    });
    s.revisions.push(r);
    const before = structuredClone(c);
    const scores = structuredClone(s.evaluations);
    decideRevision(s, actor, r.id, "approved", "", {
      subject: "Assunto editado",
      body: "Texto editado",
    });
    expect(r.originalMessage?.body).toBe("Texto original");
    expect(r.message?.body).toBe("Texto editado");
    expect(r.edited).toBe(true);
    expect(s.records[0]).toEqual(before);
    expect(s.evaluations).toEqual(scores);
  });
  it("usa somente o produto escolhido e exclui referências dos agentes", () => {
    const s = emptyWorkspace();
    const c = company(s);
    const p = saveRecord(s, actor, "Portfolio", {
      external_id: "PROD-TEST",
      name: "Produto escolhido",
      value_proposition: "Benefício explícito",
    });
    saveRecord(s, actor, "Portfolio", {
      external_id: "OUTRO",
      name: "Não selecionado",
    });
    // Legacy snapshots may still contain the retired datasets.
    s.records.push(
      {
        ...c,
        id: uid(),
        dataset: "Ranking_Referencia" as typeof c.dataset,
        companyId: c.id,
        data: { reference_score: 99 },
      },
      {
        ...c,
        id: uid(),
        dataset: "Casos_Validacao" as typeof c.dataset,
        companyId: c.id,
        data: { expected_result: "RESPOSTA ESPERADA PROIBIDA" },
      },
    );
    const ctx = agentContext(
      s,
      run(c, { agent: "outreach", productId: p.id }),
      c.id,
    );
    expect(JSON.stringify(ctx.input)).not.toContain("RESPOSTA ESPERADA");
    expect(JSON.stringify(ctx.input)).not.toContain("reference_score");
    expect(JSON.stringify(ctx.input)).not.toContain("Não selecionado");
    expect(ctx.input.selectedProductId).toBe(p.id);
    expect(() =>
      validatedChanges(
        {
          explanation: "Teste",
          warnings: [],
          changes: [
            {
              field: "structured_hr",
              after: "Sim",
              reason: "Teste",
              evidenceIds: ["inventado"],
            },
          ],
        },
        c,
        ctx.records,
      ),
    ).toThrow("inexistente");
    expect(() => agentContext(s, run(c, { agent: "outreach" }), c.id)).toThrow(
      "produto",
    );
  });
});
