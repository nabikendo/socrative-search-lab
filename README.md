# Atlas

Provas em rede local. O notebook do professor hospeda o sistema; Chromebooks, tablets e celulares abrem a prova pelo navegador. **Não precisa de Internet durante a aula.**

- **Professor** cria a prova (ou anexa um PDF/DOCX), abre com um código de 4 dígitos e acompanha as respostas em tempo real.
- **Aluno** digita o código e o número da lista de frequência, confirma o nome e responde. As respostas são salvas a cada alteração, mesmo se o Wi‑Fi cair.
- **Correção** automática para múltipla escolha, manual para questões abertas, com peso por questão. Exporta uma planilha que abre direto no Excel.

## Requisitos

- Node.js **22.13 ou mais novo** (recomendado: a versão LTS em [nodejs.org](https://nodejs.org/)).
- Um roteador Wi‑Fi (pode estar sem Internet) e o notebook conectado a ele.

Não há banco de dados para instalar: o Atlas usa o SQLite embutido no Node.

## Instalar (uma vez, com Internet)

```bash
git clone https://github.com/nabikendo/socrative-search-lab.git
cd socrative-search-lab
npm install
```

Sem Git: baixe o ZIP em **Code → Download ZIP**, extraia, abra o terminal na pasta e rode `npm install`.

## Usar em aula

```bash
npm start
```

O terminal mostra os endereços e o PIN do professor:

```text
Professor   http://localhost:8080/professor
Alunos      http://192.168.0.25:8080/prova

PIN do professor: 482913
```

Para fixar o PIN: `ATLAS_PIN=482913 npm start` (no PowerShell: `$env:ATLAS_PIN="482913"; npm start`). Para outra porta: `PORT=3000`.

1. **Turma.** Em `/professor`, importe a lista de frequência: PDF do diário, planilha `.xlsx`, CSV ou texto colado (`3;Nome do aluno;13.01`). O Atlas mostra uma prévia antes de salvar.
2. **Prova.** Monte as questões (marque a alternativa correta para correção automática) ou cole várias de uma vez: `Enunciado | A | *B | C || peso=2`. Se quiser, anexe um PDF ou DOCX com textos e figuras; o aluno vê o arquivo junto das questões.
3. **Abrir.** Clique em **Abrir para os alunos**. O painel mostra o código, o endereço e um QR Code. Abrir uma prova encerra a anterior.
4. **Alunos** acessam `http://IP-DO-NOTEBOOK:8080/prova` (não `localhost`), digitam o código e o número da lista e confirmam o nome.
5. **Resultados.** Acompanhe quem está online, quantas questões cada um respondeu e a nota parcial. Clique no aluno para ver as respostas e dar nota às questões abertas. **Baixar planilha** gera um CSV com acentos e separador corretos para o Excel em português.

### Windows

Na primeira execução, permita o Node.js em **Redes privadas** no Firewall. Se os alunos não abrirem a página, libere a porta TCP 8080 na rede local.

### Antes da primeira aula

Teste com a Internet desligada e alunos fictícios: abrir a prova em um Chromebook, responder, desligar o Wi‑Fi por um minuto (o aviso “Sem conexão” aparece e as respostas ficam guardadas no aparelho), religar, enviar e baixar a planilha.

## Como as notas funcionam

| Questão | Nota |
| --- | --- |
| Múltipla escolha com alternativa correta marcada | Automática: o peso inteiro ou zero |
| Múltipla escolha sem gabarito, ou aberta | Manual, de 0 até o peso da questão |

A nota mostra `pontos/máximo` e quantas respostas aguardam correção.

## Segurança e privacidade

- O painel do professor exige PIN (sessão de 12 h, com limite de tentativas).
- O gabarito **nunca** é enviado ao aluno.
- O aluno precisa do código da prova. Um número já em uso em outro aparelho é bloqueado; ao recarregar a página, o mesmo aparelho continua de onde parou.
- Cada aluno envia a prova uma única vez. O professor pode reabrir um envio individual.
- Textos de alunos e documentos DOCX são exibidos com escape/sanitização e há Content Security Policy. Arquivos enviados são validados pelo conteúdo, não só pela extensão.
- Nenhuma fonte, script ou imagem vem da Internet.
- Os dados dos alunos ficam só neste computador. **Não publique a pasta `data/`.**

## Dados e backup

Tudo fica em `data/`: banco `atlas.sqlite`, anexos em `documents/` e cópias automáticas em `backups/` (a cada 5 minutos, quando há mudanças, mantendo as 20 mais recentes). Para guardar uma aula, copie a pasta `data/` inteira. Para restaurar, feche o Atlas e substitua a pasta.

Quem usava a versão anterior (JSON + SQLite) não perde nada: na primeira execução os dados são migrados automaticamente.

## Problemas comuns

| Sintoma | O que fazer |
| --- | --- |
| Aluno não abre a página | Conferir se está no mesmo Wi‑Fi e usando o IP do notebook; liberar o firewall |
| “Este número já está em uso” | O aluno entrou em outro aparelho. Aguarde 30 s sem atividade nele ou use o mesmo aparelho |
| “Esta prova já foi enviada” | Em Resultados, abra o aluno e use **Reabrir para o aluno** |
| PDF da lista não reconhecido | Exporte um CSV ou XLSX com número, nome e turma |
| Painel pede PIN de novo | O servidor foi reiniciado; use o PIN do terminal |

## Desenvolvimento

```bash
npm run dev     # interface com recarga automática (precisa do servidor: npm run serve)
npm test        # testes da API, do importador e das regras de nota
npm run build   # gera dist/
```

Estrutura: `server.mjs` (API e arquivos estáticos), `lib/` (banco e documentos), `shared/` (regras usadas por servidor e telas), `src/` (telas e estilos), `test/`.

Mais detalhes: [auditoria](docs/AUDIT.md) · [plano de evolução](docs/ROADMAP.md).
