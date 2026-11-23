package collector

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gettalk/security/backend/internal/models"
)

// Collector defines the lifecycle and health contract for each independent telemetry collector.
type Collector interface {
	Name() string
	Source() string
	Start(ctx context.Context, sink EventSink) error
	Stop() error
	Health() models.CollectorHealth
}

// EventSink receives normalized telemetry events and metrics with bounded backpressure.
type EventSink interface {
	EmitEvent(event models.TelemetryEvent) bool
	EmitMetric(metric models.SystemMetric) bool
}

// PersistenceStore persists batches of telemetry events and metrics.
type PersistenceStore interface {
	SaveEventsBatch(ctx context.Context, events []models.TelemetryEvent) error
	SaveMetricsBatch(ctx context.Context, metrics []models.SystemMetric) error
}

// StreamBroadcaster broadcasts real-time telemetry to connected SSE clients.
type StreamBroadcaster interface {
	Publish(msg models.StreamMessage)
}

// EventNotifier dispatches asynchronous notifications for high/critical telemetry events.
type EventNotifier interface {
	NotifyCriticalEventAsync(ev models.TelemetryEvent, description string) bool
}

// Manager coordinates multiple independent collectors and bounded ingestion queues.
type Manager struct {
	collectors  []Collector
	store       PersistenceStore
	broadcaster StreamBroadcaster
	notifier    EventNotifier
	logger      *slog.Logger

	eventQueue    chan models.TelemetryEvent
	metricQueue   chan models.SystemMetric
	batchSize     int
	flushInterval time.Duration

	droppedEvents  atomic.Uint64
	droppedMetrics atomic.Uint64

	mu      sync.Mutex
	cancel  context.CancelFunc
	wg      sync.WaitGroup
	running bool
}

// NewManager creates a bounded collector manager with backpressure handling.
func NewManager(
	queueSize int,
	batchSize int,
	flushInterval time.Duration,
	store PersistenceStore,
	broadcaster StreamBroadcaster,
	logger *slog.Logger,
) *Manager {
	if queueSize < 16 {
		queueSize = 2048
	}
	if batchSize < 1 {
		batchSize = 100
	}
	if flushInterval <= 0 {
		flushInterval = time.Second
	}
	if logger == nil {
		logger = slog.Default()
	}

	return &Manager{
		collectors:    make([]Collector, 0, 3),
		store:         store,
		broadcaster:   broadcaster,
		logger:        logger,
		eventQueue:    make(chan models.TelemetryEvent, queueSize),
		metricQueue:   make(chan models.SystemMetric, queueSize),
		batchSize:     batchSize,
		flushInterval: flushInterval,
	}
}

// Register adds an independent collector to the manager.
func (m *Manager) Register(c Collector) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.collectors = append(m.collectors, c)
}

// SetEventNotifier attaches an asynchronous email notifier for high and critical severity events.
func (m *Manager) SetEventNotifier(n EventNotifier) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.notifier = n
}

// EmitEvent enqueues a normalized telemetry event without blocking if the queue is full.
func (m *Manager) EmitEvent(event models.TelemetryEvent) bool {
	if event.OccurredAt.IsZero() {
		event.OccurredAt = time.Now().UTC()
	}
	if event.CreatedAt.IsZero() {
		event.CreatedAt = time.Now().UTC()
	}
	if event.Severity == "" {
		event.Severity = models.SeverityInfo
	}

	select {
	case m.eventQueue <- event:
		if m.broadcaster != nil {
			m.broadcaster.Publish(models.StreamMessage{
				Type:      "telemetry_event",
				Timestamp: time.Now().UTC(),
				Payload:   event,
			})
		}
		if m.notifier != nil && (strings.EqualFold(event.Severity, models.SeverityCritical) || strings.EqualFold(event.Severity, models.SeverityHigh)) {
			evCopy := event
			if strings.TrimSpace(evCopy.ID) == "" {
				if strings.TrimSpace(evCopy.Fingerprint) != "" {
					evCopy.ID = evCopy.Fingerprint
				} else {
					evCopy.ID = fmt.Sprintf("%s-%s-%d", evCopy.Source, evCopy.EventType, evCopy.OccurredAt.Unix())
				}
			}
			desc := fmt.Sprintf("High/Critical %s event (%s) detected", evCopy.Source, evCopy.EventType)
			if rawDesc, ok := evCopy.EventData["description"].(string); ok && strings.TrimSpace(rawDesc) != "" {
				desc = rawDesc
			} else if ep, ok := evCopy.EventData["endpoint"].(string); ok && strings.TrimSpace(ep) != "" {
				desc = fmt.Sprintf("Suspicious request on %s (%s)", ep, evCopy.EventType)
			} else if procName, ok := evCopy.EventData["process_name"].(string); ok && strings.TrimSpace(procName) != "" {
				desc = fmt.Sprintf("PM2 process %s reported %s", procName, evCopy.EventType)
			}
			m.notifier.NotifyCriticalEventAsync(evCopy, desc)
		}
		return true
	default:
		m.droppedEvents.Add(1)
		return false
	}
}

