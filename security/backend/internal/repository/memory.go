package repository

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gettalk/security/backend/internal/models"
)

// MemoryRepository provides a thread-safe, transactional in-memory implementation of Repository
// used for unit/integration/security testing and standalone development.
type MemoryRepository struct {
	mu          sync.RWMutex
	events      []models.TelemetryEvent
	fingerIndex map[string]bool
	metrics     []models.SystemMetric
	rules       map[string]models.DetectionRule
	alerts      []models.SecurityAlert
	auditLogs   []models.AuditLog
	checkpoints map[string]models.IngestionCheckpoint
	admins      map[string]models.AdminUser
	sessions    map[string]models.AdminSession
}

// NewMemoryRepository initializes an in-memory repository with default detection rules.
func NewMemoryRepository(initialRules []models.DetectionRule) *MemoryRepository {
	r := &MemoryRepository{
		events:      make([]models.TelemetryEvent, 0, 512),
		fingerIndex: make(map[string]bool),
		metrics:     make([]models.SystemMetric, 0, 512),
		rules:       make(map[string]models.DetectionRule),
		alerts:      make([]models.SecurityAlert, 0, 64),
		auditLogs:   make([]models.AuditLog, 0, 128),
		checkpoints: make(map[string]models.IngestionCheckpoint),
		admins:      make(map[string]models.AdminUser),
		sessions:    make(map[string]models.AdminSession),
	}
	for _, rule := range initialRules {
		if rule.UpdatedAt.IsZero() {
			rule.UpdatedAt = time.Now().UTC()
		}
		r.rules[rule.ID] = rule
	}
	return r
}

func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func (m *MemoryRepository) Close() {}

func (m *MemoryRepository) SaveEventsBatch(_ context.Context, events []models.TelemetryEvent) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, ev := range events {
		if ev.Fingerprint != "" && m.fingerIndex[ev.Fingerprint] {
			continue
		}
		if ev.ID == "" {
			ev.ID = newUUID()
		}
		if ev.OccurredAt.IsZero() {
			ev.OccurredAt = time.Now().UTC()
		}
		if ev.CreatedAt.IsZero() {
			ev.CreatedAt = time.Now().UTC()
		}
		if ev.EventData == nil {
			ev.EventData = map[string]interface{}{}
		}
		if ev.Fingerprint != "" {
			m.fingerIndex[ev.Fingerprint] = true
		}
		m.events = append(m.events, ev)
	}
	return nil
}

func (m *MemoryRepository) SaveMetricsBatch(_ context.Context, metrics []models.SystemMetric) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, met := range metrics {
		if met.ID == "" {
			met.ID = newUUID()
		}
		if met.RecordedAt.IsZero() {
			met.RecordedAt = time.Now().UTC()
		}
		if met.Labels == nil {
			met.Labels = map[string]interface{}{}
		}
		m.metrics = append(m.metrics, met)
	}
	return nil
}

func (m *MemoryRepository) GetCheckpoint(_ context.Context, sourceKey string) (*models.IngestionCheckpoint, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	cp, ok := m.checkpoints[sourceKey]
	if !ok {
		return nil, nil
	}
	cpCopy := cp
	return &cpCopy, nil
}

func (m *MemoryRepository) SaveCheckpoint(_ context.Context, cp models.IngestionCheckpoint) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if cp.UpdatedAt.IsZero() {
		cp.UpdatedAt = time.Now().UTC()
	}
	m.checkpoints[cp.SourceKey] = cp
	return nil
}

