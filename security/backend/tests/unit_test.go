package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gettalk/security/backend/internal/collector/firewall"
	"github.com/gettalk/security/backend/internal/collector/nginx"
	"github.com/gettalk/security/backend/internal/collector/pm2"
	"github.com/gettalk/security/backend/internal/config"
	"github.com/gettalk/security/backend/internal/detection"
	"github.com/gettalk/security/backend/internal/handler"
	"github.com/gettalk/security/backend/internal/middleware"
	"github.com/gettalk/security/backend/internal/models"
	"github.com/gettalk/security/backend/internal/repository"
	"github.com/gettalk/security/backend/internal/service"
)

type sentEmail struct {
	To      string
	Subject string
	Body    string
}

type mockEmailSender struct {
	mu     sync.Mutex
	emails []sentEmail
	err    error
}

func (m *mockEmailSender) SendEmail(_ context.Context, to, subject, body string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.err != nil {
		return m.err
	}
	m.emails = append(m.emails, sentEmail{To: to, Subject: subject, Body: body})
	return nil
}

func (m *mockEmailSender) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.emails)
}

func (m *mockEmailSender) Last() sentEmail {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.emails) == 0 {
		return sentEmail{}
	}
	return m.emails[len(m.emails)-1]
}

type testSink struct {
	events  []models.TelemetryEvent
	metrics []models.SystemMetric
}

func (s *testSink) EmitEvent(ev models.TelemetryEvent) bool {
	s.events = append(s.events, ev)
	return true
}

func (s *testSink) EmitMetric(m models.SystemMetric) bool {
	s.metrics = append(s.metrics, m)
	return true
}

func TestFirewallLogParsingAndDeduplication(t *testing.T) {
	now := time.Date(2026, 11, 18, 9, 0, 0, 0, time.UTC)
	line := "2026-11-18T09:00:00+00:00 host kernel: FINAL_REJECT: IN=eth0 OUT= MAC=00:11:22 SRC=203.0.113.45 DST=198.51.100.10 LEN=60 TOS=0x00 PREC=0x00 TTL=52 ID=12345 DF PROTO=TCP SPT=54321 DPT=22 WINDOW=29200 RES=0x00 SYN URGP=0"

	parsed := firewall.ParseFirewallLine(line, now, 5)
	if parsed == nil {
		t.Fatal("expected firewall line to be parsed, got nil")
	}
	if parsed.Action != "REJECT" || parsed.EventType != "connection_reject" {
		t.Fatalf("unexpected action/eventType: %s / %s", parsed.Action, parsed.EventType)
	}
	if parsed.SourceIP != "203.0.113.45" || parsed.DestinationIP != "198.51.100.10" {
		t.Fatalf("unexpected IPs: src=%s dst=%s", parsed.SourceIP, parsed.DestinationIP)
	}
	if parsed.SourcePort != 54321 || parsed.DestinationPort != 22 || parsed.Protocol != "TCP" {
		t.Fatalf("unexpected ports/proto: spt=%d dpt=%d proto=%s", parsed.SourcePort, parsed.DestinationPort, parsed.Protocol)
	}

	col := firewall.NewCollector(config.FirewalldConfig{Enabled: true, DedupWindowSeconds: 5}, nil)
	sink := &testSink{}

	if !col.ProcessLine(line, now, sink) {
		t.Fatal("expected first firewall line to be processed")
	}
	if col.ProcessLine(line, now.Add(time.Second), sink) {
		t.Fatal("expected duplicate firewall line within dedup window to be ignored")
	}
	if len(sink.events) != 1 {
		t.Fatalf("expected 1 emitted event, got %d", len(sink.events))
	}
}

