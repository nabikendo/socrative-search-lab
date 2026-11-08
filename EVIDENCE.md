# Investigação: busca de avaliações

## O que foi observado

A análise usou documentação pública e oficial do Socrative. Não houve acesso a código privado nem cópia de assets proprietários.

1. **Biblioteca pessoal — correspondência por texto.** A central de ajuda descreve uma barra que encontra rapidamente pastas e quizzes. O texto pesquisado deve corresponder a itens exibidos; quizzes deletados não aparecem na busca normal e ficam na aba de excluídos.
2. **Discover — busca de conteúdo pronto.** O fluxo Discover usa uma lupa para pesquisar quizzes por título, assunto e conteúdo. Um menu lateral refina por assunto, série, palavras-chave e outros atributos.
3. **Detalhes e reutilização.** Ao abrir um resultado, o professor vê detalhes e uma prévia e pode copiar o quiz para sua própria biblioteca.
4. **Busca contextual no lançamento.** No fluxo de lançar um quiz, existe um campo no topo do menu para encontrar rapidamente o quiz pelo nome antes de configurar a atividade.

## Decisões do protótipo

O exemplo implementa os mesmos padrões funcionais em uma interface própria chamada **Atlas**:

- busca instantânea em título, assunto, descrição, palavras-chave e conteúdo;
- filtros combináveis de assunto, série e palavra-chave;
- ordenação por relevância ou A–Z;
- cartões com metadados, favoritos e detalhes;
- modal de detalhes com ação “Copiar para minha biblioteca”;
- views separadas para Descobrir e Minha biblioteca;
- atalho `⌘ K`/`Ctrl K` e estado vazio orientando a ampliar a consulta.

Os dados são locais e fictícios. Para produção, o próximo passo é trocar `seed` em `src/app.js` por uma API e persistir biblioteca, favoritos e permissões no backend.

## Fontes

- [Socrative Support — Discover](https://help.socrative.com/en/articles/6847555-discover)
- [Socrative Support — Searching for Folders and Quizzes](https://help.socrative.com/en/articles/2155321-searching-for-folders-and-quizzes)
- [Socrative Support — Launch a Quiz](https://help.socrative.com/en/articles/2155308-launch-a-quiz)
- [Socrative — página oficial](https://www.socrative.com/)

## Escopo e propriedade intelectual

Este é um protótipo independente, inspirado em comportamentos descritos publicamente. Ele não pretende ser uma clonagem visual, não usa o nome Socrative na interface e não reproduz código, marca, textos ou imagens proprietárias.