func (m *MemoryRepository) ListEvents(_ context.Context, filter models.EventFilter) (models.PaginatedResult[models.TelemetryEvent], error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	matched := make([]models.TelemetryEvent, 0)
	for _, ev := range m.events {
		if filter.Source != "" && ev.Source != filter.Source {
			continue
		}
		if filter.EventType != "" && ev.EventType != filter.EventType {
			continue
		}
		if filter.Severity != "" && ev.Severity != filter.Severity {
			continue
		}
		if filter.SourceIP != "" && ev.SourceIP != filter.SourceIP {
			continue
		}
		if filter.From != nil && ev.OccurredAt.Before(*filter.From) {
			continue
		}
		if filter.To != nil && ev.OccurredAt.After(*filter.To) {
			continue
		}
		matched = append(matched, ev)
	}

	sort.Slice(matched, func(i, j int) bool {
		if matched[i].OccurredAt.Equal(matched[j].OccurredAt) {
			return matched[i].ID > matched[j].ID
		}
		return matched[i].OccurredAt.After(matched[j].OccurredAt)
	})

	return paginateSlice(matched, filter.Limit, filter.Offset, func(item models.TelemetryEvent) string { return item.ID }), nil
}

func (m *MemoryRepository) GetEventsInWindow(_ context.Context, since time.Time) ([]models.TelemetryEvent, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]models.TelemetryEvent, 0)
	for _, ev := range m.events {
		if !ev.OccurredAt.Before(since) {
			out = append(out, ev)
		}
	}
	return out, nil
}

func (m *MemoryRepository) GetMetricsInWindow(_ context.Context, source, metricName string, since time.Time) ([]models.SystemMetric, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]models.SystemMetric, 0)
	for _, met := range m.metrics {
		if source != "" && met.Source != source {
			continue
		}
		if metricName != "" && met.MetricName != metricName {
			continue
		}
		if !met.RecordedAt.Before(since) {
			out = append(out, met)
		}
	}
	return out, nil
}

func (m *MemoryRepository) ListApplicationMetrics(_ context.Context, filter models.EventFilter) (models.PaginatedResult[models.SystemMetric], error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	matched := make([]models.SystemMetric, 0)
	for _, met := range m.metrics {
		if met.Source != models.SourcePM2 {
			continue
		}
		if filter.EventType != "" && met.MetricName != filter.EventType {
			continue
		}
		if filter.From != nil && met.RecordedAt.Before(*filter.From) {
			continue
		}
		if filter.To != nil && met.RecordedAt.After(*filter.To) {
			continue
		}
		matched = append(matched, met)
	}

	sort.Slice(matched, func(i, j int) bool {
		return matched[i].RecordedAt.After(matched[j].RecordedAt)
	})

	return paginateSlice(matched, filter.Limit, filter.Offset, func(item models.SystemMetric) string { return item.ID }), nil
}

