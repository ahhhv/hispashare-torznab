#!/bin/sh
# Prueba rápida del indexador con curl.
#
#   ./scripts/test.sh                       → contra http://localhost:9118 con TORZNAB_APIKEY
#   URL=http://orangepi:9118 TORZNAB_APIKEY=xxx ./scripts/test.sh
#   ./scripts/test.sh --mock                → arranca el mock y el indexador en local (sin token real)
#
# Con un token real, IMDB_TV / IMDB_MOVIE / Q_TV / SEASON / EP / Q_MOVIE permiten
# probar títulos que existan en Hispashare. Cada búsqueda nueva gasta peticiones
# de tu cuota: no lo lances en bucle.

set -eu
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--mock" ]; then
  MOCK_PORT=${MOCK_PORT:-8099}
  PORT=${PORT:-9118}
  MOCK_PORT=$MOCK_PORT node mock/server.js >/tmp/hs-mock.log 2>&1 &
  MOCK_PID=$!
  HISPASHARE_TOKEN=test-token HISPASHARE_API_URL="http://127.0.0.1:$MOCK_PORT" \
    TORZNAB_APIKEY=test-apikey PORT=$PORT LOG_LEVEL=${LOG_LEVEL:-info} node src/server.js >/tmp/hs-torznab.log 2>&1 &
  SRV_PID=$!
  trap 'kill $MOCK_PID $SRV_PID 2>/dev/null || true' EXIT INT TERM
  sleep 1
  URL="http://127.0.0.1:$PORT"
  TORZNAB_APIKEY=test-apikey
fi

URL=${URL:-http://localhost:9118}
KEY=${TORZNAB_APIKEY:?Define TORZNAB_APIKEY}
IMDB_TV=${IMDB_TV:-tt9900001}
SEASON=${SEASON:-2}
EP=${EP:-1}
Q_TV=${Q_TV:-El%20instituto}
IMDB_MOVIE=${IMDB_MOVIE:-tt9900003}
Q_MOVIE=${Q_MOVIE:-The%20Last%20Frontier}

FAIL=0
check() {
  name=$1; qs=$2; expect=$3
  body=$(curl -s -w '\n%{http_code}' "$URL/api?apikey=$KEY&$qs")
  code=$(printf '%s' "$body" | tail -n1)
  xml=$(printf '%s' "$body" | sed '$d')
  n=$(printf '%s' "$xml" | grep -c '<item>' || true)
  if [ "$code" = "200" ] && printf '%s' "$xml" | grep -q "$expect"; then
    printf 'OK    %-38s (HTTP %s, %s resultados)\n' "$name" "$code" "$n"
  else
    printf 'FALLO %-38s (HTTP %s, %s resultados)\n' "$name" "$code" "$n"; FAIL=1
    printf '%s\n' "$xml" | head -5
  fi
  printf '%s\n' "$xml" | grep -o '<title>[^<]*</title>' | sed -n '2,4p;' | sed 's/<[^>]*>//g; s/^/        /'
}

printf 'Indexador: %s\n\n' "$URL"
curl -sf "$URL/health" >/dev/null && echo "OK    /health" || { echo "FALLO /health"; FAIL=1; }
check "caps"                             "t=caps"                                               '<tv-search available="yes"'
check "search (texto)"                   "t=search&q=$Q_TV"                                     '<rss'
check "tvsearch imdbid+season+ep"        "t=tvsearch&imdbid=$IMDB_TV&season=$SEASON&ep=$EP"     '<item>'
check "tvsearch imdbid+season"           "t=tvsearch&imdbid=$IMDB_TV&season=$SEASON"            '<item>'
check "tvsearch q+season+ep"             "t=tvsearch&q=$Q_TV&season=$SEASON&ep=$EP"             '<item>'
check "movie imdbid"                     "t=movie&imdbid=$IMDB_MOVIE"                           '<item>'
check "movie q"                          "t=movie&q=$Q_MOVIE"                                   '<item>'
check "RSS (sin parámetros)"             "t=search"                                             '<item>'
check "RSS tv (cat=5000)"                "t=tvsearch&cat=5000"                                  '<rss'
check "RSS movies (cat=2000)"            "t=movie&cat=2000"                                     '<rss'

code=$(curl -s -o /dev/null -w '%{http_code}' "$URL/api?apikey=incorrecta&t=caps")
[ "$code" = "401" ] && echo "OK    apikey incorrecta → 401" || { echo "FALLO apikey incorrecta → $code"; FAIL=1; }

echo
[ "$FAIL" = 0 ] && echo "Todo correcto." || { echo "Hay fallos."; exit 1; }
