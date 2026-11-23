package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gettalk/security/backend/internal/config"
	"github.com/gettalk/security/backend/internal/handler"
	"github.com/gettalk/security/backend/internal/models"
	"github.com/gettalk/security/backend/internal/repository"
	"github.com/gettalk/security/backend/internal/router"
	"github.com/gettalk/security/backend/internal/service"
)

func TestAuthenticationAuthorizationCSRFAndSensitiveDataExposure(t *testing.T) {
	srv, repo, authSvc, _ := setupTestServer(t)
	defer srv.Close()

	ctx := context.Background()
	_, _ = authSvc.CreateUser(ctx, "viewer1", "viewer1@gettalk.example", "ViewerPass!123", models.RoleViewer)
	_, _ = authSvc.CreateUser(ctx, "analyst1", "analyst1@gettalk.example", "AnalystPass!123", models.RoleAnalyst)

	// 1. Unauthenticated access must be rejected with 401 UNAUTHORIZED
	unauthEndpoints := []string{
		"/api/v1/dashboard/overview",
		"/api/v1/events",
		"/api/v1/alerts",
		"/api/v1/rules",
		"/api/v1/audit-logs",
		"/api/v1/stream",
	}
	for _, ep := range unauthEndpoints {
		resp, err := http.Get(srv.URL + ep)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized on %s without session, got %d", ep, resp.StatusCode)
		}
	}

	// 2. Viewer RBAC enforcement: can read overview, cannot acknowledge alerts, create rules, or read audit logs
	viewerCookie, viewerCSRF := loginTestAdmin(t, srv.URL, "viewer1", "ViewerPass!123")
	client := &http.Client{}

	// Viewer attempting POST /api/v1/rules -> 403 Forbidden
	rulePayload, _ := json.Marshal(map[string]interface{}{
		"id": "CUSTOM-001", "ruleName": "Custom Rule", "ruleType": "threshold",
		"threshold": 10, "timeWindow": 60, "severity": "medium", "enabled": true,
	})
	reqRule, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/rules", bytes.NewReader(rulePayload))
	reqRule.AddCookie(viewerCookie)
	reqRule.Header.Set("Content-Type", "application/json")
	reqRule.Header.Set("X-CSRF-Token", viewerCSRF)
	respRule, _ := client.Do(reqRule)
	respRule.Body.Close()
	if respRule.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when viewer attempts POST /api/v1/rules, got %d", respRule.StatusCode)
	}

	// Viewer attempting GET /api/v1/audit-logs -> 403 Forbidden
	reqAudit, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/audit-logs", nil)
	reqAudit.AddCookie(viewerCookie)
	respAudit, _ := client.Do(reqAudit)
	respAudit.Body.Close()
	if respAudit.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when viewer attempts GET /api/v1/audit-logs, got %d", respAudit.StatusCode)
	}

	// 3. Analyst RBAC: can read audit logs, cannot create rules
	analystCookie, analystCSRF := loginTestAdmin(t, srv.URL, "analyst1", "AnalystPass!123")
	reqAnalystAudit, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/audit-logs", nil)
	reqAnalystAudit.AddCookie(analystCookie)
	respAnalystAudit, _ := client.Do(reqAnalystAudit)
	respAnalystAudit.Body.Close()
	if respAnalystAudit.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK when analyst reads /api/v1/audit-logs, got %d", respAnalystAudit.StatusCode)
	}

	reqAnalystRule, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/rules", bytes.NewReader(rulePayload))
	reqAnalystRule.AddCookie(analystCookie)
	reqAnalystRule.Header.Set("Content-Type", "application/json")
	reqAnalystRule.Header.Set("X-CSRF-Token", analystCSRF)
	respAnalystRule, _ := client.Do(reqAnalystRule)
	respAnalystRule.Body.Close()
	if respAnalystRule.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when analyst attempts POST /api/v1/rules, got %d", respAnalystRule.StatusCode)
	}

	// 4. Admin CSRF Enforcement: mutating request with cookie but WITHOUT X-CSRF-Token must fail with 403
	adminCookie, adminCSRF := loginTestAdmin(t, srv.URL, "secadmin", "SecAdmin!2026#GetTalk")
	reqNoCSRF, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/rules", bytes.NewReader(rulePayload))
	reqNoCSRF.AddCookie(adminCookie)
	reqNoCSRF.Header.Set("Content-Type", "application/json")
	respNoCSRF, _ := client.Do(reqNoCSRF)
	respNoCSRF.Body.Close()
	if respNoCSRF.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when CSRF token is missing on cookie-authenticated POST, got %d", respNoCSRF.StatusCode)
	}

	// With valid CSRF token, Admin succeeds with 201 Created
	reqWithCSRF, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/rules", bytes.NewReader(rulePayload))
	reqWithCSRF.AddCookie(adminCookie)
	reqWithCSRF.Header.Set("Content-Type", "application/json")
	reqWithCSRF.Header.Set("X-CSRF-Token", adminCSRF)
	respWithCSRF, _ := client.Do(reqWithCSRF)
	respWithCSRF.Body.Close()
	if respWithCSRF.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created when admin creates rule with valid CSRF token, got %d", respWithCSRF.StatusCode)
	}

	// 5. Sensitive Data Exposure Check on /api/v1/auth/session and /api/v1/settings
	reqSess, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/auth/session", nil)
	reqSess.AddCookie(adminCookie)
	respSess, _ := client.Do(reqSess)
	rawSessBytes, _ := io.ReadAll(respSess.Body)
	respSess.Body.Close()
	rawSessStr := string(rawSessBytes)

	for _, forbiddenField := range []string{"passwordHash", "password_hash", "mfaSecret", "mfa_secret", "sessionSecret"} {
		if strings.Contains(rawSessStr, forbiddenField) {
			t.Fatalf("sensitive field %q leaked in session response: %s", forbiddenField, rawSessStr)
		}
	}
	_ = repo
}

