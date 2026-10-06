# Dicionário de implementação

As 9 abas ativas e seus 69 campos de importação são representados pelo catálogo e por views SQL tipadas. Não há dados da planilha neste documento nem nos modelos CSV.

## Prospects → companies

| Cabeçalho original | Campo estruturado   | Tipo      | Obrigatório |
| ------------------ | ------------------- | --------- | ----------- |
| ID Empresa         | `external_id`       | Texto     | Sim         |
| Empresa            | `name`              | Texto     | Sim         |
| Domínio fictício   | `domain`            | Texto     | Não         |
| Segmento           | `segment`           | Texto     | Não         |
| Colaboradores      | `employees`         | Inteiro   | Não         |
| UF                 | `state`             | Texto     | Não         |
| RH estruturado     | `structured_hr`     | Categoria | Não         |
| Multi-região       | `multi_region`      | Categoria | Não         |
| Sinal crescimento  | `growth`            | Categoria | Não         |
| Employer branding  | `employer_branding` | Categoria | Não         |
| Dor retenção       | `retention_pain`    | Categoria | Não         |
| Renovação provável | `renewal`           | Categoria | Não         |
| Fonte permitida    | `permitted_source`  | Texto     | Não         |
| Status             | `operating_status`  | Categoria | Não         |

Campos adicionais do aplicativo: `commercial_status` (Status comercial), `benefits_fit` (Benefícios aderentes), `operates_brazil` (Operação no Brasil), `renewed_24_months` (Contrato renovado por 24+ meses), `notes` (Notas da equipe).

## Clientes_Atuais → customer_profiles

| Cabeçalho original | Campo estruturado      | Tipo      | Obrigatório |
| ------------------ | ---------------------- | --------- | ----------- |
| ID Empresa         | `company_external_id`  | Texto     | Sim         |
| Empresa            | `company_name`         | Texto     | Não         |
| Segmento           | `segment`              | Texto     | Não         |
| Colaboradores      | `employees`            | Inteiro   | Não         |
| UF                 | `state`                | Texto     | Não         |
| Solução            | `solution_external_id` | Texto     | Sim         |
| Ticket anual       | `annual_ticket`        | Número    | Não         |
| Fit interno        | `internal_fit`         | Categoria | Não         |
| Status             | `customer_status`      | Categoria | Sim         |
| NPS fictício       | `nps`                  | Inteiro   | Não         |

Cada contratação é identificada pela combinação `company_external_id` + `solution_external_id`. A mesma empresa pode ter várias soluções. O campo interno `opportunity_id` vincula a contratação à oportunidade ganha original, sem ser uma coluna do CSV. O vínculo é calculado pelo servidor, e os IDs anteriores são preservados em registros legados.

## Decisores_Canais → contacts

| Cabeçalho original     | Campo estruturado     | Tipo      | Obrigatório |
| ---------------------- | --------------------- | --------- | ----------- |
| ID Empresa             | `company_external_id` | Texto     | Sim         |
| Empresa                | `company_name`        | Texto     | Não         |
| Cargo provável         | `role`                | Texto     | Não         |
| Contato fictício       | `name`                | Texto     | Não         |
| Tipo canal             | `channel_type`        | Texto     | Não         |
| Canal/contato fictício | `channel`             | Texto     | Não         |
| Origem                 | `source`              | Texto     | Não         |
| Decisor identificado?  | `identified`          | Categoria | Não         |

## Sinais_Publicos → signals

| Cabeçalho original | Campo estruturado     | Tipo      | Obrigatório |
| ------------------ | --------------------- | --------- | ----------- |
| ID Empresa         | `company_external_id` | Texto     | Sim         |
| Empresa            | `company_name`        | Texto     | Não         |
| Tipo sinal         | `signal_type`         | Texto     | Não         |
| Evidência fictícia | `evidence`            | Texto     | Não         |
| Força              | `strength`            | Categoria | Não         |
| Data               | `date`                | Data      | Não         |
| Fonte              | `source`              | Texto     | Não         |
| URL fictícia       | `url`                 | Texto     | Não         |

## Portfolio → products

| Cabeçalho original       | Campo estruturado   | Tipo  | Obrigatório |
| ------------------------ | ------------------- | ----- | ----------- |
| ID                       | `external_id`       | Texto | Sim         |
| Solução fictícia         | `name`              | Texto | Sim         |
| Categoria                | `category`          | Texto | Não         |
| Problema resolvido       | `problem`           | Texto | Não         |
| Proposta de valor        | `value_proposition` | Texto | Não         |
| Perfil típico            | `ideal_profile`     | Texto | Não         |
| Faixa de ticket fictícia | `ticket_range`      | Texto | Não         |

