# Atlas Desktop — versão experimental

## Objetivo
Aplicativo instalado no Windows para aplicar provas pela rede local, sem depender de Internet durante as aulas.

## Compilar no Windows
Requer Node.js 22+, npm e acesso à Internet **apenas para instalar dependências e compilar**.

```powershell
npm install
npm test
npm run desktop:package
```

O instalador NSIS aparece em `release-desktop/Atlas-Setup-*.exe`.

## Execução
- O professor instala e abre o Atlas pelo atalho.
- O servidor inicia automaticamente e usa uma porta livre.
- O PIN aparece ao iniciar e no menu **Atlas > Mostrar PIN do professor**.
- O menu **Atlas > Endereço para os alunos** apresenta URLs da rede local.
- O computador e os dispositivos dos alunos devem estar na mesma rede, sem isolamento de clientes.
- O Windows Firewall pode exigir autorização para conexões em redes privadas.
- Os dados ficam em `app.getPath('userData')/data`, separados da instalação.

## Limitações da versão experimental
- O instalador ainda não é assinado digitalmente.
- O funcionamento em Windows real, o firewall e o empacotamento precisam de homologação.
- A porta dinâmica muda entre execuções; use o endereço mostrado na sessão atual.
- A autenticação do professor continua por PIN.
- A atualização automática ainda não está implementada.
- Não publicar em Releases como estável antes dos testes de regressão e recuperação.

## CI
O workflow `.github/workflows/desktop-windows.yml` executa testes, compila a interface, gera o instalador e anexa o `.exe` à execução. Após atualizar o `package-lock.json`, substituir `npm install` por `npm ci` para builds reprodutíveis.
