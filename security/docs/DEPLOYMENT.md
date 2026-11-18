# GetTalk Security — Production Deployment Guide

This guide describes how to deploy the **GetTalk Security Telemetry & Intrusion Detection System (IDS)** independently from the main GetTalk chat application on Rocky Linux / RHEL.

> **Important:** Do not reuse the main GetTalk application database or service account credentials. All production installation, firewall policy changes, and systemd service activations require explicit administrator authorization.

---

## 1. Dedicated PostgreSQL Telemetry Database

Create a dedicated database and least-privilege user for the telemetry module:

```sql
CREATE USER telemetry_user WITH PASSWORD '<STRONG_RANDOM_PASSWORD>';
CREATE DATABASE gettalk_security OWNER telemetry_user;
```

Run the migration and default IDS rule seeds:

```bash
export TELEMETRY_DATABASE_URL="postgresql://telemetry_user:<PASSWORD>@127.0.0.1:5432/gettalk_security?sslmode=disable"
./security/scripts/migrate.sh up
```

---

## 2. Least-Privilege Service Accounts

Separate the API service account from the Collector service account:

```bash
# API service user (no access to host logs)
sudo useradd --system --no-create-home --shell /sbin/nologin gettalk-sec-api

# Collector service user (read-only access to systemd-journal and nginx logs)
sudo useradd --system --no-create-home --shell /sbin/nologin -G systemd-journal,adm,nginx gettalk-sec-collector
```

Verify permissions before starting the collector:

```bash
sudo -u gettalk-sec-collector ./security/scripts/check-permissions.sh
```

---

## 3. Build Backend & Frontend Artifacts

### Backend (Go)

```bash
cd security/backend
go build -o bin/gettalk-telemetry ./cmd/telemetry
```

### Frontend (Svelte + Vite Static Build)

```bash
cd security/frontend
npm ci
npm run build
```

Copy `security/frontend/dist` to `/var/www/GetTalk/security/frontend/dist`.

---

## 4. Systemd Services

Install the unit files from `security/deployments/systemd/`:

- `gettalk-security-api.service`: Runs `--mode=api` on `127.0.0.1:4100`.
- `gettalk-security-collector.service`: Runs `--mode=collector` with read-only access to `/var/log/nginx` and `systemd-journal`.

---

## 5. Nginx Reverse Proxy & Structured JSON Logs

1. Copy `security/configs/nginx/log_format_json.conf` to `/etc/nginx/conf.d/gettalk-telemetry-log.conf`.
2. Copy `security/deployments/nginx/monitor.gettalk.conf` to `/etc/nginx/conf.d/monitor.gettalk.conf` and update `server_name monitor.gettalk.example`.
3. Validate and reload Nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

