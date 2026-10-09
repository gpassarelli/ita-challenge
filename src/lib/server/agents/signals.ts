import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { signalOutputSchema, validatedChanges } from "@/lib/domain/agents";
import { composePrompt, type AgentContext, type AgentResult } from "./shared";
import {
  usageSummary,
  type AgentProgress,
  type AgentExecutionOptions,
} from "./shared";

export const SIGNALS_PROMPT = `
Você trabalha com dados fictícios de demonstração, não com dados reais.
Leia os sinais junto às demais informações da empresa e proponha atualizações nos campos permitidos quando houver uma interpretação plausível, mesmo que o sinal seja breve ou tenha poucos detalhes.
Não exija evidência detalhada, confirmação externa ou comprovação definitiva para propor uma atualização.
Use os fatos fornecidos como base para inferências razoáveis; identifique cada inferência na justificativa, sem apresentá-la como fato confirmado.
Por exemplo, uma vaga em RH pode sustentar uma proposta de RH estruturado, identificada como inferência a partir desse sinal.
Não invente contatos, datas, números ou condições contratuais ausentes; revisão de benefícios não informa uma data de renovação nem um contrato de 24 meses.
Cite os IDs reais dos registros usados em cada proposta e escreva explicações, justificativas e avisos exclusivamente em português brasileiro.
Seja conciso: em changes, inclua somente campos com alteração proposta e escreva em reason uma justificativa curta que conecte a evidência à mudança, incluindo qualquer ressalva relevante.
Agrupe a argumentação por alteração, sem repetir a lista de propostas em explanation nem comentar campos inalterados ou lacunas sem relação com as mudanças.
Use explanation apenas para um resumo curto, de uma frase, da quantidade de alterações propostas; se não houver alterações, escreva "Nenhuma alteração proposta.".
Coloque os IDs dos registros apenas em evidenceIds, sem repeti-los em explanation, reason ou warnings. Não repita nos textos os valores já apresentados em before e after pela interface.
Para esta revisão de dados, mantenha warnings vazio e inclua eventuais ressalvas na justificativa da alteração correspondente.
As mudanças são propostas para aprovação humana. Não proponha alterações em campos já compatíveis nem force mudanças sem relação plausível com o contexto.
Ausência de sinal não é evidência negativa.
Siga o esquema de saída fornecido: cada field permite somente os valores definidos para seu after. Use exatamente as opções enumeradas, UF em sigla maiúscula, colaboradores como número inteiro não negativo e null para ausência de valor; não use sinônimos, números formatados nem textos explicativos em after.
`;
export const SIGNALS_PROMPT_VERSION = "signals-v4";
export const SIGNALS_MODEL_ENV = "AI_SIGNALS_MODEL";

export async function executeSignals(
  context: AgentContext,
  model: string,
  onProgress?: AgentProgress,
  signal?: AbortSignal,
  options: AgentExecutionOptions = {},
): Promise<AgentResult> {
  const timeoutMs = options.timeoutMs ?? 60000;
  const response = await generateText({
    model: openai(model),
    system:
      composePrompt(SIGNALS_PROMPT) +
      (options.feedback
        ? ` Correção da tentativa anterior: ${options.feedback}`
        : ""),
    prompt: JSON.stringify(context.input),
    output: Output.object({
      schema: signalOutputSchema,
      name: "company_signal_review",
    }),
    providerOptions: { openai: { strictJsonSchema: true } },
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
  const parsed = signalOutputSchema.safeParse(response.output);
  if (!parsed.success) {
    // Capture only field identifiers for safe corrective feedback.
    throw Object.assign(parsed.error, {
      value: {
        changes: (
          response.output as { changes?: { field?: unknown }[] }
        )?.changes?.map((change) => ({ field: change.field })),
      },
    });
  }
  const result = parsed.data;
  return {
    type: "data",
    changes: validatedChanges(result, context.company, context.records),
    message: null,
    originalMessage: null,
    explanation: result.explanation,
    warnings: result.warnings,
  };
}
