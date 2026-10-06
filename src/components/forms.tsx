"use client";
import { useState } from "react";
import {
  Upload,
  FileSpreadsheet,
  Download,
  Check,
  Plus,
  Trash2,
  ArrowRight,
  Loader2,
} from "lucide-react";
import Papa from "papaparse";
import {
  DATASETS,
  datasetNames,
  fieldsFor,
  type Cell,
  type Dataset,
} from "@/lib/domain/catalog";
import {
  contactKind,
  contactLabel,
  normalizedValue,
} from "@/lib/domain/values";
import { originatingContract } from "@/lib/domain/contracts";
import { brMoney } from "@/lib/utils";
import type { UserCommand } from "@/lib/domain/commands";
import type {
  DataRecord,
  Workspace,
  SavedList,
  Filter,
} from "@/lib/domain/types";
import type { Preview } from "@/lib/domain/csv";
import { LIST_FIELDS } from "@/lib/domain/lists";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input, Textarea, Label, Select, ErrorNote, Badge } from "./ui/fields";
const pendingCommands = new Map<string, string>();
export async function api(path: string, body?: unknown) {
  const fingerprint = JSON.stringify(body);
  const key =
    path === "/api/commands"
      ? (pendingCommands.get(fingerprint) ?? crypto.randomUUID())
      : null;
  if (key) pendingCommands.set(fingerprint, key);
  let response: Response;
  try {
    response = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: body
        ? {
            "Content-Type": "application/json",
            ...(key ? { "Idempotency-Key": key } : {}),
          }
        : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new Error(
      "Sem conexão com o servidor. Confira sua rede e tente novamente.",
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      "Não foi possível ler a resposta do servidor. Tente novamente.",
    );
  }
  if (!response.ok)
    throw new Error(result.error ?? "Não foi possível concluir a operação.");
  if (key) pendingCommands.delete(fingerprint);
  return result;
}
export function RecordForm({
  dataset,
  record,
  state,
  open,
  onClose,
  onSave,
}: {
  dataset: Dataset;
  record?: DataRecord;
  state: Workspace;
  open: boolean;
  onClose: () => void;
  onSave: (command: UserCommand) => Promise<void>;
}) {
  const fields = fieldsFor(dataset);
  const linkedSale =
    record &&
    dataset === "Oportunidades_Historico" &&
    Boolean(originatingContract(state, record.id));
  const lockedPair =
    linkedSale || (dataset === "Clientes_Atuais" && Boolean(record?.productId));
  const [data, setData] = useState<Record<string, Cell>>(() =>
    record
      ? Object.fromEntries(
          Object.entries(record.data).map(([key, value]) => {
            const field = fields.find((f) => f.key === key);
            return [
              key,
              field?.currency && typeof value === "number"
                ? brMoney(value)
                : normalizedValue(value),
            ];
          }),
        )
      : Object.fromEntries(
          fields.map((f) => [
            f.key,
            f.key === "external_id"
              ? (dataset === "Prospects"
                  ? "EMP-"
                  : dataset === "Portfolio"
                    ? "PROD-"
                    : "OPP-") + crypto.randomUUID().slice(0, 8).toUpperCase()
              : f.key === "commercial_status"
                ? "Prospect"
                : f.key === "outcome"
                  ? "Em negociação"
                  : null,
          ]),
        ),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: string) =>
    setData((prev) => {
      const updated = { ...prev, [key]: value };
      if (
        key === "company_external_id" &&
        dataset === "Oportunidades_Historico"
      )
        updated.sponsor_contact_id = null;
      if (key === "company_external_id") {
        const company = state.records.find(
          (r) => r.dataset === "Prospects" && r.externalKey === value,
        );
        if (company) {
          updated.company_name = company.data.name;
          if (dataset === "Clientes_Atuais") {
            for (const f of ["segment", "employees", "state"])
              updated[f] = company.data[f];
          }
        }
      }
      return updated;
    });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave({
        type: "record",
        dataset,
        data,
        ...(record ? { id: record.id, expectedVersion: record.version } : {}),
      });
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
      title={(record ? "Editar " : "Adicionar ") + DATASETS[dataset].singular}
      description="Todos os campos do cadastro estão disponíveis abaixo."
      wide
    >
      <form onSubmit={save}>
        {linkedSale && (
          <p className="mb-4 text-xs text-neutral-500">
            Esta venda originou uma contratação. Registre cancelamentos no
            status da contratação para preservar o histórico da venda.
          </p>
        )}
        {["Clientes_Atuais", "Oportunidades_Historico"].includes(dataset) &&
          !state.records.some((r) => r.dataset === "Portfolio") && (
            <p className="mb-4 text-xs text-orange-700">
              Cadastre ou importe uma solução no Portfólio antes de salvar.
            </p>
          )}
        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
          {fields
            .filter((f) => !f.hidden)
            .map((f) => (
              <div
                key={f.key}
                className={
                  [
                    "problem",
                    "value_proposition",
                    "evidence",
                    "description",
                    "rationale",
                    "notes",
                  ].includes(f.key)
                    ? "sm:col-span-2"
                    : ""
                }
              >
                <Label htmlFor={"field-" + f.key}>
                  {f.label.replace(" fictícia", "").replace(" fictício", "")}
                  {f.required && " *"}
                </Label>
                {f.key === "company_external_id" ? (
                  <Select
                    id={"field-" + f.key}
                    required
                    disabled={Boolean(lockedPair)}
                    value={String(data[f.key] ?? "")}
                    onChange={(e) => set(f.key, e.target.value)}
                  >
                    <option value="">Selecione a empresa</option>
                    {state.records
                      .filter((r) => r.dataset === "Prospects")
                      .map((r) => (
                        <option key={r.id} value={r.externalKey}>
                          {r.data.name} · {r.externalKey}
                        </option>
                      ))}
                  </Select>
                ) : f.key === "solution_external_id" ? (
                  <Select
                    id={"field-" + f.key}
                    required={f.required}
                    disabled={Boolean(lockedPair)}
                    value={String(data[f.key] ?? "")}
                    onChange={(e) => set(f.key, e.target.value)}
                  >
                    <option value="">Selecione uma solução</option>
                    {state.records
                      .filter((r) => r.dataset === "Portfolio")
                      .map((r) => (
                        <option key={r.id} value={r.externalKey}>
                          {r.data.name}
                        </option>
                      ))}
                  </Select>
                ) : f.key === "sponsor_contact_id" ? (
                  <Select
                    id={"field-" + f.key}
                    value={String(data[f.key] ?? "")}
                    onChange={(e) => set(f.key, e.target.value)}
                  >
                    <option value="">
                      Sem vínculo nominal · manter texto original
                    </option>
                    {state.records
                      .filter(
                        (r) =>
                          r.dataset === "Decisores_Canais" &&
                          (contactKind(r.data) === "person" ||
                            r.id === record?.contactId) &&
                          r.data.company_external_id ===
                            data.company_external_id,
                      )
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {contactLabel(r.data)} ·{" "}
                          {r.data.role || r.data.channel}
                        </option>
                      ))}
                  </Select>
                ) : f.choices ? (
                  <Select
                    id={"field-" + f.key}
                    required={f.required}
                    disabled={
                      f.readOnly || (f.key === "outcome" && Boolean(linkedSale))
                    }
                    value={String(data[f.key] ?? "")}
                    onChange={(e) => set(f.key, e.target.value)}
                  >
                    <option value="">Não informado</option>
                    {f.choices.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                ) : [
                    "problem",
                    "value_proposition",
                    "evidence",
                    "description",
                    "rationale",
                    "ticket_range",
                    "notes",
                  ].includes(f.key) ? (
                  <Textarea
                    id={"field-" + f.key}
                    value={String(data[f.key] ?? "")}
                    onChange={(e) => set(f.key, e.target.value)}
                    required={f.required}
                  />
                ) : (
                  <Input
                    id={"field-" + f.key}
                    value={String(data[f.key] ?? "")}
                    onChange={(e) => set(f.key, e.target.value)}
                    required={f.required}
                    readOnly={Boolean(
                      record && DATASETS[dataset].key === f.key,
                    )}
                    type={f.type === "date" ? "date" : "text"}
                    inputMode={
                      ["number", "integer"].includes(f.type)
                        ? "decimal"
                        : undefined
                    }
                  />
                )}
                {f.key === "commercial_status" && (
                  <p className="mt-1 text-xs text-neutral-500">
                    Cliente ativo enquanto houver ao menos uma contratação
                    ativa.
                  </p>
                )}
              </div>
            ))}
        </div>
        <ErrorNote message={error} />
        <div className="mt-6 flex justify-end gap-2 border-t border-neutral-100 pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />}Salvar{" "}
            {DATASETS[dataset].singular}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
