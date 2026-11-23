# GetTalk Security — Telemetry & Intrusion Detection System (IDS)

An independent, passive host-based infrastructure telemetry and intrusion detection module inside the GetTalk repository (`GetTalk/security/`).

## Monitored Infrastructure Layers

1. **Network Layer — Firewalld (`internal/collector/firewall`):**
   - Streams and parses kernel/journald `FINAL_REJECT`, `REJECT`, and `DROP` events.
   - Extracts source/destination IPs, ports, protocols, interfaces, and per-IP frequency.
   - Evaluates `NET-001` (Repeated firewall rejection) and `NET-002` (Port scanning indicators).
2. **Web Layer — Nginx (`internal/collector/nginx`):**
   - Incrementally tails `/var/log/nginx/access.log` (structured JSON or combined format) and `/var/log/nginx/error.log` with rotation-safe checkpoints (`ingestion_checkpoints`).
   - Tracks status distributions, avg/P95/P99 latency, top endpoints, and sanitizes URIs.
   - Evaluates `WEB-001` (HTTP request flood), `WEB-002` (Authentication failure burst), and `WEB-003` (Suspicious request patterns).
3. **Application Layer — PM2 (`internal/collector/pm2`):**
   - Polls `pm2 jlist` every 5 seconds via a timeout-bounded subprocess without shell invocation.
   - Tracks CPU%, memory usage, restart deltas, and process status.
   - Evaluates `APP-001` (High CPU usage), `APP-002` (High memory usage), and `APP-003` (Repeated process restart).
4. **Cross-Layer Correlation (`COR-001`):**
   - Correlates verified source IPs and concurrent anomalies across Firewalld, Nginx, and PM2.
5. **SIEM Critical Event Email Notification (`internal/service/notification.go` & `internal/detection/engine.go`):**
   - Inspects incoming SIEM security events (`POST /api/v1/events` and `POST /api/v1/siem/events`) as well as automated IDS critical alerts (e.g. `COR-001`) for `critical` severity (case-insensitive).
   - Dispatches email alerts to `secadmin` asynchronously via goroutines so HTTP ingestion latency is unaffected.
   - Enforces per-`source_ip` / per-`event_id` notification cooldowns using **Upstash Redis** (`SetNX` with configurable TTL, default `300s`) to prevent email flooding, with strict CRLF/header-injection validation.
6. **GetTalk Chat Server Kill Switch (`security/backend` Control + `backend/` Enforcement via Shared Upstash Redis):**
   - Controlled by `secadmin` (`admin` role) via strictly authenticated, CSRF-protected endpoints in `security/backend` (`GET/POST/PATCH /api/v1/admin/kill-switch`), storing the active/inactive boolean state in **Upstash Redis** (default key: `siem:backend:enabled`).
   - **Enforcement on GetTalk Chat Server (`backend/`):** Express middleware (`backend/src/middleware/kill-switch.middleware.js`) and Socket.IO middleware (`backend/src/socket/middleware.js` + `handlers.js`) check `siem:backend:enabled` in Upstash Redis. When set to `false`, the **Chat Server** rejects `/api/*` requests with `503 Service Unavailable` (`SERVICE_UNAVAILABLE`) and blocks WebSocket chat connections/events, while the **SIEM Console (`security/`) remains 100% operational** so SecAdmin can continue monitoring and re-enable the Chat Server at any time.
   - Records every switch toggle in the SIEM audit log (`system.kill_switch_disabled` / `system.kill_switch_enabled`) and sends an asynchronous warning email to `secadmin` whenever the Chat Server is disabled.

## Directory Structure

```text
security/
├── backend/          # Go + Chi + pgx/v5 REST API, SSE Broker, Collectors, and IDS Engine
├── frontend/         # Svelte 5 + TypeScript + Vite + Tailwind CSS v4 Security Dashboard
├── database/         # PostgreSQL migrations, seeds, and reference schema
├── configs/          # telemetry.yaml, detection-rules.yaml, nginx & firewalld configs
├── scripts/          # Migration and permission verification scripts
├── deployments/      # systemd service units and Nginx reverse proxy template
└── docs/             # OpenAPI 3.0 spec, Deployment Guide, and Security Model
```

## Quick Start (Development)

### 1. Backend

```bash
cd security/backend
go test -v ./...
go run ./cmd/telemetry --mode=all --config=../configs/telemetry.yaml
```

In development mode (when `TELEMETRY_DATABASE_URL` is not set), the backend runs with an in-memory repository and seeds a bootstrap administrator (`secadmin` / `SecAdmin!2026#GetTalk`). When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are not set, the backend automatically uses an in-memory Redis store with TTL support for local development and testing.

### Environment Variables (`security/backend/.env.example`)

| Variable | Description | Default |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint URL | *(in-memory fallback in dev/test)* |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST Bearer token | *(none)* |
| `TELEMETRY_KILL_SWITCH_KEY` | Redis key storing backend kill switch state (`true`/`false`) | `siem:backend:enabled` |
| `TELEMETRY_ALERT_COOLDOWN_SECONDS` | Cooldown TTL in seconds (`SetNX`) for critical event emails | `300` |
| `TELEMETRY_SMTP_HOST` | SMTP server hostname for critical alerts & kill switch warnings | *(no-op in dev/test)* |
| `TELEMETRY_SMTP_PORT` | SMTP server port | `587` |
| `TELEMETRY_SMTP_USER` | SMTP authentication username | *(none)* |
| `TELEMETRY_SMTP_PASS` | SMTP authentication password | *(none)* |
| `TELEMETRY_SMTP_FROM` | Sender address for SIEM alert emails | `GetTalk SIEM <no-reply@gettalk.example>` |
| `TELEMETRY_SECADMIN_EMAIL` | Recipient address for `secadmin` critical alerts | `secadmin@gettalk.example` |

### 2. Frontend

```bash
cd security/frontend
npm install
npm test
npm run dev
```

