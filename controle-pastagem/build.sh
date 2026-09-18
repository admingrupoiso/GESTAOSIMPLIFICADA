#!/usr/bin/env bash
# Monta o único arquivo HTML final a partir dos 4 pedaços em src/.
# Por quê dividido? Só pra ficar editável — o produto entregue ao cliente
# é sempre um .html único e autocontido (sem servidor, sem build step
# nenhum na mão do usuário final).
#
# Uso:
#   ./build.sh                → gera dist/controle-pastagem.html
#   ./build.sh saida.html     → gera saida.html no lugar

set -e
cd "$(dirname "$0")"

SAIDA="${1:-dist/controle-pastagem.html}"
mkdir -p "$(dirname "$SAIDA")"

cat src/01-head.html src/02-body.html > /tmp/_cp_topo.html
echo '<script>' > /tmp/_cp_script_open.html

cat /tmp/_cp_topo.html /tmp/_cp_script_open.html src/03-data.js src/04-app.js > "$SAIDA"
printf '</script>\n</body>\n</html>\n' >> "$SAIDA"

rm -f /tmp/_cp_topo.html /tmp/_cp_script_open.html

# valida sintaxe do JS embutido antes de dar como pronto
node -e "
const fs = require('fs');
const html = fs.readFileSync('$SAIDA', 'utf-8');
const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const ultimo = blocos[blocos.length-1][1];
new Function(ultimo); // lança SyntaxError se estiver quebrado
console.log('OK — sintaxe do JS validada, ' + (html.length/1024).toFixed(0) + ' KB');
"

echo "Build pronto: $SAIDA"
