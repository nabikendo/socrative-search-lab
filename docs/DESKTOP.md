# Atlas Desktop — Windows e rede local

## Como instalar
1. Abra o instalador do GitHub Releases na página da versão estável.
2. Após a instalação, inicie o **Atlas** pelo menu Iniciar ou atalho.
3. Abra **Atlas → Mostrar PIN do perfil principal** e entre no painel do professor.
4. Abra **Atlas → Endereço para os alunos** e informe o link exibido a quem está na mesma rede Wi-Fi.
5. No Windows, se necessário, autorize o Atlas no Firewall. A regra criada pelo aplicativo é **apenas para redes Privadas**; computadores da escola podem exigir configuração de rede pela equipe responsável.

A aplicação, banco SQLite, documentos e PIN do professor são armazenados no perfil do Windows e não na pasta do instalador.

## Atualização instalada pelo próprio Atlas

- No menu **Atlas → Canal de atualizações**, escolha **Somente versões estáveis** ou **Pré-lançamentos beta**.
- Use **Atlas → Buscar atualizações** (`Alt+U`). A Internet só é necessária para procurar/baixar a atualização, não para aplicar provas na LAN.
- Após baixar, use **Atlas → Instalar atualização baixada**. A instalação requer ausência de provas abertas ou pausadas, de provas agendadas para começar em 15 minutos e de sessões não entregues de provas fechadas nos últimos **3 dias**.
- Antes de instalar, o Atlas grava uma cópia preventiva no diretório de backups e só prossegue se a gravação funcionar. O instalador não é executado automaticamente ao encerrar o Atlas.

Se existem sessões não entregues, não tente resolver apagando dados ou reinstalando o aplicativo. Confira os resultados; caso alunos tenham respostas guardadas no celular, reabra a prova e peça que a sincronizem e entreguem, preservando o mesmo navegador/aparelho. A verificação de sessões não pode saber se um celular que nunca voltou à rede possui dados locais, portanto **não substitui a conferência presencial**.

## Recuperação das respostas

- Respostas de múltipla escolha e texto são mantidas localmente e enviadas ao computador do professor.
- Se o Wi-Fi falhar, o Atlas preserva a fila e tenta novamente. Uma resposta recusada por erro HTTP não é apagada silenciosamente.
- Se o armazenamento do navegador estiver cheio ou bloqueado, uma mensagem alerta que a resposta pode existir **somente na memória**. Nesse caso, mantenha a página aberta até o servidor confirmar.
- Em sessão encerrada, não limpe os dados do navegador do aluno. Caso existam respostas não confirmadas, peça que o professor reabra a aplicação para a sincronização.
- Provas e arquivos já salvos ficam na pasta de dados do Atlas; backups são independentes do instalador.

## Compilação e testes

Requer Node.js 24+ para desenvolver e Internet apenas para obter dependências:

```powershell
npm ci
npm test
npm run desktop:package
```

O CI testa em Node 24 e 26, gera o instalador NSIS, verifica o manifesto de atualização e abre a versão empacotada no Windows para confirmar que o painel responde.

## Limitações conhecidas

- O instalador não tem certificado de assinatura digital. O Windows pode exibir aviso de reputação do SmartScreen.
- A leitura de questões em PDF depende da qualidade do texto extraído; PDF digitalizado requer OCR instalado.
- A IA para gerar/analisar questões por descritor é opcional, funciona com provedores em nuvem (Gemini, ChatGPT, Claude…) configurados pelo professor e precisa de revisão pedagógica.
- A câmera móvel ao vivo via HTTP em endereço da rede local pode ser bloqueada pelo navegador; não depende disso a aplicação normal de provas.
- Testes automatizados não substituem teste de campo com a turma e computadores reais.

A versão atual não implementa integralmente os seis projetos do plano `docs/PLANO-AVALIACOES.md`; o plano permanece separado.
