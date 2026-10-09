import { expect, it } from "vitest";
import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { signalOutputSchema, validatedChanges } from "../src/lib/domain/agents";
import { BRAZILIAN_STATES, fieldsFor } from "../src/lib/domain/catalog";
import { ALLOWED_AI_FIELDS } from "../src/lib/domain/mutations";
import { company, emptyWorkspace } from "./fixtures";

const proposal = (field: string, after: unknown) => ({
  explanation: "Uma alteração proposta.",
  warnings: [],
  changes: [
    { field, after, reason: "Evidência fornecida.", evidenceIds: ["record-1"] },
  ],
});

it("aceita os valores do catálogo em todos os campos editáveis e preserva null", () => {
  for (const key of ALLOWED_AI_FIELDS) {
    const field = fieldsFor("Prospects").find((field) => field.key === key)!;
    const values =
      key === "state"
        ? BRAZILIAN_STATES
        : (field.choices ??
          (field.type === "integer" ? [0, 120] : ["Tecnologia"]));
    for (const value of [...values, null]) {
      expect(signalOutputSchema.safeParse(proposal(key, value)).success).toBe(
        true,
      );
    }
  }
});

it.each([
  ["structured_hr", "Yes"],
  ["growth", "Sim"],
  ["growth", "Alta"],
  ["renewal", "Em breve"],
  ["operating_status", "Prospect"],
  ["state", "São Paulo"],
  ["state", "XX"],
  ["employees", -1],
  ["employees", 1.5],
  ["employees", "120"],
  ["employees", "1.200 colaboradores"],
  ["segment", 120],
  ["segment", "x".repeat(12001)],
  ["commercial_status", "Cliente ativo"],
  ["unknown", "Sim"],
])("rejeita valor incompatível com o campo %s", (field, value) => {
  expect(signalOutputSchema.safeParse(proposal(field, value)).success).toBe(
    false,
  );
});

it("exige os campos esperados e rejeita propriedades adicionais", () => {
  const output = proposal("structured_hr", "Sim");
  expect(signalOutputSchema.safeParse({ ...output, extra: true }).success).toBe(
    false,
  );
  expect(
    signalOutputSchema.safeParse({
      ...output,
      changes: [{ ...output.changes[0], extra: true }],
    }).success,
  ).toBe(false);
  const { after: _after, ...missingValue } = output.changes[0];
  expect(
    signalOutputSchema.safeParse({ ...output, changes: [missingValue] })
      .success,
  ).toBe(false);
});

it("converte colaboradores numéricos em uma proposta compatível com a revisão", () => {
  const prospect = company(emptyWorkspace());
  const output = proposal("employees", 120);
  output.changes[0].evidenceIds = [prospect.id];
  const changes = validatedChanges(signalOutputSchema.parse(output), prospect, [
    prospect,
  ]);
  expect(changes[0]).toMatchObject({ field: "employees", after: 120 });
});

it("envia os limites por campo no JSON Schema estrito da requisição OpenAI", async () => {
  let requestBody: Record<string, any> | undefined;
  const output = proposal("structured_hr", "Sim");
  const provider = createOpenAI({
    apiKey: "test-key",
    fetch: async (_url, init) => {
      requestBody = JSON.parse(init!.body as string);
      return Response.json({
        id: "resp_test",
        object: "response",
        created_at: 0,
        model: "test-model",
        status: "completed",
        output: [
          {
            type: "message",
            id: "msg_test",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify(output),
                annotations: [],
              },
            ],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });
    },
  });
  const response = await generateText({
    model: provider("test-model"),
    prompt: "Revise os sinais fornecidos.",
    output: Output.object({ schema: signalOutputSchema }),
    providerOptions: { openai: { strictJsonSchema: true } },
    maxRetries: 0,
  });
  expect(response.output).toEqual(output);
  const format = requestBody!.text.format;
  expect(format).toMatchObject({
    type: "json_schema",
    strict: true,
    schema: { type: "object", additionalProperties: false },
  });
  const variants = format.schema.properties.changes.items.anyOf;
  expect(variants).toHaveLength(ALLOWED_AI_FIELDS.length);
  for (const variant of variants) {
    expect(variant.additionalProperties).toBe(false);
    expect(variant.required).toEqual([
      "field",
      "after",
      "reason",
      "evidenceIds",
    ]);
  }
  const valueSchema = (field: string) =>
    variants.find((variant: any) => variant.properties.field.const === field)
      .properties.after.anyOf;
  expect(valueSchema("structured_hr")).toContainEqual({
    type: "string",
    enum: ["Sim", "Não"],
  });
  expect(valueSchema("growth")).toContainEqual({
    type: "string",
    enum: ["Baixo", "Médio", "Alto"],
  });
  expect(valueSchema("state")).toContainEqual({
    type: "string",
    enum: [...BRAZILIAN_STATES],
  });
  expect(valueSchema("employees")).toContainEqual(
    expect.objectContaining({ type: "integer", minimum: 0 }),
  );
  expect(valueSchema("employees")).toContainEqual({ type: "null" });
});
