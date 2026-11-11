#!/usr/bin/env bash
# ORBITA — teste rápido da API (servidor precisa estar rodando: npm start)
BASE="${1:-http://localhost:3000}"
echo "== ORBITA API TEST =="
echo "-- health";        curl -s "$BASE/api/health" | head -c 300; echo
echo "-- devices";       curl -s "$BASE/api/devices" | head -c 400; echo
echo "-- energy";        curl -s "$BASE/api/energy" | head -c 300; echo
echo "-- toggle luz";    curl -s -X POST "$BASE/api/devices/luz-sala/command" -H 'Content-Type: application/json' -d '{"action":"toggle","value":false}' | head -c 300; echo
echo "-- brightness";    curl -s -X POST "$BASE/api/devices/luz-sala/command" -H 'Content-Type: application/json' -d '{"action":"brightness","value":70}' | head -c 300; echo
echo "-- scene cinema";  curl -s -X POST "$BASE/api/scenes/cinema/activate" | head -c 300; echo
echo "-- integrations";  curl -s "$BASE/api/integrations/status" | head -c 300; echo
echo "== FIM =="
