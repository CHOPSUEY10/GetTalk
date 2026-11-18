# GetTalk Security — Security Architecture & Threat Model

## 1. Passive Host-Based Monitoring Only

The GetTalk Security IDS is strictly a **passive observation and alerting system**:
- It **never** modifies `firewalld` rules or kernel netfilter policies automatically.
- It **never** blocks IP addresses or terminates PM2 processes automatically.
- `detection.passive_mode_only: true` is enforced at startup by the configuration validator.

## 2. Authentication, MFA, and RBAC

The dashboard uses an isolated administrator store (`security_admins` and `security_sessions`):
- **Password Storage:** Bcrypt hashed (`golang.org/x/crypto/bcrypt`).
- **Brute-Force Protection:** Accounts lock for 15 minutes after 5 consecutive failed password attempts; `/api/v1/auth/*` endpoints enforce strict rate limiting (`429 Too Many Requests` with `Retry-After`).
- **TOTP MFA:** RFC 6238 6-digit SHA-1 codes with secrets encrypted at rest using AES-256-GCM (`TELEMETRY_MFA_ENCRYPTION_KEY`).
- **Session & CSRF:** HTTP-only session cookie (`gt_sec_session`) paired with constant-time `X-CSRF-Token` verification on all state-mutating requests (`POST`, `PATCH`, `PUT`, `DELETE`).
- **Role-Based Access Control (RBAC):**
  - `viewer`: Read-only access to dashboard overview, network/web/application telemetry, events, alerts, rules, and SSE stream.
  - `analyst`: All `viewer` permissions + alert acknowledgement/resolution (`PATCH /api/v1/alerts/:id`) and audit log inspection (`GET /api/v1/audit-logs`).
  - `admin`: All `analyst` permissions + detection rule creation/modification (`POST /api/v1/rules`, `PATCH /api/v1/rules/:id`) and retention policy updates (`PATCH /api/v1/settings/retention`).

## 3. Reverse Proxy & Cross-Layer Correlation Safety

- The Nginx collector only trusts `X-Forwarded-For` when `trusted_reverse_proxy: true` and `remote_addr` matches the configured `trusted_proxies` allowlist (`127.0.0.1`, `::1`).
- Cross-layer correlation (`COR-001`) checks `trusted_proxy_verified == true` before correlating an IP address between Firewalld and Nginx logs, preventing spoofed `X-Forwarded-For` headers from triggering false cross-layer alerts.

## 4. Log Sanitization & Subprocess Isolation

- **Nginx Collector:** Strips ASCII control characters, bounds line and field lengths, and redacts sensitive query parameters (`token`, `password`, `secret`, `key`, `otp`, `sid`) before persistence.
- **PM2 Collector:** Executes `pm2 jlist` directly via `exec.CommandContext` with a 4-second timeout and fixed arguments — never invoking a shell or accepting user-supplied arguments.

