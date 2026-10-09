import { PendingDataRevisionError } from "@/lib/domain/agent-runs";
export class ServiceError extends Error {
  constructor(
    message: string,
    readonly operation: string,
    readonly code: string,
    readonly retryable = false,
  ) {
    super(`${message} Etapa: ${operation}. Código: ${code}.`);
    this.name = "ServiceError";
  }
}

export function databaseError(
  operation:
    | "read_workspace"
    | "commit_workspace"
    | "commit_workspace_patch"
    | "read_agent_context"
    | "commit_agent_patch"
    | "read_agent_run",
  error: { code?: string; message?: string; details?: string },
  status = 0,
): ServiceError {
  const code = /^[A-Z0-9_]{1,30}$/.test(error.code ?? "")
    ? error.code!
    : "DATABASE_ERROR";
  const detail = `${error.message ?? ""} ${error.details ?? ""}`;
  if (code === "PT422" && /PENDING_REVISION/.test(detail))
    return new ServiceError(
      new PendingDataRevisionError().message,
      operation,
      "PENDING_REVISION",
    );
  if (/ENOTFOUND|EAI_AGAIN/.test(detail))
    return new ServiceError(
      "Não foi possível localizar o servidor da base. Verifique a rede e a URL do Supabase.",
      operation,
      "DNS_ERROR",
      true,
    );
  if (
    /abort|timeout|timed out/i.test(detail) ||
    status === 408 ||
    code === "57014"
  )
    return new ServiceError(
      "A base demorou demais para responder. Tente novamente.",
      operation,
      "TIMEOUT",
      true,
    );
  if (status === 0 || /fetch failed|ECONNRESET|ECONNREFUSED/i.test(detail))
    return new ServiceError(
      "A conexão com a base foi interrompida. Verifique a rede e a disponibilidade do Supabase.",
      operation,
      "NETWORK_ERROR",
      true,
    );
  if (status === 401 || status === 403 || code === "42501")
    return new ServiceError(
      "O servidor não tem autorização para acessar a base. Confira a chave administrativa e as permissões do Supabase.",
      operation,
      code === "DATABASE_ERROR" ? `HTTP_${status}` : code,
    );
  if (["PGRST202", "42883", "42P01", "42703"].includes(code))
    return new ServiceError(
      "Uma função, tabela ou coluna necessária não foi encontrada. Confira as migrações aplicadas e o cache de esquema do Supabase.",
      operation,
      code,
    );
  if (status === 429 || status >= 500)
    return new ServiceError(
      "A base está temporariamente indisponível ou sobrecarregada. Tente novamente.",
      operation,
      code === "DATABASE_ERROR" ? `HTTP_${status}` : code,
      true,
    );
  return new ServiceError(
    "A base recusou a operação. Consulte os logs do servidor com o código abaixo.",
    operation,
    code,
  );
}

// Never expose provider response bodies, prompts, credentials, or raw stacks.
export function agentErrorMessage(error: unknown): string {
  if (
    error instanceof ServiceError ||
    error instanceof PendingDataRevisionError
  )
    return error.message;
  const value = error as {
    name?: string;
    statusCode?: number;
    message?: string;
    cause?: unknown;
    lastError?: unknown;
  } | null;
  const message = value?.message ?? "";
  if (value?.name === "AI_RetryError" && (value.lastError || value.cause))
    return agentErrorMessage(value.lastError ?? value.cause);
  if (
    value?.name === "TimeoutError" ||
    value?.name === "AbortError" ||
    /timeout|aborted/i.test(message)
  )
    return "A IA excedeu o tempo de resposta. Tente novamente. Código: AI_TIMEOUT.";
  if (value?.statusCode === 401 || value?.statusCode === 403)
    return "A IA recusou a autenticação. Confira a chave e o acesso ao modelo. Código: AI_AUTH.";
  if (value?.statusCode === 429)
    return "A IA atingiu o limite de uso ou de requisições. Confira a cota e tente novamente. Código: AI_RATE_LIMIT.";
  if (value?.statusCode === 400 || value?.statusCode === 404)
    return "A IA recusou a solicitação. Confira o identificador do modelo e o suporte a saídas estruturadas. Código: AI_REQUEST.";
  if (
    value?.name === "ZodError" ||
    value?.name?.includes("NoObjectGenerated") ||
    value?.name?.includes("TypeValidation")
  )
    return "A resposta da IA não corresponde ao formato esperado. Nenhuma revisão foi salva. Código: AI_OUTPUT.";
  if (/evidência inexistente|repetiu o mesmo campo/.test(message))
    return "A resposta contém evidências inválidas ou campos repetidos. Nenhuma revisão foi salva. Código: AI_EVIDENCE.";
  if (/opção inválida|valor fora do intervalo|campo obrigatório/.test(message))
    return "A resposta contém valores inválidos para os campos da empresa. Nenhuma revisão foi salva. Código: AI_FIELD.";
  if (/Configure OPENAI_API_KEY/.test(message))
    return "Configure OPENAI_API_KEY e o modelo do agente selecionado no servidor. Código: AI_CONFIG.";
  return "Não foi possível concluir a etapa. Tente novamente; se persistir, consulte os logs da execução. Código: AGENT_ERROR.";
}

export function retryableAgentError(error: unknown): boolean {
  const value = error as {
    name?: string;
    statusCode?: number;
    cause?: unknown;
    lastError?: unknown;
    isRetryable?: boolean;
  } | null;
  if (value?.name === "AI_RetryError")
    return retryableAgentError(value.lastError ?? value.cause);
  if (value?.statusCode != null)
    return (
      value.statusCode === 408 ||
      value.statusCode === 429 ||
      value.statusCode >= 500
    );
  return (
    value?.name === "TimeoutError" ||
    value?.name === "AbortError" ||
    (value?.name === "AI_APICallError" && value.isRetryable === true) ||
    (value instanceof TypeError && /fetch failed/i.test(value.message))
  );
}
