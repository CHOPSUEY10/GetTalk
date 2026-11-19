# GetTalk

**GetTalk** adalah aplikasi web perpesanan real-time (*real-time chat*) dengan perlindungan **End-to-End Encryption (E2EE)** di sisi klien, manajemen sesi & privasi terpadu, penyimpanan lampiran terenkripsi berbasis *Pre-signed URL*, serta modul mandiri **Host-Based Security Telemetry & Intrusion Detection System (IDS)**.

---

## Fitur Utama

### 1. End-to-End Encryption (E2EE) & Kriptografi Klien
- **Protokol Kriptografi:** Menggunakan **Web Crypto API** dengan kombinasi **ECDH / X3DH** (*Extended Triple Diffie-Hellman*), **Double Ratchet Algorithm** (*Perfect Forward Secrecy* & rotasi kunci sesi per pesan), **HKDF-SHA-256**, dan **AES-256-GCM**.
- **Zero Plaintext on Server:** Server dan database hanya menyimpan `body_ciphertext` dan `nonce`. Kunci privat tidak pernah meninggalkan perangkat klien (disimpan secara lokal di IndexedDB).
- **Verifikasi Out-of-Band:** Tersedia antarmuka verifikasi **Safety Number** dan pemindaian **QR Code** untuk memvalidasi identitas kunci publik lawan bicara.
- **Perlindungan Pergantian Perangkat (*Device Change Protection*):** Deteksi otomatis apabila kunci identitas lawan bicara berubah; transmisi pesan keluar ditahan dalam antrean (*outgoing message queue*) hingga pengguna menyetujui/memverifikasi kunci baru.
- **Lampiran Terenkripsi (*E2EE Attachments*):** File (maksimal 25 MB) beserta metadatanya dienkripsi dengan AES-256-GCM di browser sebelum diunggah melalui mekanisme *Pre-signed URL* (mendukung driver penyimpanan `local` berbasiskan HMAC maupun objek `s3` kompatibel seperti MinIO, Supabase Storage, Cloudflare R2, dan AWS S3).

### 2. Keamanan Akun, Sesi, & Privasi Terpadu
- **Autentikasi & Brute-Force Lockout:** Sesi berbasis HTTP-only cookie (`connect-pg-simple`), penguncian login sementara (1 menit) setelah 3 kali gagal berturut-turut, serta pembatasan laju (*rate limiting*) berlapis.
- **Multi-Factor Authentication (MFA):** Dukungan TOTP 2FA (RFC 6238) dengan enkripsi *secret at-rest* (`MFA_ENCRYPTION_KEY`), kode pemulihan sekali pakai (*recovery codes*), dan proteksi *replay* TOTP.
- **Manajemen Sesi & Pemulihan Akun:** Tinjau dan cabut sesi perangkat aktif, ubah kata sandi, verifikasi perubahan email, serta pemulihan kata sandi via OTP SMTP (`nodemailer`).
- **Kontrol Privasi & Pemblokiran:** Pengaturan visibilitas *Last Seen* dan status *Online* (`everyone`, `friends`, `nobody`), tanda baca (*read receipts*), indikator mengetik (*typing indicator*), izin pesan/grup, *disappearing timer*, serta manajemen daftar blokir pengguna (`blocked_users`).
- **Efisiensi WebSocket:** Pembatasan maksimum **3 koneksi WebSocket (Socket.IO) konkuren per akun** dengan sinkronisasi status *real-time*.

### 3. Security Telemetry & Intrusion Detection System (IDS) (`security/`)
Modul pemantauan infrastruktur pasif (*passive host-based monitoring*) yang berjalan secara terpisah dari aplikasi utama:
- **Network Layer (`Firewalld`):** Memantau event `FINAL_REJECT`, `REJECT`, dan `DROP` dari `journald`/kernel (`NET-001` Repeated Firewall Rejection, `NET-002` Port Scanning Indicators).
- **Web Layer (`Nginx`):** Membaca `access.log` (format JSON/combined) dan `error.log` secara *rotation-safe* dengan sanitasi parameter sensitif (`WEB-001` HTTP Request Flood, `WEB-002` Auth Failure Burst, `WEB-003` Suspicious Request Patterns).
- **Application Layer (`PM2`):** Memantau metrik CPU, memori, dan *restart delta* proses (`APP-001` High CPU, `APP-002` High Memory, `APP-003` Repeated Process Restart).
- **Cross-Layer Correlation (`COR-001`):** Korelasi anomali lintas layer dengan verifikasi *trusted reverse proxy* untuk mencegah pemalsuan header `X-Forwarded-For`.
- **Security Dashboard & RBAC:** Dashboard Svelte 5 + TypeScript dengan streaming *Server-Sent Events (SSE)*, autentikasi admin terisolasi + TOTP MFA + proteksi CSRF, serta kontrol akses berbasis peran (`viewer`, `analyst`, `admin`).

