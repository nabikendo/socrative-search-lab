# Auditoria do MVP Atlas

Data da auditoria: 8 de novembro de 2026.

## Correções aplicadas nesta rodada

- O aluno agora encontra automaticamente a única prova aberta. Antes, a tela usava o ID fixo `demo`, então uma prova com outro ID não podia ser iniciada.
- O importador de frequência agora aceita linhas com espaço, vírgula, ponto e vírgula ou tabulação, além de remover BOM de CSV.
- O painel de respostas em tempo real foi validado com o fluxo de salvar resposta e consultar o endpoint administrativo.
- O PDF.js foi fixado na versão `5.4.149`, evitando que uma atualização automática de faixa instale a versão indicada pelo `npm audit` como vulnerável a execução de JavaScript ao abrir PDF malicioso. Ainda assim, somente arquivos confiáveis da escola devem ser utilizados.
- O cadastro de frequência passou a aceitar XLSX; sessões agora usam token aleatório depois do início; o aluno envia heartbeat; o painel indica online/desconectado; e cada gravação mantém backup atômico.
- Foram adicionados pesos por questão e nota manual para respostas discursivas.

## Bugs e riscos que permanecem

### Alta prioridade — corrigir antes de avaliação oficial

1. **Não há autenticação.** Qualquer dispositivo na LAN que conheça a API pode cadastrar alunos, alterar provas, salvar respostas ou baixar resultados. Para um piloto controlado é aceitável, mas uma avaliação real precisa de código de turma/prova, token aleatório de sessão e senha ou PIN do professor.

2. **A rede local não é um modo offline completo.** O MVP funciona sem Internet, mas depende do Wi-Fi local e do notebook estarem ativos. Não há fila no navegador, IndexedDB, retry ou recuperação quando o servidor fica momentaneamente indisponível. Uma queda do roteador pode deixar respostas ainda não salvas.

3. **Persistência em JSON ainda não substitui SQLite.** A escrita agora usa arquivo temporário, `rename` e cópia em `data/backups`, mas ainda não há consultas transacionais ou tela de restauração. O próximo passo deve ser SQLite.

4. **HTML inserido de respostas/documentos precisa de endurecimento.** O painel usa conteúdo recebido do servidor para montar cards e o DOCX convertido é inserido como HTML. Em uma rede controlada o risco é menor, mas nomes, respostas e documentos devem passar por escaping/sanitização e a aplicação deve usar uma Content Security Policy.

5. **Sessões ainda podem ser iniciadas usando somente o número.** Depois do início, respostas, heartbeat e envio exigem token aleatório. Ainda falta PIN/código de turma e confirmação explícita do nome para impedir que alguém inicie a sessão de outro aluno.

### Média prioridade — corrigir para operação mais robusta

6. **Upload usa Base64 em JSON.** Isso aumenta o tamanho do arquivo em cerca de um terço e mantém cópias grandes na memória. Para provas com muitas figuras, usar `multipart/form-data` ou upload em streaming.

7. **Prova e documento são salvos em etapas separadas.** Se a prova for salva e a conversão do DOCX falhar, o professor pode ficar com uma prova sem documento. Adicionar estado `uploading/ready/error`, retry e limpeza de anexos incompletos.

8. **Exportação de múltiplas provas exige cuidado.** IDs de questão como `q1` são gerados novamente em cada prova. O exportador detalhado deve usar `examId + questionId` para não misturar Q1 de provas diferentes quando várias avaliações forem aplicadas no mesmo arquivo.

9. **PDF/DOCX não têm validação completa de tipo.** O servidor deve verificar assinatura do arquivo, extensão, tamanho e conteúdo antes de armazenar. Não basta confiar no MIME enviado pelo navegador.

10. **Correção é parcial.** O gabarito automático, pesos e nota manual já existem. Ainda faltam rubrica, revisão e histórico de alterações.

11. **O aluno não tem uma etapa explícita de confirmação.** O nome é mostrado junto com a prova. Para reduzir erro de identificação, incluir uma tela “Você é [nome]? Confirmar / Voltar”.

## Funcionalidades recomendadas

### P0 — segurança e confiabilidade

- autenticação/PIN do professor;
- código ou QR da turma e da prova;
- PIN do professor e token individual de sessão;
- botão para fechar e reabrir a prova;
- limite de horário e tempo restante;
- SQLite transacional;
- restauração de backup em pendrive;
- fila local com IndexedDB, retry e indicador “pendente de sincronização”;
- sanitização de HTML e Content Security Policy;
- validação real de PDF/DOCX.

### P1 — uso pedagógico

- pré-visualização e correção da lista de frequência antes de publicar;
- pré-visualização e correção da lista XLSX;
- banco de questões com tags, busca e duplicação;
- várias turmas e provas simultâneas;
- nota por habilidade e rubrica;
- relatórios por aluno, turma e questão;
- alertas de aluno desconectado ou sem resposta por muito tempo (o primeiro já está disponível);
- impressão de cartões de acesso com número/QR.

### P2 — acessibilidade e escala

- contraste alto, navegação por teclado e leitor de tela;
- tempo extra individual;
- zoom e modo de leitura simplificado;
- suporte a imagens com descrição alternativa;
- sincronização posterior com a nuvem, com resolução de conflitos;
- logs de auditoria;
- múltiplos professores e permissões por turma.

## Próxima sequência recomendada

1. Implementar PIN/código da prova e tokens de sessão.
2. Migrar a persistência para SQLite e criar backup automático.
3. Implementar fila IndexedDB com retry e tela de sincronização.
4. Corrigir escaping/sanitização e adicionar CSP.
5. Adicionar correção manual e exportação XLSX real.
6. Testar com a quantidade real de Chromebooks do laboratório, sem Internet, incluindo desligamento/reinício do notebook.

## Validações executadas

- `npm run build` — passou.
- `node --check server.mjs` — passou.
- fluxo de ponta a ponta — passou: cadastrar lista, abrir prova, iniciar aluno, salvar resposta, enviar e exportar CSV.
- endpoint de respostas em tempo real — passou.
- conversão DOCX para HTML — passou.
- exportação detalhada com nota e respostas — passou.
- `npm audit --omit=dev` — o PDF.js foi fixado em `5.4.149` após a auditoria reportar uma vulnerabilidade na faixa automática mais recente; repetir o comando após cada atualização de dependências.
