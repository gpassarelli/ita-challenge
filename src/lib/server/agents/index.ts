import type { AgentRun } from "@/lib/domain/types";
import {
  executeSignals,
  SIGNALS_MODEL_ENV,
  SIGNALS_PROMPT_VERSION,
} from "./signals";
import {
  executeOutreach,
  OUTREACH_MODEL_ENV,
  OUTREACH_PROMPT_VERSION,
} from "./outreach";

const agents = {
  signals: {
    modelEnv: SIGNALS_MODEL_ENV,
    promptVersion: SIGNALS_PROMPT_VERSION,
    execute: executeSignals,
  },
  outreach: {
    modelEnv: OUTREACH_MODEL_ENV,
    promptVersion: OUTREACH_PROMPT_VERSION,
    execute: executeOutreach,
  },
};

export function configuredAgent(kind: AgentRun["agent"]) {
  const agent = agents[kind];
  const model = process.env[agent.modelEnv]?.trim();
  if (!process.env.OPENAI_API_KEY?.trim() || !model)
    throw new Error(
      `Configure OPENAI_API_KEY e ${agent.modelEnv} para executar o agente.`,
    );
  return { ...agent, model };
}

export function agentsReady(): boolean {
  return Boolean(
    process.env.OPENAI_API_KEY?.trim() &&
    Object.values(agents).every((agent) => process.env[agent.modelEnv]?.trim()),
  );
}
