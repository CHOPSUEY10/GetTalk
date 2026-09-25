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