---

## Project Structure

```text
GetTalk/
├── frontend/               # Aplikasi Chat Utama — Svelte 5 + Vite 8 + Tailwind CSS v4
│   ├── src/
│   │   ├── components/     # Komponen UI (auth, chat, friends, attachments, layout, common)
│   │   ├── pages/          # Halaman aplikasi (Home, Chat, Friends, Settings, Login, dll.)
│   │   ├── stores/         # State management per domain (auth, user, friends, conversations, messages, socket, ui)
│   │   ├── services/       # Layer komunikasi & kriptografi (api/, socket/, crypto/)
│   │   ├── lib/            # Validator, error normalizer, logger
│   │   ├── routes/         # Konfigurasi routing SPA
│   │   └── config/         # Pembacaan environment variable frontend
│   └── tests/              # Unit & integration tests frontend (crypto, auth, pagination, settings, dll.)
│
├── backend/                # Server Chat Utama — Node.js + Express 5 + Socket.IO + Prisma 7.10
│   ├── prisma/             # Schema Prisma ORM (schema.prisma)
│   ├── migrations/         # File migrasi SQL PostgreSQL
│   ├── src/
│   │   ├── config/         # Konfigurasi env, Prisma, Redis, session
│   │   ├── controllers/    # HTTP request handlers
│   │   ├── services/       # Business logic, mailer, MFA, & storage drivers (local / S3)
│   │   ├── repositories/   # Akses data PostgreSQL via Prisma
│   │   ├── routes/         # Definisi endpoint REST API
│   │   ├── socket/         # Socket.IO server, event constants, & connection limiter
│   │   ├── middleware/     # Auth, rate-limit, error handler, & security middleware
│   │   └── validators/     # Validasi payload server-side
│   └── tests/              # Pengujian API & pengaturan backend
│
├── infra/                  # Konfigurasi Infrastruktur & Deployment
│   ├── docker-compose.yml  # Layanan Redis 7 (loopback development)
│   └── nginx/
│       └── gettalk.conf    # Template Nginx Reverse Proxy (2 subdomain: Frontend SPA & Backend API/WS)
│
├── security/               # Modul Mandiri Telemetry & Intrusion Detection System (IDS)
│   ├── backend/            # Go 1.23+ (Chi Router, pgx/v5, Collectors, IDS Engine, SSE Broker)
│   ├── frontend/           # Svelte 5 + TypeScript + Vite + Tailwind CSS v4 (Security Dashboard)
│   ├── database/           # Migrasi SQL, schema referensi, & seed aturan deteksi IDS
│   ├── configs/            # telemetry.yaml, detection-rules.yaml, log format Nginx & Firewalld
│   ├── deployments/        # Unit service systemd & konfigurasi Nginx monitor.gettalk.conf
│   ├── scripts/            # Skrip migrasi DB telemetri & pemeriksaan permission
│   └── docs/               # OpenAPI 3.0 spec, DEPLOYMENT.md, & SECURITY_MODEL.md
│
└── SECURITY.md             # Kebijakan keamanan repositori
```

---

## Technology Stack

### Main Chat Application
- **Frontend:** Svelte 5, Vite 8, Tailwind CSS v4, Socket.IO Client 4.8, `svelte-spa-router`, Web Crypto API & IndexedDB
- **Backend:** Node.js (`>=20.19.0`), Express 5, Socket.IO 4.8, Prisma ORM 7.10 (`@prisma/adapter-pg`), Bcrypt, Helmet, Nodemailer, AWS SDK v3 S3 Presigner
- **Database & Cache:** PostgreSQL (Data utama & sesi `connect-pg-simple`), Redis 7 (Registry kunci publik E2EE & kontrol koneksi)

### Security Telemetry & IDS (`security/`)
- **Backend & Collector:** Go (Chi router, `jackc/pgx/v5`, YAML config, Bcrypt, TOTP MFA, Server-Sent Events)
- **Dashboard Frontend:** Svelte 5, TypeScript, Vite, Tailwind CSS v4
- **Database:** PostgreSQL terdedikasi (`gettalk_security`) atau *in-memory repository* untuk mode pengembangan

---

## Prerequisites

Pastikan perangkat sudah terpasang:
- **Git**
- **Node.js** (`>= 20.19.0` atau `>= 22.12.0`) & **npm**
- **PostgreSQL** (14+)
- **Redis** (7+, dapat dijalankan melalui Docker Compose)
- **Go** (1.23+, opsional jika ingin menjalankan modul `security/backend`)

