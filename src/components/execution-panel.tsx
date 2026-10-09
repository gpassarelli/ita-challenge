"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowLeft, Archive, X } from "lucide-react";
import type { AgentRun, Workspace } from "@/lib/domain/types";
import type { UserCommand } from "@/lib/domain/commands";
import { archiveBlockReason } from "@/lib/domain/agent-runs";
import { cn, dateBR, display } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge, ErrorNote } from "./ui/fields";
import { AgentRunProgress } from "./agent-run-progress";
import { ReviewContent } from "./agents-and-reviews";

export function RunList({
  state,
  runs,
  onOpen,
}: {
  state: Workspace;
  runs: AgentRun[];
  onOpen: (run: AgentRun) => void;
}) {
  const [limit, setLimit] = useState(15);
  const sorted = [...runs].sort(
    (a, b) =>
      b.requestedAt.localeCompare(a.requestedAt) || b.id.localeCompare(a.id),
  );
  return (
    <div className="space-y-3">
      {!sorted.length && (
        <p className="py-8 text-center text-sm text-neutral-500">
          Nenhuma execução por aqui.
        </p>
      )}
      {sorted.slice(0, limit).map((run) => {
        const pending = state.revisions.filter(
          (r) => r.runId === run.id && r.status === "pending",
        ).length;
        const failed = run.items.filter((i) => i.status === "failed").length;
        const finished = run.items.filter(
          (i) => i.status === "completed" || i.status === "failed",
        ).length;
        const names = run.items.map((item) =>
          display(
            state.records.find((r) => r.id === item.companyId)?.data.name,
          ),
        );
        return (
          <button
            key={run.id}
            onClick={() => onOpen(run)}
            className="block w-full rounded-lg border border-neutral-200 bg-white p-4 text-left hover:border-neutral-400 focus-visible:outline-orange-400"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <strong>
                {run.agent === "signals"
                  ? "Analisar sinais"
                  : "Preparar abordagem"}
              </strong>
              <Badge tone={failed ? "orange" : "neutral"}>
                {run.archivedAt
                  ? "Arquivada"
                  : {
                      queued: "Na fila",
                      running: "Em execução",
                      completed: failed ? "Concluída com falhas" : "Concluída",
                      failed: "Falhou",
                    }[run.status]}
              </Badge>
            </div>
            <p className="mt-2 line-clamp-2 text-xs text-neutral-600">
              {names.join(" · ")}
            </p>
            <p className="mt-2 text-xs text-neutral-500">
              {finished}/{run.items.length} finalizadas · {pending} revisões
              pendentes · {failed} falhas
            </p>
            <p className="mt-2 text-[11px] text-neutral-400">
              {dateBR(run.requestedAt)}
            </p>
          </button>
        );
      })}
      {sorted.length > limit && (
        <Button variant="outline" onClick={() => setLimit((n) => n + 15)}>
          Carregar mais execuções
        </Button>
      )}
    </div>
  );
}

export type ExecutionTarget = {
  runId: string | null;
  companyId?: string;
  returnCompanyId?: string;
  revisionId?: string;
};

