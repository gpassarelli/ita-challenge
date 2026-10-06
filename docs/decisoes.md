# Decisões de implementação

- **Nove conjuntos ativos.** O catálogo único orienta importação, validação, formulários e projeções SQL; os dados originais permanecem nas origens de cada registro.
- **Um workspace compartilhado.** Configurações globais e listas comuns a usuários autenticados. Não há multiempresa vendedora nem isolamento por tenant nesta versão.
- **Preservação antes de inferência.** CSV não transforma texto descritivo em regra executável e não liga registros por nome. “Churn” permanece como valor original.
- **Dois motores separados.** ICP e prioridade usam o mesmo avaliador determinístico, com conjuntos/versionamento independentes.
- **Evidência por campo.** Cadastro manual, CSV e revisão aprovada têm proveniências distintas. A interface de revisão mostra o snapshot usado pelo agente.
- **Revisão integral.** Propostas de dados são aplicadas por inteiro ou recusadas. A versão da empresa também muda ao alterar sinais, contatos, dados comerciais e oportunidades, impedindo aprovações obsoletas.
- **Mensagens sem envio.** O texto original e a edição humana são preservados; aprovação não modifica a empresa nem o Kanban.
- **Transação com versão global.** Adequada ao hackathon, facilita a atomicidade de revisão + recálculo + auditoria. Mutação concorrente reexecuta sobre snapshot atual; a versão do registro continua sendo conferida.
- **Durabilidade de execução.** O Workflow grava o progresso; o banco mantém execução, entradas, modelo, versão, horários e resultado por empresa. Limite global de um lote e três empresas simultâneas.
- **Erros sem gravação parcial.** Importações com qualquer conflito não são aplicadas. Erros do provedor geram estado de falha por empresa e podem ser tentados novamente em uma nova execução.
- **Sem dados de demonstração.** Modelos CSV contêm somente cabeçalhos. Fixtures de teste permanecem fora do aplicativo e do Supabase.
- **Referências aposentadas sem limpeza retroativa.** A interface e novas operações usam nove conjuntos; as quatro referências antigas permanecem arquivadas no banco, fora do snapshot ativo.
- **Ausência explícita.** Somente células vazias e “Não identificado” são normalizadas para null. Canais institucionais são preservados; linhas sem nome nem canal são ignoradas.
- **Separar venda e contratação.** Oportunidades registram resultados históricos; contratações registram status ativo/Churn por empresa e solução. A empresa é cliente ativo se existir alguma contratação ativa. Clientes importados geram ou vinculam uma oportunidade ganha sem inventar datas. Ganhar uma venda cria ou reativa a contratação; Churn não altera o resultado da venda.
- **Múltiplas soluções sem duplicatas.** A identidade da contratação é empresa + solução. Reimportações reconhecem também as chaves antigas. O vínculo com a oportunidade é interno e validado pelo servidor. Tickets preservam os centavos; a importação exige produto existente.

- **Critérios com fontes alternativas.** Empresa, pessoa e sinal podem atender ao mesmo critério por OU, usando o maior resultado. Filtros de pessoas e sinais são combinados por E no mesmo registro e vinculados por ID da empresa. Não há soma por quantidade de evidências. Pessoas precisam ter nome e não estar bloqueadas.
- **Pontuação fixa e cobertura independente.** Ausência vale zero para todos os critérios; pesos ativos somam 100. Cobertura informa os pesos avaliáveis, sem normalizar a nota. Recência usa janela inclusiva, força mínima ordenada e rejeita datas futuras ou inválidas. A versão 2 do cálculo provoca recálculo na próxima consulta, preservando histórico e regras antigas em JSON, sem nova migração SQL.
