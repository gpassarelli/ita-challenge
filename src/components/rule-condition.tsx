"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { FACT_FIELDS, OPERATORS } from "@/lib/domain/scoring";
import { Button } from "./ui/button";
import { Input, Select, Label, ErrorNote } from "./ui/fields";
export function Condition({
  field,
  operator,
  value,
  onChange,
  contacts = false,
}: {
  field: string;
  operator: string;
  value: string;
  onChange: (key: string, value: string) => void;
  contacts?: boolean;
}) {
  const bounds = value.split("|");
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <Label>Campo avaliado</Label>
        <Select
          aria-label="Campo avaliado"
          value={field}
          onChange={(e) => onChange("field", e.target.value)}
        >
          <option value="">Selecione o campo</option>
          {FACT_FIELDS.filter(
            (f) =>
              contacts || !["channel_type", "contact_source"].includes(f.key),
          ).map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Condição</Label>
        <Select
          aria-label="Condição"
          value={operator}
          onChange={(e) => onChange("operator", e.target.value)}
        >
          {OPERATORS.filter((o) => !contacts || o.value !== "scale").map(
            (o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ),
          )}
        </Select>
      </div>
      <div>
        {operator === "scale" ? (
          <>
            <Label>Escala por categoria</Label>
            <p className="text-xs leading-relaxed text-neutral-500">
              Defina quanto cada categoria recebe do peso deste critério.
            </p>
          </>
        ) : operator === "between" ? (
          <>
            <Label>Intervalo aceito</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                aria-label="Valor mínimo"
                placeholder="Mínimo"
                inputMode="decimal"
                value={bounds[0] ?? ""}
                onChange={(e) =>
                  onChange("value", e.target.value + "|" + (bounds[1] ?? ""))
                }
              />
              <Input
                aria-label="Valor máximo"
                placeholder="Máximo"
                inputMode="decimal"
                value={bounds[1] ?? ""}
                onChange={(e) =>
                  onChange("value", (bounds[0] ?? "") + "|" + e.target.value)
                }
              />
            </div>
          </>
        ) : (
          <>
            <Label>
              {operator === "in" ? "Valores aceitos" : "Valor esperado"}
            </Label>
            <Input
              aria-label="Valor esperado"
              value={operator === "in" ? value.split("|").join(", ") : value}
              disabled={operator === "exists"}
              onChange={(e) =>
                onChange(
                  "value",
                  operator === "in"
                    ? e.target.value
                        .split(",")
                        .map((v) => v.trim())
                        .join("|")
                    : e.target.value,
                )
              }
              placeholder={operator === "in" ? "Ex.: SP, RJ, MG" : "Ex.: Sim"}
            />
          </>
        )}
      </div>
      {operator === "scale" && (
        <div className="sm:col-span-3">
          <ScaleValues value={value} onChange={(v) => onChange("value", v)} />
        </div>
      )}
    </div>
  );
}
function ScaleValues({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [rows, setRows] = useState<{ category: string; percent: number }[]>(
    () => {
      try {
        const mapping = JSON.parse(value);
        if (mapping && typeof mapping === "object" && !Array.isArray(mapping))
          return Object.entries(mapping).map(([category, factor]) => ({
            category,
            percent: Number(factor) * 100,
          }));
      } catch {}
      return [{ category: "", percent: 0 }];
    },
  );
  const [error, setError] = useState("");
  const update = (next: typeof rows) => {
    setRows(next);
    const valid = next.filter((r) => r.category.trim());
    const duplicate =
      new Set(valid.map((r) => r.category.trim().toLocaleLowerCase("pt-BR")))
        .size !== valid.length;
    setError(duplicate ? "Cada categoria deve aparecer uma única vez." : "");
    onChange(
      duplicate
        ? "{}"
        : JSON.stringify(
            Object.fromEntries(
              valid.map((r) => [r.category.trim(), r.percent / 100]),
            ),
          ),
    );
  };
  return (
    <div className="rounded-md bg-neutral-50 p-3">
      <div className="mb-2 grid grid-cols-[1fr_130px_32px] gap-2 text-[11px] text-neutral-500">
        <span>Categoria</span>
        <span>Percentual do peso</span>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="mb-2 grid grid-cols-[1fr_130px_32px] gap-2">
          <Input
            aria-label={"Categoria " + (i + 1)}
            placeholder="Ex.: Alto"
            value={r.category}
            onChange={(e) =>
              update(
                rows.map((row, n) =>
                  n === i ? { ...row, category: e.target.value } : row,
                ),
              )
            }
          />
          <Input
            aria-label={"Percentual da categoria " + (i + 1)}
            type="number"
            min={0}
            max={100}
            step={1}
            value={r.percent}
            onChange={(e) =>
              update(
                rows.map((row, n) =>
                  n === i ? { ...row, percent: Number(e.target.value) } : row,
                ),
              )
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={"Remover categoria " + (i + 1)}
            onClick={() => update(rows.filter((_, n) => n !== i))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <ErrorNote message={error} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setRows([...rows, { category: "", percent: 0 }])}
      >
        <Plus />
        Adicionar categoria
      </Button>
    </div>
  );
}
