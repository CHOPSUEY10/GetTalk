package service

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/gettalk/security/backend/internal/config"
	"github.com/gettalk/security/backend/internal/models"
	"github.com/gettalk/security/backend/internal/repository"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrInvalidCredentials = errors.New("invalid username or password")
	ErrAccountLocked      = errors.New("account is temporarily locked due to repeated failed login attempts")
	ErrMFARequired        = errors.New("mfa verification required")
	ErrInvalidMFACode     = errors.New("invalid or expired MFA verification code")
	ErrUnauthorized       = errors.New("authentication required")
	ErrForbidden          = errors.New("insufficient permissions for this operation")
)

type mfaChallenge struct {
	AdminID   string
	IPAddress string
	UserAgent string
	ExpiresAt time.Time
}

// AuthService manages administrator authentication, TOTP MFA, session lifecycle, and RBAC.
type AuthService struct {
	cfg        config.SecurityConfig
	repo       repository.Repository
	mfaKey     [32]byte
	mu         sync.Mutex
	challenges map[string]mfaChallenge
}

// NewAuthService creates a new AuthService.
func NewAuthService(cfg config.SecurityConfig, repo repository.Repository) *AuthService {
	key := sha256.Sum256([]byte("GetTalk-Security-MFA-v1:" + cfg.MFAEncryptionKey))
	return &AuthService{
		cfg:        cfg,
		repo:       repo,
		mfaKey:     key,
		challenges: make(map[string]mfaChallenge),
	}
}

