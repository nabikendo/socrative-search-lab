# Atlas — provas em rede local

O Atlas deixa você aplicar provas na sala de aula **sem Internet**. O seu computador funciona como "servidor": os alunos abrem a prova pelo navegador do celular, tablet ou Chromebook, conectados ao mesmo Wi‑Fi. Nada precisa ser instalado nos aparelhos dos alunos.

| Professor | Aluno |
| --- | --- |
| Importa a lista da turma, cria a prova (ou anexa um PDF/DOCX), abre com um código e acompanha as respostas ao vivo. | Digita o código e o número da lista, confirma o nome e responde. As respostas são salvas a cada alteração, mesmo se o Wi‑Fi cair. |

![Painel de resultados](docs/img/resultados.png)

<p>
  <img src="docs/img/aluno-entrada.png" alt="Entrada do aluno" width="240" />
  <img src="docs/img/aluno-prova.png" alt="Prova no celular" width="240" />
</p>

> As imagens mostram dados de exemplo.

---

## Sumário

1. [O que você precisa](#1-o-que-você-precisa)
2. [Instalação (uma vez só)](#2-instalação-uma-vez-só)
3. [Dia a dia: aplicar uma prova](#3-dia-a-dia-aplicar-uma-prova)
4. [Como as notas funcionam](#4-como-as-notas-funcionam)
5. [Problemas comuns](#5-problemas-comuns)
6. [Segurança e privacidade](#6-segurança-e-privacidade)
7. [Dados, backup e atualização](#7-dados-backup-e-atualização)
8. [Para quem desenvolve](#8-para-quem-desenvolve)

---

## 1. O que você precisa

- Um **computador** (Windows, Mac ou Linux) que ficará ligado durante a prova.
- Um **roteador Wi‑Fi** (pode estar sem Internet). O computador e os aparelhos dos alunos precisam estar **na mesma rede**.
- **Internet apenas na primeira instalação**, para baixar o programa. Depois, funciona totalmente offline.
- O programa gratuito **Node.js** (o próprio Atlas ajuda você a instalá-lo, veja abaixo).

## 2. Instalação (uma vez só)

Você não precisa usar terminal, comandos nem saber programar.

**Passo 1. Baixe o Atlas.**
Nesta página do GitHub, clique no botão verde **Code** e depois em **Download ZIP**. Quando terminar, clique com o botão direito no arquivo baixado e escolha **Extrair tudo** (Windows) ou dê dois cliques (Mac). Guarde a pasta onde for fácil de achar, por exemplo em *Documentos*.

**Passo 2. Dê dois cliques para iniciar.**
Dentro da pasta, abra:

- **Windows:** `Iniciar-Atlas` (ícone de engrenagem, tipo "Arquivo em lotes do Windows").
- **Mac:** `Iniciar-Atlas.command`. Na primeira vez, clique com o botão direito → **Abrir** → **Abrir**, para o Mac confiar no arquivo.
- **Linux:** `./Iniciar-Atlas.command` no terminal ou pelo gerenciador de arquivos.

**Passo 3. Se pedir o Node.js, instale.**
Se o Node.js não estiver no computador, o Atlas abre a página [nodejs.org](https://nodejs.org/) para você. Baixe o botão **LTS**, instale clicando em *Avançar* até o fim e depois dê dois cliques em `Iniciar-Atlas` de novo.

**Passo 4. Aguarde a primeira preparação.**
Na primeira vez, a janela preta mostra o progresso (alguns minutos, com Internet). Depois disso o Atlas abre sozinho o painel do professor no navegador.

> Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo**. O arquivo apenas inicia o Atlas.
>
> Na primeira execução o Windows pode perguntar sobre o **Firewall**. Marque **Redes privadas** e clique em **Permitir acesso**. Sem isso os alunos não conseguem abrir a prova.

## 3. Dia a dia: aplicar uma prova

### Antes da aula

1. Dê dois cliques em `Iniciar-Atlas`. **Deixe a janela preta aberta** durante toda a aula; para encerrar, basta fechá-la.
2. O navegador abre em `/professor`. Digite o **PIN** que aparece na janela preta (6 números). O PIN é sempre o mesmo, fica guardado no arquivo `data/pin.txt`.

### Passo 1: Turma (só na primeira vez)

Na aba **Turma**, importe a lista de alunos. Aceita **PDF do diário de classe**, planilha **.xlsx**, **.csv** ou texto colado, no formato `número;nome;turma`. O Atlas mostra uma prévia: confira e clique em **Importar**.

![Aba Turma](docs/img/turma.png)

### Passo 2: Prova

Na aba **Prova**:

1. Dê um **título**.
2. Escreva as questões. Em **múltipla escolha**, marque o círculo ao lado da alternativa correta para a correção ser automática. Use **Questão aberta** para respostas escritas.
3. Ajuste o **peso** de cada questão (a nota é a soma dos pesos).
4. *(Opcional)* **Anexe um PDF ou DOCX** com textos, figuras ou tabelas. O aluno vê o arquivo junto das questões.
5. Clique em **Salvar**.

**Atalho para colar várias questões de uma vez**, uma por linha, em "Colar várias questões em texto":

```text
Qual partícula tem carga negativa? | Próton | *Elétron | Nêutron
Explique a ligação iônica. || peso=2
```

A alternativa com `*` é a correta. `|| peso=2` define o peso (padrão 1).

![Editor de prova](docs/img/prova.png)

### Passo 3: Abrir para os alunos

Clique em **Abrir para os alunos**. O painel mostra o **código de 4 números**, o **endereço** e um **QR Code**. Peça aos alunos que:

1. Conectem o aparelho ao Wi‑Fi da sala.
2. Abram o **QR Code** com a câmera (ou digitem o endereço mostrado, algo como `http://192.168.0.25:8080/prova`).
3. Digitem o **código** e o **número da lista de frequência**.
4. Confirmem o nome, respondam e toquem em **Enviar prova**.

> Os alunos devem usar o endereço com números (o `192.168…`), **nunca** `localhost`.

### Passo 4: Resultados

Na aba **Resultados**, em tempo real:

- quantos alunos estão online e quantos já enviaram;
- a **média** da turma;
- o **desempenho por questão** (% de acerto e o erro mais comum), para ver o que a turma não aprendeu;
- a lista de alunos: toque em um nome para ver as respostas e **dar nota às questões abertas**;
- **Reabrir para o aluno**, caso alguém envie sem querer;
- **Baixar planilha**, um arquivo que abre direto no Excel, com acentos e vírgulas decimais corretos.

Para encerrar, volte à aba **Prova** e clique em **Encerrar prova**. Respostas já salvas são mantidas.

### Antes da primeira aula de verdade

Faça um teste com Internet desligada e alguns alunos fictícios: abra a prova em um aparelho, responda, desligue o Wi‑Fi por um minuto (aparece "Sem conexão" e as respostas ficam guardadas no aparelho), religue, envie e baixe a planilha.

## 4. Como as notas funcionam

| Tipo de questão | Nota |
| --- | --- |
| Múltipla escolha **com** alternativa correta marcada | Automática: o peso inteiro ou zero |
| Múltipla escolha **sem** gabarito, ou questão aberta | Manual, de 0 até o peso da questão |

A nota aparece como `pontos/máximo`, junto com quantas respostas aguardam correção. O gabarito **nunca** é enviado ao aluno.

## 5. Problemas comuns

**Os alunos não conseguem abrir a página.**
Confira nesta ordem: (1) o computador e os aparelhos estão no **mesmo Wi‑Fi**? (2) os alunos estão usando o endereço com números mostrado no painel, e não `localhost`? (3) a janela preta do Atlas continua aberta? (4) no Windows, libere o **Firewall** para **Redes privadas** ou a porta **8080** (Painel de Controle → Firewall do Windows → *Permitir um aplicativo*, marque Node.js). (5) algumas redes de escola bloqueiam a comunicação entre aparelhos: use um roteador próprio ou o "ponto de acesso" do celular.

**Esqueci o PIN.**
Abra o arquivo `data/pin.txt` com o Bloco de Notas. O PIN também aparece na janela preta ao iniciar.

**Aparece "A porta 8080 já está em uso".**
O Atlas já está aberto em outra janela. Feche-a e tente de novo.

**"Número não encontrado na lista".**
O aluno digitou um número que não está na turma importada. Confira a aba **Turma**.

**"Este número já está em uso em outro aparelho".**
Outro aparelho está usando o mesmo número agora. Se o aluno trocou de aparelho, espere cerca de 30 segundos e tente de novo.

**O aluno enviou sem querer.**
Em **Resultados**, abra o aluno e clique em **Reabrir para o aluno**.

**O PDF anexado não aparece no celular.**
Alguns celulares não mostram PDF dentro da página. Toque em **Abrir o documento em tela cheia**, ou use um **DOCX**, que é exibido direto na prova.

**Importei a lista do diário em PDF e vieram nomes errados.**
A leitura de PDF depende do formato do diário. Se necessário, cole a lista como texto (`3;Nome do aluno`) ou use uma planilha.

**Preciso trocar a prova depois que alunos já responderam.**
As questões ficam travadas. Use **Duplicar** para criar uma cópia e alterar.

## 6. Segurança e privacidade

- O painel do professor exige **PIN** (sessão de 12 h, com limite de tentativas).
- O aluno precisa do **código da prova**. Um número já em uso em outro aparelho é bloqueado; ao recarregar a página, o mesmo aparelho continua de onde parou.
- Cada aluno envia a prova **uma única vez**; só o professor reabre.
- Textos dos alunos e documentos DOCX são exibidos com proteção contra código malicioso, e os arquivos enviados são validados pelo conteúdo.
- Nenhuma fonte, script ou imagem vem da Internet.
- Os dados dos alunos ficam **só neste computador**. **Nunca publique a pasta `data/`.**
- Limite conhecido: a rede da sala não usa HTTPS. Use um Wi‑Fi com senha própria e não compartilhe o código da prova fora da turma.

## 7. Dados, backup e atualização

Tudo fica na pasta `data/`: banco `atlas.sqlite`, anexos em `documents/`, o PIN em `pin.txt` e cópias automáticas em `backups/` (a cada 5 minutos, quando há mudanças, mantendo as 20 mais recentes).

- **Guardar uma aula:** feche o Atlas e copie a pasta `data/` inteira para um pendrive.
- **Restaurar:** feche o Atlas e substitua a pasta `data/`.
- **Atualizar o Atlas:** baixe o ZIP novo, extraia e **copie sua pasta `data/` antiga** para dentro da nova antes de iniciar.
- **Desinstalar:** apague a pasta do Atlas.

## 8. Para quem desenvolve

```bash
git clone https://github.com/nabikendo/socrative-search-lab.git
cd socrative-search-lab
npm install
npm run dev     # desenvolvimento com recarga automática (Vite)
npm test        # testes automáticos
npm start       # compila e inicia o servidor (porta 8080)
```

Requer Node.js **22.13+**. Variáveis opcionais: `PORT`, `ATLAS_PIN`, `ATLAS_DATA_DIR`.

```text
server.mjs        servidor HTTP, rotas e regras de acesso
lib/              banco SQLite (node:sqlite) e leitura de DOCX
shared/           regras de prova, notas e leitura de listas (usadas no servidor e no navegador)
src/professor/    painel do professor (Turma, Prova, Resultados)
src/prova.js      tela do aluno, com fila offline
src/styles/       sistema de design (claro e escuro, sem fontes externas)
scripts/          verificação do Node usada pelos arquivos Iniciar-Atlas
test/             testes da API
docs/             AUDIT.md (auditoria de segurança), ROADMAP.md (próximos passos)
```
