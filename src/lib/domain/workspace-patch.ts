import type { Workspace } from "./types";

const collections = [
  "records",
  "rulesets",
  "evaluations",
  "lists",
  "revisions",
  "runs",
  "audits",
  "imports",
] as const;
export type WorkspacePatch = Partial<
  Pick<Workspace, (typeof collections)[number]>
>;

// Compare against the snapshot read for this transaction. Conflicts re-read
// and recompute the mutation, so unrelated edits cannot be overwritten.
export function workspacePatch(
  before: Workspace,
  after: Workspace,
): WorkspacePatch {
  const patch: Record<string, unknown[]> = {};
  for (const collection of collections) {
    const previous = new Map(
      before[collection].map((entry) => [entry.id, JSON.stringify(entry)]),
    );
    const changed = after[collection].filter(
      (entry) => previous.get(entry.id) !== JSON.stringify(entry),
    );
    if (changed.length) patch[collection] = changed;
  }
  return patch as WorkspacePatch;
}
