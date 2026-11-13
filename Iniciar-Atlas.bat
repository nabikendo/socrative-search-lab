@echo off
chcp 65001 >nul
title Atlas - Provas
cd /d "%~dp0"
echo.
echo   Atlas - Provas em rede local
echo   ----------------------------
echo.
set "NODE=%~dp0runtime\node.exe"
if exist "%NODE%" goto temnode
where node >nul 2>nul
if errorlevel 1 goto semnode
set "NODE=node"
:temnode
"%NODE%" scripts\check-node.mjs
if errorlevel 1 goto nodevelho
if exist node_modules goto compilar
:instalar
echo   Preparando o Atlas pela primeira vez. Pode levar alguns minutos e precisa de Internet.
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto erro
:compilar
if exist dist\index.html goto iniciar
echo   Montando as telas do Atlas...
call npm run build
if errorlevel 1 goto erro
:iniciar
start "" cmd /c "timeout /t 3 >nul & start http://localhost:8080/professor"
echo   Deixe esta janela ABERTA durante a aula. Para encerrar, feche-a.
"%NODE%" --disable-warning=ExperimentalWarning server.mjs
echo.
echo   O Atlas foi encerrado.
pause
exit /b
:semnode
echo   O programa Node.js ainda nao esta instalado neste computador.
echo   Vou abrir a pagina de download: baixe a versao "LTS", instale (Avancar, Avancar...)
echo   e depois de dois cliques em "Iniciar-Atlas" de novo.
echo   (Ou baixe o pacote "Atlas-Windows.zip" na pagina Releases, que ja inclui tudo.)
start https://nodejs.org/
pause
exit /b
:nodevelho
pause
exit /b
:erro
echo.
echo   Algo deu errado. Tire uma foto desta tela e envie para quem cuida do sistema.
pause
