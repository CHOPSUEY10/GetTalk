package service

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/gettalk/security/backend/internal/collector"
	"github.com/gettalk/security/backend/internal/collector/pm2"
	"github.com/gettalk/security/backend/internal/config"
	"github.com/gettalk/security/backend/internal/models"
	"github.com/gettalk/security/backend/internal/repository"
	"github.com/gettalk/security/backend/internal/scheduler"
)

var (
	ErrValidation       = errors.New("validation error")
	ErrResourceNotFound = errors.New("resource not found")
	ErrResourceConflict = errors.New("resource already exists")
)

// TelemetryService coordinates queries and mutations across telemetry, alerts, rules, audit logs, and settings.
type TelemetryService struct {
	cfg          *config.Config
	repo         repository.Repository
	colMgr       *collector.Manager
	pm2Collector *pm2.Collector
	sched        *scheduler.Scheduler
	redis        RedisClient
	notifSvc     *NotificationService
}

// NewTelemetryService creates a new TelemetryService.
func NewTelemetryService(
	cfg *config.Config,
	repo repository.Repository,
	colMgr *collector.Manager,
	pm2Collector *pm2.Collector,
	sched *scheduler.Scheduler,
) *TelemetryService {
	if cfg == nil {
		cfg = config.DefaultConfig()
	}
	redisClient := NewRedisClient(cfg.Redis)
	notifSvc := NewNotificationService(cfg.Notification, cfg.Redis, redisClient, nil, nil)
	return &TelemetryService{
		cfg:          cfg,
		repo:         repo,
		colMgr:       colMgr,
		pm2Collector: pm2Collector,
		sched:        sched,
		redis:        redisClient,
		notifSvc:     notifSvc,
	}
}

// SetRedisClient replaces the RedisClient used for kill switch state and alert notification cooldowns.
func (s *TelemetryService) SetRedisClient(r RedisClient) {
	if r == nil {
		return
	}
	s.redis = r
	if s.notifSvc != nil {
		s.notifSvc.redis = r
	}
}

// SetEmailSender replaces the EmailSender used by the NotificationService.
func (s *TelemetryService) SetEmailSender(sender EmailSender) {
	if sender == nil {
		return
	}
	if s.notifSvc != nil {
		s.notifSvc.sender = sender
	}
}

// SetNotificationService replaces the NotificationService instance.
func (s *TelemetryService) SetNotificationService(n *NotificationService) {
	s.notifSvc = n
}

// RedisClient returns the active RedisClient.
func (s *TelemetryService) RedisClient() RedisClient {
	return s.redis
}

// NotificationService returns the active NotificationService.
func (s *TelemetryService) NotificationService() *NotificationService {
	return s.notifSvc
}

func (s *TelemetryService) killSwitchKey() string {
	if s.cfg != nil && strings.TrimSpace(s.cfg.Redis.KillSwitchKey) != "" {
		return strings.TrimSpace(s.cfg.Redis.KillSwitchKey)
	}
	return "siem:backend:enabled"
}

// IsBackendEnabled checks Upstash Redis to determine if the SIEM backend kill switch is enabled.
// Defaults to true unless explicitly set to "false" or "0" in Redis.
func (s *TelemetryService) IsBackendEnabled(ctx context.Context) bool {
	if s.redis == nil {
		return true
	}
	val, err := s.redis.Get(ctx, s.killSwitchKey())
	if err != nil {
		return true
	}
	trimmed := strings.ToLower(strings.TrimSpace(val))
	if trimmed == "false" || trimmed == "0" {
		return false
	}
	return true
}

// GetKillSwitchStatus returns the current status of the SIEM backend kill switch.
func (s *TelemetryService) GetKillSwitchStatus(ctx context.Context) models.KillSwitchStatus {
	return models.KillSwitchStatus{
		Enabled:   s.IsBackendEnabled(ctx),
		Key:       s.killSwitchKey(),
		UpdatedAt: time.Now().UTC(),
	}
}

