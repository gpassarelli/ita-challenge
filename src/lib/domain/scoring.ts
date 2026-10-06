import { contactKind, isMissing as absent } from "./values";
import { canonical } from "./json";
import { DATASETS, companyFields, parseCell, type Cell } from "./catalog";
import type {
  Criterion,
  CriterionAlternative,
  CriterionResult,
  DataRecord,
  Evidence,
  Operator,
  RelatedFilter,
  RuleSet,
  Score,
  Workspace,
} from "./types";
import { evaluationDate, isoNow } from "./types";
export const CALCULATION_VERSION = 2;
export const FACT_FIELDS = [
  ...companyFields
    .filter((f) => !["name", "external_id", "domain", "notes"].includes(f.key))
    .map((f) => ({ key: f.key, label: f.label })),
  { key: "strong_recent_signal", label: "Sinal forte recente" },
  { key: "identified_contact", label: "Decisor identificado" },
  { key: "segment_won_history", label: "Segmento com histórico de ganho" },
  { key: "signal_count", label: "Quantidade de sinais" },
  { key: "annual_ticket", label: "Ticket anual ativo" },
  { key: "internal_fit", label: "Fit interno" },
  { key: "nps", label: "NPS" },
  { key: "channel_type", label: "Tipo de canal (por contato)" },
  { key: "contact_source", label: "Origem (por contato)" },
];
export const OPERATORS: { value: Operator; label: string }[] = [
  { value: "equals", label: "É igual a" },
  { value: "not_equals", label: "É diferente de" },
  { value: "in", label: "Está entre os valores" },
  { value: "between", label: "Está no intervalo" },
  { value: "gte", label: "É maior ou igual a" },
  { value: "lte", label: "É menor ou igual a" },
  { value: "exists", label: "Está informado" },
  { value: "scale", label: "Escala por categoria" },
];
export const RELATED_OPERATORS: {
  value: RelatedFilter["operator"];
  label: string;
}[] = [
  ...(OPERATORS.filter((o) =>
    ["equals", "not_equals", "in", "exists"].includes(o.value),
  ) as { value: RelatedFilter["operator"]; label: string }[]),
  { value: "contains", label: "Contém" },
];
export const PERSON_FIELDS = DATASETS.Decisores_Canais.fields.filter((f) =>
  ["role", "identified", "channel_type", "source", "channel"].includes(f.key),
);
export const SIGNAL_FIELDS = DATASETS.Sinais_Publicos.fields.filter((f) =>
  ["signal_type", "source"].includes(f.key),
);
export const SIGNAL_STRENGTHS = ["Baixo", "Médio", "Alto"] as const;

