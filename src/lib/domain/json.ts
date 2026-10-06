export function canonical(data: unknown): string {
  if (Array.isArray(data)) return "[" + data.map(canonical).join(",") + "]";
  if (data && typeof data === "object")
    return (
      "{" +
      Object.entries(data)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(data);
}
