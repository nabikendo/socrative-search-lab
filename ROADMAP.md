# Atlas — plano completo de evolução

Este documento transforma o pedido de adicionar todas as recomendações em entregas testáveis. O projeto atual continua sendo um MVP local; cada fase abaixo precisa ser validada com Chromebooks reais antes de avançar para a próxima.

## Estado atual

Já disponível: servidor local sem Internet externa; lista por PDF, CSV/TXT e XLSX; turmas no cadastro; provas em PDF/DOCX; várias provas por ID; prova aberta descoberta automaticamente; respostas em tempo real; exportação CSV detalhada; gabarito objetivo; pesos; correção manual; token de sessão; heartbeat e alerta online/desconectado; backup atômico do JSON; interface responsiva em cards.

Ainda não deve ser considerado pronto para avaliação oficial: PIN do professor; autorização administrativa; fila offline no Chromebook; SQLite; restauração de backup pela interface; controle de tempo no servidor; sanitização completa de documentos/HTML; upload em streaming; QR Code; auditoria de acessos; rubricas; acessibilidade WCAG validada; sincronização opcional com nuvem.

## Fase 1 — segurança e integridade P0

Objetivo: impedir alteração não autorizada e evitar perda de respostas.

Entregas:

- PIN ou senha do professor com sessão administrativa;
- código da turma e código da prova, com expiração;
- QR Code para entrada na atividade;
- confirmação explícita do nome antes de iniciar;
- token de sessão obrigatório em todas as operações do aluno;
- autorização separada para endpoints de professor e aluno;
- botão fechar/reabrir prova;
- limite de início e término controlado pelo servidor;
- SQLite com transações;
- backup ZIP com banco, arquivos, configurações e CSV;
- restauração validada e histórico de eventos;
- sanitização de HTML de DOCX, escaping dos textos e CSP;
- validação de assinatura de PDF/DOCX e limite de upload;
- teste de recuperação após encerramento abrupto do notebook.

Critérios de aceite: um aluno não consegue acessar painel ou resultados; uma prova fechada não aceita sessão nova; uma resposta não é perdida quando a página recarrega; um backup restaura a aula em outro notebook.

## Fase 2 — modo offline resistente

Objetivo: sobreviver a quedas breves do Wi-Fi local.

Entregas:

- Service Worker para os arquivos da aplicação;
- IndexedDB com rascunho local;
- fila de respostas pendentes;
- retry com backoff;
- operações idempotentes;
- indicador salvo/pendente/sincronizado;
- envio final bloqueado enquanto houver pendências;
- recuperação automática após recarga;
- tela de diagnóstico da conexão e latência;
- teste com servidor indisponível durante a resposta.

Critérios de aceite: desligar o roteador por dois minutos não apaga respostas; ao religar, a fila sincroniza sem duplicar respostas; o aluno vê claramente o estado da sincronização.

## Fase 3 — operação de turmas e avaliações

Objetivo: permitir uso diário por vários professores.

Entregas:

- várias turmas isoladas;
- professores e permissões;
- banco de provas e questões;
- tags, busca, duplicação e versões;
- pré-visualização da lista antes de publicar;
- importação XLSX com mapeamento de colunas;
- fechamento, reabertura e arquivamento;
- versões A/B/C com embaralhamento;
- cartões de acesso impressos;
- prova com várias páginas, imagens, áudio e fórmulas;
- tempo extra por aluno;
- pausa autorizada e retomada.

Critérios de aceite: duas turmas podem fazer provas diferentes no mesmo notebook sem compartilhar alunos, sessões ou resultados.

## Fase 4 — correção e relatórios

Objetivo: transformar respostas em avaliação pedagógica útil.

Entregas:

- tipos de questão objetivo, múltiplas respostas, verdadeiro/falso, curta, discursiva, associação e ordenação;
- peso por questão e por habilidade;
- rubricas com critérios e comentários;
- correção manual com histórico;
- revisão e segunda correção;
- nota automática, manual e final separadas;
- aprovação e recuperação;
- relatório por aluno, turma, questão e habilidade;
- distribuição das alternativas;
- exportação CSV e XLSX real;
- impressão e PDF de resultados;
- alerta para questões sem resposta.

Critérios de aceite: cada nota final é reproduzível a partir das respostas, pesos, rubrica e histórico de correção.

## Fase 5 — laboratório, acessibilidade e privacidade

Objetivo: tornar o produto utilizável por toda a escola.

Entregas:

- teste automático do roteador, latência, perda e capacidade;
- painel de alunos conectados e bateria quando disponível;
- modo alto contraste;
- navegação por teclado;
- leitor de tela;
- foco visível;
- fonte e zoom ajustáveis;
- texto alternativo para imagens;
- tempo extra e adaptações individuais;
- retenção e exclusão de dados;
- logs sem nomes desnecessários;
- exportação controlada pelo professor;
- orientações de privacidade e LGPD.

Critérios de aceite: fluxo principal navegável por teclado, contraste validado e dados de uma turma podem ser excluídos ou exportados pelo responsável.

## Fase 6 — sincronização opcional

Objetivo: permitir que a escola use a rede local durante a prova e sincronize depois.

Entregas:

- pacote de sincronização assinado;
- envio opcional quando a Internet voltar;
- resolução de conflitos;
- consentimento explícito;
- fila de sincronização no servidor;
- integração futura com sistemas escolares, sem tornar a Internet obrigatória.

## Ordem de execução

A ordem recomendada é Fase 1, Fase 2, Fase 3, Fase 4, Fase 5 e Fase 6. Não é recomendado adicionar recursos pedagógicos avançados antes de proteger identidade, sessão, persistência e recuperação offline.

## Teste de cada release

Cada fase deve passar por build, teste de API, teste sem Internet, teste em pelo menos um Chromebook, teste em tablet, queda do servidor, recarga durante resposta, exportação e restauração. A avaliação oficial só deve usar uma versão marcada como release depois desses testes.
