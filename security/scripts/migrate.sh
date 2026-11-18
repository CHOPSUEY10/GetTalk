#!/usr/bin/env bash
# ==============================================================================
# GetTalk Security — Safe Database Migration & Seed Script
# Requires explicit TELEMETRY_DATABASE_URL pointing to the dedicated security DB.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$(cd "${SCRIPT_DIR}/../database" && pwd)"

if [[ -z "${TELEMETRY_DATABASE_URL:-}" ]]; then
    echo "ERROR: TELEMETRY_DATABASE_URL is not set." >&2
    echo "Never reuse the main GetTalk application DATABASE_URL." >&2
    exit 1
fi

ACTION="${1:-up}"

case "${ACTION}" in
    up)
        echo "[GetTalk Security] Applying migration 000001_init_telemetry_schema.up.sql..."
        psql "${TELEMETRY_DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${DB_DIR}/migrations/000001_init_telemetry_schema.up.sql"
        echo "[GetTalk Security] Seeding default IDS detection rules..."
        psql "${TELEMETRY_DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${DB_DIR}/seeds/default_detection_rules.sql"
        echo "[GetTalk Security] Migration and seed completed successfully."
        ;;
    down)
        echo "[GetTalk Security] Rolling back migration 000001_init_telemetry_schema.down.sql..."
        psql "${TELEMETRY_DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${DB_DIR}/migrations/000001_init_telemetry_schema.down.sql"
        echo "[GetTalk Security] Rollback completed."
        ;;
    *)
        echo "Usage: $0 [up|down]" >&2
        exit 1
        ;;
esac

