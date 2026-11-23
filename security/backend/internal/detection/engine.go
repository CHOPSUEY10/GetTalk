package detection

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/gettalk/security/backend/internal/collector"
	"github.com/gettalk/security/backend/internal/config"
	"github.com/gettalk/security/backend/internal/models"
	"github.com/gettalk/security/backend/internal/repository"
)

// CriticalNotifier dispatches asynchronous notifications when a critical alert is detected.
type CriticalNotifier interface {
	NotifyCriticalEventAsync(ev models.TelemetryEvent, description string) bool
}

// Engine implements the passive rule-based Intrusion Detection System (IDS).
// It evaluates telemetry events and system metrics against configurable rules,
// performs cross-layer correlation, deduplicates alerts, and preserves evidence.
type Engine struct {
	cfg         config.DetectionConfig
	repo        repository.Repository
	broadcaster collector.StreamBroadcaster
	notifier    CriticalNotifier
	logger      *slog.Logger
}

// SetCriticalNotifier attaches an asynchronous critical event notifier (e.g., email + Redis cooldown).
func (e *Engine) SetCriticalNotifier(n CriticalNotifier) {
	e.notifier = n
}

// NewEngine creates a new passive IDS Detection Engine.
func NewEngine(
	cfg config.DetectionConfig,
	repo repository.Repository,
	broadcaster collector.StreamBroadcaster,
	logger *slog.Logger,
) *Engine {
	if logger == nil {
		logger = slog.Default()
	}
	return &Engine{
		cfg:         cfg,
		repo:        repo,
		broadcaster: broadcaster,
		logger:      logger,
	}
}

