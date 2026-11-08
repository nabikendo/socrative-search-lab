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

1. **Rede local sem HTTPS.** Um aluno com conhecimento técnico pode observar tráfego do Wi‑Fi. Use rede com senha própria.
2. **Código de 4 dígitos.** Há limite de tentativas por endereço, mas não é uma barreira contra um ataque deliberado.
3. **Sem controle de tempo** de prova no servidor.
4. **Backups só do banco**; os anexos precisam de cópia manual da pasta `data/`.
5. **Leitura de PDF da lista** é heurística e depende do layout do diário.
6. **Interface testada em simulação de DOM**, não em Chromebooks reais.
