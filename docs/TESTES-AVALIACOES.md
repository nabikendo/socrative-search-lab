# Plano de testes — Atlas, trilha Avaliações Científicas / Gerador / OMR

**Finalidade:** critérios executáveis para implementação incremental. Nenhum caso é declarado aprovado apenas por estar listado. Baseline: `main` / Atlas 1.3.0; os PRs #3 e #4 são trabalhos paralelos, ainda não homologados.
**Estratégia:** unidade (Node `--test`), integração da API+SQLite temporário, regressão browser automatizada (Playwright recomendado), testes de dispositivo real e Windows empacotado. Testes devem ser repetíveis, offline e independentes de dados pessoais reais.

## 1. P0 — atualizador e recuperação

| ID | Cenário | Resultado exigido |
|---|---|---|
| UPD-01 | Prova aberta + atualização disponível + professor solicita instalar | Não reinicia, agenda para depois da aplicação; nenhuma resposta é perdida. |
| UPD-02 | Prova pausada + botão sair / fechar janela Windows | Não permite instalar automaticamente sem confirmação do estado e salvamento. |
| UPD-03 | Prova encerrada, sem filas pendentes, cópia verificada | Permite instalar atualização manualmente. |
| UPD-04 | Download concluído; `autoUpdater.autoInstallOnAppQuit` deveria instalar no sair | Instalação fica desabilitada enquanto há prova ativa e muda de estado apenas após reavaliação segura. |
| UPD-05 | Queda de energia / encerramento forçado simulado, banco WAL | Reinício reabre o estado sem corrupção; dados persistidos intactos. |
| REC-01 | Aluno salva respostas A e B e perde Wi-Fi | Ambas preservadas localmente; interface informa dados não confirmados. |
| REC-02 | Reconexão após 15/60/180 segundos | Respostas pendentes são sincronizadas sem duplicidade e sem sobrescrever envio mais novo. |
| REC-03 | Troca de aparelho e rotação de token | Sessão válida continua, sem expor token e com política determinística de resolução de conflitos. |
| REC-04 | HTTP 400/401/403/409/423/429/5xx no salvamento | Erros têm resposta específica; nenhum 4xx não reconhecido resulta em perda silenciosa da última resposta. |
| REC-05 | Envio repetido e reenvio de fila | API idempotente; recibo de entrega único. |
| REC-06 | LocalStorage indisponível/cheio | Aviso explícito e orientação para não fechar a prova; não exibe "salvo" falsamente. |
| MIG-01 | Restaurar banco 1.3.0 em versão candidata | Integridade de turmas, sessões, notas, anexos e gabaritos preservada. |
| MIG-02 | Rollback de migração rejeitada | Backup original restaura banco e documentos sem perda. |

## 2. P1 — editor científico

| ID | Entrada | Esperado |
|---|---|---|
| SCI-01 | Fração, potência, radical, vetor, símbolos gregos | Renderização correta e sem HTML executável. |
| SCI-02 | Fórmulas químicas, íons, setas, estados físicos, unidades (mhchem) | Mesmo conteúdo em banco, professor, aluno, impressão e PDF. |
| SCI-03 | Delimitadores inválidos / macro não suportada | Mensagem de erro ou texto legível; interface não trava. |
| SCI-04 | Texto anterior sem LaTeX | Exibição idêntica à versão 1.3.0. |
| SCI-05 | Caracteres arbitrários/injeção `<script>`, HTML disfarçado, macros maliciosas | Nada é executado e a representação permanece escapada. |
| SCI-06 | Offline, sem CDN, tema claro/escuro e leitor de tela | Fontes e fórmulas funcionam em Windows, Android Chrome e tablet em modo avião (com LAN ativa). |
| SCI-07 | A4: frações, cargas iônicas e quebra entre páginas | Não corta equação ou imagem, mantém gabarito correto. |

**Fixtures:** eletrostática (lei de Coulomb), cinética química (lei de velocidade), oxirredução, mol, geometria molecular, texto com símbolos especiais e reações com estados físicos. Cobrir acessibilidade, seleção/cópia e zoom.

