package nginx

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
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

// CheckpointStore persists and retrieves log reading offsets so log rotation and restarts recover safely.
type CheckpointStore interface {
	GetCheckpoint(ctx context.Context, sourceKey string) (*models.IngestionCheckpoint, error)
	SaveCheckpoint(ctx context.Context, cp models.IngestionCheckpoint) error
}

var (
	// Combined Nginx log format fallback regex
	combinedLogRegex = regexp.MustCompile(`^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([A-Z]+)\s+([^"\s]+)\s+[^"]*"\s+(\d{3})\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"`)
	// Nginx error log regex: 2026/11/18 09:15:02 [error] 1234#1234: *5678 message, client: 1.2.3.4, server: ...
	errorLogRegex = regexp.MustCompile(`^(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2})\s+\[([a-z]+)\]\s+([^:]+):\s+(.*)$`)
	clientIPRegex = regexp.MustCompile(`client:\s*([0-9a-fA-F.:]+)`)

	sensitiveQueryParamRegex = regexp.MustCompile(`(?i)([?&](?:token|access_token|refresh_token|password|passwd|secret|key|otp|code|session|sid)=)[^&#\s]*`)
	suspiciousIndicators     = []string{
		"../", "..%2f", "..%5c", "/etc/passwd", "/.env", "/.git/",
		"union select", "select%20", "<script", "%3cscript", "jndi:ldap",
		"/wp-admin", "/phpmyadmin", "cmd.exe", "/bin/sh",
	}
)

// JSONAccessLogEntry maps structured JSON access log lines emitted by Nginx.
type JSONAccessLogEntry struct {
	Timestamp            string      `json:"timestamp"`
	RemoteAddr           string      `json:"remote_addr"`
	XForwardedFor        string      `json:"x_forwarded_for"`
	Host                 string      `json:"host"`
	RequestMethod        string      `json:"request_method"`
	RequestURI           string      `json:"request_uri"`
	Status               int         `json:"status"`
	BodyBytesSent        int64       `json:"body_bytes_sent"`
	RequestTime          interface{} `json:"request_time"`
	UpstreamResponseTime interface{} `json:"upstream_response_time"`
	HTTPReferrer         string      `json:"http_referrer"`
	HTTPUserAgent        string      `json:"http_user_agent"`
	ServerProtocol       string      `json:"server_protocol"`
}

// ParsedAccessEvent represents a normalized Nginx HTTP access log event.
type ParsedAccessEvent struct {
	SourceIP             string
	ProxyIP              string
	TrustedProxyVerified bool
	Method               string
	Endpoint             string
	StatusCode           int
	BodyBytesSent        int64
	RequestDurationMs    float64
	UpstreamDurationMs   float64
	UserAgent            string
	Host                 string
	SuspiciousIndicator  bool
	MatchedSignature     string
	Timestamp            time.Time
	Fingerprint          string
}

// ParsedErrorEvent represents a normalized Nginx error log event.
type ParsedErrorEvent struct {
	Level       string
	ClientIP    string
	Message     string
	Timestamp   time.Time
	Fingerprint string
}

// ParseAccessLogLine parses either a structured JSON Nginx access log line or a standard combined log line.
func ParseAccessLogLine(line string, trustedProxies map[string]bool, trustReverseProxy bool, now time.Time) (*ParsedAccessEvent, error) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return nil, nil
	}

	if strings.HasPrefix(trimmed, "{") {
		return parseJSONAccessLine(trimmed, trustedProxies, trustReverseProxy, now)
	}
	return parseCombinedAccessLine(trimmed, now)
}