export function ImportDialog({
  initialDataset,
  open,
  onClose,
  onImported,
}: {
  initialDataset: Dataset;
  open: boolean;
  onClose: () => void;
  onImported: (state: Workspace) => void;
}) {
  const [dataset, setDataset] = useState(initialDataset);
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async (file: File) => {
    setError("");
    setPreview(null);
    if (file.size > 5 * 1024 * 1024) {
      setError("O arquivo excede 5 MB.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Selecione um CSV. Arquivos XLSX não são aceitos.");
      return;
    }
    setFileName(file.name);
    setText(await file.text());
  };
  const run = async (mode: "preview" | "commit") => {
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/import", {
        mode,
        dataset,
        fileName,
        text,
        requestId,
      });
      if (mode === "preview") setPreview(result.preview);
      else {
        onImported(result.state);
        onClose();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const template = () => {
    const blob = new Blob(
      [
        "\uFEFF" +
          Papa.unparse([DATASETS[dataset].fields.map((f) => f.label)], {
            delimiter: ";",
          }) +
          "\r\n",
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = dataset + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Importar dados"
      description="Um CSV por aba. Confira os campos antes de confirmar a importação."
      wide
    >
      <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <Label htmlFor="import-type">Tipo de dados</Label>
          <Select
            id="import-type"
            value={dataset}
            onChange={(e) => {
              setDataset(e.target.value as Dataset);
              setPreview(null);
            }}
          >
            {datasetNames.map((d) => (
              <option key={d} value={d}>
                {DATASETS[d].label} · {d}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="outline" onClick={template}>
          <Download />
          Baixar modelo vazio
        </Button>
      </div>
      {dataset === "Clientes_Atuais" && (
        <p className="mt-4 text-xs text-neutral-500">
          Cada linha cria uma contratação por empresa e solução e vincula uma
          oportunidade ganha. O status Cliente ativo ou Churn é preservado na
          contratação.
        </p>
      )}
      <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50/50 p-8 text-center hover:bg-neutral-50">
        <FileSpreadsheet className="mb-3 text-neutral-400" size={28} />
        <span className="text-sm font-medium">
          {fileName || "Selecione seu arquivo CSV"}
        </span>
        <span className="mt-1 text-xs text-neutral-400">
          UTF-8 · até 5 MB · até 5.000 registros
        </span>
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="Arquivo CSV"
          className="mt-3 max-w-full text-xs"
          onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])}
        />
      </label>
      <ErrorNote message={error} />
      {preview && (
        <div className="mt-5">
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge tone="green">{preview.counts.new} novos</Badge>
            <Badge>{preview.counts.duplicate} repetidos</Badge>
            <Badge>{preview.counts.ignored} ignorados</Badge>
            <Badge tone="red">{preview.counts.invalid} inválidos</Badge>
            <Badge tone="orange">{preview.counts.conflict} conflitos</Badge>
          </div>
          {preview.errors.map((e) => (
            <ErrorNote key={e} message={e} />
          ))}
          <div className="max-h-72 overflow-auto rounded-md border border-neutral-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-neutral-50">
                <tr>
                  <th className="p-2">Linha</th>
                  <th className="p-2">Verificação</th>
                  {preview.headers.map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap p-2 text-left font-medium"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} className="border-t border-neutral-100">
                    <td className="p-2">{r.line}</td>
                    <td className="min-w-40 p-2 text-xs">
                      {r.issues.join(" ") ||
                        {
                          new: "Novo",
                          duplicate: "Já importado",
                          conflict: "Conflito",
                          invalid: "Inválido",
                          ignored: "Ignorado",
                        }[r.status]}
                    </td>
                    {preview.headers.map((h) => (
                      <td
                        key={h}
                        className="max-w-64 truncate p-2"
                        title={r.raw[h]}
                      >
                        {r.raw[h] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            O conteúdo original das linhas importadas será preservado junto ao
            registro. Linhas ignoradas não criam cadastros.
          </p>
        </div>
      )}
      <div className="mt-6 flex justify-end gap-2 border-t border-neutral-100 pt-4">
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        {!preview ? (
          <Button disabled={!fileName || busy} onClick={() => run("preview")}>
            {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}
            Conferir dados
          </Button>
        ) : (
          <Button
            disabled={
              busy ||
              !!preview.errors.length ||
              !!preview.counts.invalid ||
              !!preview.counts.conflict ||
              (!preview.counts.new && !preview.counts.duplicate)
            }
            onClick={() => run("commit")}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Upload />}Confirmar
            importação
          </Button>
        )}
      </div>
    </Dialog>
  );
}
export function ListForm({
  list,
  open,
  onClose,
  onSave,
}: {
  list?: SavedList;
  open: boolean;
  onClose: () => void;
  onSave: (command: UserCommand) => Promise<void>;
}) {
  const [name, setName] = useState(list?.name ?? "");
  const [filters, setFilters] = useState<Filter[]>(list?.filters ?? []);
  const [sort, setSort] = useState<SavedList["sort"]>(
    list?.sort ?? [
      { field: "commercial", direction: "desc" },
      { field: "icp", direction: "desc" },
    ],
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [id] = useState(list?.id ?? crypto.randomUUID());
  const update = (i: number, key: keyof Filter, value: string) =>
    setFilters(filters.map((f, n) => (n === i ? { ...f, [key]: value } : f)));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave({ type: "list", id, name, filters, sort });
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
      title={list ? "Editar lista" : "Criar lista"}
      description="Salve critérios de seleção. A lista acompanha as mudanças na sua base."
      wide
    >
      <form onSubmit={save}>
        <Label htmlFor="list-name">Nome da lista</Label>
        <Input
          id="list-name"
          placeholder="Ex.: Empresas com alta aderência"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <div className="mb-3 mt-6 flex justify-between">
          <span className="text-sm font-medium">Critérios de seleção</span>
          <Badge>Todas as condições devem ser atendidas</Badge>
        </div>
        {filters.map((f, i) => (
          <div className="mb-2 grid grid-cols-[1fr_1fr_1fr_auto] gap-2" key={i}>
            <Select
              aria-label={"Campo do filtro " + (i + 1)}
              value={f.field}
              onChange={(e) => update(i, "field", e.target.value)}
            >
              {LIST_FIELDS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label={"Operador do filtro " + (i + 1)}
              value={f.operator}
              onChange={(e) => update(i, "operator", e.target.value)}
            >
              <option value="equals">É igual a</option>
              <option value="in">Está entre os valores</option>
              <option value="contains">Contém</option>
              <option value="gte">Maior ou igual a</option>
              <option value="lte">Menor ou igual a</option>
              <option value="exists">Está informado</option>
            </Select>
            <Input
              aria-label={"Valor do filtro " + (i + 1)}
              value={
                f.operator === "in" ? f.value.split("|").join(", ") : f.value
              }
              disabled={f.operator === "exists"}
              placeholder={f.operator === "in" ? "Valor 1, Valor 2" : "Valor"}
              onChange={(e) =>
                update(
                  i,
                  "value",
                  f.operator === "in"
                    ? e.target.value
                        .split(",")
                        .map((v) => v.trim())
                        .join("|")
                    : e.target.value,
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remover filtro"
              onClick={() => setFilters(filters.filter((_, n) => n !== i))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setFilters([
              ...filters,
              { field: "commercial", operator: "gte", value: "" },
            ])
          }
        >
          <Plus />
          Adicionar condição
        </Button>
        <div className="mt-6">
          <Label>Ordenação</Label>
          {sort.map((s, i) => (
            <div
              key={i}
              className="mb-2 grid grid-cols-[100px_1fr_1fr] items-center gap-3"
            >
              <span className="text-xs text-neutral-500">
                {i === 0 ? "Principal" : "Desempate"}
              </span>
              <Select
                aria-label={"Ordenação " + (i + 1)}
                value={s.field}
                onChange={(e) =>
                  setSort(
                    sort.map((x, n) =>
                      n === i ? { ...x, field: e.target.value } : x,
                    ),
                  )
                }
              >
                {LIST_FIELDS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={"Direção " + (i + 1)}
                value={s.direction}
                onChange={(e) =>
                  setSort(
                    sort.map((x, n) =>
                      n === i
                        ? { ...x, direction: e.target.value as "asc" | "desc" }
                        : x,
                    ),
                  )
                }
              >
                <option value="desc">Maior para menor</option>
                <option value="asc">Menor para maior</option>
              </Select>
            </div>
          ))}
        </div>
        <ErrorNote message={error} />
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy}>
            Salvar lista
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
