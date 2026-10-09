import { createHash } from "node:crypto";
import { canonical } from "./csv";
import type { UserCommand } from "./commands";
import {
  saveRecord,
  saveRules,
  saveList,
  moveOpportunity,
  decideRevision,
} from "./mutations";
import { uid, isoNow, type Workspace } from "./types";
import { archiveRun } from "./agent-run-mutations";
export function executeCommand(
  state: Workspace,
  actor: string,
  c: UserCommand,
  requestId: string,
) {
  const hash = createHash("sha256").update(canonical(c)).digest("hex");
  const receipt = state.audits.find((a) => a.id === requestId);
  if (receipt) {
    if (
      receipt.actor !== actor ||
      (receipt.after as { hash: string }).hash !== hash
    )
      throw new Error(
        "Esta chave de requisição já foi utilizada para outra operação.",
      );
    return;
  }
  if (c.type === "record")
    saveRecord(state, actor, c.dataset, c.data, c.id, c.expectedVersion);
  if (c.type === "move")
    moveOpportunity(state, actor, c.id, c.outcome, c.expectedVersion);
  if (c.type === "rules")
    saveRules(state, actor, {
      id: uid(),
      kind: c.kind,
      active: c.active,
      criteria: c.criteria,
      exclusions: c.exclusions,
    });
  if (c.type === "list")
    saveList(state, actor, {
      id: c.id,
      name: c.name,
      filters: c.filters,
      sort: c.sort,
      createdBy: actor,
      updatedAt: "",
    });
  if (c.type === "review")
    decideRevision(state, actor, c.id, c.decision, c.reason, c.editedMessage);
  if (c.type === "archiveRun") archiveRun(state, actor, c.id);
  state.audits.push({
    id: requestId,
    actor,
    action: "Requisição processada",
    entityId: requestId,
    before: null,
    after: { hash },
    at: isoNow(),
  });
}
