"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2,
  Users,
  Radio,
  Columns3,
  Package,
  Layers3,
  ClipboardCheck,
  Settings2,
  Plus,
  Upload,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Search,
  Sparkles,
  MessageSquare,
  SlidersHorizontal,
  ArrowRight,
  Check,
  RefreshCw,
  LogOut,
  Menu,
  HelpCircle,
  Database,
  Clock3,
  Loader2,
  ListFilter,
  Pencil,
  X,
  Link2,
} from "lucide-react";
import { DATASETS, type Dataset } from "@/lib/domain/catalog";
import {
  emptyWorkspace,
  type Workspace,
  type DataRecord,
  type RuleSet,
  type SavedList,
  type AgentRun,
} from "@/lib/domain/types";
import type { UserCommand } from "@/lib/domain/commands";
import {
  contractFor,
  originatingContract,
  productName,
} from "@/lib/domain/contracts";
import { isMissing } from "@/lib/domain/values";
import { selectList } from "@/lib/domain/lists";
import { cn, display, dateBR, brMoney } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge, Select, ErrorNote } from "./ui/fields";
import { Dialog } from "./ui/dialog";
import { RecordTable } from "./data-table";
import { RecordForm, ImportDialog, ListForm, api } from "./forms";
import { RulesEditor } from "./rules-editor";
import { AgentDialog, ReviewDialog } from "./agents-and-reviews";
import {
  ExecutionPanel,
  RunList,
  type ExecutionTarget,
} from "./execution-panel";
import { RecordDetail } from "./record-detail";
const NAV = [
  { name: "Empresas", icon: Building2, dataset: "Prospects" },
  { name: "Pessoas e canais", icon: Users, dataset: "Decisores_Canais" },
  { name: "Sinais", icon: Radio, dataset: "Sinais_Publicos" },
  { name: "Oportunidades", icon: Columns3, dataset: "Oportunidades_Historico" },
  { name: "Contratações", icon: Link2, dataset: "Clientes_Atuais" },
  { name: "Portfólio", icon: Package, dataset: "Portfolio" },
  { name: "Listas", icon: Layers3 },
  { name: "Revisões", icon: ClipboardCheck },
  { name: "Configurações", icon: Settings2 },
] as const;
const DESCRIPTIONS: Record<string, string> = {
  Empresas: "O contexto de cada empresa, do primeiro sinal à próxima conversa.",
  "Pessoas e canais":
    "Decisores, contatos e canais que aproximam você das empresas.",
  Sinais: "Evidências para entender o momento de cada empresa.",
  Oportunidades: "Acompanhe cada conversa e os próximos passos do seu negócio.",
  Contratações:
    "Soluções contratadas, valores e status ativo ou Churn por empresa.",
  Portfólio:
    "Os produtos e as propostas de valor que orientam suas abordagens.",
  Listas: "Seu foco comercial, atualizado conforme os dados mudam.",
  Revisões: "A inteligência sugere. Você decide o que segue adiante.",
  Configurações: "Defina o que significa uma boa oportunidade para você.",
};
export function WorkspaceApp({
  connected,
  user,
}: {
  connected: boolean;
  user: { id: string; email: string } | null;
}) {
  const [state, setState] = useState<Workspace>(emptyWorkspace);
  const [page, setPage] = useState("Empresas");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(connected);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [aiReady, setAiReady] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [datasetSub, setDatasetSub] = useState<Dataset>("ICP_Criterios");
  const [status, setStatus] = useState("");
  const [signalStrength, setSignalStrength] = useState("");
  const [contractStatus, setContractStatus] = useState("");
  const [listId, setListId] = useState("");
  const [kanban, setKanban] = useState(true);
  const [reviewFilter, setReviewFilter] = useState("pending");
  const [recordForm, setRecordForm] = useState<{
    dataset: Dataset;
    id?: string;
  } | null>(null);
  const [importing, setImporting] = useState<Dataset | null>(null);
  const [executionTarget, setExecutionTarget] =
    useState<ExecutionTarget | null>(null);
  const executionTrigger = useRef<HTMLButtonElement>(null);
  const [detailTab, setDetailTab] = useState("Dados");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [rulesKind, setRulesKind] = useState<RuleSet["kind"] | null>(null);
  const [listForm, setListForm] = useState<{ list?: SavedList } | null>(null);
  const [agent, setAgent] = useState<{
    agent: "signals" | "outreach";
    companyIds: string[];
  } | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);
  const refreshing = useRef(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!connected || refreshing.current) return;
    refreshing.current = true;
    try {
      const r = await api("/api/workspace");
      setState(r.state);
      setAiReady(r.aiReady);
      setLastUpdated(new Date().toLocaleTimeString("pt-BR"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      refreshing.current = false;
      setLoading(false);
    }
  }, [connected]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const pendingRun = state.runs.some(
    (r) => r.status === "running" || r.status === "queued",
  );
  useEffect(() => {
    if (!connected) return;
    const id = setInterval(
      () => {
        if (document.visibilityState === "visible") void refresh();
      },
      pendingRun ? 4000 : 30000,
    );
    return () => clearInterval(id);
  }, [connected, pendingRun, refresh]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(id);
  }, [notice]);
  const requireConnection = () => {
    if (!connected) {
      setSetup(true);
      return false;
    }
    return true;
  };
  const save = async (command: UserCommand) => {
    const result = await api("/api/commands", command);
    setState(result.state);
    setNotice(
      command.type === "archiveRun"
        ? "Execução arquivada para a equipe."
        : command.type === "review"
          ? "Revisão registrada."
          : command.type === "rules"
            ? "Configuração salva e notas atualizadas."
            : "Alterações salvas.",
    );
  };
  const resumeRun = async (run: AgentRun) => {
    try {
      const result = await api("/api/agents", {
        id: run.id,
        agent: run.agent,
        companyIds: run.companyIds,
        productId: run.productId,
        contactId: run.contactId,
        channel: run.channel,
      });
      setState(result.state);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const openRecord = (id: string) => {
    setDetailTab("Dados");
    setDetailId(id);
  };
  const go = (p: string) => {
    setPage(p);
    setSearch("");
    setSelected([]);
    setMobile(false);
    if (p !== "Empresas") setListId("");
  };
  const dataset =
    (
      NAV.find((n) => n.name === page && "dataset" in n) as
        { dataset: Dataset } | undefined
    )?.dataset ?? datasetSub;
  const activeList = state.lists.find((l) => l.id === listId);
  let records =
    page === "Empresas" && activeList
      ? selectList(state, activeList)
      : state.records.filter((r) => r.dataset === dataset);
  if (page === "Empresas" && status)
    records = records.filter((r) => r.data.commercial_status === status);
  if (page === "Sinais" && signalStrength)
    records = records.filter((r) =>
      signalStrength === "missing"
        ? isMissing(r.data.strength)
        : r.data.strength === signalStrength,
    );
  if (page === "Contratações" && contractStatus)
    records = records.filter((r) => r.data.customer_status === contractStatus);
  const detail = state.records.find((r) => r.id === detailId);
  const revision = state.revisions.find((r) => r.id === reviewId);
  const pendingReviews = state.revisions.filter(
    (r) => r.status === "pending",
  ).length;
  const startAgent = (a: "signals" | "outreach", ids: string[]) => {
    if (requireConnection()) setAgent({ agent: a, companyIds: ids });
  };
  const add = (d: Dataset = dataset) => {
    if (requireConnection()) setRecordForm({ dataset: d });
  };
  const importCsv = (d: Dataset = dataset) => setImporting(d);
  const move = async (r: DataRecord, outcome: string) => {
    try {
      await save({
        type: "move",
        id: r.id,
        outcome: outcome as "Ganha",
        expectedVersion: r.version,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const table = (d: Dataset = dataset, rows: DataRecord[] = records) => (
    <RecordTable
      key={d + "-" + listId}
      dataset={d}
      records={rows}
      state={state}
      onOpen={(r) => openRecord(r.id)}
      onNew={() => add(d)}
      onImport={() => importCsv(d)}
      selected={selected}
      onSelection={setSelected}
      search={search}
      setSearch={setSearch}
      extra={
        page === "Empresas" ? (
          <>
            <Select
              aria-label="Filtrar status comercial"
              className="h-8 w-40 text-xs"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Todos os status</option>
              {["Prospect", "Cliente ativo", "Ex-cliente"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
            {activeList && (
              <Button variant="outline" size="sm" onClick={() => setListId("")}>
                <ListFilter />
                {activeList.name}
                <X size={12} />
              </Button>
            )}
          </>
        ) : page === "Contratações" ? (
          <Select
            aria-label="Filtrar status da contratação"
            className="h-8 w-40 text-xs"
            value={contractStatus}
            onChange={(e) => setContractStatus(e.target.value)}
          >
            <option value="">Todos os status</option>
            <option>Cliente ativo</option>
            <option>Churn</option>
          </Select>
        ) : page === "Sinais" ? (
          <Select
            aria-label="Filtrar força do sinal"
            className="h-8 w-36 text-xs"
            value={signalStrength}
            onChange={(e) => setSignalStrength(e.target.value)}
          >
            <option value="">Todas as forças</option>
            <option value="missing">Não informado</option>
            {["Alto", "Médio", "Baixo"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        ) : undefined
      }
    />
  );
  return (
    <div className="flex h-dvh overflow-clip">
      {mobile && (
        <button
          aria-label="Fechar menu"
          onClick={() => setMobile(false)}
          className="fixed inset-0 z-20 bg-black/20 lg:hidden"
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-[220px] shrink-0 flex-col border-r border-[#e8e7e2] bg-[#f6f5f1] lg:static",
          !mobile && "hidden lg:flex",
        )}
      >
        <div className="flex h-[70px] items-center px-6">
          <span className="text-[30px] font-semibold tracking-[-2px]">
            allya<span className="text-[#e37a58]">.</span>
          </span>
          <span className="ml-auto rounded border border-neutral-200 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-neutral-400">
            prospecção
          </span>
        </div>
        <div className="mx-3 mb-5 flex items-center gap-2.5 rounded-lg border border-[#e5e3dc] bg-white/70 p-2.5">
          <span className="grid size-7 place-items-center rounded-md bg-[#e8e9df] text-[11px] font-semibold text-[#55654f]">
            A
          </span>
          <span className="flex-1 text-xs font-medium">Minha equipe</span>
          <Badge>Equipe</Badge>
        </div>
        <p className="px-5 pb-2 text-[9px] font-medium uppercase tracking-[.14em] text-neutral-400">
          Prospecção
        </p>
        <nav className="space-y-0.5 px-3">
          {NAV.map((n, i) => (
            <div key={n.name}>
              {i === 7 && <div className="my-4 border-t border-[#e7e5df]" />}
              <button
                onClick={() => go(n.name)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-[12px] transition-colors",
                  page === n.name
                    ? "bg-white font-semibold text-[#363b32] shadow-[0_1px_3px_#00000009] ring-1 ring-[#e5e3dc]"
                    : "text-[#797b72] hover:bg-white/60 hover:text-neutral-800",
                )}
              >
                <n.icon
                  size={15}
                  strokeWidth={1.7}
                  className={page === n.name ? "text-[#a47652]" : ""}
                />
                <span>{n.name}</span>
                {n.name === "Revisões" && pendingReviews > 0 && (
                  <span className="ml-auto rounded bg-[#f8e1d4] px-1.5 text-[10px] text-[#9b583f]">
                    {pendingReviews}
                  </span>
                )}
              </button>
            </div>
          ))}
        </nav>
        <div className="mt-auto p-3">
          <div className="mb-4 rounded-lg border border-[#e5e3dc] bg-[#efece4]/50 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-neutral-600">
              <Sparkles size={14} className="text-[#ac8969]" />
              Contexto vira oportunidade
            </div>
            <p className="text-[11px] leading-[1.7] text-neutral-500">
              Organize seus dados e deixe os agentes conectarem os sinais.
            </p>
            <button
              onClick={() => {
                go("Configurações");
              }}
              className="mt-2 flex items-center gap-1 text-[11px] font-medium text-[#976f52]"
            >
              Definir minhas regras
              <ArrowRight size={12} />
            </button>
          </div>
          <button
            onClick={() => setSetup(true)}
            className="mb-3 flex w-full items-center gap-2 px-2 text-xs text-neutral-400"
          >
            <HelpCircle size={14} />
            Conexões e ajuda
          </button>
          <div className="flex items-center gap-2 border-t border-[#e6e4df] px-2 pt-4">
            <span className="grid size-7 place-items-center rounded-full bg-[#e4e4dd] text-xs font-medium text-neutral-500">
              {user?.email.slice(0, 1).toUpperCase() ?? "A"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-medium">
                {user?.email ?? "Seu espaço de trabalho"}
              </p>
              <p className="text-[10px] text-neutral-400">
                {connected ? "Equipe compartilhada" : "Aguardando conexão"}
              </p>
            </div>
            {connected && (
              <button
                aria-label="Sair da conta"
                onClick={async () => {
                  await api("/api/auth", { action: "logout" });
                  window.location.reload();
                }}
              >
                <LogOut size={14} className="text-neutral-400" />
              </button>
            )}
          </div>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col bg-white">
        <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-neutral-200/80 px-5 text-[11px] text-neutral-400">
          <div className="flex items-center gap-2">
            <button
              aria-label="Abrir menu"
              className="mr-2 lg:hidden"
              onClick={() => setMobile(true)}
            >
              <Menu size={18} />
            </button>
            <span
              className={cn(
                "hidden items-center gap-2 sm:flex",
                executionTarget && "lg:hidden 2xl:flex",
              )}
            >
              <span>Espaço de trabalho</span>
              <ChevronRight size={12} />
              <span className="text-neutral-600">{page}</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Button
              ref={executionTrigger}
              variant="ghost"
              size="sm"
              aria-label="Abrir execuções"
              aria-expanded={!!executionTarget}
              onClick={() =>
                setExecutionTarget(executionTarget ? null : { runId: null })
              }
            >
              <Clock3 />
              Execuções
              <span
                className="text-[10px]"
                title="Execuções em andamento / revisões pendentes"
              >
                {
                  state.runs.filter(
                    (r) => r.status === "queued" || r.status === "running",
                  ).length
                }{" "}
                <span className="hidden xl:inline">em andamento</span> ·{" "}
                {pendingReviews}{" "}
                <span className="hidden xl:inline">pendentes</span>
              </span>
            </Button>
            <span
              className={cn(
                "hidden items-center gap-1.5 sm:flex",
                executionTarget && "lg:hidden 2xl:flex",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  connected ? "bg-[#77a387]" : "bg-[#c4bda8]",
                )}
              />
              {connected ? "Conectado" : "Sem conexão com o banco"}
            </span>
            <button
              aria-label="Atualizar dados"
              onClick={() => void refresh()}
              disabled={!connected}
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
            <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[9px]">
              PT-BR
            </span>
          </div>
        </div>
        {!connected && (
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[#eee7d8] bg-[#fbf8f0] px-6 py-2 text-[11px] text-[#938366]">
            <span>
              Seu espaço está pronto. Conecte o banco para cadastrar e importar
              seus dados.
            </span>
            <button
              onClick={() => setSetup(true)}
              className="flex shrink-0 items-center gap-1 font-medium text-[#8e7352]"
            >
              Configurar conexão
              <ArrowUpRight size={12} />
            </button>
          </div>
        )}
        <header className="shrink-0 px-6 pb-5 pt-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[25px] font-semibold tracking-[-.8px]">
                  {page}
                </h1>
                {page === "Empresas" && (
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-400">
                    {
                      state.records.filter((r) => r.dataset === "Prospects")
                        .length
                    }
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-neutral-500">
                {DESCRIPTIONS[page]}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!["Listas", "Revisões", "Configurações"].includes(page) && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => importCsv()}
                  >
                    <Upload />
                    Importar CSV
                  </Button>
                  <Button size="sm" onClick={() => add()}>
                    <Plus />
                    {page === "Empresas"
                      ? "Nova empresa"
                      : page === "Pessoas e canais"
                        ? "Novo contato"
                        : page === "Sinais"
                          ? "Novo sinal"
                          : page === "Contratações"
                            ? "Nova contratação"
                            : page === "Oportunidades"
                              ? "Nova oportunidade"
                              : page === "Portfólio"
                                ? "Novo produto"
                                : "Novo registro"}
                  </Button>
                </>
              )}
              {page === "Listas" && (
                <Button
                  size="sm"
                  onClick={() => requireConnection() && setListForm({})}
                >
                  <Plus />
                  Criar lista
                </Button>
              )}
              {page === "Configurações" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => importCsv("ICP_Criterios")}
                >
                  <Upload />
                  Importar critérios
                </Button>
              )}
            </div>
          </div>
          {page === "Empresas" && (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-5">
                <button
                  className="flex items-center gap-1.5 text-xs font-medium text-neutral-700"
                  onClick={() => setListId("")}
                >
                  <Building2 size={13} />
                  Todas as empresas
                  {!listId && (
                    <span className="ml-1 size-1 rounded-full bg-[#e76645]" />
                  )}
                </button>
                <button
                  className="flex items-center gap-1.5 text-xs text-neutral-400"
                  onClick={() => go("Listas")}
                >
                  <Layers3 size={13} />
                  Minhas listas
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!selected.length}
                  onClick={() => startAgent("signals", selected)}
                >
                  <Sparkles />
                  Analisar sinais
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!selected.length}
                  onClick={() => startAgent("outreach", selected)}
                >
                  <MessageSquare />
                  Preparar abordagem
                </Button>
              </div>
            </div>
          )}
          {page === "Oportunidades" && (
            <div className="mt-5 flex gap-1">
              <Button
                size="sm"
                variant={kanban ? "outline" : "ghost"}
                onClick={() => setKanban(true)}
              >
                <Columns3 />
                Kanban
              </Button>
              <Button
                size="sm"
                variant={!kanban ? "outline" : "ghost"}
                onClick={() => setKanban(false)}
              >
                <Layers3 />
                Tabela
              </Button>
            </div>
          )}
        </header>
        {error && (
          <div className="mx-6">
            <ErrorNote message={error} />
            {lastUpdated && (
              <p className="mb-2 text-xs text-neutral-500">
                Mantivemos os últimos dados recebidos, às {lastUpdated}. Uma
                falha de atualização não significa que o agente parou.
              </p>
            )}
            <button
              onClick={() => void refresh()}
              className="mb-3 text-xs underline"
            >
              Tentar novamente
            </button>
          </div>
        )}
        {loading ? (
          <div className="grid flex-1 place-items-center text-sm text-neutral-400">
            <span className="flex items-center gap-2">
              <Loader2 size={17} className="animate-spin" />
              Carregando seus dados...
            </span>
          </div>
        ) : (
          <div className="page-enter flex min-h-0 flex-1 flex-col" key={page}>
            {[
              "Empresas",
              "Pessoas e canais",
              "Sinais",
              "Portfólio",
              "Contratações",
            ].includes(page) && table()}
            {page === "Oportunidades" &&
              (kanban ? (
                <div className="grid flex-1 auto-cols-[minmax(270px,1fr)] grid-flow-col gap-4 overflow-auto border-t border-neutral-200 bg-[#fafaf8] p-6">
                  {["Em negociação", "Ganha", "Perdida"].map((outcome, i) => {
                    const rows = state.records.filter(
                      (r) =>
                        r.dataset === "Oportunidades_Historico" &&
                        r.data.outcome === outcome,
                    );
                    return (
                      <section
                        key={outcome}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const r = state.records.find(
                            (r) =>
                              r.id === e.dataTransfer.getData("text/plain"),
                          );
                          if (r?.dataset === "Oportunidades_Historico")
                            void move(r, outcome);
                        }}
                        className="rounded-xl border border-neutral-200/80 bg-[#f2f2ee] p-3"
                      >
                        <div className="mb-4 flex items-center gap-2 px-1 text-xs font-medium">
                          <span
                            className={cn(
                              "size-2 rounded-full",
                              i === 0
                                ? "bg-[#c7ad79]"
                                : i === 1
                                  ? "bg-[#7fa18b]"
                                  : "bg-[#c78f82]",
                            )}
                          />
                          {outcome}
                          <span className="ml-1 text-neutral-400">
                            {rows.length}
                          </span>
                          <span className="ml-auto text-[10px] font-normal text-neutral-400">
                            {brMoney(
                              rows.reduce(
                                (s, r) =>
                                  s + Number(r.data.estimated_ticket ?? 0),
                                0,
                              ),
                            )}
                          </span>
                        </div>
                        {rows.map((r) => (
                          <article
                            key={r.id}
                            draggable={!originatingContract(state, r.id)}
                            onDragStart={(e) =>
                              e.dataTransfer.setData("text/plain", r.id)
                            }
                            className="mb-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-[0_2px_4px_#00000003]"
                          >
                            <button
                              onClick={() => openRecord(r.id)}
                              className="w-full text-left"
                            >
                              <p className="mb-2 text-[10px] text-neutral-400">
                                {r.externalKey}
                              </p>
                              <h3 className="text-sm font-semibold">
                                {display(r.data.company_name)}
                              </h3>
                              <p className="mt-2 text-xs font-medium text-neutral-700">
                                {display(productName(state, r))}
                              </p>
                              {contractFor(state, r) && (
                                <Badge>
                                  {display(
                                    contractFor(state, r)!.data.customer_status,
                                  )}
                                </Badge>
                              )}
                              <p className="mt-2 text-xs text-neutral-500">
                                {display(r.data.reason)}
                              </p>
                              <p className="mt-4 text-sm font-medium">
                                {r.data.estimated_ticket !== null
                                  ? brMoney(Number(r.data.estimated_ticket))
                                  : "Valor não informado"}
                              </p>
                            </button>
                            <Select
                              aria-label={
                                "Etapa da oportunidade " + r.externalKey
                              }
                              className="mt-4 h-8 text-xs"
                              disabled={Boolean(
                                originatingContract(state, r.id),
                              )}
                              value={String(r.data.outcome)}
                              onChange={(e) => void move(r, e.target.value)}
                            >
                              {["Em negociação", "Ganha", "Perdida"].map(
                                (v) => (
                                  <option key={v}>{v}</option>
                                ),
                              )}
                            </Select>
                          </article>
                        ))}
                        {!rows.length && (
                          <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300/70 px-4 text-center">
                            <Columns3
                              size={22}
                              strokeWidth={1}
                              className="mb-3 text-neutral-300"
                            />
                            <p className="text-xs text-neutral-400">
                              Nenhuma oportunidade nesta etapa
                            </p>
                            <button
                              onClick={() => add("Oportunidades_Historico")}
                              className="mt-3 flex items-center gap-1 text-xs text-neutral-500"
                            >
                              <Plus size={12} />
                              Adicionar oportunidade
                            </button>
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              ) : (
                table()
              ))}
            {page === "Listas" && (
              <div className="flex-1 overflow-auto border-t border-neutral-200 bg-[#fafaf8] p-6">
                {state.lists.length ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {state.lists.map((l) => (
                      <article
                        key={l.id}
                        className="rounded-xl border border-neutral-200 bg-white p-5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="grid size-9 place-items-center rounded-lg bg-[#f3eee5] text-[#a78963]">
                            <ListFilter size={17} />
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={"Editar lista " + l.name}
                            onClick={() => setListForm({ list: l })}
                          >
                            <Pencil />
                          </Button>
                        </div>
                        <h2 className="mt-4 text-sm font-semibold">{l.name}</h2>
                        <p className="mt-2 text-xs text-neutral-400">
                          {l.filters.length} condições · Atualização dinâmica
                        </p>
                        <div className="mt-5 flex items-center justify-between">
                          <span className="text-xs text-neutral-500">
                            {selectList(state, l).length} empresas
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              go("Empresas");
                              setStatus("");
                              setListId(l.id);
                            }}
                          >
                            Abrir lista
                            <ArrowUpRight />
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <Empty
                    icon={Layers3}
                    title="Encontre seu próximo foco"
                    description="Combine critérios e salve listas que acompanham a evolução das empresas."
                    action="Criar primeira lista"
                    onClick={() => requireConnection() && setListForm({})}
                  />
                )}
              </div>
            )}
            {page === "Configurações" && (
              <div className="flex-1 overflow-auto border-t border-neutral-200 bg-[#fafaf8] p-6">
                <div className="grid gap-4 lg:grid-cols-3">
                  {(["icp", "commercial", "exclusions"] as const).map(
                    (kind) => {
                      const active = state.rulesets.find(
                        (r) => r.kind === kind && r.active,
                      );
                      return (
                        <article
                          key={kind}
                          className="rounded-xl border border-neutral-200 bg-white p-5"
                        >
                          <div className="mb-4 flex justify-between">
                            <span className="grid size-9 place-items-center rounded-lg bg-[#f3eee5] text-[#a78963]">
                              <SlidersHorizontal size={17} />
                            </span>
                            <Badge tone={active ? "green" : "neutral"}>
                              {active
                                ? "Ativo · v" + active.version
                                : "Não configurado"}
                            </Badge>
                          </div>
                          <h2 className="text-sm font-semibold">
                            {
                              {
                                icp: "Aderência ao ICP",
                                commercial: "Prioridade comercial",
                                exclusions: "Desqualificadores",
                              }[kind]
                            }
                          </h2>
                          <p className="mt-2 min-h-10 text-xs leading-relaxed text-neutral-500">
                            {
                              {
                                icp: "O quanto cada empresa corresponde ao seu perfil de cliente ideal.",
                                commercial:
                                  "Os sinais e o contexto que definem quem abordar primeiro.",
                                exclusions:
                                  "Condições de exclusão, bloqueio de canais e penalidades.",
                              }[kind]
                            }
                          </p>
                          <Button
                            className="mt-5 w-full"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              requireConnection() && setRulesKind(kind)
                            }
                          >
                            <Settings2 />
                            {active ? "Editar regras" : "Configurar regras"}
                          </Button>
                        </article>
                      );
                    },
                  )}
                </div>
                <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">
                        Configurações importadas
                      </h2>
                      <p className="mt-1 text-xs text-neutral-500">
                        As descrições originais ficam em rascunho até você
                        associá-las a critérios executáveis.
                      </p>
                    </div>
                    <Select
                      aria-label="Tabela de configurações"
                      value={
                        [
                          "ICP_Criterios",
                          "Regras_Score_Exemplo",
                          "Desqualificadores",
                        ].includes(datasetSub)
                          ? datasetSub
                          : "ICP_Criterios"
                      }
                      onChange={(e) => setDatasetSub(e.target.value as Dataset)}
                      className="w-56 text-xs"
                    >
                      {(
                        [
                          "ICP_Criterios",
                          "Regras_Score_Exemplo",
                          "Desqualificadores",
                        ] as Dataset[]
                      ).map((d) => (
                        <option key={d} value={d}>
                          {DATASETS[d].label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {state.records
                      .filter(
                        (r) =>
                          r.dataset ===
                          ([
                            "ICP_Criterios",
                            "Regras_Score_Exemplo",
                            "Desqualificadores",
                          ].includes(datasetSub)
                            ? datasetSub
                            : "ICP_Criterios"),
                      )
                      .map((r) => (
                        <button
                          onClick={() => openRecord(r.id)}
                          className="rounded border border-neutral-200 px-3 py-2 text-xs hover:bg-neutral-50"
                          key={r.id}
                        >
                          {String(
                            r.data.criterion ??
                              r.data.condition ??
                              r.externalKey,
                          )}
                          <span className="ml-2 text-neutral-400">
                            Ver campos ↗
                          </span>
                        </button>
                      ))}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        importCsv(
                          [
                            "ICP_Criterios",
                            "Regras_Score_Exemplo",
                            "Desqualificadores",
                          ].includes(datasetSub)
                            ? datasetSub
                            : "ICP_Criterios",
                        )
                      }
                    >
                      <Upload />
                      Importar CSV
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        add(
                          [
                            "ICP_Criterios",
                            "Regras_Score_Exemplo",
                            "Desqualificadores",
                          ].includes(datasetSub)
                            ? datasetSub
                            : "ICP_Criterios",
                        )
                      }
                    >
                      <Plus />
                      Cadastrar descrição
                    </Button>
                  </div>
                </div>
                <div className="mt-6 flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-5">
                  <Link2 size={17} className="mt-0.5 text-neutral-400" />
                  <div className="flex-1">
                    <h2 className="text-sm font-semibold">
                      Conexões do espaço de trabalho
                    </h2>
                    <p className="mt-2 text-xs text-neutral-500">
                      Supabase:{" "}
                      {connected ? "conectado" : "aguardando configuração"} ·
                      Agentes de IA:{" "}
                      {aiReady ? "configurados" : "aguardando configuração"}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSetup(true)}
                  >
                    Ver detalhes
                  </Button>
                </div>
              </div>
            )}
            {page === "Revisões" && (
              <div className="flex-1 overflow-auto border-t border-neutral-200 bg-[#fafaf8] p-6">
                <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {[
                    { label: "Aguardando decisão", count: pendingReviews },
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
                      count: state.revisions.filter(
                        (r) => r.status === "rejected",
                      ).length,
                    },
                  ].map((m) => (
                    <div
                      key={m.label}
                      className="rounded-lg border border-neutral-200 bg-white p-4"
                    >
                      <p className="text-[11px] text-neutral-500">{m.label}</p>
                      <p className="mt-2 text-2xl font-semibold tracking-tight">
                        {m.count}
                      </p>
                    </div>
                  ))}
                </div>
                <section className="mb-5" aria-label="Execuções dos agentes">
                  <h2 className="mb-3 text-sm font-medium">
                    Execuções dos agentes
                  </h2>
                  <RunList
                    state={state}
                    runs={state.runs.filter((r) => !r.archivedAt)}
                    onOpen={(run) => setExecutionTarget({ runId: run.id })}
                  />
                </section>
                <div className="mb-4 flex gap-2">
                  {[
                    { value: "pending", label: "Pendentes" },
                    { value: "approved", label: "Aprovadas" },
                    { value: "rejected", label: "Recusadas" },
                  ].map((t) => (
                    <Button
                      key={t.value}
                      variant={reviewFilter === t.value ? "outline" : "ghost"}
                      size="sm"
                      onClick={() => setReviewFilter(t.value)}
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
                {state.revisions.filter((r) => r.status === reviewFilter)
                  .length ? (
                  <div className="space-y-3">
                    {state.revisions
                      .filter((r) => r.status === reviewFilter)
                      .slice()
                      .reverse()
                      .map((r) => (
                        <button
                          key={r.id}
                          onClick={() => setReviewId(r.id)}
                          className="flex w-full items-center gap-4 rounded-lg border border-neutral-200 bg-white p-4 text-left hover:border-neutral-300"
                        >
                          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#f4eee5] text-[#a38661]">
                            {r.type === "data" ? (
                              <Sparkles size={18} />
                            ) : (
                              <MessageSquare size={18} />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">
                              {display(
                                state.records.find((c) => c.id === r.companyId)
                                  ?.data.name,
                              )}
                            </p>
                            <p className="mt-1 text-xs text-neutral-500">
                              {r.type === "data"
                                ? r.changes.length + " alterações propostas"
                                : "Mensagem de abordagem"}{" "}
                              · {r.promptVersion} · {dateBR(r.createdAt)}
                            </p>
                          </div>
                          <ArrowUpRight
                            size={15}
                            className="text-neutral-400"
                          />
                        </button>
                      ))}
                  </div>
                ) : (
                  <Empty
                    icon={ClipboardCheck}
                    title={
                      reviewFilter === "pending"
                        ? "Tudo em dia por aqui"
                        : "Nenhuma revisão nesta categoria"
                    }
                    description="Execute uma análise ou prepare uma abordagem a partir das empresas. As propostas dos agentes aparecem aqui."
                  />
                )}
                {state.revisions.length > 0 && (
                  <details className="mt-6 rounded border border-neutral-200 bg-white p-4">
                    <summary className="cursor-pointer text-xs font-medium">
                      Qualidade por agente e versão do prompt
                    </summary>
                    {[
                      ...new Set(state.revisions.map((r) => r.promptVersion)),
                    ].map((v) => {
                      const rows = state.revisions.filter(
                        (r) => r.promptVersion === v,
                      );
                      return (
                        <p key={v} className="mt-3 text-xs text-neutral-500">
                          {v} ·{" "}
                          {
                            rows.filter(
                              (r) => r.status === "approved" && !r.edited,
                            ).length
                          }{" "}
                          sem edição ·{" "}
                          {
                            rows.filter(
                              (r) => r.status === "approved" && r.edited,
                            ).length
                          }{" "}
                          com edição ·{" "}
                          {rows.filter((r) => r.status === "rejected").length}{" "}
                          recusadas
                        </p>
                      );
                    })}
                  </details>
                )}
              </div>
            )}
          </div>
        )}
      </main>
      {executionTarget && (
        <ExecutionPanel
          state={state}
          target={executionTarget}
          onTarget={setExecutionTarget}
          triggerRef={executionTrigger}
          onClose={() => setExecutionTarget(null)}
          onSave={save}
          onResume={resumeRun}
          onReturnCompany={(id) => {
            setExecutionTarget(null);
            setDetailTab("Execuções");
            setDetailId(id);
          }}
        />
      )}
      {notice && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-[80] flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-xs shadow-lg"
        >
          <Check size={14} className="text-emerald-600" />
          {notice}
        </div>
      )}
      {recordForm && (
        <RecordForm
          key={recordForm.id ?? recordForm.dataset}
          open
          dataset={recordForm.dataset}
          record={state.records.find((r) => r.id === recordForm.id)}
          state={state}
          onClose={() => setRecordForm(null)}
          onSave={save}
        />
      )}
      {importing && (
        <ImportDialog
          open
          initialDataset={importing}
          onClose={() => setImporting(null)}
          onImported={(s) => {
            setState(s);
            setNotice("CSV importado. Origem e valores preservados.");
          }}
        />
      )}
      {detail && (
        <RecordDetail
          key={detail.id}
          open
          record={detail}
          initialTab={detailTab}
          onOpenRun={(runId) => {
            setDetailId(null);
            setExecutionTarget({
              runId,
              companyId: detail.id,
              returnCompanyId: detail.id,
            });
          }}
          state={state}
          onClose={() => setDetailId(null)}
          onEdit={(r) => {
            setDetailId(null);
            setRecordForm({ dataset: r.dataset, id: r.id });
          }}
          onOpenRecord={(r) => openRecord(r.id)}
          onAgent={(a, ids) => {
            setDetailId(null);
            startAgent(a, ids);
          }}
          onReview={(id) => {
            setDetailId(null);
            setReviewId(id);
          }}
          onAddCommercial={() => {
            setDetailId(null);
            add("Clientes_Atuais");
          }}
        />
      )}
      {rulesKind && (
        <RulesEditor
          key={rulesKind}
          open
          kind={rulesKind}
          state={state}
          onClose={() => setRulesKind(null)}
          onSave={save}
        />
      )}
      {listForm && (
        <ListForm
          open
          list={listForm.list}
          onClose={() => setListForm(null)}
          onSave={save}
        />
      )}
      {agent && (
        <AgentDialog
          key={agent.agent + agent.companyIds.join()}
          open
          {...agent}
          state={state}
          onClose={() => setAgent(null)}
          onReview={(id) => {
            setAgent(null);
            const pending = state.revisions.find((r) => r.id === id);
            setExecutionTarget({
              runId: pending?.runId ?? null,
              revisionId: id,
              companyId: pending?.companyId,
            });
          }}
          onStarted={(s, runId) => {
            setState(s);
            setExecutionTarget({
              runId,
              companyId:
                s.runs.find((r) => r.id === runId)?.items.length === 1
                  ? s.runs.find((r) => r.id === runId)?.items[0].companyId
                  : undefined,
            });
            setNotice(
              "Execução iniciada. Você pode acompanhar o progresso aqui.",
            );
          }}
        />
      )}
      {revision && (
        <ReviewDialog
          key={revision.id}
          open
          revision={revision}
          state={state}
          onClose={() => setReviewId(null)}
          onSave={save}
        />
      )}
      <Dialog
        open={setup}
        onOpenChange={setSetup}
        title="Conexões do espaço de trabalho"
        description="Uma base vazia, pronta para receber seus dados."
      >
        <div className="space-y-5">
          <div className="rounded-lg border border-neutral-200 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Banco de dados e acesso</h3>
              <Badge tone={connected ? "green" : "orange"}>
                {connected ? "Conectado" : "Pendente"}
              </Badge>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-neutral-500">
              Configure seu projeto Supabase, aplique as migrações e crie as
              contas da equipe. O aplicativo usa login por e-mail e senha.
            </p>
          </div>
          <div className="rounded-lg border border-neutral-200 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Agentes de inteligência artificial
              </h3>
              <Badge tone={aiReady ? "green" : "orange"}>
                {aiReady ? "Configurado" : "Pendente"}
              </Badge>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-neutral-500">
              Adicione a chave da OpenAI e escolha o modelo no servidor. As
              análises são executadas em segundo plano, com até três empresas
              simultâneas.
            </p>
          </div>
          <p className="text-xs leading-relaxed text-neutral-400">
            O passo a passo de conexão e publicação está no README do projeto.
            As credenciais ficam no servidor. Nenhum registro ou regra comercial
            vem pré-carregado.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  description,
  action,
  onClick,
}: {
  icon: typeof Building2;
  title: string;
  description: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-white px-6 py-12 text-center">
      <span className="mb-5 grid size-12 place-items-center rounded-xl bg-[#f4f0e7] text-[#b5a085]">
        <Icon size={23} strokeWidth={1.4} />
      </span>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-neutral-400">
        {description}
      </p>
      {action && (
        <Button className="mt-5" size="sm" onClick={onClick}>
          <Plus />
          {action}
        </Button>
      )}
    </div>
  );
}
