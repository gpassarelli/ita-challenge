import { test, expect, type Page } from "@playwright/test";
import Papa from "papaparse";
import { emptyWorkspace, type Workspace } from "../../src/lib/domain/types";
import { DATASETS, type Dataset } from "../../src/lib/domain/catalog";
import { executeCommand } from "../../src/lib/domain/execute";
import { previewCSV } from "../../src/lib/domain/csv";
import { importPreview, saveRecord } from "../../src/lib/domain/mutations";
import {
  commandSchema,
  agentRequestSchema,
} from "../../src/lib/domain/commands";
import {
  cancelAgentRun,
  queueAgentRun,
} from "../../src/lib/domain/agent-run-mutations";
import { evaluationDate } from "../../src/lib/domain/types";
import { criterionAlternatives } from "../../src/lib/domain/scoring";
import {
  actor,
  revision,
  uid,
  company,
  product,
  activate,
  criterion,
  run,
} from "../fixtures";
async function mount(page: Page, state: Workspace = emptyWorkspace()) {
  await page.route("http://localhost:4174/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const data = request.method() === "POST" ? request.postDataJSON() : null;
    try {
      if (path === "/api/commands") {
        executeCommand(
          state,
          actor,
          commandSchema.parse(data),
          request.headers()["idempotency-key"],
        );
        state.version++;
      }
      if (path === "/api/import") {
        const preview = previewCSV(
          data.dataset,
          data.fileName,
          data.text,
          state,
        );
        if (data.mode === "preview") {
          await route.fulfill({ json: { preview } });
          return;
        }
        importPreview(state, actor, preview, data.requestId);
      }
      if (path === "/api/score-history") {
        await route.fulfill({ json: { history: [] } });
        return;
      }
      if (path === "/api/agents/cancel") {
        cancelAgentRun(state, actor, data.id);
      }
      if (path === "/api/agents") {
        const shouldRun = queueAgentRun(
          state,
          actor,
          agentRequestSchema.parse(data),
        );
        const execution = state.runs.find((r) => r.id === data.id)!;
        if (shouldRun) {
          for (const item of execution.items) {
            const prospect = state.records.find(
              (r) => r.id === item.companyId,
            )!;
            let result = revision(prospect, { runId: execution.id });
            if (data.agent === "outreach") {
              const selectedProduct = state.records.find(
                (r) => r.id === data.productId,
              )!;
              if (!selectedProduct) throw new Error("Produto obrigatório");
              const message = {
                subject: "Conversa sobre " + selectedProduct.data.name,
                body: "Mensagem original de teste para a equipe.",
                rationale:
                  "Proposta do produto selecionado: " +
                  selectedProduct.data.value_proposition,
                evidenceIds: [prospect.id, selectedProduct.id],
                warnings: [],
                productId: selectedProduct.id,
                contactId: null,
                channel: data.channel,
              };
              result = revision(prospect, {
                runId: execution.id,
                type: "message",
                changes: [],
                message,
                originalMessage: structuredClone(message),
              });
            }
            state.revisions.push(result);
            item.status = "completed";
            item.revisionId = result.id;
            item.finishedAt = new Date().toISOString();
          }
          execution.status = "completed";
          execution.workflowId = "workflow-" + execution.id;
          execution.finishedAt = new Date().toISOString();
          state.version++;
        }
        await route.fulfill({
          json: {
            state,
            runId: execution.id,
            skippedCompanies: execution.skippedCompanies ?? [],
          },
        });
        return;
      }
      await route.fulfill({
        json: {
          state,
          user: { id: actor, email: "teste@isolado.invalid" },
          aiReady: true,
        },
      });
    } catch (e) {
      await route.fulfill({
        status: 400,
        json: { error: (e as Error).message },
      });
    }
  });
  await page.goto("http://localhost:4174");
  await expect(page.getByText("Carregando seus dados...")).toHaveCount(0);
  return state;
}
test("aplicação publicada localmente exige login e protege operações", async ({
  page,
  request,
}) => {
  await page.goto("/");
  // Both intentional first-access states are supported: no connection, or configured login.
  await expect(
    page.getByRole("heading", { name: /Vamos continuar|Empresas/ }),
  ).toBeVisible();
  const result = await request.post("/api/commands", {
    data: {
      type: "rules",
      kind: "icp",
      active: true,
      criteria: [],
      exclusions: [],
    },
  });
  expect([400, 401]).toContain(result.status());
  const body = await result.json();
  expect(body.error).toMatch(/conta|Supabase/);
});
test("interface vazia, 9 modelos, navegação e apresentação em celular", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const state = await mount(page);
  await expect(
    page.getByRole("heading", { name: "Empresas", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Um espaço para suas próximas oportunidades"),
  ).toBeVisible();
  expect(state.records).toHaveLength(0);
  expect(state.rulesets).toHaveLength(0);
  await page
    .getByRole("button", { name: "Importar CSV", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Tipo de dados").locator("option"),
  ).toHaveCount(9);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar modelo vazio" }).click();
  expect((await download).suggestedFilename()).toBe("Prospects.csv");
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  for (const name of [
    "Pessoas e canais",
    "Sinais",
    "Oportunidades",
    "Contratações",
    "Portfólio",
    "Listas",
    "Revisões",
    "Configurações",
  ]) {
    await page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Empresas", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Empresas", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("cadastro, CSV, regras, lista dinâmica, Kanban e aprovação pela interface", async ({
  page,
}) => {
  const initial = emptyWorkspace();
  const solution = product(initial, {
    external_id: "E2E-SOLUTION",
    name: "Solução comercial E2E",
  });
  const state = await mount(page, initial);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "Nova empresa", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("ID Empresa", { exact: false })
    .fill("E2E-EMPRESA");
  await page
    .getByRole("dialog")
    .getByLabel("Empresa *", { exact: true })
    .fill("Empresa isolada E2E");
  await page
    .getByRole("dialog")
    .getByLabel("Colaboradores", { exact: true })
    .fill("450");
  await page
    .getByRole("dialog")
    .getByLabel("Segmento", { exact: true })
    .fill("Tecnologia");
  await page
    .getByRole("button", { name: "Salvar empresa", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "Empresa isolada E2E", exact: true }),
  ).toBeVisible();
  expect(state.records).toHaveLength(2);
  // All fields, including app-only notes, are accessible in the drawer.
  await page
    .getByRole("cell", { name: "Empresa isolada E2E", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("Notas da equipe", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Pessoas e canais", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Importar CSV", exact: true })
    .first()
    .click();
  const csv = Papa.unparse(
    [
      DATASETS.Decisores_Canais.fields.map((f) => f.label),
      [
        "E2E-EMPRESA",
        "Empresa isolada E2E",
        "RH",
        "",
        "Institucional",
        "rh@isolado.invalid",
        "CSV de teste",
        "Não",
      ],
    ],
    { delimiter: ";" },
  );
  await page
    .getByRole("dialog")
    .getByLabel("Arquivo CSV", { exact: true })
    .setInputFiles({
      name: "contatos-isolados.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
  await page.getByRole("button", { name: "Conferir dados" }).click();
  await expect(page.getByText("1 novos", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Canal", { exact: true })).toBeVisible();
  expect(
    state.records.find((r) => r.dataset === "Decisores_Canais")!.origins[0].raw[
      "Contato fictício"
    ],
  ).toBe("");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Configurações", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Configurar regras", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Adicionar critério" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Nome do critério 1", { exact: true })
    .fill("Porte mínimo");
  await page
    .getByRole("dialog")
    .getByLabel("Peso 1", { exact: true })
    .fill("100");
  await page
    .getByRole("dialog")
    .getByLabel("Campo avaliado", { exact: true })
    .selectOption("employees");
  await page
    .getByRole("dialog")
    .getByLabel("Condição", { exact: true })
    .selectOption("gte");
  await page
    .getByRole("dialog")
    .getByLabel("Valor esperado", { exact: true })
    .fill("200");
  await page.getByRole("button", { name: "Ativar e recalcular" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.evaluations[0].icp.value).toBe(100);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Listas", exact: true })
    .click();
  await page.getByRole("button", { name: "Criar lista", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Nome da lista")
    .fill("ICP alto · teste");
  await page.getByRole("button", { name: "Adicionar condição" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Campo do filtro 1")
    .selectOption("icp");
  await page.getByRole("dialog").getByLabel("Valor do filtro 1").fill("80");
  await page.getByRole("button", { name: "Salvar lista", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("1 empresas", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Oportunidades", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Nova oportunidade", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("ID Oportunidade", { exact: false })
    .fill("E2E-OPP");
  await page
    .getByRole("dialog")
    .getByLabel("ID Empresa", { exact: false })
    .selectOption("E2E-EMPRESA");
  await page
    .getByRole("dialog")
    .getByLabel("Solução *", { exact: true })
    .selectOption(solution.externalKey);
  await page
    .getByRole("dialog")
    .getByLabel("Ticket estimado", { exact: true })
    .fill("R$ 60.000,50");
  await page
    .getByRole("button", { name: "Salvar oportunidade", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Etapa da oportunidade E2E-OPP").selectOption("Ganha");
  await expect(page.getByLabel("Etapa da oportunidade E2E-OPP")).toHaveValue(
    "Ganha",
  );
  expect(
    state.audits.some((a) => a.action === "Oportunidade movimentada"),
  ).toBe(true);
  expect(
    state.records.find((r) => r.dataset === "Prospects")!.data
      .commercial_status,
  ).toBe("Cliente ativo");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Empresas", exact: true })
    .click();
  await page
    .getByLabel("Selecionar Empresa isolada E2E", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Analisar sinais", exact: true })
    .click();
  await page.getByRole("button", { name: "Executar agente" }).click();
  await expect(
    page.getByRole("heading", { name: "Empresas", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Revisar resultado", exact: true })
    .click();
  await page.getByRole("button", { name: "Aprovar revisão inteira" }).click();
  await page.getByRole("button", { name: "Fechar execuções" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.revisions[0].status).toBe("approved");
  expect(
    state.records.find((r) => r.dataset === "Prospects")!.data.structured_hr,
  ).toBe("Sim");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Portfólio", exact: true })
    .click();
  await page.getByRole("button", { name: "Novo produto", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("ID *", { exact: true })
    .fill("E2E-PROD");
  await page
    .getByRole("dialog")
    .getByLabel("Solução *", { exact: true })
    .fill("Produto E2E");
  await page
    .getByRole("dialog")
    .getByLabel("Proposta de valor", { exact: true })
    .fill("Proposta de valor selecionada");
  await page
    .getByRole("button", { name: "Salvar produto", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const companyBefore = structuredClone(
    state.records.find((r) => r.dataset === "Prospects"),
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Empresas", exact: true })
    .click();
  await page
    .getByLabel("Selecionar Empresa isolada E2E", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Preparar abordagem", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Produto do portfólio *")
    .selectOption(state.records.find((r) => r.dataset === "Portfolio")!.id);
  await page.getByRole("button", { name: "Executar agente" }).click();
  await page
    .getByRole("button", { name: "Revisar resultado", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Mensagem", { exact: true })
    .fill("Mensagem editada pelo usuário.");
  await page
    .getByRole("button", { name: "Aprovar mensagem", exact: true })
    .click();
  await page.getByRole("button", { name: "Fechar execuções" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const messageRevision = state.revisions.find((r) => r.type === "message")!;
  expect(messageRevision.edited).toBe(true);
  expect(messageRevision.message!.body).toBe("Mensagem editada pelo usuário.");
  expect(messageRevision.originalMessage!.body).toBe(
    "Mensagem original de teste para a equipe.",
  );
  expect(state.records.find((r) => r.dataset === "Prospects")).toEqual(
    companyBefore,
  );
  expect(errors).toEqual([]);
});

test("editor de escala traduz percentuais para uma nota calculada", async ({
  page,
}) => {
  const state = emptyWorkspace();
  company(state, { growth: "Médio" });
  await mount(page, state);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Configurações", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Configurar regras", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Adicionar critério" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Nome do critério 1")
    .fill("Intensidade de crescimento");
  await dialog.getByLabel("Peso 1", { exact: true }).fill("100");
  await dialog
    .getByLabel("Campo avaliado", { exact: true })
    .selectOption("growth");
  await dialog.getByLabel("Condição", { exact: true }).selectOption("scale");
  await dialog.getByLabel("Categoria 1", { exact: true }).fill("Médio");
  await dialog
    .getByLabel("Percentual da categoria 1", { exact: true })
    .fill("50");
  await page.getByRole("button", { name: "Ativar e recalcular" }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.evaluations[0].icp.value).toBe(50);
  const alternative = criterionAlternatives(state.rulesets[0].criteria[0])[0];
  expect(alternative.source).toBe("company");
  expect(
    JSON.parse(alternative.source === "company" ? alternative.value : "{}"),
  ).toEqual({
    Médio: 0.5,
  });
  await page
    .getByRole("button", { name: "Editar regras", exact: true })
    .first()
    .click();
  await dialog
    .getByRole("button", { name: "Adicionar alternativa (OU)", exact: true })
    .click();
  const added = dialog.getByRole("group", {
    name: "OU · Alternativa 2",
    exact: true,
  });
  await added.getByLabel("Campo avaliado").selectOption("growth");
  await added.getByLabel("Condição", { exact: true }).selectOption("scale");
  await added.getByLabel("Categoria 1", { exact: true }).fill("Alto");
  await added
    .getByLabel("Percentual da categoria 1", { exact: true })
    .fill("100");
  await dialog
    .getByRole("button", { name: "Remover alternativa 1", exact: true })
    .click();
  await expect(dialog.getByLabel("Categoria 1", { exact: true })).toHaveValue(
    "Alto",
  );
  await expect(
    dialog.getByLabel("Percentual da categoria 1", { exact: true }),
  ).toHaveValue("100");
  await dialog.getByRole("button", { name: "Ativar e recalcular" }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.evaluations[0].icp.value).toBe(0);
});

test("importação distingue canais, ignora contatos ausentes e cria negócios com ticket em reais", async ({
  page,
}) => {
  const state = emptyWorkspace();
  const c = company(state, {
    external_id: "IMPORT-EMP",
    name: "Empresa importadora",
  });
  const solution = product(state, { name: "Solução para importação" });
  await mount(page, state);
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Referências", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Pessoas e canais", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Importar CSV", exact: true })
    .first()
    .click();
  const contacts = Papa.unparse(
    [
      DATASETS.Decisores_Canais.fields.map((f) => f.label),
      [
        c.externalKey,
        c.data.name,
        "RH",
        "Não identificado",
        "E-mail",
        "rh@empresa.invalid",
        "CSV",
        "Não",
      ],
      [
        c.externalKey,
        c.data.name,
        "RH",
        "Não identificado",
        "E-mail",
        "Não identificado",
        "CSV",
        "Não",
      ],
    ],
    { delimiter: ";" },
  );
  await page.getByLabel("Arquivo CSV", { exact: true }).setInputFiles({
    name: "contatos.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(contacts),
  });
  await page.getByRole("button", { name: "Conferir dados" }).click();
  await expect(page.getByText("1 novos", { exact: true })).toBeVisible();
  await expect(page.getByText("1 ignorados", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Canal", { exact: true })).toBeVisible();
  expect(
    state.records.filter((r) => r.dataset === "Decisores_Canais"),
  ).toHaveLength(1);
  expect(
    state.records.find((r) => r.dataset === "Decisores_Canais")!.data.name,
  ).toBeNull();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Oportunidades", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Importar CSV", exact: true })
    .first()
    .click();
  const opportunities = Papa.unparse(
    [
      DATASETS.Oportunidades_Historico.fields.map((f) => f.label),
      [
        "IMPORT-OPP",
        c.externalKey,
        c.data.name,
        solution.externalKey,
        "Ganha",
        "30",
        "R$ 60.000,50",
        "Contrato",
        "Não identificado",
        "CSV",
      ],
    ],
    { delimiter: ";" },
  );
  await page.getByLabel("Arquivo CSV", { exact: true }).setInputFiles({
    name: "negocios.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(opportunities),
  });
  await page.getByRole("button", { name: "Conferir dados" }).click();
  await expect(page.getByText("0 inválidos", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Etapa da oportunidade IMPORT-OPP")).toHaveValue(
    "Ganha",
  );
  await expect(page.getByText(/R\$\s*60\.000,50/).first()).toBeVisible();
  expect(
    state.records.find((r) => r.dataset === "Oportunidades_Historico")!.data
      .estimated_ticket,
  ).toBe(60000.5);
  expect(c.data.commercial_status).toBe("Cliente ativo");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Empresas", exact: true })
    .click();
  await page
    .getByLabel("Filtrar status comercial")
    .selectOption("Cliente ativo");
  await expect(
    page.getByRole("cell", { name: "Empresa importadora", exact: true }),
  ).toBeVisible();
});

test("clientes importados geram contratações por solução e Churn preserva vendas ganhas", async ({
  page,
}) => {
  const state = emptyWorkspace();
  const c = company(state, {
    external_id: "CLIENTE-EMP",
    name: "Empresa contratante",
  });
  const a = product(state, { external_id: "SOL-A", name: "Benefícios" });
  const b = product(state, { external_id: "SOL-B", name: "Saúde" });
  await mount(page, state);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Contratações", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Importar CSV", exact: true })
    .first()
    .click();
  const csv = Papa.unparse(
    [
      DATASETS.Clientes_Atuais.fields.map((f) => f.label),
      [
        c.externalKey,
        c.data.name,
        "Tecnologia",
        "300",
        "SP",
        a.externalKey,
        "R$ 60.000,50",
        "Alto",
        "Cliente ativo",
        "9",
      ],
      [
        c.externalKey,
        c.data.name,
        "Tecnologia",
        "300",
        "SP",
        b.externalKey,
        "R$ 10.000,00",
        "Médio",
        "Churn",
        "7",
      ],
    ],
    { delimiter: ";" },
  );
  await page.getByLabel("Arquivo CSV", { exact: true }).setInputFiles({
    name: "clientes.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "Conferir dados" }).click();
  await expect(page.getByText("2 novos", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "Benefícios", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Saúde", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: /R\$\s*60\.000,50/ }),
  ).toBeVisible();
  expect(
    state.records.filter((r) => r.dataset === "Oportunidades_Historico"),
  ).toHaveLength(2);
  expect(c.data.commercial_status).toBe("Cliente ativo");
  await page.getByRole("cell", { name: "Benefícios", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Abrir oportunidade ganha", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Editar cadastro", exact: true })
    .click();
  await page.getByLabel("Status *", { exact: true }).selectOption("Churn");
  await page
    .getByRole("button", { name: "Salvar contratação", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Filtrar status da contratação").selectOption("Churn");
  await expect(
    page.getByRole("cell", { name: "Benefícios", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Saúde", exact: true }),
  ).toBeVisible();
  expect(c.data.commercial_status).toBe("Ex-cliente");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Oportunidades", exact: true })
    .click();
  for (const deal of state.records.filter(
    (r) => r.dataset === "Oportunidades_Historico",
  )) {
    await expect(
      page.getByLabel("Etapa da oportunidade " + deal.externalKey),
    ).toHaveValue("Ganha");
  }
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Empresas", exact: true })
    .click();
  await page.getByLabel("Filtrar status comercial").selectOption("Ex-cliente");
  await expect(
    page.getByRole("cell", { name: "Empresa contratante", exact: true }),
  ).toBeVisible();
});

test("regras combinam empresa, pessoas e sinais com evidências e reabertura", async ({
  page,
}, testInfo) => {
  const state = emptyWorkspace();
  const c = company(state, { name: "Empresa com sinais", growth: "Médio" });
  for (const evidence of ["Abertura de unidade", "Entrada em nova região"])
    saveRecord(state, actor, "Sinais_Publicos", {
      company_external_id: c.externalKey,
      signal_type: "Expansão",
      strength: "Alto",
      date: evaluationDate(),
      evidence,
      source: "Site institucional",
    });
  saveRecord(state, actor, "Decisores_Canais", {
    company_external_id: c.externalKey,
    name: "Marina de teste",
    role: "Diretora de RH",
    identified: "Sim",
    channel: "marina@isolado.invalid",
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mount(page, state);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Configurações", exact: true })
    .click();
  const configure = page
    .getByRole("button", { name: "Configurar regras", exact: true })
    .first();
  await configure.click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Adicionar critério", exact: true })
    .click();
  const first = dialog.getByRole("group", { name: "Critério 1", exact: true });
  await first.getByLabel("Nome do critério 1").fill("Crescimento comprovado");
  await first.getByLabel("Peso 1", { exact: true }).fill("60");
  await first
    .getByLabel("Campo avaliado", { exact: true })
    .selectOption("growth");
  await first.getByLabel("Condição", { exact: true }).selectOption("scale");
  await first.getByLabel("Categoria 1", { exact: true }).fill("Médio");
  await first
    .getByLabel("Percentual da categoria 1", { exact: true })
    .fill("50");
  await first
    .getByRole("button", { name: "Adicionar alternativa (OU)", exact: true })
    .click();
  await first.getByLabel("Fonte da alternativa 2").selectOption("signal");
  await first.getByLabel("Valor do filtro 1").fill("Expansão");
  await expect(first.getByLabel("Força mínima")).toHaveValue("Alto");
  await expect(first.getByLabel("Recência em dias")).toHaveValue("90");
  await expect(first.locator("datalist option[value='Expansão']")).toHaveCount(
    1,
  );
  await first
    .getByRole("button", { name: "Adicionar filtro (E)", exact: true })
    .click();
  await first.getByLabel("Campo do filtro 2").selectOption("source");
  await first.getByLabel("Valor do filtro 2").fill("Site institucional");

  await dialog
    .getByRole("button", { name: "Adicionar critério", exact: true })
    .click();
  const second = dialog.getByRole("group", { name: "Critério 2", exact: true });
  await second.getByLabel("Nome do critério 2").fill("Acesso ao decisor");
  await second.getByLabel("Peso 2", { exact: true }).fill("40");
  await second.getByLabel("Fonte da alternativa 1").selectOption("person");
  await second.getByLabel("Valor do filtro 1").fill("diretor");
  await expect(
    second.locator("datalist option[value='Diretora de RH']"),
  ).toHaveCount(1);
  await second
    .getByRole("button", { name: "Adicionar filtro (E)", exact: true })
    .click();
  await second.getByLabel("Campo do filtro 2").selectOption("identified");
  await second.getByLabel("Valor do filtro 2").fill("Sim");
  await second
    .getByRole("button", { name: "Adicionar filtro (E)", exact: true })
    .click();
  await second.getByLabel("Campo do filtro 3").selectOption("channel");
  await expect(second.getByLabel("Condição do filtro 3")).toHaveValue("exists");
  await dialog.getByRole("button", { name: "Ativar e recalcular" }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.evaluations[0].icp).toMatchObject({
    value: 100,
    earned: 100,
    coverage: 100,
  });
  expect(state.evaluations[0].icp.criteria.map((r) => r.earned)).toEqual([
    60, 40,
  ]);

  await page
    .getByRole("button", { name: "Editar regras", exact: true })
    .first()
    .click();
  await expect(first.getByLabel("Fonte da alternativa 2")).toHaveValue(
    "signal",
  );
  await expect(second.getByLabel("Valor do filtro 1")).toHaveValue("diretor");
  await page.screenshot({
    path: testInfo.outputPath("icp-editor-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("icp-editor-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 720 });
  await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Empresas", exact: true })
    .click();
  await page
    .getByRole("cell", { name: "Empresa com sinais", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Pontuações", exact: true }).click();
  await dialog.getByText("Crescimento comprovado", { exact: true }).click();
  await expect(
    dialog.getByText(/2 registro\(s\) atendem; pontuação única/),
  ).toBeVisible();
  await expect(
    dialog.getByText(/Abertura de unidade · Sinais/).first(),
  ).toBeVisible();
  await expect(
    dialog
      .getByText(
        new RegExp("Data: " + evaluationDate().split("-").reverse().join("/")),
      )
      .first(),
  ).toBeVisible();
  await dialog.getByText("Acesso ao decisor", { exact: true }).click();
  await expect(
    dialog.getByText(/Marina de teste · Pessoas e canais/).first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("regras antigas reabrem sem perder condição e falta de dados rende zero", async ({
  page,
}) => {
  const state = emptyWorkspace();
  company(state, { name: "Empresa sem informações" });
  activate(state, [
    criterion({
      field: "strong_recent_signal",
      operator: "equals",
      value: "Sim",
      recentDays: 45,
    }),
  ]);
  const original = structuredClone(state.rulesets[0].criteria);
  await mount(page, state);
  await expect(page.getByText("Sem dados suficientes").first()).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Configurações", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Editar regras", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Campo avaliado")).toHaveValue(
    "strong_recent_signal",
  );
  await expect(dialog.getByLabel("Recência em dias")).toHaveValue("45");
  await dialog.getByRole("button", { name: "Ativar e recalcular" }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.rulesets[0].criteria).toEqual(original);
  expect(state.rulesets[1].criteria[0].alternatives).toEqual([
    {
      source: "company",
      field: "strong_recent_signal",
      operator: "equals",
      value: "Sim",
      recentDays: 45,
    },
  ]);
  expect(state.evaluations[0].icp).toMatchObject({
    value: 0,
    coverage: 0,
    status: "insufficient",
  });
});

test("progresso mostra etapas, falhas parciais e execuções antigas em desktop e celular", async ({
  page,
}, testInfo) => {
  const state = emptyWorkspace();
  const first = company(state, { name: "Empresa Alfa" });
  const second = company(state, { name: "Empresa Beta" });
  const startedAt = new Date(Date.now() - 15000).toISOString();
  const execution = run(first, {
    companyIds: [first.id, second.id],
    status: "running",
    workflowId: "workflow-progress-test",
    items: [
      {
        companyId: first.id,
        status: "running",
        error: null,
        revisionId: null,
        attempts: 1,
        startedAt,
        model: "modelo-teste",
        promptVersion: "signals-v1",
        steps: [
          {
            phase: "preparing",
            status: "completed",
            attempt: 1,
            startedAt,
            finishedAt: startedAt,
          },
          { phase: "generating", status: "running", attempt: 1, startedAt },
        ],
      },
      { companyId: second.id, status: "queued", error: null, revisionId: null },
    ],
  });
  state.runs.push(execution);
  await mount(page, state);
  await page
    .getByRole("button", { name: "Abrir execuções", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Analisar sinais/ })
    .click();
  await expect(
    page.getByText("0 de 2 empresas finalizadas · 0%"),
  ).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "0");
  await page.locator("summary").filter({ hasText: "Empresa Alfa" }).click();
  await expect(
    page.getByText("Preparando dados", { exact: false }).last(),
  ).toBeVisible();
  await expect(
    page.getByText("Modelo: modelo-teste · Prompt: signals-v1"),
  ).toBeVisible();
  await page
    .getByText("Identificação para diagnóstico", { exact: true })
    .click();
  await expect(
    page.getByText("Workflow: workflow-progress-test"),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("progress-desktop.png"),
    fullPage: true,
  });
  execution.items[0].status = "completed";
  execution.items[0].finishedAt = new Date().toISOString();
  execution.items[0].steps![1].status = "completed";
  execution.items[0].steps![1].finishedAt = new Date().toISOString();
  execution.items[1].status = "failed";
  execution.items[1].error =
    "A IA excedeu o tempo de resposta. Código: AI_TIMEOUT.";
  execution.status = "completed";
  execution.finishedAt = new Date().toISOString();
  await expect(page.getByText("Concluída com falhas")).toBeVisible({
    timeout: 10000,
  });
  await expect(
    page.getByText("2 de 2 empresas finalizadas · 100%"),
  ).toBeVisible();
  await page.locator("summary").filter({ hasText: "Empresa Beta" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "AI_TIMEOUT" }),
  ).toBeVisible();
  await expect(
    page.getByText("Esta execução não possui histórico detalhado de etapas."),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("progressbar")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("progress-mobile.png"),
    fullPage: true,
  });
});

test("atualização lenta não sobrepõe consultas e preserva os dados após erro", async ({
  page,
}) => {
  const state = emptyWorkspace();
  const prospect = company(state, { name: "Empresa preservada" });
  state.runs.push(
    run(prospect, {
      status: "running",
      items: [
        {
          companyId: prospect.id,
          status: "running",
          error: null,
          revisionId: null,
        },
      ],
    }),
  );
  await mount(page, state);
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("http://localhost:4174/api/workspace", async (route) => {
    calls++;
    await blocked;
    await route.fulfill({
      status: 503,
      json: {
        error:
          "Conexão interrompida. Etapa: read_workspace. Código: NETWORK_ERROR.",
      },
    });
  });
  await expect.poll(() => calls, { timeout: 6000 }).toBe(1);
  await page.waitForTimeout(4500);
  expect(calls).toBe(1);
  release();
  await expect(page.getByRole("alert")).toContainText("NETWORK_ERROR");
  await expect(
    page.getByText(/Mantivemos os últimos dados recebidos/),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Empresa preservada", exact: true }),
  ).toBeVisible();
});

async function openExecution(page: Page, companyName?: string) {
  await page
    .getByRole("button", { name: "Abrir execuções", exact: true })
    .click();
  const panel = page.getByRole("dialog");
  await panel
    .getByRole("button", {
      name: companyName
        ? new RegExp(companyName)
        : /Analisar sinais|Preparar abordagem/,
    })
    .first()
    .click();
  return panel;
}

test("lote exclui pendências, revisa no painel e arquiva no histórico das empresas", async ({
  page,
}, testInfo) => {
  const state = emptyWorkspace();
  const blocked = company(state, { name: "Empresa bloqueada" });
  company(state, { name: "Empresa elegível Alfa" });
  company(state, { name: "Empresa elegível Beta" });
  state.revisions.push(revision(blocked));
  await mount(page, state);
  for (const name of [
    "Empresa bloqueada",
    "Empresa elegível Alfa",
    "Empresa elegível Beta",
  ])
    await page.getByLabel("Selecionar " + name, { exact: true }).check();
  await page
    .getByRole("button", { name: "Analisar sinais", exact: true })
    .click();
  await expect(
    page.getByText("2 empresa(s) apta(s) para análise"),
  ).toBeVisible();
  await expect(
    page.getByText("As empresas abaixo não serão executadas", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Revisar pendência" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Executar agente · 2/ }).click();
  const panel = page.getByRole("dialog");
  await expect(
    page.getByRole("heading", { name: "Empresas", exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("Empresas não executadas · 1")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Arquivar execução", exact: true }),
  ).toBeDisabled();
  expect(state.runs[0].items).toHaveLength(2);
  // The underlying workspace stays usable while the panel is open.
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Portfólio", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Portfólio", exact: true }),
  ).toBeVisible();
  await expect(panel).toBeVisible();
  for (const [name, decision] of [
    ["Empresa elegível Alfa", "approve"],
    ["Empresa elegível Beta", "reject"],
  ]) {
    const item = panel
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: name }) })
      .last();
    await item.locator("summary").first().click();
    await item.getByRole("button", { name: "Revisar resultado" }).click();
    if (decision === "approve")
      await panel
        .getByRole("button", { name: "Aprovar revisão inteira" })
        .click();
    else {
      await panel
        .getByLabel("Observação da revisão", { exact: false })
        .fill("Evidência insuficiente");
      await panel.getByRole("button", { name: "Recusar revisão" }).click();
    }
    await expect(
      panel.getByRole("heading", { name: "Detalhes da execução" }),
    ).toBeVisible();
  }
  await expect(
    panel.getByText("0 revisões pendentes", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Abrir execuções" }),
  ).toBeInViewport();
  await page.setViewportSize({ width: 1024, height: 768 });
  const triggerBox = await page
    .getByRole("button", { name: "Abrir execuções" })
    .boundingBox();
  const panelBox = await panel.boundingBox();
  expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(panelBox!.x);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({
    path: testInfo.outputPath("execution-panel-desktop.png"),
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "Arquivar execução", exact: true })
    .click();
  await expect(panel.getByText("Nenhuma execução por aqui.")).toBeVisible();
  expect(state.runs[0].archivedBy).toBe(actor);
  expect(
    state.revisions.filter(
      (r) => r.runId === state.runs[0].id && r.status === "pending",
    ),
  ).toHaveLength(0);
  await panel.getByRole("button", { name: "Fechar execuções" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Empresas", exact: true })
    .click();
  await page
    .getByRole("cell", { name: "Empresa elegível Alfa", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Execuções", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Analisar sinais.*Arquivada/ })
    .click();
  await expect(panel.getByText(/Arquivada em/)).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Ver revisão", exact: true }).first(),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Voltar à empresa" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "Empresa elegível Alfa" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("Arquivada", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Fechar", exact: true })
    .click();
  await page
    .getByRole("cell", { name: "Empresa bloqueada", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Execuções", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("Nenhuma execução por aqui."),
  ).toBeVisible();
});

test("sinais bloqueados orientam recusar revisão desatualizada antes de executar", async ({
  page,
}) => {
  const state = emptyWorkspace();
  const c = company(state, { name: "Empresa com revisão" });
  const r = revision(c, { companyVersion: c.version - 1 });
  state.revisions.push(r);
  await mount(page, state);
  await page
    .getByLabel("Selecionar Empresa com revisão", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Analisar sinais", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Executar agente · 0/ }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Revisar pendência" }).click();
  await expect(
    page.getByRole("button", { name: "Aprovar revisão inteira" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Recuse esta revisão desatualizada", { exact: false }),
  ).toBeVisible();
  await page
    .getByLabel("Observação da revisão", { exact: false })
    .fill("Cadastro mudou");
  await page.getByRole("button", { name: "Recusar revisão" }).click();
  await page.getByRole("button", { name: "Fechar execuções" }).click();
  await page
    .getByRole("button", { name: "Analisar sinais", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Executar agente · 1/ }),
  ).toBeEnabled();
});

test("rascunho da revisão permanece durante atualização e navegação do workspace", async ({
  page,
}) => {
  const state = emptyWorkspace();
  const c = company(state, { name: "Empresa da mensagem" });
  const p = product(state);
  const execution = run(c, { agent: "outreach", status: "completed" });
  const message = {
    subject: "Assunto",
    body: "Mensagem original",
    rationale: "Contexto",
    evidenceIds: [c.id],
    warnings: [],
    productId: p.id,
    contactId: null,
    channel: "E-mail",
  };
  const r = revision(c, {
    runId: execution.id,
    type: "message",
    changes: [],
    message,
    originalMessage: structuredClone(message),
  });
  execution.items = [
    { companyId: c.id, status: "completed", revisionId: r.id, error: null },
  ];
  state.runs.push(execution);
  state.revisions.push(r);
  await mount(page, state);
  const panel = await openExecution(page);
  await panel
    .locator("summary")
    .filter({ hasText: "Empresa da mensagem" })
    .click();
  await panel.getByRole("button", { name: "Revisar resultado" }).click();
  await panel
    .getByLabel("Mensagem", { exact: true })
    .fill("Rascunho mantido após atualização");
  await panel
    .getByLabel("Observação da revisão", { exact: false })
    .fill("Revisão em andamento");
  const refreshed = page.waitForResponse((response) =>
    response.url().endsWith("/api/workspace"),
  );
  await page.getByRole("button", { name: "Atualizar dados" }).click();
  await refreshed;
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Sinais", exact: true })
    .click();
  await expect(panel.getByLabel("Mensagem", { exact: true })).toHaveValue(
    "Rascunho mantido após atualização",
  );
  await expect(
    panel.getByLabel("Observação da revisão", { exact: false }),
  ).toHaveValue("Revisão em andamento");
  await panel.getByRole("button", { name: "Aprovar mensagem" }).click();
  expect(state.revisions[0].message?.body).toBe(
    "Rascunho mantido após atualização",
  );
  expect(state.revisions[0].originalMessage?.body).toBe("Mensagem original");
});

test("painel móvel mantém foco, fecha com Escape e permite arquivar falhas", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = emptyWorkspace();
  const c = company(state, { name: "Empresa móvel" });
  state.runs.push(
    run(c, {
      status: "failed",
      items: [
        {
          companyId: c.id,
          status: "failed",
          error: "Falha de teste",
          revisionId: null,
        },
      ],
    }),
  );
  await mount(page, state);
  const panel = await openExecution(page);
  await expect(panel).toHaveCSS("width", "390px");
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press("Tab");
    expect(
      await panel.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await expect(
    panel.getByRole("button", { name: "Arquivar execução" }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("execution-panel-mobile.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Abrir execuções" }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await openExecution(page);
  await page.getByRole("button", { name: "Arquivar execução" }).click();
  await expect(page.getByText("Nenhuma execução por aqui.")).toBeVisible();
});

test("fila lista execuções antigas com carregar mais e preserva revisão na página", async ({
  page,
}) => {
  const state = emptyWorkspace();
  const c = company(state, { name: "Empresa histórica" });
  for (let index = 0; index < 18; index++) {
    state.runs.push(
      run(c, {
        status: "failed",
        items: [
          {
            companyId: c.id,
            status: "failed",
            error: "Falha",
            revisionId: null,
          },
        ],
      }),
    );
  }
  const archived = run(c, {
    status: "completed",
    archivedAt: new Date().toISOString(),
    archivedBy: actor,
  });
  state.runs.push(archived);
  state.revisions.push(revision(c, { runId: archived.id, status: "approved" }));
  await mount(page, state);
  await page.getByRole("button", { name: "Abrir execuções" }).click();
  const panel = page.getByRole("dialog");
  await expect(
    panel.getByRole("button", { name: /Analisar sinais/ }),
  ).toHaveCount(15);
  await panel.getByRole("button", { name: "Carregar mais execuções" }).click();
  await expect(
    panel.getByRole("button", { name: /Analisar sinais/ }),
  ).toHaveCount(18);
  await expect(panel.getByText("Arquivada", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Fechar execuções" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Revisões", exact: true })
    .click();
  await page.getByRole("button", { name: "Aprovadas", exact: true }).click();
  await page
    .getByRole("button", { name: /Empresa histórica.*alterações propostas/ })
    .click();
  await expect(
    page.getByRole("dialog").getByText("Aprovada", { exact: true }),
  ).toBeVisible();
});

test("revisão agrupa justificativa e evidências por alteração sem comentários gerais", async ({
  page,
}, testInfo) => {
  const state = emptyWorkspace();
  const c = company(state, {
    name: "Empresa com propostas",
    growth: "Médio",
    multi_region: "Não",
    employer_branding: "Baixo",
  });
  const expansion = saveRecord(state, actor, "Sinais_Publicos", {
    company_external_id: c.externalKey,
    signal_type: "Expansão",
    evidence: "Abertura de unidade",
    source: "Site institucional",
  });
  const region = saveRecord(state, actor, "Sinais_Publicos", {
    company_external_id: c.externalKey,
    signal_type: "Expansão regional",
    evidence: "Entrada em nova região",
  });
  const pending = revision(c, {
    explanation: "Employer branding permanece inalterado.",
    warnings: ["Não há dados sobre a renovação."],
    changes: [
      {
        field: "growth",
        before: "Médio",
        after: "Alto",
        reason: "A abertura de unidade sugere crescimento.",
        evidenceIds: [expansion.id],
      },
      {
        field: "multi_region",
        before: "Não",
        after: "Sim",
        reason: "A expansão regional sugere atuação em mais de uma região.",
        evidenceIds: [region.id],
      },
    ],
    input: {
      company: {
        id: c.id,
        type: c.dataset,
        version: c.version,
        data: { ...c.data },
      },
      records: [expansion, region].map((r) => ({
        id: r.id,
        type: r.dataset,
        version: r.version,
        data: { ...r.data },
      })),
    },
  });
  state.revisions.push(pending);
  expansion.data.evidence = "Texto alterado após a análise";
  await mount(page, state);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^Revisões/ })
    .click();
  await page
    .getByRole("button", {
      name: /Empresa com propostas.*alterações propostas/,
    })
    .click();
  const dialog = page.getByRole("dialog");
  const growth = dialog
    .getByRole("heading", { name: "Sinal crescimento", exact: true })
    .locator("..");
  const regions = dialog
    .getByRole("heading", { name: "Multi-região", exact: true })
    .locator("..");
  await expect(growth.getByText(pending.changes[0].reason)).toBeVisible();
  await expect(
    growth.getByText("Evidência fictícia: Abertura de unidade", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    growth.getByText("Entrada em nova região", { exact: false }),
  ).toHaveCount(0);
  await expect(regions.getByText(pending.changes[1].reason)).toBeVisible();
  await expect(
    regions.getByText("Evidência fictícia: Entrada em nova região", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(dialog.getByText(pending.explanation)).not.toBeVisible();
  await expect(dialog.getByText(pending.warnings[0])).not.toBeVisible();
  await expect(
    dialog.getByText("Texto alterado após a análise", { exact: false }),
  ).toHaveCount(0);
  await expect(
    dialog.locator("summary").filter({ hasText: "Evidências utilizadas" }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(growth.getByText(pending.changes[0].reason)).toBeVisible();
  await expect(regions.getByText(pending.changes[1].reason)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("review-grouped-mobile.png"),
    fullPage: true,
  });
});

test("cancela uma execução ativa no painel e permite arquivar", async ({
  page,
}) => {
  const state = emptyWorkspace();
  const c = company(state);
  const execution = run(c, {
    status: "running",
    items: [
      {
        companyId: c.id,
        status: "running",
        error: null,
        revisionId: null,
        steps: [
          {
            phase: "validating",
            status: "running",
            attempt: 1,
            startedAt: new Date().toISOString(),
          },
        ],
      },
    ],
  });
  state.runs.push(execution);
  await mount(page, state);
  await page
    .getByRole("button", { name: "Abrir execuções", exact: true })
    .click();
  const panel = page.getByRole("dialog");
  await panel.getByRole("button", { name: /Analisar sinais/ }).click();
  await panel
    .getByRole("button", { name: "Cancelar execução", exact: true })
    .click();
  await expect(
    panel.getByText("Cancelada", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Cancelar execução", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Arquivar execução", exact: true }),
  ).toBeEnabled();
  expect(execution.status).toBe("cancelled");
  expect(execution.items[0].steps?.[0].status).toBe("cancelled");
});

test("repete empresas com falha sem repetir o resultado bem-sucedido", async ({
  page,
}) => {
  const state = emptyWorkspace();
  const success = company(state, { name: "Empresa já concluída" });
  const failed = company(state, { name: "Empresa para repetir" });
  const original = run(success, {
    status: "completed",
    companyIds: [success.id, failed.id],
    items: [
      {
        companyId: success.id,
        status: "completed",
        error: null,
        revisionId: null,
      },
      {
        companyId: failed.id,
        status: "failed",
        error: "Código: AI_FIELD.",
        revisionId: null,
      },
    ],
  });
  const saved = revision(success, { runId: original.id });
  original.items[0].revisionId = saved.id;
  state.runs.push(original);
  state.revisions.push(saved);
  await mount(page, state);
  await page
    .getByRole("button", { name: "Abrir execuções", exact: true })
    .click();
  const panel = page.getByRole("dialog");
  await panel.getByRole("button", { name: /Analisar sinais/ }).click();
  await panel
    .getByRole("button", {
      name: "Repetir empresas com falha (1)",
      exact: true,
    })
    .click();
  await expect(
    panel.getByText("1 de 1 empresas finalizadas · 100%"),
  ).toBeVisible();
  expect(state.runs).toHaveLength(2);
  expect(state.runs[1].companyIds).toEqual([failed.id]);
  expect(state.runs[1].retryOf).toBe(original.id);
  expect(
    state.revisions.filter((r) => r.companyId === success.id),
  ).toHaveLength(1);
});