func TestInputValidationSQLInjectionResistanceAndRateLimiting(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Server.Environment = "test"
	cfg.Security.RateLimitRequestsPerMinute = 5
	cfg.Security.AuthRateLimitPerMinute = 3

	repo := repository.NewMemoryRepository(nil)
	broker := service.NewSSEBroker()
	authSvc := service.NewAuthService(cfg.Security, repo)
	_ = authSvc.EnsureBootstrapAdmin(context.Background(), "test")
	telemetrySvc := service.NewTelemetryService(cfg, repo, nil, nil, nil)
	h := handler.NewHandler(cfg, authSvc, telemetrySvc, broker)
	srv := httptest.NewServer(router.NewRouter(cfg, authSvc, h))
	defer srv.Close()

	adminCookie, _ := loginTestAdmin(t, srv.URL, "secadmin", "SecAdmin!2026#GetTalk")
	client := &http.Client{}

	// 1. SQL Injection & Malformed Input Validation Tests
	sqliPayloads := []string{
		"198.51.100.1' OR '1'='1",
		"198.51.100.1; DROP TABLE telemetry_events;--",
		"198.51.100.1 UNION SELECT username, password_hash FROM security_admins",
	}

	for _, payload := range sqliPayloads {
		encoded := url.QueryEscape(payload)
		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/events?sourceIp="+encoded, nil)
		req.AddCookie(adminCookie)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request for SQLi payload in sourceIp filter (%q), got %d", payload, resp.StatusCode)
		}
	}

	// 2. Rate Limiting Enforcement (limit = 5 req/min)
	got429 := false
	for i := 0; i < 10; i++ {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/dashboard/overview", nil)
		req.AddCookie(adminCookie)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode == http.StatusTooManyRequests {
			if resp.Header.Get("Retry-After") == "" {
				t.Fatal("expected Retry-After header on 429 Too Many Requests response")
			}
			got429 = true
			break
		}
	}
	if !got429 {
		t.Fatal("expected rate limiter to trigger 429 Too Many Requests")
	}
}

