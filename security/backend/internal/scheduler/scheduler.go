package scheduler

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/gettalk/security/backend/internal/config"
	"github.com/gettalk/security/backend/internal/detection"
	"github.com/gettalk/security/backend/internal/repository"
)

// Scheduler manages periodic IDS detection evaluation and configurable data retention cleanup.
type Scheduler struct {
	detCfg config.DetectionConfig
	retCfg config.RetentionConfig
	engine *detection.Engine
	repo   repository.Repository
	logger *slog.Logger

	mu      sync.RWMutex
	running bool
	cancel  context.CancelFunc
	wg      sync.WaitGroup
}

// NewScheduler creates a new background scheduler for IDS rule evaluation and retention cleanup.
func NewScheduler(
	detCfg config.DetectionConfig,
	retCfg config.RetentionConfig,
	engine *detection.Engine,
	repo repository.Repository,
	logger *slog.Logger,
) *Scheduler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Scheduler{
		detCfg: detCfg,
		retCfg: retCfg,
		engine: engine,
		repo:   repo,
		logger: logger,
	}
}

// Start begins periodic detection evaluation and retention cleanup loops.
func (s *Scheduler) Start(parentCtx context.Context) {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(parentCtx)
	s.cancel = cancel
	s.running = true
	s.mu.Unlock()

	if s.engine != nil && s.detCfg.Enabled {
		s.wg.Add(1)
		go s.detectionLoop(ctx)
	}

	if s.repo != nil {
		s.wg.Add(1)
		go s.retentionLoop(ctx)
	}
}

// Stop halts all scheduled background loops gracefully.
func (s *Scheduler) Stop() {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return
	}
	s.running = false
	cancel := s.cancel
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	s.wg.Wait()
}

// UpdateRetention updates the configurable retention settings at runtime.
func (s *Scheduler) UpdateRetention(ret config.RetentionConfig) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.retCfg = ret
}

// GetRetention returns the active retention policy configuration.
func (s *Scheduler) GetRetention() config.RetentionConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.retCfg
}

func (s *Scheduler) detectionLoop(ctx context.Context) {
	defer s.wg.Done()
	interval := time.Duration(s.detCfg.EvaluationIntervalSeconds) * time.Second
	if interval < time.Second {
		interval = 10 * time.Second
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			evalCtx, cancel := context.WithTimeout(ctx, interval)
			_, err := s.engine.EvaluateCycle(evalCtx, time.Now().UTC())
			cancel()
			if err != nil && ctx.Err() == nil {
				s.logger.Error("IDS evaluation cycle failed", "error", err.Error())
			}
		}
	}
}

func (s *Scheduler) retentionLoop(ctx context.Context) {
	defer s.wg.Done()
	s.mu.RLock()
	hours := s.retCfg.CleanupIntervalHours
	s.mu.RUnlock()
	if hours <= 0 {
		hours = 6
	}

	ticker := time.NewTicker(time.Duration(hours) * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.RunRetentionOnce(ctx, time.Now().UTC())
		}
	}
}

// RunRetentionOnce purges expired telemetry events, metrics, and alerts according to configured retention days.
func (s *Scheduler) RunRetentionOnce(ctx context.Context, now time.Time) (int64, error) {
	s.mu.RLock()
	ret := s.retCfg
	s.mu.RUnlock()

	eventsCutoff := now.AddDate(0, 0, -ret.TelemetryEventsDays)
	metricsCutoff := now.AddDate(0, 0, -ret.SystemMetricsDays)
	alertsCutoff := now.AddDate(0, 0, -ret.SecurityAlertsDays)

	purged, err := s.repo.PurgeExpiredData(ctx, eventsCutoff, metricsCutoff, alertsCutoff)
	if err != nil {
		s.logger.Error("retention cleanup failed", "error", err.Error())
		return 0, err
	}
	if purged > 0 {
		s.logger.Info("retention cleanup completed", "purged_records", purged)
	}
	return purged, nil
}