---

## Current Development Ports

| Service | Port | URL Default |
|---|---:|---|
| **Chat Frontend (Svelte/Vite)** | `5173` | `http://localhost:5173` |
| **Chat Backend (Express/Socket.IO)** | `3000` | `http://localhost:3000` |
| **Security IDS Frontend** | `5174` | `http://localhost:5174` |
| **Security IDS Backend (Go API/SSE)** | `4100` | `http://127.0.0.1:4100` |
| **PostgreSQL** | `5432` | `postgresql://localhost:5432` |
| **Redis** | `6379` | `redis://127.0.0.1:6379` |

---

## Getting Started

### 1. Clone Repository & Jalankan Redis

```bash
git clone <REPOSITORY_URL>
cd GetTalk
docker compose -f infra/docker-compose.yml up -d
```

Redis digunakan untuk menyimpan *registry* kunci publik E2EE serta manajemen batas sesi real-time (default `redis://127.0.0.1:6379`).

### 2. Setup & Jalankan Backend Utama

Salin template environment dan sesuaikan kredensial PostgreSQL (`DATABASE_URL`) serta `SESSION_SECRET`:

```bash
cd backend
cp .env.example .env.development
npm install            # otomatis menjalankan prisma generate
npm run db:deploy      # menerapkan migrasi database PostgreSQL
npm run dev
```

Backend akan berjalan pada `http://localhost:3000`.
Cek kesehatan layanan (*health check*):

```text
GET http://localhost:3000/health
```

Respons yang diharapkan:

```json
{
  "status": "ok"
}
```

### 3. Setup & Jalankan Frontend Utama

Buka terminal baru:

```bash
cd frontend
cp .env.example .env.development
npm install
npm run dev
```

Frontend utama dapat diakses pada `http://localhost:5173`.

### 4. Menjalankan Modul Security Telemetry & IDS (Opsional)

#### a. Security Backend (Go)
```bash
cd security/backend
go test -v ./...
go run ./cmd/telemetry --mode=all --config=../configs/telemetry.yaml
```
> Pada mode pengembangan (ketika `TELEMETRY_DATABASE_URL` tidak diatur), backend telemetri otomatis berjalan dengan *in-memory repository* dan membuat akun admin awal (`secadmin` / `SecAdmin!2026#GetTalk`).

#### b. Security Frontend (Svelte 5 + TypeScript)
```bash
cd security/frontend
npm install
npm run dev
```
Dashboard keamanan dapat diakses pada `http://localhost:5174`. Detail lengkap tersedia di [`security/README.md`](security/README.md).

---

## Environment Configuration

Baik `frontend/` maupun `backend/` mendukung pemuatan file environment berdasarkan mode (`development`, `staging`, `production`):

```text
.env.development
.env.staging
.env.production
```

Gunakan akhiran `.local` untuk konfigurasi rahasia atau lokal developer (diabaikan oleh Git):

```text
.env.development.local
.env.staging.local
.env.production.local
```

### Variabel Penting Backend (`backend/.env.example`)
- `HOST`, `PORT` (default `3000`), `NODE_ENV`, `CORS_ORIGIN`
- `DATABASE_URL`, `REDIS_URL`
- `SESSION_SECRET`, `MFA_ENCRYPTION_KEY`
- **Attachment Storage:** `STORAGE_DRIVER` (`local` atau `s3`), `STORAGE_DIR`, `ATTACHMENT_URL_TTL_SECONDS`, `ATTACHMENT_URL_SECRET`, serta `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`
- **SMTP Mailer:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- **Reverse Proxy & Cookies:** `TRUST_PROXY`, `COOKIE_SECURE`, `COOKIE_SAME_SITE`, `COOKIE_DOMAIN`

### Variabel Penting Frontend (`frontend/.env.example`)
- `VITE_APP_ENV` (`development` | `staging` | `production`)
- `VITE_API_URL` (contoh: `http://localhost:3000` atau `https://api.domainanda.com`)
- `VITE_SOCKET_URL` (contoh: `http://localhost:3000` atau `https://api.domainanda.com`)
- `VITE_API_TIMEOUT_MS` (default `10000`)

> **Peringatan Keamanan:** Semua variabel dengan awalan `VITE_` bersifat publik dan terekspos ke browser. Jangan pernah menaruh *secret* backend, kunci privat, atau kredensial database di environment frontend.

---

## Database (Prisma ORM 7.10)

Schema database aplikasi utama didefinisikan di [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma) dan dikelola menggunakan **Prisma Migrate**.

