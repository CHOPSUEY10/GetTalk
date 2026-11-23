package tests

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gettalk/security/backend/internal/collector"
	"github.com/gettalk/security/backend/internal/collector/firewall"
	"github.com/gettalk/security/backend/internal/collector/nginx"
	"github.com/gettalk/security/backend/internal/collector/pm2"
	"github.com/gettalk/security/backend/internal/config"
	"github.com/gettalk/security/backend/internal/handler"
	"github.com/gettalk/security/backend/internal/middleware"
	"github.com/gettalk/security/backend/internal/models"
	"github.com/gettalk/security/backend/internal/repository"
	"github.com/gettalk/security/backend/internal/router"
	"github.com/gettalk/security/backend/internal/scheduler"
	"github.com/gettalk/security/backend/internal/service"
)

func setupTestServer(t *testing.T) (*httptest.Server, repository.Repository, *service.AuthService, *service.SSEBroker) {
	t.Helper()
	cfg := config.DefaultConfig()
	cfg.Server.Environment = "test"
	cfg.Security.RateLimitRequestsPerMinute = 500
	cfg.Security.AuthRateLimitPerMinute = 50

	rules := []models.DetectionRule{
		{ID: "NET-001", RuleName: "Repeated Firewall Rejection", RuleType: "threshold", Threshold: 50, TimeWindow: 60, Severity: models.SeverityMedium, Enabled: true, Configuration: map[string]interface{}{"source": "firewalld"}},
		{ID: "WEB-001", RuleName: "HTTP Request Flood", RuleType: "threshold", Threshold: 100, TimeWindow: 60, Severity: models.SeverityHigh, Enabled: true, Configuration: map[string]interface{}{"source": "nginx"}},
	}

	repo := repository.NewMemoryRepository(rules)
	broker := service.NewSSEBroker()
	authSvc := service.NewAuthService(cfg.Security, repo)
	_ = authSvc.EnsureBootstrapAdmin(context.Background(), "test")

	colMgr := collector.NewManager(128, 20, 50*time.Millisecond, repo, broker, nil)
	pm2Col := pm2.NewCollector(cfg.Collectors.PM2, func(_ context.Context) ([]byte, error) {
		return []byte(`[{"name":"gettalk-api","pid":1234,"pm_id":0,"monit":{"memory":104857600,"cpu":12.5},"pm2_env":{"status":"online","restart_time":0,"pm_uptime":1700000000000,"instances":1,"exec_mode":"fork_mode"}}]`), nil
	})
	colMgr.Register(pm2Col)
	pm2Col.CollectOnce(context.Background(), colMgr)

	sched := scheduler.NewScheduler(cfg.Detection, cfg.Retention, nil, repo, nil)
	telemetrySvc := service.NewTelemetryService(cfg, repo, colMgr, pm2Col, sched)
	h := handler.NewHandler(cfg, authSvc, telemetrySvc, broker)
	rt := router.NewRouter(cfg, authSvc, h)

	return httptest.NewServer(rt), repo, authSvc, broker
}

