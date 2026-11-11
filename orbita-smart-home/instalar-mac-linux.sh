#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "========================================================"
echo "  ORBITA — Casa Inteligente // Setup Desktop (Mac/Linux)"
echo "========================================================"
if ! command -v node >/dev/null 2>&1; then
  echo "[!] Node.js (>=18) não encontrado. Instale em https://nodejs.org e rode novamente."
  exit 1
fi
echo "[1/2] Instalando dependências..."
npm install
echo ""
echo "Escolha uma opção:"
echo "  1) Abrir o App Desktop agora"
echo "  2) Gerar instalador nativo (.dmg no Mac / .AppImage e .deb no Linux) em dist/"
read -r -p "Digite 1 ou 2 [padrão=1]: " OPCAO
if [ "$OPCAO" = "2" ]; then
  if [ "$(uname)" = "Darwin" ]; then
    npm run build:mac
  else
    npm run build:linux
  fi
  echo "✅ Instalador gerado na pasta ./dist/"
else
  npm run desktop
fi
