"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, Archive } from "lucide-react";
import type { AgentRun, Revision, Workspace } from "@/lib/domain/types";
import type { UserCommand } from "@/lib/domain/commands";
import { archiveBlockReason } from "@/lib/domain/agent-runs";
import {
  companyName,
  nextPendingRevision,
  reviewGroups,
  type ReviewView,
} from "@/lib/domain/review-queue";
import { cn, dateBR } from "@/lib/utils";
import { ReviewContent } from "./agents-and-reviews";
import { RunList } from "./execution-panel";
import { AgentRunProgress } from "./agent-run-progress";
import { Button } from "./ui/button";
import { Badge, ErrorNote, Input, Select } from "./ui/fields";

export type ReviewDraft = { subject: string; body: string; reason: string };
const decisionLabels = {
  pending: "Pendente",
  approved: "Aprovada",
  rejected: "Recusada",
};
function RevisionRow({
  revision,
  name,
  selected,
  onClick,
}: {
  revision: Revision;
  name?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "w-full rounded-lg border bg-white p-3 text-left hover:border-neutral-400 focus-visible:outline-orange-400",
        selected ? "border-orange-300 bg-orange-50/40" : "border-neutral-200",
      )}
    >
      {name && <p className="mb-2 text-sm font-medium">{name}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span>
          {revision.type === "data"
            ? `${revision.changes.length} alterações propostas`
            : "Mensagem de abordagem"}
        </span>
        <Badge
          tone={
            revision.status === "pending"
              ? "orange"
              : revision.status === "approved"
                ? "green"
                : "red"
          }
        >
          {decisionLabels[revision.status]}
        </Badge>
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        {dateBR(revision.createdAt)}
      </p>
      {name && (
        <span className="mt-2 inline-flex items-center gap-1 text-xs text-neutral-600">
          {revision.status === "pending" ? "Revisar" : "Ver revisão"}
          <ArrowUpRight size={12} />
        </span>
      )}
    </button>
  );
}
export function ReviewPages({
  page,
  state,
  runId,
  reviewId,
  reviewNavigation,
  view,
  onView,
  onSelectReview,
  onOpenReview,
  onOpenRun,
  onSave,
  onResume,
  onCancel,
  onRetry,
  drafts,
  onDraft,
}: {
  page: string;
  state: Workspace;
  runId: string | null;
  reviewId: string | null;
  reviewNavigation: number;
  view: ReviewView;
  onView: (view: ReviewView) => void;
  onSelectReview: (id: string | null) => void;
  onOpenReview: (id: string) => void;
  onOpenRun: (id: string | null) => void;
  onSave: (command: UserCommand) => Promise<void>;
  onResume: (run: AgentRun) => Promise<void>;
  onCancel: (run: AgentRun) => Promise<void>;
  onRetry?: (run: AgentRun) => Promise<void>;
  drafts: Record<string, ReviewDraft>;
  onDraft: (id: string, draft: ReviewDraft) => void;
}) {
  const [search, setSearch] = useState("");
  const [decision, setDecision] = useState("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [initialRunId] = useState(
    () =>
      [...state.runs]
        .filter((r) => !r.archivedAt)
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0]?.id,
  );
  const [mobileDetail, setMobileDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const groups = reviewGroups(state, view, search, decision);
  const visible = groups.flatMap((g) => g.revisions);
  const selected = visible.find((r) => r.id === reviewId) ?? visible[0];
  const runs = state.runs.filter((r) => includeArchived || !r.archivedAt);
  const run =
    state.runs.find(
      (r) => r.id === runId && (includeArchived || !r.archivedAt),
    ) ??
    runs.find((r) => r.id === initialRunId) ??
    [...runs].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0];
  // Store the initial selection so newly arriving results do not replace it.
  useEffect(() => {
    const current = state.revisions.find((r) => r.id === reviewId);
    if (
      page === "Revisões" &&
      selected &&
      (!reviewId || (view === "pending" && current?.status !== "pending"))
    )
      onSelectReview(selected.id);
  }, [page, selected?.id, reviewId, view, state.revisions, onSelectReview]);
  // Explicit shortcuts always reveal their target, even when previous filters hide it.
  useEffect(() => {
    if (page === "Revisões" && reviewId) {
      setSearch("");
      setDecision("all");
      setMobileDetail(true);
    }
  }, [page, reviewNavigation]);
  useEffect(() => {
    if (page === "Workflows" && runId) {
      setMobileDetail(true);
      if (state.runs.find((r) => r.id === runId)?.archivedAt)
        setIncludeArchived(true);
      setError("");
    }
  }, [page, runId]);
  const pending = state.revisions.filter((r) => r.status === "pending").length;
  const block = run ? archiveBlockReason(state, run) : null;
  const saveReview = async (command: UserCommand) => {
    await onSave(command);
    if (command.type === "review") {
      const updated = {
        ...state,
        revisions: state.revisions.map((r) =>
          r.id === command.id ? { ...r, status: command.decision } : r,
        ),
      };
      const nextId = nextPendingRevision(updated, command.id, search);
      onSelectReview(nextId);
      if (!nextId) setMobileDetail(false);
    }
  };
  return (
    <div className="min-h-0 flex-1 overflow-auto border-t border-neutral-200 bg-[#fafaf8] p-4 sm:p-6">
      {page === "Revisões" ? (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Aguardando decisão", count: pending },
              {
                label: "Aprovadas sem edição",
                count: state.revisions.filter(
                  (r) => r.status === "approved" && !r.edited,
                ).length,
              },
              {
                label: "Aprovadas com edição",
                count: state.revisions.filter(
                  (r) => r.status === "approved" && r.edited,
                ).length,
              },
              {
                label: "Recusadas",
                count: state.revisions.filter((r) => r.status === "rejected")
                  .length,
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-neutral-200 bg-white p-4"
              >
                <p className="text-xs text-neutral-500">{item.label}</p>
                <p className="mt-2 text-2xl font-semibold">{item.count}</p>
              </div>
            ))}
          </div>
          <div
            className="mb-5 flex flex-wrap gap-2"
            aria-label="Fila de revisões"
          >
            <Button
              variant={view === "pending" ? "outline" : "ghost"}
              onClick={() => {
                onView("pending");
                onSelectReview(null);
                setMobileDetail(false);
              }}
            >
              Pendentes · {pending}
            </Button>
            <Button
              variant={view === "archived" ? "outline" : "ghost"}
              onClick={() => {
                onView("archived");
                onSelectReview(null);
                setMobileDetail(false);
              }}
            >
              Arquivadas · {state.revisions.length - pending}
            </Button>
          </div>
          <div className="mb-5 flex flex-wrap gap-3">
            <Input
              aria-label="Buscar empresa nas revisões"
              placeholder="Buscar empresa..."
              className="max-w-sm"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                onSelectReview(null);
                setMobileDetail(false);
              }}
            />
            {view === "archived" && (
              <Select
                aria-label="Filtrar decisões arquivadas"
                className="max-w-48"
                value={decision}
                onChange={(e) => {
                  setDecision(e.target.value);
                  onSelectReview(null);
                  setMobileDetail(false);
                }}
              >
                <option value="all">Todas as decisões</option>
                <option value="approved">Aprovadas</option>
                <option value="rejected">Recusadas</option>
              </Select>
            )}
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
            <section
              aria-label="Revisões por empresa"
              className={cn(
                "space-y-5",
                mobileDetail && selected && "hidden lg:block",
              )}
            >
              {groups.map((group) => (
                <div key={group.companyId}>
                  <h2 className="mb-2 text-sm font-semibold">
                    {group.name}{" "}
                    <span className="text-xs font-normal text-neutral-500">
                      · {group.revisions.length}
                    </span>
                  </h2>
                  <div className="space-y-2">
                    {group.revisions.map((revision) => (
                      <RevisionRow
                        key={revision.id}
                        revision={revision}
                        selected={revision.id === selected?.id}
                        onClick={() => {
                          onSelectReview(revision.id);
                          setMobileDetail(true);
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {!groups.length && (
                <p role="status" className="py-8 text-sm text-neutral-500">
                  {search
                    ? "Nenhuma empresa encontrada."
                    : view === "pending"
                      ? "Tudo em dia por aqui. As revisões decididas estão em Arquivadas."
                      : "Nenhuma revisão arquivada nesta categoria."}
                </p>
              )}
            </section>
            {selected && (
              <section
                aria-label="Detalhes da revisão"
                className={cn(
                  "min-w-0 rounded-xl border border-neutral-200 bg-white p-4 sm:p-6",
                  !mobileDetail && "hidden lg:block",
                )}
              >
                <Button
                  variant="ghost"
                  className="mb-4 lg:hidden"
                  onClick={() => setMobileDetail(false)}
                >
                  <ArrowLeft />
                  Voltar às revisões
                </Button>
                <h2 className="text-lg font-semibold">
                  {companyName(state, selected.companyId)}
                </h2>
                <p className="mb-3 mt-1 text-xs text-neutral-500">
                  {selected.type === "data"
                    ? "Revisão de dados"
                    : "Revisão da mensagem"}{" "}
                  · {dateBR(selected.createdAt)}
                </p>
                {state.runs.some((r) => r.id === selected.runId) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mb-4"
                    onClick={() => onOpenRun(selected.runId)}
                  >
                    Abrir workflow
                    <ArrowUpRight />
                  </Button>
                )}
                <ReviewContent
                  key={selected.id}
                  revision={selected}
                  state={state}
                  onClose={() => {}}
                  onSave={saveReview}
                  draft={
                    selected.status === "pending"
                      ? drafts[selected.id]
                      : undefined
                  }
                  onDraft={
                    selected.status === "pending"
                      ? (draft) => onDraft(selected.id, draft)
                      : undefined
                  }
                />
              </section>
            )}
          </div>
        </>
      ) : (
        <>
          <label className="mb-5 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            Incluir execuções arquivadas
          </label>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
            <section
              aria-label="Lista de workflows"
              className={cn(mobileDetail && run && "hidden lg:block")}
            >
              <RunList
                state={state}
                runs={runs}
                onOpen={(r) => {
                  onOpenRun(r.id);
                  setMobileDetail(true);
                }}
              />
            </section>
            {run && (
              <section
                aria-label="Detalhes do workflow"
                className={cn("min-w-0", !mobileDetail && "hidden lg:block")}
              >
                <Button
                  variant="ghost"
                  className="mb-4 lg:hidden"
                  onClick={() => setMobileDetail(false)}
                >
                  <ArrowLeft />
                  Voltar aos workflows
                </Button>
                <h2 className="mb-3 text-lg font-semibold">
                  {run.agent === "signals"
                    ? "Analisar sinais"
                    : "Preparar abordagem"}{" "}
                  · {dateBR(run.requestedAt)}
                </h2>
                {run.archivedAt && (
                  <p className="mb-4 text-xs text-neutral-500">
                    Execução arquivada em {dateBR(run.archivedAt)}
                  </p>
                )}
                <section
                  aria-label="Resultados do workflow"
                  className="mb-5 rounded-xl border border-neutral-200 bg-white p-4"
                >
                  <h3 className="mb-3 text-sm font-semibold">
                    Revisões geradas ·{" "}
                    {state.revisions.filter((r) => r.runId === run.id).length}
                  </h3>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {state.revisions
                      .filter((r) => r.runId === run.id)
                      .map((r) => (
                        <RevisionRow
                          key={r.id}
                          revision={r}
                          name={companyName(state, r.companyId)}
                          onClick={() => onOpenReview(r.id)}
                        />
                      ))}
                  </div>
                  {!state.revisions.some((r) => r.runId === run.id) && (
                    <p className="text-sm text-neutral-500">
                      Nenhuma revisão gerada até agora.
                    </p>
                  )}
                </section>
                <AgentRunProgress
                  state={{ ...state, runs: [run] }}
                  onResume={onResume}
                  onCancel={onCancel}
                  onRetry={onRetry}
                  onReview={onOpenReview}
                />
                {!!run.skippedCompanies?.length && (
                  <section className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <h3 className="text-sm font-medium">
                      Empresas não executadas
                    </h3>
                    <p className="mt-2 text-xs">
                      Tinham revisões de dados pendentes no início da execução.
                    </p>
                    {run.skippedCompanies.map((entry) => (
                      <div key={entry.companyId} className="mt-3 text-sm">
                        {companyName(state, entry.companyId)}
                        {entry.revisionIds.map((id) => (
                          <Button
                            key={id}
                            variant="ghost"
                            size="sm"
                            onClick={() => onOpenReview(id)}
                          >
                            Ver revisão
                          </Button>
                        ))}
                      </div>
                    ))}
                  </section>
                )}
                {!run.archivedAt && (
                  <div className="rounded-lg border border-neutral-200 bg-white p-4">
                    <p className="mb-3 text-xs text-neutral-500">
                      {block ??
                        "Todas as revisões foram resolvidas. Esta execução pode ser arquivada."}
                    </p>
                    <Button
                      variant="outline"
                      disabled={busy || !!block}
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          await onSave({ type: "archiveRun", id: run.id });
                          onOpenRun(null);
                          setMobileDetail(false);
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <Archive />
                      Arquivar execução
                    </Button>
                    <ErrorNote message={error} />
                  </div>
                )}
              </section>
            )}
          </div>
          <details className="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
            <summary className="cursor-pointer text-xs font-medium">
              Qualidade por agente e versão do prompt
            </summary>
            {[...new Set(state.revisions.map((r) => r.promptVersion))].map(
              (version) => {
                const rows = state.revisions.filter(
                  (r) => r.promptVersion === version,
                );
                return (
                  <p key={version} className="mt-3 text-xs text-neutral-500">
                    {version} ·{" "}
                    {
                      rows.filter((r) => r.status === "approved" && !r.edited)
                        .length
                    }{" "}
                    sem edição ·{" "}
                    {
                      rows.filter((r) => r.status === "approved" && r.edited)
                        .length
                    }{" "}
                    com edição ·{" "}
                    {rows.filter((r) => r.status === "rejected").length}{" "}
                    recusadas
                  </p>
                );
              },
            )}
          </details>
        </>
      )}
    </div>
  );
}