// EvaluateCycle runs one evaluation pass over all enabled detection rules at `now`.
// Returns the list of newly created or updated security alerts.
func (e *Engine) EvaluateCycle(ctx context.Context, now time.Time) ([]models.SecurityAlert, error) {
	if !e.cfg.Enabled {
		return nil, nil
	}

	rules, err := e.repo.GetAllRules(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch detection rules: %w", err)
	}

	maxWindowSec := 300
	for _, r := range rules {
		if r.Enabled && r.TimeWindow > maxWindowSec {
			maxWindowSec = r.TimeWindow
		}
	}

	since := now.Add(-time.Duration(maxWindowSec) * time.Second)
	events, err := e.repo.GetEventsInWindow(ctx, since)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch telemetry events for IDS evaluation: %w", err)
	}

	metrics, err := e.repo.GetMetricsInWindow(ctx, models.SourcePM2, "", since)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch system metrics for IDS evaluation: %w", err)
	}

	dedupCooldown := time.Duration(e.cfg.DedupCooldownSeconds) * time.Second
	if dedupCooldown <= 0 {
		dedupCooldown = 5 * time.Minute
	}

	candidates := make([]models.SecurityAlert, 0)
	layerIPHits := make(map[string]map[string][]string) // ip -> sourceLayer -> ruleIDs
	appAnomalyActive := false
	var appAnomalyEvidence []string

	// Evaluate non-correlation rules first so correlation rules can use their findings
	for _, rule := range rules {
		if !rule.Enabled || rule.RuleType == "correlation" {
			continue
		}

		windowStart := now.Add(-time.Duration(rule.TimeWindow) * time.Second)
		winEvents := filterEventsSince(events, windowStart)
		winMetrics := filterMetricsSince(metrics, windowStart)

		var triggered []models.SecurityAlert
		switch rule.RuleType {
		case "threshold":
			triggered = evaluateThresholdRule(rule, winEvents, now)
		case "distinct_count":
			triggered = evaluateDistinctCountRule(rule, winEvents, now)
		case "signature":
			triggered = evaluateSignatureRule(rule, winEvents, now)
		case "metric_sustained":
			triggered = evaluateMetricSustainedRule(rule, winMetrics, now)
		case "metric_delta":
			triggered = evaluateMetricDeltaRule(rule, winMetrics, winEvents, now)
		}

		for _, al := range triggered {
			candidates = append(candidates, al)
			if al.SourceIP != "" {
				// Record cross-layer IP evidence only if not spoofed behind an untrusted proxy
				if isTrustedIPCorrelationCandidate(al.SourceIP, winEvents) {
					if layerIPHits[al.SourceIP] == nil {
						layerIPHits[al.SourceIP] = make(map[string][]string)
					}
					srcLayer := ruleSourceLayer(rule)
					layerIPHits[al.SourceIP][srcLayer] = appendUnique(layerIPHits[al.SourceIP][srcLayer], rule.ID)
				}
			}
			if ruleSourceLayer(rule) == models.SourcePM2 {
				appAnomalyActive = true
				appAnomalyEvidence = append(appAnomalyEvidence, fmt.Sprintf("%s (%s)", rule.ID, al.Title))
			}
		}
	}

	// Evaluate correlation rules (e.g. COR-001)
	for _, rule := range rules {
		if !rule.Enabled || rule.RuleType != "correlation" {
			continue
		}
		windowStart := now.Add(-time.Duration(rule.TimeWindow) * time.Second)
		winEvents := filterEventsSince(events, windowStart)
		corrAlerts := evaluateCorrelationRule(rule, winEvents, layerIPHits, appAnomalyActive, appAnomalyEvidence, now)
		candidates = append(candidates, corrAlerts...)
	}

	persisted := make([]models.SecurityAlert, 0, len(candidates))
	for _, cand := range candidates {
		saved, isNew, err := e.repo.UpsertOrDeduplicateAlert(ctx, cand, dedupCooldown)
		if err != nil {
			e.logger.Error("failed to persist security alert", "rule_id", cand.RuleID, "error", err.Error())
			continue
		}
		if saved != nil {
			persisted = append(persisted, *saved)
			if isNew && e.broadcaster != nil {
				e.broadcaster.Publish(models.StreamMessage{
					Type:      "security_alert",
					Timestamp: now,
					Payload:   *saved,
				})
			}
			if isNew && e.notifier != nil && strings.EqualFold(saved.Severity, models.SeverityCritical) {
				e.notifier.NotifyCriticalEventAsync(models.TelemetryEvent{
					ID:         saved.ID,
					Source:     models.SourceSIEM,
					EventType:  saved.RuleID,
					SourceIP:   saved.SourceIP,
					Severity:   saved.Severity,
					OccurredAt: saved.LastSeen,
				}, saved.Description)
			}
		}
	}

	return persisted, nil
}

func evaluateThresholdRule(rule models.DetectionRule, events []models.TelemetryEvent, now time.Time) []models.SecurityAlert {
	targetSource := configString(rule.Configuration, "source", "")
	allowedTypes := configStringSet(rule.Configuration, "event_types")
	pathPrefixes := configStringSlice(rule.Configuration, "path_prefixes")
	statusCodes := configIntSet(rule.Configuration, "status_codes")

	type ipStats struct {
		count     int
		firstSeen time.Time
		lastSeen  time.Time
		samples   []string
	}
	byIP := make(map[string]*ipStats)

	for _, ev := range events {
		if targetSource != "" && ev.Source != targetSource {
			continue
		}
		if len(allowedTypes) > 0 && !allowedTypes[ev.EventType] {
			continue
		}
		if ev.SourceIP == "" {
			continue
		}

		// Optional HTTP path prefix & status code filters (e.g., WEB-002 authentication failure burst)
		if len(pathPrefixes) > 0 {
			ep, _ := ev.EventData["endpoint"].(string)
			matchedPath := false
			for _, pfx := range pathPrefixes {
				if strings.HasPrefix(strings.ToLower(ep), strings.ToLower(pfx)) {
					matchedPath = true
					break
				}
			}
			if !matchedPath {
				continue
			}
		}
		if len(statusCodes) > 0 {
			sc := intFromMap(ev.EventData, "status_code")
			if !statusCodes[sc] {
				continue
			}
		}

		st, ok := byIP[ev.SourceIP]
		if !ok {
			st = &ipStats{firstSeen: ev.OccurredAt, lastSeen: ev.OccurredAt}
			byIP[ev.SourceIP] = st
		}
		st.count++
		if ev.OccurredAt.Before(st.firstSeen) {
			st.firstSeen = ev.OccurredAt
		}
		if ev.OccurredAt.After(st.lastSeen) {
			st.lastSeen = ev.OccurredAt
		}
		if len(st.samples) < 5 {
			st.samples = append(st.samples, ev.ID)
		}
	}

	out := make([]models.SecurityAlert, 0)
	for ip, st := range byIP {
		if float64(st.count) >= rule.Threshold {
			out = append(out, models.SecurityAlert{
				RuleID:      rule.ID,
				Title:       fmt.Sprintf("%s from %s", rule.RuleName, ip),
				Description: fmt.Sprintf("Detected %d matching events from %s within %ds (threshold: %.0f).", st.count, ip, rule.TimeWindow, rule.Threshold),
				Severity:    rule.Severity,
				SourceIP:    ip,
				Status:      models.AlertStatusOpen,
				FirstSeen:   st.firstSeen,
				LastSeen:    st.lastSeen,
				EventCount:  st.count,
				CreatedAt:   now,
				Evidence: map[string]interface{}{
					"rule_id":         rule.ID,
					"observed_count":  st.count,
					"threshold":       rule.Threshold,
					"time_window_sec": rule.TimeWindow,
					"sample_events":   st.samples,
				},
			})
		}
	}
	return out
}