export function criterionAlternatives(c: Criterion): CriterionAlternative[] {
  return (
    c.alternatives ?? [
      {
        source: "company",
        field: c.field!,
        operator: c.operator!,
        value: c.value!,
        ...(c.recentDays === undefined ? {} : { recentDays: c.recentDays }),
      },
    ]
  );
}
export function editableCriterion(c: Criterion): Criterion {
  return {
    id: c.id,
    name: c.name,
    weight: c.weight,
    rationale: c.rationale,
    ...(c.sourceRecordId ? { sourceRecordId: c.sourceRecordId } : {}),
    alternatives: criterionAlternatives(c),
  };
}
export function describeAlternative(a: CriterionAlternative): string {
  if (a.source === "company") {
    const label =
      FACT_FIELDS.find((f) => f.key === a.field)?.label ?? "Selecione o campo";
    const condition =
      OPERATORS.find((o) => o.value === a.operator)?.label ?? a.operator;
    let expected = a.value;
    if (a.operator === "scale") {
      try {
        expected = Object.entries(JSON.parse(a.value))
          .map(([k, v]) => `${k}: ${Number(v) * 100}%`)
          .join(", ");
      } catch {
        expected = "Configure as categorias";
      }
    } else if (["in", "between"].includes(a.operator))
      expected = a.value.split("|").join(a.operator === "in" ? ", " : " a ");
    return `${label} · ${condition}${a.operator === "exists" ? "" : " " + expected}${a.field === "strong_recent_signal" ? ` · últimos ${a.recentDays ?? 90} dias` : ""}`;
  }
  const fields = a.source === "person" ? PERSON_FIELDS : SIGNAL_FIELDS;
  const filters = a.filters.map(
    (f) =>
      `${fields.find((x) => x.key === f.field)?.label ?? "Selecione o campo"} ${RELATED_OPERATORS.find((o) => o.value === f.operator)?.label ?? f.operator}${f.operator === "exists" ? "" : " " + f.value.split("|").join(", ")}`,
  );
  if (a.source === "signal")
    filters.push(
      `Força mínima ${a.minStrength}`,
      `últimos ${a.recentDays} dias`,
    );
  return `${a.source === "person" ? "Pessoa nomeada" : "Sinal"}${filters.length ? ": " + filters.join(" E ") : " vinculada à empresa"}`;
}
function dateTime(value: Cell | undefined): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === value
    ? time
    : NaN;
}
function validRecentDays(days: number | undefined) {
  if (
    days !== undefined &&
    (!Number.isInteger(days) || days < 1 || days > 3650)
  )
    throw new Error("Recência: informe entre 1 e 3.650 dias.");
}
export function validateAlternative(a: CriterionAlternative) {
  if (a.source === "company") {
    validateCondition(a.field, a.operator, a.value);
    validRecentDays(a.recentDays);
    if (["channel_type", "contact_source"].includes(a.field))
      throw new Error(
        "Use a alternativa Pessoa para avaliar campos por contato.",
      );
    return;
  }
  if (!["person", "signal"].includes(a.source))
    throw new Error("Fonte de avaliação inválida.");
  if (a.source === "signal") {
    validRecentDays(a.recentDays);
    if (a.recentDays === undefined || !SIGNAL_STRENGTHS.includes(a.minStrength))
      throw new Error("Informe a força mínima e a recência do sinal.");
  }
  const fields = a.source === "person" ? PERSON_FIELDS : SIGNAL_FIELDS;
  if (!Array.isArray(a.filters) || a.filters.length > 10)
    throw new Error("Use até 10 filtros por alternativa.");
  for (const f of a.filters) {
    if (
      !fields.some((x) => x.key === f.field) ||
      !RELATED_OPERATORS.some((o) => o.value === f.operator)
    )
      throw new Error("Campo ou operador inválido para esta fonte.");
    if (f.field === "channel" && f.operator !== "exists")
      throw new Error("Para o canal da pessoa, avalie se está informado.");
    if (
      f.operator !== "exists" &&
      (!f.value.trim() ||
        (f.operator === "in" && f.value.split("|").some((v) => !v.trim())))
    )
      throw new Error("Preencha o valor de cada filtro.");
  }
}
function evidence(record: DataRecord, field: string, value: Cell): Evidence {
  const origin = record.origins.at(-1);
  return {
    recordId: record.id,
    dataset: record.dataset,
    field,
    value,
    detail:
      record.fieldSources?.[field]?.detail ??
      (origin
        ? origin.fileName + ", linha " + origin.row
        : "Cadastro manual / revisão aprovada"),
    recordLabel: String(
      record.data.name ?? record.data.evidence ?? record.externalKey,
    ),
  };
}

