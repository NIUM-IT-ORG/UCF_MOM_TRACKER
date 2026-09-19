#!/usr/bin/env bash
#
# backup.sh — dump the database and put it in S3.
#
# Run by mom-backup.timer at 01:30 IST, or by hand:
#
#     sudo -u mom /opt/mom/app/deploy/backup.sh
#
# This is the file that pays for the decision not to use RDS. RDS would have
# done automated backups and point-in-time recovery for about ₹1,500 a month;
# this does the daily half of that for about ₹5. What it does not do is
# point-in-time recovery, so the exposure is "up to 24 hours of work", and that
# is a deliberate, written-down trade rather than an oversight.
#
# Three things here are not optional:
#
#   * the dump is verified before it is uploaded, because an unreadable backup
#     is worse than none — it stops you looking for a real one;
#   * the upload writes a new object every night and never deletes, so a
#     compromised or confused instance cannot destroy the history. Expiry is
#     the bucket's lifecycle rule, which the instance role has no power over;
#   * a failure exits non-zero and says why, so `systemctl status mom-backup`
#     and the CloudWatch alarm both see it.

set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL is not set — is EnvironmentFile=/etc/mom/mom.env present?}"
: "${BACKUP_S3_URI:?BACKUP_S3_URI is not set, e.g. s3://ucf-mom-files/backups}"

# shellcheck source=deploy/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
# The application's URL carries Prisma's ?schema=public, which pg_dump refuses.
PG_URL="$(libpq_url "$DATABASE_URL")"

LOCAL_DIR="${BACKUP_DIR:-/opt/mom/backups}"
KEEP_LOCAL="${BACKUP_KEEP_LOCAL:-3}"
# A dump smaller than this means something went wrong — an empty database, a
# role that can see no tables, a pg_dump that wrote its error to stdout.
MIN_BYTES="${BACKUP_MIN_BYTES:-20480}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
month="$(date -u +%Y/%m)"
name="mom_tracker-${stamp}.dump"
path="$LOCAL_DIR/$name"

log()  { printf '[backup] %s\n' "$*"; }
die()  { printf '[backup] FAILED: %s\n' "$*" >&2; exit 1; }

mkdir -p "$LOCAL_DIR"

log "dumping to $path"
# -Fc: PostgreSQL's custom format. Compressed, and pg_restore can pull a single
# table out of it, which is what you actually want at 9pm when one table was
# damaged and the rest is fine.
pg_dump --dbname="$PG_URL" --format=custom --compress=6 --file="$path" \
  || die "pg_dump exited non-zero"

size=$(stat -c %s "$path")
log "wrote $(numfmt --to=iec-i --suffix=B "$size")"
[[ $size -ge $MIN_BYTES ]] || die "dump is only $size bytes — refusing to call that a backup"

# Read it back before trusting it. This catches a truncated write and a dump
# that pg_dump abandoned halfway, both of which leave a plausible-looking file.
log "verifying"
tables=$(pg_restore --list "$path" | grep -c 'TABLE DATA' || true)
[[ ${tables:-0} -ge 10 ]] || die "the dump lists only ${tables:-0} tables — that is not this database"
log "verified: $tables tables"

log "uploading to $BACKUP_S3_URI/$month/$name"
aws s3 cp "$path" "$BACKUP_S3_URI/$month/$name" \
  --only-show-errors \
  --sse AES256 \
  --metadata "tables=$tables,host=$(hostname -s)" \
  || die "upload failed — the local copy is at $path"

# A pointer to the newest one, so a restore does not need a listing.
printf '%s\n' "$BACKUP_S3_URI/$month/$name" > "$LOCAL_DIR/LATEST"
aws s3 cp "$LOCAL_DIR/LATEST" "$BACKUP_S3_URI/LATEST" --only-show-errors --sse AES256 || true

# Keep a few locally for a restore that does not need the network. The bucket
# holds the real history; this is only convenience, so pruning it is safe.
log "pruning local copies, keeping $KEEP_LOCAL"
find "$LOCAL_DIR" -maxdepth 1 -name 'mom_tracker-*.dump' -printf '%T@ %p\n' \
  | sort -rn | tail -n "+$((KEEP_LOCAL + 1))" | cut -d' ' -f2- \
  | while read -r old; do log "removing $old"; rm -f "$old"; done

log "done"
