import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import {
  DATASETS,
  datasetNames,
  parseCell,
  fieldsFor,
  type Dataset,
} from "../src/lib/domain/catalog";
import { previewCSV } from "../src/lib/domain/csv";
import { importPreview, saveRecord } from "../src/lib/domain/mutations";
import { actor, company, emptyWorkspace, uid } from "./fixtures";
const csv = (d: Dataset, rows: Record<string, unknown>[]) =>
  Papa.unparse(
    {
      fields: DATASETS[d].fields.map((f) => f.label),
      data: rows.map((row) => DATASETS[d].fields.map((f) => row[f.key] ?? "")),
    },
    { delimiter: ";" },
  );
describe("CSV e cobertura integral das 9 abas", () => {
  it("mantém a estrutura original e começa sem registros ou regras", () => {
    expect(datasetNames).toHaveLength(9);
    expect(
      Object.values(emptyWorkspace())
        .filter(Array.isArray)
        .every((v) => v.length === 0),
    ).toBe(true);
    const lengths = [14, 10, 8, 8, 7, 10, 4, 4, 4];
    expect(datasetNames.map((d) => DATASETS[d].fields.length)).toEqual(lengths);
    for (const d of datasetNames)
      expect(new Set(DATASETS[d].fields.map((f) => f.label)).size).toBe(
        DATASETS[d].fields.length,
      );
  });
  it("importa cada campo de todas as abas sem carregar a planilha", () => {
    const s = emptyWorkspace();
    const examples: Record<Dataset, Record<string, unknown>> = {
      Prospects: {
        external_id: "TEST-EMP",
        name: "Empresa teste",
        segment: "Tecnologia",
        employees: "1.200",
        state: "SP",
        structured_hr: "Não",
        operating_status: "Ativa",
      },
      Portfolio: {
        external_id: "TEST-PROD",
        name: "Produto teste",
        ticket_range: "R$ 60 mil a R$ 220 mil/ano",
      },
      Clientes_Atuais: {
        company_external_id: "TEST-EMP",
        company_name: "Empresa teste",
        solution_external_id: "TEST-PROD",
        customer_status: "Churn",
        annual_ticket: "60.000,50",
        nps: "0",
      },
      Decisores_Canais: {
        company_external_id: "TEST-EMP",
        channel: "rh@teste.invalid",
        identified: "Não",
      },
      Sinais_Publicos: {
        company_external_id: "TEST-EMP",
        evidence: "Texto integral; com separador e\nquebra de linha",
        strength: "Alto",
        date: "03/10/2026",
        url: "https://teste.invalid",
      },
      Oportunidades_Historico: {
        external_id: "TEST-OPP",
        solution_external_id: "TEST-PROD",
        company_external_id: "TEST-EMP",
        outcome: "Perdida",
        cycle_days: "0",
        sponsor: "Patrocinador sem vínculo nominal",
      },
      ICP_Criterios: {
        criterion: "Porte",
        description: "200 ou mais pessoas",
        weight: "100",
      },
      Regras_Score_Exemplo: {
        external_id: "REG-TEST",
        criterion: "Sinal recente",
        weight: "100",
      },
      Desqualificadores: {
        external_id: "DESQ-TEST",
        condition: "Sem operação",
        action: "Reduzir score",
        reason: "Teste",
      },
    };
    for (const d of [
      "Prospects",
      "Portfolio",
      ...datasetNames.filter((d) => !["Prospects", "Portfolio"].includes(d)),
    ] as Dataset[]) {
      const p = previewCSV(d, d + ".csv", csv(d, [examples[d]]), s);
      expect(p.errors, d).toEqual([]);
      expect(p.counts.invalid, d + JSON.stringify(p.rows)).toBe(0);
      importPreview(s, actor, p, uid());
      const record = s.records.find(
        (r) =>
          r.dataset === d &&
          r.origins.some((origin) => origin.fileName === d + ".csv"),
      )!;
      expect(Object.keys(record.origins[0].raw)).toEqual(
        DATASETS[d].fields.map((f) => f.label),
      );
      for (const f of DATASETS[d].fields)
        expect(Object.hasOwn(record.data, f.key)).toBe(true);
    }
    expect(s.records).toHaveLength(10);
    expect(s.rulesets).toHaveLength(0);
    expect(
      s.records.find((r) => r.dataset === "Prospects")!.data,
    ).toMatchObject({
      employees: 1200,
      commercial_status: "Ex-cliente",
      operating_status: "Ativa",
      structured_hr: "Não",
    });
    expect(
      s.records.find((r) => r.dataset === "Clientes_Atuais")!.data,
    ).toMatchObject({
      customer_status: "Churn",
      annual_ticket: 60000.5,
      nps: 0,
    });
    expect(
      s.records.find((r) => r.dataset === "Decisores_Canais")!.data.name,
    ).toBeNull();
    expect(s.evaluations[0].icp.status).toBe("unconfigured");
  });
  it("distingue nulo, zero, Não e Não identificado", () => {
    const f = fieldsFor("Prospects");
    expect(
      parseCell(
        "",
        f.find((x) => x.key === "employees")!,
      ),
    ).toBeNull();
    expect(
      parseCell(
        "0",
        f.find((x) => x.key === "employees")!,
      ),
    ).toBe(0);
    expect(
      parseCell(
        "Não",
        f.find((x) => x.key === "structured_hr")!,
      ),
    ).toBe("Não");
    expect(
      parseCell(
        "Não identificado",
        f.find((x) => x.key === "growth")!,
      ),
    ).toBeNull();
    expect(() =>
      parseCell("31/02/2026", { key: "date", label: "Data", type: "date" }),
    ).toThrow("data válida");
  });
  it("bloqueia XLSX, colunas desconhecidas e referências sem ID correspondente", () => {
    const s = emptyWorkspace();
    company(s, { external_id: "TEST-ID", name: "Nome igual" });
    expect(() => previewCSV("Prospects", "base.xlsx", "", s)).toThrow("XLSX");
    const invalid = previewCSV(
      "Decisores_Canais",
      "c.csv",
      csv("Decisores_Canais", [
        { company_external_id: "ID-INEXISTENTE", company_name: "Nome igual" },
      ]),
      s,
    );
    expect(invalid.counts.invalid).toBe(1);
    expect(invalid.rows[0].issues.join()).toContain("não encontrada");
    const text = csv("Prospects", [
      { external_id: "NOVA", name: "Nova" },
    ]).replace("ID Empresa;", "Extra;ID Empresa;");
    expect(previewCSV("Prospects", "x.csv", text, s).errors.join()).toContain(
      "Colunas não reconhecidas",
    );
  });
  it("detecta duplicidade e conflitos, preservando a origem sem duplicar na repetição", () => {
    const s = emptyWorkspace();
    const text = csv("Prospects", [{ external_id: "ID", name: "Teste" }]);
    const p = previewCSV("Prospects", "teste.csv", text, s);
    const batch = uid();
    importPreview(s, actor, p, batch);
    importPreview(s, actor, p, batch);
    expect(s.records).toHaveLength(1);
    expect(s.records[0].origins).toHaveLength(1);
    expect(s.imports).toHaveLength(1);
    expect(previewCSV("Prospects", "teste.csv", text, s).counts.duplicate).toBe(
      1,
    );
    const conflict = previewCSV(
      "Prospects",
      "teste.csv",
      csv("Prospects", [{ external_id: "ID", name: "Mudou" }]),
      s,
    );
    expect(conflict.counts.conflict).toBe(1);
    expect(() => importPreview(s, actor, conflict, uid())).toThrow("conflitos");
  });
});
