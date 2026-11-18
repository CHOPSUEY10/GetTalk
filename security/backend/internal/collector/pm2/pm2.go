package pm2

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gettalk/security/backend/internal/collector"
	"github.com/gettalk/security/backend/internal/config"
	"github.com/gettalk/security/backend/internal/models"
)

// CommandRunner abstracts controlled execution of `pm2 jlist` with a strict context timeout.
type CommandRunner func(ctx context.Context) ([]byte, error)

// RawPM2Process matches the JSON schema emitted by `pm2 jlist`.
type RawPM2Process struct {
	Name   string      `json:"name"`
	PID    int         `json:"pid"`
	PMID   int         `json:"pm_id"`
	Monit  RawPM2Monit `json:"monit"`
	PM2Env RawPM2Env   `json:"pm2_env"`
}

type RawPM2Monit struct {
	Memory int64   `json:"memory"`
	CPU    float64 `json:"cpu"`
}

type RawPM2Env struct {
	Status      string `json:"status"`
	RestartTime int    `json:"restart_time"`
	PMUptime    int64  `json:"pm_uptime"`
	Instances   int    `json:"instances"`
	ExecMode    string `json:"exec_mode"`
}

// ParsePM2JList parses raw JSON output from `pm2 jlist` into normalized process summaries.
func ParsePM2JList(rawJSON []byte, now time.Time) ([]models.PM2ProcessSummary, error) {
	trimmed := strings.TrimSpace(string(rawJSON))
	if trimmed == "" {
		return nil, fmt.Errorf("empty pm2 jlist output")
	}

	// Locate JSON array start in case PM2 prints an informational banner before '['
	idx := strings.Index(trimmed, "[")
	if idx == -1 {
		return nil, fmt.Errorf("pm2 output does not contain a JSON array")
	}
	trimmed = trimmed[idx:]

	var rawList []RawPM2Process
	if err := json.Unmarshal([]byte(trimmed), &rawList); err != nil {
		return nil, fmt.Errorf("failed to parse pm2 jlist json: %w", err)
	}

	summaries := make([]models.PM2ProcessSummary, 0, len(rawList))
	nowMs := now.UnixMilli()

	for _, p := range rawList {
		uptimeSec := int64(0)
		if p.PM2Env.Status == "online" && p.PM2Env.PMUptime > 0 && nowMs > p.PM2Env.PMUptime {
			uptimeSec = (nowMs - p.PM2Env.PMUptime) / 1000
		}

		instances := p.PM2Env.Instances
		if instances <= 0 {
			instances = 1
		}

		execMode := p.PM2Env.ExecMode
		if execMode == "" {
			execMode = "fork_mode"
		}

		cpu := p.Monit.CPU
		if cpu < 0 {
			cpu = 0
		}
		mem := p.Monit.Memory
		if mem < 0 {
			mem = 0
		}

		summaries = append(summaries, models.PM2ProcessSummary{
			Name:         sanitizeProcessName(p.Name),
			PID:          p.PID,
			PM2ID:        p.PMID,
			Status:       strings.ToLower(strings.TrimSpace(p.PM2Env.Status)),
			CPUPercent:   cpu,
			MemoryBytes:  mem,
			RestartCount: p.PM2Env.RestartTime,
			UptimeSec:    uptimeSec,
			Instances:    instances,
			ExecMode:     execMode,
			RecordedAt:   now.UTC(),
		})
	}

	return summaries, nil
}

func sanitizeProcessName(name string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(name) {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' || r == ':' {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if out == "" {
		return "unknown-process"
	}
	return out
}

// Collector implements periodic PM2 process telemetry collection via controlled subprocess execution.
type Collector struct {
	cfg    config.PM2Config
	runner CommandRunner

	mu              sync.RWMutex
	running         bool
	status          string
	lastError       string
	lastCollection  *time.Time
	latestProcesses []models.PM2ProcessSummary
	prevRestarts    map[string]int
	prevStatuses    map[string]string
	eventsCollected atomic.Uint64
	errorsCount     atomic.Uint64
	cancel          context.CancelFunc
}

// NewCollector creates a new PM2 process collector.
func NewCollector(cfg config.PM2Config, runner CommandRunner) *Collector {
	c := &Collector{
		cfg:          cfg,
		runner:       runner,
		status:       "stopped",
		prevRestarts: make(map[string]int),
		prevStatuses: make(map[string]string),
	}
	if c.runner == nil {
		c.runner = c.defaultCommandRunner
	}
	return c
}

// defaultCommandRunner executes `pm2 jlist` directly via exec.CommandContext without a shell.
func (c *Collector) defaultCommandRunner(ctx context.Context) ([]byte, error) {
	bin := c.cfg.BinaryPath
	if bin == "" {
		bin = "pm2"
	}
	// Security enforcement (Section 5.C): never invoke a shell or accept dynamic arguments.
	path, err := exec.LookPath(bin)
	if err != nil {
		return nil, fmt.Errorf("pm2 binary not found: %w", err)
	}
	cmd := exec.CommandContext(ctx, path, "jlist")
	return cmd.Output()
}

func (c *Collector) Name() string {
	return "pm2-collector"
}

