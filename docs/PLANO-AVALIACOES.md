# Plano de evolução — Atlas: editor científico, geração de provas, versões, resiliência, análise e cartões ópticos

**Estado:** planejamento e critérios de aceitação, sem implementação funcional nesta branch.
**Base auditada:** `main` / Atlas 1.3.0 em 15/11/2026. **Não modificar, mesclar, instalar ou publicar sobre a versão estável sem homologação.**
**Relacionamento:** PR #3 (`feat/atlas-telas-referencia-20261115`, visual) e PR #4 (`feat/atlas-matrizes-inep-descritores`, matrizes/IA local) ainda são iniciativas separadas. Realizar rebase e resolver conflitos depois de integrar ou explicitamente escolher a base; não duplicar o trabalho dos PRs.

## 0. Auditoria do estado atual — código verificado

| Recurso | Arquivos existentes | Observação |
| --- | --- | --- |
| Modelagem e validação das questões | `shared/exam.js` | Questões `choice/multi/numeric/text`; enunciados com até 2.000 caracteres, alternativas até 500; apenas um `skill` por questão. |
| Banco e turmas | `lib/store.mjs`, `server.mjs` | SQLite `node:sqlite`, WAL/FULL; `question_bank` armazena JSON normalizado; migrações por coluna. |
| Criar/aplicar/print | `src/professor/exam.js`, `src/professor/print.js` | Imprime pelo browser e monta gabarito; não possui modelos impressos A/B/C/D persistentes. |
| Embaralhamento | `shared/shuffle.js` | Determinístico por sessão de aluno, não representa versões físicas A/B/C/D. |
| Resultados | `src/professor/results.js`, `server.mjs` | Notas, habilidade, CSV/XLSX e PDF; faltam análises psicométricas por item. |
| Resiliência | `src/prova.js`, `server.mjs` | Fila de respostas em `localStorage`, heartbeat, restauração de sessão, backup automático. Atenção: algumas respostas rejeitadas por HTTP 4xx são removidas da fila. |
| Atualização Windows | `desktop/main.mjs` | `electron-updater`, `autoInstallOnAppQuit=true`, instalação via `quitAndInstall()` sem verificar provas abertas. |
| CI | `.github/workflows/ci.yml`, `.github/workflows/desktop-windows.yml` | Testes Node 24/26, build Vite, empacotamento Windows e smoke de inicialização. |
| Correção de papel | inexistente | Não há esquema de cartão OMR, mapeamento de versão ou pipeline de imagem. |

## 1. Estratégia de implementação / dependências

P0 **Confiabilidade primeiro** → P1 **Editor científico** → P2 **Gerador de avaliações** → P3 **Versões A/B/C/D e PDF** → P4 **Análise estatística e mapa de aprendizagem** → P5 **OMR por câmera**.

Motivos: o bloqueio de atualização durante provas é requisito de preservação de dados; gerador utiliza metadados do banco; impressos reutilizam formatação científica e gerador; OMR depende de PDFs e versões com posições e gabaritos imutáveis; análise depende de identificadores estáveis dos itens. Marcos independentes podem ser desenvolvidos em paralelo, mas devem chegar ao ramo de integração na ordem das dependências.

**Política de branch:** uma branch `feat/atlas-*` por marco, PR draft separado, branch `integration/atlas-assessments-next` com CI; publicação somente prévia beta após aprovação de todos os portões. Nunca usar tag, commit message ou workflow de publicação estável até homologação. Backup e restauração de banco 1.3.0 devem ser testados antes de qualquer migração.

### P0 — Atualizações seguras e recuperação de sessão (bloqueador de lançamento)

**Mudanças previstas:**
- `desktop/main.mjs`: usar `autoUpdater.autoInstallOnAppQuit=false` durante estado ativo; proteger tanto `quitAndInstall()` quanto saída normal/instalação pendente; consulta persistente ao `store.getOpenExam()` e sessões/pendências (inclui `open`, `paused`, encerramento com respostas locais não confirmadas). Exibir estado "Atualização baixada; instalar após encerrar as provas".
- `server.mjs`: endpoint admin só de leitura `GET /api/system/update-safety` com `safeToInstall`, número de provas abertas/pausadas, sessões pendentes e estado do backup. Não devolver tokens, respostas ou nomes.
- `src/prova.js`: auditoria de fila `atlas.queue.<sessionId>`. Não descartar respostas em erros 4xx sem código conhecido/ação; separar falha permanente e autenticação recuperável. Conciliar respostas confirmadas pelo servidor com a fila em reconexões e trocas de aparelho; preservar recibo de envio.
- `lib/store.mjs`: usar transações e migrações aditivas; garantir que backups são verificados e que reabrir o app mantém provas em andamento. Investigar controle de versões de resposta para evitar sobrescrita por pacote antigo.
- Mensagem explícita de status ("salvo neste aparelho", "confirmado no servidor", "não sincronizado") e opção de recuperação assistida.

