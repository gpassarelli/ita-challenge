import { describe, expect, it } from "vitest";
import { company, emptyWorkspace, revision, run } from "./fixtures";
import {
  nextPendingRevision,
  reviewGroups,
} from "../src/lib/domain/review-queue";

describe("company review queue", () => {
  it("groups company revisions across executions, orders by latest result, and separates decided history", () => {
    const state = emptyWorkspace();
    const a = company(state, { name: "Alfa" });
    const b = company(state, { name: "Beta" });
    const older = revision(a, { createdAt: "2026-10-01T00:00:00Z" });
    const newer = revision(a, { createdAt: "2026-10-03T00:00:00Z" });
    const middle = revision(b, { createdAt: "2026-10-02T00:00:00Z" });
    const execution = run(a, { archivedAt: "2026-10-04T00:00:00Z" });
    state.runs.push(execution);
    const approved = revision(a, { status: "approved", runId: execution.id });
    const rejected = revision(b, { status: "rejected" });
    state.revisions.push(older, newer, middle, approved, rejected);
    expect(
      reviewGroups(state, "pending").map((g) => g.revisions.map((r) => r.id)),
    ).toEqual([[newer.id, older.id], [middle.id]]);
    expect(
      reviewGroups(state, "archived").flatMap((g) => g.revisions),
    ).toHaveLength(2);
    expect(
      reviewGroups(state, "archived", " ALFA ", "approved")[0].revisions,
    ).toEqual([approved]);
    expect(reviewGroups(state, "archived", "Beta", "approved")).toEqual([]);
  });
  it("archives either decision immediately and advances within the company before the next company", () => {
    const state = emptyWorkspace();
    const a = company(state, { name: "Alfa" });
    const b = company(state, { name: "Beta" });
    const first = revision(a);
    const sameCompany = revision(a);
    const nextCompany = revision(b);
    state.revisions.push(first, sameCompany, nextCompany);
    first.status = "approved";
    expect(nextPendingRevision(state, first.id)).toBe(sameCompany.id);
    expect(reviewGroups(state, "archived")[0].revisions).toEqual([first]);
    sameCompany.status = "rejected";
    expect(nextPendingRevision(state, sameCompany.id)).toBe(nextCompany.id);
    expect(nextPendingRevision(state, sameCompany.id, "Alfa")).toBeNull();
    nextCompany.status = "approved";
    expect(nextPendingRevision(state, nextCompany.id)).toBeNull();
    expect(reviewGroups(state, "pending")).toEqual([]);
  });
});
