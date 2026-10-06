"use client";
import { useId, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { isMissing } from "@/lib/domain/values";
import {
  describeAlternative,
  PERSON_FIELDS,
  SIGNAL_FIELDS,
  RELATED_OPERATORS,
  SIGNAL_STRENGTHS,
} from "@/lib/domain/scoring";
import type {
  CriterionAlternative,
  RelatedFilter,
  Workspace,
} from "@/lib/domain/types";
import { Condition } from "./rule-condition";
import { Button } from "./ui/button";
import { Input, Select, Label } from "./ui/fields";

function blankAlternative(
  source: CriterionAlternative["source"],
): CriterionAlternative {
  if (source === "company")
    return { source, field: "", operator: "equals", value: "" };
  if (source === "person")
    return {
      source,
      filters: [{ field: "role", operator: "contains", value: "" }],
    };
  return {
    source,
    filters: [{ field: "signal_type", operator: "equals", value: "" }],
    minStrength: "Alto",
    recentDays: 90,
  };
}
export function RuleAlternatives({
  alternatives,
  state,
  onChange,
}: {
  alternatives: CriterionAlternative[];
  state: Workspace;
  onChange: (alternatives: CriterionAlternative[]) => void;
}) {
  // Preserve local scale-editor drafts when an earlier alternative is removed.
  const [keys, setKeys] = useState(() => alternatives.map((_, i) => i));
  const nextKey = useRef(alternatives.length);
  const replace = (index: number, a: CriterionAlternative) =>
    onChange(alternatives.map((old, i) => (i === index ? a : old)));
  return (
    <div className="space-y-3">
      {alternatives.map((a, i) => (
        <fieldset
          key={keys[i]}
          className="min-w-0 rounded-md border border-neutral-200 p-3"
        >
          <legend className="px-1 text-xs font-medium text-neutral-500">
            {i ? "OU · " : ""}Alternativa {i + 1}
          </legend>
          <div className="mb-3 flex items-end gap-3">
            <div className="min-w-0 flex-1">
              <Label>Fonte da avaliação</Label>
              <Select
                aria-label={"Fonte da alternativa " + (i + 1)}
                value={a.source}
                onChange={(e) =>
                  replace(
                    i,
                    blankAlternative(
                      e.target.value as CriterionAlternative["source"],
                    ),
                  )
                }
              >
                <option value="company">Empresa</option>
                <option value="person">Pessoa</option>
                <option value="signal">Sinal</option>
              </Select>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={"Remover alternativa " + (i + 1)}
              disabled={alternatives.length === 1}
              onClick={() => {
                setKeys(keys.filter((_, n) => n !== i));
                onChange(alternatives.filter((_, n) => n !== i));
              }}
            >
              <Trash2 />
            </Button>
          </div>
          {a.source === "company" ? (
            <>
              <Condition
                key={a.field}
                field={a.field}
                operator={a.operator}
                value={a.value}
                onChange={(key, value) => replace(i, { ...a, [key]: value })}
              />
              {a.field === "strong_recent_signal" && (
                <div className="mt-3 max-w-40">
                  <Label>Recência em dias</Label>
                  <Input
                    aria-label="Recência em dias"
                    type="number"
                    min={1}
                    max={3650}
                    value={a.recentDays ?? 90}
                    onChange={(e) =>
                      replace(i, { ...a, recentDays: Number(e.target.value) })
                    }
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <p className="mb-3 text-xs text-neutral-500">
                Todos os filtros devem ser atendidos{" "}
                {a.source === "person"
                  ? "pela mesma pessoa nomeada. Canais institucionais e contatos bloqueados não pontuam."
                  : "pelo mesmo sinal."}
              </p>
              <RelatedFilters
                source={a.source}
                filters={a.filters}
                state={state}
                onChange={(filters) => replace(i, { ...a, filters })}
              />
              {a.source === "signal" && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Força mínima</Label>
                    <Select
                      aria-label="Força mínima"
                      value={a.minStrength}
                      onChange={(e) =>
                        replace(i, {
                          ...a,
                          minStrength: e.target.value as typeof a.minStrength,
                        })
                      }
                    >
                      {SIGNAL_STRENGTHS.map((strength) => (
                        <option key={strength} value={strength}>
                          {strength}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label>Recência em dias</Label>
                    <Input
                      aria-label="Recência em dias"
                      type="number"
                      min={1}
                      max={3650}
                      value={a.recentDays}
                      onChange={(e) =>
                        replace(i, { ...a, recentDays: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
              )}
            </>
          )}
          <p className="mt-3 text-xs leading-relaxed text-neutral-500">
            {describeAlternative(a)}
          </p>
        </fieldset>
      ))}
      <Button
        variant="outline"
        size="sm"
        disabled={alternatives.length >= 10}
        onClick={() => {
          setKeys([...keys, nextKey.current++]);
          onChange([...alternatives, blankAlternative("company")]);
        }}
      >
        <Plus />
        Adicionar alternativa (OU)
      </Button>
    </div>
  );
}

function RelatedFilters({
  source,
  filters,
  state,
  onChange,
}: {
  source: "person" | "signal";
  filters: RelatedFilter[];
  state: Workspace;
  onChange: (filters: RelatedFilter[]) => void;
}) {
  const id = useId();
  const fields = source === "person" ? PERSON_FIELDS : SIGNAL_FIELDS;
  const patch = (i: number, changes: Partial<RelatedFilter>) =>
    onChange(filters.map((f, n) => (i === n ? { ...f, ...changes } : f)));
  return (
    <div className="space-y-3">
      {filters.map((f, i) => {
        const suggestions = [
          ...new Set(
            state.records
              .filter(
                (r) =>
                  r.dataset ===
                    (source === "person"
                      ? "Decisores_Canais"
                      : "Sinais_Publicos") && !isMissing(r.data[f.field]),
              )
              .map((r) => String(r.data[f.field])),
          ),
        ].sort((a, b) => a.localeCompare(b, "pt-BR"));
        if (f.field === "identified")
          for (const value of ["Sim", "Não"])
            if (!suggestions.includes(value)) suggestions.push(value);
        return (
          <div
            key={i}
            className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
          >
            <div>
              <Label>{i ? "E · Campo" : "Campo"}</Label>
              <Select
                aria-label={"Campo do filtro " + (i + 1)}
                value={f.field}
                onChange={(e) =>
                  patch(i, {
                    field: e.target.value,
                    operator:
                      e.target.value === "channel" ? "exists" : "equals",
                    value: "",
                  })
                }
              >
                {fields.map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.key === "channel" ? "Canal informado" : field.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Condição</Label>
              <Select
                aria-label={"Condição do filtro " + (i + 1)}
                value={f.operator}
                onChange={(e) =>
                  patch(i, {
                    operator: e.target.value as RelatedFilter["operator"],
                  })
                }
              >
                {RELATED_OPERATORS.filter(
                  (o) => f.field !== "channel" || o.value === "exists",
                ).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>
                {f.operator === "in"
                  ? "Valores separados por vírgula"
                  : "Valor"}
              </Label>
              <Input
                aria-label={"Valor do filtro " + (i + 1)}
                list={id + "-" + i}
                disabled={f.operator === "exists"}
                value={
                  f.operator === "in" ? f.value.split("|").join(", ") : f.value
                }
                onChange={(e) =>
                  patch(i, {
                    value:
                      f.operator === "in"
                        ? e.target.value
                            .split(",")
                            .map((v) => v.trim())
                            .join("|")
                        : e.target.value,
                  })
                }
              />
              <datalist id={id + "-" + i}>
                {suggestions.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={"Remover filtro " + (i + 1)}
              onClick={() => onChange(filters.filter((_, n) => i !== n))}
            >
              <Trash2 />
            </Button>
          </div>
        );
      })}
      {!filters.length && (
        <p className="text-xs text-neutral-500">
          {source === "person"
            ? "Qualquer pessoa nomeada e não bloqueada pode atender."
            : "Qualquer tipo e fonte de sinal pode atender à força e à recência."}
        </p>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={filters.length >= 10}
        onClick={() =>
          onChange([
            ...filters,
            { field: fields[0].key, operator: "equals", value: "" },
          ])
        }
      >
        <Plus />
        Adicionar filtro (E)
      </Button>
    </div>
  );
}
