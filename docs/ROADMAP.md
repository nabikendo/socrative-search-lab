# Plano de evolução

## Feito
Servidor local, importação de lista (PDF, XLSX, CSV, texto), provas por editor ou PDF/DOCX, código de acesso, sessões protegidas, fila offline no navegador, correção automática e manual com pesos, planilha para Excel, PIN do professor, SQLite, backups automáticos, CSP.

## Próximos passos sugeridos
1. **Tempo de prova** controlado pelo servidor (início, fim e tempo extra individual).
2. **Backup e restauração pela interface**, incluindo anexos, em um único arquivo `.zip`.
3. **Banco de questões** com busca, tags e reutilização entre provas (a ideia original do projeto).
4. **Relatórios**: acerto por questão e por habilidade, para ver o que a turma não aprendeu.
5. **Embaralhar** questões e alternativas por aluno.
6. **Cartões de acesso** em PDF com QR Code por aluno (substitui o código geral).
7. **Exportar XLSX** nativo e envio para o diário/planilha Google quando houver Internet.
8. **HTTPS local** e logs de auditoria.
9. **Acessibilidade**: validação com leitor de tela, modo de leitura ampliada.
10. **Teste em Chromebooks reais** com a turma completa.


## Sprint 1 — Configurações (branch feature/sprint-1-settings)
- [x] Tela de configurações do professor e engrenagem no topo
- [x] Preferências visuais no navegador e persistência do professor no servidor
- [x] Tema automático com CSS `prefers-color-scheme`; fonte, contraste, compacto e apresentação
- [x] Preferências de prova armazenadas; IP da rede; integração com backup .atlas existente
- [x] Testes unitários do módulo de aparência
- [ ] Conectar padrões ao editor de prova e ao aviso sonoro de envio
- [ ] Implementar política segura para exibir gabarito após entrega
- [ ] Backup ZIP validado (formato nativo .atlas mantido enquanto isso)
- [ ] Regeneração autenticada do código curto com tratamento de sessões ativas
- [ ] Limpeza de provas antigas com prévia, backup e confirmação
- [ ] Executar CI e testes manuais em Windows e Chromebook gerenciado antes de promover
