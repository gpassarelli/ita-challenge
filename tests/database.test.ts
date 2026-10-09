import { archiveRun } from "../src/lib/domain/agent-run-mutations";
import type { Workspace } from "../src/lib/domain/types";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import {
  actor,
  run,
  company,
  emptyWorkspace,
  uid,
  activate,
  criterion,
} from "./fixtures";
import {
  CALCULATION_VERSION,
  editableCriterion,
  needsRecalculation,
  recalculate,
} from "../src/lib/domain/scoring";
import { saveRecord } from "../src/lib/domain/mutations";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); insert into auth.users values ('" +
      actor +
      "');",
  );
  for (const file of [
    "202610030001_workspace.sql",
    "202610030002_typed_views.sql",
    "202610040001_contracts_portfolio.sql",
  ])
    await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("Postgres real isolado · transações, relações e acesso", () => {
  it("migrações não carregam dados comerciais; projeções cobrem todas as 13 abas", async () => {
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.records",
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from information_schema.views where table_schema='public'",
        )
      ).rows[0].n,
    ).toBe(13);
    const empty = (
      await db.query<{ state: unknown }>("select public.read_workspace() state")
    ).rows[0].state;
    expect(empty).toEqual(emptyWorkspace());
  });
  it("salva relacionamentos, histórico de notas e campos estruturados atomicamente", async () => {
    const s = emptyWorkspace();
    const c = company(s, {
      external_id: "DB-TEST",
      employees: 450,
      structured_hr: "Não",
    });
    const p = saveRecord(s, actor, "Portfolio", {
      external_id: "PROD-DB",
      name: "Produto DB",
    });
    saveRecord(s, actor, "Clientes_Atuais", {
      company_external_id: c.externalKey,
      solution_external_id: p.externalKey,
      customer_status: "Churn",
      annual_ticket: 0,
    });
    const result = await db.query<{ v: number }>(
      "select public.commit_workspace($1,$2,$3::jsonb) v",
      [0, actor, JSON.stringify(s)],
    );
    expect(Number(result.rows[0].v)).toBe(1);
    const rows = await db.query(
      "select employees,structured_hr,commercial_status from companies",
    );
    expect(rows.rows[0]).toEqual({
      employees: 450,
      structured_hr: "Não",
      commercial_status: "Ex-cliente",
    });
    expect(
      (
        await db.query(
          "select annual_ticket,customer_status from customer_profiles",
        )
      ).rows[0],
    ).toEqual({ annual_ticket: "0", customer_status: "Churn" });
    const linked = (
      await db.query(
        "select o.product_id, o.solution_external_id, o.outcome, c.customer_status from opportunities o join customer_profiles c on c.opportunity_id = o.id::text",
      )
    ).rows;
    expect(linked).toEqual([
      {
        product_id: p.id,
        solution_external_id: p.externalKey,
        outcome: "Ganha",
        customer_status: "Churn",
      },
    ]);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from score_history",
        )
      ).rows[0].n,
    ).toBe(1);
    await expect(
      db.query("select public.commit_workspace($1,$2,$3::jsonb)", [
        0,
        actor,
        JSON.stringify(s),
      ]),
    ).rejects.toThrow("WORKSPACE_CONFLICT");
    expect(
      (await db.query<{ n: number }>("select count(*)::int n from records"))
        .rows[0].n,
    ).toBe(4);
  });
  it("reverte a transação inteira quando uma relação está incorreta", async () => {
    const s = (
      await db.query<{ state: ReturnType<typeof emptyWorkspace> }>(
        "select read_workspace() state",
      )
    ).rows[0].state;
    s.records.find((r) => r.dataset === "Clientes_Atuais")!.companyId =
      s.records.find((r) => r.dataset === "Portfolio")!.id;
    await expect(
      db.query("select commit_workspace($1,$2,$3::jsonb)", [
        s.version,
        actor,
        JSON.stringify(s),
      ]),
    ).rejects.toThrow("Relacionamento inválido");
    expect(
      (await db.query<{ v: number }>("select version v from workspace_meta"))
        .rows[0].v,
    ).toBe(1);
  });
  it("nega escrita ao cliente autenticado e acesso anônimo; só o servidor executa mutações", async () => {
    await db.exec("set role authenticated");
    expect(
      (await db.query<{ n: number }>("select count(*)::int n from companies"))
        .rows[0].n,
    ).toBe(1);
    await expect(db.exec("delete from records")).rejects.toThrow(
      "permission denied",
    );
    await expect(db.exec("select read_workspace()")).rejects.toThrow(
      "permission denied",
    );
    await db.exec("reset role; set role anon");
    await expect(db.exec("select * from records")).rejects.toThrow(
      "permission denied",
    );
    await db.exec("reset role");
  });
});

