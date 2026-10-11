#!/bin/bash
# Continuous fuzzing: ws-fuzz back to back (a fresh solo game and seed each run, seat "Fuzz 1"), and ui-fuzz in
# browser chunks (<= 5 min each, under flock /tmp/ti4-heavy.lock, seat "Fuzz 2", alternating ?engine=1 / ?engine=0,
# one game kept across UI_CHUNKS_PER_GAME chunks). Every game the fuzzers create is ended. Violations are folded
# (deduped) into $FUZZ_DIR/VIOLATIONS.md after every run.
#   Stop:    touch /home/user/run/fuzz/STOP   (finishes the current run / chunk, ends the games, exits)
#   Bounded: run-forever.sh --once            (one ws run of WS_MINUTES and one UI chunk, then exit)
# Backs off (sleeps) while available memory < 4 GB. Env: WS_MINUTES (30), UI_EVERY_S (900), UI_CHUNKS_PER_GAME (6),
# UI_MINUTES (4.5), FUZZ_DIR (/home/user/run/fuzz).
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
F=${FUZZ_DIR:-/home/user/run/fuzz}
STOP=$F/STOP
LOG=$F/run-forever.log
WS_MINUTES=${WS_MINUTES:-30}
UI_EVERY_S=${UI_EVERY_S:-900}
UI_CHUNKS_PER_GAME=${UI_CHUNKS_PER_GAME:-6}
UI_MINUTES=${UI_MINUTES:-4.5}
ONCE=0; [ "${1:-}" = "--once" ] && ONCE=1
mkdir -p "$F"
log() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
token_of() { node -e 'const s=require(process.argv[1]);console.log(s.find(x=>x.name===process.argv[2]).token)' "$F/seats.json" "$1"; }
mem_ok() { [ "$(free -g | awk '/Mem:/{print $7}')" -ge 4 ]; }
fold() { node -e 'import(process.argv[1]).then(m=>m.foldViolations())' "$HERE/lib.mjs" 2>/dev/null; }
seed() { echo $(( (RANDOM << 15 | RANDOM) + 1 )); }

ws_loop() {
  while [ ! -e "$STOP" ]; do
    if ! mem_ok; then log "ws: low memory, backing off"; sleep 120; continue; fi
    s=$(seed)
    log "ws: seed $s"
    timeout $(( WS_MINUTES * 60 + 900 )) node "$HERE/ws-fuzz.mjs" --seed "$s" --seat "Fuzz 1" --minutes "$WS_MINUTES" > "$F/ws-current.out" 2>&1
    g=$(head -1 "$F/runs/ws-$s/game" 2>/dev/null)
    # Killed by the timeout before it ended its game: end it here.
    if [ -n "$g" ] && grep -q '^created$' "$F/runs/ws-$s/game" && ! grep -q '^ended$' "$F/runs/ws-$s/game"; then
      node /home/user/run/scripts/end-game.mjs "$g" "$(token_of "Fuzz 1")" >> "$LOG" 2>&1
    fi
    log "ws: seed $s done: $(grep -E '^[0-9:]+ done:' "$F/ws-current.out" | tail -1)"
    fold
    [ $ONCE = 1 ] && return
    sleep 20
  done
}

ui_game=""; ui_chunks=0; ui_mode=1
ui_end_game() {
  [ -n "$ui_game" ] && node /home/user/run/scripts/end-game.mjs "$ui_game" "$(token_of "Fuzz 2")" >> "$LOG" 2>&1
  ui_game=""; ui_chunks=0
}
ui_loop() {
  while [ ! -e "$STOP" ]; do
    if ! mem_ok; then log "ui: low memory, backing off"; sleep 120; continue; fi
    s=$(seed)
    gamearg=(); [ -n "$ui_game" ] && gamearg=(--game "$ui_game")
    log "ui: seed $s engine=$ui_mode game=${ui_game:-new}"
    # Creating the game happens outside the browser lock (it needs no browser); the chunk itself holds the lock.
    if [ -z "$ui_game" ]; then
      ui_game=$(node -e '
        import(process.argv[1]).then(async (m) => { const seat = await m.loadSeat("Fuzz 2"); console.log(await m.createSoloGame(seat.token, 3, () => {})); })' "$HERE/lib.mjs" 2>>"$LOG" | tail -1)
      [ -z "$ui_game" ] && { log "ui: could not create a game"; sleep 120; continue; }
      log "ui: created $ui_game"
    fi
    flock /tmp/ti4-heavy.lock timeout 330 node "$HERE/ui-fuzz.mjs" --seed "$s" --seat "Fuzz 2" --game "$ui_game" --engine "$ui_mode" --minutes "$UI_MINUTES" > "$F/ui-current.out" 2>&1
    pkill -f "ui-fuzz.mjs --seed $s" 2>/dev/null
    log "ui: seed $s done: $(grep -E '^[0-9:]+ done:' "$F/ui-current.out" | tail -1)"
    ui_chunks=$((ui_chunks + 1)); ui_mode=$((1 - ui_mode))
    phase=$(curl -s -m 10 "http://127.0.0.1:8081/api/public/game/$ui_game/web-data" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const w=JSON.parse(s);console.log(w.gameState.winner?"over":w.gameState.phase)}catch{console.log("gone")}})')
    if [ "$ui_chunks" -ge "$UI_CHUNKS_PER_GAME" ] || [ "$phase" = over ] || [ "$phase" = gone ] || [ "$phase" = finished ]; then ui_end_game; fi
    fold
    [ $ONCE = 1 ] && { ui_end_game; return; }
    for _ in $(seq 1 $((UI_EVERY_S / 10))); do [ -e "$STOP" ] && break; sleep 10; done
  done
  ui_end_game
}

log "run-forever start (once=$ONCE)"
ws_loop &
wpid=$!
ui_loop
wait $wpid
fold
log "run-forever stopped"