func parseJSONAccessLine(line string, trustedProxies map[string]bool, trustReverseProxy bool, now time.Time) (*ParsedAccessEvent, error) {
	var raw JSONAccessLogEntry
	if err := json.Unmarshal([]byte(line), &raw); err != nil {
		return nil, fmt.Errorf("invalid nginx json access log: %w", err)
	}

	if raw.Status <= 0 || raw.RequestMethod == "" {
		return nil, fmt.Errorf("incomplete nginx json log entry")
	}

	ts := now.UTC()
	if raw.Timestamp != "" {
		if parsed, err := time.Parse(time.RFC3339, raw.Timestamp); err == nil {
			ts = parsed.UTC()
		}
	}

	remoteIP := cleanIP(raw.RemoteAddr)
	clientIP := remoteIP
	trustedVerified := false

	if trustReverseProxy && remoteIP != "" && (len(trustedProxies) == 0 || trustedProxies[remoteIP]) {
		trustedVerified = true
		if raw.XForwardedFor != "" && raw.XForwardedFor != "-" {
			parts := strings.Split(raw.XForwardedFor, ",")
			if first := cleanIP(parts[0]); first != "" {
				clientIP = first
			}
		}
	}

	method := sanitizeControlChars(strings.ToUpper(strings.TrimSpace(raw.RequestMethod)), 16)
	endpoint := SanitizeURI(raw.RequestURI)
	userAgent := sanitizeControlChars(raw.HTTPUserAgent, 256)
	host := sanitizeControlChars(raw.Host, 128)

	reqDurMs := parseSecondsToMs(raw.RequestTime)
	upDurMs := parseSecondsToMs(raw.UpstreamResponseTime)

	suspicious, sig := detectSuspiciousIndicator(raw.RequestURI, userAgent)

	fp := computeLogFingerprint("nginx_access", line, ts)

	return &ParsedAccessEvent{
		SourceIP:             clientIP,
		ProxyIP:              remoteIP,
		TrustedProxyVerified: trustedVerified,
		Method:               method,
		Endpoint:             endpoint,
		StatusCode:           raw.Status,
		BodyBytesSent:        raw.BodyBytesSent,
		RequestDurationMs:    reqDurMs,
		UpstreamDurationMs:   upDurMs,
		UserAgent:            userAgent,
		Host:                 host,
		SuspiciousIndicator:  suspicious,
		MatchedSignature:     sig,
		Timestamp:            ts,
		Fingerprint:          fp,
	}, nil
}

func parseCombinedAccessLine(line string, now time.Time) (*ParsedAccessEvent, error) {
	m := combinedLogRegex.FindStringSubmatch(line)
	if len(m) != 9 {
		return nil, fmt.Errorf("unrecognized nginx access log format")
	}

	clientIP := cleanIP(m[1])
	ts := now.UTC()
	if parsed, err := time.Parse("02/Jan/2006:15:04:05 -0700", m[2]); err == nil {
		ts = parsed.UTC()
	}

	method := sanitizeControlChars(strings.ToUpper(m[3]), 16)
	rawURI := m[4]
	endpoint := SanitizeURI(rawURI)
	status, _ := strconv.Atoi(m[5])
	bytesSent, _ := strconv.ParseInt(m[6], 10, 64)
	userAgent := sanitizeControlChars(m[8], 256)

	suspicious, sig := detectSuspiciousIndicator(rawURI, userAgent)
	fp := computeLogFingerprint("nginx_access", line, ts)

	return &ParsedAccessEvent{
		SourceIP:             clientIP,
		ProxyIP:              clientIP,
		TrustedProxyVerified: true,
		Method:               method,
		Endpoint:             endpoint,
		StatusCode:           status,
		BodyBytesSent:        bytesSent,
		RequestDurationMs:    0,
		UpstreamDurationMs:   0,
		UserAgent:            userAgent,
		SuspiciousIndicator:  suspicious,
		MatchedSignature:     sig,
		Timestamp:            ts,
		Fingerprint:          fp,
	}, nil
}

