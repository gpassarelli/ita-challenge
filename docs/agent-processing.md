# Ativação e medição dos lotes

A implementação mantém Vercel Workflow e Supabase Postgres. Não cria outro agendador, fila ou serviço em produção. O padrão passa a ser oito empresas simultâneas com reposição contínua de vagas; apenas um lote fica ativo por workspace.

## Ativação

1. Aguarde os workflows antigos terminarem ou cancele-os pelo painel antes de trocar a versão. Os checkpoints antigos contêm a assinatura anterior das etapas.
2. Em instalações existentes, aplique `supabase/migrations/202610100001_agent_processing.sql` no SQL Editor do projeto, após as migrações anteriores. Instalações novas usam `supabase/setup.sql`. A migração não altera empresas ou revisões históricas; adiciona funções e índice. As funções só podem ser chamadas pelo `service_role`.
3. Configure `AGENT_CONCURRENCY=8` (1–16) e `AI_ATTEMPT_TIMEOUT_MS=60000` (1.000–300.000 ms). Reinicie o servidor. Cada novo lote registra sua configuração; mudar o ambiente não muda um lote em andamento.
4. Rode typecheck, testes e build antes de publicar. Localmente, mantenha o servidor ativo e preserve `.workflow-data/`. Na Vercel, siga as instruções de publicação do README para usar o armazenamento durável do provedor.
5. Comece com um lote pequeno. Confirme preparação, geração, validação, gravação e revisão humana. Teste cancelamento e repetição somente das falhas antes de usar 120 empresas.

A migração foi validada em PostgreSQL local via PGlite, mas não foi aplicada ao projeto remoto nesta entrega: não havia uma sessão SQL utilizável. Não ative o novo processamento antes de aplicar a migração.

## Medir 120 empresas

Compare lotes de 120 empresas semelhantes, primeiro com concorrência 4 e depois com 8, usando o mesmo modelo e prazo. Como uma revisão de dados pendente bloqueia outra análise, use conjuntos separados comparáveis ou conclua a revisão humana antes de repetir; não apague resultados para medir.

Registre duração total desde a solicitação, espera na fila, tempo de processamento por empresa, p50/p95 das etapas, sucessos, falhas por código, tentativas e tokens. Os eventos `agent_generation`, `database_operation` e `agent_batch` incluem IDs, duração e contadores sem respostas ou credenciais. O painel mostra vagas ativas, fila e empresas finalizadas/minuto. Compare os eventos da base para confirmar que cada preparação lê somente o contexto da empresa e cada gravação transmite apenas os itens alterados.

Critérios: sem duplicação de revisão, sem perda de progresso de outra empresa, sem geração após cancelamento, no máximo duas chamadas por empresa, nenhuma repetição de IA causada por falha ao salvar. Meça a meta de 15 minutos com o provedor real antes de declará-la atingida. O teste automatizado com 120 empresas valida agendamento com IA simulada; não mede latência ou limites reais da conta.

Se aumentarem os erros 429, reduza a concorrência e confira as quotas da conta. O workflow respeita `Retry-After`, acrescenta jitter e pausa novas chamadas do lote enquanto o cooldown estiver ativo. Chamadas que já começaram podem terminar normalmente. Um timeout continua tendo apenas uma nova tentativa. Uma resposta inválida recebe uma única tentativa corretiva, com nomes/opções permitidos do catálogo, sem copiar valores rejeitados. Erros de configuração e autenticação encerram a empresa.

## Infraestrutura

| Opção                             | Uso e consequência                                                                                                                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow local atual              | Desenvolvimento e medição; depende de servidor ativo e armazenamento local preservado.                                                                                                                                                                                     |
| Workflow na Vercel                | Próximo passo recomendado para hospedar o runtime existente; mantém checkpoints, espera durável e etapas separadas de geração/gravação. Exige implantação e validação das quotas reais.                                                                                    |
| Supabase Queues + consumidores    | Alternativa se a medição exigir outro runtime. Uma mensagem por empresa, consumidor com prazo limitado, janela de visibilidade maior que processamento, reentrega e gravação idempotente. Exige implementar claim, heartbeat, recuperação, cancelamento e observabilidade. |
| Edge Function com background task | Responde imediatamente, mas mantém limites de duração do worker; não executa um lote longo de 120 empresas numa única invocação. Use para unidades pequenas com fila durável.                                                                                              |

[Workflow: deployment](https://workflow-sdk.dev/docs/deploying) descreve os runtimes. [Supabase Queues](https://supabase.com/docs/guides/queues) persiste mensagens em Postgres; a garantia dentro da janela de visibilidade não elimina a necessidade de efeitos idempotentes após reentrega. [Background Tasks](https://supabase.com/docs/guides/functions/background-tasks) permite `waitUntil`, mas os [limites de Edge Functions](https://supabase.com/docs/guides/functions/limits) continuam aplicáveis: 150 segundos de worker no plano gratuito e 400 segundos nos pagos, com 2 segundos de CPU por requisição e idle timeout de 150 segundos. Verifique esses limites novamente antes de uma migração de runtime.

## Reversão

Se a versão nova tiver problemas, interrompa os lotes novos e volte à versão anterior do aplicativo com os workflows já encerrados. As funções adicionais podem permanecer no banco: preservam as funções antigas e o protocolo de versão global. Não remova checkpoints ou revisões para tentar recuperar uma execução; use reconciliação e repetição das falhas.