function evaluateAlternative(
  state: Workspace,
  company: DataRecord,
  a: CriterionAlternative,
  date: string,
  blocked: string[],
) {
  const description = describeAlternative(a);
  if (a.source === "company") {
    const f = fact(state, company, a.field, date, a.recentDays, blocked);
    const available = !absent(f.value);
    return {
      available,
      factor: available ? match(f.value, a.operator, a.value) : 0,
      evidence: f.evidence,
      explanation: `${description} · ${available ? "Valor: " + f.value : "Sem evidência; 0 pontos"}`,
    };
  }
  const records = state.records.filter(
    (r) =>
      r.companyId === company.id &&
      (a.source === "signal"
        ? r.dataset === "Sinais_Publicos"
        : r.dataset === "Decisores_Canais" &&
          contactKind(r.data) === "person" &&
          !blocked.includes(r.id)),
  );
  const fields = [
    ...new Set(
      a.filters
        .map((f) => f.field)
        .concat(a.source === "signal" ? ["strength", "date"] : ["name"]),
    ),
  ];
  const complete = records.filter(
    (r) =>
      fields.every((f) => !absent(r.data[f])) &&
      (a.source !== "signal" ||
        (Number.isFinite(dateTime(r.data.date)) &&
          SIGNAL_STRENGTHS.some((s) => s === r.data.strength))),
  );
  const hits = complete.filter(
    (r) =>
      a.filters.every((f) => {
        if (f.operator === "contains")
          return String(r.data[f.field])
            .toLocaleLowerCase("pt-BR")
            .includes(f.value.trim().toLocaleLowerCase("pt-BR"));
        return match(r.data[f.field], f.operator, f.value) > 0;
      }) &&
      (a.source !== "signal" ||
        (SIGNAL_STRENGTHS.indexOf(r.data.strength as typeof a.minStrength) >=
          SIGNAL_STRENGTHS.indexOf(a.minStrength) &&
          dateTime(r.data.date) <= dateTime(date) &&
          dateTime(date) - dateTime(r.data.date) <= a.recentDays * 86400000)),
  );
  const evidenceFields = [
    ...new Set(
      fields.concat(
        a.source === "signal"
          ? ["signal_type", "evidence", "source", "url"]
          : [],
      ),
    ),
  ];
  return {
    available: complete.length > 0,
    factor: hits.length ? 1 : 0,
    evidence: (hits.length ? hits : records).flatMap((r) =>
      evidenceFields
        .filter((f) => !absent(r.data[f]))
        .map((f) => evidence(r, f, r.data[f])),
    ),
    explanation: `${description} · ${hits.length ? `${hits.length} registro(s) atendem; pontuação única` : complete.length ? "Nenhum registro atende; 0 pontos" : "Sem dados suficientes; 0 pontos"}`,
  };
}
export function fact(
  state: Workspace,
  company: DataRecord,
  field: string,
  date: string,
  days = 90,
  blocked: string[] = [],
): { value: Cell; evidence: Evidence[] } {
  const related = state.records.filter((r) => r.companyId === company.id);
  if (["channel_type", "contact_source"].includes(field))
    return { value: null, evidence: [] };
  if (field === "strong_recent_signal" || field === "signal_count") {
    const signals = related.filter((r) => r.dataset === "Sinais_Publicos");
    if (!signals.length) return { value: null, evidence: [] };
    if (field === "signal_count")
      return {
        value: signals.length,
        evidence: signals.map((r) => evidence(r, "evidence", r.data.evidence)),
      };
    const dated = signals.filter(
      (r) => Number.isFinite(dateTime(r.data.date)) && !absent(r.data.strength),
    );
    if (!dated.length) return { value: null, evidence: [] };
    const hits = dated.filter(
      (r) =>
        r.data.strength === "Alto" &&
        Date.parse(String(r.data.date)) <= Date.parse(date) &&
        Date.parse(date) - Date.parse(String(r.data.date)) <= days * 86400000,
    );
    return {
      value: hits.length > 0 ? "Sim" : "Não",
      evidence: (hits.length ? hits : dated).map((r) =>
        evidence(r, "strength", r.data.strength),
      ),
    };
  }
  if (field === "identified_contact") {
    const contacts = related.filter(
      (r) => r.dataset === "Decisores_Canais" && !blocked.includes(r.id),
    );
    if (!contacts.length) return { value: null, evidence: [] };
    const known = contacts.filter(
      (r) =>
        !absent(r.data.identified) &&
        (r.data.identified !== "Sim" || contactKind(r.data) === "person"),
    );
    return {
      value: known.length
        ? known.some((r) => r.data.identified === "Sim")
          ? "Sim"
          : "Não"
        : null,
      evidence: known.map((r) => evidence(r, "identified", r.data.identified)),
    };
  }
  if (field === "segment_won_history") {
    const opportunities = state.records.filter(
      (r) => r.dataset === "Oportunidades_Historico",
    );
    if (!opportunities.length || absent(company.data.segment))
      return { value: null, evidence: [] };
    const companyIds = state.records
      .filter(
        (r) =>
          r.dataset === "Prospects" && r.data.segment === company.data.segment,
      )
      .map((r) => r.id);
    const related = opportunities.filter((r) =>
      companyIds.includes(r.companyId ?? ""),
    );
    return {
      value: related.some((r) => r.data.outcome === "Ganha") ? "Sim" : "Não",
      evidence: related
        .map((r) => evidence(r, "outcome", r.data.outcome))
        .concat([evidence(company, "segment", company.data.segment)]),
    };
  }
  if (["annual_ticket", "internal_fit", "nps"].includes(field)) {
    const customers = related.filter((r) => r.dataset === "Clientes_Atuais");
    const active = customers.filter(
      (r) => r.data.customer_status === "Cliente ativo",
    );
    if (field === "annual_ticket") {
      if (!active.length)
        return customers.length &&
          customers.every((r) => r.data.customer_status === "Churn")
          ? {
              value: 0,
              evidence: customers.map((r) =>
                evidence(r, "customer_status", r.data.customer_status),
              ),
            }
          : { value: null, evidence: [] };
      const known = active.filter(
        (r) => typeof r.data.annual_ticket === "number",
      );
      return {
        value:
          known.length === active.length
            ? known.reduce((sum, r) => sum + Number(r.data.annual_ticket), 0)
            : null,
        evidence: known.map((r) => evidence(r, field, r.data[field])),
      };
    }
    const known = (active.length ? active : customers).filter(
      (r) => !absent(r.data[field]),
    );
    const values = [...new Set(known.map((r) => r.data[field]))];
    return {
      value: values.length === 1 ? values[0] : null,
      evidence: known.map((r) => evidence(r, field, r.data[field])),
    };
  }
  const value = company.data[field] ?? null;
  return {
    value,
    evidence: absent(value) ? [] : [evidence(company, field, value)],
  };
}
export function conditionNumber(value: string) {
  try {
    const number = parseCell(value, {
      key: "condition",
      label: "Valor",
      type: "number",
    });
    return typeof number === "number" ? number : NaN;
  } catch {
    return NaN;
  }
}
export function match(
  value: Cell,
  operator: Operator,
  expected: string,
): number {
  if (absent(value)) return 0;
  const text = String(value).toLocaleLowerCase("pt-BR");
  const expectedText = expected.trim().toLocaleLowerCase("pt-BR");
  if (operator === "exists") return 1;
  if (operator === "equals")
    return Number(
      typeof value === "number"
        ? value === conditionNumber(expected)
        : text === expectedText,
    );
  if (operator === "not_equals")
    return Number(
      typeof value === "number"
        ? value !== conditionNumber(expected)
        : text !== expectedText,
    );
  if (operator === "in")
    return Number(
      expected
        .split("|")
        .map((v) =>
          typeof value === "number"
            ? String(conditionNumber(v))
            : v.trim().toLocaleLowerCase("pt-BR"),
        )
        .includes(text),
    );
  if (operator === "scale") {
    const mapping = JSON.parse(expected) as Record<string, number>;
    const key = Object.keys(mapping).find(
      (k) => k.toLocaleLowerCase("pt-BR") === text,
    );
    return key ? mapping[key] : 0;
  }
  if (typeof value !== "number") return 0;
  if (operator === "gte") return Number(value >= conditionNumber(expected));
  if (operator === "lte") return Number(value <= conditionNumber(expected));
  const [lo, hi] = expected.split("|").map(conditionNumber);
  return Number(value >= lo && value <= hi);
}
export function validateCondition(
  field: string,
  operator: Operator,
  value: string,
) {
  if (!FACT_FIELDS.some((f) => f.key === field))
    throw new Error("Escolha um campo válido para a regra.");
  if (!OPERATORS.some((o) => o.value === operator))
    throw new Error("Operador inválido.");
  if (operator !== "exists" && !value.trim())
    throw new Error("Preencha o valor da condição.");
  const numeric = [
    "employees",
    "signal_count",
    "annual_ticket",
    "nps",
  ].includes(field);
  if (["gte", "lte", "between"].includes(operator) && !numeric)
    throw new Error(
      "Este campo utiliza texto ou categorias. Escolha uma comparação de valores.",
    );
  if (
    numeric &&
    ["equals", "not_equals", "in"].includes(operator) &&
    value.split("|").some((v) => !Number.isFinite(conditionNumber(v)))
  )
    throw new Error("Informe valores numéricos para este campo.");
  if (
    ["gte", "lte"].includes(operator) &&
    !Number.isFinite(conditionNumber(value))
  )
    throw new Error("A comparação exige um número.");
  if (operator === "between") {
    const bounds = value.split("|").map(conditionNumber);
    if (
      bounds.length !== 2 ||
      value.split("|").some((v) => !v.trim()) ||
      bounds.some((v) => !Number.isFinite(v)) ||
      bounds[0] > bounds[1]
    )
      throw new Error(
        "Preencha os limites mínimo e máximo de um intervalo válido.",
      );
  }
  if (operator === "scale") {
    let map: unknown;
    try {
      map = JSON.parse(value);
    } catch {
      throw new Error("Adicione as categorias e seus percentuais na escala.");
    }
    if (
      !map ||
      Array.isArray(map) ||
      typeof map !== "object" ||
      !Object.keys(map).length ||
      Object.values(map).some((v) => typeof v !== "number" || v < 0 || v > 1)
    )
      throw new Error(
        "Adicione ao menos uma categoria com percentual entre 0% e 100%.",
      );
  }
}
export function validateRuleset(set: RuleSet) {
  const entries = set.kind === "exclusions" ? set.exclusions : set.criteria;
  if (new Set(entries.map((c) => c.id)).size !== entries.length)
    throw new Error("Cada critério precisa de um identificador único.");
  if (set.kind !== "exclusions") {
    if (!set.criteria.length)
      throw new Error("Adicione pelo menos um critério.");
    if (
      set.criteria.some(
        (c) => !c.name.trim() || !Number.isFinite(c.weight) || c.weight <= 0,
      )
    )
      throw new Error("Cada critério precisa de nome e peso positivo.");
    if (
      set.active &&
      Math.abs(set.criteria.reduce((s, c) => s + c.weight, 0) - 100) > 0.001
    )
      throw new Error("Os pesos precisam somar 100 pontos antes de ativar.");
    set.criteria.forEach((c) => {
      const alternatives = criterionAlternatives(c);
      if (!alternatives.length || alternatives.length > 10)
        throw new Error("Use entre 1 e 10 alternativas por critério.");
      alternatives.forEach(validateAlternative);
    });
  } else {
    if (!set.exclusions.length) throw new Error("Adicione um desqualificador.");
    set.exclusions.forEach((c) => {
      validateCondition(c.field, c.operator, c.value);
      if (!c.name.trim() || !c.reason.trim())
        throw new Error("Informe o nome e o motivo do desqualificador.");
      if (!Number.isFinite(c.penalty) || c.penalty < 0 || c.penalty > 100)
        throw new Error("A penalidade deve estar entre 0 e 100.");
      if (
        c.action === "block_channel" &&
        !["channel_type", "contact_source"].includes(c.field)
      )
        throw new Error(
          "O bloqueio de canais deve avaliar o tipo ou a origem do contato.",
        );
    });
  }
}
export function activeRules(state: Workspace, kind: RuleSet["kind"]) {
  return state.rulesets
    .filter((r) => r.kind === kind && r.active)
    .sort((a, b) => b.version - a.version)[0];
}
function score(
  state: Workspace,
  company: DataRecord,
  rules: RuleSet | undefined,
  date: string,
  blocked: string[],
  penalty = 0,
): Score {
  if (!rules)
    return {
      status: "unconfigured",
      value: null,
      earned: 0,
      availableWeight: 0,
      coverage: 0,
      penalty: 0,
      rulesVersion: null,
      criteria: [],
    };
  const criteria: CriterionResult[] = rules.criteria.map((c: Criterion) => {
    const alternatives = criterionAlternatives(c).map((a) =>
      evaluateAlternative(state, company, a, date, blocked),
    );
    const available = alternatives.some((a) => a.available);
    const earned =
      c.weight *
      Math.max(0, Math.min(1, Math.max(...alternatives.map((a) => a.factor))));
    const evidenceByField = new Map(
      alternatives
        .flatMap((a) => a.evidence)
        .map((e) => [e.recordId + ":" + e.field, e]),
    );
    return {
      criterionId: c.id,
      name: c.name,
      weight: c.weight,
      earned,
      available,
      evidence: [...evidenceByField.values()],
      explanation: alternatives.map((a) => a.explanation).join(" OU "),
    };
  });
  const availableWeight = criteria
    .filter((c) => c.available)
    .reduce((s, c) => s + c.weight, 0);
  const earned = criteria.reduce((s, c) => s + c.earned, 0);
  return {
    status: availableWeight ? "calculated" : "insufficient",
    value: Math.round(Math.max(0, Math.min(100, earned - penalty)) * 10) / 10,
    earned,
    availableWeight,
    coverage: availableWeight,
    penalty,
    rulesVersion: rules.version,
    criteria,
  };
}
export function needsRecalculation(
  state: Workspace,
  date = evaluationDate(),
): boolean {
  const companies = state.records.filter((r) => r.dataset === "Prospects");
  return companies.some((company) => {
    const evaluation = state.evaluations.find(
      (e) => e.companyId === company.id,
    );
    return (
      !evaluation ||
      evaluation.date !== date ||
      evaluation.calculationVersion !== CALCULATION_VERSION
    );
  });
}
export function recalculate(state: Workspace, date = evaluationDate()) {
  const exclusionRules = activeRules(state, "exclusions");
  state.evaluations = state.records
    .filter((r) => r.dataset === "Prospects")
    .map((company) => {
      const blocked: string[] = [];
      let penalty = 0;
      let disqualified = false;
      const exclusions = (exclusionRules?.exclusions ?? []).map((c) => {
        if (["channel_type", "contact_source"].includes(c.field)) {
          const contacts = state.records.filter(
            (r) =>
              r.dataset === "Decisores_Canais" && r.companyId === company.id,
          );
          const key = c.field === "contact_source" ? "source" : "channel_type";
          const availableContacts = contacts.filter(
            (r) => !absent(r.data[key]),
          );
          const matching = availableContacts.filter(
            (r) => match(r.data[key], c.operator, c.value) > 0,
          );
          if (c.action === "block_channel")
            blocked.push(...matching.map((r) => r.id));
          const matched = matching.length > 0;
          if (matched && c.action === "penalty") penalty += c.penalty;
          if (matched && c.action === "disqualify") disqualified = true;
          return {
            name: c.name,
            matched,
            available: availableContacts.length > 0,
            reason: c.reason,
            action: c.action,
            evidence: availableContacts.map((r) =>
              evidence(r, key, r.data[key]),
            ),
          };
        }
        const f = fact(state, company, c.field, date);
        const available = !absent(f.value);
        const matched = available && match(f.value, c.operator, c.value) > 0;
        if (matched && c.action === "disqualify") disqualified = true;
        if (matched && c.action === "penalty") penalty += c.penalty;
        return {
          name: c.name,
          matched,
          available,
          reason: c.reason,
          action: c.action,
          evidence: f.evidence,
        };
      });
      const segmentCompanies = state.records
        .filter(
          (r) =>
            r.dataset === "Prospects" &&
            r.data.segment === company.data.segment,
        )
        .map((r) => r.id);
      const dependencies = state.records.filter(
        (r) =>
          r.id === company.id ||
          r.companyId === company.id ||
          (r.dataset === "Oportunidades_Historico" &&
            segmentCompanies.includes(r.companyId ?? "")),
      );
      const dataVersions = Object.fromEntries(
        dependencies
          .map((r) => [r.id, r.version])
          .sort(([a], [b]) => String(a).localeCompare(String(b))),
      );
      const result = {
        id: company.id,
        companyId: company.id,
        companyVersion: company.version,
        calculationVersion: CALCULATION_VERSION,
        date,
        dataVersions,
        exclusionsVersion: exclusionRules?.version ?? null,
        icp: score(state, company, activeRules(state, "icp"), date, blocked),
        commercial: score(
          state,
          company,
          activeRules(state, "commercial"),
          date,
          blocked,
          penalty,
        ),
        disqualified,
        blockedContactIds: [...new Set(blocked)],
        exclusions,
      };
      const previous = state.evaluations.find(
        (e) => e.companyId === company.id,
      );
      const previousWithoutTime = previous
        ? Object.fromEntries(
            Object.entries(previous).filter(([k]) => k !== "calculatedAt"),
          )
        : null;
      return {
        ...result,
        calculatedAt:
          previous && canonical(previousWithoutTime) === canonical(result)
            ? previous.calculatedAt
            : isoNow(),
      };
    });
  return state;
}
