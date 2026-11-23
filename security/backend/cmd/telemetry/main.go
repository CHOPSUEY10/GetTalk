package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/gettalk/security/backend/internal/collector"
	"github.com/gettalk/security/backend/internal/collector/firewall"
	"github.com/gettalk/security/backend/internal/collector/nginx"
	"github.com/gettalk/security/backend/internal/collector/pm2"
	"github.com/gettalk/security/backend/internal/config"
	"github.com/gettalk/security/backend/internal/detection"
	"github.com/gettalk/security/backend/internal/handler"
	"github.com/gettalk/security/backend/internal/models"
	"github.com/gettalk/security/backend/internal/repository"
	"github.com/gettalk/security/backend/internal/router"
	"github.com/gettalk/security/backend/internal/scheduler"
	"github.com/gettalk/security/backend/internal/service"
)

func main() {
	var (
		configPath = flag.String("config", "../configs/telemetry.yaml", "Path to telemetry.yaml configuration file")
		mode       = flag.String("mode", "all", "Execution mode: all | api | collector")
	)
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// Security requirement (Section 11): The backend must not run as root on Unix systems.
	if runtime.GOOS != "windows" && os.Geteuid() == 0 {
		logger.Error("refusing to run as root (UID 0); use a least-privilege service account")
		os.Exit(1)
	}

	if envCfg := os.Getenv("TELEMETRY_CONFIG_PATH"); envCfg != "" {
		*configPath = envCfg
	}

	cfg, err := config.Load(*configPath)
	if err != nil {
		logger.Error("failed to load configuration", "error", err.Error())
		os.Exit(1)
	}

	rules, err := config.LoadDetectionRules(cfg.Detection.RulesConfigPath)
	if err != nil {
		logger.Warn("using built-in default rules (could not load rules file)", "path", cfg.Detection.RulesConfigPath, "error", err.Error())
		rules = defaultRules()
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var repo repository.Repository
	if cfg.Database.URL != "" {
		pgRepo, err := repository.NewPostgresRepository(ctx, cfg.Database.URL)
		if err != nil {
			if cfg.Server.Environment == "production" {
				logger.Error("failed to connect to dedicated telemetry PostgreSQL database", "error", err.Error())
				os.Exit(1)
			}
			logger.Warn("falling back to in-memory repository for non-production environment", "error", err.Error())
			repo = repository.NewMemoryRepository(rules)
		} else {
			repo = pgRepo
		}
	} else {
		repo = repository.NewMemoryRepository(rules)
	}
	defer repo.Close()

	broker := service.NewSSEBroker()
	authSvc := service.NewAuthService(cfg.Security, repo)
	if err := authSvc.EnsureBootstrapAdmin(ctx, cfg.Server.Environment); err != nil {
		logger.Warn("failed to seed bootstrap admin", "error", err.Error())
	}

	colMgr := collector.NewManager(
		cfg.Collectors.QueueSize,
		cfg.Collectors.BatchSize,
		time.Duration(cfg.Collectors.FlushIntervalMs)*time.Millisecond,
		repo,
		broker,
		logger,
	)

	fwCol := firewall.NewCollector(cfg.Collectors.Firewalld, nil)
	nxCol := nginx.NewCollector(cfg.Collectors.Nginx, cfg.Server.TrustedProxies, repo)
	pm2Col := pm2.NewCollector(cfg.Collectors.PM2, nil)

	colMgr.Register(fwCol)
	colMgr.Register(nxCol)
	colMgr.Register(pm2Col)

	idsEngine := detection.NewEngine(cfg.Detection, repo, broker, logger)
	sched := scheduler.NewScheduler(cfg.Detection, cfg.Retention, idsEngine, repo, logger)
	telemetrySvc := service.NewTelemetryService(cfg, repo, colMgr, pm2Col, sched)
	idsEngine.SetCriticalNotifier(telemetrySvc.NotificationService())
	colMgr.SetEventNotifier(telemetrySvc.NotificationService())

	if *mode == "all" || *mode == "collector" {
		if err := colMgr.Start(ctx); err != nil {
			logger.Error("failed to start collector manager", "error", err.Error())
			os.Exit(1)
		}
		sched.Start(ctx)
		logger.Info("telemetry collectors and IDS scheduler started", "mode", *mode)
	}

	if *mode == "collector" {
		<-ctx.Done()
		sched.Stop()
		_ = colMgr.Stop()
		logger.Info("collector service stopped cleanly")
		return
	}

	h := handler.NewHandler(cfg, authSvc, telemetrySvc, broker)
	httpRouter := router.NewRouter(cfg, authSvc, h)

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	srv := &http.Server{
		Addr:              addr,
		Handler:           httpRouter,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		logger.Info("GetTalk Security API listening", "addr", addr, "env", cfg.Server.Environment, "mode", *mode)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("HTTP server error", "error", err.Error())
			stop()
		}
	}()

	<-ctx.Done()
	logger.Info("shutting down GetTalk Security service...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	sched.Stop()
	_ = colMgr.Stop()
	logger.Info("GetTalk Security service stopped cleanly")
}

func defaultRules() []models.DetectionRule {
	return []models.DetectionRule{
		{ID: "NET-001", RuleName: "Repeated Firewall Rejection", RuleType: "threshold", Threshold: 50, TimeWindow: 60, Severity: models.SeverityMedium, Enabled: true, Configuration: map[string]interface{}{"source": "firewalld"}},
		{ID: "NET-002", RuleName: "Port Scanning Indicators", RuleType: "distinct_count", Threshold: 10, TimeWindow: 60, Severity: models.SeverityHigh, Enabled: true, Configuration: map[string]interface{}{"source": "firewalld", "distinct_field": "destination_port"}},
		{ID: "WEB-001", RuleName: "HTTP Request Flood", RuleType: "threshold", Threshold: 100, TimeWindow: 60, Severity: models.SeverityHigh, Enabled: true, Configuration: map[string]interface{}{"source": "nginx"}},
		{ID: "WEB-002", RuleName: "Authentication Failure Burst", RuleType: "threshold", Threshold: 30, TimeWindow: 60, Severity: models.SeverityMedium, Enabled: true, Configuration: map[string]interface{}{"source": "nginx", "path_prefixes": []string{"/api/auth/login", "/api/v1/auth/login"}, "status_codes": []int{401, 403, 423, 429}}},
		{ID: "WEB-003", RuleName: "Suspicious Request Patterns", RuleType: "signature", Threshold: 1, TimeWindow: 60, Severity: models.SeverityHigh, Enabled: true, Configuration: map[string]interface{}{"source": "nginx", "signatures": []string{"../", "/etc/passwd", "/.env", "union select", "<script"}}},
		{ID: "APP-001", RuleName: "High CPU Usage", RuleType: "metric_sustained", Threshold: 80, TimeWindow: 300, Severity: models.SeverityMedium, Enabled: true, Configuration: map[string]interface{}{"source": "pm2", "metric_name": "cpu_percent", "min_samples": 3}},
		{ID: "APP-002", RuleName: "High Memory Usage", RuleType: "metric_sustained", Threshold: 80, TimeWindow: 60, Severity: models.SeverityHigh, Enabled: true, Configuration: map[string]interface{}{"source": "pm2", "metric_name": "memory_percent", "min_samples": 1}},
		{ID: "APP-003", RuleName: "Repeated Process Restart", RuleType: "metric_delta", Threshold: 3, TimeWindow: 300, Severity: models.SeverityHigh, Enabled: true, Configuration: map[string]interface{}{"source": "pm2", "metric_name": "restart_count"}},
		{ID: "COR-001", RuleName: "Cross-Layer Suspicious Activity", RuleType: "correlation", Threshold: 2, TimeWindow: 300, Severity: models.SeverityCritical, Enabled: true, Configuration: map[string]interface{}{"required_sources": []string{"firewalld", "nginx"}}},
	}
}

