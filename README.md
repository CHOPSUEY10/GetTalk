# GetTalk

GetTalk adalah aplikasi web chatting real-time dengan perlindungan E2EE

## Project Structure

```text
chat-app/
├── frontend/       # Svelte/Vite
├── backend/        # Node.js + Express + Socket.IO
├── infra/          # Infrastructure configuration
├── security/       # Security-related configuration
└── docs/           # Project documentation
```

## Technology Stack

### Frontend

- Svelte
- Vite
- Socket.IO Client

### Backend

- Node.js
- Express
- Socket.IO

### Planned Infrastructure

- PostgreSQL
- Redis
- Docker

## Prerequisites

Pastikan sudah terinstall:

- Git
- Node.js
- npm

## Getting Started

Clone repository terlebih dahulu.

```bash
git clone <REPOSITORY_URL>
cd chat-app
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend akan berjalan pada:

```text
http://localhost:5173
```

### Backend

Buka terminal lain:

```bash
cd backend
npm install
npm run dev
```

Backend akan berjalan pada:

```text
http://localhost:5000
```

Health check:

```text
http://localhost:5000/health
```

Expected response:

```json
{
  "status": "ok"
}
```

## Environment

Frontend menggunakan environment:

```text
.env.development
.env.staging
.env.production
```

Backend juga menggunakan environment:

```text
.env.development
.env.staging
.env.production
```

File `.local` digunakan untuk konfigurasi pribadi developer dan tidak boleh di-commit.

Contoh:

```text
.env.development.local
.env.staging.local
.env.production.local
```


## Current Development Ports

| Service | Port |
|---|---:|
| Frontend | 5173 |
| Backend | 5000 |

PostgreSQL dan Redis akan ditambahkan pada tahap infrastructure bootstrap.

## Database (Prisma ORM)

Schema database didefinisikan di [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma)
dan dikelola dengan **Prisma Migrate** (Prisma ORM 7.10).

| Path | Keterangan |
|---|---|
| `backend/prisma/schema.prisma` | Source of truth schema database |
| `backend/prisma.config.js` | Konfigurasi Prisma CLI (membaca `.env.<NODE_ENV>`) |
| `backend/migrations/` | File migration SQL (wajib di-commit) |
| `backend/src/config/prisma.js` | Shared Prisma Client (hanya untuk repository) |

Tabel: `users`, `sessions`, `friendships`, `conversations`, `conversation_members`,
`messages`, `message_receipts`, `attachments`, `security_events`.

> Tabel `messages` hanya menyimpan `body_ciphertext` + `nonce` (E2EE). Tidak boleh ada kolom plaintext.
> Tabel `sessions` mengikuti format `connect-pg-simple` (`sid`, `sess`, `expire`).

Pastikan PostgreSQL berjalan dan `DATABASE_URL` sudah diisi, lalu:

```bash
cd backend
npm install            # otomatis menjalankan prisma generate
npm run db:deploy      # menerapkan migration ke database
```

Perintah lainnya:

| Command | Fungsi |
|---|---|
| `npm run db:migrate -- --name <nama>` | Membuat migration baru setelah mengubah schema (development) |
| `npm run db:deploy` | Menerapkan migration (staging/production/CI) |
| `npm run db:status` | Melihat status migration |
| `npm run db:generate` | Generate ulang Prisma Client |
| `npm run db:validate` | Validasi schema |
| `npm run db:studio` | Membuka Prisma Studio |

Jangan mengubah tabel secara manual — semua perubahan schema harus melalui migration.