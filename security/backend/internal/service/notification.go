package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"net/smtp"
	"strings"
	"sync"
	"time"

	"github.com/gettalk/security/backend/internal/config"
	"github.com/gettalk/security/backend/internal/models"
)

// ErrEmailDeliveryFailed is a safe error that never leaks SMTP credentials or internal host configuration.
var ErrEmailDeliveryFailed = errors.New("email notification delivery failed")

// EmailSender defines the contract for sending security notification emails.
type EmailSender interface {
	SendEmail(ctx context.Context, to, subject, body string) error
}

// IsCriticalSeverity checks whether a severity level is "critical" (case-insensitive).
func IsCriticalSeverity(severity string) bool {
	return strings.EqualFold(strings.TrimSpace(severity), models.SeverityCritical)
}

// IsHighOrCriticalSeverity checks whether a severity level is "high" or "critical" (case-insensitive).
func IsHighOrCriticalSeverity(severity string) bool {
	trimmed := strings.TrimSpace(severity)
	return strings.EqualFold(trimmed, models.SeverityCritical) ||
		strings.EqualFold(trimmed, models.SeverityHigh)
}

// ContainsHeaderInjection checks if any string contains CR, LF, or null byte characters that could enable SMTP Header Injection.
func ContainsHeaderInjection(values ...string) bool {
	for _, v := range values {
		if strings.ContainsAny(v, "\r\n\x00") {
			return true
		}
	}
	return false
}

