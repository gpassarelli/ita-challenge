import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { messageOutputSchema, validateEvidence } from "@/lib/domain/agents";
import { composePrompt, type AgentContext, type AgentResult } from "./shared";
import {
  usageSummary,
  type AgentProgress,
  type AgentExecutionOptions,
} from "./shared";

export const OUTREACH_PROMPT = `
Prepare uma mensagem curta e personalizada para o produto selecionado e o canal indicado.
Conecte o problema do prospect à proposta de valor fornecida.
Não prometa resultados ou preços não informados.
Não afirme publicamente informações internas de clientes ou oportunidades.
Sem pessoa nominal identificada, dirija-se à equipe da empresa.
Inclua uma chamada para conversa.
O assunto deve ficar vazio quando o canal não for e-mail.
`;
export const OUTREACH_PROMPT_VERSION = "outreach-v1";
export const OUTREACH_MODEL_ENV = "AI_OUTREACH_MODEL";

export async function executeOutreach(
  context: AgentContext,
  model: string,
  onProgress?: AgentProgress,
  signal?: AbortSignal,
  options: AgentExecutionOptions = {},
): Promise<AgentResult> {
  if (!context.product) throw new Error("Selecione um produto do portfólio.");
  const timeoutMs = options.timeoutMs ?? 60000;
  const response = await generateText({
    model: openai(model),
    system:
      composePrompt(OUTREACH_PROMPT) +
      (options.feedback
        ? ` Correção da tentativa anterior: ${options.feedback}`
        : ""),
    prompt: JSON.stringify(context.input),
    output: Output.object({ schema: messageOutputSchema }),
    maxOutputTokens: 4000,
    maxRetries: 0,
    timeout: timeoutMs,
    abortSignal: AbortSignal.any([
      AbortSignal.timeout(timeoutMs),
      ...(signal ? [signal] : []),
    ]),
  });
  options.onUsage?.(usageSummary(response.usage));
  await onProgress?.("validating");
  const result = messageOutputSchema.parse(response.output);
  validateEvidence(result.evidenceIds, context.records);
  const message = {
    ...result,
    productId: context.product.id,
    contactId: context.input.selectedContactId,
    channel: context.input.channel,
  };
  return {
    type: "message",
    changes: [],
    message,
    originalMessage: structuredClone(message),
    explanation: result.rationale,
    warnings: result.warnings,
  };
}
