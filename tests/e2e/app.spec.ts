import { test, expect, type Page } from "@playwright/test";
import Papa from "papaparse";
import { emptyWorkspace, type Workspace } from "../../src/lib/domain/types";
import { DATASETS, type Dataset } from "../../src/lib/domain/catalog";
import { executeCommand } from "../../src/lib/domain/execute";
import { previewCSV } from "../../src/lib/domain/csv";
import { importPreview, saveRecord } from "../../src/lib/domain/mutations";
import { commandSchema } from "../../src/lib/domain/commands";
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
      if (path === "/api/agents") {
        const company = state.records.find((r) => r.id === data.companyIds[0])!;
        if (data.agent === "signals") state.revisions.push(revision(company));
        else {
          const product = state.records.find((r) => r.id === data.productId)!;
          if (!product) throw new Error("Produto obrigatório");
          const message = {
            subject: "Conversa sobre " + product.data.name,
            body: "Mensagem original de teste para a equipe.",
            rationale:
              "Proposta do produto selecionado: " +
              product.data.value_proposition,
            evidenceIds: [company.id, product.id],
            warnings: [],
            productId: product.id,
            contactId: null,
            channel: data.channel,
          };
          state.revisions.push(
            revision(company, {
              type: "message",
              changes: [],
              message,
              originalMessage: structuredClone(message),
            }),
          );
        }
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
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: /Empresa isolada E2E.*alterações propostas/ })
    .click();
  await page.getByRole("button", { name: "Aprovar revisão inteira" }).click();
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
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: /Empresa isolada E2E.*Mensagem de abordagem/ })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Mensagem", { exact: true })
    .fill("Mensagem editada pelo usuário.");
  await page
    .getByRole("button", { name: "Aprovar mensagem", exact: true })
    .click();
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