func loginTestAdmin(t *testing.T, srvURL, username, password string) (sessionCookie *http.Cookie, csrfToken string) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"username": username, "password": password})
	resp, err := http.Post(srvURL+"/api/v1/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("login request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK on login, got %d", resp.StatusCode)
	}
	for _, c := range resp.Cookies() {
		if c.Name == "gt_sec_session" {
			sessionCookie = c
		}
	}
	var payload struct {
		Data struct {
			CSRFToken string `json:"csrfToken"`
		} `json:"data"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&payload)
	return sessionCookie, payload.Data.CSRFToken
}

func TestAPIEndpointsPaginationFilteringAndRetention(t *testing.T) {
	srv, repo, _, _ := setupTestServer(t)
	defer srv.Close()

	ctx := context.Background()
	now := time.Now().UTC()

	// Seed 25 telemetry events and 1 alert
	events := make([]models.TelemetryEvent, 0, 25)
	for i := 0; i < 25; i++ {
		src := models.SourceFirewalld
		evType := "packet_drop"
		if i%2 == 0 {
			src = models.SourceNginx
			evType = "http_request"
		}
		events = append(events, models.TelemetryEvent{
			Source:     src,
			EventType:  evType,
			SourceIP:   "198.51.100.25",
			Severity:   models.SeverityMedium,
			OccurredAt: now.Add(-time.Duration(i) * time.Minute),
			EventData:  map[string]interface{}{"status_code": 200, "endpoint": "/api/health", "request_duration_ms": 12.4},
		})
	}
	_ = repo.SaveEventsBatch(ctx, events)
	_, _, _ = repo.UpsertOrDeduplicateAlert(ctx, models.SecurityAlert{
		RuleID:      "NET-001",
		Title:       "Repeated Firewall Rejection from 198.51.100.25",
		Description: "Test alert",
		Severity:    models.SeverityMedium,
		SourceIP:    "198.51.100.25",
		Status:      models.AlertStatusOpen,
		FirstSeen:   now,
		LastSeen:    now,
		EventCount:  55,
	}, time.Minute)

	cookie, csrf := loginTestAdmin(t, srv.URL, "secadmin", "SecAdmin!2026#GetTalk")

	client := &http.Client{}
	getJSON := func(path string) (*http.Response, map[string]interface{}) {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+path, nil)
		req.AddCookie(cookie)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("GET %s failed: %v", path, err)
		}
		defer resp.Body.Close()
		var out map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp, out
	}

	// Verify required GET endpoints
	endpoints := []string{
		"/api/v1/dashboard/overview",
		"/api/v1/dashboard/traffic?range=1h",
		"/api/v1/network/events?limit=5&offset=0",
		"/api/v1/network/statistics",
		"/api/v1/web/requests?limit=5&offset=0",
		"/api/v1/web/statistics",
		"/api/v1/application/processes",
		"/api/v1/application/metrics",
		"/api/v1/events?limit=10&offset=0&source=nginx",
		"/api/v1/alerts?limit=10",
		"/api/v1/rules",
		"/api/v1/audit-logs",
		"/api/v1/settings",
	}

	for _, ep := range endpoints {
		resp, body := getJSON(ep)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET %s returned %d: %v", ep, resp.StatusCode, body)
		}
		if body["status"] != "success" {
			t.Fatalf("GET %s missing status=success: %v", ep, body)
		}
	}

	// Test Pagination on /api/v1/events
	_, evBody := getJSON("/api/v1/events?limit=10&offset=0")
	dataMap := evBody["data"].(map[string]interface{})
	if int(dataMap["total"].(float64)) != 25 || !dataMap["hasMore"].(bool) {
		t.Fatalf("unexpected pagination meta: %+v", dataMap)
	}

	// Test PATCH /api/v1/alerts/:id (Acknowledge alert)
	alertsList, _ := repo.ListAlerts(ctx, models.EventFilter{Limit: 1})
	alertID := alertsList.Items[0].ID

	patchBody, _ := json.Marshal(map[string]string{"status": "acknowledged"})
	patchReq, _ := http.NewRequest(http.MethodPatch, srv.URL+"/api/v1/alerts/"+alertID, bytes.NewReader(patchBody))
	patchReq.AddCookie(cookie)
	patchReq.Header.Set("Content-Type", "application/json")
	patchReq.Header.Set("X-CSRF-Token", csrf)
	patchResp, err := client.Do(patchReq)
	if err != nil || patchResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH alert failed: %v (status %d)", err, patchResp.StatusCode)
	}
	patchResp.Body.Close()

	updatedAlert, _ := repo.GetAlertByID(ctx, alertID)
	if updatedAlert.Status != models.AlertStatusAcknowledged {
		t.Fatalf("expected alert status acknowledged, got %s", updatedAlert.Status)
	}
}

func TestNginxIncrementalLogReadingAndRotation(t *testing.T) {
	ctx := context.Background()
	tmpDir := t.TempDir()
	accessPath := filepath.Join(tmpDir, "access.log")
	errorPath := filepath.Join(tmpDir, "error.log")

	line1 := `{"timestamp":"2026-11-18T09:00:01Z","remote_addr":"127.0.0.1","x_forwarded_for":"198.51.100.1","request_method":"GET","request_uri":"/api/health","status":200,"request_time":0.005}` + "\n"
	if err := os.WriteFile(accessPath, []byte(line1), 0600); err != nil {
		t.Fatal(err)
	}

	repo := repository.NewMemoryRepository(nil)
	col := nginx.NewCollector(config.NginxConfig{
		Enabled:             true,
		AccessLogPath:       accessPath,
		ErrorLogPath:        errorPath,
		CheckpointKeyPrefix: "test_nginx",
		TrustedReverseProxy: true,
	}, []string{"127.0.0.1"}, repo)

	sink := &testSink{}
	col.ReadOnce(ctx, sink)
	if len(sink.events) != 1 {
		t.Fatalf("expected 1 event after first read, got %d", len(sink.events))
	}

	// Reading again without new lines must NOT re-ingest existing lines
	col.ReadOnce(ctx, sink)
	if len(sink.events) != 1 {
		t.Fatalf("expected 1 event when file unchanged, got %d", len(sink.events))
	}

	// Append second line and verify incremental read picks up only the new line
	f, _ := os.OpenFile(accessPath, os.O_APPEND|os.O_WRONLY, 0600)
	line2 := `{"timestamp":"2026-11-18T09:00:02Z","remote_addr":"127.0.0.1","x_forwarded_for":"198.51.100.2","request_method":"POST","request_uri":"/api/auth/login","status":401,"request_time":0.015}` + "\n"
	_, _ = f.WriteString(line2)
	_ = f.Close()

	col.ReadOnce(ctx, sink)
	if len(sink.events) != 2 {
		t.Fatalf("expected 2 events after appending line2, got %d", len(sink.events))
	}

	// Simulate log rotation (truncate/replace with a brand new file containing 1 line)
	lineRotated := `{"timestamp":"2026-11-18T09:01:00Z","remote_addr":"127.0.0.1","x_forwarded_for":"198.51.100.3","request_method":"GET","request_uri":"/rotated","status":200,"request_time":0.002}` + "\n"
	if err := os.WriteFile(accessPath, []byte(lineRotated), 0600); err != nil {
		t.Fatal(err)
	}

	col.ReadOnce(ctx, sink)
	if len(sink.events) != 3 {
		t.Fatalf("expected 3 events after log rotation recovery, got %d", len(sink.events))
	}
}

func TestCollectorLifecycleAndSSEStreaming(t *testing.T) {
	srv, _, _, broker := setupTestServer(t)
	defer srv.Close()

	// Verify collector graceful handling when journald is unavailable
	fwCol := firewall.NewCollector(config.FirewalldConfig{Enabled: true}, func(_ context.Context) (io.ReadCloser, error) {
		return nil, errors.New("journalctl unavailable in test")
	})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		_ = fwCol.Start(ctx, &testSink{})
		close(done)
	}()
	time.Sleep(50 * time.Millisecond)
	cancel()
	<-done

	// Test SSE stream endpoint
	cookie, _ := loginTestAdmin(t, srv.URL, "secadmin", "SecAdmin!2026#GetTalk")
	streamCtx, streamCancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer streamCancel()

	req, _ := http.NewRequestWithContext(streamCtx, http.MethodGet, srv.URL+"/api/v1/stream", nil)
	req.AddCookie(cookie)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("SSE request failed: %v", err)
	}
	defer resp.Body.Close()

	if !strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("expected text/event-stream content type, got %s", resp.Header.Get("Content-Type"))
	}

	// Publish a live alert event and read from SSE stream
	go func() {
		time.Sleep(50 * time.Millisecond)
		broker.Publish(models.StreamMessage{
			Type:      "security_alert",
			Timestamp: time.Now().UTC(),
			Payload:   map[string]string{"ruleId": "NET-001"},
		})
	}()

	reader := bufio.NewReader(resp.Body)
	receivedAlertEvent := false
	for i := 0; i < 10; i++ {
		line, err := reader.ReadString('\n')
		if err != nil {
			break
		}
		if strings.Contains(line, "security_alert") {
			receivedAlertEvent = true
			break
		}
	}
	if !receivedAlertEvent {
		t.Fatal("expected SSE client to receive published security_alert event")
	}
}

func TestSIEMCriticalNotificationAndKillSwitchEndToEndFlow(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Server.Environment = "test"
	cfg.Security.RateLimitRequestsPerMinute = 500
	cfg.Security.AuthRateLimitPerMinute = 50
	cfg.Redis.CooldownTTLSeconds = 120

	repo := repository.NewMemoryRepository(nil)
	broker := service.NewSSEBroker()
	authSvc := service.NewAuthService(cfg.Security, repo)
	_ = authSvc.EnsureBootstrapAdmin(context.Background(), "test")

	mockRedis := service.NewMemoryRedisClient()
	mockMailer := &mockEmailSender{}

	telemetrySvc := service.NewTelemetryService(cfg, repo, nil, nil, nil)
	telemetrySvc.SetRedisClient(mockRedis)
	telemetrySvc.SetEmailSender(mockMailer)

	h := handler.NewHandler(cfg, authSvc, telemetrySvc, broker)
	rt := router.NewRouter(cfg, authSvc, h)
	srv := httptest.NewServer(rt)
	defer srv.Close()

	adminCookie, adminCSRF := loginTestAdmin(t, srv.URL, "secadmin", "SecAdmin!2026#GetTalk")
	client := &http.Client{}

	postJSON := func(path string, payload interface{}) *http.Response {
		b, _ := json.Marshal(payload)
		req, _ := http.NewRequest(http.MethodPost, srv.URL+path, bytes.NewReader(b))
		req.AddCookie(adminCookie)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-CSRF-Token", adminCSRF)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("POST %s failed: %v", path, err)
		}
		return resp
	}

	// 1. Send a non-critical SIEM event -> 201 Created, no email sent
	respLow := postJSON("/api/v1/events", map[string]interface{}{
		"event_id":    "evt-low-001",
		"source_ip":   "198.51.100.40",
		"severity":    "low",
		"description": "Routine port connection attempt",
	})
	respLow.Body.Close()
	if respLow.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created for low severity event, got %d", respLow.StatusCode)
	}
	telemetrySvc.NotificationService().WaitPending(2 * time.Second)
	if mockMailer.Count() != 0 {
		t.Fatalf("expected 0 emails for low severity event, got %d", mockMailer.Count())
	}

	// 2. Send a critical SIEM event -> 201 Created, cooldown stored in Redis, email sent to secadmin
	respCrit := postJSON("/api/v1/events", map[string]interface{}{
		"event_id":    "evt-crit-001",
		"source_ip":   "198.51.100.99",
		"severity":    "CRITICAL",
		"description": "Active privilege escalation exploit detected",
	})
	respCrit.Body.Close()
	if respCrit.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created for critical severity event, got %d", respCrit.StatusCode)
	}
	telemetrySvc.NotificationService().WaitPending(2 * time.Second)
	if mockMailer.Count() != 1 {
		t.Fatalf("expected 1 email for critical event, got %d", mockMailer.Count())
	}

	// Verify cooldown key exists in Redis
	cooldownKey := telemetrySvc.NotificationService().CooldownKey("198.51.100.99", "evt-crit-001")
	cdVal, err := mockRedis.Get(context.Background(), cooldownKey)
	if err != nil || cdVal == "" {
		t.Fatalf("expected cooldown key %s to be stored in Redis, got val=%q err=%v", cooldownKey, cdVal, err)
	}

	// 3. Turn OFF backend kill switch via admin endpoint -> 200 OK
	respKillOff := postJSON("/api/v1/admin/kill-switch", map[string]interface{}{
		"enabled": false,
		"reason":  "Maintenance and emergency isolation",
	})
	respKillOff.Body.Close()
	if respKillOff.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK when disabling kill switch, got %d", respKillOff.StatusCode)
	}
	telemetrySvc.NotificationService().WaitPending(2 * time.Second)
	if mockMailer.Count() != 2 {
		t.Fatalf("expected kill switch deactivation to send warning email (total 2), got %d", mockMailer.Count())
	}

	// 4. Verify SIEM dashboard routes remain 200 OK while Chat Server Kill Switch is OFF,
	//    and any protected Chat Backend route guarded by KillSwitch middleware immediately returns 503.
	for _, path := range []string{"/api/v1/events", "/api/v1/dashboard/overview", "/api/v1/alerts", "/api/v1/audit-logs"} {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+path, nil)
		req.AddCookie(adminCookie)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected SIEM route GET %s to remain 200 OK while Chat Server kill switch is OFF, got %d", path, resp.StatusCode)
		}
	}

	// Simulate target Chat Server route protected by KillSwitch reading the same Upstash Redis state
	protectedChatRoute := middleware.KillSwitch(h.IsBackendEnabled)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	chatReqOff := httptest.NewRequest(http.MethodGet, "/api/conversations", nil)
	chatRecOff := httptest.NewRecorder()
	protectedChatRoute.ServeHTTP(chatRecOff, chatReqOff)
	if chatRecOff.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 Service Unavailable on protected chat route when kill switch is OFF, got %d", chatRecOff.Code)
	}

	// 5. Turn ON chat server kill switch via admin endpoint -> 200 OK, and verify protected chat route recovers
	respKillOn := postJSON("/api/v1/admin/kill-switch", map[string]interface{}{
		"enabled": true,
		"reason":  "System restored to normal operation",
	})
	respKillOn.Body.Close()
	if respKillOn.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK when re-enabling kill switch, got %d", respKillOn.StatusCode)
	}

	chatReqOn := httptest.NewRequest(http.MethodGet, "/api/conversations", nil)
	chatRecOn := httptest.NewRecorder()
	protectedChatRoute.ServeHTTP(chatRecOn, chatReqOn)
	if chatRecOn.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on protected chat route after kill switch re-enabled, got %d", chatRecOn.Code)
	}
}