// ParseErrorLogLine parses an Nginx error.log entry.
func ParseErrorLogLine(line string, now time.Time) *ParsedErrorEvent {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return nil
	}

	m := errorLogRegex.FindStringSubmatch(trimmed)
	if len(m) != 5 {
		return nil
	}

	ts := now.UTC()
	if parsed, err := time.Parse("2006/01/02 15:04:05", m[1]); err == nil {
		ts = parsed.UTC()
	}

	level := strings.ToLower(m[2])
	msgBody := sanitizeControlChars(m[4], 512)
	msgBody = sensitiveQueryParamRegex.ReplaceAllString(msgBody, "${1}[REDACTED]")

	clientIP := ""
	if cm := clientIPRegex.FindStringSubmatch(trimmed); len(cm) == 2 {
		clientIP = cleanIP(cm[1])
	}

	fp := computeLogFingerprint("nginx_error", trimmed, ts)

	return &ParsedErrorEvent{
		Level:       level,
		ClientIP:    clientIP,
		Message:     msgBody,
		Timestamp:   ts,
		Fingerprint: fp,
	}
}

// SanitizeURI strips control characters, sensitive query values, and truncates long URIs.
func SanitizeURI(uri string) string {
	cleaned := sanitizeControlChars(strings.TrimSpace(uri), 512)
	if cleaned == "" {
		return "/"
	}
	cleaned = sensitiveQueryParamRegex.ReplaceAllString(cleaned, "${1}[REDACTED]")
	return cleaned
}

func sanitizeControlChars(input string, maxLen int) string {
	var b strings.Builder
	count := 0
	for _, r := range input {
		if count >= maxLen {
			break
		}
		if r >= 32 && r != 127 {
			b.WriteRune(r)
			count++
		}
	}
	return b.String()
}

func cleanIP(raw string) string {
	ip := net.ParseIP(strings.TrimSpace(raw))
	if ip == nil {
		return ""
	}
	return ip.String()
}

func parseSecondsToMs(val interface{}) float64 {
	switch v := val.(type) {
	case float64:
		if v < 0 {
			return 0
		}
		return v * 1000.0
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" || trimmed == "-" {
			return 0
		}
		// If multiple upstream times "0.002, 0.004", take the first valid
		parts := strings.Split(trimmed, ",")
		if f, err := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64); err == nil && f >= 0 {
			return f * 1000.0
		}
	}
	return 0
}

func detectSuspiciousIndicator(rawURI, userAgent string) (bool, string) {
	combined := strings.ToLower(rawURI + " " + userAgent)
	for _, sig := range suspiciousIndicators {
		if strings.Contains(combined, sig) {
			return true, sig
		}
	}
	return false, ""
}

func computeLogFingerprint(prefix, line string, ts time.Time) string {
	sum := sha256.Sum256(fmt.Appendf(nil, "%s:%d:%s", prefix, ts.UnixNano(), line))
	return hex.EncodeToString(sum[:16])
}

// Collector implements incremental, rotation-safe Nginx access and error log collection.
type Collector struct {
	cfg            config.NginxConfig
	trustedProxies map[string]bool
	checkpoints    CheckpointStore

	mu              sync.RWMutex
	running         bool
	status          string
	lastError       string
	lastCollection  *time.Time
	eventsCollected atomic.Uint64
	errorsCount     atomic.Uint64
	cancel          context.CancelFunc

	freqMu  sync.Mutex
	ipFreqs map[string][]time.Time
}

// NewCollector creates a new Nginx incremental log collector.
func NewCollector(cfg config.NginxConfig, trustedProxyList []string, cpStore CheckpointStore) *Collector {
	proxies := make(map[string]bool, len(trustedProxyList))
	for _, p := range trustedProxyList {
		if ip := cleanIP(p); ip != "" {
			proxies[ip] = true
		}
	}
	return &Collector{
		cfg:            cfg,
		trustedProxies: proxies,
		checkpoints:    cpStore,
		status:         "stopped",
		ipFreqs:        make(map[string][]time.Time),
	}
}

func (c *Collector) Name() string {
	return "nginx-collector"
}

func (c *Collector) Source() string {
	return models.SourceNginx
}

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

	pollInterval := time.Duration(c.cfg.PollIntervalMs) * time.Millisecond
	if pollInterval < 50*time.Millisecond {
		pollInterval = 500 * time.Millisecond
	}

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	// Perform initial incremental read immediately
	c.ReadOnce(ctx, sink)

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			c.ReadOnce(ctx, sink)
		}
	}
}