func (c *Collector) Source() string {
	return models.SourcePM2
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

	interval := time.Duration(c.cfg.IntervalSeconds) * time.Second
	if interval < time.Second {
		interval = 5 * time.Second
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	c.CollectOnce(ctx, sink)

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			c.CollectOnce(ctx, sink)
		}
	}
}

// CollectOnce runs a single PM2 metric collection cycle with timeout protection.
func (c *Collector) CollectOnce(parentCtx context.Context, sink collector.EventSink) {
	timeout := time.Duration(c.cfg.CommandTimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 4 * time.Second
	}
	cmdCtx, cancel := context.WithTimeout(parentCtx, timeout)
	defer cancel()

	raw, err := c.runner(cmdCtx)
	if err != nil {
		c.errorsCount.Add(1)
		c.setStatus(true, "unavailable", err.Error())
		return
	}

	now := time.Now().UTC()
	processes, err := ParsePM2JList(raw, now)
	if err != nil {
		c.errorsCount.Add(1)
		c.setStatus(true, "degraded", err.Error())
		return
	}

	memLimit := c.cfg.DefaultMemoryLimitBytes
	if memLimit <= 0 {
		memLimit = 1073741824 // 1 GiB default
	}

	c.mu.Lock()
	c.latestProcesses = processes
	c.lastCollection = &now
	c.status = "healthy"
	c.lastError = ""

	for _, proc := range processes {
		procKey := fmt.Sprintf("%s:%d", proc.Name, proc.PM2ID)
		prevRestart, hadPrev := c.prevRestarts[procKey]
		prevStatus := c.prevStatuses[procKey]
		c.prevRestarts[procKey] = proc.RestartCount
		c.prevStatuses[procKey] = proc.Status

		labels := map[string]interface{}{
			"process_name": proc.Name,
			"pm_id":        proc.PM2ID,
			"pid":          proc.PID,
			"status":       proc.Status,
			"instances":    proc.Instances,
			"exec_mode":    proc.ExecMode,
		}

		memPercent := (float64(proc.MemoryBytes) / float64(memLimit)) * 100.0

		sink.EmitMetric(models.SystemMetric{
			Source:      models.SourcePM2,
			MetricName:  "cpu_percent",
			MetricValue: proc.CPUPercent,
			Labels:      labels,
			RecordedAt:  now,
		})
		sink.EmitMetric(models.SystemMetric{
			Source:      models.SourcePM2,
			MetricName:  "memory_bytes",
			MetricValue: float64(proc.MemoryBytes),
			Labels:      labels,
			RecordedAt:  now,
		})
		sink.EmitMetric(models.SystemMetric{
			Source:      models.SourcePM2,
			MetricName:  "memory_percent",
			MetricValue: memPercent,
			Labels:      labels,
			RecordedAt:  now,
		})
		sink.EmitMetric(models.SystemMetric{
			Source:      models.SourcePM2,
			MetricName:  "restart_count",
			MetricValue: float64(proc.RestartCount),
			Labels:      labels,
			RecordedAt:  now,
		})
		sink.EmitMetric(models.SystemMetric{
			Source:      models.SourcePM2,
			MetricName:  "uptime_seconds",
			MetricValue: float64(proc.UptimeSec),
			Labels:      labels,
			RecordedAt:  now,
		})

		// Emit telemetry events when process restarts, terminates, or becomes unhealthy
		restartDelta := 0
		if hadPrev && proc.RestartCount > prevRestart {
			restartDelta = proc.RestartCount - prevRestart
		}

		eventType := "process_status"
		severity := models.SeverityInfo
		if proc.Status != "online" {
			eventType = "process_unhealthy"
			severity = models.SeverityHigh
		} else if restartDelta > 0 {
			eventType = "process_restart"
			severity = models.SeverityMedium
		} else if proc.CPUPercent > 80.0 || memPercent > 80.0 {
			severity = models.SeverityMedium
		}

		if eventType != "process_status" || prevStatus != proc.Status || severity != models.SeverityInfo {
			fpSum := sha256.Sum256(fmt.Appendf(nil, "pm2:%s:%s:%d:%d", procKey, eventType, proc.RestartCount, now.Unix()/5))
			sink.EmitEvent(models.TelemetryEvent{
				Source:      models.SourcePM2,
				EventType:   eventType,
				Severity:    severity,
				Fingerprint: hex.EncodeToString(fpSum[:16]),
				OccurredAt:  now,
				CreatedAt:   now,
				EventData: map[string]interface{}{
					"process_name":   proc.Name,
					"pid":            proc.PID,
					"pm_id":          proc.PM2ID,
					"status":         proc.Status,
					"cpu_percent":    proc.CPUPercent,
					"memory_bytes":   proc.MemoryBytes,
					"memory_percent": memPercent,
					"restart_count":  proc.RestartCount,
					"restart_delta":  restartDelta,
					"uptime_seconds": proc.UptimeSec,
					"instances":      proc.Instances,
					"exec_mode":      proc.ExecMode,
				},
			})
		}

		c.eventsCollected.Add(1)
	}
	c.mu.Unlock()
}

// LatestProcesses returns the most recently collected PM2 process snapshot.
func (c *Collector) LatestProcesses() []models.PM2ProcessSummary {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make([]models.PM2ProcessSummary, len(c.latestProcesses))
	copy(out, c.latestProcesses)
	return out
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