export function ExecutionPanel({
  state,
  target,
  onTarget,
  onClose,
  onSave,
  onResume,
  onReturnCompany,
  triggerRef,
}: {
  state: Workspace;
  target: ExecutionTarget;
  onTarget: (target: ExecutionTarget) => void;
  onClose: () => void;
  onSave: (command: UserCommand) => Promise<void>;
  onResume: (run: AgentRun) => Promise<void>;
  onReturnCompany: (id: string) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const [desktop, setDesktop] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1024px)").matches,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    setError("");
    scrollRef.current?.scrollTo(0, 0);
    headingRef.current?.focus({ preventScroll: true });
  }, [target.runId, target.revisionId]);
  const run = state.runs.find((r) => r.id === target.runId);
  const revision = state.revisions.find((r) => r.id === target.revisionId);
  const title = revision
    ? revision.type === "data"
      ? "Revisão de dados"
      : "Revisão da mensagem"
    : run
      ? "Detalhes da execução"
      : "Execuções";
  const blockReason = run ? archiveBlockReason(state, run) : null;
  const review = (id: string) => onTarget({ ...target, revisionId: id });
  const archive = async () => {
    if (!run) return;
    setBusy(true);
    setError("");
    try {
      await onSave({ type: "archiveRun", id: run.id });
      onTarget({ runId: null, returnCompanyId: target.returnCompanyId });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="hidden w-[480px] shrink-0 lg:block" aria-hidden="true" />
      <DialogPrimitive.Root
        open
        modal={!desktop}
        onOpenChange={(open) => !open && onClose()}
      >
        <DialogPrimitive.Portal>
          {!desktop && (
            <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/25" />
          )}
          <DialogPrimitive.Content
            aria-describedby="execution-panel-description"
            onInteractOutside={(event) => {
              if (desktop) event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              triggerRef.current?.focus({ preventScroll: true });
            }}
            className={cn(
              "fixed inset-y-0 right-0 flex w-full flex-col border-l border-neutral-200 bg-[#fafaf8] shadow-xl focus:outline-none lg:w-[480px]",
              desktop ? "z-30" : "z-50",
            )}
          >
            <div className="shrink-0 border-b border-neutral-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <DialogPrimitive.Title
                  ref={headingRef}
                  tabIndex={-1}
                  className="text-lg font-semibold focus:outline-none"
                >
                  {title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Close asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Fechar execuções"
                  >
                    <X />
                  </Button>
                </DialogPrimitive.Close>
              </div>
              <DialogPrimitive.Description
                id="execution-panel-description"
                className="mt-1 text-xs text-neutral-500"
              >
                Acompanhe os agentes e revise os resultados da equipe.
              </DialogPrimitive.Description>
              {(run || revision || target.returnCompanyId) && (
                <Button
                  className="mt-3"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (revision)
                      onTarget({ ...target, revisionId: undefined });
                    else if (target.returnCompanyId)
                      onReturnCompany(target.returnCompanyId);
                    else onTarget({ runId: null });
                  }}
                >
                  <ArrowLeft />
                  {revision
                    ? "Voltar à execução"
                    : target.returnCompanyId
                      ? "Voltar à empresa"
                      : "Todas as execuções"}
                </Button>
              )}
            </div>
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-5">
              {revision ? (
                <>
                  <p className="mb-4 text-sm font-medium">
                    {display(
                      state.records.find((r) => r.id === revision.companyId)
                        ?.data.name,
                    )}{" "}
                    · {dateBR(revision.createdAt)}
                  </p>
                  <ReviewContent
                    key={revision.id}
                    state={state}
                    revision={revision}
                    onSave={onSave}
                    onClose={() =>
                      onTarget({ ...target, revisionId: undefined })
                    }
                  />
                </>
              ) : run ? (
                <>
                  {run.archivedAt && (
                    <p className="mb-4 rounded bg-neutral-100 p-3 text-xs">
                      Arquivada em {dateBR(run.archivedAt)} · {run.archivedBy}
                    </p>
                  )}
                  <p className="mb-3 text-xs font-medium">
                    {
                      state.revisions.filter(
                        (r) => r.runId === run.id && r.status === "pending",
                      ).length
                    }{" "}
                    revisões pendentes
                  </p>
                  <AgentRunProgress
                    state={{ ...state, runs: [run] }}
                    companyId={target.companyId}
                    onReview={review}
                    onResume={onResume}
                  />
                  {!!run.skippedCompanies?.length && (
                    <div className="mb-4 rounded border border-amber-200 p-3 text-xs">
                      <p className="font-medium">
                        Empresas não executadas · {run.skippedCompanies.length}
                      </p>
                      <p className="my-2 text-neutral-500">
                        Tinham revisões de dados pendentes no início da
                        execução.
                      </p>
                      {run.skippedCompanies.map((entry) => (
                        <div key={entry.companyId} className="mt-3">
                          <p>
                            {display(
                              state.records.find(
                                (r) => r.id === entry.companyId,
                              )?.data.name,
                            )}
                          </p>
                          {entry.revisionIds.map((id) => (
                            <Button
                              key={id}
                              variant="ghost"
                              size="sm"
                              onClick={() => review(id)}
                            >
                              Ver revisão
                            </Button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                  {!run.archivedAt && (
                    <div className="border-t border-neutral-200 pt-4">
                      <p className="mb-3 text-xs text-neutral-500">
                        {blockReason ??
                          "Todas as revisões foram resolvidas. Arquive para retirar esta execução da fila da equipe; o histórico continuará disponível nas empresas."}
                      </p>
                      <Button
                        variant="outline"
                        disabled={busy || !!blockReason}
                        onClick={() => void archive()}
                      >
                        <Archive />
                        Arquivar execução
                      </Button>
                    </div>
                  )}
                  <ErrorNote message={error} />
                </>
              ) : (
                <RunList
                  state={state}
                  runs={state.runs.filter((r) => !r.archivedAt)}
                  onOpen={(r) =>
                    onTarget({
                      runId: r.id,
                      returnCompanyId: target.returnCompanyId,
                    })
                  }
                />
              )}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