func evaluateDistinctCountRule(rule models.DetectionRule, events []models.TelemetryEvent, now time.Time) []models.SecurityAlert {
	targetSource := configString(rule.Configuration, "source", models.SourceFirewalld)
	allowedTypes := configStringSet(rule.Configuration, "event_types")
	distinctField := configString(rule.Configuration, "distinct_field", "destination_port")

	type ipScanStats struct {
		distinctValues map[string]bool
		eventCount     int
		firstSeen      time.Time
		lastSeen       time.Time
	}
	byIP := make(map[string]*ipScanStats)

	for _, ev := range events {
		if targetSource != "" && ev.Source != targetSource {
			continue
		}
		if len(allowedTypes) > 0 && !allowedTypes[ev.EventType] {
			continue
		}
		if ev.SourceIP == "" {
			continue
		}

		val := fmt.Sprintf("%v", ev.EventData[distinctField])
		if val == "" || val == "<nil>" || val == "0" {
			continue
		}

		st, ok := byIP[ev.SourceIP]
		if !ok {
			st = &ipScanStats{
				distinctValues: make(map[string]bool),
				firstSeen:      ev.OccurredAt,
				lastSeen:       ev.OccurredAt,
			}
			byIP[ev.SourceIP] = st
		}
		st.distinctValues[val] = true
		st.eventCount++
		if ev.OccurredAt.Before(st.firstSeen) {
			st.firstSeen = ev.OccurredAt
		}
		if ev.OccurredAt.After(st.lastSeen) {
			st.lastSeen = ev.OccurredAt
		}
	}

	out := make([]models.SecurityAlert, 0)
	for ip, st := range byIP {
		distinctCount := len(st.distinctValues)
		if float64(distinctCount) >= rule.Threshold {
			vals := make([]string, 0, distinctCount)
			for v := range st.distinctValues {
				vals = append(vals, v)
			}
			sort.Strings(vals)
			if len(vals) > 20 {
				vals = vals[:20]
			}
			out = append(out, models.SecurityAlert{
				RuleID:      rule.ID,
				Title:       fmt.Sprintf("%s from %s", rule.RuleName, ip),
				Description: fmt.Sprintf("Source IP %s probed %d distinct %s values within %ds (threshold: %.0f).", ip, distinctCount, distinctField, rule.TimeWindow, rule.Threshold),
				Severity:    rule.Severity,
				SourceIP:    ip,
				Status:      models.AlertStatusOpen,
				FirstSeen:   st.firstSeen,
				LastSeen:    st.lastSeen,
				EventCount:  st.eventCount,
				CreatedAt:   now,
				Evidence: map[string]interface{}{
					"rule_id":         rule.ID,
					"distinct_field":  distinctField,
					"distinct_count":  distinctCount,
					"distinct_sample": vals,
					"threshold":       rule.Threshold,
				},
			})
		}
	}
	return out
}

