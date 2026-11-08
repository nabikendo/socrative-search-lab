# Implementação das funcionalidades prioritárias

## Já implementado

O MVP agora inclui importação de lista em XLSX com colunas `número`, `nome` e `turma`; correção manual de respostas discursivas no painel; pesos por questão; várias turmas representadas no cadastro e várias provas identificadas por ID; descoberta automática da prova aberta; token aleatório por sessão; heartbeat do aluno a cada 15 segundos; indicador de aluno online/desconectado após 30 segundos sem contato; e backups atômicos do arquivo local antes de cada gravação.

Para peso, use no editor:

```text
Questão objetiva | A | *B | C || peso=2
Questão discursiva || peso=3
```

O asterisco define o gabarito e `peso=2` define o valor da questão. A correção manual aparece para questões sem gabarito. A planilha detalhada soma acertos objetivos e notas manuais respeitando os pesos.

## Como operar

No painel `/professor`, selecione um `.xlsx` na área de frequência e clique em **Salvar lista**. A planilha deve ter, na primeira linha, `número`, `nome` e, opcionalmente, `turma`. Depois crie a prova com um ID diferente para cada avaliação. O aluno não precisa conhecer o ID: a tela `/prova` busca automaticamente a única prova aberta.

No painel, abra o card do aluno. `online` indica heartbeat recente; `desconectado` indica que o servidor não recebeu contato há mais de 30 segundos. Para respostas discursivas, informe a nota no campo **Nota manual**. Baixe **respostas e notas** após a correção.

## Ainda necessário antes de uma avaliação oficial

Alguns itens da prioridade máxima são estruturais e não devem ser considerados resolvidos apenas por uma primeira implementação: PIN/autenticação do professor, autorização completa de endpoints, fila IndexedDB com retry quando a rede local cai, migração para SQLite, sanitização rigorosa de HTML/CSP, limite de tempo no servidor, upload em streaming e restauração de backup por interface.

O projeto já protege sessões com token e reduz perda por falha de escrita com backup atômico, mas ainda é um MVP para uma rede controlada. Faça um piloto com dados fictícios antes de usar nomes e notas reais.
