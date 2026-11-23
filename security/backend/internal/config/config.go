package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/gettalk/security/backend/internal/models"
	"gopkg.in/yaml.v3"
)

// Config holds the complete validated configuration for the GetTalk Security backend.
type Config struct {
	Server       ServerConfig       `yaml:"server" json:"server"`
	Database     DatabaseConfig     `yaml:"database" json:"-"`
	Redis        RedisConfig        `yaml:"redis" json:"-"`
	Notification NotificationConfig `yaml:"notification" json:"-"`
	Collectors   CollectorsConfig   `yaml:"collectors" json:"collectors"`
	Detection    DetectionConfig    `yaml:"detection" json:"detection"`
	Retention    RetentionConfig    `yaml:"retention" json:"retention"`
	Security     SecurityConfig     `yaml:"security" json:"security"`
}

type RedisConfig struct {
	RestURL            string `yaml:"-" json:"-"`
	RestToken          string `yaml:"-" json:"-"`
	KillSwitchKey      string `yaml:"kill_switch_key" json:"killSwitchKey"`
	CooldownPrefix     string `yaml:"cooldown_prefix" json:"cooldownPrefix"`
	CooldownTTLSeconds int    `yaml:"cooldown_ttl_seconds" json:"cooldownTtlSeconds"`
}

type NotificationConfig struct {
	Enabled       bool   `yaml:"enabled" json:"enabled"`
	SMTPHost      string `yaml:"-" json:"-"`
	SMTPPort      int    `yaml:"smtp_port" json:"-"`
	SMTPUser      string `yaml:"-" json:"-"`
	SMTPPass      string `yaml:"-" json:"-"`
	SMTPFrom      string `yaml:"-" json:"-"`
	SecAdminEmail string `yaml:"-" json:"-"`
}

type ServerConfig struct {
	Host                  string   `yaml:"host" json:"host"`
	Port                  int      `yaml:"port" json:"port"`
	Environment           string   `yaml:"environment" json:"environment"`
	RequestTimeoutSeconds int      `yaml:"request_timeout_seconds" json:"requestTimeoutSeconds"`
	CORSAllowedOrigins    []string `yaml:"cors_allowed_origins" json:"corsAllowedOrigins"`
	TrustedProxies        []string `yaml:"trusted_proxies" json:"trustedProxies"`
}

type DatabaseConfig struct {
	URL string `yaml:"-" json:"-"`
}

type CollectorsConfig struct {
	QueueSize       int             `yaml:"queue_size" json:"queueSize"`
	BatchSize       int             `yaml:"batch_size" json:"batchSize"`
	FlushIntervalMs int             `yaml:"flush_interval_ms" json:"flushIntervalMs"`
	Firewalld       FirewalldConfig `yaml:"firewalld" json:"firewalld"`
	Nginx           NginxConfig     `yaml:"nginx" json:"nginx"`
	PM2             PM2Config       `yaml:"pm2" json:"pm2"`
}

type FirewalldConfig struct {
	Enabled            bool   `yaml:"enabled" json:"enabled"`
	Mode               string `yaml:"mode" json:"mode"`
	JournaldUnit       string `yaml:"journald_unit" json:"journaldUnit"`
	KernelGrep         string `yaml:"kernel_grep" json:"kernelGrep"`
	FallbackLogPath    string `yaml:"fallback_log_path" json:"fallbackLogPath"`
	DedupWindowSeconds int    `yaml:"dedup_window_seconds" json:"dedupWindowSeconds"`
}

type NginxConfig struct {
	Enabled             bool   `yaml:"enabled" json:"enabled"`
	AccessLogPath       string `yaml:"access_log_path" json:"accessLogPath"`
	ErrorLogPath        string `yaml:"error_log_path" json:"errorLogPath"`
	PollIntervalMs      int    `yaml:"poll_interval_ms" json:"pollIntervalMs"`
	CheckpointKeyPrefix string `yaml:"checkpoint_key_prefix" json:"checkpointKeyPrefix"`
	MaxLineBytes        int    `yaml:"max_line_bytes" json:"maxLineBytes"`
	TrustedReverseProxy bool   `yaml:"trusted_reverse_proxy" json:"trustedReverseProxy"`
}

type PM2Config struct {
	Enabled                 bool   `yaml:"enabled" json:"enabled"`
	BinaryPath              string `yaml:"binary_path" json:"binaryPath"`
	IntervalSeconds         int    `yaml:"interval_seconds" json:"intervalSeconds"`
	CommandTimeoutSeconds   int    `yaml:"command_timeout_seconds" json:"commandTimeoutSeconds"`
	DefaultMemoryLimitBytes int64  `yaml:"default_memory_limit_bytes" json:"defaultMemoryLimitBytes"`
}

