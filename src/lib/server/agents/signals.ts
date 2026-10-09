import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { signalOutputSchema, validatedChanges } from "@/lib/domain/agents";
import { composePrompt, type AgentContext, type AgentResult } from "./shared";
import type { AgentProgress } from "./shared";

export const SIGNALS_PROMPT = `
Analise os sinais e proponha apenas mudanças sustentadas por evidência explícita. Vaga em RH não comprova RH estruturado; revisão de benefícios não comprova data de renovação ou contrato de 24 meses. Se a evidência não permitir uma conclusão, mantenha o campo inalterado. Ausência de sinal não é evidência negativa.
`;
export const SIGNALS_PROMPT_VERSION = "signals-v1";
export const SIGNALS_MODEL_ENV = "AI_SIGNALS_MODEL";

export async function executeSignals(
  context: AgentContext,
  model: string,
  onProgress?: AgentProgress,
  signal?: AbortSignal,
): Promise<AgentResult> {
  const response = await generateText({
    model: openai(model),
    system: composePrompt(SIGNALS_PROMPT),
    prompt: JSON.stringify(context.input),
    output: Output.object({ schema: signalOutputSchema }),
    maxOutputTokens: 4000,
    maxRetries: 0,
    timeout: 60000,
    abortSignal: AbortSignal.any([
      AbortSignal.timeout(60000),
      ...(signal ? [signal] : []),
    ]),
  });
  await onProgress?.("validating");
  const result = signalOutputSchema.parse(response.output);
  return {
    type: "data",
    changes: validatedChanges(result, context.company, context.records),
    message: null,
    originalMessage: null,
    explanation: result.explanation,
    warnings: result.warnings,
  };
}
