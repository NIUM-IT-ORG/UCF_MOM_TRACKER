#!/usr/bin/env bash
#
# restore.sh — put a backup back.
#
#     sudo -u mom /opt/mom/app/deploy/restore.sh --latest
#     sudo -u mom /opt/mom/app/deploy/restore.sh s3://ucf-mom-files/backups/2026/09/mom_tracker-20260917T013000Z.dump
#     sudo -u mom /opt/mom/app/deploy/restore.sh /opt/mom/backups/mom_tracker-20260917T013000Z.dump
#
# A backup nobody has ever restored is a hope, not a backup. Run this against
# a scratch database once a quarter — `--into mom_restore_drill` does exactly
# that and touches nothing else:
#
#     sudo -u mom /opt/mom/app/deploy/restore.sh --latest --into mom_restore_drill
#
# Restoring over the live database stops the application first, on purpose:
# a half-restored database being served to officers is the worst of both.

set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL is not set — run this via: set -a; . /etc/mom/mom.env; set +a}"

# shellcheck source=deploy/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

SOURCE=""
TARGET_DB=""
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --latest)  SOURCE="latest"; shift ;;
    --into)    TARGET_DB="${2:?--into needs a database name}"; shift 2 ;;
    --yes|-y)  ASSUME_YES=1; shift ;;
    -*)        echo "unknown option: $1" >&2; exit 2 ;;
    *)         SOURCE="$1"; shift ;;
  esac
done

log()  { printf '[restore] %s\n' "$*"; }
die()  { printf '[restore] FAILED: %s\n' "$*" >&2; exit 1; }

[[ -n $SOURCE ]] || die "give a dump path, an s3:// URI, or --latest"

if [[ $SOURCE == "latest" ]]; then
  : "${BACKUP_S3_URI:?BACKUP_S3_URI is not set}"
  SOURCE="$(aws s3 cp "$BACKUP_S3_URI/LATEST" - | tr -d '[:space:]')"
  [[ -n $SOURCE ]] || die "no LATEST pointer in $BACKUP_S3_URI"
  log "latest is $SOURCE"
fi

if [[ $SOURCE == s3://* ]]; then
  local_copy="$(mktemp -t mom-restore-XXXXXX.dump)"
  # shellcheck disable=SC2064
  trap "rm -f '$local_copy'" EXIT
  log "downloading $SOURCE"
  aws s3 cp "$SOURCE" "$local_copy" --only-show-errors || die "download failed"
  SOURCE="$local_copy"
fi

[[ -r $SOURCE ]] || die "cannot read $SOURCE"

log "checking the dump before touching any database"
tables=$(pg_restore --list "$SOURCE" | grep -c 'TABLE DATA' || true)
[[ ${tables:-0} -ge 10 ]] || die "that file lists only ${tables:-0} tables"
log "the dump holds $tables tables"

# Where is it going? Rewriting the database name in the URL keeps the host,
# the role and the password, which is what makes --into safe to type.
if [[ -n $TARGET_DB ]]; then
  target_url="$(libpq_url "$(with_db_name "$DATABASE_URL" "$TARGET_DB")")"
  log "restoring into the scratch database '$TARGET_DB' — the live database is untouched"
  # createdb takes a maintenance connection, so point it at a database that
  # certainly exists and name the new one as an argument.
  createdb --maintenance-db="$(libpq_url "$(with_db_name "$DATABASE_URL" postgres)")" \
    "$TARGET_DB" 2>/dev/null || log "'$TARGET_DB' already exists; it will be overwritten"
else
  target_url="$(libpq_url "$DATABASE_URL")"
  live_db="$(db_name_of "$DATABASE_URL")"
  echo
  echo "  This will REPLACE the live database '$live_db' with $SOURCE."
  echo "  Everything recorded since that dump was taken will be gone."
  echo
  if [[ $ASSUME_YES -ne 1 ]]; then
    read -r -p "  Type the database name to confirm: " typed
    [[ $typed == "$live_db" ]] || die "not confirmed"
  fi
  log "stopping the application"
  sudo systemctl stop mom-api mom-web
  # shellcheck disable=SC2064
  trap "log 'restarting the application'; sudo systemctl start mom-api mom-web" EXIT
fi

log "restoring"
# --clean --if-exists drops each object before recreating it, so this works
# into a database that already has a schema. --no-owner because the role on
# this box may not be the role the dump was taken as.
pg_restore --dbname="$target_url" --clean --if-exists --no-owner --no-privileges \
  --single-transaction "$SOURCE" || die "pg_restore exited non-zero — nothing was committed"

log "restored $tables tables"

if [[ -z $TARGET_DB ]]; then
  log "run the migrations in case the code is newer than the dump:"
  log "  cd /opt/mom/app && corepack pnpm exec prisma migrate deploy"
fi
