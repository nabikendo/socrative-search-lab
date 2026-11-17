# Auditoria — 8 de novembro de 2026

Revisão completa do código, com os problemas reproduzidos no servidor antigo antes da correção.

## Corrigido

| Gravidade | Problema | Correção |
| --- | --- | --- |
| Alta | `/api/open-exam` e o início de sessão devolviam o gabarito a qualquer aluno | O aluno só recebe questões sem `correct` (teste automatizado) |
| Alta | XSS: nomes, respostas e enunciados entravam por `innerHTML` (inclusive no painel do professor) | Telas montadas com `textContent`; CSP; DOCX sanitizado no servidor |
| Alta | Qualquer pessoa na rede assumia a sessão de outro aluno informando só o número | Código da prova + bloqueio de sessão em uso + token por aparelho |
| Alta | Upload aceitava qualquer arquivo como “PDF” e o servia com o MIME enviado | Validação por assinatura, MIME fixo, `nosniff` |
| Alta | Cada batimento/resposta copiava o JSON inteiro para `backups/` (12 arquivos em segundos) | Batimentos só em memória; backup a cada 5 min, 20 mantidos |
| Média | Salvar uma prova aberta a fechava; `/api/open-exam` quebrava sem prova aberta | Status preservado; resposta correta |
| Média | Aluno podia reiniciar a prova depois de enviar | Uma sessão por aluno e prova; reabertura só pelo professor |
| Média | Várias provas podiam ficar “abertas” e não havia como encerrar | Abrir uma encerra as outras; botão Encerrar; respostas recusadas após encerrar |
| Média | IDs `q1…` regenerados: reordenar/remover misturava respostas e notas | IDs estáveis; questões travadas após haver respostas |
| Média | CSV `numero,nome,turma` colava a turma ao nome; textarea padrão com `\n` literal | Parser de CSV real; editor estruturado |
| Média | CSV sem BOM, com vírgula e vulnerável a fórmulas (`=HYPERLINK`) | UTF‑8 com BOM, `;`, decimal com vírgula, escape de fórmulas |
| Média | Painel recriava a lista a cada 5 s, fechando detalhes e descartando a nota digitada | Atualização preserva abertos e não interrompe digitação |
| Média | Sessão do professor expirada (reinício do servidor) quebrava o painel em silêncio | Volta à tela de PIN |
| Média | Resposta de texto só salvava ao sair do campo; sem fila se o Wi‑Fi caísse | Salvamento com atraso, fila local persistente, envio bloqueado com pendências |
| Baixa | Google Fonts quebravam o modo offline; catálogo e perfil fictícios na página inicial | Fontes do sistema; página inicial reduzida a duas entradas |
| Baixa | `xlsx@0.18` com vulnerabilidade alta sem correção no npm; `better-sqlite3` exigia compilação nativa | `read-excel-file` e `node:sqlite` (0 vulnerabilidades no `npm audit`) |
| Baixa | Dados lidos do corpo sem limite claro, erros 500 para JSON inválido, path traversal por prefixo | Limites, 400/413, verificação com separador de caminho |

## Riscos que permanecem

1. **Rede local sem HTTPS.** Um aluno com conhecimento técnico pode observar tráfego do Wi‑Fi. Tratado na Sprint 5 (abaixo): HTTPS opcional e mitigações obrigatórias em HTTP. A rede controlada passou a ser **requisito**.
2. **Código de 4 dígitos.** Há limite de tentativas por endereço, mas não é uma barreira contra um ataque deliberado.
3. **Sem controle de tempo** de prova no servidor.
4. **Backups só do banco**; os anexos precisam de cópia manual da pasta `data/`.
5. **Leitura de PDF da lista** é heurística e depende do layout do diário.
6. **Interface testada em simulação de DOM**, não em Chromebooks reais.

## Revisão de 14 de novembro de 2026 (1.2.0-beta.6)

| Gravidade | Problema | Correção |
| --- | --- | --- |
| Média | O menu “Endereço para os alunos” mostrava `\n` escrito no texto, em vez de uma linha por endereço | Quebra de linha real |
| Média | A busca automática de atualização abria avisos (“já está atualizado” / “sem conexão”) a cada abertura, inclusive em sala sem Internet | Busca automática é silenciosa; avisos só na busca manual (Alt+U) |
| Média | A classe `.check` existia duas vezes: as linhas do diagnóstico de rede herdavam fonte de 56 px e cor verde | Marca de envio renomeada para `.done-mark` |
| Baixa | Endereço IP pessoal fixo na ordenação dos endereços de rede | Ordem genérica (192.168.x, 10.x, demais) |
| Baixa | Segmento selecionado ficava branco ao forçar o tema escuro com o Windows em modo claro | Cor própria por tema (`--seg-on`) |
| Baixa | Texto do PIN citava só a “janela preta”, que não existe no aplicativo para Windows | Orientação para Atlas › Mostrar PIN |