// SetKillSwitch updates the SIEM backend kill switch state in Upstash Redis, records an audit log,
// and triggers an asynchronous email warning to secadmin when the backend is disabled.
func (s *TelemetryService) SetKillSwitch(ctx context.Context, enabled bool, reason, actorID string) (*models.KillSwitchStatus, error) {
	if ContainsHeaderInjection(reason, actorID) {
		return nil, fmt.Errorf("%w: invalid control characters in reason", ErrValidation)
	}
	if len(reason) > 512 {
		return nil, fmt.Errorf("%w: reason exceeds maximum length (512 chars)", ErrValidation)
	}
	if s.redis == nil {
		return nil, ErrRedisUnavailable
	}

	valStr := "true"
	action := "system.kill_switch_enabled"
	if !enabled {
		valStr = "false"
		action = "system.kill_switch_disabled"
	}

	key := s.killSwitchKey()
	if err := s.redis.Set(ctx, key, valStr, 0); err != nil {
		return nil, ErrRedisUnavailable
	}

	cleanReason := strings.TrimSpace(reason)
	if s.repo != nil {
		_ = s.repo.CreateAuditLog(ctx, models.AuditLog{
			ActorID:      actorID,
			Action:       action,
			ResourceType: "kill_switch",
			ResourceID:   key,
			Metadata: map[string]interface{}{
				"enabled": enabled,
				"reason":  cleanReason,
			},
		})
	}

	if !enabled && s.notifSvc != nil {
		s.notifSvc.NotifyKillSwitchDeactivatedAsync(actorID, cleanReason)
	}

	return &models.KillSwitchStatus{
		Enabled:   enabled,
		Key:       key,
		Reason:    cleanReason,
		UpdatedBy: actorID,
		UpdatedAt: time.Now().UTC(),
	}, nil
}

// IngestSecurityEvent validates, stores, and processes an incoming SIEM security event.
// If the event severity is "critical" (case-insensitive), it asynchronously sends an email notification
// to secadmin with Upstash Redis SetNX cooldown protection.
func (s *TelemetryService) IngestSecurityEvent(ctx context.Context, input models.IngestEventInput) (*models.TelemetryEvent, error) {
	if ContainsHeaderInjection(
		input.EventID,
		input.Source,
		input.EventType,
		input.SourceIP,
		input.DestinationIP,
		input.Severity,
		input.Description,
	) {
		return nil, fmt.Errorf("%w: invalid control characters detected", ErrValidation)
	}
	for k, v := range input.EventData {
		if ContainsHeaderInjection(k) {
			return nil, fmt.Errorf("%w: invalid control characters in event_data key", ErrValidation)
		}
		if strVal, ok := v.(string); ok && ContainsHeaderInjection(strVal) {
			return nil, fmt.Errorf("%w: invalid control characters in event_data value", ErrValidation)
		}
	}

	eventID := strings.TrimSpace(input.EventID)
	rawSeverity := strings.TrimSpace(input.Severity)
	description := strings.TrimSpace(input.Description)
	sourceIP := strings.TrimSpace(input.SourceIP)
	destIP := strings.TrimSpace(input.DestinationIP)
	source := strings.ToLower(strings.TrimSpace(input.Source))
	eventType := strings.TrimSpace(input.EventType)

	if eventID == "" {
		return nil, fmt.Errorf("%w: event_id is required", ErrValidation)
	}
	if len(eventID) > 128 {
		return nil, fmt.Errorf("%w: event_id exceeds maximum length (128 chars)", ErrValidation)
	}
	if rawSeverity == "" {
		return nil, fmt.Errorf("%w: severity is required", ErrValidation)
	}
	if description == "" {
		return nil, fmt.Errorf("%w: description is required", ErrValidation)
	}
	if len(description) > 4096 {
		return nil, fmt.Errorf("%w: description exceeds maximum length (4096 chars)", ErrValidation)
	}

	normalizedSeverity := strings.ToLower(rawSeverity)
	if !models.ValidSeverities[normalizedSeverity] {
		return nil, fmt.Errorf("%w: unsupported severity %q", ErrValidation, rawSeverity)
	}

	if sourceIP != "" && net.ParseIP(sourceIP) == nil {
		return nil, fmt.Errorf("%w: invalid source_ip address", ErrValidation)
	}
	if destIP != "" && net.ParseIP(destIP) == nil {
		return nil, fmt.Errorf("%w: invalid destination_ip address", ErrValidation)
	}

	if source == "" {
		source = models.SourceSIEM
	} else {
		switch source {
		case models.SourceFirewalld, models.SourceNginx, models.SourcePM2, models.SourceSystem, models.SourceSIEM:
		default:
			return nil, fmt.Errorf("%w: unsupported source %q", ErrValidation, source)
		}
	}

	if eventType == "" {
		eventType = "security_event"
	}

	evData := make(map[string]interface{})
	for k, v := range input.EventData {
		evData[k] = v
	}
	evData["description"] = description
	evData["event_id"] = eventID

	now := time.Now().UTC()
	event := models.TelemetryEvent{
		ID:            eventID,
		Source:        source,
		EventType:     eventType,
		SourceIP:      sourceIP,
		DestinationIP: destIP,
		EventData:     evData,
		Severity:      normalizedSeverity,
		OccurredAt:    now,
		CreatedAt:     now,
	}

	if s.repo != nil {
		if err := s.repo.SaveEventsBatch(ctx, []models.TelemetryEvent{event}); err != nil {
			return nil, err
		}
	}

	if IsCriticalSeverity(rawSeverity) && s.notifSvc != nil {
		s.notifSvc.NotifyCriticalEventAsync(event, description)
	}

	return &event, nil
}

