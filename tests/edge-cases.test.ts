import { it, expect } from "vitest";
import {
  match,
  validateCondition,
  recalculate,
} from "../src/lib/domain/scoring";
import { previewCSV } from "../src/lib/domain/csv";
import { saveRecord } from "../src/lib/domain/mutations";
import { DATASETS } from "../src/lib/domain/catalog";
import {
  actor,
  product,
  emptyWorkspace,
  company,
  criterion,
  activate,
} from "./fixtures";
import Papa from "papaparse";
it("escalas por categoria e comparações respeitam percentuais e formato pt-BR", () => {
  const s = emptyWorkspace();
  company(s, { growth: "Médio" });
  activate(s, [
    criterion({
      field: "growth",
      operator: "scale",
      value: '{"Alto":1,"Médio":0.5,"Baixo":0}',
    }),
  ]);
  expect(s.evaluations[0].icp).toMatchObject({
    value: 50,
    earned: 50,
    coverage: 100,
  });
  expect(match(200.5, "gte", "200,5")).toBe(1);
  expect(match(1500, "between", "1.000|2.000")).toBe(1);
  expect(() => validateCondition("employees", "between", "200|")).toThrow(
    "limites",
  );
  expect(() => validateCondition("segment", "gte", "200")).toThrow(
    "categorias",
  );
});
it("recalcular JSON com ordem de chaves diferente preserva o instante sem criar nova avaliação", () => {
  const s = emptyWorkspace();
  company(s, { employees: 450 });
  activate(s, [criterion()]);
  const original = s.evaluations[0].calculatedAt;
  s.evaluations = s.evaluations.map(
    (e) =>
      Object.fromEntries(
        Object.entries(e).sort(([a], [b]) => a.localeCompare(b)),
      ) as typeof e,
  );
  recalculate(s);
  expect(s.evaluations[0].calculatedAt).toBe(original);
});
it("linhas físicas do CSV continuam corretas após uma evidência com quebra de linha", () => {
  const s = emptyWorkspace();
  const c = company(s);
  const csv = Papa.unparse(
    [
      DATASETS.Sinais_Publicos.fields.map((f) => f.label),
      [
        c.externalKey,
        "Teste",
        "Notícia",
        "Linha 1\nLinha 2",
        "Alto",
        "03/10/2026",
        "Teste",
        "https://teste.invalid/1",
      ],
      [
        c.externalKey,
        "Teste",
        "Notícia",
        "Outra evidência",
        "Alto",
        "03/10/2026",
        "Teste",
        "https://teste.invalid/2",
      ],
    ],
    { delimiter: ";" },
  );
  const p = previewCSV("Sinais_Publicos", "teste.csv", csv, s);
  expect(p.rows.map((r) => r.line)).toEqual([2, 4]);
});
it("vínculo nominal de patrocinador exige contato da mesma empresa e preserva o texto", () => {
  const s = emptyWorkspace();
  const c = company(s);
  const other = company(s);
  const contact = saveRecord(s, actor, "Decisores_Canais", {
    company_external_id: c.externalKey,
    name: "Pessoa de teste",
  });
  const data = {
    external_id: "OPP-NOMINAL",
    solution_external_id: product(s).externalKey,
    company_external_id: c.externalKey,
    outcome: "Em negociação",
    sponsor: "Texto original preservado",
    sponsor_contact_id: contact.id,
  };
  const opp = saveRecord(s, actor, "Oportunidades_Historico", data);
  expect(opp.contactId).toBe(contact.id);
  expect(opp.data.sponsor).toBe("Texto original preservado");
  expect(() =>
    saveRecord(s, actor, "Oportunidades_Historico", {
      ...data,
      external_id: "OUTRA",
      company_external_id: other.externalKey,
    }),
  ).toThrow("deve pertencer");
});

it("preserva sinais distintos que usam a mesma URL pública", () => {
  const s = emptyWorkspace();
  const c = company(s);
  const csv = Papa.unparse(
    [
      DATASETS.Sinais_Publicos.fields.map((f) => f.label),
      [
        c.externalKey,
        "Teste",
        "Crescimento",
        "Evidência A",
        "Alto",
        "03/10/2026",
        "Teste",
        "https://teste.invalid",
      ],
      [
        c.externalKey,
        "Teste",
        "Benefícios",
        "Evidência B",
        "Médio",
        "03/10/2026",
        "Teste",
        "https://teste.invalid",
      ],
    ],
    { delimiter: ";" },
  );
  const p = previewCSV("Sinais_Publicos", "teste.csv", csv, s);
  expect(p.counts.new).toBe(2);
  expect(p.counts.conflict).toBe(0);
});
