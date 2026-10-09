# Allya — MVP de prospecção

Aplicativo em **pt-BR**, com tabelas inspiradas no Clay, dois agentes e revisão humana. A base começa vazia: não há produtos, empresas, regras comerciais, listas ou usuários pré-carregados. A planilha de referência não é importada pelo aplicativo.

## Rodar

Recomendado: Node.js 24 e npm. Na pasta do projeto:

```bash
npm ci
npm run dev
```

Abra [localhost:3000](http://localhost:3000). Sem as variáveis de Supabase, a interface abre vazia e informa como conectar. Com Supabase configurado, o acesso exige e-mail e senha.

Copie `.env.example` para `.env.local` **apenas se ainda não existir configuração local**. Não sobrescreva um `.env` ou `.env.local` já configurado.

| Variável                               | Uso                                                          |
| -------------------------------------- | ------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | URL do projeto Supabase                                      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave pública do projeto                                     |
| `SUPABASE_SERVICE_ROLE_KEY`            | Chave administrativa, exclusivamente no servidor             |
| `OPENAI_API_KEY`                       | Chave da API OpenAI, exclusivamente no servidor              |
| `AI_SIGNALS_MODEL`                     | Modelo OpenAI com saída estruturada para analisar sinais     |
| `AI_OUTREACH_MODEL`                    | Modelo OpenAI com saída estruturada para preparar abordagens |

Cada agente exige um modelo explícito; não existe um modelo padrão silencioso. Use identificadores nativos da OpenAI, sem prefixo de gateway (`openai/`). O login do aplicativo usa Supabase Auth. As chamadas aos agentes usam diretamente a API OpenAI via Vercel AI SDK.

Em instalações existentes, substitua `OPENAI_MODEL` por `AI_SIGNALS_MODEL` e `AI_OUTREACH_MODEL` no ambiente local e na hospedagem. Para manter o comportamento anterior, configure ambos com o valor antigo. A variável antiga não é mais lida. A execução valida a chave e o modelo do agente selecionado; o indicador geral de IA pronta exige a chave e os dois modelos. Reinicie o servidor após alterar a configuração.

## Ativar o Supabase

1. Abra o SQL Editor do projeto Supabase.
2. Execute **uma vez**, em uma base nova, o conteúdo de [supabase/setup.sql](supabase/setup.sql). Ele contém todas as migrações em uma transação. Alternativamente, aplique os arquivos de `supabase/migrations/` em ordem; não execute as duas opções.
3. Em **Authentication → Providers**, habilite e-mail e senha. Desative o cadastro público para manter o acesso restrito à equipe.
4. Em **Authentication → Users**, crie as contas autorizadas. Não existe uma conta de demonstração.
5. Configure as variáveis e reinicie o servidor local.

As migrações criam somente a estrutura e um controle técnico de versão vazio. Nenhum dado da planilha é inserido.

Em uma base já instalada que ainda não recebeu a atualização, aplique somente a [migração de contratações e portfólio](supabase/migrations/202610040001_contracts_portfolio.sql). Ela acrescenta campos às projeções SQL, sem modificar registros existentes. O aplicativo usa os registros canônicos, sem depender dos novos campos das views.

Antes de executar esta versão, aplique [202610090001_workspace_patch.sql](supabase/migrations/202610090001_workspace_patch.sql). A migração adiciona gravações parciais e leitura de uma execução; mantém a transação, as validações e as permissões existentes. Não há fallback para gravação integral: uma migração ausente produz um diagnóstico de configuração. Novas instalações já incluem essa atualização em `supabase/setup.sql`.

Todos os usuários autenticados participam do mesmo workspace, com regras e listas compartilhadas. As tabelas têm RLS: usuários leem os registros; as gravações passam pelo servidor autenticado e pela função transacional. Não há controle de permissões por cargo neste MVP.

### Estado da conexão verificado em 04/10/2026

As duas migrações iniciais foram aplicadas em uma transação ao projeto Supabase configurado no `.env`, pelo SQL Editor. Na instalação inicial, a função `read_workspace` e as 13 views responderam corretamente, com a base comercial vazia, e o login com a conta existente do Supabase Auth foi validado no navegador.

A migração `202610040001_contracts_portfolio.sql` também foi aplicada em uma transação ao projeto **G2 Allya** (`mayopdevaxmqftwwzlcp`), em 04/10/2026. A verificação após a aplicação confirmou `customer_profiles.opportunity_id`, `opportunities.solution_external_id` e a leitura de `read_workspace`. Os **544 registros** existentes mantiveram a mesma contagem e a mesma assinatura de conteúdo antes e depois da migração. As três migrações locais estão aplicadas nesse projeto; não execute a instalação inicial novamente. Os passos acima continuam válidos para uma base nova.

A validação de origem usa o host recebido pelo servidor, incluindo a porta e os cabeçalhos de encaminhamento, para aceitar `localhost` mesmo quando o Next.js escuta em `0.0.0.0`. Origens externas continuam bloqueadas com HTTP 403. Em hospedagem com proxy reverso, ele deve sobrescrever `X-Forwarded-Host` e `X-Forwarded-Proto` com os valores da requisição pública.

A publicação Vercel e as chamadas reais aos agentes OpenAI não foram realizadas nesta verificação.

## Entrada dos dados

Há um importador e um modelo CSV vazio para cada uma das **9 abas ativas**. Os modelos também estão em [modelos-csv/](modelos-csv/). Todos os cabeçalhos originais estão documentados em [docs/dados.md](docs/dados.md).

- CSV UTF-8, com vírgula ou ponto e vírgula; suporta campos entre aspas e quebras de linha.
- Importe **Empresas** e **Portfólio** antes dos arquivos que apontam para esses cadastros.
- As relações usam identificadores exatos. Nome parecido nunca cria associação.
- A prévia mostra todas as colunas, erros, duplicidades, conflitos e linhas ignoradas. Um erro impede o lote inteiro; contatos sem nome nem canal são ignorados sem impedir as demais linhas.
- O limite local é 5 MB e 5.000 linhas por arquivo. Em hospedagem com limite de requisição menor, use arquivos menores.
- O conteúdo original das linhas importadas, arquivo, linha física, lote, usuário e horário são preservados.
- Células vazias e a frase completa “Não identificado” viram `null`, ignorando maiúsculas, acentos e espaços extras. “Não informado” e outros textos mantêm o comportamento anterior; zero e “Não” continuam sendo valores.
- Tickets aceitam reais brasileiros, como `R$ 60.000,50`, e são armazenados como números (`60000.5`), com centavos preservados.
- Linhas iguais são reconhecidas sem duplicar o registro; valores divergentes para o mesmo identificador exigem correção explícita.
- Os cadastros manuais apresentam todos os campos.
- XLSX não é aceito.

**Vendas e contratações têm estados diferentes.** A oportunidade acompanha a venda de uma solução do portfólio: Em negociação, Ganha ou Perdida. A contratação (`Clientes_Atuais`) guarda o relacionamento por **empresa + solução**, com ticket anual, fit, NPS e status Cliente ativo ou Churn. Uma empresa pode contratar várias soluções.

- Ao ganhar uma oportunidade, o app cria uma contratação ativa ou reativa a contratação existente da mesma solução. Uma nova contratação usa o ticket estimado da venda como valor inicial, editável na contratação. Ganhar outra venda não duplica a contratação nem sobrescreve seu ticket já informado.
- Importar clientes atuais cria a contratação com o status original e vincula a primeira oportunidade ganha existente da mesma empresa/solução; se não houver, cria uma venda histórica ganha com o ticket anual informado. Não inventa data, ciclo ou patrocinador. Reimportar o mesmo arquivo não duplica contratos nem vendas.
- Churn altera o status da contratação e preserva a oportunidade ganha. Editar anotações da venda não reativa um contrato encerrado. A empresa é **Cliente ativo** enquanto houver ao menos uma contratação ativa; sem ativas e com Churn, **Ex-cliente**; sem contratações, **Prospect**.
- Empresa, solução e resultado da oportunidade que originou uma contratação ficam protegidos; cancelamentos são registrados na contratação. Empresa e solução da contratação também não mudam: outra solução representa outra contratação.
- A coluna **Solução** é obrigatória em clientes e oportunidades e recebe o ID de um produto previamente cadastrado. O CSV de oportunidades ganhou essa coluna: baixe o modelo atualizado.

As novas regras valem para importações e alterações futuras. Nenhuma limpeza retroativa é executada. Os quatro conjuntos de referências foram retirados da interface e das APIs de cadastro/importação; registros e lotes antigos continuam arquivados no banco, fora do workspace ativo.

## Fluxos disponíveis

- **Empresas:** busca, filtros, seleção, ordenação, colunas, notas e painel com todos os campos, histórico, notas calculadas, contatos, sinais, oportunidades, mensagens e revisões.
- **Pessoas e canais:** pessoas nomeadas e canais institucionais, relacionados por ID e identificados por etiquetas distintas. Canais genéricos continuam disponíveis para abordagem à equipe, mas não contam como decisores identificados nem podem ser novos patrocinadores nominais.
- **Sinais:** evidência, força, data, fonte e URL; filtro de força e acesso à empresa.
- **Portfólio:** cadastro, edição e importação de produtos com proposta de valor.
- **Oportunidades:** tabela e Kanban com produto e situação da contratação. Cada mudança de etapa registra usuário, horário e resultado anterior. Patrocinador pode continuar como texto ou receber um vínculo explícito com uma pessoa nomeada da mesma empresa.
- **Contratações:** clientes por empresa e solução, com ticket, filtro Cliente ativo/Churn e navegação para a oportunidade de origem e o produto do portfólio.
- **Listas:** filtros combinados por E, ordenação principal e desempate, atualização com os dados.
- **Configurações:** ICP, prioridade comercial e desqualificadores, com versões e rascunhos.
- **Revisões:** decisões sobre dados e mensagens, justificativa, evidências preservadas da análise e indicadores de aprovação com/sem edição e recusa.

Divergências entre os dados comerciais importados e o cadastro da empresa continuam sinalizadas sem sobrescrita.

## Pontuação

As regras começam vazias. Descrições importadas não são executadas automaticamente. Cada critério tem peso, justificativa e alternativas de **Empresa**, **Pessoa** ou **Sinal**. Conjuntos ativos de ICP e prioridade comercial precisam somar 100 pontos e mantêm configurações independentes.

```text
Pontos do critério = peso × maior resultado entre suas alternativas
Nota ICP = soma dos pontos obtidos
Prioridade comercial = soma dos pontos obtidos − penalidades
```

As notas ficam entre 0 e 100, sobre um total fixo de 100 pontos. Ausência de dados vale zero, sem retirar o peso do total. Por exemplo: 40 pontos comprovados e 60 sem dados resultam em 40/100, com cobertura de 40%. Sem regras ativas, a nota mostra “Não configurado”; com regras e nenhum dado avaliável, mostra 0/100, cobertura 0% e “Sem dados suficientes”. Zero e “Não” são dados avaliáveis; vazio e “Não identificado” são ausências.

Alternativas de um critério são combinadas por **OU**, usando o maior resultado e nunca somando mais que seu peso. Cada pessoa ou sinal precisa atender a todos os filtros **no mesmo registro**. Várias evidências correspondentes não multiplicam os pontos. Critérios separados mantêm seus próprios pesos. A cobertura conta o peso de cada critério uma vez quando existe ao menos uma alternativa avaliável, com os campos exigidos presentes.

- **Empresa:** campos e indicadores existentes, intervalos, valores aceitos, escalas por categoria e histórico de ganhos por segmento.
- **Pessoa:** cargo, identificação como decisor, tipo de canal, origem e presença de canal. Somente pessoas nomeadas da mesma empresa podem pontuar; canais institucionais e contatos bloqueados são excluídos.
- **Sinal:** tipo, fonte, força mínima e recência. Novas alternativas começam com força Alta e 90 dias; a janela aceita entre 1 e 3.650 dias, incluindo o limite. Força Média aceita Médio e Alto, por exemplo. Datas futuras, inválidas ou ausentes não pontuam. Tipos de sinal e cargos têm sugestões do cadastro, sem classificação automática por IA.

Exemplo: “Crescimento”, com peso 20, pode avaliar o crescimento cadastrado na empresa **OU** a existência de um sinal do tipo Expansão, com força Alta, nos últimos 90 dias. Mesmo que ambas as alternativas atendam, o critério rende no máximo 20 pontos. Filtros textuais permitem igualdade, diferença, lista, conteúdo e presença; o campo de canal avalia somente presença.

O ticket anual avaliado é a soma das contratações ativas; se alguma estiver sem valor, a soma fica indisponível. Fit e NPS divergentes entre soluções não são escolhidos arbitrariamente. Desqualificação, bloqueio de canais e penalidade permanecem ações explícitas; penalidades afetam somente a prioridade comercial.

Mudanças de cadastros, regras, sinais, canais e oportunidades recalculam as dependências. A data de avaliação usa America/Sao_Paulo e é atualizada na próxima consulta após a virada do dia. A interface consulta atualizações a cada 30 segundos, ou a cada 4 segundos durante execuções.

Cada avaliação guarda versões dos dados, das regras e do cálculo, instante, contribuições e evidências. A versão 2 do cálculo atualiza avaliações antigas na primeira consulta, mesmo no mesmo dia; o banco preserva o histórico anterior. Regras antigas continuam legíveis e, ao editar, aparecem como uma alternativa equivalente. Não há migração SQL adicional nem sobrescrita dos atributos da empresa a partir dos sinais.

## Agentes e revisão humana

**Agente 1 — Analisar sinais:** executa por empresa ou seleção; propõe alterações somente em atributos de qualificação permitidos, com evidências e contradições. Não escreve notas. Aprovar aplica o conjunto inteiro e recalcula em uma transação. Recusar exige motivo. Uma mudança da empresa ou dos registros relacionados invalida a aprovação de uma revisão pendente. Empresas com revisões de dados pendentes não podem executar uma nova análise de sinais: primeiro aprove ou recuse todas as pendências; revisões desatualizadas devem ser recusadas. Em seleções mistas, apenas as empresas aptas são executadas, com as exclusões identificadas antes do envio e preservadas no lote. Revisões de mensagens não bloqueiam sinais. A validação ocorre no servidor, inclusive antes da inferência e da gravação do resultado.

**Agente 2 — Preparar abordagem:** exige produto e canal; pessoa é opcional. Usa o produto selecionado, dados aprovados, notas, sinais e oportunidades. Gera assunto quando aplicável, mensagem, justificativa e evidências. O usuário pode editar, aprovar, recusar e copiar a mensagem aprovada. **O aplicativo não envia mensagens.**

Cada agente tem seu prompt em destaque no início do arquivo, seguido da versão, da variável de modelo e da função de execução:

- [Analisar sinais](src/lib/server/agents/signals.ts).
- [Preparar abordagem](src/lib/server/agents/outreach.ts).
- [Instruções compartilhadas](src/lib/server/agents/shared.ts): idioma, evidências e tratamento de dados não confiáveis.

A extração preserva os prompts `signals-v1` e `outreach-v1`. Ao mudar as instruções, atualize a versão correspondente para manter a rastreabilidade. `src/lib/server/agent-steps.ts` mantém as etapas de execução, tentativas, auditoria e persistência. Saídas são validadas no servidor. Campos não autorizados, categorias inválidas e evidências fora do contexto são rejeitados. Conteúdo de CSV e sinais é tratado como dados, nunca como instruções.

Vercel Workflow mantém oito empresas em processamento por padrão, reabastecendo cada vaga assim que uma empresa termina. `AGENT_CONCURRENCY` aceita 1–16; `AI_ATTEMPT_TIMEOUT_MS` define o limite total por tentativa (60 segundos por padrão). Apenas um lote fica ativo por workspace. Há no máximo duas chamadas de IA por empresa, sem retries internos do provedor. Entradas, modelo, prompt, tentativas, horários, resultado e decisão ficam registrados. Não há treinamento automático.

### Progresso e diagnóstico

O botão **Execuções**, disponível em todas as páginas, abre um painel à direita que permite acompanhar os agentes e revisar seus resultados. No desktop, o painel permanece aberto enquanto você trabalha na página; no celular, ocupa a tela e pode ser fechado com Escape. Iniciar um agente abre o lote no painel sem mudar de página. A página **Revisões** mantém os filtros, métricas e histórico, além de oferecer acesso ao mesmo painel. A barra mostra a proporção de empresas finalizadas (sucessos + falhas), e não uma estimativa da geração de texto. Abra uma empresa para ver preparação dos dados, resposta da IA, validação e gravação da revisão, com duração, tentativa, modelo e versão do prompt. Lotes parcialmente bem-sucedidos aparecem como **Concluída com falhas**. Execuções anteriores continuam legíveis, mas não recebem etapas retroativas.

Depois que o lote e seus itens terminam e todas as revisões geradas são aprovadas ou recusadas, **Arquivar execução** remove o lote da fila de toda a equipe. Falhas sem revisões pendentes também podem ser arquivadas. O histórico permanece disponível em **Empresa → Execuções**, com as etapas, decisões e dados de auditoria preservados. Empresas excluídas do lote não recebem esse lote em seu histórico. Arquivamento é manual e usa os registros JSON existentes, sem migração adicional.

A tela não sobrepõe consultas de atualização. Se uma consulta falhar, mantém os últimos dados e informa o horário da última atualização; isso não significa que o agente parou. Leituras da base têm limite de 20 segundos e uma repetição em falhas temporárias. Erros distinguem rede/DNS, timeout, credenciais, indisponibilidade e estrutura ausente. A indicação de migrações aparece somente para erros de função, tabela ou coluna ausente.

Os erros exibem operação e código sem expor chaves, prompts, corpos de resposta ou dados internos. Falhas dos agentes ficam associadas à etapa e à tentativa; os IDs de execução e workflow ajudam a localizar os logs. Se a própria base estiver indisponível durante o registro da falha, os detalhes permanecem nos logs do servidor até que o armazenamento volte a responder. O histórico de etapas usa os registros JSON existentes, sem migração SQL adicional.

## Publicar na Vercel

1. Crie ou selecione um projeto Vercel para esta pasta/repositório, com framework **Next.js**.
2. Adicione as seis variáveis acima nos ambientes desejados.
3. Habilite **Enable access to System Environment Variables** nas configurações do projeto; o Workflow usa `VERCEL_DEPLOYMENT_ID` para escolher o armazenamento e a fila duráveis da Vercel.
4. Publique pelo painel ou com `npx vercel deploy`; use `--prod` quando estiver pronto para produção.
5. Configure a URL publicada nas opções de Auth do Supabase.
6. Valide login, gravação, importação pequena e os dois agentes com sua conta.

O plugin `withWorkflow` já está no Next.js. Localmente, as execuções usam `.workflow-data/`; na Vercel, usam a infraestrutura do provedor. A rota `/.well-known/workflow/` é excluída do proxy de sessão do aplicativo.

## Verificação

```bash
npm run typecheck
npm test
npm run test:e2e
npm run build
```

- Testes de domínio: cobertura das abas, tipos, importações, duplicidades, relações, duas notas, cobertura, recência, penalidades, listas, revisões, oportunidades ganhas, valores em reais e idempotência.
- Testes Postgres com PGlite: migrações reais, base vazia, projeções, transação, conflito de versão, relações e permissões.
- Testes de workflow: lote simulado de 120 empresas com oito vagas, reabastecimento contínuo, cooldown, tentativa corretiva, cancelamento e isolamento de falha.
- Testes de interface com Playwright: navegação, celular, formulários, CSV, regras, listas, Kanban e os dois fluxos de revisão.

Os testes usam apenas registros sintéticos em memória. O teste de interface monta o mesmo componente em um ambiente separado na porta 4174, com requisições interceptadas; não é uma rota nem um modo de autenticação do aplicativo. Chamadas a OpenAI e gravações no Supabase não são realizadas pelos testes. O Playwright usa o Chrome instalado.

## Arquitetura e limites do MVP

Next.js + TypeScript + Tailwind + componentes shadcn/Radix + TanStack Table; Supabase Postgres/Auth; Vercel AI SDK/OpenAI; Vercel Workflow SDK.

O armazenamento mantém registros canônicos com campos estruturados em JSONB, chaves estrangeiras reais e **13 views tipadas históricas**, das quais nove correspondem aos conjuntos ativos. As quatro projeções antigas permanecem apenas para compatibilidade e preservação dos arquivos históricos. [docs/dados.md](docs/dados.md) descreve as projeções. Isso permite preservar a origem integral e consultar campos como números, datas e textos em SQL.

Para o volume do hackathon, as operações leem um snapshot do workspace e gravam por comparação de versão em uma transação. Há quatro tentativas de conflito de concorrência, validação de versão por registro e recibos de idempotência. Não é uma arquitetura para bases grandes: paginação no servidor, gravações incrementais e fila por tenant são evoluções posteriores.

A auditoria de dependências encontrou uma cadeia transitiva do adaptador Nest do pacote Workflow envolvendo `http-cache-semantics` (GHSA-ch52-4w7c-c8xp), sem correção publicada na versão consultada. O aplicativo usa o adaptador Next.js; essa cadeia não participa das rotas implementadas. Correções compatíveis de `devalue` e `nanoid` estão fixadas por overrides. Reavalie `npm audit` antes da publicação; a entrega não declara ausência de vulnerabilidades.

### Recuperação de execuções dos agentes

A geração e a gravação são etapas duráveis independentes: uma falha ao salvar não repete a chamada à IA. Cada tentativa de IA tem limite total configurável, de 60 segundos por padrão, sem retries internos do SDK; o workflow permite apenas uma nova tentativa para falhas temporárias (timeout, rede, 429 ou 5xx) ou resposta inválida. Erros de validação recebem feedback limitado aos campos e opções do catálogo. Falhas de configuração e autenticação encerram a empresa. Respostas 429 usam `Retry-After` e cooldown compartilhado; outras falhas temporárias usam espera com jitter. Gravações e leituras da base têm limite de 20 segundos; conflitos recalculam a alteração a partir de uma versão atualizada.

O agente de sinais (`signals-v4`) envia à OpenAI um JSON Schema estrito derivado do catálogo de campos: cada campo tem suas próprias opções, colaboradores exige um inteiro não negativo e UF aceita somente siglas válidas. Valores ausentes usam `null`; campos extras são rejeitados. O mesmo esquema valida a resposta no servidor, que continua conferindo evidências, campos repetidos e regras de revisão humana. As revisões antigas preservam sua versão de prompt e seus valores; nenhuma migração de banco é necessária para essa atualização.

Para uma execução antiga cujo workflow já terminou, envie `POST /api/agents/reconcile` com `{ "id": "ID_DA_EXECUCAO" }` em uma sessão autenticada. A reconciliação não retoma a IA: sincroniza cancelamento, conclusão ou falha com o histórico do workflow. Se o workflow ainda estiver ativo, a resposta informa isso; use o botão **Cancelar execução** para interrompê-lo.

Os logs `database_operation` e `agent_generation` incluem operação, duração, tentativa, código e identificadores, sem prompts, dados comerciais ou credenciais.

O armazenamento local dos checkpoints fica em `.workflow-data/`, fora de `.next/`, para sobreviver aos builds. Ao atualizar uma instalação antiga, com o servidor parado, copie o conteúdo de `.next/workflow-data/` para `.workflow-data/` antes do primeiro build se esse histórico ainda existir. A hospedagem Vercel continua usando o backend durável da plataforma.

### Workspace conflict retry storms

Apply `supabase/migrations/202610090002_workspace_conflict.sql` after the sparse-write migration. Business version conflicts now return `PT409` (HTTP 409), rather than `40001`, which PostgREST can retry indefinitely using the same stale version. The application re-reads current data between at most four attempts with backoff/jitter. Progress-only saves skip scoring recalculation when evaluations are current and skip record relationship scans. Permissions, atomic version checks, relationship checks on record writes, and score history remain in effect.

Database telemetry includes operation, duration, attempt, code and run ID when available, serialized as JSON so development logs retain the timings. A `TIMEOUT` alone does not distinguish database contention from network latency; compare read/save durations and conflict counts before changing database capacity.

### Processamento de lotes

A preparação lê somente a empresa, suas evidências e o produto selecionado. As gravações de progresso mesclam apenas os itens alterados; revisão, auditoria e conclusão são salvas atomicamente. Essas gravações mantêm a versão global sem regravar registros comerciais ou histórico de pontuação. A nova migração **`202610100001_agent_processing.sql` é obrigatória antes de ativar esta versão**.

O painel distingue fila e processamento, mostra vagas ativas e ritmo de finalização e permite **Repetir empresas com falha**. A nova execução mantém a configuração original e exclui empresas com revisão de dados pendente. Resultados bem-sucedidos permanecem no lote anterior.

Veja [docs/agent-processing.md](docs/agent-processing.md) para ativação, medição de 120 empresas e opções de infraestrutura. O teste com 120 empresas usa IA simulada; não comprova o tempo ou os limites da conta OpenAI em produção.
