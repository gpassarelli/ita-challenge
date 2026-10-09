import { afterEach, expect, it, vi } from "vitest";
import { signalOutputSchema } from "../src/lib/domain/agents";
import { retryPolicy, validationFeedback } from "../src/lib/server/agent-retry";
import { agentExecutionSettings } from "../src/lib/server/agent-config";
import { ServiceError } from "../src/lib/server/diagnostics";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("feedback identifica o campo e as opções sem copiar resposta ou valor inválido", () => {
  const value = {
    explanation: "test",
    warnings: [],
    changes: [
      {
        field: "growth",
        after: "secret-invalid-value",
        reason: "test",
        evidenceIds: ["test"],
      },
    ],
  };
  const parsed = signalOutputSchema.safeParse(value);
  expect(parsed.success).toBe(false);
  if (parsed.success) return;
  const error = {
    name: "AI_NoObjectGeneratedError",
    text: JSON.stringify(value),
    cause: parsed.error,
  };
  const feedback = validationFeedback(error);
  expect(feedback).toContain("Campo growth");
  expect(feedback).toContain("Baixo, Médio, Alto");
  expect(feedback).not.toContain("secret");
  expect(retryPolicy(error).retryable).toBe(true);
});
it("saída ilegível recebe instrução corretiva sem copiar conteúdo", () => {
  const feedback = validationFeedback({
    name: "AI_NoObjectGeneratedError",
    text: "secret-invalid-json",
  });
  expect(feedback).toContain("JSON Schema");
  expect(feedback).not.toContain("secret");
});
it("respeita Retry-After numérico e em data para falhas 429", () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  expect(
    retryPolicy({ statusCode: 429, responseHeaders: { "retry-after": "12" } }),
  ).toMatchObject({ rateLimited: true, retryable: true, retryDelayMs: 12000 });
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-09T20:00:00Z"));
  expect(
    retryPolicy({
      statusCode: 429,
      responseHeaders: { "retry-after": "Fri, 09 Oct 2026 20:00:15 GMT" },
    }).retryDelayMs,
  ).toBe(15000);
});
it("não usa tentativa corretiva para autenticação ou falha da base", () => {
  expect(retryPolicy({ statusCode: 401 }).retryable).toBe(false);
  expect(
    retryPolicy(new ServiceError("test", "save", "TIMEOUT", true)).retryable,
  ).toBe(false);
});
it("configuração usa oito vagas e 60s e rejeita limites inválidos", () => {
  vi.stubEnv("AGENT_CONCURRENCY", "");
  vi.stubEnv("AI_ATTEMPT_TIMEOUT_MS", "");
  expect(agentExecutionSettings()).toEqual({
    concurrency: 8,
    timeoutMs: 60000,
  });
  vi.stubEnv("AGENT_CONCURRENCY", "4");
  vi.stubEnv("AI_ATTEMPT_TIMEOUT_MS", "90000");
  expect(agentExecutionSettings()).toEqual({
    concurrency: 4,
    timeoutMs: 90000,
  });
  vi.stubEnv("AGENT_CONCURRENCY", "17");
  expect(agentExecutionSettings).toThrow("AGENT_CONCURRENCY");
});
