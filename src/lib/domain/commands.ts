import { z } from "zod";
import { datasetNames } from "./catalog";
const id = z.string().uuid();
const operator = z.enum([
  "equals",
  "not_equals",
  "in",
  "between",
  "gte",
  "lte",
  "exists",
  "scale",
]);
const criterionMetadata = {
  id: z.string(),
  name: z.string().max(160),
  weight: z.number(),
  rationale: z.string().max(4000),
  sourceRecordId: id.optional(),
};
const companyCondition = {
  field: z.string(),
  operator,
  value: z.string().max(4000),
  recentDays: z.number().optional(),
};
const relatedFilter = z
  .object({
    field: z.string(),
    operator: z.enum(["equals", "not_equals", "in", "contains", "exists"]),
    value: z.string().max(4000),
  })
  .strict();
const alternative = z.discriminatedUnion("source", [
  z.object({ source: z.literal("company"), ...companyCondition }).strict(),
  z
    .object({
      source: z.literal("person"),
      filters: z.array(relatedFilter).max(10),
    })
    .strict(),
  z
    .object({
      source: z.literal("signal"),
      filters: z.array(relatedFilter).max(10),
      minStrength: z.enum(["Baixo", "Médio", "Alto"]),
      recentDays: z.number().int().min(1).max(3650),
    })
    .strict(),
]);
const criterion = z.union([
  z.object({ ...criterionMetadata, ...companyCondition }).strict(),
  z
    .object({
      ...criterionMetadata,
      alternatives: z.array(alternative).min(1).max(10),
    })
    .strict(),
]);
const exclusion = z
  .object({
    id: z.string(),
    name: z.string().max(160),
    field: z.string(),
    operator,
    value: z.string().max(4000),
    action: z.enum(["disqualify", "block_channel", "penalty"]),
    penalty: z.number(),
    reason: z.string().max(4000),
    sourceRecordId: id.optional(),
  })
  .strict();
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("archiveRun"), id }).strict(),
  z
    .object({
      type: z.literal("record"),
      dataset: z.enum(datasetNames),
      id: id.optional(),
      expectedVersion: z.number().int().optional(),
      data: z.record(
        z.string(),
        z.union([z.string().max(12000), z.number(), z.boolean(), z.null()]),
      ),
    })
    .strict(),
  z
    .object({
      type: z.literal("move"),
      id,
      outcome: z.enum(["Em negociação", "Ganha", "Perdida"]),
      expectedVersion: z.number().int(),
    })
    .strict(),
  z
    .object({
      type: z.literal("rules"),
      kind: z.enum(["icp", "commercial", "exclusions"]),
      active: z.boolean(),
      criteria: z.array(criterion).max(50),
      exclusions: z.array(exclusion).max(50),
    })
    .strict(),
  z
    .object({
      type: z.literal("list"),
      id,
      name: z.string().min(1).max(120),
      filters: z
        .array(
          z
            .object({
              field: z.string(),
              operator: z.enum([
                "equals",
                "in",
                "gte",
                "lte",
                "contains",
                "exists",
              ]),
              value: z.string().max(1000),
            })
            .strict(),
        )
        .max(20),
      sort: z
        .array(
          z
            .object({ field: z.string(), direction: z.enum(["asc", "desc"]) })
            .strict(),
        )
        .min(1)
        .max(2),
    })
    .strict(),
  z
    .object({
      type: z.literal("review"),
      id,
      decision: z.enum(["approved", "rejected"]),
      reason: z.string().max(4000),
      editedMessage: z
        .object({ subject: z.string().max(300), body: z.string().max(12000) })
        .strict()
        .optional(),
    })
    .strict(),
]);
export const agentRequestSchema = z
  .object({
    id,
    retryOf: id.optional(),
    agent: z.enum(["signals", "outreach"]),
    companyIds: z.array(id).min(1).max(120),
    productId: id.nullable(),
    contactId: id.nullable(),
    channel: z.enum(["E-mail", "LinkedIn", "Outro"]),
  })
  .strict();
export type UserCommand = z.infer<typeof commandSchema>;
