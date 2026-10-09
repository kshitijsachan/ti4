#!/bin/sh
# Starts the AsyncTI4 bot against the TI4 Online shim.
# The shim generates the fake-Discord credentials (bot token, bot user id, guild id) on first start and
# keeps them in $SHIM_DATA/state.json. That volume is mounted read-only here at /shim-data, so we wait
# for it and export the values the bot expects. Explicit DISCORD_BOT_TOKEN/DISCORD_BOT_USERID/GUILDID_LIST
# env vars win if set.
set -eu
STATE=${SHIM_STATE_FILE:-/shim-data/state.json}

# state.json is minified JSON written by JSON.stringify; the three values are plain [A-Za-z0-9_.-] strings.
# (Escaped copies inside message text look like \"guild_id\":\" and never match this pattern.)
field() { grep -o -m1 "\"$1\":\"[A-Za-z0-9_.-]*\"" "$STATE" | head -n1 | sed 's/^"[a-z_]*":"//; s/"$//'; }

if [ -z "${DISCORD_BOT_TOKEN:-}" ] || [ -z "${DISCORD_BOT_USERID:-}" ] || [ -z "${GUILDID_LIST:-}" ]; then
  i=0
  while :; do
    if [ -s "$STATE" ]; then
      token=$(field bot_token); bot_id=$(field bot_id); guild_id=$(field guild_id)
      [ -n "$token" ] && [ -n "$bot_id" ] && [ -n "$guild_id" ] && break
    fi
    i=$((i + 1))
    if [ $((i % 15)) -eq 1 ]; then echo "entrypoint: waiting for shim credentials in $STATE ..."; fi
    if [ "$i" -gt 600 ]; then echo "entrypoint: gave up waiting for $STATE" >&2; exit 1; fi
    sleep 2
  done
  DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN:-$token}
  DISCORD_BOT_USERID=${DISCORD_BOT_USERID:-$bot_id}
  GUILDID_LIST=${GUILDID_LIST:-$guild_id}
  export DISCORD_BOT_TOKEN DISCORD_BOT_USERID GUILDID_LIST
  echo "entrypoint: using shim credentials (bot user $DISCORD_BOT_USERID, guild $GUILDID_LIST)"
fi

: "${DISCORD_API_BASE:?DISCORD_API_BASE must point at the shim, e.g. http://shim:8090/api/v10/}"
# shellcheck disable=SC2086
exec java $JAVA_OPTS -jar /app/tibot.jar "$@"