Visual: paleta neutra e cantos menores no estilo dos apps do macOS (azul do sistema, bordas finas, controles compactos, fonte do sistema), claro e escuro.

## Rede ruim e Chromebooks (1.2.0)

Novo: aviso de saída da página (com contagem e tempo, sem bloquear o aluno), página `/teste`, contador de tempo pelo relógio do servidor, bloqueio de suspensão com prova aberta, liberação do Firewall pelo menu, cópia automática ao encerrar e impressão da prova/gabarito.

Limites: em Chromebook não é possível impedir que o aluno saia da página, só registrar. O firewall e o bloqueio de suspensão só podem ser verificados no Windows real.

Fechamento da versão estável: histórico de saídas com horário por aluno (e no PDF individual), cópia automática também quando a prova termina pelo horário, limpeza das cópias antigas (40 mais recentes), estilos do diagnóstico movidos para a base (a página /teste os usava sem carregá-los) e saídas não contadas enquanto a prova está pausada.

## Node.js 26 e Electron 43 (1.3.0)

Os pacotes ZIP passam a embutir o Node 26.13.1 (LTS, com as correções de segurança de 11/11/2026) e o aplicativo do Windows sobe do Electron 38 para o 43 (Node 24.17). Os testes rodam em Node 24 e 26 (`.github/workflows/ci.yml`). Recursos novos em uso: `URLPattern` no roteador, `crypto.hash`, `Intl.DurationFormat` no relatório individual, `Temporal` no nome das cópias (com `Date` de reserva, pois o Node 24 não o tem), `await using` nos testes e `process.loadEnvFile` para o `atlas.env`. Correção: o nome das cópias automáticas usava o horário UTC; agora usa o horário local.


## Sprint 1 — Configurações (branch de desenvolvimento, 15/11/2026)
- API `GET/PUT /api/teacher-settings` exige sessão autenticada do professor e valida tipos, enumerações e limites antes de gravar.
- Preferências persistem em arquivo fora da raiz pública; gravação temporária seguida de rename reduz risco de arquivo incompleto.
- Mudanças são registradas via `store.addAudit`.
- A interface não libera gabarito ao aluno: a preferência correspondente é armazenada, mas sua aplicação exige autorização e verificação explícita do servidor.
- A regeneração de códigos e exclusão em lote não foram habilitadas para evitar invalidação de sessões ou perda de dados.
- Risco residual: tráfego HTTP na rede local, conforme auditoria anterior. A branch não altera o modelo de rede.


## Sprint 5 — Segurança da rede: diagnóstico HTTPS e mitigações em HTTP (17/11/2026)

### Decisão

O Atlas roda num computador da sala e os alunos usam Chromebooks gerenciados pela SEDUC, celulares e tablets. HTTPS de verdade exigiria um certificado assinado por uma autoridade reconhecida para um IP local, o que não existe. A alternativa é um **certificado autoassinado**, que faz cada aparelho mostrar o aviso "Sua conexão não é particular". Em Chromebooks gerenciados, a política da escola pode **impedir** que o aluno continue depois desse aviso.

Por isso:

- **Modo padrão: `http` com mitigações obrigatórias.** Funciona em qualquer aparelho e não pode ter as mitigações desligadas.
- **`https` e `auto` existem**, mas só devem ser ligados depois do diagnóstico num Chromebook real da escola.
- **Rede controlada é REQUISITO, não recomendação:** o hotspot do professor ou um Wi-Fi só da turma, com senha. Sem isso, qualquer aparelho na mesma rede pode observar o tráfego HTTP.

### Resultado do diagnóstico em Chromebook real

| Situação | Resultado |
|---|---|
| Chromebook gerenciado da SEDUC | **Incerto: ainda não testado.** Rodar `/diag/https` e registrar aqui. |
| Navegador comum (Chrome/Edge em Windows, Chromium no Linux) | **Viável com aviso:** a página abre depois de "Avançado › Continuar" (verificado no Chromium 150 do Electron 43). |

Como testar: no Chromebook, na rede da sala, abrir `http://<IP do professor>:<porta>/diag/https` e tocar em "Testar HTTPS neste aparelho". O resultado (funcionou, funcionou com aviso, bloqueado, incerto) aparece em Configurações › Segurança. Se o Chromebook bloquear, manter `http`; se funcionar com aviso, `auto` é aceitável; `https` só se todos os aparelhos da turma passarem.

### Os três modos

| Modo | Alunos | Professor | Aviso de certificado |
|---|---|---|---|
| `http` (padrão) | `http://IP:porta/prova` | `http://127.0.0.1` (local) | Não |
| `auto` | QR Code com `https://IP:8443/prova`; o endereço HTTP continua aceito | local | Sim, no HTTPS |
| `https` | só `https://IP:8443/prova`; páginas por HTTP na rede são redirecionadas e a API por HTTP é recusada (403 `https_required`) | local (o computador do professor não passa pela rede) | Sim |

