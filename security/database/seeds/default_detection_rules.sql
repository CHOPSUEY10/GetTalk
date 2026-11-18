-- =============================================================================
-- GetTalk Security — Default IDS Detection Rules Seed
-- Safe to run multiple times (ON CONFLICT DO UPDATE)
-- Never contains credentials or secrets.
-- =============================================================================

BEGIN;

INSERT INTO detection_rules (id, rule_name, rule_type, threshold, time_window, severity, enabled, configuration, updated_at)
VALUES
    (
        'NET-001',
        'Repeated Firewall Rejection',
        'threshold',
        50,
        60,
        'medium',
        TRUE,
        '{"source": "firewalld", "event_types": ["connection_reject", "packet_drop"], "group_by": "source_ip", "description": "Triggers when a single source IP exceeds 50 dropped or rejected packets within 60 seconds."}'::jsonb,
        NOW()
    ),
    (
        'NET-002',
        'Port Scanning Indicators',
        'distinct_count',
        10,
        60,
        'high',
        TRUE,
        '{"source": "firewalld", "event_types": ["connection_reject", "packet_drop"], "distinct_field": "destination_port", "group_by": "source_ip", "description": "Triggers when a single source IP probes 10 or more distinct destination ports within 60 seconds."}'::jsonb,
        NOW()
    ),
    (
        'WEB-001',
        'HTTP Request Flood',
        'threshold',
        100,
        60,
        'high',
        TRUE,
        '{"source": "nginx", "event_types": ["http_request"], "group_by": "source_ip", "description": "Triggers when a single client IP sends 100 or more HTTP requests within 60 seconds."}'::jsonb,
        NOW()
    ),
    (
        'WEB-002',
        'Authentication Failure Burst',
        'threshold',
        30,
        60,
        'medium',
        TRUE,
        '{"source": "nginx", "event_types": ["http_request"], "path_prefixes": ["/api/auth/login", "/api/auth/mfa/verify", "/api/v1/auth/login"], "status_codes": [401, 403, 423, 429], "group_by": "source_ip", "description": "Triggers when a single source IP accumulates 30 or more authentication failures within 60 seconds."}'::jsonb,
        NOW()
    ),
    (
        'WEB-003',
        'Suspicious Request Patterns',
        'signature',
        1,
        60,
        'high',
        TRUE,
        '{"source": "nginx", "event_types": ["http_request"], "signatures": ["../", "..%2f", "/etc/passwd", "/.env", "/.git/", "union select", "<script", "jndi:ldap", "/wp-admin", "/phpmyadmin", "cmd.exe", "/bin/sh"], "group_by": "source_ip", "description": "Triggers when HTTP request paths or user-agents match known path traversal, SQLi, XSS, or scanner signatures."}'::jsonb,
        NOW()
    ),
    (
        'APP-001',
        'High CPU Usage',
        'metric_sustained',
        80,
        300,
        'medium',
        TRUE,
        '{"source": "pm2", "metric_name": "cpu_percent", "comparison": "gt", "min_samples": 3, "description": "Triggers when a PM2 application process sustains CPU usage above 80% over a 5-minute window."}'::jsonb,
        NOW()
    ),
    (
        'APP-002',
        'High Memory Usage',
        'metric_sustained',
        80,
        60,
        'high',
        TRUE,
        '{"source": "pm2", "metric_name": "memory_percent", "max_memory_bytes": 1073741824, "comparison": "gt", "min_samples": 1, "description": "Triggers when a PM2 process exceeds 80% of its configured memory limit."}'::jsonb,
        NOW()
    ),
    (
        'APP-003',
        'Repeated Process Restart',
        'metric_delta',
        3,
        300,
        'high',
        TRUE,
        '{"source": "pm2", "metric_name": "restart_count", "event_types": ["process_restart", "process_status"], "description": "Triggers when a PM2 managed process restarts 3 or more times within 5 minutes."}'::jsonb,
        NOW()
    ),
    (
        'COR-001',
        'Cross-Layer Suspicious Activity',
        'correlation',
        2,
        300,
        'critical',
        TRUE,
        '{"required_sources": ["firewalld", "nginx"], "optional_sources": ["pm2"], "require_trusted_proxy_validation": true, "description": "Triggers when correlated anomalies occur across multiple infrastructure layers (e.g., firewall port probes + web scanner/auth flood from the same verified source IP, or web flood coinciding with PM2 process degradation)."}'::jsonb,
        NOW()
    )
ON CONFLICT (id) DO UPDATE SET
    rule_name     = EXCLUDED.rule_name,
    rule_type     = EXCLUDED.rule_type,
    threshold     = EXCLUDED.threshold,
    time_window   = EXCLUDED.time_window,
    severity      = EXCLUDED.severity,
    configuration = EXCLUDED.configuration,
    updated_at    = NOW();

COMMIT;