type DetectionConfig struct {
	Enabled                   bool   `yaml:"enabled" json:"enabled"`
	EvaluationIntervalSeconds int    `yaml:"evaluation_interval_seconds" json:"evaluationIntervalSeconds"`
	RulesConfigPath           string `yaml:"rules_config_path" json:"rulesConfigPath"`
	DedupCooldownSeconds      int    `yaml:"dedup_cooldown_seconds" json:"dedupCooldownSeconds"`
	PassiveModeOnly           bool   `yaml:"passive_mode_only" json:"passiveModeOnly"`
}

type RetentionConfig struct {
	CleanupIntervalHours int `yaml:"cleanup_interval_hours" json:"cleanupIntervalHours"`
	TelemetryEventsDays  int `yaml:"telemetry_events_days" json:"telemetryEventsDays"`
	SystemMetricsDays    int `yaml:"system_metrics_days" json:"systemMetricsDays"`
	SecurityAlertsDays   int `yaml:"security_alerts_days" json:"securityAlertsDays"`
}

type SecurityConfig struct {
	SessionSecret              string `yaml:"-" json:"-"`
	MFAEncryptionKey           string `yaml:"-" json:"-"`
	SessionTTLHours            int    `yaml:"session_ttl_hours" json:"sessionTtlHours"`
	CookieName                 string `yaml:"cookie_name" json:"cookieName"`
	CookieSecure               bool   `yaml:"cookie_secure" json:"cookieSecure"`
	CookieSameSite             string `yaml:"cookie_same_site" json:"cookieSameSite"`
	RateLimitRequestsPerMinute int    `yaml:"rate_limit_requests_per_minute" json:"rateLimitRequestsPerMinute"`
	AuthRateLimitPerMinute     int    `yaml:"auth_rate_limit_per_minute" json:"authRateLimitPerMinute"`
	MaxFailedLoginAttempts     int    `yaml:"max_failed_login_attempts" json:"maxFailedLoginAttempts"`
	LockoutDurationMinutes     int    `yaml:"lockout_duration_minutes" json:"lockoutDurationMinutes"`
	BootstrapAdminUsername     string `yaml:"-" json:"-"`
	BootstrapAdminEmail        string `yaml:"-" json:"-"`
	BootstrapAdminPassword     string `yaml:"-" json:"-"`
}

// DefaultConfig returns safe defaults for all configuration fields.
func DefaultConfig() *Config {
	return &Config{
		Server: ServerConfig{
			Host:                  "127.0.0.1",
			Port:                  4100,
			Environment:           "development",
			RequestTimeoutSeconds: 15,
			CORSAllowedOrigins:    []string{"http://localhost:5174", "http://localhost:5173"},
			TrustedProxies:        []string{"127.0.0.1", "::1"},
		},
		Redis: RedisConfig{
			KillSwitchKey:      "siem:backend:enabled",
			CooldownPrefix:     "siem:alert:cooldown:",
			CooldownTTLSeconds: 300,
		},
		Notification: NotificationConfig{
			Enabled:       true,
			SMTPPort:      587,
			SMTPFrom:      "GetTalk SIEM <no-reply@gettalk.example>",
			SecAdminEmail: "secadmin@gettalk.example",
		},
		Collectors: CollectorsConfig{
			QueueSize:       2048,
			BatchSize:       100,
			FlushIntervalMs: 1000,
			Firewalld: FirewalldConfig{
				Enabled:            true,
				Mode:               "journald",
				JournaldUnit:       "firewalld.service",
				KernelGrep:         "FINAL_REJECT|DROP|REJECT",
				FallbackLogPath:    "/var/log/messages",
				DedupWindowSeconds: 5,
			},
			Nginx: NginxConfig{
				Enabled:             true,
				AccessLogPath:       "/var/log/nginx/access.log",
				ErrorLogPath:        "/var/log/nginx/error.log",
				PollIntervalMs:      500,
				CheckpointKeyPrefix: "nginx",
				MaxLineBytes:        16384,
				TrustedReverseProxy: true,
			},
			PM2: PM2Config{
				Enabled:                 true,
				BinaryPath:              "pm2",
				IntervalSeconds:         5,
				CommandTimeoutSeconds:   4,
				DefaultMemoryLimitBytes: 1073741824,
			},
		},
		Detection: DetectionConfig{
			Enabled:                   true,
			EvaluationIntervalSeconds: 10,
			RulesConfigPath:           "../configs/detection-rules.yaml",
			DedupCooldownSeconds:      300,
			PassiveModeOnly:           true,
		},
		Retention: RetentionConfig{
			CleanupIntervalHours: 6,
			TelemetryEventsDays:  30,
			SystemMetricsDays:    90,
			SecurityAlertsDays:   180,
		},
		Security: SecurityConfig{
			SessionSecret:              "dev-only-session-secret-change-in-production-32b",
			MFAEncryptionKey:           "dev-only-mfa-encryption-key-change-in-prod-32b",
			SessionTTLHours:            12,
			CookieName:                 "gt_sec_session",
			CookieSecure:               false,
			CookieSameSite:             "lax",
			RateLimitRequestsPerMinute: 120,
			AuthRateLimitPerMinute:     10,
			MaxFailedLoginAttempts:     5,
			LockoutDurationMinutes:     15,
		},
	}
}