// SanitizeHeaderValue strips CR, LF, and control characters from an email header field as defense-in-depth.
func SanitizeHeaderValue(val string) string {
	var b strings.Builder
	b.Grow(len(val))
	for _, r := range val {
		if r == '\r' || r == '\n' || r == '\x00' || r < 32 {
			continue
		}
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}

// SMTPEmailSender sends emails using standard SMTP without leaking credentials on error.
type SMTPEmailSender struct {
	cfg config.NotificationConfig
}

// NewSMTPEmailSender creates a new SMTPEmailSender.
func NewSMTPEmailSender(cfg config.NotificationConfig) *SMTPEmailSender {
	return &SMTPEmailSender{cfg: cfg}
}

func isPlaceholderAddress(addr string) bool {
	lower := strings.ToLower(strings.TrimSpace(addr))
	return strings.Contains(lower, "@gettalk.example") ||
		strings.Contains(lower, "@gettalk.local") ||
		strings.Contains(lower, "@gettalk.app")
}

// extractEnvelopeEmail extracts the raw RFC 5321 email address (without display name or angle brackets)
// required by Go's smtp.SendMail for MAIL FROM and RCPT TO commands.
func extractEnvelopeEmail(raw, fallbackUser string) string {
	cleaned := SanitizeHeaderValue(raw)
	fallback := SanitizeHeaderValue(fallbackUser)

	var addr string
	if parsed, err := mail.ParseAddress(cleaned); err == nil && parsed.Address != "" {
		addr = strings.TrimSpace(parsed.Address)
	} else if start := strings.IndexByte(cleaned, '<'); start != -1 {
		if end := strings.IndexByte(cleaned[start+1:], '>'); end != -1 {
			addr = strings.TrimSpace(cleaned[start+1 : start+1+end])
		}
	} else {
		addr = strings.TrimSpace(cleaned)
	}

	if (addr == "" || isPlaceholderAddress(addr)) && strings.Contains(fallback, "@") && !isPlaceholderAddress(fallback) {
		return fallback
	}
	return addr
}

func (s *SMTPEmailSender) SendEmail(_ context.Context, to, subject, body string) error {
	if ContainsHeaderInjection(to, subject, s.cfg.SMTPFrom) {
		return fmt.Errorf("%w: invalid characters in email header", ErrValidation)
	}
	cleanTo := SanitizeHeaderValue(to)
	cleanFrom := SanitizeHeaderValue(s.cfg.SMTPFrom)
	cleanSubject := SanitizeHeaderValue(subject)
	cleanUser := SanitizeHeaderValue(s.cfg.SMTPUser)

	if cleanTo == "" {
		return fmt.Errorf("%w: recipient address is required", ErrValidation)
	}
	if strings.TrimSpace(s.cfg.SMTPHost) == "" {
		// In development/test without an SMTP server configured, succeed as a no-op
		return nil
	}

	envelopeFrom := extractEnvelopeEmail(cleanFrom, cleanUser)
	envelopeTo := extractEnvelopeEmail(cleanTo, cleanUser)
	if envelopeFrom == "" {
		envelopeFrom = cleanUser
	}
	if envelopeTo == "" {
		return fmt.Errorf("%w: recipient address is required", ErrValidation)
	}
	if cleanFrom == "" || isPlaceholderAddress(cleanFrom) {
		if envelopeFrom != "" {
			cleanFrom = fmt.Sprintf("GetTalk SIEM <%s>", envelopeFrom)
		}
	}
	if isPlaceholderAddress(cleanTo) && envelopeTo != "" {
		cleanTo = envelopeTo
	}

	port := s.cfg.SMTPPort
	if port <= 0 {
		port = 587
	}
	host := strings.TrimSpace(s.cfg.SMTPHost)
	addr := fmt.Sprintf("%s:%d", host, port)

	var auth smtp.Auth
	if cleanUser != "" {
		cleanPass := strings.Join(strings.Fields(s.cfg.SMTPPass), "")
		auth = smtp.PlainAuth("", cleanUser, cleanPass, host)
	}

	msg := fmt.Sprintf(
		"From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=\"UTF-8\"\r\n\r\n%s\r\n",
		cleanFrom,
		cleanTo,
		cleanSubject,
		body,
	)

	if err := smtp.SendMail(addr, auth, envelopeFrom, []string{envelopeTo}, []byte(msg)); err != nil {
		// Redact any underlying SMTP error so credentials/hosts are never exposed in logs
		return ErrEmailDeliveryFailed
	}
	return nil
}

// NotificationService coordinates asynchronous email notifications with Upstash Redis cooldown protection.
type NotificationService struct {
	notifCfg         config.NotificationConfig
	redisCfg         config.RedisConfig
	redis            RedisClient
	fallbackCooldown *MemoryRedisClient
	sender           EmailSender
	logger           *slog.Logger
	wg               sync.WaitGroup
}

// NewNotificationService constructs a NotificationService.
func NewNotificationService(
	notifCfg config.NotificationConfig,
	redisCfg config.RedisConfig,
	redisClient RedisClient,
	sender EmailSender,
	logger *slog.Logger,
) *NotificationService {
	if redisClient == nil {
		redisClient = NewRedisClient(redisCfg)
	}
	if sender == nil {
		sender = NewSMTPEmailSender(notifCfg)
	}
	if logger == nil {
		logger = slog.Default()
	}
	if strings.TrimSpace(notifCfg.SecAdminEmail) == "" ||
		(isPlaceholderAddress(notifCfg.SecAdminEmail) && strings.Contains(notifCfg.SMTPUser, "@") && !isPlaceholderAddress(notifCfg.SMTPUser)) {
		if strings.Contains(notifCfg.SMTPUser, "@") && !isPlaceholderAddress(notifCfg.SMTPUser) {
			notifCfg.SecAdminEmail = strings.TrimSpace(notifCfg.SMTPUser)
		} else if strings.TrimSpace(notifCfg.SecAdminEmail) == "" {
			notifCfg.SecAdminEmail = "secadmin@gettalk.example"
		}
	}
	if strings.TrimSpace(redisCfg.CooldownPrefix) == "" {
		redisCfg.CooldownPrefix = "siem:alert:cooldown:"
	}
	if redisCfg.CooldownTTLSeconds <= 0 {
		redisCfg.CooldownTTLSeconds = 300
	}
	return &NotificationService{
		notifCfg:         notifCfg,
		redisCfg:         redisCfg,
		redis:            redisClient,
		fallbackCooldown: NewMemoryRedisClient(),
		sender:           sender,
		logger:           logger,
	}
}

// CooldownKey builds the Redis cooldown key for a security event based on source_ip or event_id.
func (n *NotificationService) CooldownKey(sourceIP, eventID string) string {
	identifier := SanitizeHeaderValue(sourceIP)
	if identifier == "" {
		identifier = SanitizeHeaderValue(eventID)
	}
	if identifier == "" {
		identifier = "unknown"
	}
	return n.redisCfg.CooldownPrefix + identifier
}

// NotifyCriticalEventAsync checks if the event is high or critical severity and asynchronously sends an email
// to secadmin if not rate-limited by the Upstash Redis SetNX cooldown.
func (n *NotificationService) NotifyCriticalEventAsync(ev models.TelemetryEvent, description string) bool {
	if !n.notifCfg.Enabled || !IsHighOrCriticalSeverity(ev.Severity) {
		return false
	}

	n.wg.Add(1)
	go func(event models.TelemetryEvent, desc string) {
		defer n.wg.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		_ = n.processCriticalEventNotification(ctx, event, desc)
	}(ev, description)
	return true
}

func (n *NotificationService) processCriticalEventNotification(ctx context.Context, ev models.TelemetryEvent, description string) error {
	if !IsHighOrCriticalSeverity(ev.Severity) {
		return nil
	}
	if ContainsHeaderInjection(ev.ID, ev.SourceIP, ev.EventType, description) {
		n.logger.Warn("blocked potential SMTP header injection in security event notification")
		return ErrValidation
	}

	ttl := time.Duration(n.redisCfg.CooldownTTLSeconds) * time.Second
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}

	// Enforce cooldown via Upstash Redis SetNX based on source_ip or event_id
	key := n.CooldownKey(ev.SourceIP, ev.ID)
	allowed, err := n.redis.SetNX(ctx, key, "1", ttl)
	if err != nil {
		// Log safe message without leaking Redis credentials or URL and fall back to local memory cooldown
		n.logger.Warn("redis cooldown check failed; using in-memory cooldown fallback", "event_id", SanitizeHeaderValue(ev.ID))
		if n.fallbackCooldown != nil {
			allowed, _ = n.fallbackCooldown.SetNX(ctx, key, "1", ttl)
		} else {
			allowed = true
		}
	}
	if !allowed {
		// Cooldown active: suppress duplicate email flooding
		return nil
	}

	cleanID := SanitizeHeaderValue(ev.ID)
	cleanIP := SanitizeHeaderValue(ev.SourceIP)
	cleanSource := SanitizeHeaderValue(ev.Source)
	cleanType := SanitizeHeaderValue(ev.EventType)
	cleanDesc := SanitizeHeaderValue(description)
	upperSev := strings.ToUpper(SanitizeHeaderValue(ev.Severity))
	if upperSev == "" {
		upperSev = "CRITICAL"
	}

	subject := fmt.Sprintf("[%s] GetTalk SIEM Security Event (%s)", upperSev, cleanID)
	body := fmt.Sprintf(
		"%s Security Event Detected\n\nEvent ID: %s\nSeverity: %s\nSource: %s\nEvent Type: %s\nSource IP: %s\nDescription: %s\nTimestamp: %s\n",
		upperSev,
		cleanID,
		upperSev,
		cleanSource,
		cleanType,
		cleanIP,
		cleanDesc,
		ev.OccurredAt.UTC().Format(time.RFC3339),
	)

	if err := n.sender.SendEmail(ctx, n.notifCfg.SecAdminEmail, subject, body); err != nil {
		n.logger.Error("failed to send security event email notification", "event_id", cleanID, "severity", upperSev)
		return ErrEmailDeliveryFailed
	}
	return nil
}

