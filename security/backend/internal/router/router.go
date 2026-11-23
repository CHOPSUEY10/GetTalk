package router

import (
	"net/http"
	"time"

	"github.com/gettalk/security/backend/internal/config"
	"github.com/gettalk/security/backend/internal/handler"
	"github.com/gettalk/security/backend/internal/middleware"
	"github.com/gettalk/security/backend/internal/models"
	"github.com/gettalk/security/backend/internal/service"
	"github.com/go-chi/chi/v5"
)

// NewRouter builds the Chi HTTP router with security headers, CORS, rate limiting, authentication, and RBAC.
func NewRouter(
	cfg *config.Config,
	authSvc *service.AuthService,
	h *handler.Handler,
) http.Handler {
	r := chi.NewRouter()

	isProd := cfg.Server.Environment == "production"
	timeout := time.Duration(cfg.Server.RequestTimeoutSeconds) * time.Second

	globalLimiter := middleware.NewRateLimiter(cfg.Security.RateLimitRequestsPerMinute, time.Minute)
	authLimiter := middleware.NewRateLimiter(cfg.Security.AuthRateLimitPerMinute, time.Minute)

	r.Use(middleware.SecurityHeaders(isProd))
	r.Use(middleware.CORS(cfg.Server.CORSAllowedOrigins))
	r.Use(middleware.RequestTimeout(timeout))

	r.Get("/health", h.Health)

	r.Route("/api/v1", func(v1 chi.Router) {
		v1.Get("/health", h.Health)

		// Public authentication routes with strict brute-force rate limiting
		v1.Group(func(pub chi.Router) {
			pub.Use(authLimiter.Middleware)
			pub.Post("/auth/login", h.Login)
			pub.Post("/auth/mfa/verify", h.VerifyMFA)
		})

		// Authenticated routes
		v1.Group(func(priv chi.Router) {
			priv.Use(middleware.Authenticate(authSvc, cfg.Security))
			priv.Use(globalLimiter.Middleware)

			// Session & MFA management (outside kill switch so administrators can always authenticate)
			priv.Get("/auth/session", h.GetSession)
			priv.Post("/auth/logout", h.Logout)
			priv.Post("/auth/mfa/setup", h.SetupMFA)
			priv.Post("/auth/mfa/enable", h.EnableMFA)

			// Separate Administrator Kill Switch endpoints (outside kill switch middleware so backend can be re-enabled)
			priv.Group(func(killSwitchAdmin chi.Router) {
				killSwitchAdmin.Use(middleware.RequireRoles(models.RoleAdmin))
				killSwitchAdmin.Get("/admin/kill-switch", h.GetKillSwitch)
				killSwitchAdmin.Post("/admin/kill-switch", h.UpdateKillSwitch)
				killSwitchAdmin.Patch("/admin/kill-switch", h.UpdateKillSwitch)
				killSwitchAdmin.Put("/admin/kill-switch", h.UpdateKillSwitch)

				killSwitchAdmin.Get("/settings/kill-switch", h.GetKillSwitch)
				killSwitchAdmin.Post("/settings/kill-switch", h.UpdateKillSwitch)
				killSwitchAdmin.Patch("/settings/kill-switch", h.UpdateKillSwitch)
				killSwitchAdmin.Put("/settings/kill-switch", h.UpdateKillSwitch)
			})

			// Main SIEM & Telemetry routes protected by the Backend Kill Switch middleware
			priv.Group(func(siem chi.Router) {
				siem.Use(middleware.KillSwitch(h.IsBackendEnabled))

				// SIEM security event ingestion endpoints
				siem.Post("/events", h.IngestEvent)
				siem.Post("/siem/events", h.IngestEvent)

				// Read-only telemetry & monitoring routes (accessible to admin, analyst, viewer)
				siem.Get("/dashboard/overview", h.DashboardOverview)
				siem.Get("/dashboard/traffic", h.DashboardTraffic)
				siem.Get("/network/events", h.NetworkEvents)
				siem.Get("/network/statistics", h.NetworkStatistics)
				siem.Get("/web/requests", h.WebRequests)
				siem.Get("/web/statistics", h.WebStatistics)
				siem.Get("/application/processes", h.ApplicationProcesses)
				siem.Get("/application/metrics", h.ApplicationMetrics)
				siem.Get("/events", h.Events)
				siem.Get("/alerts", h.Alerts)
				siem.Get("/rules", h.Rules)
				siem.Get("/settings", h.GetSettings)
				siem.Get("/stream", h.Stream)

				// Analyst & Admin routes (alert lifecycle management & audit log viewing)
				siem.Group(func(analyst chi.Router) {
					analyst.Use(middleware.RequireRoles(models.RoleAdmin, models.RoleAnalyst))
					analyst.Patch("/alerts/{id}", h.UpdateAlert)
					analyst.Get("/audit-logs", h.AuditLogs)
				})

				// Administrator-only routes (IDS rule creation/modification & retention configuration)
				siem.Group(func(admin chi.Router) {
					admin.Use(middleware.RequireRoles(models.RoleAdmin))
					admin.Post("/rules", h.CreateRule)
					admin.Patch("/rules/{id}", h.UpdateRule)
					admin.Patch("/settings/retention", h.UpdateRetentionSettings)
				})
			})
		})
	})

	r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		middleware.WriteError(w, http.StatusNotFound, "ROUTE_NOT_FOUND", "Endpoint not found")
	})

	return r
}

