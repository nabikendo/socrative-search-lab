# Atlas — tasks/todo.md

> Plano proposto; **nenhuma etapa funcional executada nesta branch**. Não modificar `main` nem publicar estável até validação. Referências detalhadas: `docs/PLANO-AVALIACOES.md` e `docs/TESTES-AVALIACOES.md`.

## Preparação e integração
- [x] Auditar baseline `main`/Atlas 1.3.0 e identificar dependências.
- [x] Definir escopo, sequência, critérios de aceite, riscos e rollback.
- [x] Preparar matriz de testes com casos positivos/negativos.
- [ ] Reconciliar redesign PR #3 e descritores PR #4, definindo branch de integração sem conflitos.
- [ ] Criar fixtures artificiais de provas, alunos e cartões, sem dados reais.

## P0 — resiliência e atualização
- [ ] Escrever testes UPD-01 a UPD-05 e REC-01 a REC-06 que falham no baseline.
- [ ] Bloquear atualização automática ao sair/reiniciar em provas ativas.
- [ ] Implementar contrato de verificação de `safeToInstall`.
- [ ] Proteger fila local, replay idempotente e fluxo de recuperação.
- [ ] Verificar migração, backup e rollback com dados da 1.3.0.
- [ ] Executar Windows empacotado + teste real de reconexão.

## P1 — editor científico
- [ ] Instalar KaTeX/mhchem localmente, sem CDN.
- [ ] Criar renderizador seguro com fallback para matemática/química.
- [ ] Aplicar no banco, edição, aluno, gabarito, impressão e relatórios.
- [ ] Criar fixtures de Física/Química/Matemática e testes SCI-01 a SCI-07.
- [ ] Revisar acessibilidade, tema escuro e tablets.

## P2 — gerador de provas
- [ ] Definir metadados retrocompatíveis de disciplina, etapa, questão e descritor.
- [ ] Implementar motor determinístico de seleção e distribuição com seed.
- [ ] Implementar prévia, falta de candidatos e confirmação de salvamento.
- [ ] Integrar descritores validados do PR #4, sem confundir matrizes tradicionais e BNCC.
- [ ] Cobrir GEN-01 a GEN-10 e testes de banco vazio/volumoso.

## P3 — quatro versões e PDF
- [ ] Criar `exam_forms` com mapping imutável e gabarito por versão.
- [ ] Criar layout A4 e gerador de PDF/gabarito + cartões ópticos.
- [ ] Garantir compatibilidade de formatação LaTeX/mhchem com impressão.
- [ ] Cobrir FORM-01 a FORM-08, testes de paginação e hashes de conteúdo.

## P4 — análise estatística
- [ ] Implementar motor `assessment-stats` com amostras de referência.
- [ ] Garantir denominadores corretos, itens anulados e notas pendentes.
- [ ] Implementar mapa turma × habilidade e exportação.
- [ ] Cobrir ANA-01 a ANA-10, inclusive amostra pequena e itens sem variância.

## P5 — OMR
- [ ] Construir corpus físico/sintético de cartões e testar quatro versões.
- [ ] Implementar alinhamento, perspectiva, leitura e confiança com processamento offline.
- [ ] Criar autenticação, vínculo de formulário e trilha de auditoria idempotente.
- [ ] Criar UI de correção manual dos casos ambíguos.
- [ ] Validar captura Windows localhost; upload por celular via LAN; só considerar live camera móvel via HTTPS ou aplicativo nativo.
- [ ] Cobrir OMR-01 a OMR-10, homologar corpus de 100 cartões e medir desempenho.

## Portões de qualidade
- [ ] CI Node 24/26 verde, sem regressão nos testes existentes.
- [ ] Windows NSIS e testes de abertura/atualização aprovados.
- [ ] Teste de sala com 30–40 conexões, Wi-Fi sem Internet.
- [ ] Teste em Windows/tablet real, com backup e rollback executados.
- [ ] Beta aprovado explicitamente pelo professor.
- [ ] Release estável autorizado somente após validação comprovada.