func (s *TelemetryService) GetDashboardOverview(ctx context.Context, since time.Time) (*models.DashboardOverview, error) {
	var health []models.CollectorHealth
	if s.colMgr != nil {
		health = s.colMgr.Health()
	}
	return s.repo.GetDashboardOverview(ctx, since, health)
}

func (s *TelemetryService) GetTrafficSeries(ctx context.Context, from, to time.Time, bucketMinutes int) ([]models.TrafficBucket, error) {
	return s.repo.GetTrafficSeries(ctx, from, to, bucketMinutes)
}

func (s *TelemetryService) ListNetworkEvents(ctx context.Context, filter models.EventFilter) (models.PaginatedResult[models.TelemetryEvent], error) {
	filter.Source = models.SourceFirewalld
	if err := validateEventFilter(&filter); err != nil {
		return models.PaginatedResult[models.TelemetryEvent]{}, err
	}
	return s.repo.ListEvents(ctx, filter)
}

func (s *TelemetryService) GetNetworkStatistics(ctx context.Context, from, to time.Time) (*models.NetworkStatistics, error) {
	return s.repo.GetNetworkStatistics(ctx, from, to)
}

func (s *TelemetryService) ListWebRequests(ctx context.Context, filter models.EventFilter) (models.PaginatedResult[models.TelemetryEvent], error) {
	filter.Source = models.SourceNginx
	if err := validateEventFilter(&filter); err != nil {
		return models.PaginatedResult[models.TelemetryEvent]{}, err
	}
	return s.repo.ListEvents(ctx, filter)
}

func (s *TelemetryService) GetWebStatistics(ctx context.Context, from, to time.Time) (*models.WebStatistics, error) {
	return s.repo.GetWebStatistics(ctx, from, to)
}

func (s *TelemetryService) GetApplicationProcesses(ctx context.Context) ([]models.PM2ProcessSummary, error) {
	if s.pm2Collector != nil {
		if latest := s.pm2Collector.LatestProcesses(); len(latest) > 0 {
			return latest, nil
		}
	}
	return s.repo.GetLatestPM2Processes(ctx)
}

func (s *TelemetryService) ListApplicationMetrics(ctx context.Context, filter models.EventFilter) (models.PaginatedResult[models.SystemMetric], error) {
	if err := validateEventFilter(&filter); err != nil {
		return models.PaginatedResult[models.SystemMetric]{}, err
	}
	return s.repo.ListApplicationMetrics(ctx, filter)
}

func (s *TelemetryService) ListEvents(ctx context.Context, filter models.EventFilter) (models.PaginatedResult[models.TelemetryEvent], error) {
	if err := validateEventFilter(&filter); err != nil {
		return models.PaginatedResult[models.TelemetryEvent]{}, err
	}
	return s.repo.ListEvents(ctx, filter)
}

func (s *TelemetryService) ListAlerts(ctx context.Context, filter models.EventFilter) (models.PaginatedResult[models.SecurityAlert], error) {
	if err := validateEventFilter(&filter); err != nil {
		return models.PaginatedResult[models.SecurityAlert]{}, err
	}
	return s.repo.ListAlerts(ctx, filter)
}

func (s *TelemetryService) UpdateAlertStatus(ctx context.Context, id, status, actorID string) (*models.SecurityAlert, error) {
	id = strings.TrimSpace(id)
	status = strings.ToLower(strings.TrimSpace(status))
	if id == "" || !models.ValidAlertStatuses[status] {
		return nil, fmt.Errorf("%w: invalid alert status %q", ErrValidation, status)
	}

	updated, err := s.repo.UpdateAlertStatus(ctx, id, status, actorID)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, ErrResourceNotFound
	}

	_ = s.repo.CreateAuditLog(ctx, models.AuditLog{
		ActorID:      actorID,
		Action:       "alert.status_updated",
		ResourceType: "security_alert",
		ResourceID:   id,
		Metadata: map[string]interface{}{
			"new_status": status,
			"rule_id":    updated.RuleID,
		},
	})
	return updated, nil
}

