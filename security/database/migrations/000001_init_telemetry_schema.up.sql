-- =============================================================================
-- GetTalk Security — Telemetry & Intrusion Detection System (IDS)
-- Migration: 000001_init_telemetry_schema.up.sql
-- Dedicated PostgreSQL database (isolated from main GetTalk application DB)
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Telemetry Events (Raw normalized events from Firewalld, Nginx, PM2)
CREATE TABLE IF NOT EXISTS telemetry_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          VARCHAR(32) NOT NULL CHECK (source IN ('firewalld', 'nginx', 'pm2')),
    event_type      VARCHAR(64) NOT NULL,
    source_ip       VARCHAR(45),
    destination_ip  VARCHAR(45),
    event_data      JSONB NOT NULL DEFAULT '{}'::jsonb,
    severity        VARCHAR(16) NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
    fingerprint     VARCHAR(128),
    occurred_at     TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_events_fingerprint
    ON telemetry_events (fingerprint)
    WHERE fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_telemetry_events_occurred_at
    ON telemetry_events (occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_source_occurred
    ON telemetry_events (source, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_source_ip_occurred
    ON telemetry_events (source_ip, occurred_at DESC)
    WHERE source_ip IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_telemetry_events_severity_occurred
    ON telemetry_events (severity, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_type_occurred
    ON telemetry_events (event_type, occurred_at DESC);

-- 2. System Metrics (Time-series metrics from PM2, Nginx, Firewalld)
CREATE TABLE IF NOT EXISTS system_metrics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          VARCHAR(32) NOT NULL CHECK (source IN ('firewalld', 'nginx', 'pm2', 'system')),
    metric_name     VARCHAR(64) NOT NULL,
    metric_value    DOUBLE PRECISION NOT NULL,
    labels          JSONB NOT NULL DEFAULT '{}'::jsonb,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_metrics_recorded_at
    ON system_metrics (recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_metrics_source_name_recorded
    ON system_metrics (source, metric_name, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_metrics_labels_gin
    ON system_metrics USING GIN (labels);

-- 3. Detection Rules (Configurable IDS rules)
CREATE TABLE IF NOT EXISTS detection_rules (
    id              VARCHAR(32) PRIMARY KEY,
    rule_name       VARCHAR(128) NOT NULL,
    rule_type       VARCHAR(32) NOT NULL CHECK (rule_type IN ('threshold', 'distinct_count', 'signature', 'metric_sustained', 'metric_delta', 'correlation')),
    threshold       DOUBLE PRECISION NOT NULL CHECK (threshold >= 0),
    time_window     INTEGER NOT NULL CHECK (time_window > 0),
    severity        VARCHAR(16) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    configuration   JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_detection_rules_enabled
    ON detection_rules (enabled);

-- 4. Security Alerts (Triggered IDS alerts with deduplication and lifecycle)
CREATE TABLE IF NOT EXISTS security_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id         VARCHAR(32) NOT NULL REFERENCES detection_rules(id) ON UPDATE CASCADE,
    title           VARCHAR(255) NOT NULL,
    description     TEXT NOT NULL,
    severity        VARCHAR(16) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    source_ip       VARCHAR(45),
    status          VARCHAR(32) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
    first_seen      TIMESTAMPTZ NOT NULL,
    last_seen       TIMESTAMPTZ NOT NULL,
    event_count     INTEGER NOT NULL DEFAULT 1 CHECK (event_count >= 1),
    evidence        JSONB NOT NULL DEFAULT '{}'::jsonb,
    acknowledged_by VARCHAR(64),
    acknowledged_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_alerts_created_at
    ON security_alerts (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_security_alerts_status_severity
    ON security_alerts (status, severity, last_seen DESC);

CREATE INDEX IF NOT EXISTS idx_security_alerts_dedup_lookup
    ON security_alerts (rule_id, COALESCE(source_ip, ''), status, last_seen DESC);

-- 5. Audit Logs (Administrator, authentication, rule, and alert lifecycle activity)
CREATE TABLE IF NOT EXISTS audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id        VARCHAR(64) NOT NULL,
    action          VARCHAR(64) NOT NULL,
    resource_type   VARCHAR(64) NOT NULL,
    resource_id     VARCHAR(128),
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
    ON audit_logs (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created
    ON audit_logs (actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_resource
    ON audit_logs (resource_type, resource_id, created_at DESC);

-- 6. Ingestion Checkpoints (Log offset and rotation persistence for collectors)
CREATE TABLE IF NOT EXISTS ingestion_checkpoints (
    source_key      VARCHAR(255) PRIMARY KEY,
    inode           BIGINT NOT NULL DEFAULT 0,
    byte_offset     BIGINT NOT NULL DEFAULT 0,
    last_timestamp  TIMESTAMPTZ,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Security Administrators & Sessions (RBAC & MFA for the Security Dashboard)
CREATE TABLE IF NOT EXISTS security_admins (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username                VARCHAR(64) UNIQUE NOT NULL,
    email                   VARCHAR(255) UNIQUE NOT NULL,
    password_hash           VARCHAR(255) NOT NULL,
    role                    VARCHAR(32) NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'analyst', 'viewer')),
    mfa_enabled             BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret              TEXT,
    failed_login_attempts   INTEGER NOT NULL DEFAULT 0,
    locked_until            TIMESTAMPTZ,
    last_login_at           TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS security_sessions (
    id              VARCHAR(128) PRIMARY KEY,
    admin_id        UUID NOT NULL REFERENCES security_admins(id) ON DELETE CASCADE,
    csrf_token      VARCHAR(128) NOT NULL,
    ip_address      VARCHAR(45),
    user_agent      VARCHAR(512),
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_sessions_admin_id
    ON security_sessions (admin_id);

CREATE INDEX IF NOT EXISTS idx_security_sessions_expires_at
    ON security_sessions (expires_at);

COMMIT;

