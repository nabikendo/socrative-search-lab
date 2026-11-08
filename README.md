# Atlas — provas em rede local

O Atlas é um sistema web open source para aplicar provas em uma rede local, sem depender da Internet durante a aula. O notebook do professor hospeda a aplicação; os Chromebooks e o tablet acessam páginas pelo navegador Chrome.

> O projeto foi inspirado em padrões públicos de busca de avaliações do Socrative, mas é uma implementação independente. Não use a marca, os textos ou os dados do Socrative em produção.

## O que este MVP já faz

- hospeda a interface e a API no notebook;
- funciona por endereço local, sem Internet durante a prova;
- permite importar uma lista de frequência em PDF, CSV ou TXT pela página principal;
- usa o número da coluna `#` para localizar o nome do aluno;
- permite criar uma prova pelo painel do professor;
- abre a prova para os alunos;
- salva respostas no servidor local a cada alteração;
- permite retomar uma sessão ainda não enviada;
- bloqueia a sessão depois do envio;
- mostra sessões recebidas no painel do professor;
- exporta resultados em CSV;
- é responsivo para notebook, tablet e Chromebook.

Os dados ficam no arquivo local `data/atlas-data.json`. Essa solução é adequada para um primeiro piloto. Antes de usar em uma avaliação oficial, faça testes com a rede e mantenha uma cópia de segurança desse arquivo.

## Equipamentos necessários

Você precisa de:

1. um notebook Windows, Linux ou macOS para ser o servidor;
2. um roteador Wi-Fi, mesmo sem cabo de Internet;
3. os Chromebooks dos alunos;
4. opcionalmente, um tablet para abrir o painel do professor;
5. o arquivo de frequência da turma.

O roteador cria a rede local. Ele sozinho não hospeda a prova. O notebook precisa permanecer ligado e conectado ao roteador durante toda a atividade.

```text
Roteador Wi-Fi sem Internet
    ├── Notebook do professor: servidor Atlas
    ├── Chromebooks: prova
    └── Tablet: painel opcional
```

## 1. Preparar o notebook antes da aula

Faça a instalação inicial enquanto o notebook ainda tem Internet.

### Windows

