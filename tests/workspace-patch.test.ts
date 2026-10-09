import { expect, it, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { workspacePatch } from "../src/lib/domain/workspace-patch";
import { actor, company, emptyWorkspace, run, uid } from "./fixtures";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); insert into auth.users values ('${actor}');`,
  );
  for (const file of [
    "202610030001_workspace.sql",
    "202610090001_workspace_patch.sql",
    "202610090002_workspace_conflict.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
}, 30000);
afterAll(async () => {
  await db?.close();
});

it("transmite só coleções alteradas, incluindo inserções, sem regravar o restante", () => {
  const before = emptyWorkspace();
  for (let i = 0; i < 500; i++) company(before);
  const execution = run(before.records[0]);
  before.runs.push(execution);
  const after = structuredClone(before);
  after.runs[0].status = "running";
  expect(workspacePatch(before, after)).toEqual({ runs: [after.runs[0]] });
  expect(workspacePatch(before, before)).toEqual({});
});

it("progresso em base grande toca só uma entrada e preserva cadastros e histórico", async () => {
  const s = emptyWorkspace();
  for (let i = 0; i < 500; i++) company(s);
  const execution = run(s.records[0]);
  s.runs.push(execution);
  await db.query("select public.commit_workspace($1,$2,$3::jsonb)", [
    0,
    actor,
    JSON.stringify(s),
  ]);
  // Count attempted inserts too: the old full-snapshot writer reaches every
  // record even when ON CONFLICT ultimately skips an unchanged update.
  await db.exec(`create table write_counts(kind text); create function count_write() returns trigger language plpgsql as $$ begin insert into write_counts values (TG_TABLE_NAME); return new; end $$;
    create trigger count_records before insert or update on records for each row execute function count_write();
    create trigger count_entries before insert or update on workspace_entries for each row execute function count_write();`);
  const before = (
    await db.query<{ n: number }>("select count(*)::int n from score_history")
  ).rows[0].n;
  execution.status = "running";
  await db.query("select public.commit_workspace_patch($1,$2,$3::jsonb)", [
    1,
    actor,
    JSON.stringify({ runs: [execution] }),
  ]);
  expect(
    (
      await db.query(
        "select kind,count(*)::int n from write_counts group by kind",
      )
    ).rows,
  ).toEqual([{ kind: "workspace_entries", n: 2 }]);
  expect(
    (await db.query<{ n: number }>("select count(*)::int n from records"))
      .rows[0].n,
  ).toBe(500);
  expect(
    (await db.query<{ n: number }>("select count(*)::int n from score_history"))
      .rows[0].n,
  ).toBe(before);
  expect(
    (
      await db.query<{ run: unknown }>("select public.read_agent_run($1) run", [
        execution.id,
      ])
    ).rows[0].run,
  ).toEqual(execution);
});

it("conflitos preservam edição humana e relações inválidas revertem toda a transação", async () => {
  const snapshot = (
    await db.query<{ state: ReturnType<typeof emptyWorkspace> }>(
      "select public.read_workspace() state",
    )
  ).rows[0].state;
  const record = snapshot.records[0];
  record.data.name = "Edição humana";
  record.version++;
  await db.query("select public.commit_workspace_patch($1,$2,$3::jsonb)", [
    snapshot.version,
    actor,
    JSON.stringify({ records: [record] }),
  ]);
  await expect(
    db.query("select public.commit_workspace_patch($1,$2,$3::jsonb)", [
      snapshot.version,
      actor,
      JSON.stringify({ runs: [{ ...snapshot.runs[0], status: "failed" }] }),
    ]),
  ).rejects.toThrow("WORKSPACE_CONFLICT");
  const invalid = { ...record, companyId: uid() };
  await expect(
    db.query("select public.commit_workspace_patch($1,$2,$3::jsonb)", [
      snapshot.version + 1,
      actor,
      JSON.stringify({
        records: [invalid],
        runs: [{ ...snapshot.runs[0], status: "failed" }],
      }),
    ]),
  ).rejects.toThrow();
  expect(
    (
      await db.query<{ name: string }>(
        "select data->>'name' name from records where id=$1",
        [record.id],
      )
    ).rows[0].name,
  ).toBe("Edição humana");
  expect(
    (
      await db.query<{ state: ReturnType<typeof emptyWorkspace> }>(
        "select public.read_workspace() state",
      )
    ).rows[0].state.runs[0].status,
  ).toBe("running");
});

it("novas funções são exclusivas do servidor", async () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const fn of [
      "public.commit_workspace_patch(bigint,uuid,jsonb)",
      "public.read_agent_run(uuid)",
    ]) {
      expect(
        (
          await db.query<{ allowed: boolean }>(
            "select has_function_privilege($1,$2,'execute') allowed",
            [role, fn],
          )
        ).rows[0].allowed,
      ).toBe(role === "service_role");
    }
  }
});

it("conflitos usam PT409 para evitar repetição infinita pelo PostgREST", async () => {
  for (const fn of ["commit_workspace", "commit_workspace_patch"]) {
    try {
      await db.query(`select public.${fn}($1,$2,$3::jsonb)`, [-1, actor, "{}"]);
      expect.fail("Expected conflict");
    } catch (error) {
      expect(error).toMatchObject({
        code: "PT409",
        message: "WORKSPACE_CONFLICT",
      });
    }
  }
});
