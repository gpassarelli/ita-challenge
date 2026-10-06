import { contactKind, normalizedValue } from "./values";
import type { Cell } from "./catalog";
import { conditionNumber } from "./scoring";
import type { DataRecord, Filter, SavedList, Workspace } from "./types";
export const LIST_FIELDS = [
  { key: "name", label: "Empresa" },
  { key: "commercial_status", label: "Status comercial" },
  { key: "segment", label: "Segmento" },
  { key: "state", label: "UF" },
  { key: "employees", label: "Colaboradores" },
  { key: "structured_hr", label: "RH estruturado" },
  { key: "growth", label: "Crescimento" },
  { key: "renewal", label: "Renovação" },
  { key: "icp", label: "Aderência ao ICP" },
  { key: "commercial", label: "Prioridade comercial" },
  { key: "icp_coverage", label: "Cobertura ICP" },
  { key: "commercial_coverage", label: "Cobertura comercial" },
  { key: "qualified", label: "Não desqualificada" },
  { key: "has_signals", label: "Tem sinais" },
  { key: "has_decisor", label: "Tem decisor" },
];
export function listValue(
  state: Workspace,
  record: DataRecord,
  field: string,
): Cell {
  const e = state.evaluations.find((e) => e.companyId === record.id);
  if (field === "icp" || field === "commercial")
    return e?.[field].value ?? null;
  if (field === "icp_coverage") return e?.icp.coverage ?? null;
  if (field === "commercial_coverage") return e?.commercial.coverage ?? null;
  if (field === "qualified") return e ? (e.disqualified ? "Não" : "Sim") : null;
  if (field === "has_signals")
    return state.records.some(
      (r) => r.dataset === "Sinais_Publicos" && r.companyId === record.id,
    )
      ? "Sim"
      : "Não";
  if (field === "has_decisor")
    return state.records.some(
      (r) =>
        r.dataset === "Decisores_Canais" &&
        r.companyId === record.id &&
        r.data.identified === "Sim" &&
        contactKind(r.data) === "person" &&
        !e?.blockedContactIds.includes(r.id),
    )
      ? "Sim"
      : "Não";
  return normalizedValue(record.data[field]);
}
export function filterMatches(value: Cell, filter: Filter) {
  value = normalizedValue(value);
  if (value === null) return false;
  if (filter.operator === "exists") return true;
  if (filter.operator === "gte" || filter.operator === "lte")
    return (
      typeof value === "number" &&
      Number.isFinite(conditionNumber(filter.value)) &&
      (filter.operator === "gte"
        ? value >= conditionNumber(filter.value)
        : value <= conditionNumber(filter.value))
    );
  const text = String(value).toLocaleLowerCase("pt-BR");
  const target = filter.value.toLocaleLowerCase("pt-BR");
  if (filter.operator === "contains") return text.includes(target);
  if (filter.operator === "in")
    return target
      .split("|")
      .map((v) => v.trim())
      .includes(text);
  return text === target;
}
export function selectList(
  state: Workspace,
  list: Pick<SavedList, "filters" | "sort">,
) {
  return state.records
    .filter(
      (r) =>
        r.dataset === "Prospects" &&
        list.filters.every((f) =>
          filterMatches(listValue(state, r, f.field), f),
        ),
    )
    .sort((a, b) => {
      for (const sort of list.sort) {
        const va = listValue(state, a, sort.field),
          vb = listValue(state, b, sort.field);
        if (va === null && vb === null) continue;
        if (va === null) return 1;
        if (vb === null) return -1;
        const diff =
          typeof va === "number" && typeof vb === "number"
            ? va - vb
            : String(va).localeCompare(String(vb), "pt-BR", { numeric: true });
        if (diff) return diff * (sort.direction === "asc" ? 1 : -1);
      }
      return a.externalKey.localeCompare(b.externalKey);
    });
}