// ReadOnce performs a single incremental read pass over configured access and error logs.
func (c *Collector) ReadOnce(ctx context.Context, sink collector.EventSink) {
	accessErr := c.readLogFileIncremental(ctx, c.cfg.AccessLogPath, c.checkpointKey("access"), true, sink)
	errorErr := c.readLogFileIncremental(ctx, c.cfg.ErrorLogPath, c.checkpointKey("error"), false, sink)

	if accessErr != nil && errorErr != nil {
		c.setStatus(true, "unavailable", accessErr.Error())
	} else if accessErr != nil {
		c.setStatus(true, "degraded", accessErr.Error())
	} else {
		c.mu.Lock()
		c.status = "healthy"
		c.lastError = ""
		c.mu.Unlock()
	}
}

func (c *Collector) checkpointKey(kind string) string {
	prefix := c.cfg.CheckpointKeyPrefix
	if prefix == "" {
		prefix = "nginx"
	}
	return fmt.Sprintf("%s:%s", prefix, kind)
}

func (c *Collector) readLogFileIncremental(
	ctx context.Context,
	filePath string,
	cpKey string,
	isAccessLog bool,
	sink collector.EventSink,
) error {
	if strings.TrimSpace(filePath) == "" {
		return nil
	}

	stat, err := os.Stat(filePath)
	if err != nil {
		return err
	}

	file, err := os.Open(filePath)
	if err != nil {
		c.errorsCount.Add(1)
		return err
	}
	defer file.Close()

	// Load saved checkpoint
	var offset int64
	var savedHeaderHash string
	if c.checkpoints != nil {
		if cp, err := c.checkpoints.GetCheckpoint(ctx, cpKey); err == nil && cp != nil {
			offset = cp.ByteOffset
			if h, ok := cp.Metadata["header_hash"].(string); ok {
				savedHeaderHash = h
			}
		}
	}

	currentHeaderHash := computeHeaderHash(file)

	// Detect log rotation or truncation:
	// 1. File size is smaller than the saved byte offset, OR
	// 2. The header hash of the first line changed (file was replaced by logrotate).
	if stat.Size() < offset || (offset > 0 && savedHeaderHash != "" && currentHeaderHash != "" && savedHeaderHash != currentHeaderHash) {
		offset = 0
	}

	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return err
	}

	reader := bufio.NewReaderSize(file, 32*1024)
	bytesRead := int64(0)
	now := time.Now().UTC()

	for {
		line, err := reader.ReadString('\n')
		if len(line) > 0 {
			// Only advance checkpoint for complete newline-terminated lines to avoid partial line loss
			if strings.HasSuffix(line, "\n") {
				bytesRead += int64(len(line))
				if isAccessLog {
					c.processAccessLine(line, now, sink)
				} else {
					c.processErrorLine(line, now, sink)
				}
			}
		}
		if err != nil {
			if err == io.EOF {
				break
			}
			c.errorsCount.Add(1)
			return err
		}
	}

	newOffset := offset + bytesRead
	if bytesRead > 0 || (offset == 0 && currentHeaderHash != savedHeaderHash) {
		if currentHeaderHash == "" {
			currentHeaderHash = computeHeaderHash(file)
		}
		if c.checkpoints != nil {
			_ = c.checkpoints.SaveCheckpoint(ctx, models.IngestionCheckpoint{
				SourceKey:     cpKey,
				ByteOffset:    newOffset,
				LastTimestamp: &now,
				Metadata: map[string]interface{}{
					"header_hash": currentHeaderHash,
					"file_path":   filePath,
				},
				UpdatedAt: now,
			})
		}
	}

	return nil
}

func computeHeaderHash(file *os.File) string {
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return ""
	}
	buf := make([]byte, 256)
	n, err := file.Read(buf)
	if err != nil || n == 0 {
		return ""
	}
	// Hash up to first newline or 256 bytes to uniquely identify the rotated file instance
	for i := 0; i < n; i++ {
		if buf[i] == '\n' {
			n = i + 1
			break
		}
	}
	sum := sha256.Sum256(buf[:n])
	return hex.EncodeToString(sum[:8])
}