## Oportunidades_Historico → opportunities

| Cabeçalho original | Campo estruturado      | Tipo      | Obrigatório |
| ------------------ | ---------------------- | --------- | ----------- |
| ID Oportunidade    | `external_id`          | Texto     | Sim         |
| ID Empresa         | `company_external_id`  | Texto     | Sim         |
| Empresa            | `company_name`         | Texto     | Não         |
| Solução            | `solution_external_id` | Texto     | Sim         |
| Resultado          | `outcome`              | Categoria | Sim         |
| Ciclo (dias)       | `cycle_days`           | Inteiro   | Não         |
| Ticket estimado    | `estimated_ticket`     | Número    | Não         |
| Motivo/Status      | `reason`               | Texto     | Não         |
| Sponsor/Decisor    | `sponsor`              | Texto     | Não         |
| Origem             | `source`               | Texto     | Não         |

Campos adicionais do aplicativo: `sponsor_contact_id` (Pessoa patrocinadora vinculada).

## ICP_Criterios → icp_criteria

| Cabeçalho original | Campo estruturado | Tipo   | Obrigatório |
| ------------------ | ----------------- | ------ | ----------- |
| Critério           | `criterion`       | Texto  | Sim         |
| Regra fictícia     | `description`     | Texto  | Não         |
| Peso (%)           | `weight`          | Número | Não         |
| Justificativa      | `rationale`       | Texto  | Não         |

## Regras_Score_Exemplo → commercial_rules

| Cabeçalho original | Campo estruturado | Tipo   | Obrigatório |
| ------------------ | ----------------- | ------ | ----------- |
| ID                 | `external_id`     | Texto  | Sim         |
| Critério fictício  | `criterion`       | Texto  | Não         |
| Peso máximo        | `weight`          | Número | Não         |
| Racional           | `rationale`       | Texto  | Não         |

## Desqualificadores → disqualifiers

| Cabeçalho original | Campo estruturado | Tipo  | Obrigatório |
| ------------------ | ----------------- | ----- | ----------- |
| ID                 | `external_id`     | Texto | Sim         |
| Condição           | `condition`       | Texto | Não         |
| Motivo             | `reason`          | Texto | Não         |
| Ação               | `action`          | Texto | Não         |

## Relações e auditoria

`records.company_id` aponta para uma empresa; `product_id`, para um produto; `contact_id`, para o contato explicitamente vinculado à oportunidade. Chaves estrangeiras e validação de tipo/empresa protegem as relações.

Registros mantêm ID interno, identificador original, versão, criação, atualização, origem integral de cada importação e proveniência dos campos alterados. A tabela `workspace_entries` guarda regras versionadas, avaliações, listas, revisões, execuções, auditoria e lotes. `score_history` preserva as avaliações anteriores com versões e evidências.

Os campos de texto mantêm seu conteúdo descritivo; números e datas têm representação operacional e valor bruto no CSV original. Células vazias e a frase completa “Não identificado” são `null`, ignorando maiúsculas, acentos e espaços extras. Zero é `0` e “Não” permanece uma resposta válida. “Não informado” não é um marcador adicional. O texto bruto original fica preservado na origem das linhas importadas.

`annual_ticket` e `estimated_ticket` aceitam valores como `R$ 60.000,50` e armazenam `60000.5`. `commercial_status` é calculado a partir das contratações: alguma ativa determina Cliente ativo; sem ativas e com Churn, Ex-cliente; sem contratações, Prospect. Oportunidades ganhas criam/reativam contratações. Importar uma contratação vincula ou cria a venda ganha da mesma empresa e solução. Churn preserva o resultado histórico da venda.

O ticket anual avaliado soma as contratações ativas e fica indisponível quando faltar o valor de alguma delas. Fit e NPS somente são utilizados quando os valores disponíveis são consistentes entre as contratações consideradas.

Contatos sem nome nem canal são ignorados na importação. Nome presente identifica uma pessoa; apenas canal presente identifica um canal institucional. `ImportRow.status` inclui `ignored`; `Preview.counts.ignored` informa essas linhas. O lote mantém `ignored` e inclui ignorados em `skipped`, junto com repetidos.

As migrações históricas e os dados já armazenados são preservados. O servidor exclui os quatro conjuntos aposentados e seus lotes da projeção ativa, sem apagar registros no banco.
