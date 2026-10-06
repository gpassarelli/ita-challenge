import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import Papa from "papaparse";
import {
  DATASETS,
  fieldsFor,
  isDataset,
  parseCell,
  type Dataset,
  type Field,
} from "../src/lib/domain/catalog";
import { canonical, previewCSV } from "../src/lib/domain/csv";
import {
  importPreview,
  saveRecord,
  moveOpportunity,
} from "../src/lib/domain/mutations";
import { contactKind, isMissing } from "../src/lib/domain/values";
import { filterMatches, listValue } from "../src/lib/domain/lists";
import { fact } from "../src/lib/domain/scoring";
import { agentContext, validatedChanges } from "../src/lib/domain/agents";
import { commandSchema } from "../src/lib/domain/commands";
import { actor, company, emptyWorkspace, product, run, uid } from "./fixtures";

const csv = (dataset: Dataset, rows: Record<string, unknown>[]) =>
  Papa.unparse(
    {
      fields: DATASETS[dataset].fields.map((field) => field.label),
      data: rows.map((row) =>
        DATASETS[dataset].fields.map((field) => row[field.key] ?? ""),
      ),
    },
    { delimiter: ";" },
  );

const missing = [
  "Não identificado",
  " NÃO IDENTIFICADO ",
  "nao identificado",
  "Não\u00a0  identificado",
  "Na\u0303o identificado",
];
describe("valores ausentes", () => {
  it.each(missing)(
    "normaliza %s antes da validação de qualquer tipo",
    (value) => {
      for (const type of [
        "text",
        "number",
        "integer",
        "date",
        "choice",
      ] as Field["type"][]) {
        const field: Field = {
          key: "value",
          label: "Valor",
          type,
          ...(type === "choice" ? { choices: ["Sim", "Não"] } : {}),
        };
        expect(parseCell(value, field)).toBeNull();
        expect(() => parseCell(value, { ...field, required: true })).toThrow(
          "obrigatório",
        );
      }
    },
  );
  it("preserva Não informado, outras frases, zero e Não", () => {
    const text: Field = { key: "text", label: "Texto", type: "text" };
    for (const value of [
      "Não informado",
      "Não identificada",
      "N/A",
      "null",
      "Fornecedor não identificado na análise",
    ])
      expect(parseCell(value, text)).toBe(value);
    expect(parseCell("0", { ...text, type: "number" })).toBe(0);
    expect(
      parseCell("Não", { ...text, type: "choice", choices: ["Sim", "Não"] }),
    ).toBe("Não");
    expect(isMissing(false)).toBe(false);
    expect(isMissing(0)).toBe(false);
    expect(parseCell("  ", text)).toBeNull();
    expect(
      filterMatches("Não identificado", {
        field: "growth",
        operator: "exists",
        value: "",
      }),
    ).toBe(false);
  });
  it("normaliza cadastro e propostas de IA sem alterar o snapshot original", () => {
    const state = emptyWorkspace();
    const c = company(state, {
      growth: "Não identificado",
      domain: "Não identificado",
    });
    expect(c.data.growth).toBeNull();
    expect(c.data.domain).toBeNull();
    const changes = validatedChanges(
      {
        explanation: "Sem evidência",
        warnings: [],
        changes: [
          {
            field: "employees",
            after: "Não identificado",
            reason: "Sem dados",
            evidenceIds: [c.id],
          },
        ],
      },
      { ...c, data: { ...c.data, employees: 20 } },
      [c],
    );
    expect(changes[0].after).toBeNull();
    expect(
      fieldsFor("Prospects").flatMap((f) => f.choices ?? []),
    ).not.toContain("Não identificado");
  });
});

