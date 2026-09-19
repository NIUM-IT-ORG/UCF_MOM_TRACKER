#!/usr/bin/env bash
#
# Tests for deploy/lib.sh.  Run:  ./deploy/lib.test.sh
#
# Small, but not ceremonial. The URL rewriting below is the difference between
# a nightly backup that runs and one that fails silently at 01:30, and the bug
# it fixes was found by running the backup, not by reading it.

set -Eeuo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

pass=0 fail=0
check() { # check <label> <expected> <actual>
  if [[ $2 == "$3" ]]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf '  FAIL %s\n    expected: %s\n    actual:   %s\n' "$1" "$2" "$3"
  fi
}

APP_URL='postgresql://ucf:pw@localhost:5432/mom_tracker?schema=public'

check "drops Prisma's schema parameter, which libpq rejects outright" \
  'postgresql://ucf:pw@localhost:5432/mom_tracker' \
  "$(libpq_url "$APP_URL")"

check "leaves a URL with no query string alone" \
  'postgresql://ucf:pw@localhost:5432/mom_tracker' \
  "$(libpq_url 'postgresql://ucf:pw@localhost:5432/mom_tracker')"

check "keeps sslmode, which libpq does understand and which matters" \
  'postgresql://ucf:pw@db.internal:5432/mom_tracker?sslmode=require' \
  "$(libpq_url 'postgresql://ucf:pw@db.internal:5432/mom_tracker?schema=public&sslmode=require')"

check "keeps several libpq parameters, in the order given" \
  'postgresql://ucf:pw@h:5432/d?sslmode=require&connect_timeout=10' \
  "$(libpq_url 'postgresql://ucf:pw@h:5432/d?sslmode=require&connection_limit=5&connect_timeout=10')"

check "drops pgbouncer and pool settings, which arrive with a pooled URL" \
  'postgresql://ucf:pw@h:6543/d' \
  "$(libpq_url 'postgresql://ucf:pw@h:6543/d?pgbouncer=true&connection_limit=1&pool_timeout=0')"

check "keeps a password containing a question mark out of trouble" \
  'postgresql://ucf:a%3Fb@h:5432/d' \
  "$(libpq_url 'postgresql://ucf:a%3Fb@h:5432/d?schema=public')"

check "reads the database name" 'mom_tracker' "$(db_name_of "$APP_URL")"
check "reads the database name with no query string" \
  'mom_tracker' "$(db_name_of 'postgresql://ucf:pw@h:5432/mom_tracker')"

check "points the same URL at another database, keeping the credentials" \
  'postgresql://ucf:pw@localhost:5432/mom_restore_drill?schema=public' \
  "$(with_db_name "$APP_URL" mom_restore_drill)"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