func TestMFATOTPAndBruteForceLockout(t *testing.T) {
	ctx := context.Background()
	cfg := config.DefaultConfig()
	cfg.Security.MaxFailedLoginAttempts = 3
	cfg.Security.LockoutDurationMinutes = 15

	repo := repository.NewMemoryRepository(nil)
	authSvc := service.NewAuthService(cfg.Security, repo)
	user, err := authSvc.CreateUser(ctx, "mfaadmin", "mfa@gettalk.example", "StrongPass!999", models.RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}

	// Setup and enable TOTP MFA
	secret, uri, err := authSvc.SetupMFA(ctx, user.ID)
	if err != nil || secret == "" || !strings.HasPrefix(uri, "otpauth://totp/") {
		t.Fatalf("SetupMFA failed: err=%v uri=%s", err, uri)
	}

	code, err := service.GenerateTOTP(secret, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if err := authSvc.EnableMFA(ctx, user.ID, code); err != nil {
		t.Fatalf("EnableMFA failed: %v", err)
	}

	// Login must now require MFA challenge verification
	loginRes, err := authSvc.Login(ctx, "mfaadmin", "StrongPass!999", "127.0.0.1", "GoTest")
	if err != nil || !loginRes.MFARequired || loginRes.ChallengeID == "" {
		t.Fatalf("expected MFARequired=true, got %+v (err=%v)", loginRes, err)
	}

	// Verify with wrong MFA code must fail
	if _, err := authSvc.VerifyMFA(ctx, loginRes.ChallengeID, "000000", "127.0.0.1", "GoTest"); err == nil {
		t.Fatal("expected wrong MFA code to be rejected")
	}

	// Verify with valid TOTP code must succeed
	mfaRes, err := authSvc.VerifyMFA(ctx, loginRes.ChallengeID, code, "127.0.0.1", "GoTest")
	if err != nil || mfaRes.Session == nil {
		t.Fatalf("expected valid MFA verification to issue session, got err=%v", err)
	}

	// Brute-force lockout after 3 consecutive failed password attempts
	for i := 0; i < 3; i++ {
		_, _ = authSvc.Login(ctx, "mfaadmin", "WrongPassword", "127.0.0.1", "GoTest")
	}
	if _, err := authSvc.Login(ctx, "mfaadmin", "StrongPass!999", "127.0.0.1", "GoTest"); err != service.ErrAccountLocked {
		t.Fatalf("expected account to be locked with ErrAccountLocked, got %v", err)
	}
}

func TestKillSwitchAccessControlInjectionFloodingAndLeakagePrevention(t *testing.T) {
	ctx := context.Background()
	cfg := config.DefaultConfig()
	cfg.Server.Environment = "test"
	cfg.Security.RateLimitRequestsPerMinute = 500
	cfg.Security.AuthRateLimitPerMinute = 50
	cfg.Redis.RestURL = "https://secret-upstash-endpoint.upstash.io"
	cfg.Redis.RestToken = "UPSTASH_SUPER_SECRET_TOKEN_999"
	cfg.Redis.CooldownTTLSeconds = 300
	cfg.Notification.SMTPHost = "smtp.internal-secret.example"
	cfg.Notification.SMTPUser = "smtp_secret_user"
	cfg.Notification.SMTPPass = "SMTP_SUPER_SECRET_PASS_888"

	repo := repository.NewMemoryRepository(nil)
	broker := service.NewSSEBroker()
	authSvc := service.NewAuthService(cfg.Security, repo)
	_ = authSvc.EnsureBootstrapAdmin(ctx, "test")
	_, _ = authSvc.CreateUser(ctx, "viewer_sec", "viewer@gettalk.example", "ViewerPass!123", models.RoleViewer)
	_, _ = authSvc.CreateUser(ctx, "analyst_sec", "analyst@gettalk.example", "AnalystPass!123", models.RoleAnalyst)

	mockRedis := service.NewMemoryRedisClient()
	mockMailer := &mockEmailSender{}

	telemetrySvc := service.NewTelemetryService(cfg, repo, nil, nil, nil)
	telemetrySvc.SetRedisClient(mockRedis)
	telemetrySvc.SetEmailSender(mockMailer)

	h := handler.NewHandler(cfg, authSvc, telemetrySvc, broker)
	srv := httptest.NewServer(router.NewRouter(cfg, authSvc, h))
	defer srv.Close()

	client := &http.Client{}
	killSwitchBody, _ := json.Marshal(map[string]interface{}{"enabled": false, "reason": "Unauthorized attempt"})

	// 1. Auth & Access Control on Admin Kill Switch Endpoint
	// 1a. Unauthenticated request -> 401 Unauthorized
	reqUnauth, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/admin/kill-switch", bytes.NewReader(killSwitchBody))
	reqUnauth.Header.Set("Content-Type", "application/json")
	respUnauth, err := client.Do(reqUnauth)
	if err != nil {
		t.Fatal(err)
	}
	respUnauth.Body.Close()
	if respUnauth.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized on unauthenticated kill-switch request, got %d", respUnauth.StatusCode)
	}

	// 1b. Invalid Bearer token -> 401 Unauthorized
	reqBadBearer, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/admin/kill-switch", bytes.NewReader(killSwitchBody))
	reqBadBearer.Header.Set("Content-Type", "application/json")
	reqBadBearer.Header.Set("Authorization", "Bearer invalid-forged-token-12345")
	respBadBearer, _ := client.Do(reqBadBearer)
	respBadBearer.Body.Close()
	if respBadBearer.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized on invalid Bearer token, got %d", respBadBearer.StatusCode)
	}

	// 1c. Viewer role -> 403 Forbidden
	viewerCookie, viewerCSRF := loginTestAdmin(t, srv.URL, "viewer_sec", "ViewerPass!123")
	reqViewer, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/admin/kill-switch", bytes.NewReader(killSwitchBody))
	reqViewer.AddCookie(viewerCookie)
	reqViewer.Header.Set("Content-Type", "application/json")
	reqViewer.Header.Set("X-CSRF-Token", viewerCSRF)
	respViewer, _ := client.Do(reqViewer)
	respViewer.Body.Close()
	if respViewer.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when viewer accesses admin kill-switch, got %d", respViewer.StatusCode)
	}

	// 1d. Analyst role -> 403 Forbidden
	analystCookie, analystCSRF := loginTestAdmin(t, srv.URL, "analyst_sec", "AnalystPass!123")
	reqAnalyst, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/admin/kill-switch", bytes.NewReader(killSwitchBody))
	reqAnalyst.AddCookie(analystCookie)
	reqAnalyst.Header.Set("Content-Type", "application/json")
	reqAnalyst.Header.Set("X-CSRF-Token", analystCSRF)
	respAnalyst, _ := client.Do(reqAnalyst)
	respAnalyst.Body.Close()
	if respAnalyst.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when analyst accesses admin kill-switch, got %d", respAnalyst.StatusCode)
	}

	// 1e. Admin without CSRF token -> 403 Forbidden
	adminCookie, adminCSRF := loginTestAdmin(t, srv.URL, "secadmin", "SecAdmin!2026#GetTalk")
	reqAdminNoCSRF, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/admin/kill-switch", bytes.NewReader(killSwitchBody))
	reqAdminNoCSRF.AddCookie(adminCookie)
	reqAdminNoCSRF.Header.Set("Content-Type", "application/json")
	respAdminNoCSRF, _ := client.Do(reqAdminNoCSRF)
	respAdminNoCSRF.Body.Close()
	if respAdminNoCSRF.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when admin omits CSRF token on kill-switch, got %d", respAdminNoCSRF.StatusCode)
	}

	// Verify backend is still enabled after all rejected attempts
	if !telemetrySvc.IsBackendEnabled(ctx) {
		t.Fatal("kill switch state must not change after unauthorized attempts")
	}

	// 2. Input Validation & SMTP Header Injection Prevention
	badPayloads := []string{
		`{"event_id": "broken-json", "severity": `,                                                                                     // Malformed JSON
		`{}`,                                                                                                                           // Empty fields
		`{"event_id": "", "severity": "critical", "description": ""}`,                                                                  // Empty required values
		`{"event_id": "evt-1", "severity": "unknown_sev", "description": "test"}`,                                                      // Invalid severity
		`{"event_id": "evt-1\r\nBcc: attacker@evil.example", "severity": "critical", "description": "Header injection in event_id"}`,   // CRLF in event_id
		`{"event_id": "evt-2", "severity": "critical", "description": "Normal line\r\nSubject: Injected Subject\r\n\r\nInjected body"}`, // CRLF in description
	}

	for _, rawPayload := range badPayloads {
		req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/events", strings.NewReader(rawPayload))
		req.AddCookie(adminCookie)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-CSRF-Token", adminCSRF)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request for invalid/injection payload %q, got %d", rawPayload, resp.StatusCode)
		}
	}

	// Ensure no email was sent from any injection payload
	telemetrySvc.NotificationService().WaitPending(time.Second)
	if mockMailer.Count() != 0 {
		t.Fatalf("expected 0 emails sent after invalid/injection payloads, got %d", mockMailer.Count())
	}

	// 3. Abuse / Flooding Prevention (Rapid Critical Events within Cooldown Window)
	for i := 0; i < 10; i++ {
		floodPayload, _ := json.Marshal(map[string]interface{}{
			"event_id":    "evt-flood-100",
			"source_ip":   "203.0.113.77",
			"severity":    "critical",
			"description": "Rapid brute-force critical flood event",
		})
		req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/events", bytes.NewReader(floodPayload))
		req.AddCookie(adminCookie)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-CSRF-Token", adminCSRF)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("expected 201 Created on critical event ingestion #%d, got %d", i+1, resp.StatusCode)
		}
	}

	telemetrySvc.NotificationService().WaitPending(2 * time.Second)
	if mockMailer.Count() != 1 {
		t.Fatalf("expected email flooding prevention (cooldown) to allow only 1 email for 10 rapid critical events, got %d", mockMailer.Count())
	}

	// 4. Information Leakage Prevention (Error Responses & Settings Endpoints)
	forbiddenSecrets := []string{
		"UPSTASH_SUPER_SECRET_TOKEN_999",
		"secret-upstash-endpoint.upstash.io",
		"SMTP_SUPER_SECRET_PASS_888",
		"smtp.internal-secret.example",
		"smtp_secret_user",
	}

	// Check settings response and error response for any leaked credentials
	reqSettings, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/settings", nil)
	reqSettings.AddCookie(adminCookie)
	respSettings, _ := client.Do(reqSettings)
	settingsBytes, _ := io.ReadAll(respSettings.Body)
	respSettings.Body.Close()

	// Also simulate an unreachable Upstash Redis client error and inspect HTTP response
	failingUpstash := service.NewUpstashRedisClient("http://127.0.0.1:1", "UPSTASH_SUPER_SECRET_TOKEN_999", &http.Client{Timeout: 50 * time.Millisecond})
	telemetrySvc.SetRedisClient(failingUpstash)

	validToggle, _ := json.Marshal(map[string]interface{}{"enabled": false, "reason": "Test error leakage"})
	reqFailRedis, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/admin/kill-switch", bytes.NewReader(validToggle))
	reqFailRedis.AddCookie(adminCookie)
	reqFailRedis.Header.Set("Content-Type", "application/json")
	reqFailRedis.Header.Set("X-CSRF-Token", adminCSRF)
	respFailRedis, _ := client.Do(reqFailRedis)
	errBytes, _ := io.ReadAll(respFailRedis.Body)
	respFailRedis.Body.Close()

	combinedOutput := string(settingsBytes) + "\n" + string(errBytes)
	for _, secret := range forbiddenSecrets {
		if strings.Contains(combinedOutput, secret) {
			t.Fatalf("sensitive credential %q leaked in HTTP response: %s", secret, combinedOutput)
		}
	}
}