1. Instale o **Node.js LTS** em [nodejs.org](https://nodejs.org/).
2. Abra o **PowerShell**.
3. Confirme a instalação:

```powershell
node --version
npm --version
```

### Linux ou macOS

Instale o Node.js LTS pelo gerenciador de pacotes da sua distribuição ou por [nodejs.org](https://nodejs.org/). Depois abra o Terminal:

```bash
node --version
npm --version
```

Os comandos seguintes são iguais nos três sistemas.

## 2. Baixar o projeto

Com Git instalado:

```bash
git clone https://github.com/nabikendo/socrative-search-lab.git
cd socrative-search-lab
npm install
```

Se o notebook não tiver Git, baixe o ZIP pelo botão **Code → Download ZIP** no GitHub, extraia a pasta e abra o Terminal/PowerShell dentro dela. Depois execute:

```bash
npm install
```

O `npm install` precisa de Internet apenas na primeira preparação, porque baixa o Node.js package PDF.js e o Vite. Durante a aula, o servidor não precisa acessar a Internet.

## 3. Conectar os equipamentos ao roteador

1. Ligue o roteador.
2. Configure um nome simples para a rede, por exemplo `PROVA_ESCOLA`.
3. Defina uma senha.
4. Não é necessário conectar o roteador à Internet.
5. Conecte o notebook à rede Wi-Fi do roteador.
6. Conecte os Chromebooks à mesma rede.
7. Conecte o tablet à mesma rede, se for usá-lo.

Todos os equipamentos precisam estar na mesma rede. Se o Chromebook estiver usando outra rede, ele não encontrará o notebook.

## 4. Iniciar o servidor no notebook

Na pasta do projeto, execute:

```bash
npm run server
```

Esse comando gera a aplicação e inicia o servidor na porta `8080`. O terminal exibirá endereços parecidos com estes:

```text
Atlas local ativo em http://localhost:8080
Na rede: http://192.168.0.25:8080
Professor: /professor | Alunos: /prova
```

O endereço importante é o que aparece depois de **Na rede**. O IP pode ser diferente em cada rede. Neste tutorial usaremos `192.168.0.25` como exemplo.

Não feche a janela do Terminal/PowerShell durante a aula. Para parar o servidor, pressione `Ctrl + C` no notebook.

## 5. Permitir o acesso no Windows

Na primeira execução, o Windows Firewall pode perguntar se o Node.js pode se comunicar em redes privadas.

1. Marque **Redes privadas**.
2. Permita o acesso.
3. Não é necessário habilitar redes públicas.

Se a janela não aparecer e os alunos não conseguirem abrir a página, abra o **Firewall do Windows Defender → Permitir um aplicativo** e permita o Node.js em redes privadas. Em uma rede escolar administrada, peça ao responsável de TI para liberar a porta TCP `8080` somente na rede local.

## 6. O que cada pessoa deve abrir

### Professor no notebook

Abra:

```text
http://localhost:8080/professor
```

### Professor no tablet

Abra o endereço de rede do notebook:

```text
http://192.168.0.25:8080/professor
```

Troque `192.168.0.25` pelo IP que o comando exibiu.

### Alunos nos Chromebooks

Abra:

```text
http://192.168.0.25:8080/prova
```

O tablet e os Chromebooks não devem abrir `localhost`, porque `localhost` significa o próprio dispositivo. Eles devem usar o IP do notebook.

## 7. Importar o PDF de frequência

O diário de classe enviado tem a estrutura:

```text
#   Estudante
3   ÂNGELO AUGUSTO...
5   BRENO LEONARDO...
7   CARLOS EDUARDO...
```

Para carregar essa lista:

1. No notebook ou tablet, abra `http://IP-DO-NOTEBOOK:8080/`.
2. Clique em **Lista de frequência**.
3. Clique em **Selecionar arquivo**.
4. Escolha o PDF do diário de classe.
5. Aguarde a mensagem com a quantidade de alunos identificados.
6. Clique em **Enviar lista para o servidor local**.
7. Abra `/professor` e confirme a lista.

A leitura é feita pelo navegador. O PDF não é enviado para a Internet. O projeto não publica os nomes do arquivo original.

Se o PDF não for reconhecido corretamente, use um CSV com este formato:

```csv
numero,nome,turma
3,Aluno Um,13.01
5,Aluno Dois,13.01
7,Aluno Três,13.01
```

No painel do professor, também é possível colar linhas simples:

```text
3;Aluno Um
5;Aluno Dois
7;Aluno Três
```

## 8. Criar e abrir a prova

No painel `/professor`:

1. Confira a lista de frequência.
2. Informe o título da prova.
3. Mantenha o ID `demo` na primeira prova.
4. Escreva uma questão por linha.
5. Para múltipla escolha, separe alternativas com `|`:

```text
Qual partícula possui carga negativa? | Próton | Nêutron | Elétron
```

6. Para resposta curta, escreva somente a pergunta:

```text
Escreva uma palavra associada à tabela periódica.
```

7. Clique em **Salvar prova**.
8. Clique em **Abrir prova para alunos**.
9. Confirme a mensagem **Prova aberta**.

## 9. Fluxo do aluno

Cada aluno abre `/prova` e:

1. digita o número da coluna `#` da frequência;
2. clica em **Começar prova**;
3. confirma o nome mostrado pelo sistema;
4. responde às questões;
5. continua mesmo se a página recarregar, porque as respostas são salvas no notebook;
6. clica em **Enviar prova** somente quando terminar.

Depois do envio, a sessão fica bloqueada para evitar alterações posteriores.

## 10. Acompanhar e exportar resultados

No painel `/professor`:

- clique em **Atualizar** para consultar as sessões;
- os resultados também são atualizados automaticamente a cada 5 segundos;
- `active` significa que o aluno ainda está respondendo;
- `submitted` significa que a prova foi enviada;
- clique em **Baixar CSV** para baixar a lista de sessões e horários.

O CSV pode ser aberto no Excel, LibreOffice Calc ou Google Sheets depois que a Internet voltar.

## 11. Teste obrigatório antes da primeira aula

Faça este teste com Internet desligada:

1. ligue o roteador sem cabo de Internet;
2. conecte o notebook, um Chromebook e o tablet;
3. execute `npm run server`;
4. abra `/professor` no notebook;
5. carregue uma lista com três alunos fictícios;
6. abra a prova no Chromebook;
7. use o número de um aluno fictício;
8. responda e envie;
9. veja a sessão no painel;
10. baixe o CSV;
11. feche e reabra o navegador do Chromebook antes do envio para testar a recuperação.

Não use nomes reais nesse primeiro teste.

## Segurança e limitações

Esta primeira versão foi desenhada para uma rede local controlada. Ela não possui login de professor, criptografia de ponta a ponta, correção automática ou sincronização com a nuvem. Qualquer pessoa conectada à rede que descubra o endereço pode tentar abrir as páginas.

Para uma avaliação oficial, recomenda-se adicionar depois:

- código da turma e código da prova;
- autenticação do professor;
- HTTPS local ou rede isolada;
- banco SQLite em vez do JSON;
- correção automática por gabarito;
- backup automático em pendrive;
- sincronização posterior com a Internet;
- logs de auditoria;
- modo de recuperação quando o notebook reiniciar.

Mantenha o arquivo `data/atlas-data.json` em uma cópia de segurança após cada aula. Nunca publique esse arquivo no GitHub, porque ele pode conter nomes e respostas.

## Endereços rápidos

Com o exemplo `192.168.0.25`:

```text
Página principal: http://192.168.0.25:8080/
Professor:         http://192.168.0.25:8080/professor
Aluno:             http://192.168.0.25:8080/prova
Saúde da API:      http://192.168.0.25:8080/api/health
Resultados CSV:    http://192.168.0.25:8080/api/results.csv
```

## Desenvolvimento

```bash
npm install
npm run build
npm run server
```

O teste de ponta a ponta pode ser feito contra `http://localhost:8080` usando as rotas descritas na documentação. O repositório é público em [github.com/nabikendo/socrative-search-lab](https://github.com/nabikendo/socrative-search-lab).