it("preserva referências arquivadas e seus lotes ao salvar apenas o workspace ativo", async () => {
  const { activeWorkspace } = await import("../src/lib/domain/workspace");
  const before = (
    await db.query<{ state: ReturnType<typeof emptyWorkspace> }>(
      "select read_workspace() state",
    )
  ).rows[0].state;
  const c = before.records.find((r) => r.dataset === "Prospects")!;
  const legacyIds: string[] = [];
  for (const dataset of [
    "Ranking_Referencia",
    "Casos_Validacao",
    "Indicadores_Atuais",
    "Dicionario_Dados",
  ]) {
    const id = uid();
    legacyIds.push(id);
    before.records.push({
      ...c,
      id,
      dataset: dataset as typeof c.dataset,
      externalKey: id,
      companyId: c.id,
      data: { original: "Não identificado" },
    });
    before.imports.push({
      id: uid(),
      dataset: dataset as typeof c.dataset,
      fileName: dataset + ".csv",
      count: 1,
      skipped: 0,
      actor,
      at: c.createdAt,
    });
  }
  await db.query("select commit_workspace($1,$2,$3::jsonb)", [
    before.version,
    actor,
    JSON.stringify(before),
  ]);
  const raw = (
    await db.query<{ state: ReturnType<typeof emptyWorkspace> }>(
      "select read_workspace() state",
    )
  ).rows[0].state;
  const archived = raw.records.filter((r) => legacyIds.includes(r.id));
  const active = activeWorkspace(raw);
  expect(active.records.some((r) => legacyIds.includes(r.id))).toBe(false);
  expect(active.imports).toEqual([]);
  const currentCompany = active.records.find((r) => r.id === c.id)!;
  saveRecord(
    active,
    actor,
    "Prospects",
    { ...currentCompany.data, notes: "Alteração legítima" },
    c.id,
    currentCompany.version,
  );
  await db.query("select commit_workspace($1,$2,$3::jsonb)", [
    active.version,
    actor,
    JSON.stringify(active),
  ]);
  const after = (
    await db.query<{ state: ReturnType<typeof emptyWorkspace> }>(
      "select read_workspace() state",
    )
  ).rows[0].state;
  expect(after.records.filter((r) => legacyIds.includes(r.id))).toEqual(
    archived,
  );
  expect(after.imports).toEqual(raw.imports);
  expect(
    activeWorkspace(after).records.some((r) => legacyIds.includes(r.id)),
  ).toBe(false);
});

it("preserva histórico anterior e persiste alternativas e versão do novo cálculo", async () => {
  const read = async () =>
    (
      await db.query<{ state: ReturnType<typeof emptyWorkspace> }>(
        "select read_workspace() state",
      )
    ).rows[0].state;
  const commit = async (state: ReturnType<typeof emptyWorkspace>) => {
    await db.query("select commit_workspace($1,$2,$3::jsonb)", [
      state.version,
      actor,
      JSON.stringify(state),
    ]);
    return read();
  };
  let state = await read();
  const legacy = [
    criterion({ weight: 40 }),
    criterion({
      field: "growth",
      operator: "equals",
      value: "Alto",
      weight: 60,
    }),
  ];
  activate(state, legacy);
  delete state.evaluations[0].calculationVersion;
  state.evaluations[0].icp.value = 100;
  const oldEvaluation = structuredClone(state.evaluations[0]);
  state = await commit(state);
  expect(needsRecalculation(state)).toBe(true);
  recalculate(state);
  state = await commit(state);
  expect(state.evaluations[0]).toMatchObject({
    calculationVersion: CALCULATION_VERSION,
    icp: { value: 40, coverage: 40 },
  });
  const history = (
    await db.query<{ payload: unknown }>(
      "select payload from score_history order by id",
    )
  ).rows.map((r) => r.payload);
  expect(history).toContainEqual(oldEvaluation);
  expect(history.at(-1)).toEqual(state.evaluations[0]);
  const next = legacy.map(editableCriterion);
  next[1] = criterion({
    weight: 60,
    alternatives: [
      {
        source: "signal",
        filters: [
          { field: "signal_type", operator: "equals", value: "Expansão" },
        ],
        minStrength: "Alto",
        recentDays: 90,
      },
    ],
  });
  const rules = activate(state, next);
  state = await commit(state);
  expect(state.rulesets.find((r) => r.id === rules.id)).toEqual(rules);
  const count = (
    await db.query<{ n: number }>("select count(*)::int n from score_history")
  ).rows[0].n;
  recalculate(state);
  await commit(state);
  expect(
    (await db.query<{ n: number }>("select count(*)::int n from score_history"))
      .rows[0].n,
  ).toBe(count);
});

it("persiste metadados de arquivo e exclusões no JSON existente sem migração", async () => {
  const state = (
    await db.query<{ state: Workspace }>("select public.read_workspace() state")
  ).rows[0].state;
  const prospect = company(state);
  const execution = run(prospect, {
    status: "failed",
    items: [
      {
        companyId: prospect.id,
        status: "failed",
        error: "Falha preservada",
        revisionId: null,
      },
    ],
    skippedCompanies: [{ companyId: uid(), revisionIds: [uid()] }],
  });
  state.runs.push(execution);
  archiveRun(state, actor, execution.id);
  await db.query("select public.commit_workspace($1,$2,$3::jsonb)", [
    state.version,
    actor,
    JSON.stringify(state),
  ]);
  const restored = (
    await db.query<{ state: Workspace }>("select public.read_workspace() state")
  ).rows[0].state;
  expect(restored.runs.find((r) => r.id === execution.id)).toEqual(execution);
});