// EnsureBootstrapAdmin seeds a default admin user if configured or in development/test mode.
func (a *AuthService) EnsureBootstrapAdmin(ctx context.Context, env string) error {
	username := strings.TrimSpace(a.cfg.BootstrapAdminUsername)
	email := strings.TrimSpace(a.cfg.BootstrapAdminEmail)
	password := a.cfg.BootstrapAdminPassword

	if username == "" {
		username = "secadmin"
	}
	if email == "" {
		email = "secadmin@gettalk.example"
	}
	if password == "" && (env == "development" || env == "test") {
		password = "SecAdmin!2026#GetTalk"
	}
	if password == "" {
		return nil
	}

	existing, err := a.repo.GetAdminByUsername(ctx, username)
	if err != nil {
		return err
	}
	if existing != nil {
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	_, err = a.repo.CreateAdmin(ctx, models.AdminUser{
		Username:     username,
		Email:        email,
		PasswordHash: string(hash),
		Role:         models.RoleAdmin,
		MFAEnabled:   false,
	})
	return err
}

// CreateUser registers a new administrator/analyst/viewer account (used in tests and admin management).
func (a *AuthService) CreateUser(ctx context.Context, username, email, password, role string) (*models.AdminUser, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	if role != models.RoleAdmin && role != models.RoleAnalyst && role != models.RoleViewer {
		role = models.RoleViewer
	}
	return a.repo.CreateAdmin(ctx, models.AdminUser{
		Username:     strings.TrimSpace(username),
		Email:        strings.TrimSpace(email),
		PasswordHash: string(hash),
		Role:         role,
	})
}

// LoginResult encapsulates the result of a login attempt.
type LoginResult struct {
	User        *models.AdminUser   `json:"user,omitempty"`
	Session     *models.AdminSession `json:"session,omitempty"`
	MFARequired bool                `json:"mfaRequired"`
	ChallengeID string              `json:"challengeId,omitempty"`
}

// Login authenticates an administrator by username/email and password.
func (a *AuthService) Login(ctx context.Context, username, password, ipAddr, userAgent string) (*LoginResult, error) {
	now := time.Now().UTC()
	user, err := a.repo.GetAdminByUsername(ctx, strings.TrimSpace(username))
	if err != nil {
		return nil, err
	}
	if user == nil {
		// Perform dummy bcrypt compare to mitigate timing enumeration
		_ = bcrypt.CompareHashAndPassword([]byte("$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"), []byte(password))
		_ = a.repo.CreateAuditLog(ctx, models.AuditLog{
			ActorID:      "anonymous",
			Action:       "auth.login_failed",
			ResourceType: "session",
			Metadata:     map[string]interface{}{"username": username, "ip": ipAddr, "reason": "user_not_found"},
		})
		return nil, ErrInvalidCredentials
	}

	if user.LockedUntil != nil && now.Before(*user.LockedUntil) {
		_ = a.repo.CreateAuditLog(ctx, models.AuditLog{
			ActorID:      user.ID,
			Action:       "auth.login_locked",
			ResourceType: "session",
			Metadata:     map[string]interface{}{"username": user.Username, "ip": ipAddr},
		})
		return nil, ErrAccountLocked
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		attempts := user.FailedLoginAttempts + 1
		maxAttempts := a.cfg.MaxFailedLoginAttempts
		if maxAttempts <= 0 {
			maxAttempts = 5
		}
		var lockedUntil *time.Time
		if attempts >= maxAttempts {
			lockDur := time.Duration(a.cfg.LockoutDurationMinutes) * time.Minute
			if lockDur <= 0 {
				lockDur = 15 * time.Minute
			}
			lu := now.Add(lockDur)
			lockedUntil = &lu
		}
		_ = a.repo.UpdateAdminLoginState(ctx, user.ID, attempts, lockedUntil, nil)
		_ = a.repo.CreateAuditLog(ctx, models.AuditLog{
			ActorID:      user.ID,
			Action:       "auth.login_failed",
			ResourceType: "session",
			Metadata:     map[string]interface{}{"username": user.Username, "ip": ipAddr, "attempts": attempts},
		})
		if lockedUntil != nil {
			return nil, ErrAccountLocked
		}
		return nil, ErrInvalidCredentials
	}

	// If MFA is enabled for this administrator, issue a short-lived challenge ID
	if user.MFAEnabled && user.MFASecret != "" {
		challengeID := randomHex(24)
		a.mu.Lock()
		a.challenges[challengeID] = mfaChallenge{
			AdminID:   user.ID,
			IPAddress: ipAddr,
			UserAgent: userAgent,
			ExpiresAt: now.Add(5 * time.Minute),
		}
		a.mu.Unlock()
		return &LoginResult{
			MFARequired: true,
			ChallengeID: challengeID,
		}, nil
	}

	return a.completeLoginSession(ctx, user, ipAddr, userAgent, now)
}

// VerifyMFA completes a two-factor login using a TOTP code.
func (a *AuthService) VerifyMFA(ctx context.Context, challengeID, code, ipAddr, userAgent string) (*LoginResult, error) {
	now := time.Now().UTC()
	a.mu.Lock()
	ch, exists := a.challenges[challengeID]
	if exists && now.After(ch.ExpiresAt) {
		delete(a.challenges, challengeID)
		exists = false
	}
	a.mu.Unlock()

	if !exists {
		return nil, ErrInvalidMFACode
	}

	user, err := a.repo.GetAdminByID(ctx, ch.AdminID)
	if err != nil || user == nil || !user.MFAEnabled || user.MFASecret == "" {
		return nil, ErrInvalidMFACode
	}

	secret, err := a.decryptMFASecret(user.MFASecret)
	if err != nil || !VerifyTOTP(secret, code, now) {
		_ = a.repo.CreateAuditLog(ctx, models.AuditLog{
			ActorID:      user.ID,
			Action:       "auth.mfa_failed",
			ResourceType: "session",
			Metadata:     map[string]interface{}{"ip": ipAddr},
		})
		return nil, ErrInvalidMFACode
	}

	a.mu.Lock()
	delete(a.challenges, challengeID)
	a.mu.Unlock()

	return a.completeLoginSession(ctx, user, ipAddr, userAgent, now)
}

func (a *AuthService) completeLoginSession(ctx context.Context, user *models.AdminUser, ipAddr, userAgent string, now time.Time) (*LoginResult, error) {
	_ = a.repo.UpdateAdminLoginState(ctx, user.ID, 0, nil, &now)
	user.LastLoginAt = &now

	ttl := time.Duration(a.cfg.SessionTTLHours) * time.Hour
	if ttl <= 0 {
		ttl = 12 * time.Hour
	}

	sess := models.AdminSession{
		ID:        randomHex(32),
		AdminID:   user.ID,
		CSRFToken: randomHex(24),
		IPAddress: ipAddr,
		UserAgent: userAgent,
		ExpiresAt: now.Add(ttl),
		CreatedAt: now,
	}

	if err := a.repo.CreateSession(ctx, sess); err != nil {
		return nil, err
	}

	_ = a.repo.CreateAuditLog(ctx, models.AuditLog{
		ActorID:      user.ID,
		Action:       "auth.login_success",
		ResourceType: "session",
		ResourceID:   sess.ID[:12],
		Metadata:     map[string]interface{}{"username": user.Username, "role": user.Role, "ip": ipAddr},
	})

	return &LoginResult{
		User:        user,
		Session:     &sess,
		MFARequired: false,
	}, nil
}

// SetupMFA generates and stores an encrypted TOTP secret for an administrator.
func (a *AuthService) SetupMFA(ctx context.Context, adminID string) (secret string, otpauthURI string, err error) {
	user, err := a.repo.GetAdminByID(ctx, adminID)
	if err != nil || user == nil {
		return "", "", ErrUnauthorized
	}

	rawBytes := make([]byte, 20)
	_, _ = rand.Read(rawBytes)
	secret = base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(rawBytes)

	encrypted, err := a.encryptMFASecret(secret)
	if err != nil {
		return "", "", err
	}

	if err := a.repo.UpdateAdminMFA(ctx, adminID, false, encrypted); err != nil {
		return "", "", err
	}

	uri := fmt.Sprintf("otpauth://totp/GetTalkSecurity:%s?secret=%s&issuer=GetTalkSecurity&algorithm=SHA1&digits=6&period=30", user.Email, secret)
	return secret, uri, nil
}

// EnableMFA verifies a TOTP code and activates MFA on the administrator account.
func (a *AuthService) EnableMFA(ctx context.Context, adminID, code string) error {
	user, err := a.repo.GetAdminByID(ctx, adminID)
	if err != nil || user == nil || user.MFASecret == "" {
		return ErrInvalidMFACode
	}

	secret, err := a.decryptMFASecret(user.MFASecret)
	if err != nil || !VerifyTOTP(secret, code, time.Now().UTC()) {
		return ErrInvalidMFACode
	}

	if err := a.repo.UpdateAdminMFA(ctx, adminID, true, user.MFASecret); err != nil {
		return err
	}

	_ = a.repo.CreateAuditLog(ctx, models.AuditLog{
		ActorID:      user.ID,
		Action:       "auth.mfa_enabled",
		ResourceType: "admin",
		ResourceID:   user.ID,
	})
	return nil
}

// ValidateSession verifies a session ID and returns the corresponding session and admin user.
func (a *AuthService) ValidateSession(ctx context.Context, sessionID string) (*models.AdminSession, *models.AdminUser, error) {
	if strings.TrimSpace(sessionID) == "" {
		return nil, nil, ErrUnauthorized
	}
	sess, err := a.repo.GetSession(ctx, sessionID)
	if err != nil || sess == nil {
		return nil, nil, ErrUnauthorized
	}
	user, err := a.repo.GetAdminByID(ctx, sess.AdminID)
	if err != nil || user == nil {
		return nil, nil, ErrUnauthorized
	}
	return sess, user, nil
}

// Logout revokes an active administrator session.
func (a *AuthService) Logout(ctx context.Context, sessionID, actorID string) error {
	if sessionID == "" {
		return nil
	}
	_ = a.repo.DeleteSession(ctx, sessionID)
	if actorID != "" {
		_ = a.repo.CreateAuditLog(ctx, models.AuditLog{
			ActorID:      actorID,
			Action:       "auth.logout",
			ResourceType: "session",
		})
	}
	return nil
}

// GenerateTOTP computes a 6-digit RFC 6238 TOTP code for the given Base32 secret and timestamp.
func GenerateTOTP(secret string, ts time.Time) (string, error) {
	cleaned := strings.ToUpper(strings.TrimRight(strings.TrimSpace(secret), "="))
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(cleaned)
	if err != nil {
		return "", err
	}
	counter := uint64(ts.Unix() / 30)
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], counter)

	mac := hmac.New(sha1.New, key)
	mac.Write(buf[:])
	sum := mac.Sum(nil)

	offset := sum[len(sum)-1] & 0x0f
	code := (uint32(sum[offset])&0x7f)<<24 |
		(uint32(sum[offset+1])&0xff)<<16 |
		(uint32(sum[offset+2])&0xff)<<8 |
		(uint32(sum[offset+3]) & 0xff)

	return fmt.Sprintf("%06d", code%1000000), nil
}

// VerifyTOTP checks a 6-digit TOTP code within a +/- 1 step (30s) window using constant-time comparison.
func VerifyTOTP(secret, code string, now time.Time) bool {
	trimmed := strings.TrimSpace(code)
	if len(trimmed) != 6 {
		return false
	}
	for _, offsetSec := range []int64{-30, 0, 30} {
		candidate, err := GenerateTOTP(secret, now.Add(time.Duration(offsetSec)*time.Second))
		if err == nil && subtle.ConstantTimeCompare([]byte(trimmed), []byte(candidate)) == 1 {
			return true
		}
	}
	return false
}

func (a *AuthService) encryptMFASecret(plaintext string) (string, error) {
	block, err := aes.NewCipher(a.mfaKey[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	_, _ = rand.Read(nonce)
	ct := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.RawURLEncoding.EncodeToString(ct), nil
}

func (a *AuthService) decryptMFASecret(encoded string) (string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(a.mfaKey[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("invalid encrypted mfa secret")
	}
	nonce := raw[:gcm.NonceSize()]
	ct := raw[gcm.NonceSize():]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}

func randomHex(nBytes int) string {
	b := make([]byte, nBytes)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