## 3. P2 — gerador de avaliações

| ID | Cenário | Esperado |
|---|---|---|
| GEN-01 | Mesmo banco + parâmetros + seed, duas execuções | Mesmo conjunto e ordem de questões, sem alteração do banco. |
| GEN-02 | 10 itens, quotas 30/50/20 | 3 fáceis, 5 médios, 2 difíceis se houver candidatos suficientes. |
| GEN-03 | Vários descritores/disciplinas/etapas | Seleção respeita `subject+stage+skillId`; `D16` ambíguo é rejeitado/flag. |
| GEN-04 | Banco insuficiente em uma categoria | Relatório de déficit, sem completar em outro descritor silenciosamente. |
| GEN-05 | Itens duplicados/texto quase idêntico ou em provas recentes | Desduplicação de IDs e alerta de similaridade. |
| GEN-06 | Critério inclui somente objetiva, mas banco contém discursiva | Não selecionar formato incompatível. |
| GEN-07 | Banco com 0/1/100/1000 itens, filtros extremos, percentuais fracionários | Sem loops infinitos; distribuição determinística com arredondamento definido. |
| GEN-08 | Prévia cancelada pelo professor | Nenhuma prova é criada ou publicada. |
| GEN-09 | Prova montada a partir do banco é aplicada e depois o banco muda | Prova preserva instantâneo imutável dos itens originais. |
| GEN-10 | Modelo de IA local opcional indisponível | Gerador de seleção continua 100% funcional offline, sem cobrança ou API externa. |

**Fixtures:** bancos sintéticos com distribuição conhecida de conteúdos/dificuldade, itens de LP e Matemática com mesmo Dn em etapas diferentes, dados inválidos e itens usados repetidamente.

## 4. P3 — versões físicas e PDF

| ID | Cenário | Esperado |
|---|---|---|
| FORM-01 | Caderno com 10/20/45/100 itens | PDFs A4 paginados sem cortar texto, fórmula ou alternativa. |
| FORM-02 | Mesma prova gera versões A, B, C, D | IDs e ordem por versão estáveis, seeds independentes, gabaritos corretos. |
| FORM-03 | Questão com alternativa correta na posição 2 vira posição 4 na B | Gabarito B muda; correção reconhece conteúdo original. |
| FORM-04 | Seção discursiva e numérica com peso | Peso, espaço de resposta e indicação de correção manual preservados. |
| FORM-05 | PDF com imagem e fórmula longa | Quebra adequada, resolução e fontes legíveis. |
| FORM-06 | QR alterado, ilegível, versão de outra prova | Rejeita associação; não atribui nota a aluno incorreto. |
| FORM-07 | Prova com respostas já computadas | Não modifica formas ou gabarito da versão aplicada; criar nova versão. |
| FORM-08 | Gerar cadernos e gabaritos repetidamente | Hash estável dos dados semânticos de versão; saída visual validada por screenshots/golden files com tolerância explícita. |

## 5. P4 — análise estatística e habilidades

| ID | Cenário | Esperado |
|---|---|---|
| ANA-01 | Item com 8 acertos em 10 respostas válidas | Dificuldade empírica `p=0,8`. |
| ANA-02 | Alternativas A/B/C/D distribuídas 1/2/3/4 | Frequências conferem e total coincide com respostas válidas. |
| ANA-03 | Discursiva pendente, item sem chave ou anulado | Não entram como erro automático nem distorcem denominadores. |
| ANA-04 | Todos acertam ou todos erram; teste de um item | Discriminação/correlação indefinida aparece como "insuficiente", nunca NaN/Infinity. |
| ANA-05 | Item-total corrigido e alfa/KR-20 em base conhecida | Valor coincide com cálculo independente de referência, em margem definida. |
| ANA-06 | N pequeno ou sem respostas | Exibe N e advertência; não interpreta taxa como estimativa estável de aprendizagem. |
| ANA-07 | Estudante transferido entre turmas e avaliações | Histórico preservado via ID estável, agregados por turma/período coerentes. |
| ANA-08 | Mesmo descritor D16 de Matemática e Português | Nunca mescla os dados. |
| ANA-09 | Exportação CSV/XLSX/PDF | Totais correspondem ao painel, sem fórmula maliciosa no CSV. |
| ANA-10 | Provas com versões A/B/C/D | Resultados agregados por questão sem confundir a ordem de impressão. |

