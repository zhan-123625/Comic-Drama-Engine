#!/usr/bin/env bash
# =============================================================
# Backup the SQLite database
# - Copies data/app.db to data/backups/app-{timestamp}.db
# - Keeps the last 30 backups, deletes older ones
# =============================================================
set -euo pipefail

if ! command -v sqlite3 &> /dev/null; then
  echo "ERROR: sqlite3 command not found. Please install sqlite3."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

DB_PATH="${PROJECT_ROOT}/data/app.db"
BACKUP_DIR="${PROJECT_ROOT}/data/backups"
KEEP=30

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: Database not found at $DB_PATH"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/app-${TIMESTAMP}.db"

sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"
echo "Backup created: $BACKUP_FILE"

# Remove old backups, keeping the newest $KEEP
BACKUP_COUNT=$(ls -1 "${BACKUP_DIR}"/app-*.db 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt "$KEEP" ]; then
  DELETE_COUNT=$((BACKUP_COUNT - KEEP))
  ls -1t "${BACKUP_DIR}"/app-*.db | tail -n "$DELETE_COUNT" | while read -r old; do
    rm -f "$old"
    echo "Deleted old backup: $old"
  done
fi

echo "Backup complete. Total backups: $(ls -1 "${BACKUP_DIR}"/app-*.db 2>/dev/null | wc -l)"