func (s *TelemetryService) ListRules(ctx context.Context, filter models.EventFilter) (models.PaginatedResult[models.DetectionRule], error) {
	if err := validateEventFilter(&filter); err != nil {
		return models.PaginatedResult[models.DetectionRule]{}, err
	}
	return s.repo.ListRules(ctx, filter)
}

func (s *TelemetryService) CreateRule(ctx context.Context, rule models.DetectionRule, actorID string) (*models.DetectionRule, error) {
	rule.ID = strings.ToUpper(strings.TrimSpace(rule.ID))
	rule.RuleName = strings.TrimSpace(rule.RuleName)
	rule.RuleType = strings.ToLower(strings.TrimSpace(rule.RuleType))
	rule.Severity = strings.ToLower(strings.TrimSpace(rule.Severity))

	if rule.ID == "" || len(rule.ID) > 32 {
		return nil, fmt.Errorf("%w: rule id is required (max 32 chars)", ErrValidation)
	}
	if rule.RuleName == "" || len(rule.RuleName) > 128 {
		return nil, fmt.Errorf("%w: ruleName is required (max 128 chars)", ErrValidation)
	}
	if !models.ValidRuleTypes[rule.RuleType] {
		return nil, fmt.Errorf("%w: unsupported ruleType %q", ErrValidation, rule.RuleType)
	}
	if !models.ValidSeverities[rule.Severity] || rule.Severity == models.SeverityInfo {
		return nil, fmt.Errorf("%w: invalid rule severity %q", ErrValidation, rule.Severity)
	}
	if rule.Threshold < 0 {
		return nil, fmt.Errorf("%w: threshold must be >= 0", ErrValidation)
	}
	if rule.TimeWindow <= 0 || rule.TimeWindow > 86400 {
		return nil, fmt.Errorf("%w: timeWindow must be between 1 and 86400 seconds", ErrValidation)
	}

	existing, err := s.repo.GetRuleByID(ctx, rule.ID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, ErrResourceConflict
	}

	created, err := s.repo.CreateRule(ctx, rule)
	if err != nil {
		return nil, err
	}

	_ = s.repo.CreateAuditLog(ctx, models.AuditLog{
		ActorID:      actorID,
		Action:       "rule.created",
		ResourceType: "detection_rule",
		ResourceID:   created.ID,
		Metadata: map[string]interface{}{
			"rule_name":   created.RuleName,
			"rule_type":   created.RuleType,
			"threshold":   created.Threshold,
			"time_window": created.TimeWindow,
			"severity":    created.Severity,
			"enabled":     created.Enabled,
		},
	})

	return created, nil
}

func (s *TelemetryService) UpdateRule(ctx context.Context, id string, patch repository.RulePatch, actorID string) (*models.DetectionRule, error) {
	id = strings.ToUpper(strings.TrimSpace(id))
	if id == "" {
		return nil, fmt.Errorf("%w: rule id is required", ErrValidation)
	}
	if patch.Threshold != nil && *patch.Threshold < 0 {
		return nil, fmt.Errorf("%w: threshold must be >= 0", ErrValidation)
	}
	if patch.TimeWindow != nil && (*patch.TimeWindow <= 0 || *patch.TimeWindow > 86400) {
		return nil, fmt.Errorf("%w: timeWindow must be between 1 and 86400 seconds", ErrValidation)
	}
	if patch.Severity != nil {
		sev := strings.ToLower(strings.TrimSpace(*patch.Severity))
		if !models.ValidSeverities[sev] || sev == models.SeverityInfo {
			return nil, fmt.Errorf("%w: invalid severity %q", ErrValidation, sev)
		}
		patch.Severity = &sev
	}

	updated, err := s.repo.UpdateRule(ctx, id, patch)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, ErrResourceNotFound
	}

	_ = s.repo.CreateAuditLog(ctx, models.AuditLog{
		ActorID:      actorID,
		Action:       "rule.updated",
		ResourceType: "detection_rule",
		ResourceID:   id,
		Metadata: map[string]interface{}{
			"threshold":   updated.Threshold,
			"time_window": updated.TimeWindow,
			"severity":    updated.Severity,
			"enabled":     updated.Enabled,
		},
	})

	return updated, nil
}