func evaluateSignatureRule(rule models.DetectionRule, events []models.TelemetryEvent, now time.Time) []models.SecurityAlert {
	targetSource := configString(rule.Configuration, "source", models.SourceNginx)
	signatures := configStringSlice(rule.Configuration, "signatures")

	type sigHit struct {
		count      int
		signatures map[string]bool
		endpoints  map[string]bool
		firstSeen  time.Time
		lastSeen   time.Time
	}
	byIP := make(map[string]*sigHit)

	for _, ev := range events {
		if targetSource != "" && ev.Source != targetSource {
			continue
		}
		if ev.SourceIP == "" {
			continue
		}

		endpoint, _ := ev.EventData["endpoint"].(string)
		ua, _ := ev.EventData["user_agent"].(string)
		matchedSig, _ := ev.EventData["matched_signature"].(string)
		suspiciousFlag, _ := ev.EventData["suspicious_indicator"].(bool)

		combined := strings.ToLower(endpoint + " " + ua)
		matched := ""
		if suspiciousFlag && matchedSig != "" {
			matched = matchedSig
		} else {
			for _, sig := range signatures {
				if sig != "" && strings.Contains(combined, strings.ToLower(sig)) {
					matched = sig
					break
				}
			}
		}

		if matched == "" {
			continue
		}

		hit, ok := byIP[ev.SourceIP]
		if !ok {
			hit = &sigHit{
				signatures: make(map[string]bool),
				endpoints:  make(map[string]bool),
				firstSeen:  ev.OccurredAt,
				lastSeen:   ev.OccurredAt,
			}
			byIP[ev.SourceIP] = hit
		}
		hit.count++
		hit.signatures[matched] = true
		if endpoint != "" && len(hit.endpoints) < 10 {
			hit.endpoints[endpoint] = true
		}
		if ev.OccurredAt.Before(hit.firstSeen) {
			hit.firstSeen = ev.OccurredAt
		}
		if ev.OccurredAt.After(hit.lastSeen) {
			hit.lastSeen = ev.OccurredAt
		}
	}

	out := make([]models.SecurityAlert, 0)
	for ip, hit := range byIP {
		if float64(hit.count) >= rule.Threshold {
			sigs := mapKeys(hit.signatures)
			eps := mapKeys(hit.endpoints)
			out = append(out, models.SecurityAlert{
				RuleID:      rule.ID,
				Title:       fmt.Sprintf("%s detected from %s", rule.RuleName, ip),
				Description: fmt.Sprintf("Detected %d request(s) matching suspicious signatures (%s) from %s.", hit.count, strings.Join(sigs, ", "), ip),
				Severity:    rule.Severity,
				SourceIP:    ip,
				Status:      models.AlertStatusOpen,
				FirstSeen:   hit.firstSeen,
				LastSeen:    hit.lastSeen,
				EventCount:  hit.count,
				CreatedAt:   now,
				Evidence: map[string]interface{}{
					"rule_id":            rule.ID,
					"matched_signatures": sigs,
					"target_endpoints":   eps,
					"event_count":        hit.count,
				},
			})
		}
	}
	return out
}

