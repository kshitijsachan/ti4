#!/bin/sh
# Build the images on a machine whose outbound HTTPS goes through a local TLS-intercepting proxy
# (e.g. a sandboxed dev container). Proxy settings and the CA are passed as a build arg / build secret
# only, so nothing ends up in the images. Normal hosts just run `docker compose build`.
#
#   PROXY=http://127.0.0.1:43679 CA=/root/.ccr/agent-proxy-ca.crt deploy/local-proxy-build.sh [app|bot]...
set -eu
cd "$(dirname "$0")/.."
PROXY=${PROXY:-${HTTPS_PROXY:?set PROXY or HTTPS_PROXY}}
CA=${CA:?set CA to the proxy CA certificate (PEM, single cert)}
APP_IMAGE=${APP_IMAGE:-ti4-online/app:local}
BOT_IMAGE=${BOT_IMAGE:-ti4-online/bot:local}
[ $# -gt 0 ] || set -- app bot
for what in "$@"; do
  case "$what" in
    app) tag=$APP_IMAGE ;;
    bot) tag=$BOT_IMAGE ;;
    *) echo "unknown image $what" >&2; exit 2 ;;
  esac
  docker build --network host \
    --build-arg HTTPS_PROXY="$PROXY" --build-arg https_proxy="$PROXY" \
    --secret id=build_ca,src="$CA" \
    -f "deploy/$what.Dockerfile" -t "$tag" .
done
