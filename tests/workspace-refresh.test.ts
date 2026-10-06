import { expect, it, vi } from "vitest";
import { company, emptyWorkspace } from "./fixtures";
import { recalculate } from "../src/lib/domain/scoring";

const mocks = vi.hoisted(() => ({
  readWorkspace: vi.fn(),
  mutateWorkspace: vi.fn(),
}));
vi.mock("../src/lib/server/store", () => mocks);
vi.mock("../src/lib/server/supabase", () => ({
  requireUser: async () => ({ id: "test", email: "test@isolado.invalid" }),
}));
import { GET } from "../src/app/api/workspace/route";

it("a primeira consulta atualiza o cálculo antigo mesmo no mesmo dia, sem repetir gravações", async () => {
  const state = emptyWorkspace();
  company(state);
  delete state.evaluations[0].calculationVersion;
  mocks.readWorkspace.mockResolvedValue(state);
  mocks.mutateWorkspace.mockImplementation(async () => {
    recalculate(state);
    return { state };
  });
  const first = await GET();
  expect(first.status).toBe(200);
  expect(mocks.mutateWorkspace).toHaveBeenCalledTimes(1);
  const body = await first.json();
  expect(body.state.evaluations[0].calculationVersion).toBe(2);
  expect((await GET()).status).toBe(200);
  expect(mocks.mutateWorkspace).toHaveBeenCalledTimes(1);
});
