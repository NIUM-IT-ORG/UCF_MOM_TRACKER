#!/usr/bin/env bash
#
# deploy.sh — build and release a new version, on the server.
#
#     ./deploy/deploy.sh            # deploy what is checked out
#     ./deploy/deploy.sh --pull     # fetch origin/main first
#
# This matches the server the application actually runs on: the checkout at
# /var/www/ucfmom, its own .env beside it, and two pm2 processes. The systemd
# layout described in provision.sh and parts of README.md was never built —
# following it produces "sudo: user 'mom' not found", which is how this file
# came to be rewritten.
#
# Everything is overridable, because the next environment will differ again:
#
#     APP_DIR=/srv/ucf ENV_FILE=/etc/ucf.env API_PROC=api ./deploy/deploy.sh
#
# The order matters and is the whole point of this file:
#
#   1. build first, while the old version is still serving
#   2. migrate second, still serving
#   3. restart last
#
# Building after stopping the processes means an outage as long as the build,
# and a failed build means no service at all rather than the old one. Migrating
# before the build would widen the window in which the running code is older
# than the schema underneath it.

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/var/www/ucfmom}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
API_PROC="${API_PROC:-ucfmom-api}"
WEB_PROC="${WEB_PROC:-ucfmom-web}"
BRANCH="${BRANCH:-main}"
PULL=0
[[ "${1:-}" == "--pull" ]] && PULL=1

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m [!]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m [x]\033[0m %s\n' "$*" >&2; exit 1; }

cd "$APP_DIR" || die "$APP_DIR is not there. Set APP_DIR to the checkout."
[[ -r $ENV_FILE ]] || die "cannot read $ENV_FILE"
command -v pm2 >/dev/null || die "pm2 is not on the PATH for this user."

# Load the environment for the migration and the smoke test. `set -a` exports
# everything; the quoting dance keeps values with spaces or '#' intact.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

grep -q 'REPLACE_ME' "$ENV_FILE" && die "$ENV_FILE still contains REPLACE_ME — fill it in first"

if [[ $PULL -eq 1 ]]; then
  # `--rebase --autostash`, never `reset --hard`.
  #
  # This server carries a deliberate local modification, and a hard reset
  # would delete it without saying so — the first anybody would know is a
  # behaviour quietly reverting in production. Autostash is the same
  # stash / pull / pop dance done by hand, minus the step somebody forgets.
  #
  # A conflict stops the deployment here, with the change still stashed and
  # the tree untouched, which is the right place to stop: `git stash list`
  # and `git stash pop` recover it.
  log "Pulling origin/$BRANCH"
  local_changes=$(git status --porcelain)
  [[ -n $local_changes ]] && warn "local changes present; they will be re-applied after the pull"
  git pull --rebase --autostash origin "$BRANCH" \
    || die "the pull did not apply cleanly. Your local changes are safe — check 'git stash list'."
fi

log "Deploying $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

log "Installing dependencies"
corepack pnpm install --frozen-lockfile --prod=false

log "Generating the Prisma client"
corepack pnpm exec prisma generate

log "Building"
# Node's default heap is too small for the Next build on a small box, and the
# failure looks like a compiler error rather than an out-of-memory.
NODE_OPTIONS="--max-old-space-size=3072" corepack pnpm build

log "Applying database migrations"
# `migrate deploy` only applies what is pending and never resets. `migrate dev`
# on a server would offer to drop the database, which is not a prompt anyone
# should be one keystroke away from at 9pm.
corepack pnpm exec prisma migrate deploy

log "Checking that the schema on disk matches the database"
corepack pnpm run assert:schema

log "Restarting"
pm2 restart "$API_PROC"
pm2 restart "$WEB_PROC"

# ─────────────────────────────── smoke test ───────────────────────────────
# A deployment that returns green having broken the site is worse than one that
# fails. Give it a moment to bind, then ask it whether it is actually up.
log "Waiting for the API"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${PORT:-4000}/${API_PREFIX:-api/v1}/health" >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 2
done
[[ $ok -eq 1 ]] || {
  warn "the API did not come up — the last 40 log lines:"
  pm2 logs "$API_PROC" --lines 40 --nostream || true
  die "deployment failed"
}

log "Waiting for the web app"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 -o /dev/null "http://127.0.0.1:${WEB_PORT:-3000}/"; then ok=1; break; fi
  sleep 2
done
[[ $ok -eq 1 ]] || {
  warn "the web app did not come up — the last 40 log lines:"
  pm2 logs "$WEB_PROC" --lines 40 --nostream || true
  die "deployment failed"
}

pm2 status

log "Deployed $(git rev-parse --short HEAD). Both processes answered."