func (c *Collector) processAccessLine(line string, now time.Time, sink collector.EventSink) {
	parsed, err := ParseAccessLogLine(line, c.trustedProxies, c.cfg.TrustedReverseProxy, now)
	if err != nil {
		c.errorsCount.Add(1)
		return
	}
	if parsed == nil {
		return
	}

	freq := c.recordIPFrequency(parsed.SourceIP, parsed.Timestamp)

	// Per Section 5.B: Never interpret HTTP status codes alone as definitive proof of an attack.
	// Individual HTTP requests use informational/low severity unless suspicious payload indicators match.
	severity := models.SeverityInfo
	if parsed.SuspiciousIndicator {
		severity = models.SeverityHigh
	} else if parsed.StatusCode >= 500 {
		severity = models.SeverityLow
	}

	event := models.TelemetryEvent{
		Source:      models.SourceNginx,
		EventType:   "http_request",
		SourceIP:    parsed.SourceIP,
		Severity:    severity,
		Fingerprint: parsed.Fingerprint,
		OccurredAt:  parsed.Timestamp,
		CreatedAt:   now,
		EventData: map[string]interface{}{
			"method":                 parsed.Method,
			"endpoint":               parsed.Endpoint,
			"status_code":            parsed.StatusCode,
			"body_bytes_sent":        parsed.BodyBytesSent,
			"request_duration_ms":    parsed.RequestDurationMs,
			"upstream_duration_ms":   parsed.UpstreamDurationMs,
			"user_agent":             parsed.UserAgent,
			"host":                   parsed.Host,
			"proxy_ip":               parsed.ProxyIP,
			"trusted_proxy_verified": parsed.TrustedProxyVerified,
			"request_freq_per_min":   freq,
			"suspicious_indicator":   parsed.SuspiciousIndicator,
			"matched_signature":      parsed.MatchedSignature,
		},
	}

	sink.EmitEvent(event)
	sink.EmitMetric(models.SystemMetric{
		Source:      models.SourceNginx,
		MetricName:  "http_request_duration_ms",
		MetricValue: parsed.RequestDurationMs,
		Labels: map[string]interface{}{
			"method":      parsed.Method,
			"endpoint":    parsed.Endpoint,
			"status_code": parsed.StatusCode,
			"source_ip":   parsed.SourceIP,
		},
		RecordedAt: parsed.Timestamp,
	})

	c.eventsCollected.Add(1)
	c.mu.Lock()
	c.lastCollection = &now
	c.mu.Unlock()
}

func (c *Collector) processErrorLine(line string, now time.Time, sink collector.EventSink) {
	parsed := ParseErrorLogLine(line, now)
	if parsed == nil {
		return
	}

	severity := models.SeverityLow
	if parsed.Level == "crit" || parsed.Level == "alert" || parsed.Level == "emerg" {
		severity = models.SeverityHigh
	} else if parsed.Level == "error" {
		severity = models.SeverityMedium
	}

	event := models.TelemetryEvent{
		Source:      models.SourceNginx,
		EventType:   "nginx_error",
		SourceIP:    parsed.ClientIP,
		Severity:    severity,
		Fingerprint: parsed.Fingerprint,
		OccurredAt:  parsed.Timestamp,
		CreatedAt:   now,
		EventData: map[string]interface{}{
			"level":   parsed.Level,
			"message": parsed.Message,
		},
	}

	sink.EmitEvent(event)
	c.eventsCollected.Add(1)
	c.mu.Lock()
	c.lastCollection = &now
	c.mu.Unlock()
}

func (c *Collector) recordIPFrequency(ip string, ts time.Time) int {
	if ip == "" {
		return 0
	}
	c.freqMu.Lock()
	defer c.freqMu.Unlock()

	cutoff := ts.Add(-time.Minute)
	history := c.ipFreqs[ip]
	valid := history[:0]
	for _, t := range history {
		if !t.Before(cutoff) {
			valid = append(valid, t)
		}
	}
	valid = append(valid, ts)
	c.ipFreqs[ip] = valid
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