describe("pessoas e canais no CSV", () => {
  it("importa pessoas e canais, ignora linhas sem contato e preserva a origem", () => {
    const state = emptyWorkspace();
    const c = company(state);
    const base = {
      company_external_id: c.externalKey,
      company_name: c.data.name,
      role: "RH",
      identified: "Não",
    };
    const text = csv("Decisores_Canais", [
      { ...base, name: "Ana", channel: "Não identificado" },
      { ...base, name: "Não identificado", channel: "rh@empresa.invalid" },
      {
        ...base,
        name: "Não identificado",
        channel: "Não identificado",
        source: "Planilha",
      },
    ]);
    const preview = previewCSV("Decisores_Canais", "pessoas.csv", text, state);
    expect(preview.counts).toEqual({
      new: 2,
      duplicate: 0,
      invalid: 0,
      conflict: 0,
      ignored: 1,
    });
    const batch = uid();
    importPreview(state, actor, preview, batch);
    importPreview(state, actor, preview, batch);
    const contacts = state.records.filter(
      (r) => r.dataset === "Decisores_Canais",
    );
    expect(contacts.map((r) => contactKind(r.data))).toEqual([
      "person",
      "channel",
    ]);
    expect(contacts[0].data.channel).toBeNull();
    expect(contacts[1].data.name).toBeNull();
    expect(contacts[1].origins[0].raw["Contato fictício"]).toBe(
      "Não identificado",
    );
    expect(state.imports[0]).toMatchObject({
      count: 2,
      skipped: 1,
      ignored: 1,
    });
    expect(
      previewCSV("Decisores_Canais", "pessoas.csv", text, state).counts,
    ).toMatchObject({ duplicate: 2, ignored: 1, new: 0 });
  });
  it("não grava lotes inteiramente ignorados e mantém erros reais bloqueantes", () => {
    const state = emptyWorkspace();
    const c = company(state);
    const preview = previewCSV(
      "Decisores_Canais",
      "vazio.csv",
      csv("Decisores_Canais", [
        {
          company_external_id: c.externalKey,
          role: "RH",
          name: "Não identificado",
        },
      ]),
      state,
    );
    const before = structuredClone(state);
    expect(() => importPreview(state, actor, preview, uid())).toThrow(
      "Não há registros",
    );
    expect(state).toEqual(before);
    const invalid = previewCSV(
      "Decisores_Canais",
      "invalid.csv",
      csv("Decisores_Canais", [
        { company_external_id: "INEXISTENTE", name: "Não identificado" },
      ]),
      state,
    );
    expect(invalid.counts.invalid).toBe(1);
    expect(() => importPreview(state, actor, invalid, uid())).toThrow(
      "Corrija",
    );
    expect(() =>
      saveRecord(state, actor, "Decisores_Canais", {
        company_external_id: c.externalKey,
        role: "RH",
      }),
    ).toThrow("nome da pessoa ou um canal");
  });
  it("encontra duplicatas antigas sem reescrever os valores ou identificadores", () => {
    const state = emptyWorkspace();
    const c = company(state);
    const contact = saveRecord(state, actor, "Decisores_Canais", {
      company_external_id: c.externalKey,
      channel: "rh@empresa.invalid",
    });
    contact.data.name = "Não identificado";
    contact.externalKey = createHash("sha256")
      .update(
        canonical([
          c.externalKey,
          contact.data.channel,
          null,
          "Não identificado",
        ]),
      )
      .digest("hex");
    const originalData = structuredClone(contact.data),
      originalKey = contact.externalKey;
    const preview = previewCSV(
      "Decisores_Canais",
      "canal.csv",
      csv("Decisores_Canais", [
        {
          company_external_id: c.externalKey,
          channel: "rh@empresa.invalid",
          name: "",
        },
      ]),
      state,
    );
    expect(preview.counts.duplicate).toBe(1);
    importPreview(state, actor, preview, uid());
    expect(state.records).toHaveLength(2);
    expect(contact.data).toEqual(originalData);
    expect(contact.externalKey).toBe(originalKey);
    expect(contact.origins).toHaveLength(1);
  });
  it("não considera canal genérico como decisor ou patrocinador nominal", () => {
    const state = emptyWorkspace();
    const c = company(state);
    const channel = saveRecord(state, actor, "Decisores_Canais", {
      company_external_id: c.externalKey,
      channel: "rh@empresa.invalid",
      name: "Não identificado",
      identified: "Sim",
    });
    expect(fact(state, c, "identified_contact", "2026-10-04").value).toBeNull();
    expect(listValue(state, c, "has_decisor")).toBe("Não");
    expect(() =>
      saveRecord(state, actor, "Oportunidades_Historico", {
        external_id: "OPP",
        solution_external_id: product(state).externalKey,
        company_external_id: c.externalKey,
        outcome: "Em negociação",
        sponsor_contact_id: channel.id,
      }),
    ).toThrow("nome informado");
    const context = agentContext(
      state,
      run(c, { contactId: channel.id }),
      c.id,
    );
    expect(context.input.records[0]).toMatchObject({
      contactKind: "channel",
      data: { name: null, channel: "rh@empresa.invalid" },
    });
    const person = saveRecord(state, actor, "Decisores_Canais", {
      company_external_id: c.externalKey,
      name: "Ana",
      identified: "Não",
    });
    expect(fact(state, c, "identified_contact", "2026-10-04").value).toBe(
      "Não",
    );
    saveRecord(
      state,
      actor,
      "Decisores_Canais",
      { ...person.data, identified: "Sim" },
      person.id,
      person.version,
    );
    expect(fact(state, c, "identified_contact", "2026-10-04").value).toBe(
      "Sim",
    );
  });
});