func TestNginxJSONAndErrorLogParsing(t *testing.T) {
	now := time.Date(2026, 11, 18, 9, 5, 0, 0, time.UTC)
	trusted := map[string]bool{"127.0.0.1": true}

	jsonLine := `{"timestamp":"2026-11-18T09:05:00Z","remote_addr":"127.0.0.1","x_forwarded_for":"198.51.100.77","host":"api.38-9-47-209.sslip.io","request_method":"POST","request_uri":"/api/auth/login?token=secret123","status":401,"body_bytes_sent":128,"request_time":0.045,"upstream_response_time":"0.041","http_user_agent":"Mozilla/5.0"}`
	parsed, err := nginx.ParseAccessLogLine(jsonLine, trusted, true, now)
	if err != nil || parsed == nil {
		t.Fatalf("failed to parse nginx json line: %v", err)
	}
	if parsed.SourceIP != "198.51.100.77" || !parsed.TrustedProxyVerified {
		t.Fatalf("expected X-Forwarded-For IP 198.51.100.77 with trusted proxy verified, got %s (%v)", parsed.SourceIP, parsed.TrustedProxyVerified)
	}
	if parsed.Endpoint != "/api/auth/login?token=[REDACTED]" {
		t.Fatalf("expected sensitive query param to be redacted, got %s", parsed.Endpoint)
	}
	if parsed.RequestDurationMs != 45.0 || parsed.UpstreamDurationMs != 41.0 {
		t.Fatalf("unexpected duration conversions: req=%v up=%v", parsed.RequestDurationMs, parsed.UpstreamDurationMs)
	}

	// Untrusted proxy must NOT spoof SourceIP via X-Forwarded-For
	untrustedLine := `{"timestamp":"2026-11-18T09:05:00Z","remote_addr":"192.0.2.99","x_forwarded_for":"10.0.0.1","request_method":"GET","request_uri":"/../../etc/passwd","status":404,"request_time":0.01}`
	untrustedParsed, err := nginx.ParseAccessLogLine(untrustedLine, trusted, true, now)
	if err != nil || untrustedParsed == nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if untrustedParsed.SourceIP != "192.0.2.99" || untrustedParsed.TrustedProxyVerified {
		t.Fatalf("expected untrusted proxy remote_addr 192.0.2.99 and verified=false, got %s (%v)", untrustedParsed.SourceIP, untrustedParsed.TrustedProxyVerified)
	}
	if !untrustedParsed.SuspiciousIndicator {
		t.Fatal("expected path traversal URI to flag SuspiciousIndicator")
	}

	errLine := `2026/11/18 09:05:00 [error] 1024#1024: *99 connect() failed (111: Connection refused) while connecting to upstream, client: 198.51.100.88, server: api.gettalk.example`
	parsedErr := nginx.ParseErrorLogLine(errLine, now)
	if parsedErr == nil || parsedErr.ClientIP != "198.51.100.88" || parsedErr.Level != "error" {
		t.Fatalf("unexpected parsed nginx error log: %+v", parsedErr)
	}
}

func TestPM2JListParsingAndMetricNormalization(t *testing.T) {
	now := time.Date(2026, 11, 18, 9, 10, 0, 0, time.UTC)
	uptimeEpoch := now.Add(-2 * time.Hour).UnixMilli()
	raw := []byte(`[
		{
			"name": "gettalk-backend",
			"pid": 4321,
			"pm_id": 0,
			"monit": { "memory": 268435456, "cpu": 84.5 },
			"pm2_env": {
				"status": "online",
				"restart_time": 4,
				"pm_uptime": ` + "1794992400000" + `,
				"instances": 2,
				"exec_mode": "cluster_mode"
			}
		}
	]`)
	_ = uptimeEpoch

	summaries, err := pm2.ParsePM2JList(raw, now)
	if err != nil || len(summaries) != 1 {
		t.Fatalf("failed to parse pm2 jlist: %v", err)
	}
	proc := summaries[0]
	if proc.Name != "gettalk-backend" || proc.PID != 4321 || proc.CPUPercent != 84.5 || proc.MemoryBytes != 268435456 || proc.RestartCount != 4 {
		t.Fatalf("unexpected PM2 process summary: %+v", proc)
	}
}

