#!/usr/bin/env bash
# One command to play locally: builds/starts the stack, waits until the game server is ready,
# makes sure you have a player seat, and opens your home page in the browser.
#
#   ./play.sh                 # start (first run builds, ~10–20 min) and open the game
#   ./play.sh --tunnel        # same, plus a public https://…trycloudflare.com link for friends
#   ./play.sh --stop          # stop everything (games are kept)
#   TI4_NAME="Sam" ./play.sh  # choose your player name (default: your computer user name)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$ROOT/deploy"
cd "$DEPLOY"
[ -f .env ] || cp .env.example .env

PROFILE=()
TUNNEL=0
for arg in "$@"; do
  case "$arg" in
    --tunnel) PROFILE=(--profile quicktunnel); TUNNEL=1 ;;
    --stop) docker compose --profile quicktunnel down; echo "Stopped. Your games are kept."; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

command -v docker >/dev/null || { echo "Docker isn't installed. On a Mac: brew install --cask orbstack && open -a OrbStack" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker isn't running. Open OrbStack (or Docker Desktop) and try again." >&2; exit 1; }

PORT="$(grep -E '^SHIM_PORT=' .env | cut -d= -f2 || true)"
PORT="${PORT:-8090}"
BASE="http://localhost:$PORT"

echo "Starting TI4 Online (the first build takes 10–20 minutes)…"
docker compose ${PROFILE[@]+"${PROFILE[@]}"} up -d --build

printf "Waiting for the game server"
for _ in $(seq 1 300); do
  if curl -fsS "$BASE/healthz" 2>/dev/null | grep -q '"bot":true'; then break; fi
  printf "."; sleep 3
done
echo
curl -fsS "$BASE/healthz" 2>/dev/null | grep -q '"bot":true' || {
  echo "The game server didn't come up. Logs: (cd deploy && docker compose logs --tail 100 bot shim)" >&2; exit 1; }

# Read the admin key and the existing seats from the shim's saved state.
state() { docker compose exec -T shim node -e "$1" "${@:2}"; }
KEY="$(state 'console.log(JSON.parse(require("fs").readFileSync("/data/state.json","utf8")).admin_token)')"

NAME="${TI4_NAME:-$(id -F 2>/dev/null || true)}"
NAME="${NAME:-${USER:-Host}}"
NAME="${NAME%% *}"

find_seat() {
  state "const s=JSON.parse(require('fs').readFileSync('/data/state.json','utf8'));
    const seats=Object.values(s.seats).filter(x=>!x.autopilot);
    const want=process.argv[1]||'';
    const mine=seats.find(x=>(s.users[x.user_id]?.global_name||'')===want);
    if(mine) console.log(mine.token);" "$NAME" 2>/dev/null || true
}

TOKEN="$(find_seat)"
if [ -z "$TOKEN" ]; then
  echo "Creating your player: $NAME"
  RESP="$(curl -fsS -X POST "$BASE/app/admin/players?key=$KEY" -H 'content-type: application/json' \
    -d "{\"names\":[\"$NAME\"]}")"
  TOKEN="$(printf '%s' "$RESP" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
fi
[ -n "$TOKEN" ] || { echo "Couldn't create your player seat." >&2; exit 1; }

URL="$BASE/play?t=$TOKEN"
echo
echo "You're in. Press \"Play solo\" to start a game against bots."
echo "  Your page:  $URL"
echo "  Host page (add friends, copy their links):  $BASE/admin?key=$KEY"
if [ "$TUNNEL" = 1 ]; then
  for _ in $(seq 1 20); do
    PUB="$(docker compose --profile quicktunnel logs cloudflared-quick 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1 || true)"
    [ -n "$PUB" ] && break; sleep 2
  done
  [ -n "${PUB:-}" ] && echo "  Public link for friends: replace $BASE with $PUB in their invite links."
fi

if command -v open >/dev/null; then open "$URL"; elif command -v xdg-open >/dev/null; then xdg-open "$URL" >/dev/null 2>&1; fi
