"use client";
import { useState, useEffect } from "react";
import {
  Pencil,
  Sparkles,
  MessageSquare,
  ChevronDown,
  ArrowUpRight,
} from "lucide-react";
import { contractFor, productName } from "@/lib/domain/contracts";
import { contactKind, contactLabel } from "@/lib/domain/values";
import { DATASETS, fieldsFor } from "@/lib/domain/catalog";
import type { DataRecord, Score, Workspace } from "@/lib/domain/types";
import { display, dateBR, brNumber, brMoney, cn } from "@/lib/utils";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Badge } from "./ui/fields";
import { api } from "./forms";
import { RunList } from "./execution-panel";
import { companyWarnings } from "@/lib/domain/company-warnings";
export function RecordDetail({
  record,
  state,
  open,
  onClose,
  onEdit,
  onOpenRecord,
  onAgent,
  onReview,
  onAddCommercial,
  onOpenRun,
  initialTab = "Dados",
}: {
  record: DataRecord;
  state: Workspace;
  open: boolean;
  onClose: () => void;
  onEdit: (r: DataRecord) => void;
  onOpenRecord: (r: DataRecord) => void;
  onAgent: (agent: "signals" | "outreach", companyIds: string[]) => void;
  onReview: (id: string) => void;
  onAddCommercial: () => void;
  onOpenRun: (id: string) => void;
  initialTab?: string;
}) {
  const [tab, setTab] = useState(initialTab);
  const [history, setHistory] = useState<
    {
      id: number;
      evaluated_at: string;
      payload: { icp: Score; commercial: Score; calculationVersion?: number };
    }[]
  >([]);
  const company = record.dataset === "Prospects";
  const evaluation = state.evaluations.find((e) => e.companyId === record.id);
  useEffect(() => {
    if (company && tab === "Histórico")
      void api("/api/score-history?companyId=" + record.id)
        .then((r) => setHistory(r.history))
        .catch(() => {});
  }, [record.id, company, tab]);
  const related = state.records.filter((r) => r.companyId === record.id);
  const tabs = company
    ? [
        "Dados",
        "Pontuações",
        "Pessoas e canais",
        "Sinais",
        "Oportunidades",
        "Mensagens",
        "Revisões",
        "Execuções",
        "Histórico",
      ]
    : ["Dados", "Origem"];
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={String(
        (record.dataset === "Decisores_Canais"
          ? contactLabel(record.data)
          : null) ??
          record.data.name ??
          record.data.company_name ??
          record.data.criterion ??
          DATASETS[record.dataset].singular,
      )}
      description={record.externalKey}
      drawer
    >
      <div className="mb-5 flex flex-wrap gap-2">
        {record.companyId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const parent = state.records.find(
                (r) => r.id === record.companyId,
              );
              if (parent) onOpenRecord(parent);
            }}
          >
            <ArrowUpRight />
            Abrir empresa relacionada
          </Button>
        )}
        {record.productId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const product = state.records.find(
                (r) => r.id === record.productId,
              );
              if (product) onOpenRecord(product);
            }}
          >
            Abrir solução do portfólio
          </Button>
        )}
        {record.dataset === "Clientes_Atuais" && record.data.opportunity_id && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const opportunity = state.records.find(
                (r) => r.id === record.data.opportunity_id,
              );
              if (opportunity) onOpenRecord(opportunity);
            }}
          >
            Abrir oportunidade ganha
          </Button>
        )}
        {record.dataset === "Oportunidades_Historico" &&
          contractFor(state, record) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenRecord(contractFor(state, record)!)}
            >
              Abrir contratação
            </Button>
          )}
        <Button variant="outline" size="sm" onClick={() => onEdit(record)}>
          <Pencil />
          Editar cadastro
        </Button>
        {company && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAgent("signals", [record.id])}
            >
              <Sparkles />
              Analisar sinais
            </Button>
            <Button size="sm" onClick={() => onAgent("outreach", [record.id])}>
              <MessageSquare />
              Preparar abordagem
            </Button>
          </>
        )}
      </div>
      {company && (
        <div className="mb-5 grid grid-cols-2 gap-3">
          {(["icp", "commercial"] as const).map((kind) => (
            <button
              key={kind}
              onClick={() => setTab("Pontuações")}
              className="rounded-lg border border-neutral-200 bg-neutral-50/40 p-4 text-left hover:bg-neutral-50"
            >
              <p className="text-xs text-neutral-500">
                {kind === "icp" ? "Aderência ao ICP" : "Prioridade comercial"}
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">
                {evaluation?.[kind].value !== null &&
                evaluation?.[kind].value !== undefined
                  ? brNumber(evaluation[kind].value, 1)
                  : "—"}
                <span className="ml-1 text-xs font-normal text-neutral-400">
                  / 100
                </span>
              </p>
              <p className="mt-2 text-[11px] text-neutral-400">
                {evaluation?.[kind].status === "unconfigured"
                  ? "Não configurado"
                  : evaluation?.[kind].status === "insufficient"
                    ? "Sem dados suficientes"
                    : (evaluation?.[kind].coverage ?? 0) +
                      "% dos critérios com evidência"}
              </p>
            </button>
          ))}
        </div>
      )}
      <div className="mb-5 flex gap-4 overflow-x-auto border-b border-neutral-200">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "whitespace-nowrap border-b-2 pb-3 text-xs font-medium",
              tab === t
                ? "border-[#e76645] text-neutral-900"
                : "border-transparent text-neutral-400",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Dados" && (
        <>
          {companyWarnings(state, record).map((w, i) => (
            <p
              key={i}
              className="mb-3 rounded bg-amber-50 p-3 text-xs leading-relaxed text-amber-800"
            >
              {w}
            </p>
          ))}
          <FieldList record={record} state={state} />
          {company &&
            related
              .filter((r) => r.dataset === "Clientes_Atuais")
              .map((r) => (
                <section className="mt-6" key={r.id}>
                  <h3 className="mb-3 text-sm font-semibold">
                    Contratação · {display(productName(state, r))}
                  </h3>
                  <FieldList record={r} state={state} />
                  <Button
                    className="mt-3"
                    variant="outline"
                    size="sm"
                    onClick={() => onEdit(r)}
                  >
                    Editar contratação
                  </Button>
                </section>
              ))}
          <Origins record={record} />
        </>
      )}
      {tab === "Pontuações" && (
        <div className="space-y-5">
          {evaluation?.disqualified && (
            <div className="rounded bg-red-50 p-3 text-sm text-red-700">
              Empresa desqualificada pelas regras atuais.
            </div>
          )}
          <ScoreDetails title="Aderência ao ICP" score={evaluation?.icp} />
          <ScoreDetails
            title="Prioridade comercial"
            score={evaluation?.commercial}
          />
          {evaluation?.exclusions.length ? (
            <section>
              <h3 className="mb-3 text-sm font-semibold">Desqualificadores</h3>
              {evaluation.exclusions.map((e, i) => (
                <div
                  key={i}
                  className="mb-2 rounded border border-neutral-200 p-3 text-xs"
                >
                  <div className="flex justify-between">
                    <b>{e.name}</b>
                    <Badge
                      tone={
                        e.matched ? "red" : e.available ? "green" : "orange"
                      }
                    >
                      {e.matched
                        ? "Aplicado"
                        : e.available
                          ? "Não aplicado"
                          : "Sem evidência"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-neutral-500">{e.reason}</p>
                </div>
              ))}
            </section>
          ) : null}
          <p className="text-[11px] text-neutral-400">
            Data de avaliação: {display(evaluation?.date)} · Versão da empresa:{" "}
            {record.version}
          </p>
        </div>
      )}
      {["Pessoas e canais", "Sinais", "Oportunidades"].includes(tab) && (
        <div className="space-y-3">
          {related
            .filter(
              (r) =>
                r.dataset ===
                {
                  "Pessoas e canais": "Decisores_Canais",
                  Sinais: "Sinais_Publicos",
                  Oportunidades: "Oportunidades_Historico",
                }[tab],
            )
            .map((r) => (
              <button
                key={r.id}
                onClick={() => onOpenRecord(r)}
                className="block w-full rounded-lg border border-neutral-200 p-4 text-left hover:bg-neutral-50"
              >
                <div className="flex justify-between text-sm font-medium">
                  <span>
                    {String(
                      (r.dataset === "Decisores_Canais"
                        ? contactLabel(r.data)
                        : null) ??
                        r.data.name ??
                        r.data.signal_type ??
                        r.data.external_id ??
                        "Registro sem descrição",
                    )}
                  </span>
                  {r.dataset === "Decisores_Canais" && (
                    <Badge>
                      {contactKind(r.data) === "person"
                        ? "Pessoa"
                        : contactKind(r.data) === "channel"
                          ? "Canal"
                          : "Sem contato"}
                    </Badge>
                  )}
                  <ArrowUpRight size={14} className="text-neutral-400" />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                  {String(
                    r.data.evidence ?? r.data.channel ?? r.data.reason ?? "",
                  )}
                </p>
              </button>
            ))}
          {!related.some(
            (r) =>
              r.dataset ===
              {
                "Pessoas e canais": "Decisores_Canais",
                Sinais: "Sinais_Publicos",
                Oportunidades: "Oportunidades_Historico",
              }[tab],
          ) && (
            <p className="py-12 text-center text-sm text-neutral-400">
              Nenhum registro relacionado.
            </p>
          )}
        </div>
      )}
      {tab === "Histórico" && (
        <>
          <h3 className="mb-3 text-sm font-semibold">Avaliações anteriores</h3>
          {history.map((h) => (
            <div
              key={h.id}
              className="mb-2 rounded border border-neutral-200 p-3 text-xs"
            >
              <p className="font-medium">{dateBR(h.evaluated_at)}</p>
              <p className="mt-1 text-neutral-500">
                ICP: {display(h.payload.icp.value)} · Comercial:{" "}
                {display(h.payload.commercial.value)} · Regras: v
                {h.payload.icp.rulesVersion ?? "—"} / v
                {h.payload.commercial.rulesVersion ?? "—"}
              </p>
              <p className="mt-1 text-neutral-400">
                {(h.payload.calculationVersion ?? 1) >= 2
                  ? "Pontuação sobre 100 pontos fixos"
                  : "Cálculo anterior: normalizado pelos critérios avaliáveis"}
              </p>
            </div>
          ))}
          <h3 className="mb-3 mt-6 text-sm font-semibold">
            Alterações e oportunidades
          </h3>
          {state.audits
            .filter(
              (a) =>
                a.entityId === record.id ||
                related.some((r) => r.id === a.entityId),
            )
            .slice()
            .reverse()
            .slice(0, 50)
            .map((a) => (
              <div
                key={a.id}
                className="relative mb-4 border-l border-neutral-200 pl-4 text-xs"
              >
                <p className="font-medium">{a.action}</p>
                <p className="mt-1 text-neutral-400">
                  {dateBR(a.at)} · {a.actor}
                </p>
                <details className="mt-2 text-neutral-500">
                  <summary className="cursor-pointer">
                    Ver alteração registrada
                  </summary>
                  <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-3 text-[10px]">
                    {JSON.stringify(
                      { antes: a.before, depois: a.after },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </div>
            ))}
        </>
      )}
      {tab === "Dados" && company && (
        <Button
          className="mt-5"
          variant="outline"
          size="sm"
          onClick={onAddCommercial}
        >
          Adicionar contratação
        </Button>
      )}
      {["Mensagens", "Revisões"].includes(tab) && (
        <div className="space-y-3">
          {state.revisions
            .filter(
              (r) =>
                r.companyId === record.id &&
                r.type === (tab === "Mensagens" ? "message" : "data"),
            )
            .map((r) => (
              <button
                key={r.id}
                onClick={() => onReview(r.id)}
                className="block w-full rounded-lg border border-neutral-200 p-4 text-left hover:bg-neutral-50"
              >
                <div className="flex justify-between text-xs">
                  <b>
                    {r.type === "message"
                      ? r.message?.subject || "Mensagem de abordagem"
                      : r.changes.length + " alterações propostas"}
                  </b>
                  <Badge>
                    {
                      {
                        pending: "Pendente",
                        approved: "Aprovada",
                        rejected: "Recusada",
                      }[r.status]
                    }
                  </Badge>
                </div>
                <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-neutral-500">
                  {r.message?.body ?? r.explanation}
                </p>
                <p className="mt-2 text-[10px] text-neutral-400">
                  {dateBR(r.createdAt)} · {r.promptVersion}
                </p>
              </button>
            ))}
          {!state.revisions.some(
            (r) =>
              r.companyId === record.id &&
              r.type === (tab === "Mensagens" ? "message" : "data"),
          ) && (
            <p className="py-12 text-center text-sm text-neutral-400">
              Nenhum registro nesta categoria.
            </p>
          )}
        </div>
      )}
      {tab === "Execuções" && company && (
        <RunList
          state={state}
          runs={state.runs.filter((run) =>
            run.items.some((item) => item.companyId === record.id),
          )}
          onOpen={(run) => onOpenRun(run.id)}
        />
      )}
      {tab === "Origem" && <Origins record={record} />}
    </Dialog>
  );
}
function FieldList({
  record,
  state,
}: {
  record: DataRecord;
  state: Workspace;
}) {
  return (
    <dl className="divide-y divide-neutral-100">
      {fieldsFor(record.dataset)
        .filter((f) => !f.hidden)
        .map((f) => (
          <div
            key={f.key}
            className="grid grid-cols-[42%_1fr] gap-3 py-3 text-xs"
          >
            <dt className="text-neutral-500">{f.label}</dt>
            <dd
              className="break-words whitespace-pre-wrap leading-relaxed text-neutral-800"
              title={record.fieldSources?.[f.key]?.detail}
            >
              {f.key === "url" &&
              /^https?:\/\//i.test(String(record.data[f.key])) ? (
                <a
                  href={String(record.data[f.key])}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {display(record.data[f.key])}
                </a>
              ) : f.key === "solution_external_id" ? (
                display(productName(state, record))
              ) : f.currency && typeof record.data[f.key] === "number" ? (
                brMoney(record.data[f.key] as number)
              ) : (
                display(record.data[f.key])
              )}
            </dd>
          </div>
        ))}
    </dl>
  );
}
function Origins({ record }: { record: DataRecord }) {
  return (
    <section className="mt-6">
      <h3 className="mb-3 text-sm font-semibold">Origem dos dados</h3>
      {!record.origins.length ? (
        <p className="text-xs text-neutral-400">
          Cadastro manual · {dateBR(record.createdAt)}
        </p>
      ) : (
        record.origins.map((o, i) => (
          <details
            className="mb-2 rounded border border-neutral-200 p-3 text-xs"
            key={o.batchId + "-" + o.row + "-" + i}
          >
            <summary className="cursor-pointer">
              {o.fileName} · linha {o.row}
            </summary>
            <p className="my-2 text-neutral-400">
              {dateBR(o.importedAt)} · Lote {o.batchId}
            </p>
            <dl>
              {Object.entries(o.raw).map(([k, v]) => (
                <div
                  key={k}
                  className="grid grid-cols-2 gap-2 border-t border-neutral-100 py-2"
                >
                  <dt className="text-neutral-500">{k}</dt>
                  <dd className="break-words whitespace-pre-wrap">
                    {v === "" ? (
                      <span className="text-neutral-400">Vazio na origem</span>
                    ) : (
                      v
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        ))
      )}
    </section>
  );
}
function ScoreDetails({ title, score }: { title: string; score?: Score }) {
  return (
    <section className="rounded-lg border border-neutral-200 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge>
          {score?.value !== null && score?.value !== undefined
            ? brNumber(score.value, 1) + " / 100"
            : "—"}
        </Badge>
      </div>
      {!score || score.status === "unconfigured" ? (
        <p className="text-xs text-neutral-400">
          Configure e ative as regras para calcular esta nota.
        </p>
      ) : (
        <>
          <p className="mb-4 text-xs text-neutral-500">
            {brNumber(score.earned, 1)} pontos obtidos ·{" "}
            {brNumber(score.availableWeight, 1)} pontos avaliáveis ·{" "}
            {score.coverage}% de cobertura · Regras v{score.rulesVersion}
            {score.penalty > 0 && " · Penalidade: " + score.penalty}
          </p>
          {score.status === "insufficient" && (
            <p className="mb-3 text-xs text-orange-700">
              Sem dados suficientes · cobertura 0%. Critérios sem evidência
              valem zero.
            </p>
          )}
          {score.criteria.map((c) => (
            <details
              key={c.criterionId}
              className="border-t border-neutral-100 py-3"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-1">
                  <ChevronDown size={12} />
                  {c.name}
                </span>
                <Badge
                  tone={
                    !c.available ? "orange" : c.earned ? "green" : "neutral"
                  }
                >
                  {c.available
                    ? brNumber(c.earned, 1) + " / " + c.weight
                    : "0 / " + c.weight + " · Sem evidência"}
                </Badge>
              </summary>
              <p className="mt-2 text-xs text-neutral-500">{c.explanation}</p>
              {c.evidence.map((e, i) => (
                <p
                  key={i}
                  className="mt-2 rounded bg-neutral-50 p-2 text-[11px] text-neutral-500"
                >
                  {e.recordLabel ?? e.recordId} ·{" "}
                  {DATASETS[e.dataset]?.label ?? e.dataset}
                  <br />
                  {fieldsFor(e.dataset).find((f) => f.key === e.field)?.label ??
                    e.field}
                  : {display(e.value)}
                  <br />
                  {e.detail}
                </p>
              ))}
            </details>
          ))}
        </>
      )}
    </section>
  );
}