// Load reads configuration from an optional YAML file and overlays environment variables.
func Load(yamlPath string) (*Config, error) {
	cfg := DefaultConfig()

	if yamlPath != "" {
		if data, err := os.ReadFile(yamlPath); err == nil {
			if err := yaml.Unmarshal(data, cfg); err != nil {
				return nil, fmt.Errorf("failed to parse config file %s: %w", yamlPath, err)
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("failed to read config file %s: %w", yamlPath, err)
		}
	}

	applyEnvOverrides(cfg)

	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	return cfg, nil
}

func applyEnvOverrides(cfg *Config) {
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_ENV")); v != "" {
		cfg.Server.Environment = v
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_HOST")); v != "" {
		cfg.Server.Host = v
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_PORT")); v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			cfg.Server.Port = p
		}
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_DATABASE_URL")); v != "" {
		cfg.Database.URL = v
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_SESSION_SECRET")); v != "" {
		cfg.Security.SessionSecret = v
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_MFA_ENCRYPTION_KEY")); v != "" {
		cfg.Security.MFAEncryptionKey = v
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_CORS_ORIGINS")); v != "" {
		parts := strings.Split(v, ",")
		origins := make([]string, 0, len(parts))
		for _, p := range parts {
			if trimmed := strings.TrimSpace(p); trimmed != "" {
				origins = append(origins, trimmed)
			}
		}
		if len(origins) > 0 {
			cfg.Server.CORSAllowedOrigins = origins
		}
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_TRUSTED_PROXIES")); v != "" {
		parts := strings.Split(v, ",")
		proxies := make([]string, 0, len(parts))
		for _, p := range parts {
			if trimmed := strings.TrimSpace(p); trimmed != "" {
				proxies = append(proxies, trimmed)
			}
		}
		cfg.Server.TrustedProxies = proxies
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_COOKIE_SECURE")); v != "" {
		cfg.Security.CookieSecure = strings.EqualFold(v, "true") || v == "1"
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_COOKIE_SAME_SITE")); v != "" {
		cfg.Security.CookieSameSite = strings.ToLower(v)
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_RULES_PATH")); v != "" {
		cfg.Detection.RulesConfigPath = v
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_BOOTSTRAP_ADMIN_USERNAME")); v != "" {
		cfg.Security.BootstrapAdminUsername = v
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_BOOTSTRAP_ADMIN_EMAIL")); v != "" {
		cfg.Security.BootstrapAdminEmail = v
		cfg.Notification.SecAdminEmail = v
	}
	if v := os.Getenv("TELEMETRY_BOOTSTRAP_ADMIN_PASSWORD"); v != "" {
		cfg.Security.BootstrapAdminPassword = v
	}

	// Upstash Redis configuration via environment variables
	if v := strings.TrimSpace(os.Getenv("UPSTASH_REDIS_REST_URL")); v != "" {
		cfg.Redis.RestURL = v
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_UPSTASH_REDIS_REST_URL")); v != "" {
		cfg.Redis.RestURL = v
	}
	if v := strings.TrimSpace(os.Getenv("UPSTASH_REDIS_REST_TOKEN")); v != "" {
		cfg.Redis.RestToken = v
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_UPSTASH_REDIS_REST_TOKEN")); v != "" {
		cfg.Redis.RestToken = v
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_KILL_SWITCH_KEY")); v != "" {
		cfg.Redis.KillSwitchKey = v
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_ALERT_COOLDOWN_SECONDS")); v != "" {
		if sec, err := strconv.Atoi(v); err == nil && sec > 0 {
			cfg.Redis.CooldownTTLSeconds = sec
		}
	}

	// SMTP & SecAdmin email notification configuration via environment variables
	if v := strings.TrimSpace(os.Getenv("SMTP_HOST")); v != "" {
		cfg.Notification.SMTPHost = v
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_SMTP_HOST")); v != "" {
		cfg.Notification.SMTPHost = v
	}
	if v := strings.TrimSpace(os.Getenv("SMTP_PORT")); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			cfg.Notification.SMTPPort = p
		}
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_SMTP_PORT")); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			cfg.Notification.SMTPPort = p
		}
	}
	if v := strings.TrimSpace(os.Getenv("SMTP_USER")); v != "" {
		cfg.Notification.SMTPUser = v
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_SMTP_USER")); v != "" {
		cfg.Notification.SMTPUser = v
	}
	if v := os.Getenv("SMTP_PASS"); v != "" {
		cfg.Notification.SMTPPass = v
	}
	if v := os.Getenv("TELEMETRY_SMTP_PASS"); v != "" {
		cfg.Notification.SMTPPass = v
	}
	if v := strings.TrimSpace(os.Getenv("SMTP_FROM")); v != "" {
		cfg.Notification.SMTPFrom = v
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_SMTP_FROM")); v != "" {
		cfg.Notification.SMTPFrom = v
	}
	if v := strings.TrimSpace(os.Getenv("TELEMETRY_SECADMIN_EMAIL")); v != "" {
		cfg.Notification.SecAdminEmail = v
	}
}