func TestIDSDetectionRulesThresholdCorrelationAndDeduplication(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 11, 18, 9, 15, 0, 0, time.UTC)

	rules := []models.DetectionRule{
		{
			ID: "NET-001", RuleName: "Repeated Firewall Rejection", RuleType: "threshold",
			Threshold: 5, TimeWindow: 60, Severity: models.SeverityMedium, Enabled: true,
			Configuration: map[string]interface{}{"source": "firewalld", "event_types": []string{"connection_reject", "packet_drop"}},
		},
		{
			ID: "NET-002", RuleName: "Port Scanning Indicators", RuleType: "distinct_count",
			Threshold: 4, TimeWindow: 60, Severity: models.SeverityHigh, Enabled: true,
			Configuration: map[string]interface{}{"source": "firewalld", "distinct_field": "destination_port"},
		},
		{
			ID: "WEB-003", RuleName: "Suspicious Request Patterns", RuleType: "signature",
			Threshold: 1, TimeWindow: 60, Severity: models.SeverityHigh, Enabled: true,
			Configuration: map[string]interface{}{"source": "nginx", "signatures": []string{"../", "/etc/passwd"}},
		},
		{
			ID: "APP-001", RuleName: "High CPU Usage", RuleType: "metric_sustained",
			Threshold: 80, TimeWindow: 300, Severity: models.SeverityMedium, Enabled: true,
			Configuration: map[string]interface{}{"source": "pm2", "metric_name": "cpu_percent", "min_samples": 2},
		},
		{
			ID: "COR-001", RuleName: "Cross-Layer Suspicious Activity", RuleType: "correlation",
			Threshold: 2, TimeWindow: 300, Severity: models.SeverityCritical, Enabled: true,
			Configuration: map[string]interface{}{"required_sources": []string{"firewalld", "nginx"}},
		},
	}

	repo := repository.NewMemoryRepository(rules)
	attackerIP := "203.0.113.200"

	// Ingest 5 firewall events across 4 distinct ports from attackerIP
	ports := []int{21, 22, 23, 3389, 22}
	fwEvents := make([]models.TelemetryEvent, 0, len(ports))
	for i, p := range ports {
		fwEvents = append(fwEvents, models.TelemetryEvent{
			Source:     models.SourceFirewalld,
			EventType:  "connection_reject",
			SourceIP:   attackerIP,
			Severity:   models.SeverityLow,
			OccurredAt: now.Add(-time.Duration(i*5) * time.Second),
			EventData:  map[string]interface{}{"destination_port": p, "protocol": "TCP"},
		})
	}
	// Ingest 1 suspicious web probe from the same verified attackerIP
	fwEvents = append(fwEvents, models.TelemetryEvent{
		Source:     models.SourceNginx,
		EventType:  "http_request",
		SourceIP:   attackerIP,
		Severity:   models.SeverityHigh,
		OccurredAt: now.Add(-3 * time.Second),
		EventData: map[string]interface{}{
			"endpoint":               "/../../etc/passwd",
			"status_code":            404,
			"trusted_proxy_verified": true,
			"suspicious_indicator":   true,
			"matched_signature":      "../",
		},
	})
	if err := repo.SaveEventsBatch(ctx, fwEvents); err != nil {
		t.Fatalf("SaveEventsBatch failed: %v", err)
	}

	// Ingest 2 high CPU samples for PM2
	_ = repo.SaveMetricsBatch(ctx, []models.SystemMetric{
		{Source: models.SourcePM2, MetricName: "cpu_percent", MetricValue: 88.2, Labels: map[string]interface{}{"process_name": "gettalk-api"}, RecordedAt: now.Add(-20 * time.Second)},
		{Source: models.SourcePM2, MetricName: "cpu_percent", MetricValue: 91.4, Labels: map[string]interface{}{"process_name": "gettalk-api"}, RecordedAt: now.Add(-10 * time.Second)},
	})

	engine := detection.NewEngine(config.DetectionConfig{
		Enabled:              true,
		DedupCooldownSeconds: 300,
		PassiveModeOnly:      true,
	}, repo, nil, nil)

	alerts, err := engine.EvaluateCycle(ctx, now)
	if err != nil {
		t.Fatalf("EvaluateCycle failed: %v", err)
	}

	triggeredRules := make(map[string]bool)
	for _, a := range alerts {
		triggeredRules[a.RuleID] = true
	}

	for _, expected := range []string{"NET-001", "NET-002", "WEB-003", "APP-001", "COR-001"} {
		if !triggeredRules[expected] {
			t.Errorf("expected rule %s to trigger an alert, but it did not (triggered: %v)", expected, triggeredRules)
		}
	}

	// Re-evaluating within cooldown window must deduplicate rather than create duplicate open alert rows
	_, _ = engine.EvaluateCycle(ctx, now.Add(10*time.Second))
	page, _ := repo.ListAlerts(ctx, models.EventFilter{Limit: 50})
	if page.Total != 5 {
		t.Fatalf("expected alert deduplication to keep exactly 5 alerts, got %d", page.Total)
	}
}

func TestSeverityFilterLogic(t *testing.T) {
	cases := []struct {
		severity       string
		expectCritical bool
	}{
		{"low", false},
		{"LOW", false},
		{"medium", false},
		{"Medium", false},
		{"high", false},
		{"HIGH", false},
		{"info", false},
		{"", false},
		{"critical", true},
		{"CRITICAL", true},
		{"Critical", true},
		{"  CrItIcAl  ", true},
	}

	for _, tc := range cases {
		got := service.IsCriticalSeverity(tc.severity)
		if got != tc.expectCritical {
			t.Errorf("IsCriticalSeverity(%q) = %v; expected %v", tc.severity, got, tc.expectCritical)
		}
	}

	// Verify NotificationService only triggers email for critical severity
	mockRedis := service.NewMemoryRedisClient()
	mockMailer := &mockEmailSender{}
	notifSvc := service.NewNotificationService(
		config.NotificationConfig{Enabled: true, SecAdminEmail: "secadmin@gettalk.example"},
		config.RedisConfig{CooldownPrefix: "siem:alert:cooldown:", CooldownTTLSeconds: 60},
		mockRedis,
		mockMailer,
		nil,
	)

	for _, sev := range []string{"low", "medium", "high", "CRITICAL"} {
		ev := models.TelemetryEvent{
			ID:         "evt-" + strings.ToLower(sev),
			Source:     models.SourceSIEM,
			EventType:  "test_event",
			SourceIP:   "198.51.100.10",
			Severity:   sev,
			OccurredAt: time.Now().UTC(),
		}
		triggered := notifSvc.NotifyCriticalEventAsync(ev, "Unit test severity filter "+sev)
		if strings.EqualFold(sev, "critical") && !triggered {
			t.Fatalf("expected critical event to trigger notification")
		}
		if !strings.EqualFold(sev, "critical") && triggered {
			t.Fatalf("expected non-critical severity %q NOT to trigger notification", sev)
		}
	}

	notifSvc.WaitPending(2 * time.Second)
	if mockMailer.Count() != 1 {
		t.Fatalf("expected exactly 1 email sent for critical severity only, got %d", mockMailer.Count())
	}
}

