import { z } from "zod";
import { fieldsFor } from "@/lib/domain/catalog";
import { ALLOWED_AI_FIELDS } from "@/lib/domain/mutations";
import {
  ServiceError,
  agentErrorMessage,
  retryableAgentError,
} from "./diagnostics";

function lastError(error: unknown): unknown {
  const value = error as {
    name?: string;
    cause?: unknown;
    lastError?: unknown;
  } | null;
  return value?.name === "AI_RetryError"
    ? lastError(value.lastError ?? value.cause)
    : error;
}

// Only catalog field names and fixed instructions may enter feedback/logs.
// Never copy the provider body, raw rejected value or a Zod message.
export function validationFeedback(error: unknown): string | undefined {
  const code = agentErrorMessage(error).match(/Código: ([A-Z_]+)/)?.[1];
  if (!code || !["AI_OUTPUT", "AI_FIELD", "AI_EVIDENCE"].includes(code)) return;
  const root = lastError(error) as {
    cause?: unknown;
    value?: unknown;
    text?: string;
  } | null;
  let value: unknown = root?.value;
  if (typeof root?.text === "string") {
    try {
      value = JSON.parse(root.text);
    } catch {
      /* No raw text in feedback. */
    }
  }
  let cause: unknown = error;
  for (let i = 0; i < 4 && cause; i++) {
    if (cause instanceof z.ZodError) {
      const issue = cause.issues.find(
        (issue) =>
          issue.path[0] === "changes" && typeof issue.path[1] === "number",
      );
      const changes = (value as { changes?: { field?: unknown }[] } | null)
        ?.changes;
      const key = issue && changes?.[Number(issue.path[1])]?.field;
      const field = fieldsFor("Prospects").find(
        (field) =>
          field.key === key &&
          ALLOWED_AI_FIELDS.some((allowed) => allowed === key),
      );
      if (field)
        return `Campo ${field.key}: ${field.choices ? `use somente ${field.choices.join(", ")}` : field.type === "integer" ? "use um número inteiro não negativo" : "siga o tipo e os limites definidos no esquema"}. Use null para ausência de valor. Gere novamente a resposta completa, preservando somente propostas sustentadas pelo contexto.`;
      break;
    }
    cause = (cause as { cause?: unknown })?.cause;
  }
  return code === "AI_EVIDENCE"
    ? "Use somente IDs de evidências presentes no contexto e proponha cada campo uma única vez. Gere novamente a resposta completa."
    : "A resposta anterior não correspondeu ao esquema. Siga os campos, opções e tipos do JSON Schema; use null para ausência de valor. Gere novamente a resposta completa, sem propriedades extras.";
}

export function retryPolicy(error: unknown) {
  const failure = lastError(error) as {
    statusCode?: number;
    responseHeaders?: Record<string, string>;
    usage?: unknown;
  } | null;
  const feedback = validationFeedback(error);
  // Configuration/database errors are not AI repair attempts.
  const retryable =
    !(error instanceof ServiceError) &&
    (Boolean(feedback) || retryableAgentError(error));
  const retryAfter = failure?.responseHeaders?.["retry-after"];
  let delay = Number(retryAfter) * 1000;
  if (retryAfter && !Number.isFinite(delay))
    delay = Date.parse(retryAfter) - Date.now();
  if (!retryAfter || !Number.isFinite(delay) || delay < 0)
    delay = failure?.statusCode === 429 ? 5000 : 1000;
  const retryDelayMs = Math.ceil(delay + Math.random() * 500);
  return {
    retryable,
    feedback,
    retryDelayMs,
    rateLimited: failure?.statusCode === 429,
  };
}
