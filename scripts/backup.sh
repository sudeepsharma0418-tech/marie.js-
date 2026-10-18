#!/usr/bin/env bash
# Logical PostgreSQL backup plus uploaded files. Run daily from cron; keep copies off the server.
# Usage: DATABASE_URL=... STORAGE_DIR=... BACKUP_DIR=/var/backups/hotelproc scripts/backup.sh
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
STORAGE_DIR="${STORAGE_DIR:-apps/api/storage}"
KEEP_DAYS="${KEEP_DAYS:-30}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
pg_dump --format=custom --no-owner --no-privileges --file "$BACKUP_DIR/db-$stamp.dump" "$DATABASE_URL"
if [ -d "$STORAGE_DIR" ]; then tar -czf "$BACKUP_DIR/files-$stamp.tar.gz" -C "$STORAGE_DIR" .; fi
sha256sum "$BACKUP_DIR"/*-"$stamp".* > "$BACKUP_DIR/SHA256SUMS-$stamp"
find "$BACKUP_DIR" -type f -mtime +"$KEEP_DAYS" -delete
echo "Backup written: $BACKUP_DIR/db-$stamp.dump"
