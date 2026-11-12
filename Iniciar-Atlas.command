#!/bin/bash
# Mac e Linux: dê dois cliques (Mac) ou rode ./Iniciar-Atlas.command
cd "$(dirname "$0")" || exit 1
echo
echo "  Atlas - Provas em rede local"
echo "  ----------------------------"
echo
if ! command -v node >/dev/null 2>&1; then
  echo "  O programa Node.js ainda não está instalado neste computador."
  echo "  Vou abrir a página de download: baixe a versão LTS, instale e abra este arquivo de novo."
  (open https://nodejs.org/ || xdg-open https://nodejs.org/) >/dev/null 2>&1
  read -r -p "  Pressione Enter para fechar." _; exit 1
fi
node scripts/check-node.mjs || { read -r -p "  Pressione Enter para fechar." _; exit 1; }
if [ ! -d node_modules ]; then
  echo "  Preparando o Atlas pela primeira vez. Pode levar alguns minutos e precisa de Internet."
  npm install --no-audit --no-fund || { echo "  Algo deu errado. Tire uma foto desta tela."; read -r -p "  Enter para fechar." _; exit 1; }
fi
if [ ! -f dist/index.html ]; then
  echo "  Montando as telas do Atlas..."
  npm run build || { echo "  Algo deu errado. Tire uma foto desta tela."; read -r -p "  Enter para fechar." _; exit 1; }
fi
( sleep 3; (open http://localhost:8080/professor || xdg-open http://localhost:8080/professor) >/dev/null 2>&1 ) &
echo "  Deixe esta janela ABERTA durante a aula. Para encerrar, feche-a (ou Ctrl+C)."
node --disable-warning=ExperimentalWarning server.mjs
read -r -p "  O Atlas foi encerrado. Pressione Enter para fechar." _
