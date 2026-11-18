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
}

// NewTelemetryService creates a new TelemetryService.
func NewTelemetryService(
	cfg *config.Config,
	repo repository.Repository,
	colMgr *collector.Manager,
	pm2Collector *pm2.Collector,
	sched *scheduler.Scheduler,
) *TelemetryService {
	return &TelemetryService{
		cfg:          cfg,
		repo:         repo,
		colMgr:       colMgr,
		pm2Collector: pm2Collector,
		sched:        sched,
	}
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
		case models.SourceFirewalld, models.SourceNginx, models.SourcePM2, models.SourceSystem:
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

