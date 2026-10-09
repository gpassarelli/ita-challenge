import type { Cell, Dataset } from "./catalog";
export type Origin = {
  batchId: string;
  fileName: string;
  row: number;
  raw: Record<string, string>;
  importedAt: string;
  actor: string;
};
export type DataRecord = {
  id: string;
  dataset: Dataset;
  externalKey: string;
  data: Record<string, Cell>;
  companyId: string | null;
  productId: string | null;
  contactId?: string | null;
  version: number;
  origins: Origin[];
  fieldSources?: Record<
    string,
    { kind: "manual" | "import" | "revision"; detail: string; at: string }
  >;
  createdAt: string;
  updatedAt: string;
};
export type Operator =
  | "equals"
  | "not_equals"
  | "in"
  | "between"
  | "gte"
  | "lte"
  | "exists"
  | "scale";
export type Criterion = {
  id: string;
  name: string;
  weight: number;
  rationale: string;
  sourceRecordId?: string;
} & (
  | (CompanyCondition & { alternatives?: never })
  | {
      alternatives: CriterionAlternative[];
      field?: never;
      operator?: never;
      value?: never;
      recentDays?: never;
    }
);
export type CompanyCondition = {
  field: string;
  operator: Operator;
  value: string;
  recentDays?: number;
};
export type RelatedFilter = {
  field: string;
  operator: "equals" | "not_equals" | "in" | "contains" | "exists";
  value: string;
};
export type CriterionAlternative =
  | ({ source: "company" } & CompanyCondition)
  | { source: "person"; filters: RelatedFilter[] }
  | {
      source: "signal";
      filters: RelatedFilter[];
      minStrength: "Baixo" | "Médio" | "Alto";
      recentDays: number;
    };
export type Disqualifier = {
  id: string;
  name: string;
  field: string;
  operator: Operator;
  value: string;
  action: "disqualify" | "block_channel" | "penalty";
  penalty: number;
  reason: string;
  sourceRecordId?: string;
};
export type RuleSet = {
  id: string;
  kind: "icp" | "commercial" | "exclusions";
  version: number;
  active: boolean;
  criteria: Criterion[];
  exclusions: Disqualifier[];
  createdAt: string;
  createdBy: string;
};
export type Evidence = {
  recordId: string;
  dataset: Dataset;
  field: string;
  value: Cell;
  detail: string;
  recordLabel?: string;
};
export type CriterionResult = {
  criterionId: string;
  name: string;
  weight: number;
  earned: number;
  available: boolean;
  explanation: string;
  evidence: Evidence[];
};
export type Score = {
  status: "unconfigured" | "insufficient" | "calculated";
  value: number | null;
  earned: number;
  availableWeight: number;
  coverage: number;
  penalty: number;
  rulesVersion: number | null;
  criteria: CriterionResult[];
};
export type Evaluation = {
  id: string;
  companyId: string;
  companyVersion: number;
  date: string;
  calculatedAt: string;
  calculationVersion?: number;
  dataVersions: Record<string, number>;
  exclusionsVersion: number | null;
  icp: Score;
  commercial: Score;
  disqualified: boolean;
  blockedContactIds: string[];
  exclusions: {
    name: string;
    matched: boolean;
    available: boolean;
    reason: string;
    action: string;
    evidence: Evidence[];
  }[];
};
export type Filter = {
  field: string;
  operator: "equals" | "in" | "gte" | "lte" | "contains" | "exists";
  value: string;
};
export type SavedList = {
  id: string;
  name: string;
  filters: Filter[];
  sort: { field: string; direction: "asc" | "desc" }[];
  createdBy: string;
  updatedAt: string;
};
export type Change = {
  field: string;
  before: Cell;
  after: Cell;
  reason: string;
  evidenceIds: string[];
};
export type Outreach = {
  subject: string;
  body: string;
  rationale: string;
  evidenceIds: string[];
  warnings: string[];
  productId: string;
  contactId: string | null;
  channel: string;
};
export type Revision = {
  id: string;
  type: "data" | "message";
  companyId: string;
  companyVersion: number;
  runId: string;
  status: "pending" | "approved" | "rejected";
  changes: Change[];
  message: Outreach | null;
  originalMessage: Outreach | null;
  explanation: string;
  warnings: string[];
  input: unknown;
  promptVersion: string;
  model: string;
  createdBy: string;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reason: string;
  edited: boolean;
};
export type AgentPhase = "preparing" | "generating" | "validating" | "saving";
export type AgentStep = {
  phase: AgentPhase;
  attempt: number;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  error?: string;
};
export type AgentRun = {
  id: string;
  archivedAt?: string;
  archivedBy?: string;
  skippedCompanies?: { companyId: string; revisionIds: string[] }[];
  agent: "signals" | "outreach";
  companyIds: string[];
  productId: string | null;
  contactId: string | null;
  channel: string;
  requestedBy: string;
  requestedAt: string;
  workflowId: string | null;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  items: {
    companyId: string;
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    error: string | null;
    revisionId: string | null;
    input?: unknown;
    model?: string;
    promptVersion?: string;
    startedAt?: string;
    finishedAt?: string;
    attempts?: number;
    steps?: AgentStep[];
  }[];
};
export type Audit = {
  id: string;
  action: string;
  entityId: string;
  actor: string;
  at: string;
  before: unknown;
  after: unknown;
};
export type ImportBatch = {
  id: string;
  dataset: Dataset;
  fileName: string;
  count: number;
  skipped: number;
  ignored?: number;
  actor: string;
  at: string;
};
export type Workspace = {
  version: number;
  records: DataRecord[];
  rulesets: RuleSet[];
  evaluations: Evaluation[];
  lists: SavedList[];
  revisions: Revision[];
  runs: AgentRun[];
  audits: Audit[];
  imports: ImportBatch[];
};
export const emptyWorkspace = (): Workspace => ({
  version: 0,
  records: [],
  rulesets: [],
  evaluations: [],
  lists: [],
  revisions: [],
  runs: [],
  audits: [],
  imports: [],
});
export const uid = () => crypto.randomUUID();
export const isoNow = () => new Date().toISOString();
export const evaluationDate = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(
    new Date(),
  );