func (m *MemoryRepository) GetLatestPM2Processes(_ context.Context) ([]models.PM2ProcessSummary, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	byProc := make(map[string]*models.PM2ProcessSummary)
	for _, met := range m.metrics {
		if met.Source != models.SourcePM2 {
			continue
		}
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

func (m *MemoryRepository) GetDashboardOverview(ctx context.Context, since time.Time, collectors []models.CollectorHealth) (*models.DashboardOverview, error) {
	m.mu.RLock()
	var totalHTTP, fwBlocked, activeAlerts, criticalAlerts int64
	for _, ev := range m.events {
		if ev.OccurredAt.Before(since) {
			continue
		}
		if ev.Source == models.SourceNginx && ev.EventType == "http_request" {
			totalHTTP++
		}
		if ev.Source == models.SourceFirewalld {
			fwBlocked++
		}
	}

	for _, al := range m.alerts {
		if al.Status == models.AlertStatusOpen || al.Status == models.AlertStatusAcknowledged {
			activeAlerts++
			if al.Severity == models.SeverityCritical {
				criticalAlerts++
			}
		}
	}
	m.mu.RUnlock()

	procs, _ := m.GetLatestPM2Processes(ctx)
	var avgCPU, totalMem float64
	if len(procs) > 0 {
		for _, p := range procs {
			avgCPU += p.CPUPercent
			totalMem += float64(p.MemoryBytes)
		}
		avgCPU = math.Round((avgCPU/float64(len(procs)))*100) / 100
	}

	eventsPage, _ := m.ListEvents(ctx, models.EventFilter{Limit: 8, Offset: 0})
	alertsPage, _ := m.ListAlerts(ctx, models.EventFilter{Limit: 5, Offset: 0})

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

func (m *MemoryRepository) GetTrafficSeries(_ context.Context, from, to time.Time, bucketMinutes int) ([]models.TrafficBucket, error) {
	if bucketMinutes <= 0 {
		bucketMinutes = 5
	}
	step := time.Duration(bucketMinutes) * time.Minute
	if to.Before(from) {
		to = time.Now().UTC()
		from = to.Add(-time.Hour)
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	buckets := make([]models.TrafficBucket, 0)
	bucketMap := make(map[int64]*models.TrafficBucket)

	startTrunc := from.UTC().Truncate(step)
	endTrunc := to.UTC().Truncate(step)
	for cur := startTrunc; !cur.After(endTrunc); cur = cur.Add(step) {
		b := models.TrafficBucket{Timestamp: cur}
		buckets = append(buckets, b)
		bucketMap[cur.Unix()] = &buckets[len(buckets)-1]
	}

	for _, ev := range m.events {
		if ev.OccurredAt.Before(from) || ev.OccurredAt.After(to) {
			continue
		}
		key := ev.OccurredAt.UTC().Truncate(step).Unix()
		b, ok := bucketMap[key]
		if !ok {
			continue
		}
		if ev.Source == models.SourceFirewalld {
			b.FirewallBlocked++
		} else if ev.Source == models.SourceNginx && ev.EventType == "http_request" {
			b.HTTPRequests++
			sc := intFromAny(ev.EventData["status_code"])
			if sc >= 400 && sc < 500 {
				b.HTTP4xx++
			} else if sc >= 500 {
				b.HTTP5xx++
			}
		}
	}

	for _, al := range m.alerts {
		if al.LastSeen.Before(from) || al.LastSeen.After(to) {
			continue
		}
		key := al.LastSeen.UTC().Truncate(step).Unix()
		if b, ok := bucketMap[key]; ok {
			b.AlertsTriggered++
		}
	}

	return buckets, nil
}

func (m *MemoryRepository) GetNetworkStatistics(ctx context.Context, from, to time.Time) (*models.NetworkStatistics, error) {
	m.mu.RLock()
	var dropped, rejected int64
	ipCounts := make(map[string]int64)
	protoCounts := make(map[string]int64)
	portCounts := make(map[int]int64)

	for _, ev := range m.events {
		if ev.Source != models.SourceFirewalld {
			continue
		}
		if ev.OccurredAt.Before(from) || ev.OccurredAt.After(to) {
			continue
		}
		switch ev.EventType {
		case "packet_drop":
			dropped++
		case "connection_reject":
			rejected++
		}
		if ev.SourceIP != "" {
			ipCounts[ev.SourceIP]++
		}
		proto := strFromAny(ev.EventData["protocol"], "UNKNOWN")
		protoCounts[proto]++
		if dpt := intFromAny(ev.EventData["destination_port"]); dpt > 0 {
			portCounts[dpt]++
		}
	}
	m.mu.RUnlock()

	topIPs := topIPSlice(ipCounts, 10)
	protos := make([]models.ProtocolCount, 0, len(protoCounts))
	for p, c := range protoCounts {
		protos = append(protos, models.ProtocolCount{Protocol: p, Count: c})
	}
	sort.Slice(protos, func(i, j int) bool { return protos[i].Count > protos[j].Count })

	ports := make([]models.PortCount, 0, len(portCounts))
	for p, c := range portCounts {
		ports = append(ports, models.PortCount{Port: p, Count: c})
	}
	sort.Slice(ports, func(i, j int) bool { return ports[i].Count > ports[j].Count })
	if len(ports) > 10 {
		ports = ports[:10]
	}

	timeline, _ := m.GetTrafficSeries(ctx, from, to, 5)

	return &models.NetworkStatistics{
		TotalDropped:         dropped,
		TotalRejected:        rejected,
		UniqueSourceIPs:      int64(len(ipCounts)),
		TopSourceIPs:         topIPs,
		ProtocolDistribution: protos,
		TopDestinationPorts:  ports,
		Timeline:             timeline,
	}, nil
}

func (m *MemoryRepository) GetWebStatistics(ctx context.Context, from, to time.Time) (*models.WebStatistics, error) {
	m.mu.RLock()
	var totalReqs, totalErrs int64
	var durations []float64
	var sumDuration float64
	statusGroups := map[string]int64{"2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0}
	ipCounts := make(map[string]int64)
	type epAgg struct {
		method string
		count  int64
		sumDur float64
		errs   int64
	}
	endpoints := make(map[string]*epAgg)

	for _, ev := range m.events {
		if ev.Source != models.SourceNginx {
			continue
		}
		if ev.OccurredAt.Before(from) || ev.OccurredAt.After(to) {
			continue
		}
		if ev.EventType == "nginx_error" {
			totalErrs++
			continue
		}
		if ev.EventType != "http_request" {
			continue
		}
		totalReqs++
		if ev.SourceIP != "" {
			ipCounts[ev.SourceIP]++
		}
		sc := intFromAny(ev.EventData["status_code"])
		switch {
		case sc >= 200 && sc < 300:
			statusGroups["2xx"]++
		case sc >= 300 && sc < 400:
			statusGroups["3xx"]++
		case sc >= 400 && sc < 500:
			statusGroups["4xx"]++
		case sc >= 500:
			statusGroups["5xx"]++
			totalErrs++
		}
		dur := floatFromAny(ev.EventData["request_duration_ms"])
		durations = append(durations, dur)
		sumDuration += dur

		ep := strFromAny(ev.EventData["endpoint"], "/")
		method := strFromAny(ev.EventData["method"], "GET")
		key := method + " " + ep
		agg, exists := endpoints[key]
		if !exists {
			agg = &epAgg{method: method}
			endpoints[key] = agg
		}
		agg.count++
		agg.sumDur += dur
		if sc >= 400 {
			agg.errs++
		}
	}
	m.mu.RUnlock()

	var avgDur, p95, p99 float64
	if len(durations) > 0 {
		sort.Float64s(durations)
		avgDur = math.Round((sumDuration/float64(len(durations)))*100) / 100
		p95 = math.Round(percentile(durations, 0.95)*100) / 100
		p99 = math.Round(percentile(durations, 0.99)*100) / 100
	}

	statusDist := []models.StatusDistribution{
		{StatusGroup: "2xx", Count: statusGroups["2xx"]},
		{StatusGroup: "3xx", Count: statusGroups["3xx"]},
		{StatusGroup: "4xx", Count: statusGroups["4xx"]},
		{StatusGroup: "5xx", Count: statusGroups["5xx"]},
	}

	topEndpoints := make([]models.EndpointStat, 0, len(endpoints))
	for k, agg := range endpoints {
		parts := strings.SplitN(k, " ", 2)
		epName := parts[len(parts)-1]
		topEndpoints = append(topEndpoints, models.EndpointStat{
			Endpoint:      epName,
			Method:        agg.method,
			Count:         agg.count,
			AvgDurationMs: math.Round((agg.sumDur/float64(agg.count))*100) / 100,
			ErrorCount:    agg.errs,
		})
	}
	sort.Slice(topEndpoints, func(i, j int) bool { return topEndpoints[i].Count > topEndpoints[j].Count })
	if len(topEndpoints) > 10 {
		topEndpoints = topEndpoints[:10]
	}

	timeline, _ := m.GetTrafficSeries(ctx, from, to, 5)

	return &models.WebStatistics{
		TotalRequests:        totalReqs,
		TotalErrors:          totalErrs,
		AvgRequestDurationMs: avgDur,
		P95RequestDurationMs: p95,
		P99RequestDurationMs: p99,
		StatusDistribution:   statusDist,
		TopEndpoints:         topEndpoints,
		TopSourceIPs:         topIPSlice(ipCounts, 10),
		Timeline:             timeline,
	}, nil
}

func (m *MemoryRepository) ListRules(_ context.Context, filter models.EventFilter) (models.PaginatedResult[models.DetectionRule], error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	all := make([]models.DetectionRule, 0, len(m.rules))
	for _, r := range m.rules {
		if filter.Severity != "" && r.Severity != filter.Severity {
			continue
		}
		all = append(all, r)
	}
	sort.Slice(all, func(i, j int) bool { return all[i].ID < all[j].ID })
	return paginateSlice(all, filter.Limit, filter.Offset, func(item models.DetectionRule) string { return item.ID }), nil
}

func (m *MemoryRepository) GetAllRules(_ context.Context) ([]models.DetectionRule, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	all := make([]models.DetectionRule, 0, len(m.rules))
	for _, r := range m.rules {
		all = append(all, r)
	}
	sort.Slice(all, func(i, j int) bool { return all[i].ID < all[j].ID })
	return all, nil
}

func (m *MemoryRepository) GetRuleByID(_ context.Context, id string) (*models.DetectionRule, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	r, ok := m.rules[id]
	if !ok {
		return nil, nil
	}
	rCopy := r
	return &rCopy, nil
}

func (m *MemoryRepository) CreateRule(_ context.Context, rule models.DetectionRule) (*models.DetectionRule, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.rules[rule.ID]; exists {
		return nil, fmt.Errorf("rule %s already exists", rule.ID)
	}
	rule.UpdatedAt = time.Now().UTC()
	if rule.Configuration == nil {
		rule.Configuration = map[string]interface{}{}
	}
	m.rules[rule.ID] = rule
	rCopy := rule
	return &rCopy, nil
}

func (m *MemoryRepository) UpdateRule(_ context.Context, id string, patch RulePatch) (*models.DetectionRule, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rules[id]
	if !ok {
		return nil, nil
	}
	if patch.RuleName != nil {
		r.RuleName = *patch.RuleName
	}
	if patch.Threshold != nil {
		r.Threshold = *patch.Threshold
	}
	if patch.TimeWindow != nil {
		r.TimeWindow = *patch.TimeWindow
	}
	if patch.Severity != nil {
		r.Severity = *patch.Severity
	}
	if patch.Enabled != nil {
		r.Enabled = *patch.Enabled
	}
	if patch.Configuration != nil {
		r.Configuration = patch.Configuration
	}
	r.UpdatedAt = time.Now().UTC()
	m.rules[id] = r
	rCopy := r
	return &rCopy, nil
}

func (m *MemoryRepository) ListAlerts(_ context.Context, filter models.EventFilter) (models.PaginatedResult[models.SecurityAlert], error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	matched := make([]models.SecurityAlert, 0)
	for _, al := range m.alerts {
		if filter.Severity != "" && al.Severity != filter.Severity {
			continue
		}
		if filter.Status != "" && al.Status != filter.Status {
			continue
		}
		if filter.RuleID != "" && al.RuleID != filter.RuleID {
			continue
		}
		if filter.SourceIP != "" && al.SourceIP != filter.SourceIP {
			continue
		}
		if filter.From != nil && al.LastSeen.Before(*filter.From) {
			continue
		}
		if filter.To != nil && al.LastSeen.After(*filter.To) {
			continue
		}
		matched = append(matched, al)
	}

	sort.Slice(matched, func(i, j int) bool {
		if matched[i].LastSeen.Equal(matched[j].LastSeen) {
			return matched[i].ID > matched[j].ID
		}
		return matched[i].LastSeen.After(matched[j].LastSeen)
	})

	return paginateSlice(matched, filter.Limit, filter.Offset, func(item models.SecurityAlert) string { return item.ID }), nil
}

func (m *MemoryRepository) GetAlertByID(_ context.Context, id string) (*models.SecurityAlert, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, al := range m.alerts {
		if al.ID == id {
			alCopy := al
			return &alCopy, nil
		}
	}
	return nil, nil
}

func (m *MemoryRepository) UpsertOrDeduplicateAlert(_ context.Context, alert models.SecurityAlert, dedupWindow time.Duration) (*models.SecurityAlert, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	if alert.LastSeen.IsZero() {
		alert.LastSeen = now
	}
	if alert.FirstSeen.IsZero() {
		alert.FirstSeen = alert.LastSeen
	}

	cutoff := alert.LastSeen.Add(-dedupWindow)
	for i := range m.alerts {
		existing := &m.alerts[i]
		if existing.RuleID == alert.RuleID &&
			existing.SourceIP == alert.SourceIP &&
			existing.Status != models.AlertStatusResolved &&
			!existing.LastSeen.Before(cutoff) {
			existing.LastSeen = alert.LastSeen
			if alert.EventCount > 0 {
				existing.EventCount += alert.EventCount
			} else {
				existing.EventCount++
			}
			if alert.Evidence != nil {
				existing.Evidence = alert.Evidence
			}
			copyAlert := *existing
			return &copyAlert, false, nil
		}
	}

	if alert.ID == "" {
		alert.ID = newUUID()
	}
	if alert.Status == "" {
		alert.Status = models.AlertStatusOpen
	}
	if alert.EventCount <= 0 {
		alert.EventCount = 1
	}
	if alert.CreatedAt.IsZero() {
		alert.CreatedAt = now
	}
	if alert.Evidence == nil {
		alert.Evidence = map[string]interface{}{}
	}

	m.alerts = append(m.alerts, alert)
	copyAlert := alert
	return &copyAlert, true, nil
}

func (m *MemoryRepository) UpdateAlertStatus(_ context.Context, id, status, actorID string) (*models.SecurityAlert, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	for i := range m.alerts {
		if m.alerts[i].ID == id {
			m.alerts[i].Status = status
			if status == models.AlertStatusAcknowledged || status == models.AlertStatusResolved {
				m.alerts[i].AcknowledgedBy = actorID
				m.alerts[i].AcknowledgedAt = &now
			}
			copyAlert := m.alerts[i]
			return &copyAlert, nil
		}
	}
	return nil, nil
}

func (m *MemoryRepository) CreateAuditLog(_ context.Context, entry models.AuditLog) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if entry.ID == "" {
		entry.ID = newUUID()
	}
	if entry.CreatedAt.IsZero() {
		entry.CreatedAt = time.Now().UTC()
	}
	if entry.Metadata == nil {
		entry.Metadata = map[string]interface{}{}
	}
	m.auditLogs = append(m.auditLogs, entry)
	return nil
}

func (m *MemoryRepository) ListAuditLogs(_ context.Context, filter models.EventFilter) (models.PaginatedResult[models.AuditLog], error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	matched := make([]models.AuditLog, 0)
	for _, al := range m.auditLogs {
		if filter.ActorID != "" && al.ActorID != filter.ActorID {
			continue
		}
		if filter.EventType != "" && al.Action != filter.EventType {
			continue
		}
		if filter.From != nil && al.CreatedAt.Before(*filter.From) {
			continue
		}
		if filter.To != nil && al.CreatedAt.After(*filter.To) {
			continue
		}
		matched = append(matched, al)
	}

	sort.Slice(matched, func(i, j int) bool {
		return matched[i].CreatedAt.After(matched[j].CreatedAt)
	})

	return paginateSlice(matched, filter.Limit, filter.Offset, func(item models.AuditLog) string { return item.ID }), nil
}

func (m *MemoryRepository) GetAdminByUsername(_ context.Context, username string) (*models.AdminUser, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, adm := range m.admins {
		if strings.EqualFold(adm.Username, username) || strings.EqualFold(adm.Email, username) {
			aCopy := adm
			return &aCopy, nil
		}
	}
	return nil, nil
}

func (m *MemoryRepository) GetAdminByID(_ context.Context, id string) (*models.AdminUser, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	adm, ok := m.admins[id]
	if !ok {
		return nil, nil
	}
	aCopy := adm
	return &aCopy, nil
}

func (m *MemoryRepository) CreateAdmin(_ context.Context, admin models.AdminUser) (*models.AdminUser, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if admin.ID == "" {
		admin.ID = newUUID()
	}
	if admin.CreatedAt.IsZero() {
		admin.CreatedAt = time.Now().UTC()
	}
	m.admins[admin.ID] = admin
	aCopy := admin
	return &aCopy, nil
}

func (m *MemoryRepository) UpdateAdminLoginState(_ context.Context, id string, failedAttempts int, lockedUntil *time.Time, lastLogin *time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	adm, ok := m.admins[id]
	if !ok {
		return nil
	}
	adm.FailedLoginAttempts = failedAttempts
	adm.LockedUntil = lockedUntil
	if lastLogin != nil {
		adm.LastLoginAt = lastLogin
	}
	m.admins[id] = adm
	return nil
}

func (m *MemoryRepository) UpdateAdminMFA(_ context.Context, id string, enabled bool, encryptedSecret string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	adm, ok := m.admins[id]
	if !ok {
		return nil
	}
	adm.MFAEnabled = enabled
	adm.MFASecret = encryptedSecret
	m.admins[id] = adm
	return nil
}

func (m *MemoryRepository) CreateSession(_ context.Context, session models.AdminSession) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if session.ID == "" {
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		session.ID = hex.EncodeToString(b)
	}
	if session.CreatedAt.IsZero() {
		session.CreatedAt = time.Now().UTC()
	}
	m.sessions[session.ID] = session
	return nil
}

func (m *MemoryRepository) GetSession(_ context.Context, sessionID string) (*models.AdminSession, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	sess, ok := m.sessions[sessionID]
	if !ok {
		return nil, nil
	}
	if time.Now().UTC().After(sess.ExpiresAt) {
		return nil, nil
	}
	sCopy := sess
	return &sCopy, nil
}

func (m *MemoryRepository) DeleteSession(_ context.Context, sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, sessionID)
	return nil
}

func (m *MemoryRepository) PurgeExpiredData(_ context.Context, eventsCutoff, metricsCutoff, alertsCutoff time.Time) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var removed int64

	keptEvents := m.events[:0]
	for _, ev := range m.events {
		if ev.OccurredAt.Before(eventsCutoff) {
			removed++
			if ev.Fingerprint != "" {
				delete(m.fingerIndex, ev.Fingerprint)
			}
		} else {
			keptEvents = append(keptEvents, ev)
		}
	}
	m.events = keptEvents

	keptMetrics := m.metrics[:0]
	for _, met := range m.metrics {
		if met.RecordedAt.Before(metricsCutoff) {
			removed++
		} else {
			keptMetrics = append(keptMetrics, met)
		}
	}
	m.metrics = keptMetrics

	keptAlerts := m.alerts[:0]
	for _, al := range m.alerts {
		if al.CreatedAt.Before(alertsCutoff) {
			removed++
		} else {
			keptAlerts = append(keptAlerts, al)
		}
	}
	m.alerts = keptAlerts

	return removed, nil
}

func paginateSlice[T any](items []T, limit, offset int, getID func(T) string) models.PaginatedResult[T] {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	total := len(items)
	if offset >= total {
		return models.NewPaginatedResult([]T{}, limit, offset, total, "")
	}
	end := offset + limit
	if end > total {
		end = total
	}
	slice := items[offset:end]
	nextCursor := ""
	if end < total && len(slice) > 0 {
		nextCursor = getID(slice[len(slice)-1])
	}
	return models.NewPaginatedResult(slice, limit, offset, total, nextCursor)
}

func topIPSlice(counts map[string]int64, maxItems int) []models.IPCount {
	out := make([]models.IPCount, 0, len(counts))
	for ip, c := range counts {
		out = append(out, models.IPCount{IP: ip, Count: c})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Count > out[j].Count })
	if len(out) > maxItems {
		out = out[:maxItems]
	}
	return out
}

func percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(math.Ceil(float64(len(sorted))*p)) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

func intFromAny(v interface{}) int {
	switch val := v.(type) {
	case int:
		return val
	case int64:
		return int(val)
	case float64:
		return int(val)
	}
	return 0
}

func floatFromAny(v interface{}) float64 {
	switch val := v.(type) {
	case float64:
		return val
	case int:
		return float64(val)
	case int64:
		return float64(val)
	}
	return 0
}

func strFromAny(v interface{}, fallback string) string {
	if s, ok := v.(string); ok && s != "" {
		return s
	}
	return fallback
}
