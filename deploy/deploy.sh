#!/usr/bin/env bash
# One-shot installer / updater for TI4 Online on a fresh Ubuntu (or Debian) VM, amd64 or arm64.
#
#   git clone https://github.com/kshitijsachan/ti4.git && sudo ti4/deploy/deploy.sh
#   # with your own domain (DNS A record -> this VM, ports 80+443 open), automatic HTTPS:
#   sudo DOMAIN=ti4.example.com ti4/deploy/deploy.sh
#
# Re-run it any time to update (git pull + rebuild). Data lives in Docker volumes and survives.
# Env knobs: DOMAIN, PUBLIC_URL (override the detected http://<ip>:8090), REPO_URL, BRANCH, TI4_DIR
#            (where to clone when not run from a checkout), BOT_MEMORY (default 3g).
set -euo pipefail

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo $0)"

REPO_URL=${REPO_URL:-https://github.com/kshitijsachan/ti4.git}
BRANCH=${BRANCH:-claude/ecstatic-franklin-lutbck}  # switch to main once merged
DOMAIN=${DOMAIN:-}

# ---- 1. Docker ----
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  log "Installing Docker (official convenience script)"
  apt-get update -y && apt-get install -y curl ca-certificates git
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true
command -v git >/dev/null 2>&1 || { apt-get update -y && apt-get install -y git; }

# ---- 2. swap on small boxes (the Maven + Vite builds and the bot JVM like headroom) ----
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 7000 ] && [ "$(swapon --show --noheadings | wc -l)" -eq 0 ] && [ ! -e /swapfile ]; then
  log "Adding a 4G swap file (RAM is ${mem_mb}MB)"
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---- 3. the code ----
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/docker-compose.yml" ] && [ -d "$SCRIPT_DIR/../.git" ]; then
  ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
else
  ROOT=${TI4_DIR:-/opt/ti4}
  if [ ! -d "$ROOT/.git" ]; then
    log "Cloning $REPO_URL into $ROOT"
    git clone --branch "$BRANCH" "$REPO_URL" "$ROOT"
  fi
fi
cd "$ROOT"
if [ -z "$(git status --porcelain --untracked-files=no)" ]; then
  log "Updating code"
  git pull --ff-only || echo "(git pull failed; building the current checkout)"
else
  echo "local changes in $ROOT; not pulling"
fi
cd deploy

# ---- 4. config (.env is created once, then left alone except PUBLIC_URL/DOMAIN overrides) ----
set_env() { # key value
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
if [ ! -f .env ]; then
  log "Writing deploy/.env"
  cp .env.example .env
  set_env POSTGRES_PASSWORD "$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
[ -n "${BOT_MEMORY:-}" ] && set_env BOT_MEMORY "$BOT_MEMORY"
PROFILE_ARGS=()
if [ -n "$DOMAIN" ]; then
  set_env DOMAIN "$DOMAIN"
  set_env PUBLIC_URL "${PUBLIC_URL:-https://$DOMAIN}"
  set_env SHIM_BIND 127.0.0.1
  PROFILE_ARGS=(--profile https)
elif grep -q '^DOMAIN=.\+' .env; then
  PROFILE_ARGS=(--profile https)
else
  if [ -n "${PUBLIC_URL:-}" ]; then
    set_env PUBLIC_URL "$PUBLIC_URL"
  elif ! grep -q '^PUBLIC_URL=.\+' .env; then
    ip=$(curl -fsS --max-time 5 https://api.ipify.org || curl -fsS --max-time 5 https://ifconfig.me || hostname -I | awk '{print $1}')
    port=$(grep '^SHIM_PORT=' .env | cut -d= -f2); port=${port:-8090}
    set_env PUBLIC_URL "http://$ip:$port"
  fi
fi

# Oracle's Ubuntu images ship an iptables INPUT REJECT rule; open our ports there too (harmless elsewhere).
if [ -f /etc/iptables/rules.v4 ] && command -v netfilter-persistent >/dev/null 2>&1; then
  for p in 80 443 "$(grep '^SHIM_PORT=' .env | cut -d= -f2)"; do
    [ -n "$p" ] || continue
    iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p tcp --dport "$p" -j ACCEPT
  done
  netfilter-persistent save >/dev/null 2>&1 || true
fi

# ---- 5. build + start ----
log "Building and starting (first build takes ~10-20 minutes: Maven bot build, ~1GB of art, Vite web build)"
docker compose "${PROFILE_ARGS[@]}" up -d --build --remove-orphans

log "Waiting for the site"
for _ in $(seq 1 60); do
  link=$(docker compose logs --no-log-prefix shim 2>/dev/null | grep -o 'admin link: .*' | tail -1 | sed 's/^admin link: //')
  [ -n "$link" ] && break
  sleep 2
done
[ -n "${link:-}" ] || die "shim did not print an admin link; check: cd $ROOT/deploy && docker compose logs shim"

cat <<MSG

  TI4 Online is up.

  Admin link (keep it secret; create players and copy their links here):
    $link

  The bot needs a few minutes on first start (it loads all game data and uploads emoji).
  Watch it with:   cd $ROOT/deploy && docker compose logs -f bot
  Status:          cd $ROOT/deploy && docker compose ps
  Update later:    sudo $ROOT/deploy/deploy.sh

MSG
