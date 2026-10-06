import { describe, it, expect } from "vitest";
import { recalculate, fact } from "../src/lib/domain/scoring";
import {
  saveRecord,
  saveRules,
  moveOpportunity,
} from "../src/lib/domain/mutations";
import { selectList } from "../src/lib/domain/lists";
import {
  actor,
  product,
  company,
  criterion,
  activate,
  emptyWorkspace,
  uid,
} from "./fixtures";
describe("pontuação determinística e listas", () => {
  it("soma pontos sobre 100 mesmo sem dados, com cobertura separada", () => {
    const s = emptyWorkspace();
    const c = company(s, {
      employees: 500,
      structured_hr: null,
      growth: "Não identificado",
    });
    activate(s, [
      criterion({ weight: 40 }),
      criterion({
        name: "RH",
        field: "structured_hr",
        operator: "equals",
        value: "Sim",
        weight: 30,
      }),
      criterion({
        name: "Crescimento",
        field: "growth",
        operator: "equals",
        value: "Alto",
        weight: 30,
      }),
    ]);
    expect(s.evaluations[0].icp).toMatchObject({
      value: 40,
      earned: 40,
      availableWeight: 40,
      coverage: 40,
    });
    expect(s.evaluations[0].commercial.status).toBe("unconfigured");
    saveRecord(
      s,
      actor,
      "Prospects",
      { ...c.data, structured_hr: "Não" },
      c.id,
      c.version,
    );
    expect(s.evaluations[0].icp).toMatchObject({
      value: 40,
      earned: 40,
      coverage: 70,
    });
    expect(s.evaluations[0].icp.criteria[1].available).toBe(true);
  });
  it("não confunde zero com ausência e impede ativação sem 100 pontos", () => {
    const s = emptyWorkspace();
    const c = company(s, { employees: 0 });
    activate(s, [criterion()]);
    expect(s.evaluations[0].icp.value).toBe(0);
    expect(s.evaluations[0].icp.coverage).toBe(100);
    expect(() => activate(s, [criterion({ weight: 30 })])).toThrow("100");
    saveRecord(
      s,
      actor,
      "Prospects",
      { ...c.data, employees: null },
      c.id,
      c.version,
    );
    expect(s.evaluations[0].icp.status).toBe("insufficient");
    expect(s.evaluations[0].icp.value).toBe(0);
  });
  it("respeita janela de recência, data futura e histórico do segmento", () => {
    const s = emptyWorkspace();
    const c = company(s);
    const other = company(s);
    const sig = saveRecord(s, actor, "Sinais_Publicos", {
      company_external_id: c.externalKey,
      evidence: "Teste",
      strength: "Alto",
      date: "2026-10-04",
    });
    expect(
      fact(
        s,
        s.records.find((r) => r.id === c.id)!,
        "strong_recent_signal",
        "2026-10-03",
        30,
      ).value,
    ).toBe("Não");
    expect(fact(s, c, "strong_recent_signal", "2026-11-03", 30).value).toBe(
      "Sim",
    );
    expect(fact(s, c, "strong_recent_signal", "2026-11-04", 30).value).toBe(
      "Não",
    );
    activate(
      s,
      [
        criterion({
          field: "segment_won_history",
          operator: "equals",
          value: "Sim",
        }),
      ],
      "commercial",
    );
    const opp = saveRecord(s, actor, "Oportunidades_Historico", {
      solution_external_id: product(s).externalKey,
      external_id: "TEST-OPP",
      company_external_id: other.externalKey,
      outcome: "Perdida",
    });
    expect(
      s.evaluations.find((e) => e.companyId === c.id)!.commercial.value,
    ).toBe(0);
    moveOpportunity(s, actor, opp.id, "Ganha", opp.version);
    expect(
      s.evaluations.find((e) => e.companyId === c.id)!.commercial.value,
    ).toBe(100);
    expect(
      s.records.find((r) => r.id === other.id)!.data.commercial_status,
    ).toBe("Cliente ativo");
    expect(s.audits.at(-1)!.before).toEqual({ outcome: "Perdida" });
  });
  it("aplica penalidade somente à prioridade, bloqueia canais e desqualifica explicitamente", () => {
    const s = emptyWorkspace();
    const c = company(s, { employees: 500 });
    const contact = saveRecord(s, actor, "Decisores_Canais", {
      company_external_id: c.externalKey,
      name: "Pessoa de teste",
      channel_type: "Pessoal",
      identified: "Sim",
    });
    activate(s, [criterion()]);
    activate(s, [criterion()], "commercial");
    saveRules(s, actor, {
      id: uid(),
      kind: "exclusions",
      active: true,
      criteria: [],
      exclusions: [
        {
          id: uid(),
          name: "Penalidade",
          field: "employees",
          operator: "gte",
          value: "500",
          action: "penalty",
          penalty: 25,
          reason: "Teste",
        },
        {
          id: uid(),
          name: "Canal",
          field: "channel_type",
          operator: "equals",
          value: "Pessoal",
          action: "block_channel",
          penalty: 0,
          reason: "Não utilizar",
        },
        {
          id: uid(),
          name: "Empresa",
          field: "employees",
          operator: "equals",
          value: "500",
          action: "disqualify",
          penalty: 0,
          reason: "Exclusão de teste",
        },
      ],
    });
    expect(s.evaluations[0]).toMatchObject({
      disqualified: true,
      blockedContactIds: [contact.id],
    });
    expect(s.evaluations[0].icp.value).toBe(100);
    expect(s.evaluations[0].commercial.value).toBe(75);
  });
  it("lista AND muda junto com os dados e aplica duas ordenações", () => {
    const s = emptyWorkspace();
    const a = company(s, { name: "B", employees: 400 });
    const b = company(s, { name: "A", employees: 300 });
    activate(s, [criterion()]);
    const list = {
      filters: [
        { field: "employees", operator: "gte" as const, value: "300" },
        {
          field: "commercial_status",
          operator: "equals" as const,
          value: "Prospect",
        },
      ],
      sort: [
        { field: "icp", direction: "desc" as const },
        { field: "name", direction: "asc" as const },
      ],
    };
    expect(selectList(s, list).map((c) => c.id)).toEqual([b.id, a.id]);
    saveRecord(s, actor, "Oportunidades_Historico", {
      solution_external_id: product(s).externalKey,
      external_id: "LIST-OPP",
      company_external_id: b.externalKey,
      outcome: "Ganha",
    });
    expect(selectList(s, list).map((c) => c.id)).toEqual([a.id]);
  });
});
