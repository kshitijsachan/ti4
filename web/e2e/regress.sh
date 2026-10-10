#!/bin/bash
# Integrator regression: wait for a quiet bot, run setup-flow.mjs (solo game → strategy phase, every player has a
# starting technology), and on success record the commit as last known good in /home/user/run/LAST_GOOD.
# Usage: web/e2e/regress.sh <seatToken> <tag> [baseUrl=http://127.0.0.1:8090]
set -u
token=$1; tag=$2; base=${3:-http://127.0.0.1:8090}
out=/home/user/run/screenshots/playtest/integrator
log=/home/user/run/shim.log
here=$(cd "$(dirname "$0")" && pwd)

# Wait (up to 10 min) for load < 2x CPUs, >= 3 GB available memory and no "bot busy" re-sends in the last 30s.
maxload=$(( $(nproc) * 2 ))
for i in $(seq 1 60); do
  load=$(cut -d' ' -f1 /proc/loadavg)
  since=$(date -d '-30 sec' +%H:%M:%S)
  busy=$(tail -2000 "$log" | awk -v s="$since" '$1 >= s && /bot busy/' | wc -l)
  healthy=$(curl -s -m 5 "$base/healthz" | grep -c '"bot":true')
  mem=$(free -g | awk '/Mem:/{print $7}')
  if [ "$healthy" = 1 ] && [ "$busy" = 0 ] && [ "$mem" -ge 3 ] && awk -v l="$load" -v m="$maxload" 'BEGIN{exit !(l < m)}'; then break; fi
  [ $((i % 6)) = 1 ] && echo "[regress] waiting: load=$load busy=$busy healthy=$healthy mem=${mem}G"
  sleep 10
done

start=$(date +%H:%M:%S)
commit=${BUILT:-$(git -C "$here" rev-parse --short HEAD)}  # the commit the prod build was made from
node "$here/setup-flow.mjs" "$base" "$token" "$out" "$tag"
rc=$?
if [ $rc = 0 ]; then
  echo "$commit $(date -u +%Y-%m-%dT%H:%M:%SZ) tag=$tag" > /home/user/run/LAST_GOOD
  echo "[regress] PASS at $commit (LAST_GOOD updated)"
  exit 0
fi
echo "[regress] FAIL rc=$rc at $commit — bot exceptions since $start:"
awk -v s="$start" '$1 >= s && /\[bot-log\]/ && /(Exception|ERROR|Error:)/' "$log" | grep -v http-errors | tail -15 | cut -c1-300
grep -nE "Exception|^\s+at ti4\." /home/user/run/bot.log | tail -15 | cut -c1-300
exit $rc