func evaluateMetricSustainedRule(rule models.DetectionRule, metrics []models.SystemMetric, now time.Time) []models.SecurityAlert {
	metricName := configString(rule.Configuration, "metric_name", "cpu_percent")
	minSamples := configInt(rule.Configuration, "min_samples", 1)
	if minSamples < 1 {
		minSamples = 1
	}

	type procStats struct {
		exceedCount int
		maxValue    float64
		firstSeen   time.Time
		lastSeen    time.Time
	}
	byProc := make(map[string]*procStats)

	for _, met := range metrics {
		if met.MetricName != metricName {
			continue
		}
		if met.MetricValue <= rule.Threshold {
			continue
		}
		procName, _ := met.Labels["process_name"].(string)
		if procName == "" {
			procName = "unknown-process"
		}
		st, ok := byProc[procName]
		if !ok {
			st = &procStats{
				maxValue:  met.MetricValue,
				firstSeen: met.RecordedAt,
				lastSeen:  met.RecordedAt,
			}
			byProc[procName] = st
		}
		st.exceedCount++
		if met.MetricValue > st.maxValue {
			st.maxValue = met.MetricValue
		}
		if met.RecordedAt.Before(st.firstSeen) {
			st.firstSeen = met.RecordedAt
		}
		if met.RecordedAt.After(st.lastSeen) {
			st.lastSeen = met.RecordedAt
		}
	}

	out := make([]models.SecurityAlert, 0)
	for procName, st := range byProc {
		if st.exceedCount >= minSamples {
			out = append(out, models.SecurityAlert{
				RuleID:      rule.ID,
				Title:       fmt.Sprintf("%s on process %s", rule.RuleName, procName),
				Description: fmt.Sprintf("Process %s recorded %s peak of %.1f%% (threshold: %.1f%%, samples: %d).", procName, metricName, st.maxValue, rule.Threshold, st.exceedCount),
				Severity:    rule.Severity,
				Status:      models.AlertStatusOpen,
				FirstSeen:   st.firstSeen,
				LastSeen:    st.lastSeen,
				EventCount:  st.exceedCount,
				CreatedAt:   now,
				Evidence: map[string]interface{}{
					"rule_id":       rule.ID,
					"process_name":  procName,
					"metric_name":   metricName,
					"peak_value":    st.maxValue,
					"threshold":     rule.Threshold,
					"samples_count": st.exceedCount,
				},
			})
		}
	}
	return out
}

func evaluateMetricDeltaRule(rule models.DetectionRule, metrics []models.SystemMetric, events []models.TelemetryEvent, now time.Time) []models.SecurityAlert {
	metricName := configString(rule.Configuration, "metric_name", "restart_count")

	type restartWindow struct {
		minVal    float64
		maxVal    float64
		samples   int
		firstSeen time.Time
		lastSeen  time.Time
	}
	byProc := make(map[string]*restartWindow)

	for _, met := range metrics {
		if met.MetricName != metricName {
			continue
		}
		procName, _ := met.Labels["process_name"].(string)
		if procName == "" {
			procName = "unknown-process"
		}
		rw, ok := byProc[procName]
		if !ok {
			rw = &restartWindow{
				minVal:    met.MetricValue,
				maxVal:    met.MetricValue,
				firstSeen: met.RecordedAt,
				lastSeen:  met.RecordedAt,
			}
			byProc[procName] = rw
		}
		rw.samples++
		if met.MetricValue < rw.minVal {
			rw.minVal = met.MetricValue
		}
		if met.MetricValue > rw.maxVal {
			rw.maxVal = met.MetricValue
		}
		if met.RecordedAt.Before(rw.firstSeen) {
			rw.firstSeen = met.RecordedAt
		}
		if met.RecordedAt.After(rw.lastSeen) {
			rw.lastSeen = met.RecordedAt
		}
	}

	// Also account for explicit PM2 process_restart events with restart_delta
	for _, ev := range events {
		if ev.Source != models.SourcePM2 {
			continue
		}
		procName, _ := ev.EventData["process_name"].(string)
		if procName == "" {
			continue
		}
		delta := floatFromMap(ev.EventData, "restart_delta")
		if delta <= 0 {
			continue
		}
		rw, ok := byProc[procName]
		if !ok {
			rw = &restartWindow{
				minVal:    0,
				maxVal:    delta,
				samples:   1,
				firstSeen: ev.OccurredAt,
				lastSeen:  ev.OccurredAt,
			}
			byProc[procName] = rw
		} else if delta > (rw.maxVal - rw.minVal) {
			rw.maxVal = rw.minVal + delta
		}
	}

	out := make([]models.SecurityAlert, 0)
	for procName, rw := range byProc {
		delta := rw.maxVal - rw.minVal
		if delta >= rule.Threshold {
			out = append(out, models.SecurityAlert{
				RuleID:      rule.ID,
				Title:       fmt.Sprintf("%s on process %s", rule.RuleName, procName),
				Description: fmt.Sprintf("Process %s restarted %.0f times within %ds (threshold: %.0f).", procName, delta, rule.TimeWindow, rule.Threshold),
				Severity:    rule.Severity,
				Status:      models.AlertStatusOpen,
				FirstSeen:   rw.firstSeen,
				LastSeen:    rw.lastSeen,
				EventCount:  int(delta),
				CreatedAt:   now,
				Evidence: map[string]interface{}{
					"rule_id":       rule.ID,
					"process_name":  procName,
					"restart_delta": delta,
					"threshold":     rule.Threshold,
				},
			})
		}
	}
	return out
}

