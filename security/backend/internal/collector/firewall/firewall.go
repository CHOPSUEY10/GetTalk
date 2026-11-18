package firewall

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gettalk/security/backend/internal/collector"
	"github.com/gettalk/security/backend/internal/config"
	"github.com/gettalk/security/backend/internal/models"
)

var (
	kvRegex        = regexp.MustCompile(`\b([A-Z]+)=([^\s]+)`)
	isoPrefixRegex = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\s+(.*)$`)
	syslogTsRegex  = regexp.MustCompile(`^([A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2})\s+(.*)$`)
)

// StreamOpener abstracts journald or log stream opening for testability and cross-OS resilience.
type StreamOpener func(ctx context.Context) (io.ReadCloser, error)

// ParsedFirewallEvent holds structured fields extracted from a kernel/firewalld log line.
type ParsedFirewallEvent struct {
	Action          string
	EventType       string
	SourceIP        string
	DestinationIP   string
	SourcePort      int
	DestinationPort int
	Protocol        string
	InInterface     string
	OutInterface    string
	Zone            string
	Timestamp       time.Time
	Fingerprint     string
}

// ParseFirewallLine parses a journald/kernel netfilter firewalld log entry into normalized fields.
// Returns nil if the line is not a firewall drop/reject log entry.
func ParseFirewallLine(line string, now time.Time, dedupWindowSec int) *ParsedFirewallEvent {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return nil
	}

	upper := strings.ToUpper(trimmed)
	isReject := strings.Contains(upper, "REJECT")
	isDrop := strings.Contains(upper, "DROP")
	if !isReject && !isDrop {
		return nil
	}

	if !strings.Contains(upper, "SRC=") || !strings.Contains(upper, "DST=") {
		return nil
	}

	ts := now.UTC()
	if m := isoPrefixRegex.FindStringSubmatch(trimmed); len(m) == 3 {
		if parsedTs, err := time.Parse(time.RFC3339, normalizeISOOffset(m[1])); err == nil {
			ts = parsedTs.UTC()
		}
	} else if m := syslogTsRegex.FindStringSubmatch(trimmed); len(m) == 3 {
		if parsedTs, err := time.Parse("Jan _2 15:04:05", m[1]); err == nil {
			ts = time.Date(now.Year(), parsedTs.Month(), parsedTs.Day(), parsedTs.Hour(), parsedTs.Minute(), parsedTs.Second(), 0, time.UTC)
		}
	}

	fields := make(map[string]string, 12)
	for _, match := range kvRegex.FindAllStringSubmatch(trimmed, -1) {
		if len(match) == 3 {
			fields[match[1]] = match[2]
		}
	}

	srcIP := sanitizeIP(fields["SRC"])
	dstIP := sanitizeIP(fields["DST"])
	if srcIP == "" {
		return nil
	}

	proto := strings.ToUpper(strings.TrimSpace(fields["PROTO"]))
	if proto == "" {
		proto = "UNKNOWN"
	}

	spt, _ := strconv.Atoi(fields["SPT"])
	dpt, _ := strconv.Atoi(fields["DPT"])

	action := "DROP"
	eventType := "packet_drop"
	if isReject {
		action = "REJECT"
		eventType = "connection_reject"
	}

	zone := extractZone(trimmed)

	if dedupWindowSec <= 0 {
		dedupWindowSec = 5
	}
	bucket := ts.Unix() / int64(dedupWindowSec)
	fpInput := fmt.Sprintf("fw:%s:%s:%s:%d:%d:%s:%d", action, srcIP, dstIP, spt, dpt, proto, bucket)
	sum := sha256.Sum256([]byte(fpInput))
	fingerprint := hex.EncodeToString(sum[:16])

	return &ParsedFirewallEvent{
		Action:          action,
		EventType:       eventType,
		SourceIP:        srcIP,
		DestinationIP:   dstIP,
		SourcePort:      spt,
		DestinationPort: dpt,
		Protocol:        proto,
		InInterface:     sanitizeIdentifier(fields["IN"]),
		OutInterface:    sanitizeIdentifier(fields["OUT"]),
		Zone:            zone,
		Timestamp:       ts,
		Fingerprint:     fingerprint,
	}
}

func normalizeISOOffset(raw string) string {
	// Convert +0700 to +07:00 if needed for RFC3339 compatibility
	if len(raw) >= 5 {
		tail := raw[len(raw)-5:]
		if (tail[0] == '+' || tail[0] == '-') && !strings.Contains(tail, ":") {
			return raw[:len(raw)-5] + tail[:3] + ":" + tail[3:]
		}
	}
	return raw
}

func sanitizeIP(raw string) string {
	ip := net.ParseIP(strings.TrimSpace(raw))
	if ip == nil {
		return ""
	}
	return ip.String()
}

func sanitizeIdentifier(raw string) string {
	var b strings.Builder
	for _, r := range raw {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func extractZone(line string) string {
	for _, marker := range []string{"STATE_INVALID_DROP", "FINAL_REJECT", "HOST_REJECT", "ZONE_"} {
		if idx := strings.Index(strings.ToUpper(line), marker); idx != -1 {
			prefix := line[:idx]
			parts := strings.Fields(prefix)
			if len(parts) > 0 {
				last := strings.TrimSuffix(parts[len(parts)-1], ":")
				return sanitizeIdentifier(last)
			}
		}
	}
	return "default"
}

// Collector implements passive Firewalld telemetry collection via journald/kernel logs.
type Collector struct {
	cfg    config.FirewalldConfig
	opener StreamOpener

	mu              sync.RWMutex
	running         bool
	status          string
	lastError       string
	lastCollection  *time.Time
	eventsCollected atomic.Uint64
	errorsCount     atomic.Uint64
	cancel          context.CancelFunc

	freqMu     sync.Mutex
	ipEvents   map[string][]time.Time
	seenFinger map[string]time.Time
}

// NewCollector creates a new Firewalld telemetry collector.
func NewCollector(cfg config.FirewalldConfig, opener StreamOpener) *Collector {
	if opener == nil {
		opener = defaultJournaldStreamOpener
	}
	return &Collector{
		cfg:        cfg,
		opener:     opener,
		status:     "stopped",
		ipEvents:   make(map[string][]time.Time),
		seenFinger: make(map[string]time.Time),
	}
}

func defaultJournaldStreamOpener(ctx context.Context) (io.ReadCloser, error) {
	path, err := exec.LookPath("journalctl")
	if err != nil {
		return nil, fmt.Errorf("journalctl binary unavailable: %w", err)
	}
	cmd := exec.CommandContext(ctx, path, "-k", "-o", "short-iso", "-f", "-n", "0")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &cmdReadCloser{cmd: cmd, stdout: stdout}, nil
}

type cmdReadCloser struct {
	cmd    *exec.Cmd
	stdout io.ReadCloser
}

func (c *cmdReadCloser) Read(p []byte) (int, error) {
	return c.stdout.Read(p)
}

func (c *cmdReadCloser) Close() error {
	_ = c.stdout.Close()
	if c.cmd.Process != nil {
		_ = c.cmd.Process.Kill()
	}
	_ = c.cmd.Wait()
	return nil
}

func (c *Collector) Name() string {
	return "firewalld-collector"
}

func (c *Collector) Source() string {
	return models.SourceFirewalld
}

// Start begins streaming and parsing firewall events. If journald is unavailable on the host,
// it reports degraded/unavailable status without crashing other collectors.
func (c *Collector) Start(parentCtx context.Context, sink collector.EventSink) error {
	if !c.cfg.Enabled {
		c.setStatus(false, "stopped", "")
		return nil
	}

	ctx, cancel := context.WithCancel(parentCtx)
	c.mu.Lock()
	c.cancel = cancel
	c.running = true
	c.status = "healthy"
	c.mu.Unlock()

	defer func() {
		c.mu.Lock()
		c.running = false
		if c.status == "healthy" {
			c.status = "stopped"
		}
		c.mu.Unlock()
	}()

	rc, err := c.opener(ctx)
	if err != nil {
		c.errorsCount.Add(1)
		c.setStatus(false, "unavailable", err.Error())
		// Wait until context cancelled so collector health remains queryable.
		<-ctx.Done()
		return nil
	}
	defer rc.Close()

	scanner := bufio.NewScanner(rc)
	buf := make([]byte, 0, 16*1024)
	scanner.Buffer(buf, 64*1024)

	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return nil
		default:
		}
		c.ProcessLine(scanner.Text(), time.Now().UTC(), sink)
	}

	if err := scanner.Err(); err != nil && ctx.Err() == nil {
		c.errorsCount.Add(1)
		c.setStatus(false, "degraded", err.Error())
		return err
	}

	return nil
}

// ProcessLine parses a single log line and emits normalized TelemetryEvent and SystemMetric items.
func (c *Collector) ProcessLine(line string, now time.Time, sink collector.EventSink) bool {
	parsed := ParseFirewallLine(line, now, c.cfg.DedupWindowSeconds)
	if parsed == nil {
		return false
	}

	if c.isDuplicate(parsed.Fingerprint, now) {
		return false
	}

	freq := c.recordIPFrequency(parsed.SourceIP, parsed.Timestamp)

	severity := models.SeverityLow
	if freq >= 50 {
		severity = models.SeverityHigh
	} else if freq >= 15 {
		severity = models.SeverityMedium
	}

	event := models.TelemetryEvent{
		Source:        models.SourceFirewalld,
		EventType:     parsed.EventType,
		SourceIP:      parsed.SourceIP,
		DestinationIP: parsed.DestinationIP,
		Severity:      severity,
		Fingerprint:   parsed.Fingerprint,
		OccurredAt:    parsed.Timestamp,
		CreatedAt:     now.UTC(),
		EventData: map[string]interface{}{
			"action":                   parsed.Action,
			"protocol":                 parsed.Protocol,
			"source_port":              parsed.SourcePort,
			"destination_port":         parsed.DestinationPort,
			"in_interface":             parsed.InInterface,
			"out_interface":            parsed.OutInterface,
			"zone":                     parsed.Zone,
			"source_ip_freq_per_min":   freq,
		},
	}

	sink.EmitEvent(event)
	sink.EmitMetric(models.SystemMetric{
		Source:      models.SourceFirewalld,
		MetricName:  "firewall_ip_frequency_per_min",
		MetricValue: float64(freq),
		Labels: map[string]interface{}{
			"source_ip":        parsed.SourceIP,
			"action":           parsed.Action,
			"protocol":         parsed.Protocol,
			"destination_port": parsed.DestinationPort,
		},
		RecordedAt: parsed.Timestamp,
	})

	c.eventsCollected.Add(1)
	ts := now.UTC()
	c.mu.Lock()
	c.lastCollection = &ts
	c.status = "healthy"
	c.lastError = ""
	c.mu.Unlock()
	return true
}

func (c *Collector) isDuplicate(fingerprint string, now time.Time) bool {
	if fingerprint == "" {
		return false
	}
	c.freqMu.Lock()
	defer c.freqMu.Unlock()

	window := time.Duration(c.cfg.DedupWindowSeconds) * time.Second
	if window <= 0 {
		window = 5 * time.Second
	}

	if seenAt, exists := c.seenFinger[fingerprint]; exists && now.Sub(seenAt) <= window {
		return true
	}

	// Prune expired fingerprints periodically
	if len(c.seenFinger) > 4096 {
		for k, t := range c.seenFinger {
			if now.Sub(t) > window {
				delete(c.seenFinger, k)
			}
		}
	}

	c.seenFinger[fingerprint] = now
	return false
}

func (c *Collector) recordIPFrequency(ip string, ts time.Time) int {
	c.freqMu.Lock()
	defer c.freqMu.Unlock()

	cutoff := ts.Add(-time.Minute)
	history := c.ipEvents[ip]
	valid := history[:0]
	for _, t := range history {
		if !t.Before(cutoff) {
			valid = append(valid, t)
		}
	}
	valid = append(valid, ts)
	c.ipEvents[ip] = valid
	return len(valid)
}

func (c *Collector) Stop() error {
	c.mu.Lock()
	cancel := c.cancel
	c.running = false
	c.status = "stopped"
	c.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

func (c *Collector) Health() models.CollectorHealth {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return models.CollectorHealth{
		Name:            c.Name(),
		Source:          c.Source(),
		Status:          c.status,
		Running:         c.running,
		EventsCollected: c.eventsCollected.Load(),
		ErrorsCount:     c.errorsCount.Load(),
		LastCollection:  c.lastCollection,
		LastError:       c.lastError,
	}
}

func (c *Collector) setStatus(running bool, status, lastErr string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.running = running
	c.status = status
	c.lastError = lastErr
}

