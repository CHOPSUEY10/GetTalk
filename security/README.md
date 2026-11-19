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

In development mode (when `TELEMETRY_DATABASE_URL` is not set), the backend runs with an in-memory repository and seeds a bootstrap administrator (`secadmin` / `SecAdmin!2026#GetTalk`).

### 2. Frontend

```bash
cd security/frontend
npm install
npm test
npm run dev
```