func evaluateCorrelationRule(
	rule models.DetectionRule,
	events []models.TelemetryEvent,
	layerIPHits map[string]map[string][]string,
	appAnomalyActive bool,
	appAnomalyEvidence []string,
	now time.Time,
) []models.SecurityAlert {
	out := make([]models.SecurityAlert, 0)

	// 1. Multi-layer correlation by verified Source IP (e.g. Firewalld + Nginx anomalies from same IP)
	for ip, layers := range layerIPHits {
		if len(layers) >= int(rule.Threshold) {
			matchedRules := make([]string, 0)
			layerNames := make([]string, 0, len(layers))
			for layer, rIDs := range layers {
				layerNames = append(layerNames, layer)
				matchedRules = append(matchedRules, rIDs...)
			}
			sort.Strings(layerNames)
			sort.Strings(matchedRules)

			out = append(out, models.SecurityAlert{
				RuleID:      rule.ID,
				Title:       fmt.Sprintf("%s from %s", rule.RuleName, ip),
				Description: fmt.Sprintf("Correlated multi-layer anomalies across [%s] from verified source IP %s (triggered rules: %s).", strings.Join(layerNames, ", "), ip, strings.Join(matchedRules, ", ")),
				Severity:    rule.Severity,
				SourceIP:    ip,
				Status:      models.AlertStatusOpen,
				FirstSeen:   now,
				LastSeen:    now,
				EventCount:  len(matchedRules),
				CreatedAt:   now,
				Evidence: map[string]interface{}{
					"rule_id":                rule.ID,
					"correlated_layers":      layerNames,
					"triggered_rules":        matchedRules,
					"trusted_proxy_verified": true,
					"app_anomaly_active":     appAnomalyActive,
					"app_anomaly_details":    appAnomalyEvidence,
				},
			})
			continue
		}

		// 2. Also check if a single IP has both Firewalld blocks AND Nginx suspicious/auth error events
		// within the correlation window even if one layer was slightly below its individual threshold
		if hasVerifiedCrossLayerActivity(ip, events) {
			out = append(out, models.SecurityAlert{
				RuleID:      rule.ID,
				Title:       fmt.Sprintf("%s from %s", rule.RuleName, ip),
				Description: fmt.Sprintf("Source IP %s exhibited concurrent firewall rejections and suspicious web activity within %ds.", ip, rule.TimeWindow),
				Severity:    rule.Severity,
				SourceIP:    ip,
				Status:      models.AlertStatusOpen,
				FirstSeen:   now,
				LastSeen:    now,
				EventCount:  2,
				CreatedAt:   now,
				Evidence: map[string]interface{}{
					"rule_id":                rule.ID,
					"correlated_layers":      []string{models.SourceFirewalld, models.SourceNginx},
					"trusted_proxy_verified": true,
				},
			})
		}
	}

	return out
}

// isTrustedIPCorrelationCandidate verifies that Nginx events for `ip` were not received via an untrusted proxy.
func isTrustedIPCorrelationCandidate(ip string, events []models.TelemetryEvent) bool {
	for _, ev := range events {
		if ev.Source == models.SourceNginx && ev.SourceIP == ip {
			if verified, ok := ev.EventData["trusted_proxy_verified"].(bool); ok && !verified {
				return false
			}
		}
	}
	return true
}

