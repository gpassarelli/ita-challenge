"use client";
import { useEffect, useState } from "react";
import type { AgentPhase, AgentRun, Workspace } from "@/lib/domain/types";
import { dateBR, display } from "@/lib/utils";
import { Badge, ErrorNote } from "./ui/fields";
import { Button } from "./ui/button";
import { agentEligibility } from "@/lib/domain/agent-runs";

const phases: Record<AgentPhase, { label: string; detail: string }> = {
  preparing: {
    label: "Preparando dados",
    detail: "Conferindo empresa, produto, evidências e configuração do agente.",
  },
  generating: {
    label: "Aguardando a IA",
    detail:
      "Enviando o contexto e aguardando a resposta do modelo. Há no máximo duas tentativas; respostas inválidas recebem orientação para correção.",
  },
  validating: {
    label: "Validando resposta",
    detail:
      "Conferindo formato, campos permitidos e referências às evidências.",
  },
  saving: {
    label: "Salvando revisão",
    detail:
      "A IA já respondeu. Gravando a proposta para revisão humana; se a base falhar, a gravação será repetida sem chamar a IA novamente.",
  },
};
const statusLabel = {
  queued: "Na fila",
  running: "Em execução",
  completed: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
};
function duration(start: string, end: string | undefined, now: number) {
  const seconds = Math.max(
    0,
    Math.floor(((end ? Date.parse(end) : now) - Date.parse(start)) / 1000),
  );
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
}

