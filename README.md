# Atlas — busca de avaliações

Protótipo independente de uma biblioteca de avaliações, criado a partir da investigação pública dos fluxos de busca descritos na central de ajuda do Socrative. O projeto usa HTML, CSS e JavaScript sem framework para manter o exemplo simples de executar e fácil de adaptar.

## Rodar localmente

```bash
npm install
npm run dev
```

Depois abra a URL exibida pelo Vite. Para validar uma build de produção:

```bash
npm run build
```

## Funcionalidades

A busca procura em título, assunto, descrição, palavras-chave e conteúdo. Filtros podem ser combinados por assunto, série e palavra-chave. O protótipo também demonstra ordenação, favoritos, detalhes, cópia para biblioteca, estado vazio e atalho de teclado.

As evidências e as fontes da investigação estão em [EVIDENCE.md](./EVIDENCE.md).

## Tablet e frequência

O protótipo também tem uma ação **Lista de frequência** que aceita PDF, CSV ou TXT. Ela lê localmente a coluna `#` e o nome do estudante, um formato compatível com o diário de classe fornecido, sem enviar os dados para a Internet. A proposta de uso com roteador e servidor local está documentada em [TABLET-OFFLINE.md](./TABLET-OFFLINE.md).