func hasVerifiedCrossLayerActivity(ip string, events []models.TelemetryEvent) bool {
	if !isTrustedIPCorrelationCandidate(ip, events) {
		return false
	}
	fwCount := 0
	webSuspiciousCount := 0
	for _, ev := range events {
		if ev.SourceIP != ip {
			continue
		}
		switch ev.Source {
		case models.SourceFirewalld:
			fwCount++
		case models.SourceNginx:
			sc := intFromMap(ev.EventData, "status_code")
			susp, _ := ev.EventData["suspicious_indicator"].(bool)
			if susp || sc == 401 || sc == 403 || sc == 429 {
				webSuspiciousCount++
			}
		}
	}
	return fwCount >= 5 && webSuspiciousCount >= 5
}

func ruleSourceLayer(rule models.DetectionRule) string {
	if s := configString(rule.Configuration, "source", ""); s != "" {
		return s
	}
	switch {
	case strings.HasPrefix(rule.ID, "NET-"):
		return models.SourceFirewalld
	case strings.HasPrefix(rule.ID, "WEB-"):
		return models.SourceNginx
	case strings.HasPrefix(rule.ID, "APP-"):
		return models.SourcePM2
	default:
		return "multi"
	}
}

func filterEventsSince(events []models.TelemetryEvent, since time.Time) []models.TelemetryEvent {
	out := make([]models.TelemetryEvent, 0, len(events))
	for _, ev := range events {
		if !ev.OccurredAt.Before(since) {
			out = append(out, ev)
		}
	}
	return out
}

func filterMetricsSince(metrics []models.SystemMetric, since time.Time) []models.SystemMetric {
	out := make([]models.SystemMetric, 0, len(metrics))
	for _, met := range metrics {
		if !met.RecordedAt.Before(since) {
			out = append(out, met)
		}
	}
	return out
}

func configString(cfg map[string]interface{}, key, fallback string) string {
	if cfg == nil {
		return fallback
	}
	if v, ok := cfg[key].(string); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return fallback
}

func configInt(cfg map[string]interface{}, key string, fallback int) int {
	if cfg == nil {
		return fallback
	}
	switch v := cfg[key].(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	}
	return fallback
}

func configStringSlice(cfg map[string]interface{}, key string) []string {
	if cfg == nil {
		return nil
	}
	switch raw := cfg[key].(type) {
	case []string:
		return raw
	case []interface{}:
		out := make([]string, 0, len(raw))
		for _, item := range raw {
			if s, ok := item.(string); ok && s != "" {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

func configStringSet(cfg map[string]interface{}, key string) map[string]bool {
	slice := configStringSlice(cfg, key)
	if len(slice) == 0 {
		return nil
	}
	set := make(map[string]bool, len(slice))
	for _, s := range slice {
		set[s] = true
	}
	return set
}

func configIntSet(cfg map[string]interface{}, key string) map[int]bool {
	if cfg == nil {
		return nil
	}
	set := make(map[int]bool)
	switch raw := cfg[key].(type) {
	case []int:
		for _, v := range raw {
			set[v] = true
		}
	case []interface{}:
		for _, item := range raw {
			switch v := item.(type) {
			case int:
				set[v] = true
			case int64:
				set[int(v)] = true
			case float64:
				set[int(v)] = true
			}
		}
	}
	return set
}

func intFromMap(m map[string]interface{}, key string) int {
	if m == nil {
		return 0
	}
	switch v := m[key].(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	}
	return 0
}

func floatFromMap(m map[string]interface{}, key string) float64 {
	if m == nil {
		return 0
	}
	switch v := m[key].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case int64:
		return float64(v)
	}
	return 0
}

func mapKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func appendUnique(slice []string, item string) []string {
	for _, existing := range slice {
		if existing == item {
			return slice
		}
	}
	return append(slice, item)
}