// NotifyKillSwitchDeactivatedAsync asynchronously sends a high-priority warning email to secadmin
// when the SIEM backend kill switch is turned off (disabled).
func (n *NotificationService) NotifyKillSwitchDeactivatedAsync(actorID, reason string) {
	if !n.notifCfg.Enabled {
		return
	}

	n.wg.Add(1)
	go func(actor, rsn string) {
		defer n.wg.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		cleanActor := SanitizeHeaderValue(actor)
		cleanReason := SanitizeHeaderValue(rsn)
		if cleanReason == "" {
			cleanReason = "Administrative emergency shutdown"
		}
		subject := "[WARNING] GetTalk Chat Server Disabled (Kill Switch Activated)"
		body := fmt.Sprintf(
			"WARNING: GetTalk Chat Server Backend has been DISABLED via the SIEM Kill Switch.\n\nActor ID: %s\nReason: %s\nTimestamp: %s\n",
			cleanActor,
			cleanReason,
			time.Now().UTC().Format(time.RFC3339),
		)
		if err := n.sender.SendEmail(ctx, n.notifCfg.SecAdminEmail, subject, body); err != nil {
			n.logger.Error("failed to send kill switch warning email notification", "actor_id", cleanActor)
		}
	}(actorID, reason)
}

// WaitPending waits for in-flight asynchronous email notification goroutines to complete (useful in tests and shutdown).
func (n *NotificationService) WaitPending(timeout time.Duration) bool {
	done := make(chan struct{})
	go func() {
		n.wg.Wait()
		close(done)
	}()
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	select {
	case <-done:
		return true
	case <-time.After(timeout):
		return false
	}
}