// EmitMetric enqueues a normalized system metric without blocking if the queue is full.
func (m *Manager) EmitMetric(metric models.SystemMetric) bool {
	if metric.RecordedAt.IsZero() {
		metric.RecordedAt = time.Now().UTC()
	}

	select {
	case m.metricQueue <- metric:
		if m.broadcaster != nil {
			m.broadcaster.Publish(models.StreamMessage{
				Type:      "system_metric",
				Timestamp: time.Now().UTC(),
				Payload:   metric,
			})
		}
		return true
	default:
		m.droppedMetrics.Add(1)
		return false
	}
}

// Start launches the persistence workers and all registered collectors independently.
func (m *Manager) Start(parentCtx context.Context) error {
	m.mu.Lock()
	if m.running {
		m.mu.Unlock()
		return nil
	}
	ctx, cancel := context.WithCancel(parentCtx)
	m.cancel = cancel
	m.running = true
	collectors := append([]Collector(nil), m.collectors...)
	m.mu.Unlock()

	m.wg.Add(2)
	go m.eventFlushLoop(ctx)
	go m.metricFlushLoop(ctx)

	for _, c := range collectors {
		col := c
		m.wg.Add(1)
		go func() {
			defer m.wg.Done()
			defer func() {
				if r := recover(); r != nil {
					m.logger.Error("collector recovered from panic", "collector", col.Name(), "panic", r)
				}
			}()
			if err := col.Start(ctx, m); err != nil && ctx.Err() == nil {
				m.logger.Warn("collector exited with error", "collector", col.Name(), "error", err.Error())
			}
		}()
	}

	return nil
}

// Stop gracefully stops all collectors and flushes remaining queued telemetry.
func (m *Manager) Stop() error {
	m.mu.Lock()
	if !m.running {
		m.mu.Unlock()
		return nil
	}
	m.running = false
	cancel := m.cancel
	collectors := append([]Collector(nil), m.collectors...)
	m.mu.Unlock()

	if cancel != nil {
		cancel()
	}

	for _, c := range collectors {
		_ = c.Stop()
	}

	m.wg.Wait()
	return nil
}

// Health returns the health snapshot of all registered collectors.
func (m *Manager) Health() []models.CollectorHealth {
	m.mu.Lock()
	collectors := append([]Collector(nil), m.collectors...)
	m.mu.Unlock()

	out := make([]models.CollectorHealth, 0, len(collectors))
	for _, c := range collectors {
		out = append(out, c.Health())
	}
	return out
}

// DroppedCounts returns the number of events and metrics dropped due to backpressure.
func (m *Manager) DroppedCounts() (events uint64, metrics uint64) {
	return m.droppedEvents.Load(), m.droppedMetrics.Load()
}

func (m *Manager) eventFlushLoop(ctx context.Context) {
	defer m.wg.Done()
	ticker := time.NewTicker(m.flushInterval)
	defer ticker.Stop()

	batch := make([]models.TelemetryEvent, 0, m.batchSize)
	flush := func() {
		if len(batch) == 0 || m.store == nil {
			batch = batch[:0]
			return
		}
		flushCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := m.store.SaveEventsBatch(flushCtx, batch); err != nil {
			m.logger.Error("failed to persist telemetry event batch", "count", len(batch), "error", err.Error())
		}
		batch = batch[:0]
	}

	for {
		select {
		case <-ctx.Done():
			for {
				select {
				case ev := <-m.eventQueue:
					batch = append(batch, ev)
					if len(batch) >= m.batchSize {
						flush()
					}
				default:
					flush()
					return
				}
			}
		case ev := <-m.eventQueue:
			batch = append(batch, ev)
			if len(batch) >= m.batchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

func (m *Manager) metricFlushLoop(ctx context.Context) {
	defer m.wg.Done()
	ticker := time.NewTicker(m.flushInterval)
	defer ticker.Stop()

	batch := make([]models.SystemMetric, 0, m.batchSize)
	flush := func() {
		if len(batch) == 0 || m.store == nil {
			batch = batch[:0]
			return
		}
		flushCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := m.store.SaveMetricsBatch(flushCtx, batch); err != nil {
			m.logger.Error("failed to persist system metric batch", "count", len(batch), "error", err.Error())
		}
		batch = batch[:0]
	}

	for {
		select {
		case <-ctx.Done():
			for {
				select {
				case met := <-m.metricQueue:
					batch = append(batch, met)
					if len(batch) >= m.batchSize {
						flush()
					}
				default:
					flush()
					return
				}
			}
		case met := <-m.metricQueue:
			batch = append(batch, met)
			if len(batch) >= m.batchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

