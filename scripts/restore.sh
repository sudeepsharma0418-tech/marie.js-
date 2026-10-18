#!/usr/bin/env bash
# Restore a backup into a target database (which must be empty or disposable).
# Usage: TARGET_DATABASE_URL=... scripts/restore.sh backups/db-YYYYMMDDTHHMMSSZ.dump
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"
dump="${1:?path to .dump file}"
pg_restore --no-owner --no-privileges --clean --if-exists --exit-on-error --dbname "$TARGET_DATABASE_URL" "$dump"
echo "Restored $dump"
