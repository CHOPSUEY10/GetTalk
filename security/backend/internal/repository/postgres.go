package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/gettalk/security/backend/internal/models"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresRepository implements Repository backed by a dedicated PostgreSQL connection pool.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

// NewPostgresRepository connects to the dedicated telemetry PostgreSQL database.
func NewPostgresRepository(ctx context.Context, connString string) (*PostgresRepository, error) {
	cfg, err := pgxpool.ParseConfig(connString)
	if err != nil {
		return nil, fmt.Errorf("invalid postgres connection config: %w", err)
	}
	cfg.MaxConns = 15
	cfg.MinConns = 2
	cfg.MaxConnLifetime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to create postgres pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to ping telemetry database: %w", err)
	}
	return &PostgresRepository{pool: pool}, nil
}

func (p *PostgresRepository) Close() {
	if p.pool != nil {
		p.pool.Close()
	}
}

func (p *PostgresRepository) SaveEventsBatch(ctx context.Context, events []models.TelemetryEvent) error {
	if len(events) == 0 {
		return nil
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const q = `
		INSERT INTO telemetry_events (source, event_type, source_ip, destination_ip, event_data, severity, fingerprint, occurred_at)
		VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), $5, $6, NULLIF($7, ''), $8)
		ON CONFLICT (fingerprint) WHERE fingerprint IS NOT NULL DO NOTHING
	`

	for _, ev := range events {
		payload, err := json.Marshal(ev.EventData)
		if err != nil {
			payload = []byte("{}")
		}
		if _, err := tx.Exec(ctx, q,
			ev.Source,
			ev.EventType,
			ev.SourceIP,
			ev.DestinationIP,
			payload,
			ev.Severity,
			ev.Fingerprint,
			ev.OccurredAt,
		); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (p *PostgresRepository) SaveMetricsBatch(ctx context.Context, metrics []models.SystemMetric) error {
	if len(metrics) == 0 {
		return nil
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const q = `
		INSERT INTO system_metrics (source, metric_name, metric_value, labels, recorded_at)
		VALUES ($1, $2, $3, $4, $5)
	`

	for _, met := range metrics {
		labelsJSON, err := json.Marshal(met.Labels)
		if err != nil {
			labelsJSON = []byte("{}")
		}
		if _, err := tx.Exec(ctx, q,
			met.Source,
			met.MetricName,
			met.MetricValue,
			labelsJSON,
			met.RecordedAt,
		); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (p *PostgresRepository) GetCheckpoint(ctx context.Context, sourceKey string) (*models.IngestionCheckpoint, error) {
	const q = `
		SELECT source_key, inode, byte_offset, last_timestamp, metadata, updated_at
		FROM ingestion_checkpoints
		WHERE source_key = $1
	`
	var cp models.IngestionCheckpoint
	var metaRaw []byte
	var inode int64
	err := p.pool.QueryRow(ctx, q, sourceKey).Scan(
		&cp.SourceKey,
		&inode,
		&cp.ByteOffset,
		&cp.LastTimestamp,
		&metaRaw,
		&cp.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	cp.Inode = uint64(inode)
	_ = json.Unmarshal(metaRaw, &cp.Metadata)
	return &cp, nil
}

func (p *PostgresRepository) SaveCheckpoint(ctx context.Context, cp models.IngestionCheckpoint) error {
	metaRaw, err := json.Marshal(cp.Metadata)
	if err != nil {
		metaRaw = []byte("{}")
	}
	const q = `
		INSERT INTO ingestion_checkpoints (source_key, inode, byte_offset, last_timestamp, metadata, updated_at)
		VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (source_key) DO UPDATE SET
			inode = EXCLUDED.inode,
			byte_offset = EXCLUDED.byte_offset,
			last_timestamp = EXCLUDED.last_timestamp,
			metadata = EXCLUDED.metadata,
			updated_at = NOW()
	`
	_, err = p.pool.Exec(ctx, q, cp.SourceKey, int64(cp.Inode), cp.ByteOffset, cp.LastTimestamp, metaRaw)
	return err
}

func (p *PostgresRepository) ListEvents(ctx context.Context, filter models.EventFilter) (models.PaginatedResult[models.TelemetryEvent], error) {
	limit, offset := sanitizeLimitOffset(filter.Limit, filter.Offset)

	where := "WHERE 1=1"
	args := make([]interface{}, 0, 8)
	idx := 1

	if filter.Source != "" {
		where += fmt.Sprintf(" AND source = $%d", idx)
		args = append(args, filter.Source)
		idx++
	}
	if filter.EventType != "" {
		where += fmt.Sprintf(" AND event_type = $%d", idx)
		args = append(args, filter.EventType)
		idx++
	}
	if filter.Severity != "" {
		where += fmt.Sprintf(" AND severity = $%d", idx)
		args = append(args, filter.Severity)
		idx++
	}
	if filter.SourceIP != "" {
		where += fmt.Sprintf(" AND source_ip = $%d", idx)
		args = append(args, filter.SourceIP)
		idx++
	}
	if filter.From != nil {
		where += fmt.Sprintf(" AND occurred_at >= $%d", idx)
		args = append(args, *filter.From)
		idx++
	}
	if filter.To != nil {
		where += fmt.Sprintf(" AND occurred_at <= $%d", idx)
		args = append(args, *filter.To)
		idx++
	}

	var total int
	countQ := "SELECT COUNT(*) FROM telemetry_events " + where
	if err := p.pool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		return models.PaginatedResult[models.TelemetryEvent]{}, err
	}

	args = append(args, limit, offset)
	listQ := fmt.Sprintf(`
		SELECT id::text, source, event_type, COALESCE(source_ip, ''), COALESCE(destination_ip, ''),
		       event_data, severity, COALESCE(fingerprint, ''), occurred_at, created_at
		FROM telemetry_events
		%s
		ORDER BY occurred_at DESC, id DESC
		LIMIT $%d OFFSET $%d
	`, where, idx, idx+1)

	rows, err := p.pool.Query(ctx, listQ, args...)
	if err != nil {
		return models.PaginatedResult[models.TelemetryEvent]{}, err
	}
	defer rows.Close()

	items := make([]models.TelemetryEvent, 0, limit)
	for rows.Next() {
		var ev models.TelemetryEvent
		var dataRaw []byte
		if err := rows.Scan(
			&ev.ID, &ev.Source, &ev.EventType, &ev.SourceIP, &ev.DestinationIP,
			&dataRaw, &ev.Severity, &ev.Fingerprint, &ev.OccurredAt, &ev.CreatedAt,
		); err != nil {
			return models.PaginatedResult[models.TelemetryEvent]{}, err
		}
		_ = json.Unmarshal(dataRaw, &ev.EventData)
		items = append(items, ev)
	}

	nextCursor := ""
	if offset+len(items) < total && len(items) > 0 {
		nextCursor = items[len(items)-1].ID
	}
	return models.NewPaginatedResult(items, limit, offset, total, nextCursor), nil
}

func (p *PostgresRepository) GetEventsInWindow(ctx context.Context, since time.Time) ([]models.TelemetryEvent, error) {
	const q = `
		SELECT id::text, source, event_type, COALESCE(source_ip, ''), COALESCE(destination_ip, ''),
		       event_data, severity, COALESCE(fingerprint, ''), occurred_at, created_at
		FROM telemetry_events
		WHERE occurred_at >= $1
		ORDER BY occurred_at DESC
		LIMIT 10000
	`
	rows, err := p.pool.Query(ctx, q, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.TelemetryEvent, 0, 256)
	for rows.Next() {
		var ev models.TelemetryEvent
		var dataRaw []byte
		if err := rows.Scan(
			&ev.ID, &ev.Source, &ev.EventType, &ev.SourceIP, &ev.DestinationIP,
			&dataRaw, &ev.Severity, &ev.Fingerprint, &ev.OccurredAt, &ev.CreatedAt,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(dataRaw, &ev.EventData)
		out = append(out, ev)
	}
	return out, nil
}

func (p *PostgresRepository) GetMetricsInWindow(ctx context.Context, source, metricName string, since time.Time) ([]models.SystemMetric, error) {
	where := "WHERE recorded_at >= $1"
	args := []interface{}{since}
	idx := 2
	if source != "" {
		where += fmt.Sprintf(" AND source = $%d", idx)
		args = append(args, source)
		idx++
	}
	if metricName != "" {
		where += fmt.Sprintf(" AND metric_name = $%d", idx)
		args = append(args, metricName)
		idx++
	}

	q := fmt.Sprintf(`
		SELECT id::text, source, metric_name, metric_value, labels, recorded_at
		FROM system_metrics
		%s
		ORDER BY recorded_at DESC
		LIMIT 5000
	`, where)

	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.SystemMetric, 0, 128)
	for rows.Next() {
		var met models.SystemMetric
		var labelsRaw []byte
		if err := rows.Scan(&met.ID, &met.Source, &met.MetricName, &met.MetricValue, &labelsRaw, &met.RecordedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(labelsRaw, &met.Labels)
		out = append(out, met)
	}
	return out, nil
}

func (p *PostgresRepository) ListApplicationMetrics(ctx context.Context, filter models.EventFilter) (models.PaginatedResult[models.SystemMetric], error) {
	limit, offset := sanitizeLimitOffset(filter.Limit, filter.Offset)
	where := "WHERE source = 'pm2'"
	args := make([]interface{}, 0, 4)
	idx := 1

	if filter.EventType != "" {
		where += fmt.Sprintf(" AND metric_name = $%d", idx)
		args = append(args, filter.EventType)
		idx++
	}
	if filter.From != nil {
		where += fmt.Sprintf(" AND recorded_at >= $%d", idx)
		args = append(args, *filter.From)
		idx++
	}
	if filter.To != nil {
		where += fmt.Sprintf(" AND recorded_at <= $%d", idx)
		args = append(args, *filter.To)
		idx++
	}

	var total int
	if err := p.pool.QueryRow(ctx, "SELECT COUNT(*) FROM system_metrics "+where, args...).Scan(&total); err != nil {
		return models.PaginatedResult[models.SystemMetric]{}, err
	}

	args = append(args, limit, offset)
	q := fmt.Sprintf(`
		SELECT id::text, source, metric_name, metric_value, labels, recorded_at
		FROM system_metrics
		%s
		ORDER BY recorded_at DESC
		LIMIT $%d OFFSET $%d
	`, where, idx, idx+1)

	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return models.PaginatedResult[models.SystemMetric]{}, err
	}
	defer rows.Close()

	items := make([]models.SystemMetric, 0, limit)
	for rows.Next() {
		var met models.SystemMetric
		var labelsRaw []byte
		if err := rows.Scan(&met.ID, &met.Source, &met.MetricName, &met.MetricValue, &labelsRaw, &met.RecordedAt); err != nil {
			return models.PaginatedResult[models.SystemMetric]{}, err
		}
		_ = json.Unmarshal(labelsRaw, &met.Labels)
		items = append(items, met)
	}

	nextCursor := ""
	if offset+len(items) < total && len(items) > 0 {
		nextCursor = items[len(items)-1].ID
	}
	return models.NewPaginatedResult(items, limit, offset, total, nextCursor), nil
}

func (p *PostgresRepository) GetLatestPM2Processes(ctx context.Context) ([]models.PM2ProcessSummary, error) {
	metrics, err := p.GetMetricsInWindow(ctx, models.SourcePM2, "", time.Now().UTC().Add(-10*time.Minute))
	if err != nil {
		return nil, err
	}

	byProc := make(map[string]*models.PM2ProcessSummary)
	for i := len(metrics) - 1; i >= 0; i-- {
		met := metrics[i]
		name, _ := met.Labels["process_name"].(string)
		if name == "" {
			continue
		}
		pmID := intFromAny(met.Labels["pm_id"])
		key := fmt.Sprintf("%s:%d", name, pmID)
		entry, exists := byProc[key]
		if !exists {
			entry = &models.PM2ProcessSummary{
				Name:       name,
				PM2ID:      pmID,
				PID:        intFromAny(met.Labels["pid"]),
				Status:     strFromAny(met.Labels["status"], "online"),
				Instances:  intFromAny(met.Labels["instances"]),
				ExecMode:   strFromAny(met.Labels["exec_mode"], "fork_mode"),
				RecordedAt: met.RecordedAt,
			}
			byProc[key] = entry
		}
		if met.RecordedAt.After(entry.RecordedAt) {
			entry.RecordedAt = met.RecordedAt
			entry.PID = intFromAny(met.Labels["pid"])
			entry.Status = strFromAny(met.Labels["status"], entry.Status)
		}
		switch met.MetricName {
		case "cpu_percent":
			entry.CPUPercent = met.MetricValue
		case "memory_bytes":
			entry.MemoryBytes = int64(met.MetricValue)
		case "restart_count":
			entry.RestartCount = int(met.MetricValue)
		case "uptime_seconds":
			entry.UptimeSec = int64(met.MetricValue)
		}
	}

	out := make([]models.PM2ProcessSummary, 0, len(byProc))
	for _, v := range byProc {
		out = append(out, *v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].PM2ID < out[j].PM2ID })
	return out, nil
}

func (p *PostgresRepository) GetDashboardOverview(ctx context.Context, since time.Time, collectors []models.CollectorHealth) (*models.DashboardOverview, error) {
	var totalHTTP, fwBlocked, activeAlerts, criticalAlerts int64

	_ = p.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE source = 'nginx' AND event_type = 'http_request'),
			COUNT(*) FILTER (WHERE source = 'firewalld')
		FROM telemetry_events
		WHERE occurred_at >= $1
	`, since).Scan(&totalHTTP, &fwBlocked)

	_ = p.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE status IN ('open', 'acknowledged')),
			COUNT(*) FILTER (WHERE status IN ('open', 'acknowledged') AND severity = 'critical')
		FROM security_alerts
	`).Scan(&activeAlerts, &criticalAlerts)

	procs, _ := p.GetLatestPM2Processes(ctx)
	var avgCPU, totalMem float64
	if len(procs) > 0 {
		for _, proc := range procs {
			avgCPU += proc.CPUPercent
			totalMem += float64(proc.MemoryBytes)
		}
		avgCPU = math.Round((avgCPU/float64(len(procs)))*100) / 100
	}

	eventsPage, _ := p.ListEvents(ctx, models.EventFilter{Limit: 8, Offset: 0})
	alertsPage, _ := p.ListAlerts(ctx, models.EventFilter{Limit: 5, Offset: 0})

	health := "healthy"
	if criticalAlerts > 0 {
		health = "critical"
	} else if activeAlerts > 0 || avgCPU > 80 {
		health = "warning"
	}

	return &models.DashboardOverview{
		OverallHealth:         health,
		TotalHTTPRequests:     totalHTTP,
		FirewallBlockedEvents: fwBlocked,
		AverageCPUPercent:     avgCPU,
		TotalMemoryBytes:      totalMem,
		ActiveAlertsCount:     activeAlerts,
		CriticalAlertsCount:   criticalAlerts,
		Collectors:            collectors,
		RecentEvents:          eventsPage.Items,
		RecentAlerts:          alertsPage.Items,
		GeneratedAt:           time.Now().UTC(),
	}, nil
}

func (p *PostgresRepository) GetTrafficSeries(ctx context.Context, from, to time.Time, bucketMinutes int) ([]models.TrafficBucket, error) {
	events, err := p.GetEventsInWindow(ctx, from)
	if err != nil {
		return nil, err
	}
	mem := NewMemoryRepository(nil)
	_ = mem.SaveEventsBatch(ctx, events)
	alertsPage, _ := p.ListAlerts(ctx, models.EventFilter{From: &from, To: &to, Limit: 100})
	for _, al := range alertsPage.Items {
		_, _, _ = mem.UpsertOrDeduplicateAlert(ctx, al, time.Second)
	}
	return mem.GetTrafficSeries(ctx, from, to, bucketMinutes)
}

func (p *PostgresRepository) GetNetworkStatistics(ctx context.Context, from, to time.Time) (*models.NetworkStatistics, error) {
	events, err := p.GetEventsInWindow(ctx, from)
	if err != nil {
		return nil, err
	}
	mem := NewMemoryRepository(nil)
	_ = mem.SaveEventsBatch(ctx, events)
	return mem.GetNetworkStatistics(ctx, from, to)
}

func (p *PostgresRepository) GetWebStatistics(ctx context.Context, from, to time.Time) (*models.WebStatistics, error) {
	events, err := p.GetEventsInWindow(ctx, from)
	if err != nil {
		return nil, err
	}
	mem := NewMemoryRepository(nil)
	_ = mem.SaveEventsBatch(ctx, events)
	return mem.GetWebStatistics(ctx, from, to)
}

func (p *PostgresRepository) ListRules(ctx context.Context, filter models.EventFilter) (models.PaginatedResult[models.DetectionRule], error) {
	all, err := p.GetAllRules(ctx)
	if err != nil {
		return models.PaginatedResult[models.DetectionRule]{}, err
	}
	filtered := make([]models.DetectionRule, 0, len(all))
	for _, r := range all {
		if filter.Severity != "" && r.Severity != filter.Severity {
			continue
		}
		filtered = append(filtered, r)
	}
	return paginateSlice(filtered, filter.Limit, filter.Offset, func(item models.DetectionRule) string { return item.ID }), nil
}

func (p *PostgresRepository) GetAllRules(ctx context.Context) ([]models.DetectionRule, error) {
	const q = `
		SELECT id, rule_name, rule_type, threshold, time_window, severity, enabled, configuration, updated_at
		FROM detection_rules
		ORDER BY id ASC
	`
	rows, err := p.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.DetectionRule, 0, 16)
	for rows.Next() {
		var r models.DetectionRule
		var cfgRaw []byte
		if err := rows.Scan(&r.ID, &r.RuleName, &r.RuleType, &r.Threshold, &r.TimeWindow, &r.Severity, &r.Enabled, &cfgRaw, &r.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(cfgRaw, &r.Configuration)
		out = append(out, r)
	}
	return out, nil
}

func (p *PostgresRepository) GetRuleByID(ctx context.Context, id string) (*models.DetectionRule, error) {
	const q = `
		SELECT id, rule_name, rule_type, threshold, time_window, severity, enabled, configuration, updated_at
		FROM detection_rules
		WHERE id = $1
	`
	var r models.DetectionRule
	var cfgRaw []byte
	err := p.pool.QueryRow(ctx, q, id).Scan(&r.ID, &r.RuleName, &r.RuleType, &r.Threshold, &r.TimeWindow, &r.Severity, &r.Enabled, &cfgRaw, &r.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(cfgRaw, &r.Configuration)
	return &r, nil
}

func (p *PostgresRepository) CreateRule(ctx context.Context, rule models.DetectionRule) (*models.DetectionRule, error) {
	cfgRaw, err := json.Marshal(rule.Configuration)
	if err != nil {
		cfgRaw = []byte("{}")
	}
	const q = `
		INSERT INTO detection_rules (id, rule_name, rule_type, threshold, time_window, severity, enabled, configuration, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
		RETURNING updated_at
	`
	if err := p.pool.QueryRow(ctx, q,
		rule.ID, rule.RuleName, rule.RuleType, rule.Threshold, rule.TimeWindow, rule.Severity, rule.Enabled, cfgRaw,
	).Scan(&rule.UpdatedAt); err != nil {
		return nil, err
	}
	return &rule, nil
}

func (p *PostgresRepository) UpdateRule(ctx context.Context, id string, patch RulePatch) (*models.DetectionRule, error) {
	existing, err := p.GetRuleByID(ctx, id)
	if err != nil || existing == nil {
		return existing, err
	}
	if patch.RuleName != nil {
		existing.RuleName = *patch.RuleName
	}
	if patch.Threshold != nil {
		existing.Threshold = *patch.Threshold
	}
	if patch.TimeWindow != nil {
		existing.TimeWindow = *patch.TimeWindow
	}
	if patch.Severity != nil {
		existing.Severity = *patch.Severity
	}
	if patch.Enabled != nil {
		existing.Enabled = *patch.Enabled
	}
	if patch.Configuration != nil {
		existing.Configuration = patch.Configuration
	}

	cfgRaw, _ := json.Marshal(existing.Configuration)
	const q = `
		UPDATE detection_rules
		SET rule_name = $2, threshold = $3, time_window = $4, severity = $5, enabled = $6, configuration = $7, updated_at = NOW()
		WHERE id = $1
		RETURNING updated_at
	`
	if err := p.pool.QueryRow(ctx, q,
		id, existing.RuleName, existing.Threshold, existing.TimeWindow, existing.Severity, existing.Enabled, cfgRaw,
	).Scan(&existing.UpdatedAt); err != nil {
		return nil, err
	}
	return existing, nil
}

func (p *PostgresRepository) ListAlerts(ctx context.Context, filter models.EventFilter) (models.PaginatedResult[models.SecurityAlert], error) {
	limit, offset := sanitizeLimitOffset(filter.Limit, filter.Offset)
	where := "WHERE 1=1"
	args := make([]interface{}, 0, 8)
	idx := 1

	if filter.Severity != "" {
		where += fmt.Sprintf(" AND severity = $%d", idx)
		args = append(args, filter.Severity)
		idx++
	}
	if filter.Status != "" {
		where += fmt.Sprintf(" AND status = $%d", idx)
		args = append(args, filter.Status)
		idx++
	}
	if filter.RuleID != "" {
		where += fmt.Sprintf(" AND rule_id = $%d", idx)
		args = append(args, filter.RuleID)
		idx++
	}
	if filter.SourceIP != "" {
		where += fmt.Sprintf(" AND source_ip = $%d", idx)
		args = append(args, filter.SourceIP)
		idx++
	}
	if filter.From != nil {
		where += fmt.Sprintf(" AND last_seen >= $%d", idx)
		args = append(args, *filter.From)
		idx++
	}
	if filter.To != nil {
		where += fmt.Sprintf(" AND last_seen <= $%d", idx)
		args = append(args, *filter.To)
		idx++
	}

	var total int
	if err := p.pool.QueryRow(ctx, "SELECT COUNT(*) FROM security_alerts "+where, args...).Scan(&total); err != nil {
		return models.PaginatedResult[models.SecurityAlert]{}, err
	}

	args = append(args, limit, offset)
	q := fmt.Sprintf(`
		SELECT id::text, rule_id, title, description, severity, COALESCE(source_ip, ''),
		       status, first_seen, last_seen, event_count, evidence, COALESCE(acknowledged_by, ''), acknowledged_at, created_at
		FROM security_alerts
		%s
		ORDER BY last_seen DESC, id DESC
		LIMIT $%d OFFSET $%d
	`, where, idx, idx+1)

	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return models.PaginatedResult[models.SecurityAlert]{}, err
	}
	defer rows.Close()

	items := make([]models.SecurityAlert, 0, limit)
	for rows.Next() {
		var al models.SecurityAlert
		var evRaw []byte
		if err := rows.Scan(
			&al.ID, &al.RuleID, &al.Title, &al.Description, &al.Severity, &al.SourceIP,
			&al.Status, &al.FirstSeen, &al.LastSeen, &al.EventCount, &evRaw, &al.AcknowledgedBy, &al.AcknowledgedAt, &al.CreatedAt,
		); err != nil {
			return models.PaginatedResult[models.SecurityAlert]{}, err
		}
		_ = json.Unmarshal(evRaw, &al.Evidence)
		items = append(items, al)
	}

	nextCursor := ""
	if offset+len(items) < total && len(items) > 0 {
		nextCursor = items[len(items)-1].ID
	}
	return models.NewPaginatedResult(items, limit, offset, total, nextCursor), nil
}

func (p *PostgresRepository) GetAlertByID(ctx context.Context, id string) (*models.SecurityAlert, error) {
	const q = `
		SELECT id::text, rule_id, title, description, severity, COALESCE(source_ip, ''),
		       status, first_seen, last_seen, event_count, evidence, COALESCE(acknowledged_by, ''), acknowledged_at, created_at
		FROM security_alerts
		WHERE id = $1::uuid
	`
	var al models.SecurityAlert
	var evRaw []byte
	err := p.pool.QueryRow(ctx, q, id).Scan(
		&al.ID, &al.RuleID, &al.Title, &al.Description, &al.Severity, &al.SourceIP,
		&al.Status, &al.FirstSeen, &al.LastSeen, &al.EventCount, &evRaw, &al.AcknowledgedBy, &al.AcknowledgedAt, &al.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(evRaw, &al.Evidence)
	return &al, nil
}

func (p *PostgresRepository) UpsertOrDeduplicateAlert(ctx context.Context, alert models.SecurityAlert, dedupWindow time.Duration) (*models.SecurityAlert, bool, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	cutoff := alert.LastSeen.Add(-dedupWindow)
	evRaw, _ := json.Marshal(alert.Evidence)

	const findQ = `
		SELECT id::text, first_seen, event_count
		FROM security_alerts
		WHERE rule_id = $1
		  AND COALESCE(source_ip, '') = $2
		  AND status != 'resolved'
		  AND last_seen >= $3
		ORDER BY last_seen DESC
		LIMIT 1
		FOR UPDATE
	`
	var existingID string
	var firstSeen time.Time
	var currentCount int
	err = tx.QueryRow(ctx, findQ, alert.RuleID, alert.SourceIP, cutoff).Scan(&existingID, &firstSeen, &currentCount)
	if err == nil {
		inc := alert.EventCount
		if inc <= 0 {
			inc = 1
		}
		const updQ = `
			UPDATE security_alerts
			SET last_seen = $2, event_count = $3, evidence = $4
			WHERE id = $1::uuid
			RETURNING status, created_at
		`
		alert.ID = existingID
		alert.FirstSeen = firstSeen
		alert.EventCount = currentCount + inc
		if err := tx.QueryRow(ctx, updQ, existingID, alert.LastSeen, alert.EventCount, evRaw).Scan(&alert.Status, &alert.CreatedAt); err != nil {
			return nil, false, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, false, err
		}
		return &alert, false, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, err
	}

	if alert.Status == "" {
		alert.Status = models.AlertStatusOpen
	}
	if alert.EventCount <= 0 {
		alert.EventCount = 1
	}

	const insQ = `
		INSERT INTO security_alerts (rule_id, title, description, severity, source_ip, status, first_seen, last_seen, event_count, evidence)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7, $8, $9, $10)
		RETURNING id::text, created_at
	`
	if err := tx.QueryRow(ctx, insQ,
		alert.RuleID, alert.Title, alert.Description, alert.Severity, alert.SourceIP,
		alert.Status, alert.FirstSeen, alert.LastSeen, alert.EventCount, evRaw,
	).Scan(&alert.ID, &alert.CreatedAt); err != nil {
		return nil, false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	return &alert, true, nil
}

func (p *PostgresRepository) UpdateAlertStatus(ctx context.Context, id, status, actorID string) (*models.SecurityAlert, error) {
	const q = `
		UPDATE security_alerts
		SET status = $2,
		    acknowledged_by = CASE WHEN $2 IN ('acknowledged', 'resolved') THEN $3 ELSE acknowledged_by END,
		    acknowledged_at = CASE WHEN $2 IN ('acknowledged', 'resolved') THEN NOW() ELSE acknowledged_at END
		WHERE id = $1::uuid
	`
	tag, err := p.pool.Exec(ctx, q, id, status, actorID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, nil
	}
	return p.GetAlertByID(ctx, id)
}

func (p *PostgresRepository) CreateAuditLog(ctx context.Context, entry models.AuditLog) error {
	metaRaw, err := json.Marshal(entry.Metadata)
	if err != nil {
		metaRaw = []byte("{}")
	}
	const q = `
		INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, metadata)
		VALUES ($1, $2, $3, NULLIF($4, ''), $5)
	`
	_, err = p.pool.Exec(ctx, q, entry.ActorID, entry.Action, entry.ResourceType, entry.ResourceID, metaRaw)
	return err
}

func (p *PostgresRepository) ListAuditLogs(ctx context.Context, filter models.EventFilter) (models.PaginatedResult[models.AuditLog], error) {
	limit, offset := sanitizeLimitOffset(filter.Limit, filter.Offset)
	where := "WHERE 1=1"
	args := make([]interface{}, 0, 6)
	idx := 1

	if filter.ActorID != "" {
		where += fmt.Sprintf(" AND actor_id = $%d", idx)
		args = append(args, filter.ActorID)
		idx++
	}
	if filter.EventType != "" {
		where += fmt.Sprintf(" AND action = $%d", idx)
		args = append(args, filter.EventType)
		idx++
	}
	if filter.From != nil {
		where += fmt.Sprintf(" AND created_at >= $%d", idx)
		args = append(args, *filter.From)
		idx++
	}
	if filter.To != nil {
		where += fmt.Sprintf(" AND created_at <= $%d", idx)
		args = append(args, *filter.To)
		idx++
	}

	var total int
	if err := p.pool.QueryRow(ctx, "SELECT COUNT(*) FROM audit_logs "+where, args...).Scan(&total); err != nil {
		return models.PaginatedResult[models.AuditLog]{}, err
	}

	args = append(args, limit, offset)
	q := fmt.Sprintf(`
		SELECT id::text, actor_id, action, resource_type, COALESCE(resource_id, ''), metadata, created_at
		FROM audit_logs
		%s
		ORDER BY created_at DESC, id DESC
		LIMIT $%d OFFSET $%d
	`, where, idx, idx+1)

	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return models.PaginatedResult[models.AuditLog]{}, err
	}
	defer rows.Close()

	items := make([]models.AuditLog, 0, limit)
	for rows.Next() {
		var al models.AuditLog
		var metaRaw []byte
		if err := rows.Scan(&al.ID, &al.ActorID, &al.Action, &al.ResourceType, &al.ResourceID, &metaRaw, &al.CreatedAt); err != nil {
			return models.PaginatedResult[models.AuditLog]{}, err
		}
		_ = json.Unmarshal(metaRaw, &al.Metadata)
		items = append(items, al)
	}

	nextCursor := ""
	if offset+len(items) < total && len(items) > 0 {
		nextCursor = items[len(items)-1].ID
	}
	return models.NewPaginatedResult(items, limit, offset, total, nextCursor), nil
}

func (p *PostgresRepository) GetAdminByUsername(ctx context.Context, username string) (*models.AdminUser, error) {
	const q = `
		SELECT id::text, username, email, password_hash, role, mfa_enabled, COALESCE(mfa_secret, ''),
		       failed_login_attempts, locked_until, last_login_at, created_at
		FROM security_admins
		WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)
	`
	var u models.AdminUser
	err := p.pool.QueryRow(ctx, q, username).Scan(
		&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.Role, &u.MFAEnabled, &u.MFASecret,
		&u.FailedLoginAttempts, &u.LockedUntil, &u.LastLoginAt, &u.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (p *PostgresRepository) GetAdminByID(ctx context.Context, id string) (*models.AdminUser, error) {
	const q = `
		SELECT id::text, username, email, password_hash, role, mfa_enabled, COALESCE(mfa_secret, ''),
		       failed_login_attempts, locked_until, last_login_at, created_at
		FROM security_admins
		WHERE id = $1::uuid
	`
	var u models.AdminUser
	err := p.pool.QueryRow(ctx, q, id).Scan(
		&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.Role, &u.MFAEnabled, &u.MFASecret,
		&u.FailedLoginAttempts, &u.LockedUntil, &u.LastLoginAt, &u.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (p *PostgresRepository) CreateAdmin(ctx context.Context, admin models.AdminUser) (*models.AdminUser, error) {
	const q = `
		INSERT INTO security_admins (username, email, password_hash, role, mfa_enabled, mfa_secret)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''))
		RETURNING id::text, created_at
	`
	if err := p.pool.QueryRow(ctx, q,
		admin.Username, admin.Email, admin.PasswordHash, admin.Role, admin.MFAEnabled, admin.MFASecret,
	).Scan(&admin.ID, &admin.CreatedAt); err != nil {
		return nil, err
	}
	return &admin, nil
}

func (p *PostgresRepository) UpdateAdminLoginState(ctx context.Context, id string, failedAttempts int, lockedUntil *time.Time, lastLogin *time.Time) error {
	const q = `
		UPDATE security_admins
		SET failed_login_attempts = $2,
		    locked_until = $3,
		    last_login_at = COALESCE($4, last_login_at),
		    updated_at = NOW()
		WHERE id = $1::uuid
	`
	_, err := p.pool.Exec(ctx, q, id, failedAttempts, lockedUntil, lastLogin)
	return err
}

func (p *PostgresRepository) UpdateAdminMFA(ctx context.Context, id string, enabled bool, encryptedSecret string) error {
	const q = `
		UPDATE security_admins
		SET mfa_enabled = $2, mfa_secret = NULLIF($3, ''), updated_at = NOW()
		WHERE id = $1::uuid
	`
	_, err := p.pool.Exec(ctx, q, id, enabled, encryptedSecret)
	return err
}

func (p *PostgresRepository) CreateSession(ctx context.Context, session models.AdminSession) error {
	const q = `
		INSERT INTO security_sessions (id, admin_id, csrf_token, ip_address, user_agent, expires_at)
		VALUES ($1, $2::uuid, $3, NULLIF($4, ''), NULLIF($5, ''), $6)
	`
	_, err := p.pool.Exec(ctx, q, session.ID, session.AdminID, session.CSRFToken, session.IPAddress, session.UserAgent, session.ExpiresAt)
	return err
}

func (p *PostgresRepository) GetSession(ctx context.Context, sessionID string) (*models.AdminSession, error) {
	const q = `
		SELECT id, admin_id::text, csrf_token, COALESCE(ip_address, ''), COALESCE(user_agent, ''), expires_at, created_at
		FROM security_sessions
		WHERE id = $1 AND expires_at > NOW()
	`
	var s models.AdminSession
	err := p.pool.QueryRow(ctx, q, sessionID).Scan(
		&s.ID, &s.AdminID, &s.CSRFToken, &s.IPAddress, &s.UserAgent, &s.ExpiresAt, &s.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (p *PostgresRepository) DeleteSession(ctx context.Context, sessionID string) error {
	_, err := p.pool.Exec(ctx, "DELETE FROM security_sessions WHERE id = $1", sessionID)
	return err
}

func (p *PostgresRepository) PurgeExpiredData(ctx context.Context, eventsCutoff, metricsCutoff, alertsCutoff time.Time) (int64, error) {
	var total int64
	t1, err := p.pool.Exec(ctx, "DELETE FROM telemetry_events WHERE occurred_at < $1", eventsCutoff)
	if err != nil {
		return total, err
	}
	total += t1.RowsAffected()

	t2, err := p.pool.Exec(ctx, "DELETE FROM system_metrics WHERE recorded_at < $1", metricsCutoff)
	if err != nil {
		return total, err
	}
	total += t2.RowsAffected()

	t3, err := p.pool.Exec(ctx, "DELETE FROM security_alerts WHERE created_at < $1", alertsCutoff)
	if err != nil {
		return total, err
	}
	total += t3.RowsAffected()

	_, _ = p.pool.Exec(ctx, "DELETE FROM security_sessions WHERE expires_at <= NOW()")
	return total, nil
}

func sanitizeLimitOffset(limit, offset int) (int, int) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

