# Workflows e revisões

## Plano atualizado

- Separar a navegação em Workflows (execuções e seus resultados) e Revisões (fila por empresa com painel de decisão).
- Substituir o painel lateral de execuções por páginas dedicadas. Atalhos das empresas e dos agentes selecionam a execução ou revisão correta.
- Mostrar todas as revisões geradas no workflow sem precisar expandir os diagnósticos de cada empresa.
- Mover automaticamente revisões aprovadas ou recusadas para Arquivadas, derivando o arquivo do status de decisão. Manter histórico, evidências, conteúdo e auditoria. Arquivar uma execução não controla o arquivo de suas revisões.
- Na fila pendente, após salvar a decisão, selecionar a próxima revisão da mesma empresa e depois de outra empresa. Manter filtros por decisão no arquivo e busca por nome da empresa.
- Preservar rascunhos de mensagens e observações durante atualizações e navegação. Limpar rascunhos após decisão confirmada, inclusive por outro usuário.
- Preservar aprovação integral, bloqueio de propostas desatualizadas, motivo obrigatório para recusa, cancelamento, repetição de falhas e regras de arquivamento das execuções.
- Em celular, alternar lista e detalhes com botão Voltar. Não alterar APIs ou banco de dados.

## Verificação

Cobrir agrupamento entre execuções, arquivo automático, avanço da fila, filtros, histórico de execuções arquivadas, rascunhos, erros ao salvar, propostas desatualizadas e navegação desktop/celular. Executar tipos, testes de domínio, testes de navegador e build de produção.