**Aceite:** nenhuma ação do atualizador provoca reinício ou perda de respostas enquanto uma prova estiver aberta, pausada ou com respostas não conciliadas. Uma falha de rede/queda abrupta permite restabelecer sessão e identificar precisamente os dados ainda não enviados. Não prometer proteção contra desligamento forçado do Windows; testar reinício real.

### P1 — Editor científico (LaTeX/Química/Física)

**Mudanças previstas:**
- Introduzir módulo `src/lib/scientific-render.js` e editor acessível para enunciado, opções, explicações e gabaritos; prévia instantânea no professor e aluno.
- Proposta: KaTeX + extensão mhchem **empacotadas localmente** via Vite, inclusive fontes, sem CDN. Suportar matemática `\\(...\\)`, `\\[...\\]`, fórmulas e reações `\\ce{...}`, unidades `\\pu{...}`.
- O texto original continua persistido no formato das questões; compatibilidade com enunciados existentes. Escapar HTML, restringir macros/trust, bloquear links não autorizados; fallback legível se a fórmula estiver inválida.
- Renderização idêntica em `src/prova.js`, `src/professor/bank.js`, `src/professor/exam.js`, `src/professor/print.js` e nos PDFs/relatórios. Preservar leitura por leitor de tela (MathML/alternativa textual) e impressão A4.
- Desenhos de Lewis com pares não ligantes requerem editor de diagramas/SVG em subtarefa separada; mhchem não deve ser apresentado como desenho automático de Lewis.

**Aceite:** frações, índices, cargas, vetores, equações e reações com estados físicos aparecem corretamente offline e mantêm o mesmo significado em tablet/celular/PDF/tema escuro e claro.

### P2 — Gerador inteligente de avaliações (base local, opcional IA local)

**Mudanças previstas:**
- `shared/exam-blueprint.js`: motor determinístico puro de seleção, com filtros de disciplina, série, conteúdo, descritor/habilidade, tipo, quantidade, pesos, dificuldade, exclusão de questões repetidas/recém-usadas e semente para reprodutibilidade.
- Precisar de metadados `subject`, `stage`, `topics`, `skillIds`, `originBankId` e `provenance` (ou modelo de equivalência). Estender `normalizeQuestions` com migração retrocompatível e preservar leitura de provas antigas; **não reclassificar `D16` legado sem etapa/disciplina**.
- Integrar descritores oficiais do PR #4 somente após validação das matrizes; diferenciar MATRIZ TRADICIONAL e BNCC; identificar lacunas em vez de preencher com itens de outra habilidade.
- Criar `POST /api/exam-blueprints/preview` (admin), sem escrita, com distribuição, itens candidatos, justificativas e avisos; salvar versão rascunho somente após revisão e confirmação.
- Política por falta de questões: "não há itens suficientes" + alternativas explícitas (reduzir, trocar distribuição, cadastrar/gerar novas); nunca completar silenciosamente com assuntos diferentes.
- Modo IA para gerar enunciados **opcional**, local, não obrigatório para aplicação offline; exige revisão humana e validação de gabarito.

**Aceite:** a mesma entrada+seed gera a mesma seleção; o algoritmo respeita filtros e quota, não repete IDs, não inventa questões existentes e não abre a prova sem confirmação do professor.

### P3 — Versões A/B/C/D e PDF A4

**Mudanças previstas:**
- `shared/exam-forms.js`: gerar quatro sequências persistentes com seed distinta, incluindo mapeamento `formId → questionId → optionId`. Não depender da ordem da sessão digital. Salvar snapshot imutável do modelo e chaves de resposta em `exam_forms` (migração SQLite).
- `src/professor/print.js` evolui para layout A4 com cabeçalho, instruções, paginação, quebra de questão, tipografia científica, alternativas, gabarito por versão e folha de respostas associada.
- PDF determinístico: usar saída renderizada do Electron (ex.: `webContents.printToPDF`) ou biblioteca empacotada offline, com fonte e parâmetros fixos. `window.print` permanece como alternativa para uso via navegador.
- Identificador/QR da folha contém apenas identificador opaco da avaliação/versão/formulário; dados pessoais são resolvidos no banco local. Evitar incluir gabarito público no QR.

**Aceite:** quatro cadernos reproduzíveis, quatro gabaritos corretos, score invariável após remapear uma mesma resposta, PDF legível sem corte de questão em A4 e nenhuma mudança em avaliações já respondidas.

