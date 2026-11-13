#!/usr/bin/env bash
# Monta o pacote "pronto para usar" (inclui o Node.js, então o professor não instala nada).
# Uso: scripts/package.sh <nome-do-pacote> <windows|unix> <caminho-do-node>
set -euo pipefail
NAME="$1"; KIND="$2"; NODE_BIN="$3"
OUT="release/$NAME"
rm -rf "$OUT" "release/$NAME.zip"
mkdir -p "$OUT/runtime" "$OUT/scripts"
cp -r server.mjs package.json lib shared dist node_modules "$OUT/"
cp scripts/check-node.mjs "$OUT/scripts/"
cp README.md LEIA-ME.txt "$OUT/"
cp "$NODE_BIN" "$OUT/runtime/"
if [ "$KIND" = "windows" ]; then cp Iniciar-Atlas.bat "$OUT/"; else cp Iniciar-Atlas.command "$OUT/"; chmod +x "$OUT/Iniciar-Atlas.command" "$OUT/runtime/node"; fi
(cd release && zip -qr -y "$NAME.zip" "$NAME")
echo "Criado release/$NAME.zip"
