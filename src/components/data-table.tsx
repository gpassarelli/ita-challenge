"use client";
import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Search,
  Plus,
  Upload,
  Building2,
  SlidersHorizontal,
} from "lucide-react";
import { DATASETS, fieldsFor, type Dataset } from "@/lib/domain/catalog";
import type { DataRecord, Workspace } from "@/lib/domain/types";
import {
  contactKind,
  contactLabel,
  isMissing,
  normalizedValue,
} from "@/lib/domain/values";
import { productName } from "@/lib/domain/contracts";
import { display, brNumber, brMoney } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge, Input } from "./ui/fields";
export function RecordTable({
  dataset,
  records,
  state,
  onOpen,
  onNew,
  onImport,
  selected,
  onSelection,
  search,
  setSearch,
  extra,
}: {
  dataset: Dataset;
  records: DataRecord[];
  state: Workspace;
  onOpen: (r: DataRecord) => void;
  onNew: () => void;
  onImport: () => void;
  selected: string[];
  onSelection: (ids: string[]) => void;
  search: string;
  setSearch: (s: string) => void;
  extra?: React.ReactNode;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const fields = fieldsFor(dataset).filter((field) => !field.hidden);
  const defaults: Record<string, string[]> = {
    Prospects: [
      "name",
      "domain",
      "segment",
      "employees",
      "state",
      "commercial_status",
    ],
    Decisores_Canais: [
      "name",
      "company_name",
      "role",
      "channel_type",
      "channel",
      "identified",
    ],
    Sinais_Publicos: [
      "company_name",
      "signal_type",
      "evidence",
      "strength",
      "date",
      "source",
    ],
    Portfolio: [
      "name",
      "category",
      "problem",
      "value_proposition",
      "ticket_range",
    ],
    Clientes_Atuais: [
      "company_name",
      "solution_external_id",
      "annual_ticket",
      "customer_status",
    ],
    Oportunidades_Historico: [
      "company_name",
      "solution_external_id",
      "outcome",
      "estimated_ticket",
      "cycle_days",
      "reason",
    ],
  };
  const [visibility, setVisibility] = useState<VisibilityState>(() =>
    Object.fromEntries(
      fields.map((f) => [
        f.key,
        defaults[dataset] ? defaults[dataset].includes(f.key) : true,
      ]),
    ),
  );
  const filtered = useMemo(
    () =>
      records.filter((r) =>
        Object.values(r.data).some((v) =>
          String(normalizedValue(v) ?? "")
            .toLocaleLowerCase("pt-BR")
            .includes(search.toLocaleLowerCase("pt-BR")),
        ),
      ),
    [records, search],
  );
  const columns = useMemo<ColumnDef<DataRecord>[]>(() => {
    const base: ColumnDef<DataRecord>[] = [
      {
        id: "select",
        header: () => (
          <input
            aria-label="Selecionar todas as linhas"
            type="checkbox"
            checked={
              filtered.length > 0 &&
              filtered.every((r) => selected.includes(r.id))
            }
            onChange={(e) =>
              onSelection(e.target.checked ? filtered.map((r) => r.id) : [])
            }
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={
              "Selecionar " +
              String(row.original.data.name ?? row.original.externalKey)
            }
            checked={selected.includes(row.original.id)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              onSelection(
                e.target.checked
                  ? [...selected, row.original.id]
                  : selected.filter((id) => id !== row.original.id),
              )
            }
          />
        ),
        enableSorting: false,
      },
      ...fields.map((f) => ({
        id: f.key,
        accessorFn: (r: DataRecord) =>
          f.key === "solution_external_id"
            ? productName(state, r)
            : normalizedValue(r.data[f.key]),
        header: f.label.replace(" fictício", "").replace(" fictícia", ""),
        cell: ({ row }: { row: { original: DataRecord } }) => {
          const value =
            f.key === "solution_external_id"
              ? productName(state, row.original)
              : row.original.data[f.key];
          if (f.key === "commercial_status" || f.key === "customer_status")
            return (
              <Badge
                tone={
                  value === "Cliente ativo"
                    ? "green"
                    : ["Ex-cliente", "Churn"].includes(String(value))
                      ? "orange"
                      : "neutral"
                }
              >
                {display(value)}
              </Badge>
            );
          if (f.key === "outcome")
            return (
              <Badge
                tone={
                  value === "Ganha"
                    ? "green"
                    : value === "Perdida"
                      ? "red"
                      : "blue"
                }
              >
                {display(value)}
              </Badge>
            );
          if (f.key === "name" || f.key === "company_name")
            return (
              <span className="flex items-center gap-2 font-medium text-neutral-800">
                {f.key === "name" && dataset === "Prospects" && (
                  <span
                    aria-hidden="true"
                    className="grid size-6 shrink-0 place-items-center rounded border border-neutral-200 bg-neutral-50 text-[10px] text-neutral-500"
                  >
                    {String(value ?? "?")
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                )}
                {f.key === "name" && dataset === "Decisores_Canais" ? (
                  <>
                    {contactLabel(row.original.data)}
                    <Badge>
                      {contactKind(row.original.data) === "person"
                        ? "Pessoa"
                        : contactKind(row.original.data) === "channel"
                          ? "Canal"
                          : "Sem contato"}
                    </Badge>
                  </>
                ) : (
                  display(value)
                )}
              </span>
            );
          return (
            <span className={isMissing(value) ? "text-neutral-400" : ""}>
              {f.currency && typeof value === "number"
                ? brMoney(value)
                : display(value)}
            </span>
          );
        },
      })),
    ];
    if (dataset === "Prospects")
      base.splice(
        3,
        0,
        ...(["icp", "commercial"] as const).map((kind) => ({
          id: kind,
          header: kind === "icp" ? "Aderência ao ICP" : "Prioridade comercial",
          accessorFn: (r: DataRecord) =>
            state.evaluations.find((e) => e.companyId === r.id)?.[kind].value ??
            null,
          cell: ({ row }: { row: { original: DataRecord } }) => {
            const score = state.evaluations.find(
              (e) => e.companyId === row.original.id,
            )?.[kind];
            return score?.value !== null && score?.value !== undefined ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="h-1 w-10 overflow-hidden rounded bg-neutral-100">
                  <span
                    className="block h-full rounded bg-[#79a791]"
                    style={{ width: score.value + "%" }}
                  />
                </span>
                <span className="font-medium tabular-nums">
                  {brNumber(score.value, 1)}
                </span>
                <span
                  className="text-[10px] text-neutral-400"
                  title="Cobertura de evidências"
                >
                  {brNumber(score.coverage)}%
                </span>
                {score.status === "insufficient" && (
                  <span className="text-[10px] text-neutral-400">
                    Sem dados suficientes
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[11px] text-neutral-400">
                {score?.status === "insufficient"
                  ? "Sem dados suficientes"
                  : "Não configurado"}
              </span>
            );
          },
        })),
      );
    return base;
  }, [dataset, fields, state.evaluations, selected, filtered, onSelection]);
  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, columnVisibility: visibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-neutral-200 bg-white px-6 py-3">
        <div className="flex items-center gap-2">
          {extra}
          <div className="relative">
            <Search
              className="absolute left-2.5 top-2.5 text-neutral-400"
              size={15}
            />
            <Input
              aria-label="Buscar registros"
              placeholder="Buscar nesta tabela..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-56 border-transparent bg-neutral-50 pl-8"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="mr-2 text-xs text-neutral-400">
            {records.length} registros
          </span>
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50">
              <Columns3 size={14} />
              Colunas
            </summary>
            <div className="absolute right-0 z-20 mt-2 max-h-80 w-60 overflow-auto rounded-lg border border-neutral-200 bg-white p-3 shadow-lg">
              {table
                .getAllLeafColumns()
                .filter((c) => c.id !== "select")
                .map((c) => (
                  <label key={c.id} className="flex gap-2 py-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={c.getIsVisible()}
                      onChange={c.getToggleVisibilityHandler()}
                    />
                    {typeof c.columnDef.header === "string"
                      ? c.columnDef.header
                      : c.id}
                  </label>
                ))}
            </div>
          </details>
        </div>
      </div>
      {selected.length > 0 && (
        <div className="flex items-center gap-3 bg-orange-50 px-6 py-2 text-xs text-orange-900">
          <span>{selected.length} selecionados</span>
          <button
            onClick={() => onSelection([])}
            className="underline underline-offset-2"
          >
            Limpar seleção
          </button>
        </div>
      )}
      <div className="flex-1 overflow-auto bg-white">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-[#fafaf9] text-neutral-500">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    className="h-10 whitespace-nowrap border-b border-r border-neutral-200 px-3 font-medium first:w-10 first:pl-6"
                  >
                    <div className="flex items-center justify-between gap-3">
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {header.column.getCanSort() && (
                        <button
                          aria-label={
                            "Ordenar por " +
                            String(header.column.columnDef.header)
                          }
                          onClick={header.column.getToggleSortingHandler()}
                          className="text-neutral-300 hover:text-neutral-600"
                        >
                          {header.column.getIsSorted() === "asc" ? (
                            <ArrowUp size={12} />
                          ) : header.column.getIsSorted() === "desc" ? (
                            <ArrowDown size={12} />
                          ) : (
                            <ArrowUpDown size={12} />
                          )}
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (
                    e.target === e.currentTarget &&
                    (e.key === "Enter" || e.key === " ")
                  ) {
                    e.preventDefault();
                    onOpen(row.original);
                  }
                }}
                onClick={() => onOpen(row.original)}
                className="h-12 cursor-pointer border-b border-neutral-100 hover:bg-[#fbfaf7]"
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="max-w-80 truncate border-r border-neutral-100 px-3 py-3 first:pl-6"
                    title={
                      typeof cell.getValue() === "string"
                        ? String(cell.getValue())
                        : undefined
                    }
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <div className="flex min-h-[410px] flex-col items-center justify-center px-6 pb-10 text-center">
            <div className="empty-illustration mb-7" aria-hidden="true">
              <div className="empty-paper">
                <div className="flex items-center gap-2 border-b border-neutral-100 pb-3">
                  <span className="size-5 rounded bg-orange-100" />
                  <span className="h-1.5 w-14 rounded bg-neutral-200" />
                </div>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="mt-3 flex items-center gap-2">
                    <span className="size-3 rounded-sm border border-neutral-200" />
                    <span className="h-1.5 w-20 rounded bg-neutral-100" />
                    <span className="ml-auto h-1.5 w-6 rounded bg-neutral-100" />
                  </div>
                ))}
              </div>
              <div className="empty-plus">
                <Plus size={17} />
              </div>
            </div>
            <h2 className="text-base font-semibold tracking-tight text-neutral-800">
              {search || records.length
                ? "Nenhum registro encontrado"
                : "Um espaço para suas " +
                  (dataset === "Prospects"
                    ? "próximas oportunidades"
                    : DATASETS[dataset].label.toLocaleLowerCase("pt-BR"))}
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-neutral-500">
              {search || records.length
                ? "Ajuste os filtros ou a busca para encontrar o que procura."
                : "Importe um CSV ou adicione seu primeiro registro. As informações ficam organizadas e conectadas aqui."}
            </p>
            {!search && !records.length && (
              <div className="mt-6 flex gap-2">
                <Button onClick={onImport}>
                  <Upload />
                  Importar CSV
                </Button>
                <Button variant="outline" onClick={onNew}>
                  <Plus />
                  Adicionar registro
                </Button>
              </div>
            )}
            <p className="mt-4 text-[11px] text-neutral-400">
              Seus dados. Suas regras. Cada decisão com uma evidência.
            </p>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-neutral-200 bg-white px-6 py-3 text-xs text-neutral-400">
        <span>
          {filtered.length
            ? brNumber(filtered.length) + " registros"
            : "Nenhum registro"}{" "}
          · {fields.length} campos disponíveis
        </span>
        <div className="flex items-center gap-2">
          <span>
            Página {table.getState().pagination.pageIndex + 1} de{" "}
            {Math.max(1, table.getPageCount())}
          </span>
          <Button
            variant="ghost"
            size="icon"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
            aria-label="Página anterior"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
            aria-label="Próxima página"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
