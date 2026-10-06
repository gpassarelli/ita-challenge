import { describe, expect, it } from "vitest";
import { commandSchema } from "../src/lib/domain/commands";
import { saveRecord, saveRules } from "../src/lib/domain/mutations";
import {
  CALCULATION_VERSION,
  editableCriterion,
  needsRecalculation,
  recalculate,
} from "../src/lib/domain/scoring";
import type {
  CriterionAlternative,
  RelatedFilter,
} from "../src/lib/domain/types";
import {
  actor,
  activate,
  company,
  criterion,
  emptyWorkspace,
  uid,
} from "./fixtures";

const filter = (
  field: string,
  value: string,
  operator: RelatedFilter["operator"] = "equals",
): RelatedFilter => ({ field, value, operator });
const signal: CriterionAlternative = {
  source: "signal",
  filters: [filter("signal_type", "Expansão")],
  minStrength: "Alto",
  recentDays: 30,
};
const person: CriterionAlternative = {
  source: "person",
  filters: [
    filter("role", "diretor", "contains"),
    filter("identified", "Sim"),
    filter("channel", "", "exists"),
  ],
};
const growth: CriterionAlternative = {
  source: "company",
  field: "growth",
  operator: "scale",
  value: '{"Alto":1,"Médio":0.5,"Baixo":0}',
};

