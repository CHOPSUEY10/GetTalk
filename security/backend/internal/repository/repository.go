package repository

import (
	"context"
	"time"

	"github.com/gettalk/security/backend/internal/models"
)

// Repository defines the data persistence and query contract for the GetTalk Security module.
type Repository interface {
	// Telemetry Events & Metrics Ingestion
	SaveEventsBatch(ctx context.Context, events []models.TelemetryEvent) error
	SaveMetricsBatch(ctx context.Context, metrics []models.SystemMetric) error

	// Ingestion Checkpoints
	GetCheckpoint(ctx context.Context, sourceKey string) (*models.IngestionCheckpoint, error)
	SaveCheckpoint(ctx context.Context, cp models.IngestionCheckpoint) error

	// Telemetry Queries
	ListEvents(ctx context.Context, filter models.EventFilter) (models.PaginatedResult[models.TelemetryEvent], error)
	GetEventsInWindow(ctx context.Context, since time.Time) ([]models.TelemetryEvent, error)
	GetMetricsInWindow(ctx context.Context, source, metricName string, since time.Time) ([]models.SystemMetric, error)
	ListApplicationMetrics(ctx context.Context, filter models.EventFilter) (models.PaginatedResult[models.SystemMetric], error)
	GetLatestPM2Processes(ctx context.Context) ([]models.PM2ProcessSummary, error)

	// Aggregations for Dashboard, Network, and Web Layers
	GetDashboardOverview(ctx context.Context, since time.Time, collectors []models.CollectorHealth) (*models.DashboardOverview, error)
	GetTrafficSeries(ctx context.Context, from, to time.Time, bucketMinutes int) ([]models.TrafficBucket, error)
	GetNetworkStatistics(ctx context.Context, from, to time.Time) (*models.NetworkStatistics, error)
	GetWebStatistics(ctx context.Context, from, to time.Time) (*models.WebStatistics, error)

	// Detection Rules
	ListRules(ctx context.Context, filter models.EventFilter) (models.PaginatedResult[models.DetectionRule], error)
	GetAllRules(ctx context.Context) ([]models.DetectionRule, error)
	GetRuleByID(ctx context.Context, id string) (*models.DetectionRule, error)
	CreateRule(ctx context.Context, rule models.DetectionRule) (*models.DetectionRule, error)
	UpdateRule(ctx context.Context, id string, patch RulePatch) (*models.DetectionRule, error)

	// Security Alerts
	ListAlerts(ctx context.Context, filter models.EventFilter) (models.PaginatedResult[models.SecurityAlert], error)
	GetAlertByID(ctx context.Context, id string) (*models.SecurityAlert, error)
	UpsertOrDeduplicateAlert(ctx context.Context, alert models.SecurityAlert, dedupWindow time.Duration) (*models.SecurityAlert, bool, error)
	UpdateAlertStatus(ctx context.Context, id, status, actorID string) (*models.SecurityAlert, error)

	// Audit Logs
	CreateAuditLog(ctx context.Context, entry models.AuditLog) error
	ListAuditLogs(ctx context.Context, filter models.EventFilter) (models.PaginatedResult[models.AuditLog], error)

	// Authentication & RBAC Sessions
	GetAdminByUsername(ctx context.Context, username string) (*models.AdminUser, error)
	GetAdminByID(ctx context.Context, id string) (*models.AdminUser, error)
	CreateAdmin(ctx context.Context, admin models.AdminUser) (*models.AdminUser, error)
	UpdateAdminLoginState(ctx context.Context, id string, failedAttempts int, lockedUntil *time.Time, lastLogin *time.Time) error
	UpdateAdminMFA(ctx context.Context, id string, enabled bool, encryptedSecret string) error
	CreateSession(ctx context.Context, session models.AdminSession) error
	GetSession(ctx context.Context, sessionID string) (*models.AdminSession, error)
	DeleteSession(ctx context.Context, sessionID string) error

	// Retention Policy Enforcement
	PurgeExpiredData(ctx context.Context, eventsCutoff, metricsCutoff, alertsCutoff time.Time) (int64, error)

	Close()
}

// RulePatch defines mutable fields for updating a detection rule.
type RulePatch struct {
	RuleName      *string                `json:"ruleName,omitempty"`
	Threshold     *float64               `json:"threshold,omitempty"`
	TimeWindow    *int                   `json:"timeWindow,omitempty"`
	Severity      *string                `json:"severity,omitempty"`
	Enabled       *bool                  `json:"enabled,omitempty"`
	Configuration map[string]interface{} `json:"configuration,omitempty"`
}

