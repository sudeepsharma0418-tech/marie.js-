#!/usr/bin/env bash
# Proves a backup can actually be restored: dump SOURCE, restore into a scratch DB,
# compare row counts of every table and verify the audit hash chain survived.
# Usage: DATABASE_URL=... SCRATCH_DATABASE_URL=... scripts/verify-backup.sh
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"
: "${DATABASE_URL:?}"; : "${SCRATCH_DATABASE_URL:?}"
tmp="$(mktemp -d)"
BACKUP_DIR="$tmp" STORAGE_DIR=/nonexistent "$(dirname "$0")/backup.sh" >/dev/null
psql -q "$SCRATCH_DATABASE_URL" -c "drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;"
TARGET_DATABASE_URL="$SCRATCH_DATABASE_URL" "$(dirname "$0")/restore.sh" "$tmp"/db-*.dump >/dev/null
count_all() {
  for t in $(psql -tA "$1" -c "select table_name from information_schema.tables where table_schema = 'public' order by 1"); do
    echo "$t:$(psql -tA "$1" -c "select count(*) from \"$t\"")"
  done
}
a="$(count_all "$DATABASE_URL")"; b="$(count_all "$SCRATCH_DATABASE_URL")"
if [ "$a" != "$b" ]; then echo "ROW COUNTS DIFFER"; diff <(echo "$a") <(echo "$b"); exit 1; fi
tables="$(echo "$a" | wc -l)"; rows="$(echo "$a" | awk -F: '{s+=$2} END {print s}')"
last_src="$(psql -tA "$DATABASE_URL" -c 'select hash from audit_logs order by id desc limit 1')"
last_dst="$(psql -tA "$SCRATCH_DATABASE_URL" -c 'select hash from audit_logs order by id desc limit 1')"
[ "$last_src" = "$last_dst" ] || { echo "AUDIT CHAIN HEAD DIFFERS"; exit 1; }
rm -rf "$tmp"
echo "Backup verified: $tables tables, $rows rows identical, audit chain head matches."
