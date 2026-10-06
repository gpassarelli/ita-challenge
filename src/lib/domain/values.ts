import { isMissing, type Cell } from "./catalog";
export { isMissing } from "./catalog";

export function normalizedValue(value: Cell | undefined): Cell {
  return isMissing(value) ? null : value!;
}

export function contactKind(
  data: Record<string, Cell>,
): "person" | "channel" | null {
  if (!isMissing(data.name)) return "person";
  return isMissing(data.channel) ? null : "channel";
}

export function contactLabel(data: Record<string, Cell>): string {
  const kind = contactKind(data);
  return kind === "person"
    ? String(data.name)
    : kind === "channel"
      ? String(data.channel)
      : "Contato sem nome ou canal";
}
