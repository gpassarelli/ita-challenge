import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { actor, company, emptyWorkspace, revision, run, uid } from "./fixtures";
import type { AgentRun, Workspace } from "../src/lib/domain/types";
let db: PGlite;
let state: Workspace;
let execution: AgentRun;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key); insert into auth.users values ('${actor}');`);
  for (const file of [
    "202610030001_workspace.sql",
    "202610090001_workspace_patch.sql",
    "202610090002_workspace_conflict.sql",
    "202610100001_agent_processing.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
}, 30000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(
    "truncate records, workspace_entries, score_history cascade; update workspace_meta set version=0;",
  );
  state = emptyWorkspace();
  for (let i = 0; i < 120; i++) company(state);
  execution = run(state.records[0], {
    status: "running",
    workflowId: "test",
    companyIds: state.records.map((r) => r.id),
    items: state.records.map((r) => ({
      companyId: r.id,
      status: "queued",
      error: null,
      revisionId: null,
    })),
  });
  state.runs.push(execution);
  state.audits = [];
  await db.query("select commit_workspace(0,$1,$2::jsonb)", [
    actor,
    JSON.stringify(state),
  ]);
});
async function commit(
  before: AgentRun,
  next: AgentRun,
  revisions: unknown[] = [],
  audits: unknown[] = [],
) {
  return db.query(
    "select commit_agent_patch($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb) version",
    [
      actor,
      execution.id,
      JSON.stringify(before),
      JSON.stringify(next),
      JSON.stringify(revisions),
      JSON.stringify(audits),
    ],
  );
}
async function readRun() {
  return (
    await db.query<{ run: AgentRun }>("select read_agent_run($1) run", [
      execution.id,
    ])
  ).rows[0].run;
}

it("lê somente o contexto da empresa e não agrega o workspace inteiro", async () => {
  const result = (
    await db.query<{ state: Workspace }>(
      "select read_agent_context($1,$2) state",
      [execution.id, state.records[0].id],
    )
  ).rows[0].state;
  expect(result.records.map((r) => r.id)).toEqual([state.records[0].id]);
  expect(result.runs).toHaveLength(1);
  expect(result.runs[0].items).toHaveLength(1);
  expect(
    result.evaluations.every((e) => e.companyId === state.records[0].id),
  ).toBe(true);
  const progress = (
    await db.query<{ state: Workspace }>(
      "select read_agent_context($1,null) state",
      [execution.id],
    )
  ).rows[0].state;
  expect(progress.records).toEqual([]);
  expect(progress.revisions).toEqual([]);
});

it("mescla progresso de empresas distintas a partir da mesma versão", async () => {
  const first = structuredClone(execution),
    second = structuredClone(execution);
  first.items[0].status = "running";
  second.items[1].status = "running";
  const history = (await db.query("select count(*)::int n from score_history"))
    .rows;
  await commit(execution, first);
  await commit(execution, second);
  const saved = await readRun();
  expect(saved.items.slice(0, 2).map((i) => i.status)).toEqual([
    "running",
    "running",
  ]);
  expect((await db.query("select count(*)::int n from records")).rows).toEqual([
    { n: 120 },
  ]);
  expect(
    (await db.query("select count(*)::int n from score_history")).rows,
  ).toEqual(history);
  await expect(
    db.query("select commit_workspace_patch(1,$1,$2::jsonb)", [
      actor,
      JSON.stringify({ runs: [execution] }),
    ]),
  ).rejects.toMatchObject({ code: "PT409" });
});

it("rejeita conflito na mesma empresa e mantém a alteração já salva", async () => {
  const first = structuredClone(execution),
    second = structuredClone(execution);
  first.items[0].status = "running";
  second.items[0].status = "failed";
  await commit(execution, first);
  await expect(commit(execution, second)).rejects.toMatchObject({
    code: "PT409",
  });
  expect((await readRun()).items[0].status).toBe("running");
});

it("um cancelamento impede uma gravação feita com snapshot antigo", async () => {
  const cancelled = structuredClone(execution);
  cancelled.status = "cancelled";
  cancelled.items.forEach((i) => {
    i.status = "cancelled";
  });
  await db.query("select commit_workspace_patch(1,$1,$2::jsonb)", [
    actor,
    JSON.stringify({ runs: [cancelled] }),
  ]);
  const next = structuredClone(execution);
  next.items[0].status = "running";
  await expect(commit(execution, next)).rejects.toMatchObject({
    code: "PT409",
  });
  expect((await readRun()).status).toBe("cancelled");
});

it("salva revisão, auditoria e conclusão atomicamente sem duplicar um replay", async () => {
  const result = revision(state.records[0], { runId: execution.id });
  const next = structuredClone(execution);
  next.items[0].status = "completed";
  next.items[0].revisionId = result.id;
  const audit = {
    id: uid(),
    actor,
    action: "Análise concluída",
    entityId: result.id,
    at: new Date().toISOString(),
    before: null,
    after: null,
  };
  await commit(execution, next, [result], [audit]);
  await commit(execution, next, [result], [audit]);
  expect(
    (
      await db.query(
        "select collection,count(*)::int n from workspace_entries where collection in ('revisions','audits') group by collection order by collection",
      )
    ).rows,
  ).toEqual([
    { collection: "audits", n: 1 },
    { collection: "revisions", n: 1 },
  ]);
  expect((await readRun()).items[0].revisionId).toBe(result.id);
});

it("revalida pendências concorrentes e reverte revisão, auditoria e progresso", async () => {
  const existing = revision(state.records[0]);
  await db.query("select commit_workspace_patch(1,$1,$2::jsonb)", [
    actor,
    JSON.stringify({ revisions: [existing] }),
  ]);
  const result = revision(state.records[0], { runId: execution.id });
  const next = structuredClone(execution);
  next.items[0].status = "completed";
  next.items[0].revisionId = result.id;
  await expect(commit(execution, next, [result])).rejects.toMatchObject({
    code: "PT422",
  });
  expect((await readRun()).items[0].status).toBe("queued");
  expect(
    (
      await db.query(
        "select count(*)::int n from workspace_entries where collection='revisions'",
      )
    ).rows,
  ).toEqual([{ n: 1 }]);
});

it("funções de agente não são acessíveis a clientes", async () => {
  for (const role of ["anon", "authenticated", "service_role"])
    for (const fn of [
      "public.read_agent_context(uuid,uuid)",
      "public.commit_agent_patch(uuid,uuid,jsonb,jsonb,jsonb,jsonb)",
    ])
      expect(
        (
          await db.query<{ allowed: boolean }>(
            "select has_function_privilege($1,$2,'execute') allowed",
            [role, fn],
          )
        ).rows[0].allowed,
      ).toBe(role === "service_role");
});

it("mescla um patch esparso sem substituir as outras 119 empresas", async () => {
  const before = { ...execution, items: [execution.items[80]] };
  const next = structuredClone(before);
  next.items[0].status = "running";
  await commit(before, next);
  const saved = await readRun();
  expect(saved.items).toHaveLength(120);
  expect(saved.items[80].status).toBe("running");
  expect(saved.items.filter((item) => item.status === "queued")).toHaveLength(
    119,
  );
});
