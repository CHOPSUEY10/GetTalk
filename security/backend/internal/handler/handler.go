package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gettalk/security/backend/internal/config"
	"github.com/gettalk/security/backend/internal/middleware"
	"github.com/gettalk/security/backend/internal/models"
	"github.com/gettalk/security/backend/internal/repository"
	"github.com/gettalk/security/backend/internal/service"
	"github.com/go-chi/chi/v5"
)

// Handler provides HTTP handlers for all `/api/v1` endpoints.
type Handler struct {
	cfg          *config.Config
	authSvc      *service.AuthService
	telemetrySvc *service.TelemetryService
	broker       *service.SSEBroker
}

// NewHandler creates a new HTTP Handler.
func NewHandler(
	cfg *config.Config,
	authSvc *service.AuthService,
	telemetrySvc *service.TelemetryService,
	broker *service.SSEBroker,
) *Handler {
	return &Handler{
		cfg:          cfg,
		authSvc:      authSvc,
		telemetrySvc: telemetrySvc,
		broker:       broker,
	}
}

func sendSuccess(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	resp := map[string]interface{}{
		"status": "success",
	}
	if data != nil {
		resp["data"] = data
	}
	_ = json.NewEncoder(w).Encode(resp)
}

func handleServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrValidation):
		middleware.WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", sanitizeClientErrorMessage(err.Error()))
	case errors.Is(err, service.ErrInvalidCredentials):
		middleware.WriteError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Invalid username or password")
	case errors.Is(err, service.ErrAccountLocked):
		middleware.WriteError(w, http.StatusLocked, "LOGIN_LOCKED", "Account temporarily locked due to repeated failed attempts")
	case errors.Is(err, service.ErrInvalidMFACode):
		middleware.WriteError(w, http.StatusUnauthorized, "INVALID_MFA_CODE", "Invalid or expired MFA verification code")
	case errors.Is(err, service.ErrUnauthorized):
		middleware.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
	case errors.Is(err, service.ErrForbidden):
		middleware.WriteError(w, http.StatusForbidden, "FORBIDDEN", "Insufficient permissions")
	case errors.Is(err, service.ErrResourceNotFound):
		middleware.WriteError(w, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Requested resource not found")
	case errors.Is(err, service.ErrResourceConflict):
		middleware.WriteError(w, http.StatusConflict, "CONFLICT", "Resource already exists")
	default:
		// Never leak internal errors, SQL queries, or stack traces
		middleware.WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected internal error occurred")
	}
}

func sanitizeClientErrorMessage(msg string) string {
	trimmed := strings.TrimPrefix(msg, "validation error: ")
	if len(trimmed) > 200 {
		trimmed = trimmed[:200]
	}
	return trimmed
}

// Health returns service readiness without exposing sensitive host details.
func (h *Handler) Health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// ── Authentication Endpoints ─────────────────────────────────────────────────

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "Invalid JSON request body")
		return
	}
	if strings.TrimSpace(req.Username) == "" || req.Password == "" {
		middleware.WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Username and password are required")
		return
	}

	res, err := h.authSvc.Login(r.Context(), req.Username, req.Password, middleware.ClientIP(r), r.UserAgent())
	if err != nil {
		handleServiceError(w, err)
		return
	}

	if res.MFARequired {
		sendSuccess(w, http.StatusOK, map[string]interface{}{
			"mfaRequired": true,
			"challengeId": res.ChallengeID,
		})
		return
	}

	h.setSessionCookie(w, res.Session)
	sendSuccess(w, http.StatusOK, map[string]interface{}{
		"mfaRequired": false,
		"user":        res.User,
		"csrfToken":   res.Session.CSRFToken,
	})
}

type mfaVerifyRequest struct {
	ChallengeID string `json:"challengeId"`
	Code        string `json:"code"`
}

func (h *Handler) VerifyMFA(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	var req mfaVerifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "Invalid JSON request body")
		return
	}
	if strings.TrimSpace(req.ChallengeID) == "" || strings.TrimSpace(req.Code) == "" {
		middleware.WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "challengeId and code are required")
		return
	}

	res, err := h.authSvc.VerifyMFA(r.Context(), req.ChallengeID, req.Code, middleware.ClientIP(r), r.UserAgent())
	if err != nil {
		handleServiceError(w, err)
		return
	}

	h.setSessionCookie(w, res.Session)
	sendSuccess(w, http.StatusOK, map[string]interface{}{
		"user":      res.User,
		"csrfToken": res.Session.CSRFToken,
	})
}

