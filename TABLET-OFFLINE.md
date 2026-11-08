# Uso em tablet e rede local

## O que o PDF enviado mostra

O diário de classe contém uma coluna `#` com o número do aluno e uma coluna `Estudante` com o nome. O cabeçalho também identifica componente, série, turma, turno e período. O sistema deve usar `#` como identificador e nunca pedir que o aluno digite o próprio nome.

O protótipo agora possui o botão **Lista de frequência**. Em um tablet, o professor pode selecionar um PDF, CSV ou TXT pelo navegador. A leitura é feita localmente, com a biblioteca PDF.js empacotada no projeto, e o arquivo não é enviado para a Internet. Os nomes ficam apenas no armazenamento local daquela sessão/dispositivo.

## Como o fluxo final deve funcionar

1. O professor conecta o tablet e os Chromebooks ao mesmo roteador Wi-Fi.
2. Um servidor local, que pode ser um Raspberry Pi, mini-PC ou computador reaproveitado, hospeda a aplicação.
3. O professor abre a página no tablet e importa a frequência.
4. O aluno acessa a mesma página no Chromebook e informa apenas o número da coluna `#`.
5. O servidor mostra o nome correspondente para confirmação e salva as respostas localmente.
6. O aluno toca em **Enviar prova** no final.
7. O professor acompanha e exporta os resultados pelo tablet.

O roteador cria a rede local, mas não hospeda a aplicação sozinho. O servidor local é necessário para entregar as páginas e receber as respostas sem Internet.

## Limite atual do protótipo

A interface e a leitura local do arquivo já estão demonstradas. O envio de provas para um servidor local, o painel do professor e a sincronização posterior com a nuvem ainda são etapas de produção. A próxima implementação deve adicionar uma API local com SQLite, autenticação por turma e fila de sincronização.

O repositório público não contém os nomes do PDF enviado; os dados do arquivo foram usados apenas para entender o formato da lista.