## 6. P5 — OMR e leitura pela câmera

| ID | Cenário | Esperado |
|---|---|---|
| OMR-01 | Cartão sintético A/B/C/D com 10, 20, 30 ou 45 itens | Identifica versão, aluno, marcações e gabarito correspondente. |
| OMR-02 | Rotação 0/90/180°, perspectiva, 100/200/300 dpi, sombras | Corrige orientação/perspectiva ou pede nova imagem, nunca força leitura duvidosa. |
| OMR-03 | Duas marcas no mesmo item ou marcação muito clara | Sinaliza ambiguidade para revisão, sem nota automática silenciosa. |
| OMR-04 | QR rasgado, versão ausente, ID duplicado ou folha não autorizada | Rejeita/solicita conferência. |
| OMR-05 | Foto repetida / cartão previamente corrigido | Idempotência por chave/arquivo; não duplica nota ou sessão. |
| OMR-06 | Aluno já entregou prova digital | Não sobrescreve a sessão digital; professor resolve conflito explicitamente. |
| OMR-07 | Câmera de notebook via Electron/localhost | Funciona com permissão, sem Internet. |
| OMR-08 | Celular abrindo `http://IP-DA-LAN` | Não depende de `getUserMedia` indisponível; permite upload da foto ou modo seguro alternativo. |
| OMR-09 | Lote de 40 cartões, mistura de versões | Relatório de conferência por aluno, inconsistências e totais sem duplicidade. |
| OMR-10 | Caderno com caracteres e fórmulas científicas | Cartão-resposta permanece registrável independentemente do visual das questões. |

**Meta de aceite do OMR:** corpus mínimo de 100 cartões com respostas conferidas manualmente, incluindo luz ruim, papel amassado, borrões e ângulos. Para marcações classificadas automaticamente como alta confiança, meta de exatidão ≥ 99,5%; os demais casos vão para conferência manual. A meta não equivale a desempenho comprovado antes do teste. Proibido salvar como correta uma leitura duvidosa sem confirmação.

## 7. CI, homologação e promoção

1. Antes de cada PR: `npm ci --ignore-scripts && npm test && npm run build` em Node 24 e 26; teste de migração de DB e de backup nos dois.
2. Adicionar Playwright E2E para professor/aluno em Chromium (e, quando possível, WebKit/Firefox) e snapshots visuais de fórmulas/A4; toda dependência empacotada para offline.
3. Windows CI: empacotar NSIS, iniciar Atlas, confirmar que a janela funciona, simular prova ativa + atualização pronta e verificar que ela NÃO instala. Testar restaurar arquivo `.atlas` da versão 1.3.0.
4. Testar com 30–40 sessões simultâneas em rede local isolada (Wi-Fi sem Internet). Registrar latência de resposta, taxa de reconexão, uso de CPU/RAM e persistência.
5. Em Windows real, testar USB/permissões/câmera/SmartScreen, atualização no canal beta, reversão manual documentada e reinício com prova aberta.
6. Antes do merge em `main`: somente quando CI estiver verde, todos os testes P0 críticos estiverem concluídos, fixture OMR aprovada, migração e backup verificados e revisão visual/autorização do professor registrada.
7. **Nunca publicar automaticamente estável** por apenas passar no CI: release beta isolado, teste em dados fictícios e aprovação explícita primeiro.

**Impedimentos de lançamento:** perda ou sobrescrita de resposta; atualização durante prova; gabarito A/B/C/D divergente; leitura OMR ambígua corrigida automaticamente; equação científica quebrada na impressão sem fallback; migração sem restauração; acesso administrativo sem PIN.