describe("tickets e oportunidades", () => {
  const field = fieldsFor("Oportunidades_Historico").find(
    (f) => f.key === "estimated_ticket",
  )!;
  it.each([
    ["R$ 60.000,50", 60000.5],
    ["R$\u00a01.234.567,89", 1234567.89],
    ["R$60.000", 60000],
    ["60.000,50", 60000.5],
    ["60000.50", 60000.5],
    [60000.5, 60000.5],
    ["R$ 0,00", 0],
  ])("converte %s em %s", (input, expected) => {
    expect(parseCell(input, field)).toBe(expected);
    expect(
      parseCell(
        input,
        fieldsFor("Clientes_Atuais").find((f) => f.key === "annual_ticket")!,
      ),
    ).toBe(expected);
  });
  it.each([
    "R$",
    "R$ 1.23,45",
    "R$ 1,234,56",
    "R$ -1,00",
    "USD 100",
    "R$ 1.000,00 reais",
  ])("rejeita valor inválido: %s", (input) => {
    expect(() => parseCell(input, field)).toThrow();
  });
  it("importa negócios, mantém centavos e só define cliente com oportunidade ganha", () => {
    const state = emptyWorkspace();
    const c = company(state);
    const p = product(state);
    const text = csv("Oportunidades_Historico", [
      {
        external_id: "OPP-1",
        solution_external_id: p.externalKey,
        company_external_id: c.externalKey,
        outcome: "Ganha",
        estimated_ticket: "R$ 60.000,50",
      },
      {
        external_id: "OPP-2",
        solution_external_id: p.externalKey,
        company_external_id: c.externalKey,
        outcome: "Perdida",
        estimated_ticket: "R$ 0,00",
      },
    ]);
    const preview = previewCSV(
      "Oportunidades_Historico",
      "negocios.csv",
      text,
      state,
    );
    expect(preview.counts.new).toBe(2);
    expect(preview.rows[0].data.estimated_ticket).toBe(60000.5);
    importPreview(state, actor, preview, uid());
    expect(c.data.commercial_status).toBe("Cliente ativo");
    const opportunities = state.records.filter(
      (r) => r.dataset === "Oportunidades_Historico",
    );
    expect(opportunities).toHaveLength(2);
    expect(opportunities[0].origins[0].raw["Ticket estimado"]).toBe(
      "R$ 60.000,50",
    );
    expect(state.records.some((r) => r.dataset === "Clientes_Atuais")).toBe(
      true,
    );
    expect(
      previewCSV("Oportunidades_Historico", "negocios.csv", text, state).counts
        .duplicate,
    ).toBe(2);
    const contract = state.records.find(
      (r) => r.dataset === "Clientes_Atuais",
    )!;
    expect(() =>
      moveOpportunity(
        state,
        actor,
        opportunities[0].id,
        "Perdida",
        opportunities[0].version,
      ),
    ).toThrow("contratação");
    saveRecord(
      state,
      actor,
      "Clientes_Atuais",
      { ...contract.data, customer_status: "Churn" },
      contract.id,
      contract.version,
    );
    expect(c.data.commercial_status).toBe("Ex-cliente");
    expect(opportunities[0].data.outcome).toBe("Ganha");
  });
  it("transfere negócios em negociação sem transferir uma contratação existente", () => {
    const state = emptyWorkspace();
    const a = company(state),
      b = company(state),
      p = product(state);
    const opportunity = saveRecord(state, actor, "Oportunidades_Historico", {
      external_id: "TRANSFER",
      company_external_id: a.externalKey,
      solution_external_id: p.externalKey,
      outcome: "Em negociação",
    });
    const moved = saveRecord(
      state,
      actor,
      "Oportunidades_Historico",
      { ...opportunity.data, company_external_id: b.externalKey },
      opportunity.id,
      opportunity.version,
    );
    moveOpportunity(state, actor, moved.id, "Ganha", moved.version);
    expect(a.data.commercial_status).toBe("Prospect");
    expect(b.data.commercial_status).toBe("Cliente ativo");
  });
  it("contratação cria uma vitória, mas seleção manual de status não cria cliente", () => {
    const state = emptyWorkspace();
    const c = company(state, { commercial_status: "Cliente ativo" });
    expect(c.data.commercial_status).toBe("Prospect");
    saveRecord(state, actor, "Clientes_Atuais", {
      solution_external_id: product(state).externalKey,
      company_external_id: c.externalKey,
      customer_status: "Cliente ativo",
    });
    expect(c.data.commercial_status).toBe("Cliente ativo");
  });
});

describe("datasets aposentados", () => {
  it.each([
    "Ranking_Referencia",
    "Casos_Validacao",
    "Indicadores_Atuais",
    "Dicionario_Dados",
  ])("bloqueia novas operações em %s", (dataset) => {
    expect(isDataset(dataset)).toBe(false);
    expect(
      commandSchema.safeParse({ type: "record", dataset, data: {} }).success,
    ).toBe(false);
    expect(() =>
      previewCSV(dataset as Dataset, "old.csv", "", emptyWorkspace()),
    ).toThrow("não permitido");
    expect(() =>
      saveRecord(emptyWorkspace(), actor, dataset as Dataset, {}),
    ).toThrow("não permitido");
  });
});
