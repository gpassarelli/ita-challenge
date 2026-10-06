"use client";
import { useState } from "react";
import {
  Sparkles,
  Check,
  X,
  Copy,
  ArrowRight,
  Loader2,
  AlertCircle,
  MessageSquare,
} from "lucide-react";
import type { Workspace, Revision } from "@/lib/domain/types";
import { contactKind, contactLabel } from "@/lib/domain/values";
import { fieldsFor } from "@/lib/domain/catalog";
import type { UserCommand } from "@/lib/domain/commands";
import { display, dateBR, cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input, Textarea, Label, Select, ErrorNote, Badge } from "./ui/fields";
import { api } from "./forms";
export function AgentDialog({
  agent,
  companyIds,
  state,
  open,
  onClose,
  onStarted,
}: {
  agent: "signals" | "outreach";
  companyIds: string[];
  state: Workspace;
  open: boolean;
  onClose: () => void;
  onStarted: (state: Workspace) => void;
}) {
  const [productId, setProductId] = useState("");
  const [contactId, setContactId] = useState("");
  const [channel, setChannel] = useState("E-mail");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(() => crypto.randomUUID());
  const products = state.records.filter((r) => r.dataset === "Portfolio");
  const contacts = state.records.filter(
    (r) =>
      r.dataset === "Decisores_Canais" &&
      contactKind(r.data) !== null &&
      companyIds.includes(r.companyId ?? ""),
  );
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/agents", {
        id,
        agent,
        companyIds,
        productId: productId || null,
        contactId: contactId || null,
        channel,
      });
      onStarted(result.state);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={agent === "signals" ? "Analisar sinais" : "Preparar abordagem"}
      description={
        companyIds.length +
        " empresa(s) selecionada(s). Os resultados ficam disponíveis para revisão."
      }
    >
      {agent === "signals" ? (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm leading-relaxed text-neutral-600">
          O agente compara os sinais com os dados atuais e sugere alterações
          acompanhadas de evidências. Você aprova ou recusa cada revisão antes
          de qualquer atualização.
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <Label htmlFor="agent-product">Produto do portfólio *</Label>
            <Select
              id="agent-product"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">Selecione um produto</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.data.name}
                </option>
              ))}
            </Select>
            {!products.length && (
              <p className="mt-2 text-xs text-orange-700">
                Cadastre um produto no Portfólio para preparar uma abordagem.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="agent-channel">Canal da mensagem</Label>
            <Select
              id="agent-channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              <option>E-mail</option>
              <option>LinkedIn</option>
              <option>Outro</option>
            </Select>
          </div>
          {companyIds.length === 1 && (
            <div>
              <Label htmlFor="agent-contact">
                Pessoa ou canal destinatário
              </Label>
              <Select
                id="agent-contact"
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
              >
                <option value="">Dirigir à equipe da empresa</option>
                {contacts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {contactLabel(p.data)} ·{" "}
                    {contactKind(p.data) === "person"
                      ? "Pessoa"
                      : "Canal da equipe"}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <p className="text-xs leading-relaxed text-neutral-500">
            A mensagem será um rascunho editável, baseado no produto, nos sinais
            e no histórico comercial. O envio será feito por você.
          </p>
        </div>
      )}
      <ErrorNote message={error} />
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          disabled={busy || (agent === "outreach" && !productId)}
          onClick={start}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}Executar
          agente
        </Button>
      </div>
    </Dialog>
  );
}
export function ReviewDialog({
  revision,
  state,
  open,
  onClose,
  onSave,
}: {
  revision: Revision;
  state: Workspace;
  open: boolean;
  onClose: () => void;
  onSave: (command: UserCommand) => Promise<void>;
}) {
  const [subject, setSubject] = useState(revision.message?.subject ?? "");
  const [body, setBody] = useState(revision.message?.body ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const company = state.records.find((r) => r.id === revision.companyId);
  const stale =
    revision.type === "data" && company?.version !== revision.companyVersion;
  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    setError("");
    try {
      await onSave({
        type: "review",
        id: revision.id,
        decision,
        reason,
        ...(revision.type === "message"
          ? { editedMessage: { subject, body } }
          : {}),
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const snapshot = revision.input as {
    company?: {
      id: string;
      type: string;
      version: number;
      data: Record<string, unknown>;
    };
    records?: {
      id: string;
      type: string;
      version: number;
      data: Record<string, unknown>;
    }[];
  };
  const snapshots = [
    ...(snapshot?.company?.id ? [snapshot.company] : []),
    ...(snapshot?.records ?? []),
  ];
  const evidenceIds = [
    ...new Set(
      revision.type === "data"
        ? revision.changes.flatMap((c) => c.evidenceIds)
        : (revision.message?.evidenceIds ?? []),
    ),
  ];
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={
        revision.type === "data" ? "Revisão de dados" : "Revisão da mensagem"
      }
      description={
        String(company?.data.name ?? "Empresa") +
        " · " +
        dateBR(revision.createdAt)
      }
      wide
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge
          tone={
            revision.status === "approved"
              ? "green"
              : revision.status === "rejected"
                ? "red"
                : "orange"
          }
        >
          {
            {
              pending: "Aguardando revisão",
              approved: "Aprovada",
              rejected: "Recusada",
            }[revision.status]
          }
        </Badge>
        <Badge>{revision.promptVersion}</Badge>
        <Badge>{revision.model}</Badge>
        {revision.edited && <Badge>Aprovada com edição</Badge>}
      </div>
      <p className="mb-4 text-sm leading-relaxed text-neutral-600">
        {revision.explanation}
      </p>
      {revision.warnings.map((w, i) => (
        <div
          key={i}
          className="mb-2 flex gap-2 rounded bg-amber-50 p-3 text-xs text-amber-800"
        >
          <AlertCircle size={15} className="shrink-0" />
          {w}
        </div>
      ))}
      {revision.type === "data" ? (
        <div className="space-y-3">
          {stale && revision.status === "pending" && (
            <ErrorNote message="A empresa mudou após a análise. Recuse esta revisão ou gere uma nova análise antes de aprovar." />
          )}
          {!revision.changes.length && (
            <p className="rounded border border-neutral-200 p-4 text-sm text-neutral-500">
              O agente não encontrou alterações sustentadas por evidências
              suficientes.
            </p>
          )}
          {revision.changes.map((c) => (
            <div
              key={c.field}
              className="rounded-lg border border-neutral-200 p-4"
            >
              <h3 className="mb-2 text-sm font-semibold">
                {fieldsFor("Prospects").find((f) => f.key === c.field)?.label ??
                  c.field}
              </h3>
              <div className="mb-3 flex items-center gap-3 text-sm">
                <span className="rounded bg-neutral-100 px-2 py-1 text-neutral-500">
                  {display(c.before)}
                </span>
                <ArrowRight size={15} className="text-neutral-400" />
                <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-800">
                  {display(c.after)}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-neutral-500">
                {c.reason}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {revision.message?.channel === "E-mail" && (
            <div>
              <Label htmlFor="review-subject">Assunto</Label>
              <Input
                id="review-subject"
                value={subject}
                readOnly={revision.status !== "pending"}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
          )}
          <div>
            <Label htmlFor="review-body">Mensagem</Label>
            <Textarea
              id="review-body"
              className="min-h-60 leading-relaxed"
              value={body}
              readOnly={revision.status !== "pending"}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          {revision.status === "approved" && (
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    (subject ? subject + "\n\n" : "") + body,
                  );
                  setCopied(true);
                } catch {
                  setError(
                    "Não foi possível copiar. Selecione o texto da mensagem e copie manualmente.",
                  );
                }
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Mensagem copiada" : "Copiar mensagem aprovada"}
            </Button>
          )}
          {revision.edited && (
            <details className="rounded border border-neutral-200 p-3 text-xs">
              <summary className="cursor-pointer">
                Ver mensagem original do agente
              </summary>
              <p className="mt-3 whitespace-pre-wrap text-neutral-500">
                {revision.originalMessage?.subject}
                {"\n\n"}
                {revision.originalMessage?.body}
              </p>
            </details>
          )}
        </div>
      )}
      <details className="mt-5 rounded-lg border border-neutral-200 p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Evidências utilizadas · {evidenceIds.length}
        </summary>
        <div className="mt-3 space-y-3">
          {evidenceIds.map((id) => {
            const captured = snapshots.find((r) => r.id === id);
            const current = state.records.find((r) => r.id === id);
            const data = captured?.data ?? current?.data;
            return (
              <div key={id} className="rounded bg-neutral-50 p-3 text-xs">
                <p className="font-medium">
                  {captured?.type ?? current?.dataset} ·{" "}
                  {current?.externalKey ?? id}
                </p>
                <p className="mt-1 leading-relaxed text-neutral-500">
                  {data
                    ? Object.entries(data)
                        .filter(([, v]) => v !== null)
                        .map(([k, v]) => k + ": " + display(v as string))
                        .join(" · ")
                    : "Registro não encontrado"}
                </p>
                <p className="mt-1 text-neutral-400">
                  {captured
                    ? "Contexto preservado da análise · versão " +
                      captured.version
                    : "Cadastro atual · contexto original indisponível"}
                </p>
              </div>
            );
          })}
        </div>
      </details>
      <details className="mt-3 rounded border border-neutral-200 p-3 text-xs">
        <summary className="cursor-pointer">
          Contexto e auditoria da análise
        </summary>
        <p className="mt-3 text-neutral-500">
          Solicitado por {revision.createdBy} · {dateBR(revision.createdAt)} ·
          Execução {revision.runId}
        </p>
        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-3 text-[10px]">
          {JSON.stringify(revision.input, null, 2)}
        </pre>
      </details>
      {revision.status !== "pending" && (
        <p className="mt-4 text-xs text-neutral-500">
          Revisado em {revision.reviewedAt ? dateBR(revision.reviewedAt) : "—"}{" "}
          · Usuário {revision.reviewedBy}
          {revision.reason && " · Motivo: " + revision.reason}
        </p>
      )}
      {revision.status === "pending" && (
        <>
          <div className="mt-5">
            <Label htmlFor="review-reason">
              Observação da revisão · obrigatória ao recusar
            </Label>
            <Textarea
              id="review-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Registre o que está correto ou precisa melhorar..."
            />
          </div>
          <ErrorNote message={error} />
          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => decide("rejected")}
            >
              <X />
              Recusar revisão
            </Button>
            <Button disabled={busy || stale} onClick={() => decide("approved")}>
              <Check />
              Aprovar{" "}
              {revision.type === "data" ? "revisão inteira" : "mensagem"}
            </Button>
          </div>
        </>
      )}
      <ErrorNote message={revision.status !== "pending" ? error : ""} />
    </Dialog>
  );
}