func TestKillSwitchMiddlewareLogic(t *testing.T) {
	active := true
	mw := middleware.KillSwitch(func(_ context.Context) bool {
		return active
	})

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	wrapped := mw(nextHandler)

	// 1. When active (true), middleware allows request through (200 OK)
	req1 := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil)
	rec1 := httptest.NewRecorder()
	wrapped.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusOK {
		t.Fatalf("expected 200 OK when kill switch is active, got %d", rec1.Code)
	}

	// 2. When inactive (false), middleware blocks request with 503 Service Unavailable
	active = false
	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil)
	rec2 := httptest.NewRecorder()
	wrapped.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 Service Unavailable when kill switch is inactive, got %d", rec2.Code)
	}
}

func TestAdminKillSwitchHandlerWithMockRedisAndEmail(t *testing.T) {
	ctx := context.Background()
	cfg := config.DefaultConfig()
	repo := repository.NewMemoryRepository(nil)
	authSvc := service.NewAuthService(cfg.Security, repo)
	telemetrySvc := service.NewTelemetryService(cfg, repo, nil, nil, nil)

	mockRedis := service.NewMemoryRedisClient()
	mockMailer := &mockEmailSender{}
	telemetrySvc.SetRedisClient(mockRedis)
	telemetrySvc.SetEmailSender(mockMailer)

	h := handler.NewHandler(cfg, authSvc, telemetrySvc, nil)

	// 1. Disable backend via UpdateKillSwitch handler
	disablePayload, _ := json.Marshal(map[string]interface{}{
		"enabled": false,
		"reason":  "Emergency containment during active incident",
	})
	reqDisable := httptest.NewRequest(http.MethodPost, "/api/v1/admin/kill-switch", bytes.NewReader(disablePayload))
	recDisable := httptest.NewRecorder()
	h.UpdateKillSwitch(recDisable, reqDisable)

	if recDisable.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from UpdateKillSwitch, got %d: %s", recDisable.Code, recDisable.Body.String())
	}

	// Verify Redis state is "false"
	val, err := mockRedis.Get(ctx, cfg.Redis.KillSwitchKey)
	if err != nil || val != "false" {
		t.Fatalf("expected Redis key %s to be 'false', got %q (err=%v)", cfg.Redis.KillSwitchKey, val, err)
	}
	if telemetrySvc.IsBackendEnabled(ctx) {
		t.Fatal("expected IsBackendEnabled to return false after disabling kill switch")
	}

	// Wait for async warning email to secadmin
	telemetrySvc.NotificationService().WaitPending(2 * time.Second)
	if mockMailer.Count() != 1 {
		t.Fatalf("expected 1 warning email sent to secadmin when backend disabled, got %d", mockMailer.Count())
	}
	lastMail := mockMailer.Last()
	if lastMail.To != cfg.Notification.SecAdminEmail || !strings.Contains(lastMail.Subject, "WARNING") {
		t.Fatalf("unexpected kill switch warning email: %+v", lastMail)
	}

	// 2. Re-enable backend via UpdateKillSwitch handler
	enablePayload, _ := json.Marshal(map[string]interface{}{
		"enabled": true,
		"reason":  "Incident resolved",
	})
	reqEnable := httptest.NewRequest(http.MethodPost, "/api/v1/admin/kill-switch", bytes.NewReader(enablePayload))
	recEnable := httptest.NewRecorder()
	h.UpdateKillSwitch(recEnable, reqEnable)

	if recEnable.Code != http.StatusOK {
		t.Fatalf("expected 200 OK when re-enabling kill switch, got %d", recEnable.Code)
	}
	if !telemetrySvc.IsBackendEnabled(ctx) {
		t.Fatal("expected IsBackendEnabled to return true after re-enabling kill switch")
	}

	// Verify audit logs recorded both transitions
	audits, err := repo.ListAuditLogs(ctx, models.EventFilter{Limit: 10})
	if err != nil || audits.Total < 2 {
		t.Fatalf("expected at least 2 audit logs for kill switch transitions, got %d (err=%v)", audits.Total, err)
	}
}