### P4 — Estatísticas por item e mapa de aprendizagem

**Mudanças previstas:**
- `shared/assessment-stats.js`: calcular `p` (proporção de acerto), distribuição das alternativas, itens sem resposta, discriminação item-total corrigida, variância e consistência interna (KR-20 somente se aplicável ou alfa com ressalvas).
- Separar: não respondeu / não iniciou / erro / item anulado / discursiva pendente / item sem gabarito. Excluir corretamente dados sem nota e impedir divisão por zero/NaN.
- `GET /api/reports/item-analysis` e `GET /api/reports/skill-map` com permissão admin; agregar por `student_id`, `classId`, período, componente, `skillId` completo (disciplina + etapa + matriz), ID estável da questão.
- UI em `src/professor/results.js` com barras, tabela por questão, mapa turma × habilidade, filtro por série e exportação CSV/XLSX/PDF. Diferenciar dificuldade classificatória de dificuldade empírica.
- Nunca interpretar 1 questão/1 prova como domínio de habilidade; mostrar tamanho amostral e intervalos/avisos para amostras pequenas (ex.: N < 30).

**Aceite:** agregados reproduzem cálculos manuais de conjuntos conhecidos; repetição do mesmo aluno em provas diferentes não duplica alunos em contagens de pessoas; sem indicadores enganosos de TRI.

### P5 — Correção de cartões-resposta (OMR) pela câmera

**Mudanças previstas:**
- OMR = reconhecimento óptico de marcações; **não requer IA generativa**. Pipeline: captura/importação → detecção de quatro marcadores → correção de perspectiva → escala padrão → leitura de quadrículas → decisão por limiar adaptativo e confiança → revisão obrigatória dos ambíguos → persistência auditada.
- Folha gerada na P3: QR com versão ID opaco, marcadores de alinhamento, código de turma/prova e identificador aluno selecionado/conferido; perguntas e alternativas com coordenadas fixas. Suportar provas de 10/20/30/45 itens em versões A/B/C/D conforme layout e paginação.
- `src/professor/omr.js` + `src/lib/omr-core.js` (processamento isolado/Worker) e módulo de imagens (OpenCV.js ou implementação enxuta empacotada offline); testar performance em hardware real. Criar tabela `answer_scans` com `idempotency_key`, `formId`, hash de imagem, revisão e auditoria.
- **Atenção à câmera no celular:** `navigator.mediaDevices.getUserMedia` exige origem segura (HTTPS ou localhost); o atual Atlas via `http://IP-DA-LAN` nos celulares NÃO garante esta API. Primeira versão usa câmera do computador na janela Electron (`127.0.0.1`) e upload de foto capturada separadamente no celular. Captura ao vivo pelo celular exige solução segura (HTTPS local com certificado confiável ou aplicativo Android nativo).
- Autenticação do professor para importar imagens; revisão de marcações fracas, múltiplas, ausentes ou borradas; nunca atribuir nota automaticamente quando a leitura for ambígua. Não modificar sessão digital já submetida por uma leitura óptica duplicada.

**Aceite:** uma folha conhecida é mapeada ao gabarito exato da versão; leituras ambíguas são encaminhadas a revisão; mesmo arquivo lido duas vezes não duplica correções; processamento não exige Internet.

## 2. Modelo de dados e compatibilidade

- Novas tabelas **aditivas** propostas: `exam_blueprints`, `exam_forms`, `answer_scans`; para estatística, preferir consulta/snapshot de respostas existentes antes de criar tabela agregada.
- Preservar PK/IDs atuais de provas, estudantes e sessões, `answers`, `grades`, `question_bank`, `audit_log`.
- Qualquer migração deve começar com backup válido, confirmação de rollback por restauração e teste de abertura de banco prévio 1.3.0.
- Questões com campo antigo `skill = Dn` permanecem legadas/ambíguas, até revisão explícita.
- Provas com sessões continuam imutáveis; versões impressas e digitais não podem quebrar a ligação a `questionId` original.

## 3. Critérios de lançamento

- CI Node 24 e 26, teste Windows Electron empacotado; regressão de login, importação, provas, relatório, backup e restauração.
- Provas de verdade **não** são usadas no primeiro teste de campo; utilizar dados fictícios.
- Nenhuma distribuição beta/estável antes de finalizar testes críticos P0 e garantir migração reversível.
- Cada etapa entra em PR isolado com registro de decisões, escopo, resultado dos testes e instruções de reversão.
- Versão estável 1.3.0 permanece intacta até aprovação explícita de versão candidata em Windows real e verificação de preservação de dados.

Ver `docs/TESTES-AVALIACOES.md` para a matriz de casos e portões de qualidade.
