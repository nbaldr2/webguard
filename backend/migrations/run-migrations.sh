#!/bin/bash
# WebGuard V2 - PostgreSQL Migration Runner
# Usage: ./run-migrations.sh
# This script runs all migration files in order against the webguard PostgreSQL database.

set -e

DB_NAME="${PGDATABASE:-webguard}"
DB_USER="${PGUSER:-$(whoami)}"
DB_HOST="${PGHOST:-localhost}"
DB_PORT="${PGPORT:-5432}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==========================================="
echo " WebGuard V2 Migration Runner"
echo "==========================================="
echo " Database: $DB_NAME"
echo " User:     $DB_USER"
echo " Host:     $DB_HOST:$DB_PORT"
echo "==========================================="

# Create migrations tracking table if it doesn't exist
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
" > /dev/null 2>&1

echo ""
echo "Checking for pending migrations..."
echo ""

ran=0

for sql_file in "$SCRIPT_DIR"/*.sql; do
  filename=$(basename "$sql_file")

  # Check if migration was already applied
  already_applied=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "
    SELECT COUNT(*) FROM schema_migrations WHERE filename = '$filename';
  " 2>/dev/null | xargs)

  if [ "$already_applied" = "1" ]; then
    echo "  [SKIP] $filename (already applied)"
  else
    echo "  [RUN ] $filename ..."
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$sql_file" -q
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
      INSERT INTO schema_migrations (filename) VALUES ('$filename') ON CONFLICT DO NOTHING;
    " > /dev/null 2>&1
    echo "  [DONE] $filename"
    ran=$((ran + 1))
  fi
done

echo ""
if [ "$ran" -eq 0 ]; then
  echo "No new migrations to apply. Database is up to date."
else
  echo "$ran migration(s) applied successfully."
fi
echo ""