export function AgentRunProgress({
  state,
  onResume,
  onCancel,
  onReview,
  onRetry,
  companyId,
}: {
  state: Workspace;
  onResume: (run: AgentRun) => Promise<void>;
  onCancel: (run: AgentRun) => Promise<void>;
  onReview?: (id: string) => void;
  onRetry?: (run: AgentRun) => Promise<void>;
  companyId?: string;
}) {
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const active = state.runs.some(
    (r) => r.status === "queued" || r.status === "running",
  );
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  if (!state.runs.length) return null;
  return (
    <details
      open
      className="mb-5 rounded-lg border border-neutral-200 bg-white p-4"
    >
      <summary className="cursor-pointer text-xs font-medium">
        Execuções dos agentes · {state.runs.length}
      </summary>
      <p className="mt-2 text-xs text-neutral-500">
        O progresso conta empresas finalizadas, incluindo falhas. Os detalhes
        são atualizados automaticamente.
      </p>
      {state.runs
        .slice()
        .reverse()
        .map((run) => {
          const completed = run.items.filter(
            (i) => i.status === "completed",
          ).length;
          const failed = run.items.filter((i) => i.status === "failed").length;
          const cancelled = run.items.filter(
            (i) => i.status === "cancelled",
          ).length;
          const finished = completed + failed;
          const running = run.items.filter(
            (item) => item.status === "running",
          ).length;
          const queued = run.items.filter(
            (item) => item.status === "queued",
          ).length;
          const elapsedMinutes = Math.max(
            1 / 60,
            ((run.finishedAt ? Date.parse(run.finishedAt) : now) -
              Date.parse(run.startedAt ?? run.requestedAt)) /
              60000,
          );
          const retryCount = agentEligibility(
            state,
            run.agent,
            run.items
              .filter((item) => item.status === "failed")
              .map((item) => item.companyId),
          ).companyIds.length;
          const percent = run.items.length
            ? Math.round((100 * finished) / run.items.length)
            : 0;
          return (
            <section
              key={run.id}
              className="mt-4 border-t border-neutral-100 pt-4 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {run.agent === "signals"
                    ? "Analisar sinais"
                    : "Preparar abordagem"}{" "}
                  · {dateBR(run.requestedAt)}
                </span>
                <Badge
                  tone={
                    run.status === "failed"
                      ? "red"
                      : run.status === "completed"
                        ? failed
                          ? "orange"
                          : "green"
                        : "orange"
                  }
                >
                  {run.status === "completed" && failed
                    ? "Concluída com falhas"
                    : statusLabel[run.status]}
                </Badge>
              </div>
              {(run.status === "queued" || run.status === "running") && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  disabled={cancelling !== null}
                  onClick={async () => {
                    setCancelling(run.id);
                    setError("");
                    try {
                      await onCancel(run);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setCancelling(null);
                    }
                  }}
                >
                  {cancelling === run.id ? "Cancelando…" : "Cancelar execução"}
                </Button>
              )}
              <ErrorNote message={error} />
              {onRetry &&
                failed > 0 &&
                run.status !== "queued" &&
                run.status !== "running" && (
                  <div className="mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={retrying !== null || retryCount === 0}
                      onClick={async () => {
                        setRetrying(run.id);
                        setError("");
                        try {
                          await onRetry(run);
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setRetrying(null);
                        }
                      }}
                    >
                      {retrying === run.id
                        ? "Iniciando…"
                        : `Repetir empresas com falha (${retryCount})`}
                    </Button>
                    {retryCount < failed && (
                      <p className="mt-2 text-neutral-500">
                        Empresas com revisões pendentes ficam fora da nova
                        execução.
                      </p>
                    )}
                  </div>
                )}
              <div className="mt-3 flex flex-wrap justify-between gap-2 text-neutral-600">
                <span>
                  {finished} de {run.items.length} empresas finalizadas ·{" "}
                  {percent}%
                </span>
                <span>
                  {completed} com sucesso · {failed} falhas · {cancelled}{" "}
                  canceladas · {duration(run.requestedAt, run.finishedAt, now)}
                </span>
              </div>
              <progress
                aria-label="Progresso das empresas"
                value={finished}
                max={run.items.length || 1}
                className="mt-2 h-2 w-full accent-emerald-600"
              />
              <p className="mt-2 text-neutral-500">
                {running} em processamento · {queued} na fila ·{" "}
                {Math.round((finished / elapsedMinutes) * 10) / 10} empresas
                finalizadas/min
                {run.settings &&
                  ` · até ${run.settings.concurrency} simultâneas`}
              </p>
              {run.status === "running" && finished === run.items.length && (
                <p className="mt-2 text-neutral-500">Finalizando o lote…</p>
              )}
              {run.error && (
                <p role="alert" className="mt-2 text-red-700">
                  {run.error}
                </p>
              )}
              <div className="mt-3 space-y-2">
                {run.items.map((item) => {
                  const latest = item.steps?.at(-1);
                  const label =
                    item.status === "running"
                      ? item.error
                        ? "Aguardando nova tentativa"
                        : latest
                          ? phases[latest.phase].label
                          : "Processando empresa"
                      : statusLabel[item.status];
                  return (
                    <details
                      key={item.companyId}
                      open={companyId === item.companyId || undefined}
                      className="rounded border border-neutral-100 p-3"
                    >
                      <summary className="cursor-pointer">
                        <span className="font-medium">
                          {display(
                            state.records.find((r) => r.id === item.companyId)
                              ?.data.name,
                          )}
                        </span>
                        <span className="ml-2 text-neutral-500">
                          {label} · {item.attempts ?? 0} tentativa(s)
                        </span>
                      </summary>
                      {item.error && (
                        <p role="alert" className="mt-2 text-red-700">
                          {item.error}
                        </p>
                      )}
                      {item.status === "queued" && (
                        <p className="mt-2 text-neutral-500">
                          Aguardando uma vaga no lote · espera:{" "}
                          {duration(run.requestedAt, item.finishedAt, now)}.
                        </p>
                      )}
                      {item.steps?.length ? (
                        <ol className="mt-3 space-y-3">
                          {item.steps.map((step, index) => (
                            <li
                              key={index}
                              className="border-l-2 border-neutral-200 pl-3"
                            >
                              <div className="flex flex-wrap justify-between gap-2">
                                <span>
                                  {phases[step.phase].label} · tentativa{" "}
                                  {step.attempt}
                                </span>
                                <span>
                                  {step.status === "completed"
                                    ? "Concluída"
                                    : step.status === "failed"
                                      ? "Falhou"
                                      : step.status === "cancelled"
                                        ? "Cancelada"
                                        : "Em andamento"}{" "}
                                  ·{" "}
                                  {duration(
                                    step.startedAt,
                                    step.finishedAt,
                                    now,
                                  )}
                                </span>
                              </div>
                              <p className="mt-1 text-neutral-500">
                                {phases[step.phase].detail}
                                {step.phase === "generating" &&
                                  run.settings &&
                                  ` Limite por tentativa: ${run.settings.timeoutMs / 1000}s.`}
                              </p>
                              {step.error && (
                                <p className="mt-1 text-red-700">
                                  {step.error}
                                </p>
                              )}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        item.status !== "queued" && (
                          <p className="mt-2 text-neutral-500">
                            Esta execução não possui histórico detalhado de
                            etapas.
                          </p>
                        )
                      )}
                      <p className="mt-3 break-all text-neutral-500">
                        Modelo: {item.model ?? "a definir"} · Prompt:{" "}
                        {item.promptVersion ?? "a definir"}
                      </p>
                      {item.startedAt && (
                        <p className="mt-1 text-neutral-500">
                          Início:{" "}
                          {new Date(item.startedAt).toLocaleString("pt-BR")} ·
                          Espera na fila:{" "}
                          {duration(run.requestedAt, item.startedAt, now)} ·
                          Processamento:{" "}
                          {duration(item.startedAt, item.finishedAt, now)}
                        </p>
                      )}
                      {item.revisionId &&
                        (() => {
                          const revision = state.revisions.find(
                            (r) => r.id === item.revisionId,
                          );
                          return revision ? (
                            <div className="mt-3">
                              <p className="mb-2">
                                Revisão{" "}
                                {
                                  {
                                    pending: "pendente",
                                    approved: "aprovada",
                                    rejected: "recusada",
                                  }[revision.status]
                                }
                              </p>
                              {onReview && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => onReview(revision.id)}
                                >
                                  {revision.status === "pending"
                                    ? "Revisar resultado"
                                    : "Ver revisão"}
                                </Button>
                              )}
                            </div>
                          ) : null;
                        })()}
                    </details>
                  );
                })}
              </div>
              <details className="mt-3 text-neutral-500">
                <summary className="cursor-pointer">
                  Identificação para diagnóstico
                </summary>
                <p className="mt-2 break-all">Execução: {run.id}</p>
                <p className="mt-1 break-all">
                  Workflow: {run.workflowId ?? "aguardando início"}
                </p>
              </details>
              {run.status === "queued" && !run.workflowId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => void onResume(run)}
                >
                  Retomar execução
                </Button>
              )}
            </section>
          );
        })}
    </details>
  );
}
