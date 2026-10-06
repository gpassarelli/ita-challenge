import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { DATASETS } from "../src/lib/domain/catalog";
import { previewCSV } from "../src/lib/domain/csv";
import {
  importPreview,
  saveRecord,
  moveOpportunity,
} from "../src/lib/domain/mutations";
import { contractFor } from "../src/lib/domain/contracts";
import { fact } from "../src/lib/domain/scoring";
import { actor, company, emptyWorkspace, product, uid } from "./fixtures";

const customerCSV = (rows: Record<string, unknown>[]) =>
  Papa.unparse(
    {
      fields: DATASETS.Clientes_Atuais.fields.map((field) => field.label),
      data: rows.map((row) =>
        DATASETS.Clientes_Atuais.fields.map((field) => row[field.key] ?? ""),
      ),
    },
    { delimiter: ";" },
  );

describe("contratações e oportunidades por solução", () => {
  it("importa duas soluções da mesma empresa e preserva status, ticket, vínculos e origem", () => {
    const state = emptyWorkspace(),
      c = company(state),
      a = product(state),
      b = product(state);
    const text = customerCSV([
      {
        company_external_id: c.externalKey,
        solution_external_id: a.externalKey,
        customer_status: "Cliente ativo",
        annual_ticket: "R$ 60.000,50",
        internal_fit: "Alto",
        nps: "9",
      },
      {
        company_external_id: c.externalKey,
        solution_external_id: b.externalKey,
        customer_status: "Churn",
        annual_ticket: "R$ 10.000,00",
      },
    ]);
    const preview = previewCSV("Clientes_Atuais", "clientes.csv", text, state);
    expect(preview.counts).toMatchObject({ new: 2, conflict: 0, invalid: 0 });
    const batch = uid();
    importPreview(state, actor, preview, batch);
    const contracts = state.records.filter(
      (r) => r.dataset === "Clientes_Atuais",
    );
    const deals = state.records.filter(
      (r) => r.dataset === "Oportunidades_Historico",
    );
    expect(contracts).toHaveLength(2);
    expect(deals).toHaveLength(2);
    expect(new Set(contracts.map((r) => r.externalKey)).size).toBe(2);
    for (const contract of contracts) {
      const deal = deals.find((r) => r.id === contract.data.opportunity_id)!;
      expect(deal).toMatchObject({
        companyId: c.id,
        productId: contract.productId,
        data: {
          outcome: "Ganha",
          solution_external_id: contract.data.solution_external_id,
          estimated_ticket: contract.data.annual_ticket,
        },
      });
      expect(deal.origins[0]).toMatchObject({
        batchId: batch,
        fileName: "clientes.csv",
      });
      expect(deal.origins[0].raw.Status).toBe(contract.data.customer_status);
    }
    expect(c.data.commercial_status).toBe("Cliente ativo");
    expect(fact(state, c, "annual_ticket", "2026-10-04").value).toBe(60000.5);
    const snapshot = structuredClone(state);
    importPreview(state, actor, preview, batch);
    expect(state).toEqual(snapshot);
    const repeated = previewCSV("Clientes_Atuais", "clientes.csv", text, state);
    expect(repeated.counts.duplicate).toBe(2);
    importPreview(state, actor, repeated, uid());
    expect(state.records).toHaveLength(7);
    expect(deals.map((r) => r.id)).toEqual(
      snapshot.records
        .filter((r) => r.dataset === "Oportunidades_Historico")
        .map((r) => r.id),
    );
    const active = contracts.find((r) => r.productId === a.id)!;
    saveRecord(
      state,
      actor,
      "Clientes_Atuais",
      { ...active.data, customer_status: "Churn" },
      active.id,
      active.version,
    );
    expect(c.data.commercial_status).toBe("Ex-cliente");
    expect(deals.every((r) => r.data.outcome === "Ganha")).toBe(true);
    expect(fact(state, c, "annual_ticket", "2026-10-04").value).toBe(0);
    expect(fact(state, c, "segment_won_history", "2026-10-04").value).toBe(
      "Sim",
    );
  });
  it("exige solução existente em ambos os cadastros e bloqueia o lote sem gravar parcialmente", () => {
    const state = emptyWorkspace(),
      c = company(state),
      p = product(state);
    for (const dataset of [
      "Clientes_Atuais",
      "Oportunidades_Historico",
    ] as const) {
      const data =
        dataset === "Clientes_Atuais"
          ? {
              company_external_id: c.externalKey,
              customer_status: "Cliente ativo",
            }
          : {
              external_id: "NEGOCIO",
              company_external_id: c.externalKey,
              outcome: "Ganha",
            };
      expect(() => saveRecord(state, actor, dataset, data)).toThrow(
        "Solução: campo obrigatório",
      );
      expect(() =>
        saveRecord(state, actor, dataset, {
          ...data,
          solution_external_id: "AUSENTE",
        }),
      ).toThrow("não encontrado");
      expect(() =>
        saveRecord(state, actor, dataset, {
          ...data,
          solution_external_id: "Não identificado",
        }),
      ).toThrow("obrigatório");
    }
    const preview = previewCSV(
      "Clientes_Atuais",
      "clientes.csv",
      customerCSV([
        {
          company_external_id: c.externalKey,
          solution_external_id: p.externalKey,
          customer_status: "Cliente ativo",
        },
        {
          company_external_id: c.externalKey,
          solution_external_id: "AUSENTE",
          customer_status: "Churn",
        },
      ]),
      state,
    );
    const before = structuredClone(state);
    expect(() => importPreview(state, actor, preview, uid())).toThrow(
      "Corrija",
    );
    expect(state).toEqual(before);
  });
  it("não cria contratos durante negociação e ativa uma contratação ao ganhar", () => {
    const state = emptyWorkspace(),
      c = company(state),
      p = product(state);
    const deal = saveRecord(state, actor, "Oportunidades_Historico", {
      external_id: "VENDA",
      company_external_id: c.externalKey,
      solution_external_id: p.externalKey,
      outcome: "Em negociação",
      estimated_ticket: "R$ 1.200,50",
    });
    expect(contractFor(state, deal)).toBeUndefined();
    moveOpportunity(state, actor, deal.id, "Ganha", deal.version);
    const won = state.records.find((r) => r.id === deal.id)!;
    const contract = contractFor(state, won)!;
    expect(contract.data).toMatchObject({
      opportunity_id: won.id,
      customer_status: "Cliente ativo",
      annual_ticket: 1200.5,
    });
    expect(c.data.commercial_status).toBe("Cliente ativo");
    const count = state.records.length;
    moveOpportunity(state, actor, won.id, "Ganha", won.version);
    expect(state.records).toHaveLength(count);
    const churn = saveRecord(
      state,
      actor,
      "Clientes_Atuais",
      { ...contract.data, customer_status: "Churn" },
      contract.id,
      contract.version,
    );
    saveRecord(
      state,
      actor,
      "Oportunidades_Historico",
      { ...won.data, reason: "Atualização de anotação" },
      won.id,
      won.version,
    );
    expect(churn.data.customer_status).toBe("Churn");
    expect(c.data.commercial_status).toBe("Ex-cliente");
    const renewal = saveRecord(state, actor, "Oportunidades_Historico", {
      external_id: "RETORNO",
      company_external_id: c.externalKey,
      solution_external_id: p.externalKey,
      outcome: "Ganha",
    });
    expect(contractFor(state, renewal)!.data.customer_status).toBe(
      "Cliente ativo",
    );
    expect(
      state.records.filter((r) => r.dataset === "Clientes_Atuais"),
    ).toHaveLength(1);
  });
  it("não reescreve valores históricos da oportunidade ao editar a contratação", () => {
    const state = emptyWorkspace(),
      c = company(state),
      p = product(state);
    const contract = saveRecord(state, actor, "Clientes_Atuais", {
      company_external_id: c.externalKey,
      solution_external_id: p.externalKey,
      customer_status: "Cliente ativo",
      annual_ticket: 1000,
    });
    const deal = state.records.find(
      (r) => r.id === contract.data.opportunity_id,
    )!;
    const historical = structuredClone(deal);
    saveRecord(
      state,
      actor,
      "Clientes_Atuais",
      { ...contract.data, customer_status: "Churn", annual_ticket: 2000 },
      contract.id,
      contract.version,
    );
    expect(deal).toEqual(historical);
    expect(() =>
      moveOpportunity(state, actor, deal.id, "Perdida", deal.version),
    ).toThrow("contratação");
  });
  it("reutiliza uma vitória já existente ao importar um cliente legado", () => {
    const state = emptyWorkspace(),
      c = company(state),
      p = product(state);
    const deal = saveRecord(state, actor, "Oportunidades_Historico", {
      external_id: "HISTORICO",
      company_external_id: c.externalKey,
      solution_external_id: p.externalKey,
      outcome: "Em negociação",
      estimated_ticket: 800,
    });
    // Simulates an existing won opportunity imported before contracts were linked.
    deal.data.outcome = "Ganha";
    const preview = previewCSV(
      "Clientes_Atuais",
      "clientes.csv",
      customerCSV([
        {
          company_external_id: c.externalKey,
          solution_external_id: p.externalKey,
          customer_status: "Churn",
          annual_ticket: 1200,
        },
      ]),
      state,
    );
    importPreview(state, actor, preview, uid());
    expect(
      state.records.filter((r) => r.dataset === "Oportunidades_Historico"),
    ).toHaveLength(1);
    expect(contractFor(state, deal)!.data.opportunity_id).toBe(deal.id);
    expect(deal.data.estimated_ticket).toBe(800);
    expect(deal.origins).toHaveLength(0);
    expect(c.data.commercial_status).toBe("Ex-cliente");
  });
  it("detecta conflitos por empresa e solução, sem misturar soluções distintas", () => {
    const state = emptyWorkspace(),
      c = company(state),
      p = product(state);
    const preview = previewCSV(
      "Clientes_Atuais",
      "clientes.csv",
      customerCSV([
        {
          company_external_id: c.externalKey,
          solution_external_id: p.externalKey,
          customer_status: "Cliente ativo",
        },
        {
          company_external_id: c.externalKey,
          solution_external_id: p.externalKey,
          customer_status: "Churn",
        },
      ]),
      state,
    );
    expect(preview.counts.conflict).toBe(1);
    expect(() => importPreview(state, actor, preview, uid())).toThrow(
      "conflitos",
    );
    expect(state.records).toHaveLength(2);
  });
  it("reconhece a chave antiga do cliente sem duplicá-lo nem limpar dados retroativamente", () => {
    const state = emptyWorkspace(),
      c = company(state),
      p = product(state);
    const contract = saveRecord(state, actor, "Clientes_Atuais", {
      company_external_id: c.externalKey,
      solution_external_id: p.externalKey,
      customer_status: "Cliente ativo",
    });
    contract.externalKey = c.externalKey;
    const originalId = contract.id;
    const text = customerCSV([
      {
        company_external_id: c.externalKey,
        solution_external_id: p.externalKey,
        customer_status: "Cliente ativo",
      },
    ]);
    const preview = previewCSV("Clientes_Atuais", "clientes.csv", text, state);
    expect(preview.counts.duplicate).toBe(1);
    importPreview(state, actor, preview, uid());
    expect(
      state.records
        .filter((r) => r.dataset === "Clientes_Atuais")
        .map((r) => r.id),
    ).toEqual([originalId]);
    expect(contract.externalKey).toBe(c.externalKey);
  });
  it("soma tickets ativos e não escolhe arbitrariamente NPS ou fit contraditórios", () => {
    const state = emptyWorkspace(),
      c = company(state),
      a = product(state),
      b = product(state);
    const first = saveRecord(state, actor, "Clientes_Atuais", {
      company_external_id: c.externalKey,
      solution_external_id: a.externalKey,
      customer_status: "Cliente ativo",
      annual_ticket: 100,
      nps: 10,
      internal_fit: "Alto",
    });
    saveRecord(state, actor, "Clientes_Atuais", {
      company_external_id: c.externalKey,
      solution_external_id: b.externalKey,
      customer_status: "Cliente ativo",
      annual_ticket: 200,
      nps: 4,
      internal_fit: "Baixo",
    });
    expect(fact(state, c, "annual_ticket", "2026-10-04").value).toBe(300);
    expect(fact(state, c, "nps", "2026-10-04").value).toBeNull();
    expect(fact(state, c, "internal_fit", "2026-10-04").value).toBeNull();
    saveRecord(
      state,
      actor,
      "Clientes_Atuais",
      { ...first.data, annual_ticket: null },
      first.id,
      first.version,
    );
    expect(fact(state, c, "annual_ticket", "2026-10-04").value).toBeNull();
  });
});