// Validate checks configuration constraints and security boundaries.
func (c *Config) Validate() error {
	switch c.Server.Environment {
	case "development", "staging", "production", "test":
	default:
		return fmt.Errorf("invalid server.environment: %q", c.Server.Environment)
	}

	if c.Server.Port <= 0 || c.Server.Port > 65535 {
		return fmt.Errorf("invalid server.port: %d", c.Server.Port)
	}

	if c.Collectors.QueueSize < 16 {
		return errors.New("collectors.queue_size must be at least 16")
	}

	if c.Collectors.PM2.IntervalSeconds < 1 {
		return errors.New("collectors.pm2.interval_seconds must be >= 1")
	}

	if c.Detection.EvaluationIntervalSeconds < 1 {
		return errors.New("detection.evaluation_interval_seconds must be >= 1")
	}

	// Enforce passive mode only (Section 8 requirement: never automatically block IPs or kill processes).
	if !c.Detection.PassiveModeOnly {
		return errors.New("detection.passive_mode_only must remain true; active remediation is prohibited")
	}

	if c.Retention.TelemetryEventsDays < 1 || c.Retention.SystemMetricsDays < 1 || c.Retention.SecurityAlertsDays < 1 {
		return errors.New("retention days must be positive integers")
	}

	if c.Server.Environment == "production" {
		if c.Database.URL == "" {
			return errors.New("TELEMETRY_DATABASE_URL is required in production")
		}
		if len(c.Security.SessionSecret) < 32 || strings.HasPrefix(c.Security.SessionSecret, "dev-only") {
			return errors.New("TELEMETRY_SESSION_SECRET must be at least 32 characters and non-default in production")
		}
	}

	return nil
}

// RulesFile represents the structure of detection-rules.yaml.
type RulesFile struct {
	Rules []models.DetectionRule `yaml:"rules"`
}

// LoadDetectionRules reads and validates detection rules from a YAML file.
func LoadDetectionRules(path string) ([]models.DetectionRule, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read detection rules file %s: %w", path, err)
	}

	var rf RulesFile
	if err := yaml.Unmarshal(data, &rf); err != nil {
		return nil, fmt.Errorf("failed to unmarshal detection rules %s: %w", path, err)
	}

	for i, r := range rf.Rules {
		if strings.TrimSpace(r.ID) == "" {
			return nil, fmt.Errorf("rule at index %d has empty id", i)
		}
		if !models.ValidRuleTypes[r.RuleType] {
			return nil, fmt.Errorf("rule %s has invalid rule_type %q", r.ID, r.RuleType)
		}
		if !models.ValidSeverities[r.Severity] {
			return nil, fmt.Errorf("rule %s has invalid severity %q", r.ID, r.Severity)
		}
		if r.TimeWindow <= 0 {
			return nil, fmt.Errorf("rule %s must have time_window > 0", r.ID)
		}
		if r.Threshold < 0 {
			return nil, fmt.Errorf("rule %s must have threshold >= 0", r.ID)
		}
	}

	return rf.Rules, nil
}

