package middleware

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gettalk/security/backend/internal/config"
	"github.com/gettalk/security/backend/internal/models"
	"github.com/gettalk/security/backend/internal/service"
)

type contextKey string

const (
	userContextKey    contextKey = "sec_admin_user"
	sessionContextKey contextKey = "sec_admin_session"
)

// GetAdminUser retrieves the authenticated AdminUser from the request context.
func GetAdminUser(ctx context.Context) *models.AdminUser {
	if u, ok := ctx.Value(userContextKey).(*models.AdminUser); ok {
		return u
	}
	return nil
}

// GetAdminSession retrieves the authenticated AdminSession from the request context.
func GetAdminSession(ctx context.Context) *models.AdminSession {
	if s, ok := ctx.Value(sessionContextKey).(*models.AdminSession); ok {
		return s
	}
	return nil
}

// WriteError sends a standardized JSON error response matching GetTalk's API conventions.
func WriteError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"error": map[string]string{
			"code":    code,
			"message": message,
		},
	})
}

// SecurityHeaders applies strict HTTP security headers to every response.
func SecurityHeaders(isProd bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
			w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
			w.Header().Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; object-src 'none';")
			if isProd {
				w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
			}
			next.ServeHTTP(w, r)
		})
	}
}

// CORS enforces strict origin allowlisting and credentialed request rules.
func CORS(allowedOrigins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allowed[strings.TrimSpace(o)] = true
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" {
				if allowed[origin] {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Access-Control-Allow-Credentials", "true")
					w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
					w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token")
					w.Header().Set("Vary", "Origin")
				} else if r.Method == http.MethodOptions {
					WriteError(w, http.StatusForbidden, "FORBIDDEN", "Origin not allowed by CORS policy")
					return
				}
			}

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// RequestTimeout enforces a maximum execution duration for non-streaming HTTP requests.
func RequestTimeout(timeout time.Duration) func(http.Handler) http.Handler {
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Do not apply short request timeout to the SSE real-time stream endpoint
			if strings.HasSuffix(r.URL.Path, "/stream") {
				next.ServeHTTP(w, r)
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), timeout)
			defer cancel()
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RateLimiter implements fixed-window rate limiting per identity (authenticated admin ID or client IP).
type RateLimiter struct {
	mu          sync.Mutex
	window      time.Duration
	limit       int
	counters    map[string]int
	windowIndex int64
}

// NewRateLimiter creates a fixed-window rate limiter.
func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	if limit <= 0 {
		limit = 120
	}
	if window <= 0 {
		window = time.Minute
	}
	return &RateLimiter{
		window:   window,
		limit:    limit,
		counters: make(map[string]int),
	}
}

func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		now := time.Now().UTC()
		winIdx := now.UnixNano() / int64(rl.window)

		identity := ClientIP(r)
		if user := GetAdminUser(r.Context()); user != nil {
			identity = "user:" + user.ID
		}

		rl.mu.Lock()
		if rl.windowIndex != winIdx {
			rl.windowIndex = winIdx
			rl.counters = make(map[string]int)
		}
		rl.counters[identity]++
		count := rl.counters[identity]
		rl.mu.Unlock()

		if count > rl.limit {
			retrySec := int(rl.window.Seconds())
			if retrySec < 1 {
				retrySec = 1
			}
			w.Header().Set("Retry-After", strconv.Itoa(retrySec))
			WriteError(w, http.StatusTooManyRequests, "TOO_MANY_REQUESTS", "Rate limit exceeded. Please try again later.")
			return
		}

		next.ServeHTTP(w, r)
	})
}

// Authenticate validates the administrator session via HTTP-only cookie or Bearer token
// and enforces CSRF protection on state-mutating requests.
func Authenticate(authSvc *service.AuthService, secCfg config.SecurityConfig) func(http.Handler) http.Handler {
	cookieName := secCfg.CookieName
	if cookieName == "" {
		cookieName = "gt_sec_session"
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			sessionID := ""
			usedCookie := false

			if c, err := r.Cookie(cookieName); err == nil && strings.TrimSpace(c.Value) != "" {
				sessionID = strings.TrimSpace(c.Value)
				usedCookie = true
			} else if authHeader := r.Header.Get("Authorization"); strings.HasPrefix(authHeader, "Bearer ") {
				sessionID = strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
			}

			if sessionID == "" {
				WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
				return
			}

			sess, user, err := authSvc.ValidateSession(r.Context(), sessionID)
			if err != nil || sess == nil || user == nil {
				WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Invalid or expired session")
				return
			}

			// Enforce CSRF validation for mutating requests authenticated via cookie
			if usedCookie && isMutatingMethod(r.Method) {
				csrfHeader := strings.TrimSpace(r.Header.Get("X-CSRF-Token"))
				if csrfHeader == "" || subtle.ConstantTimeCompare([]byte(csrfHeader), []byte(sess.CSRFToken)) != 1 {
					WriteError(w, http.StatusForbidden, "FORBIDDEN", "Invalid or missing CSRF token")
					return
				}
			}

			ctx := context.WithValue(r.Context(), userContextKey, user)
			ctx = context.WithValue(ctx, sessionContextKey, sess)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireRoles enforces Role-Based Access Control (RBAC).
func RequireRoles(roles ...string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(roles))
	for _, r := range roles {
		allowed[r] = true
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user := GetAdminUser(r.Context())
			if user == nil {
				WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
				return
			}
			if !allowed[user.Role] {
				WriteError(w, http.StatusForbidden, "FORBIDDEN", "Insufficient role permissions for this operation")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func isMutatingMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

// ClientIP extracts the client IP safely from RemoteAddr.
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}

