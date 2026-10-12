import type { Revision, Workspace } from "./types";

export type ReviewView = "pending" | "archived";
export function companyName(state: Workspace, companyId: string) {
  return String(
    state.records.find((r) => r.id === companyId)?.data.name ??
      "Empresa indisponível",
  );
}
export function reviewGroups(
  state: Workspace,
  view: ReviewView,
  search = "",
  decision = "all",
) {
  const groups = new Map<string, Revision[]>();
  const revisions = state.revisions
    .filter(
      (r) =>
        (view === "pending"
          ? r.status === "pending"
          : r.status !== "pending") &&
        (view === "pending" || decision === "all" || r.status === decision) &&
        companyName(state, r.companyId)
          .toLocaleLowerCase("pt-BR")
          .includes(search.trim().toLocaleLowerCase("pt-BR")),
    )
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
  for (const revision of revisions) {
    const group = groups.get(revision.companyId) ?? [];
    group.push(revision);
    groups.set(revision.companyId, group);
  }
  return [...groups].map(([companyId, revisions]) => ({
    companyId,
    name: companyName(state, companyId),
    revisions,
  }));
}
export function nextPendingRevision(
  state: Workspace,
  decidedId: string,
  search = "",
) {
  const groups = reviewGroups(state, "pending", search);
  const companyId = state.revisions.find((r) => r.id === decidedId)?.companyId;
  return (
    groups
      .find((g) => g.companyId === companyId)
      ?.revisions.find((r) => r.id !== decidedId)?.id ??
    groups.flatMap((g) => g.revisions).find((r) => r.id !== decidedId)?.id ??
    null
  );
}
