#!/bin/sh
# Fetch the upstream AsyncTI4 bot at the pinned commit (bot/UPSTREAM_COMMIT) and apply bot/patches/*.patch.
#
#   bot/fetch-upstream.sh <dest-dir>
#
# Used by deploy/bot.Dockerfile; also handy for a local checkout. Shallow-fetches only that one commit
# (the full upstream history is ~800MB). Upstream does not use Git LFS, so no LFS setup is needed.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
DEST=${1:?usage: fetch-upstream.sh <dest-dir>}
REPO=${UPSTREAM_REPO:-https://github.com/AsyncTI4/TI4_map_generator_bot.git}
COMMIT=$(tr -d ' \n\r' < "$HERE/UPSTREAM_COMMIT")

mkdir -p "$DEST"
cd "$DEST"
if [ ! -d .git ]; then
  git init -q
  git remote add origin "$REPO"
fi
git -c advice.detachedHead=false fetch -q --depth 1 origin "$COMMIT"
git -c advice.detachedHead=false checkout -q --force FETCH_HEAD
git reset -q --hard FETCH_HEAD
git clean -qfdx

for p in "$HERE"/patches/*.patch; do
  [ -e "$p" ] || continue
  echo "applying $(basename "$p")"
  git apply --whitespace=nowarn "$p"
done
echo "upstream $COMMIT ready in $DEST"
