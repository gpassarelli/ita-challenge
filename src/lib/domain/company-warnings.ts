import { isMissing } from "./values";
import type { DataRecord, Workspace } from "./types";
export function companyWarnings(
  state: Workspace,
  record: DataRecord,
): string[] {
  const company = state.records.find((r) => r.id === record.companyId);
  if (!company) return [];
  const pairs = [
    ["company_name", "name", "Empresa"],
    ["segment", "segment", "Segmento"],
    ["employees", "employees", "Colaboradores"],
    ["state", "state", "UF"],
  ];
  const warnings: string[] = [];
  for (const [key, target, label] of pairs) {
    const original = record.data[key],
      current = company.data[target];
    if (!isMissing(original) && !isMissing(current) && original !== current)
      warnings.push(
        label +
          " diverge do cadastro da empresa: origem “" +
          original +
          "”; cadastro “" +
          current +
          "”. Ambos foram preservados.",
      );
  }
  return warnings;
}
