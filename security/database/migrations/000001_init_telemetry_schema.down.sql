-- =============================================================================
-- GetTalk Security — Telemetry & Intrusion Detection System (IDS)
-- Migration: 000001_init_telemetry_schema.down.sql
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS security_sessions;
DROP TABLE IF EXISTS security_admins;
DROP TABLE IF EXISTS ingestion_checkpoints;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS security_alerts;
DROP TABLE IF EXISTS detection_rules;
DROP TABLE IF EXISTS system_metrics;
DROP TABLE IF EXISTS telemetry_events;

COMMIT;