describe("critérios com fontes alternativas", () => {
  it("usa a maior alternativa, sem acumular sinais ou alterar atributos da empresa", () => {
    const state = emptyWorkspace();
    const c = company(state, { growth: "Médio" });
    activate(state, [criterion({ alternatives: [growth, signal] })]);
    expect(state.evaluations[0].icp).toMatchObject({
      value: 50,
      coverage: 100,
    });
    for (const evidence of ["Nova unidade", "Nova região"])
      saveRecord(state, actor, "Sinais_Publicos", {
        company_external_id: c.externalKey,
        signal_type: "Expansão",
        strength: "Alto",
        date: "2026-10-04",
        evidence,
        source: "Site da empresa",
      });
    recalculate(state, "2026-10-04");
    const score = state.evaluations[0].icp;
    expect(score).toMatchObject({ value: 100, earned: 100, coverage: 100 });
    expect(
      score.criteria[0].evidence.filter((e) => e.field === "date"),
    ).toHaveLength(2);
    expect(
      score.criteria[0].evidence.some(
        (e) => e.recordLabel === "Nova unidade" && e.field === "source",
      ),
    ).toBe(true);
    expect(c.data.growth).toBe("Médio");
    c.data.growth = "Alto";
    recalculate(state, "2026-10-04");
    expect(state.evaluations[0].icp.value).toBe(100);
    c.data.growth = "Baixo";
    recalculate(state, "2026-11-04");
    expect(state.evaluations[0].icp).toMatchObject({ value: 0, coverage: 100 });
  });

  it("exige todos os filtros no mesmo sinal e ignora sinais de outra empresa", () => {
    const state = emptyWorkspace();
    const c = company(state);
    const other = company(state);
    for (const [owner, type, strength] of [
      [c, "Expansão", "Baixo"],
      [c, "Benefícios", "Alto"],
      [other, "Expansão", "Alto"],
    ] as const) {
      saveRecord(state, actor, "Sinais_Publicos", {
        company_external_id: owner.externalKey,
        signal_type: type,
        strength,
        date: "2026-10-04",
        evidence: type + strength,
      });
    }
    activate(state, [criterion({ alternatives: [signal] })]);
    recalculate(state, "2026-10-04");
    expect(
      state.evaluations.find((e) => e.companyId === c.id)!.icp,
    ).toMatchObject({ value: 0, coverage: 100 });
    expect(
      state.evaluations.find((e) => e.companyId === other.id)!.icp.value,
    ).toBe(100);
  });

  it.each([
    ["2026-10-04", "Alto", 100, 100],
    ["2026-09-04", "Alto", 100, 100],
    ["2026-09-03", "Alto", 0, 100],
    ["2026-10-05", "Alto", 0, 100],
    [null, "Alto", 0, 0],
    ["2026-02-30", "Alto", 0, 0],
    ["inválida", "Alto", 0, 0],
    ["2026-10-04", "Médio", 0, 100],
    ["2026-10-04", null, 0, 0],
  ])(
    "data %s e força %s resultam em %s pontos e %s%% cobertura",
    (date, strength, value, coverage) => {
      const state = emptyWorkspace();
      const c = company(state);
      const r = saveRecord(state, actor, "Sinais_Publicos", {
        company_external_id: c.externalKey,
        signal_type: "Expansão",
        evidence: "Registro legado",
      });
      // Corrupt legacy dates must also be rejected by the evaluator, not only on input.
      r.data.date = date;
      r.data.strength = strength;
      activate(state, [criterion({ alternatives: [signal] })]);
      recalculate(state, "2026-10-04");
      expect(state.evaluations[0].icp).toMatchObject({ value, coverage });
    },
  );

  it("aceita força maior que o mínimo e recompõe o score na virada da janela", () => {
    const state = emptyWorkspace();
    const c = company(state);
    saveRecord(state, actor, "Sinais_Publicos", {
      company_external_id: c.externalKey,
      strength: "Alto",
      date: "2026-10-04",
    });
    activate(state, [
      criterion({
        alternatives: [
          {
            source: "signal",
            filters: [],
            minStrength: "Médio",
            recentDays: 1,
          },
        ],
      }),
    ]);
    recalculate(state, "2026-10-05");
    expect(state.evaluations[0].icp.value).toBe(100);
    expect(needsRecalculation(state, "2026-10-06")).toBe(true);
    recalculate(state, "2026-10-06");
    expect(state.evaluations[0].icp.value).toBe(0);
  });

  it("exige filtros na mesma pessoa, respeita bloqueios e não conta canais institucionais", () => {
    const state = emptyWorkspace();
    const c = company(state);
    const other = company(state);
    const rows = [
      { name: "Diretora sem canal", role: "Diretora", identified: "Sim" },
      {
        name: "Analista com canal",
        role: "Analista",
        channel: "analista@teste.invalid",
        identified: "Sim",
      },
      {
        name: "Não identificado",
        role: "Diretor",
        channel: "rh@teste.invalid",
        identified: "Sim",
      },
    ];
    for (const row of rows)
      saveRecord(state, actor, "Decisores_Canais", {
        company_external_id: c.externalKey,
        ...row,
      });
    saveRecord(state, actor, "Decisores_Canais", {
      company_external_id: other.externalKey,
      name: "Outra empresa",
      role: "Diretor",
      identified: "Sim",
      channel: "outra@teste.invalid",
    });
    activate(state, [criterion({ alternatives: [person] })]);
    const ownScore = () =>
      state.evaluations.find((e) => e.companyId === c.id)!.icp;
    expect(ownScore().value).toBe(0);
    const good = saveRecord(state, actor, "Decisores_Canais", {
      company_external_id: c.externalKey,
      name: "Diretora elegível",
      role: "DIRETORA DE RH",
      identified: "Sim",
      channel: "diretora@teste.invalid",
      channel_type: "Pessoal",
    });
    expect(ownScore().value).toBe(100);
    const c2 = saveRecord(state, actor, "Decisores_Canais", {
      company_external_id: c.externalKey,
      name: "Segundo diretor",
      role: "Diretor",
      identified: "Sim",
      channel: "diretor2@teste.invalid",
      channel_type: "Pessoal",
    });
    expect(ownScore().earned).toBe(100);
    expect(
      ownScore().criteria[0].evidence.some((e) => e.recordId === good.id),
    ).toBe(true);
    saveRules(state, actor, {
      id: uid(),
      kind: "exclusions",
      active: true,
      criteria: [],
      exclusions: [
        {
          id: uid(),
          name: "Canal pessoal",
          field: "channel_type",
          operator: "equals",
          value: "Pessoal",
          action: "block_channel",
          penalty: 0,
          reason: "Não utilizar",
        },
      ],
    });
    expect(ownScore().value).toBe(0);
    expect(
      ownScore().criteria[0].evidence.some((e) =>
        [good.id, c2.id].includes(e.recordId),
      ),
    ).toBe(false);
  });

  it("ausência vale zero inclusive para diferenças; cobertura é separada e não duplica", () => {
    const state = emptyWorkspace();
    const c = company(state, { employees: 500 });
    activate(state, [
      criterion({ weight: 40 }),
      criterion({ weight: 60, alternatives: [person, signal] }),
    ]);
    expect(state.evaluations[0].icp).toMatchObject({
      value: 40,
      earned: 40,
      coverage: 40,
    });
    activate(
      state,
      [
        criterion({
          alternatives: [
            {
              source: "person",
              filters: [filter("role", "Analista", "not_equals")],
            },
          ],
        }),
      ],
      "commercial",
    );
    saveRecord(state, actor, "Decisores_Canais", {
      company_external_id: c.externalKey,
      name: "Pessoa sem cargo",
    });
    expect(state.evaluations[0].commercial).toMatchObject({
      value: 0,
      status: "insufficient",
      coverage: 0,
    });
  });

  it("combina listas textuais, origem e presença de canal na mesma pessoa", () => {
    const state = emptyWorkspace();
    const c = company(state);
    saveRecord(state, actor, "Decisores_Canais", {
      company_external_id: c.externalKey,
      name: "Gestora",
      role: "RH",
      channel: "rh@teste.invalid",
      source: "Site",
    });
    activate(state, [
      criterion({
        alternatives: [
          {
            source: "person",
            filters: [
              filter("role", "RH|Diretoria", "in"),
              filter("source", "Evento", "not_equals"),
              filter("channel", "", "exists"),
            ],
          },
        ],
      }),
    ]);
    expect(state.evaluations[0].icp.value).toBe(100);
  });

  it("valida fontes, operadores, limites e rejeita formatos misturados na API", () => {
    const base = {
      type: "rules",
      kind: "icp",
      active: true,
      criteria: [criterion({ alternatives: [signal, person, growth] })],
      exclusions: [],
    };
    expect(commandSchema.safeParse(base).success).toBe(true);
    expect(
      commandSchema.safeParse({
        ...base,
        criteria: [
          {
            ...base.criteria[0],
            field: "employees",
            operator: "gte",
            value: "200",
          },
        ],
      }).success,
    ).toBe(false);
    for (const alternative of [
      { ...signal, recentDays: 0 },
      { ...signal, recentDays: 3651 },
      { ...signal, recentDays: 1.5 },
      { ...signal, filters: [filter("role", "RH")] },
      { ...person, filters: [filter("channel", "Privado")] },
      {
        ...person,
        filters: [filter("role", "RH|")].map((f) => ({
          ...f,
          operator: "in" as const,
        })),
      },
    ]) {
      expect(() =>
        activate(emptyWorkspace(), [
          criterion({ alternatives: [alternative] }),
        ]),
      ).toThrow();
    }
    expect(() =>
      activate(emptyWorkspace(), [criterion({ alternatives: [] })]),
    ).toThrow();
    expect(
      commandSchema.safeParse({
        ...base,
        criteria: [
          criterion({
            alternatives: [
              {
                ...person,
                filters: [{ field: "role", operator: "gte", value: "1" }],
              } as unknown as CriterionAlternative,
            ],
          }),
        ],
      }).success,
    ).toBe(false);
  });

  it("reabre regras antigas como alternativa equivalente e atualiza avaliações antigas no mesmo dia", () => {
    const state = emptyWorkspace();
    company(state, { growth: "Médio" });
    const old = criterion({
      field: "growth",
      operator: "scale",
      value: '{"Médio":0.5}',
    });
    activate(state, [old]);
    const edited = editableCriterion(old);
    expect(edited.alternatives).toEqual([
      {
        source: "company",
        field: "growth",
        operator: "scale",
        value: '{"Médio":0.5}',
      },
    ]);
    expect(edited).not.toHaveProperty("field");
    activate(state, [edited]);
    recalculate(state, "2026-10-04");
    expect(state.evaluations[0].icp.value).toBe(50);
    expect(needsRecalculation(state, "2026-10-04")).toBe(false);
    delete state.evaluations[0].calculationVersion;
    expect(needsRecalculation(state, "2026-10-04")).toBe(true);
    recalculate(state, "2026-10-04");
    expect(state.evaluations[0].calculationVersion).toBe(CALCULATION_VERSION);
    const before = structuredClone(state.evaluations);
    recalculate(state, "2026-10-04");
    expect(state.evaluations).toEqual(before);
    state.evaluations = [];
    expect(needsRecalculation(state, "2026-10-04")).toBe(true);
  });
});