func (h *Handler) SetupMFA(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetAdminUser(r.Context())
	if user == nil {
		middleware.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	secret, uri, err := h.authSvc.SetupMFA(r.Context(), user.ID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	sendSuccess(w, http.StatusOK, map[string]string{
		"secret":     secret,
		"otpauthUri": uri,
	})
}

type mfaEnableRequest struct {
	Code string `json:"code"`
}

func (h *Handler) EnableMFA(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetAdminUser(r.Context())
	if user == nil {
		middleware.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
	var req mfaEnableRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Code) == "" {
		middleware.WriteError(w, http.StatusBadRequest, "VALIDATION_ERROR", "6-digit MFA code is required")
		return
	}
	if err := h.authSvc.EnableMFA(r.Context(), user.ID, req.Code); err != nil {
		handleServiceError(w, err)
		return
	}
	sendSuccess(w, http.StatusOK, map[string]bool{"mfaEnabled": true})
}

func (h *Handler) GetSession(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetAdminUser(r.Context())
	sess := middleware.GetAdminSession(r.Context())
	if user == nil || sess == nil {
		middleware.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	sendSuccess(w, http.StatusOK, map[string]interface{}{
		"user":      user,
		"csrfToken": sess.CSRFToken,
	})
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetAdminUser(r.Context())
	sess := middleware.GetAdminSession(r.Context())
	sessID := ""
	actorID := ""
	if sess != nil {
		sessID = sess.ID
	}
	if user != nil {
		actorID = user.ID
	}
	_ = h.authSvc.Logout(r.Context(), sessID, actorID)

	cookieName := h.cfg.Security.CookieName
	if cookieName == "" {
		cookieName = "gt_sec_session"
	}
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   h.cfg.Security.CookieSecure,
		MaxAge:   -1,
	})
	sendSuccess(w, http.StatusOK, map[string]bool{"loggedOut": true})
}

func (h *Handler) setSessionCookie(w http.ResponseWriter, sess *models.AdminSession) {
	cookieName := h.cfg.Security.CookieName
	if cookieName == "" {
		cookieName = "gt_sec_session"
	}
	sameSite := http.SameSiteLaxMode
	switch strings.ToLower(h.cfg.Security.CookieSameSite) {
	case "strict":
		sameSite = http.SameSiteStrictMode
	case "none":
		if h.cfg.Security.CookieSecure {
			sameSite = http.SameSiteNoneMode
		}
	}
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    sess.ID,
		Path:     "/",
		HttpOnly: true,
		Secure:   h.cfg.Security.CookieSecure,
		SameSite: sameSite,
		Expires:  sess.ExpiresAt,
	})
}

// ── Dashboard & Telemetry Endpoints ──────────────────────────────────────────

func (h *Handler) DashboardOverview(w http.ResponseWriter, r *http.Request) {
	from, _, err := parseTimeRange(r, 24*time.Hour)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	overview, err := h.telemetrySvc.GetDashboardOverview(r.Context(), from)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	sendSuccess(w, http.StatusOK, overview)
}

func (h *Handler) DashboardTraffic(w http.ResponseWriter, r *http.Request) {
	from, to, err := parseTimeRange(r, 6*time.Hour)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	bucketMin := 5
	if bStr := r.URL.Query().Get("bucketMinutes"); bStr != "" {
		if v, err := strconv.Atoi(bStr); err == nil && v >= 1 && v <= 1440 {
			bucketMin = v
		}
	}
	series, err := h.telemetrySvc.GetTrafficSeries(r.Context(), from, to, bucketMin)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	sendSuccess(w, http.StatusOK, map[string]interface{}{
		"from":          from,
		"to":            to,
		"bucketMinutes": bucketMin,
		"series":        series,
	})
}

func (h *Handler) NetworkEvents(w http.ResponseWriter, r *http.Request) {
	filter, err := parseEventFilter(r)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	page, err := h.telemetrySvc.ListNetworkEvents(r.Context(), filter)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	sendSuccess(w, http.StatusOK, page)
}

func (h *Handler) NetworkStatistics(w http.ResponseWriter, r *http.Request) {
	from, to, err := parseTimeRange(r, 24*time.Hour)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	stats, err := h.telemetrySvc.GetNetworkStatistics(r.Context(), from, to)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	sendSuccess(w, http.StatusOK, stats)
}

func (h *Handler) WebRequests(w http.ResponseWriter, r *http.Request) {
	filter, err := parseEventFilter(r)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	page, err := h.telemetrySvc.ListWebRequests(r.Context(), filter)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	sendSuccess(w, http.StatusOK, page)
}

