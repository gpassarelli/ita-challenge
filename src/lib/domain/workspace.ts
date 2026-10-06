import { isDataset } from "./catalog";
import type { Workspace } from "./types";

// Older datasets remain archived in storage. commit_workspace only upserts
// the active snapshot, so excluding them here never deletes stored history.
export function activeWorkspace(state: Workspace): Workspace {
  return {
    ...state,
    records: state.records.filter((record) => isDataset(record.dataset)),
    imports: state.imports.filter((batch) => isDataset(batch.dataset)),
  };
}