| Path | Keterangan |
|---|---|
| `backend/prisma/schema.prisma` | *Source of truth* skema database PostgreSQL |
| `backend/prisma.config.js` | Konfigurasi Prisma CLI (membaca `.env.<NODE_ENV>`) |
| `backend/migrations/` | Riwayat file migrasi SQL (wajib di-commit) |
| `backend/src/config/prisma.js` | Instansi bersama Prisma Client untuk layer repository |

### Daftar Tabel Aplikasi Utama
- `users` — Profil pengguna, hash kata sandi, konfigurasi TOTP MFA, *recovery codes*, penghitung gagal login, dan token perubahan email.
- `user_privacy_settings` — Preferensi privasi (*last seen*, status *online*, *read receipts*, *typing indicator*, izin pesan/grup, *disappearing timer*).
- `blocked_users` — Relasi pemblokiran antar pengguna.
- `password_reset_tokens` — Hash SHA-256 token OTP pemulihan kata sandi sekali pakai (kedaluwarsa 15 menit).
- `sessions` — Penyimpanan sesi `connect-pg-simple` (`sid`, `sess`, `expire`).
- `friendships` — Relasi pertemanan (`pending`, `accepted`, `rejected`).
- `conversations` & `conversation_members` — Metadata ruang percakapan (`direct`, `group`) dan daftar anggota.
- `messages` — Hanya menyimpan `body_ciphertext`, `nonce`, dan `client_message_id` (tanpa kolom plaintext).
- `message_receipts` — Status penerimaan pesan (`delivered`, `read`).
- `attachments` — Metadata terenkripsi (`metadata_ciphertext`, `metadata_nonce`) dan `storage_key` acak untuk objek lampiran.
- `security_events` — Log audit keamanan aplikasi (tanpa menyimpan kata sandi, token, atau plaintext).

### Perintah Prisma (`backend/`)

| Command | Fungsi |
|---|---|
| `npm run db:migrate -- --name <nama>` | Membuat migrasi baru setelah mengubah schema (development) |
| `npm run db:deploy` | Menerapkan migrasi tertunda (staging / production / CI) |
| `npm run db:status` | Melihat status migrasi database |
| `npm run db:generate` | Menghasilkan ulang Prisma Client |
| `npm run db:validate` | Memvalidasi file `schema.prisma` |
| `npm run db:studio` | Membuka antarmuka Prisma Studio |

---

## Pengujian (Testing)

Setiap modul dilengkapi dengan *test suite* otomatis:

```bash
# 1. Pengujian Frontend Utama (Crypto E2EE, Auth Flow, Pagination, Device Change Queue, Safety Number, Settings)
cd frontend
npm test

# 2. Pengujian Backend Utama (API & Settings)
cd ../backend
npm test

# 3. Pengujian Security Telemetry Backend (Unit, Integration, & Security Tests)
cd ../security/backend
go test -v ./...

# 4. Pengujian Security Telemetry Frontend
cd ../frontend
npm test
```

---

## Production Deployment

1. **Aplikasi Utama (2 Subdomain dengan Nginx Reverse Proxy):**
   - Gunakan konfigurasi [`infra/nginx/gettalk.conf`](infra/nginx/gettalk.conf) untuk menyajikan hasil build statis frontend (`frontend/dist`) pada subdomain aplikasi dan meneruskan trafik REST API + WebSocket (`/socket.io/`) ke Node.js (`127.0.0.1:3000`).
   - Pastikan `client_max_body_size 30M` aktif di blok Nginx API agar unggahan lampiran terenkripsi hingga 25 MB tidak ditolak.
   - Atur `TRUST_PROXY=1`, `COOKIE_SECURE=true`, dan `COOKIE_SAME_SITE=none` pada `backend/.env.production` untuk mendukung sesi lintas subdomain melalui HTTPS.
2. **Modul Security Telemetry & IDS:**
   - Gunakan database PostgreSQL terpisah (`gettalk_security`) dan akun layanan *least-privilege* (`gettalk-sec-api` serta `gettalk-sec-collector`).
   - Unit `systemd` tersedia di [`security/deployments/systemd/`](security/deployments/systemd/) dan konfigurasi reverse proxy tersedia di [`security/deployments/nginx/monitor.gettalk.conf`](security/deployments/nginx/monitor.gettalk.conf).
   - Panduan lengkap instalasi produksi dan model ancaman dapat dilihat di [`security/docs/DEPLOYMENT.md`](security/docs/DEPLOYMENT.md) dan [`security/docs/SECURITY_MODEL.md`](security/docs/SECURITY_MODEL.md).