func (h *Handler) WebStatistics(w http.ResponseWriter, r *http.Request) {
	from, to, err := parseTimeRange(r, 24*time.Hour)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	stats, err := h.telemetrySvc.GetWebStatistics(r.Context(), from, to)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	sendSuccess(w, http.StatusOK, stats)
}

func (h *Handler) ApplicationProcesses(w http.ResponseWriter, r *http.Request) {
	procs, err := h.telemetrySvc.GetApplicationProcesses(r.Context())
	if err != nil {
		handleServiceError(w, err)
		return
	}
	limit, offset := parseLimitOffset(r)
	page := paginateProcesses(procs, limit, offset)
	sendSuccess(w, http.StatusOK, page)
}

func (h *Handler) ApplicationMetrics(w http.ResponseWriter, r *http.Request) {
	filter, err := parseEventFilter(r)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	if metricName := strings.TrimSpace(r.URL.Query().Get("metricName")); metricName != "" {
		filter.EventType = metricName
	}
	page, err := h.telemetrySvc.ListApplicationMetrics(r.Context(), filter)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	sendSuccess(w, http.StatusOK, page)
}

func (h *Handler) Events(w http.ResponseWriter, r *http.Request) {
	filter, err := parseEventFilter(r)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	page, err := h.telemetrySvc.ListEvents(r.Context(), filter)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	sendSuccess(w, http.StatusOK, page)
}

func (h *Handler) Alerts(w http.ResponseWriter, r *http.Request) {
	filter, err := parseEventFilter(r)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	page, err := h.telemetrySvc.ListAlerts(r.Context(), filter)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	sendSuccess(w, http.StatusOK, page)
}

type updateAlertRequest struct {
	Status string `json:"status"`
}

func (h *Handler) UpdateAlert(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
	var req updateAlertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "Invalid JSON request body")
		return
	}
	user := middleware.GetAdminUser(r.Context())
	actorID := "system"
	if user != nil {
		actorID = user.ID
	}
	updated, err := h.telemetrySvc.UpdateAlertStatus(r.Context(), id, req.Status, actorID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	sendSuccess(w, http.StatusOK, updated)
}

func (h *Handler) Rules(w http.ResponseWriter, r *http.Request) {
	filter, err := parseEventFilter(r)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	page, err := h.telemetrySvc.ListRules(r.Context(), filter)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	sendSuccess(w, http.StatusOK, page)
}

func (h *Handler) CreateRule(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 32*1024)
	var rule models.DetectionRule
	if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
		middleware.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "Invalid JSON request body")
		return
	}
	user := middleware.GetAdminUser(r.Context())
	actorID := "system"
	if user != nil {
		actorID = user.ID
	}
	created, err := h.telemetrySvc.CreateRule(r.Context(), rule, actorID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	sendSuccess(w, http.StatusCreated, created)
}

func (h *Handler) UpdateRule(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	r.Body = http.MaxBytesReader(w, r.Body, 32*1024)
	var patch repository.RulePatch
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		middleware.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "Invalid JSON request body")
		return
	}
	user := middleware.GetAdminUser(r.Context())
	actorID := "system"
	if user != nil {
		actorID = user.ID
	}
	updated, err := h.telemetrySvc.UpdateRule(r.Context(), id, patch, actorID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	sendSuccess(w, http.StatusOK, updated)
}

func (h *Handler) AuditLogs(w http.ResponseWriter, r *http.Request) {
	filter, err := parseEventFilter(r)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	page, err := h.telemetrySvc.ListAuditLogs(r.Context(), filter)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	sendSuccess(w, http.StatusOK, page)
}

func (h *Handler) GetSettings(w http.ResponseWriter, _ *http.Request) {
	settings := h.telemetrySvc.GetSettings()
	sendSuccess(w, http.StatusOK, settings)
}

func (h *Handler) UpdateRetentionSettings(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
	var ret config.RetentionConfig
	if err := json.NewDecoder(r.Body).Decode(&ret); err != nil {
		middleware.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "Invalid JSON request body")
		return
	}
	user := middleware.GetAdminUser(r.Context())
	actorID := "system"
	if user != nil {
		actorID = user.ID
	}
	updated, err := h.telemetrySvc.UpdateRetentionSettings(r.Context(), ret, actorID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	sendSuccess(w, http.StatusOK, updated)
}

