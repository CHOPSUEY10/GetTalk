#!/usr/bin/env bash
# ==============================================================================
# GetTalk Security — Least-Privilege Collector Permission Verification Script
# Verifies that the collector user is non-root and has read-only telemetry access.
# ==============================================================================

set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
    echo "[FAIL] Collector must NOT run as root (UID 0)." >&2
    exit 1
fi

echo "[OK] Running as non-root user: $(id -un) (UID $(id -u))"

if command -v journalctl >/dev/null 2>&1; then
    if journalctl -n 1 >/dev/null 2>&1; then
        echo "[OK] journalctl read access verified."
    else
        echo "[WARN] journalctl present, but current user lacks systemd-journal group membership."
    fi
else
    echo "[WARN] journalctl not found on this host."
fi

for LOG_FILE in /var/log/nginx/access.log /var/log/nginx/error.log; do
    if [[ -r "${LOG_FILE}" ]]; then
        echo "[OK] Read access verified for ${LOG_FILE}"
    else
        echo "[WARN] ${LOG_FILE} is not readable by $(id -un)"
    fi
done

if command -v pm2 >/dev/null 2>&1; then
    echo "[OK] pm2 binary found at $(command -v pm2)"
else
    echo "[WARN] pm2 binary not found in PATH"
fi