- O certificado é autoassinado, válido por 397 dias para `localhost`, `127.0.0.1` e os IPs da rede, guardado em `<dados>/tls` (chave com permissão 600).
- Se o computador trocar de Wi-Fi (IP novo), o certificado é refeito sem reiniciar.
- A impressão digital (SHA-256) aparece em Configurações › Segurança e no `/diag/https`, para conferência.
- O servidor HTTPS fica sempre no ar na porta 8443 (ou outra livre; variável `ATLAS_HTTPS_PORT`). No modo `http`, ele só responde ao diagnóstico.
- O aplicativo Android do aluno usa WebView e **não aceita certificado autoassinado**. Com o aplicativo Android, use `http` ou `auto`.

### Mitigações sempre ativas (obrigatórias em `http`, mantidas em todos os modos)

1. **Acesso com validade curta:** o token do aluno vence após 10 min sem sinal (configurável de 2 a 120 min). Ele se renova a cada batimento (10 s) enquanto a prova está aberta, e o mesmo aparelho renova sozinho depois de uma tela apagada ou queda curta. Um token capturado na rede vale no máximo até o fim da validade e, vencido, só é renovado pelo aparelho vinculado.
2. **Vínculo por aparelho:** o primeiro aparelho que entra com o número fica vinculado. Outro aparelho é recusado (409) até o professor tocar em "Liberar dispositivo" no painel de presença. As respostas nunca são apagadas pela troca.
3. **Auditoria:** IP, aparelho, entrada, saída (por fechamento da página ou falta de sinal), volta, envio, troca de aparelho, tentativas em outro aparelho e pedidos de ajuda. Fica no painel de presença e no CSV da chamada.
4. **Detecção de anomalia:** o mesmo aluno tentando entrar em dois aparelhos gera um alerta vermelho no painel, com IP e tipo dos dois aparelhos.
5. A última atividade fica em memória e vai ao disco a cada minuto, para a validade sobreviver a um reinício do Atlas sem escrever no disco a cada batimento.

### Risco residual

- **Em `http`, o tráfego continua legível** para quem estiver na mesma rede: código da prova, número do aluno e respostas. As mitigações limitam o reaproveitamento de um acesso capturado, mas não impedem a leitura. Isso só é aceitável numa rede controlada.
- **Em `https`/`auto`, o aviso de certificado ensina o aluno a aceitar avisos.** Um atacante na mesma rede poderia apresentar outro certificado; a defesa é a rede controlada e a conferência da impressão digital pelo professor.
- O identificador do aparelho fica no navegador. Se o aluno limpar os dados ou usar aba anônima, o aparelho vira "outro" e precisa de liberação do professor.
- O IP é o informado pela conexão. Atrás de NAT ou proxy, vários aparelhos podem aparecer com o mesmo IP.

## Sprint 2 — Painel de presença em tempo real (17/11/2026)

- **Tempo real por Server-Sent Events** (`/api/exams/:id/presence/stream`), escolhido em vez de WebSocket. Só o servidor precisa enviar, funciona em HTTP simples, o navegador reconecta sozinho e passa por proxies da rede como uma requisição comum. As mudanças são agrupadas em 150 ms (30 alunos entrando juntos geram um envio).
- **Decisão de UX: quem fecha o navegador fica como "Saiu"** (amarelo), dentro de "Entraram", e não volta para "Não entraram". Ele esteve presente, e a chamada não pode perder isso. Sai na hora quando o navegador avisa o fechamento (`sendBeacon`) ou em até 30 s sem sinal. Ao voltar, aparece de novo como "Em prova" e o registro mostra "Voltou".
- "Liberar dispositivo" revoga o token, desfaz o vínculo e mantém as respostas. O próximo aparelho que entrar com o número fica vinculado; o antigo recebe "desconectado pelo professor".
- O CSV da chamada sai em UTF-8 com BOM e separador `;` (abre direto no Excel em português). Células que começam com `= + - @` são neutralizadas contra fórmulas.
- Os eventos de presença ficam fora da auditoria geral da prova, para não poluí-la, e são apagados junto quando a prova é reiniciada pela limpeza.

## Sprint 4 — Experiência do aluno (17/11/2026)

- Já existiam: fila local de respostas gravada a cada alteração (localStorage), retomada ao reabrir, grade numerada, bandeirinha e cronômetro pelo relógio do servidor.
- Acrescentado:
  - espera de ~1 s antes de enviar textos e números;
  - renovação automática do acesso vencido no mesmo aparelho;
  - avisos aos 5 e a 1 minuto (faixa vermelha, som curto e vibração), uma vez cada;
  - tela de revisão com os números das questões em branco e marcadas, tocáveis;
  - botão "Pedir ajuda", que aparece no painel em segundos e mostra ao aluno quando o professor atendeu.
