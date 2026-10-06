"use client";
import { useState } from "react";
import { Plus, Trash2, Save, Check, Info } from "lucide-react";
import { editableCriterion, criterionAlternatives } from "@/lib/domain/scoring";
import { Condition } from "./rule-condition";
import { RuleAlternatives } from "./rule-alternatives";
import type {
  Criterion,
  Disqualifier,
  RuleSet,
  Workspace,
} from "@/lib/domain/types";
import type { UserCommand } from "@/lib/domain/commands";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input, Select, Label, ErrorNote, Badge } from "./ui/fields";
const blankCriterion = (): Criterion => ({
  id: crypto.randomUUID(),
  name: "",
  alternatives: [
    { source: "company", field: "", operator: "equals", value: "" },
  ],
  weight: 0,
  rationale: "",
});
const blankExclusion = (): Disqualifier => ({
  id: crypto.randomUUID(),
  name: "",
  field: "",
  operator: "equals",
  value: "",
  action: "disqualify",
  penalty: 0,
  reason: "",
});
export function RulesEditor({
  kind,
  state,
  open,
  onClose,
  onSave,
}: {
  kind: RuleSet["kind"];
  state: Workspace;
  open: boolean;
  onClose: () => void;
  onSave: (command: UserCommand) => Promise<void>;
}) {
  const last = state.rulesets
    .filter((r) => r.kind === kind)
    .sort((a, b) => b.version - a.version)[0];
  const source = state.records.filter(
    (r) =>
      r.dataset ===
      (kind === "icp"
        ? "ICP_Criterios"
        : kind === "commercial"
          ? "Regras_Score_Exemplo"
          : "Desqualificadores"),
  );
  const [criteria, setCriteria] = useState<Criterion[]>(
    last?.criteria.map(editableCriterion) ??
      source.map((r) => ({
        ...blankCriterion(),
        name: String(r.data.criterion ?? ""),
        weight: Number(r.data.weight ?? 0),
        rationale: String(r.data.rationale ?? ""),
        sourceRecordId: r.id,
      })),
  );
  const [exclusions, setExclusions] = useState<Disqualifier[]>(
    last?.exclusions ??
      source.map((r) => ({
        ...blankExclusion(),
        name: String(r.data.condition ?? ""),
        reason: String(r.data.reason ?? ""),
        sourceRecordId: r.id,
        action:
          r.data.action === "Reduzir score"
            ? "penalty"
            : r.data.action === "Não utilizar"
              ? "block_channel"
              : "disqualify",
      })),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const patch = (i: number, key: string, value: unknown) =>
    setCriteria(criteria.map((c, n) => (n === i ? { ...c, [key]: value } : c)));
  const patchEx = (i: number, key: string, value: unknown) =>
    setExclusions(
      exclusions.map((c, n) => (n === i ? { ...c, [key]: value } : c)),
    );
  const save = async (active: boolean) => {
    setBusy(true);
    setError("");
    try {
      await onSave({
        type: "rules",
        kind,
        active,
        criteria: kind === "exclusions" ? [] : criteria,
        exclusions: kind === "exclusions" ? exclusions : [],
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sum = criteria.reduce((s, c) => s + c.weight, 0);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={
        kind === "icp"
          ? "Regras de aderência ao ICP"
          : kind === "commercial"
            ? "Regras de prioridade comercial"
            : "Desqualificadores"
      }
      description="Configuração compartilhada por todos os usuários. As alterações geram uma nova versão."
      wide
    >
      <div className="mb-5 flex items-start gap-2 rounded-md bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-500">
        <Info size={16} className="mt-0.5 shrink-0" />
        <span>
          A nota soma os pontos comprovados sobre 100. Sem evidência, o critério
          vale zero e reduz a cobertura. Alternativas funcionam como OU: vale o
          maior resultado, sem somar pontos extras. Regras importadas precisam
          de uma condição executável antes da ativação.
        </span>
      </div>
      {kind !== "exclusions" ? (
        <>
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-medium">
              {criteria.length} critérios
            </span>
            <Badge tone={sum === 100 ? "green" : "orange"}>
              {sum} / 100 pontos
            </Badge>
          </div>
          {criteria.map((c, i) => (
            <fieldset
              key={c.id}
              aria-label={"Critério " + (i + 1)}
              className="mb-4 min-w-0 rounded-lg border border-neutral-200 p-4"
            >
              <div className="mb-3 grid grid-cols-[1fr_100px_auto] items-end gap-3">
                <div>
                  <Label>Nome do critério</Label>
                  <Input
                    aria-label={"Nome do critério " + (i + 1)}
                    value={c.name}
                    onChange={(e) => patch(i, "name", e.target.value)}
                  />
                </div>
                <div>
                  <Label>Peso</Label>
                  <Input
                    aria-label={"Peso " + (i + 1)}
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={c.weight}
                    onChange={(e) => patch(i, "weight", Number(e.target.value))}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remover critério"
                  onClick={() =>
                    setCriteria(criteria.filter((_, n) => n !== i))
                  }
                >
                  <Trash2 />
                </Button>
              </div>
              <RuleAlternatives
                alternatives={criterionAlternatives(c)}
                state={state}
                onChange={(alternatives) =>
                  patch(i, "alternatives", alternatives)
                }
              />
              <div className="mt-3">
                <Label>Justificativa</Label>
                <Input
                  value={c.rationale}
                  onChange={(e) => patch(i, "rationale", e.target.value)}
                />
              </div>
              {c.sourceRecordId && (
                <p className="mt-2 text-[11px] text-neutral-400">
                  Descrição original:{" "}
                  {String(
                    state.records.find((r) => r.id === c.sourceRecordId)?.data
                      .description ?? c.rationale,
                  )}
                </p>
              )}
            </fieldset>
          ))}
          <Button
            variant="outline"
            onClick={() => setCriteria([...criteria, blankCriterion()])}
          >
            <Plus />
            Adicionar critério
          </Button>
        </>
      ) : (
        <>
          {exclusions.map((c, i) => (
            <div
              key={c.id}
              className="mb-4 rounded-lg border border-neutral-200 p-4"
            >
              <div className="mb-3 flex gap-2">
                <Input
                  aria-label="Nome do desqualificador"
                  placeholder="Nome da condição"
                  value={c.name}
                  onChange={(e) => patchEx(i, "name", e.target.value)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remover desqualificador"
                  onClick={() =>
                    setExclusions(exclusions.filter((_, n) => n !== i))
                  }
                >
                  <Trash2 />
                </Button>
              </div>
              <Condition
                field={c.field}
                operator={c.operator}
                value={c.value}
                onChange={(k, v) => patchEx(i, k, v)}
                contacts
              />
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <Label>Ação</Label>
                  <Select
                    value={c.action}
                    onChange={(e) => patchEx(i, "action", e.target.value)}
                  >
                    <option value="disqualify">Desqualificar empresa</option>
                    <option value="block_channel">Bloquear canal</option>
                    <option value="penalty">
                      Reduzir prioridade comercial
                    </option>
                  </Select>
                </div>
                {c.action === "penalty" && (
                  <div>
                    <Label>Penalidade em pontos</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={c.penalty}
                      onChange={(e) =>
                        patchEx(i, "penalty", Number(e.target.value))
                      }
                    />
                  </div>
                )}
              </div>
              <div className="mt-3">
                <Label>Motivo</Label>
                <Input
                  value={c.reason}
                  onChange={(e) => patchEx(i, "reason", e.target.value)}
                />
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            onClick={() => setExclusions([...exclusions, blankExclusion()])}
          >
            <Plus />
            Adicionar desqualificador
          </Button>
        </>
      )}
      <ErrorNote message={error} />
      <div className="mt-6 flex justify-end gap-2 border-t border-neutral-100 pt-4">
        <Button variant="outline" disabled={busy} onClick={() => save(false)}>
          <Save />
          Salvar rascunho
        </Button>
        <Button disabled={busy} onClick={() => save(true)}>
          <Check />
          Ativar e recalcular
        </Button>
      </div>
    </Dialog>
  );
}
