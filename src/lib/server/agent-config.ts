import type { AgentExecutionSettings } from "@/lib/domain/types";

function integerSetting(
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const text = process.env[name]?.trim();
  if (!text) return fallback;
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Configure ${name} com um inteiro entre ${min} e ${max}.`);
  return value;
}

export function agentExecutionSettings(): AgentExecutionSettings {
  return {
    concurrency: integerSetting("AGENT_CONCURRENCY", 8, 1, 16),
    timeoutMs: integerSetting("AI_ATTEMPT_TIMEOUT_MS", 60000, 1000, 300000),
  };
}
