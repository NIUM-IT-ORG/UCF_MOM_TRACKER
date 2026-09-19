#!/usr/bin/env bash
# Shared helpers for the deployment scripts. Sourced, not executed.

# ─────────────────────────────────────────────────────────────────────────────
# libpq_url — turn the application's DATABASE_URL into one pg_dump can use.
#
# This exists because of a real failure. The application talks to PostgreSQL
# through Prisma, and Prisma's connection string carries parameters libpq has
# never heard of:
#
#   postgresql://ucf:pw@localhost:5432/mom_tracker?schema=public
#
# Hand that to pg_dump and it stops with `invalid URI query parameter:
# "schema"`. The nightly backup would have failed on its first night, at 01:30,
# with nobody watching — and the discovery would have been a month later, on
# the one day somebody needed a restore.
#
# So: keep the parameters libpq documents, drop the rest. A whitelist rather
# than a blacklist, because the set of things Prisma and pgbouncer might add is
# open-ended and the set libpq accepts is not.
# ─────────────────────────────────────────────────────────────────────────────
LIBPQ_PARAMS="sslmode sslrootcert sslcert sslkey sslpassword sslcrl connect_timeout \
application_name fallback_application_name options target_session_attrs keepalives \
keepalives_idle keepalives_interval keepalives_count gssencmode channel_binding \
require_auth client_encoding"

libpq_url() {
  local url="$1" base query kept=""
  base="${url%%\?*}"
  [[ $url == *\?* ]] || { printf '%s\n' "$base"; return; }
  query="${url#*\?}"

  local pair key
  local IFS='&'
  for pair in $query; do
    key="${pair%%=*}"
    if [[ " $LIBPQ_PARAMS " == *" $key "* ]]; then
      kept="${kept:+$kept&}$pair"
    fi
  done

  if [[ -n $kept ]]; then
    printf '%s\n' "$base?$kept"
  else
    printf '%s\n' "$base"
  fi
}

# The database name out of a connection URL, with any query string removed.
db_name_of() {
  local base="${1%%\?*}"
  printf '%s\n' "${base##*/}"
}

# The same URL pointing at a different database, keeping host, role and password.
with_db_name() {
  local url="$1" name="$2" base="${1%%\?*}" query=""
  [[ $url == *\?* ]] && query="?${url#*\?}"
  printf '%s\n' "${base%/*}/$name$query"
}