// Stream serves real-time telemetry updates and security alerts via Server-Sent Events (SSE).
func (h *Handler) Stream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		middleware.WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Streaming unsupported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ch, unsubscribe := h.broker.Subscribe()
	defer unsubscribe()

	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg, open := <-ch:
			if !open {
				return
			}
			payloadBytes, err := json.Marshal(msg)
			if err != nil {
				continue
			}
			_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", msg.Type, string(payloadBytes))
			flusher.Flush()
		case <-heartbeat.C:
			hb, _ := json.Marshal(models.StreamMessage{
				Type:      "heartbeat",
				Timestamp: time.Now().UTC(),
			})
			_, _ = fmt.Fprintf(w, "event: heartbeat\ndata: %s\n\n", string(hb))
			flusher.Flush()
		}
	}
}

func parseLimitOffset(r *http.Request) (int, int) {
	q := r.URL.Query()
	limit := 20
	offset := 0
	if l := q.Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 {
			limit = v
		}
	}
	if limit > 100 {
		limit = 100
	}
	if o := q.Get("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil && v >= 0 {
			offset = v
		}
	}
	return limit, offset
}

func parseEventFilter(r *http.Request) (models.EventFilter, error) {
	q := r.URL.Query()
	limit, offset := parseLimitOffset(r)

	filter := models.EventFilter{
		Source:    strings.ToLower(strings.TrimSpace(q.Get("source"))),
		EventType: strings.TrimSpace(q.Get("eventType")),
		Severity:  strings.ToLower(strings.TrimSpace(q.Get("severity"))),
		SourceIP:  strings.TrimSpace(q.Get("sourceIp")),
		Status:    strings.ToLower(strings.TrimSpace(q.Get("status"))),
		RuleID:    strings.ToUpper(strings.TrimSpace(q.Get("ruleId"))),
		ActorID:   strings.TrimSpace(q.Get("actorId")),
		Cursor:    strings.TrimSpace(q.Get("cursor")),
		Limit:     limit,
		Offset:    offset,
	}

	if fromStr := strings.TrimSpace(q.Get("from")); fromStr != "" {
		t, err := time.Parse(time.RFC3339, fromStr)
		if err != nil {
			return filter, fmt.Errorf("%w: invalid 'from' timestamp (expected RFC3339)", service.ErrValidation)
		}
		utc := t.UTC()
		filter.From = &utc
	}

	if toStr := strings.TrimSpace(q.Get("to")); toStr != "" {
		t, err := time.Parse(time.RFC3339, toStr)
		if err != nil {
			return filter, fmt.Errorf("%w: invalid 'to' timestamp (expected RFC3339)", service.ErrValidation)
		}
		utc := t.UTC()
		filter.To = &utc
	}

	return filter, nil
}

func parseTimeRange(r *http.Request, defaultLookback time.Duration) (time.Time, time.Time, error) {
	now := time.Now().UTC()
	from := now.Add(-defaultLookback)
	to := now

	q := r.URL.Query()
	if rStr := strings.TrimSpace(q.Get("range")); rStr != "" {
		switch rStr {
		case "15m":
			from = now.Add(-15 * time.Minute)
		case "1h":
			from = now.Add(-1 * time.Hour)
		case "6h":
			from = now.Add(-6 * time.Hour)
		case "24h":
			from = now.Add(-24 * time.Hour)
		case "7d":
			from = now.Add(-7 * 24 * time.Hour)
		case "30d":
			from = now.Add(-30 * 24 * time.Hour)
		}
	}

	if fromStr := strings.TrimSpace(q.Get("from")); fromStr != "" {
		parsed, err := time.Parse(time.RFC3339, fromStr)
		if err != nil {
			return from, to, fmt.Errorf("%w: invalid 'from' timestamp", service.ErrValidation)
		}
		from = parsed.UTC()
	}
	if toStr := strings.TrimSpace(q.Get("to")); toStr != "" {
		parsed, err := time.Parse(time.RFC3339, toStr)
		if err != nil {
			return from, to, fmt.Errorf("%w: invalid 'to' timestamp", service.ErrValidation)
		}
		to = parsed.UTC()
	}
	return from, to, nil
}

func paginateProcesses(items []models.PM2ProcessSummary, limit, offset int) models.PaginatedResult[models.PM2ProcessSummary] {
	total := len(items)
	if offset >= total {
		return models.NewPaginatedResult([]models.PM2ProcessSummary{}, limit, offset, total, "")
	}
	end := offset + limit
	if end > total {
		end = total
	}
	slice := items[offset:end]
	nextCursor := ""
	if end < total && len(slice) > 0 {
		nextCursor = strconv.Itoa(slice[len(slice)-1].PM2ID)
	}
	return models.NewPaginatedResult(slice, limit, offset, total, nextCursor)
}