func (s *TelemetryService) ListAuditLogs(ctx context.Context, filter models.EventFilter) (models.PaginatedResult[models.AuditLog], error) {
	if err := validateEventFilter(&filter); err != nil {
		return models.PaginatedResult[models.AuditLog]{}, err
	}
	return s.repo.ListAuditLogs(ctx, filter)
}

// SystemSettingsResponse represents safe, non-sensitive telemetry and retention settings for the UI.
type SystemSettingsResponse struct {
	Collectors                  []models.CollectorHealth `json:"collectors"`
	PM2CollectionIntervalSec    int                      `json:"pm2CollectionIntervalSec"`
	NginxPollIntervalMs         int                      `json:"nginxPollIntervalMs"`
	IDSEvaluationIntervalSec    int                      `json:"idsEvaluationIntervalSec"`
	PassiveModeOnly             bool                     `json:"passiveModeOnly"`
	Retention                   config.RetentionConfig   `json:"retention"`
	DroppedEventsCount          uint64                   `json:"droppedEventsCount"`
	DroppedMetricsCount         uint64                   `json:"droppedMetricsCount"`
}

func (s *TelemetryService) GetSettings() SystemSettingsResponse {
	var health []models.CollectorHealth
	var droppedEv, droppedMet uint64
	if s.colMgr != nil {
		health = s.colMgr.Health()
		droppedEv, droppedMet = s.colMgr.DroppedCounts()
	}
	ret := s.cfg.Retention
	if s.sched != nil {
		ret = s.sched.GetRetention()
	}
	return SystemSettingsResponse{
		Collectors:               health,
		PM2CollectionIntervalSec: s.cfg.Collectors.PM2.IntervalSeconds,
		NginxPollIntervalMs:      s.cfg.Collectors.Nginx.PollIntervalMs,
		IDSEvaluationIntervalSec: s.cfg.Detection.EvaluationIntervalSeconds,
		PassiveModeOnly:          true,
		Retention:                ret,
		DroppedEventsCount:       droppedEv,
		DroppedMetricsCount:      droppedMet,
	}
}

func (s *TelemetryService) UpdateRetentionSettings(ctx context.Context, ret config.RetentionConfig, actorID string) (SystemSettingsResponse, error) {
	if ret.TelemetryEventsDays < 1 || ret.TelemetryEventsDays > 3650 ||
		ret.SystemMetricsDays < 1 || ret.SystemMetricsDays > 3650 ||
		ret.SecurityAlertsDays < 1 || ret.SecurityAlertsDays > 3650 {
		return SystemSettingsResponse{}, fmt.Errorf("%w: retention days must be between 1 and 3650", ErrValidation)
	}
	if ret.CleanupIntervalHours <= 0 {
		ret.CleanupIntervalHours = 6
	}
	s.cfg.Retention = ret
	if s.sched != nil {
		s.sched.UpdateRetention(ret)
	}
	_ = s.repo.CreateAuditLog(ctx, models.AuditLog{
		ActorID:      actorID,
		Action:       "settings.retention_updated",
		ResourceType: "settings",
		Metadata: map[string]interface{}{
			"telemetry_events_days": ret.TelemetryEventsDays,
			"system_metrics_days":   ret.SystemMetricsDays,
			"security_alerts_days":  ret.SecurityAlertsDays,
		},
	})
	return s.GetSettings(), nil
}

func validateEventFilter(f *models.EventFilter) error {
	if f.Source != "" {
		switch f.Source {
		case models.SourceFirewalld, models.SourceNginx, models.SourcePM2, models.SourceSystem, models.SourceSIEM:
		default:
			return fmt.Errorf("%w: invalid source filter %q", ErrValidation, f.Source)
		}
	}
	if f.Severity != "" && !models.ValidSeverities[f.Severity] {
		return fmt.Errorf("%w: invalid severity filter %q", ErrValidation, f.Severity)
	}
	if f.Status != "" && !models.ValidAlertStatuses[f.Status] {
		return fmt.Errorf("%w: invalid status filter %q", ErrValidation, f.Status)
	}
	if f.SourceIP != "" {
		if net.ParseIP(f.SourceIP) == nil {
			return fmt.Errorf("%w: invalid IP address filter %q", ErrValidation, f.SourceIP)
		}
	}
	if f.Limit <= 0 {
		f.Limit = 20
	}
	if f.Limit > 100 {
		f.Limit = 100
	}
	if f.Offset < 0 {
		f.Offset = 0
	}
	return nil
}

