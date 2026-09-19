#!/usr/bin/env bash
#
# deploy.sh — build and release a new version, on the server.
#
#     sudo -u mom /opt/mom/app/deploy/deploy.sh            # deploy what is checked out
#     sudo -u mom /opt/mom/app/deploy/deploy.sh --pull     # fetch origin first
#
# Ordinary user, never root: a deployment must not be able to change the
# firewall or the database role. Provisioning does that, once.
#
# The order matters and is the whole point of this file:
#
#   1. build first, while the old version is still serving
#   2. migrate second, still serving
#   3. restart last
#
# Building after stopping the services means an outage as long as the build,
# and a failed build means no service at all rather than the old one.

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/mom/app}"
ENV_FILE="${ENV_FILE:-/etc/mom/mom.env}"
PULL=0
[[ "${1:-}" == "--pull" ]] && PULL=1

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m [!]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m [x]\033[0m %s\n' "$*" >&2; exit 1; }

cd "$APP_DIR" || die "$APP_DIR is not there — has provision.sh run?"
[[ -r $ENV_FILE ]] || die "cannot read $ENV_FILE (this must run as the mom user)"

# Load the environment for the migration and the smoke test. `set -a` exports
# everything; the quoting dance keeps values with spaces or '#' intact.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

grep -q 'REPLACE_ME' "$ENV_FILE" && die "$ENV_FILE still contains REPLACE_ME — fill it in first"

if [[ $PULL -eq 1 ]]; then
  log "Fetching"
  git fetch --quiet origin
  git reset --hard --quiet origin/"$(git rev-parse --abbrev-ref HEAD)"
fi
log "Deploying $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

log "Installing dependencies"
corepack pnpm install --frozen-lockfile --prod=false

log "Generating the Prisma client"
corepack pnpm exec prisma generate

log "Building"
# Node's default heap is too small for the Next build on a 4 GB box, and the
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
sudo systemctl restart mom-api
sudo systemctl restart mom-web

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
  journalctl -u mom-api -n 40 --no-pager || true
  die "deployment failed"
}

log "Waiting for the web app"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 -o /dev/null "http://127.0.0.1:3000/"; then ok=1; break; fi
  sleep 2
done
[[ $ok -eq 1 ]] || {
  warn "the web app did not come up — the last 40 log lines:"
  journalctl -u mom-web -n 40 --no-pager || true
  die "deployment failed"
}

log "Deployed. $(git rev-parse --short HEAD) is live at ${WEB_ORIGIN:-this server}."
