import { it, expect } from "vitest";
import { executeCommand } from "../src/lib/domain/execute";
import { actor, emptyWorkspace, criterion, uid } from "./fixtures";
it("requisições repetidas não criam regras ou registros novamente", () => {
  const s = emptyWorkspace();
  const key = uid();
  const c = {
    type: "rules" as const,
    kind: "icp" as const,
    active: true,
    criteria: [criterion()],
    exclusions: [],
  };
  executeCommand(s, actor, c, key);
  executeCommand(s, actor, c, key);
  expect(s.rulesets).toHaveLength(1);
  expect(() =>
    executeCommand(s, actor, { ...c, kind: "commercial" }, key),
  ).toThrow("outra operação");
  const id = uid();
  const record = {
    type: "record" as const,
    dataset: "Prospects" as const,
    data: { external_id: "TEST-IDEMPOTENT", name: "Teste" },
  };
  executeCommand(s, actor, record, id);
  executeCommand(s, actor, record, id);
  expect(s.records).toHaveLength(1);
});
