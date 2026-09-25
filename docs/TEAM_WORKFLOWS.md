# GetTalk Team Workflow

Dokumen ini menjelaskan cara anggota tim mendapatkan repository, melakukan development, dan mengirim perubahan ke repository utama.

## 1. Fork Repository

Buka halaman repository utama GetTalk di GitHub.

Klik:

```text
Fork
```

Pilih akun GitHub pribadi sebagai owner fork.

Setelah selesai, setiap anggota akan memiliki repository sendiri.

Contoh:

```text
Repository utama:
https://github.com/ORGANIZATION/gettalk

Fork anggota:
https://github.com/ANGGOTA/gettalk
```

Repository utama disebut:

```text
main
```

Repository pribadi disebut:

```text
origin
```

---

## 2. Clone Fork

Clone repository milik sendiri:

```bash
git clone https://github.com/ANGGOTA/gettalk.git
```

Masuk ke project:

```bash
cd gettalk
```

Periksa remote:

```bash
git remote -v
```

Hasil awal kurang lebih:

```text
origin  https://github.com/ANGGOTA/gettalk.git (fetch)
origin  https://github.com/ANGGOTA/gettalk.git (push)
```

---

## 3. Tambahkan Repository Utama sebagai main

Tambahkan repository utama:

```bash
git remote add main https://github.com/ORGANIZATION/gettalk.git
```

Periksa kembali:

```bash
git remote -v
```

Hasil yang diharapkan:

```text
origin    https://github.com/ANGGOTA/gettalk.git (fetch)
origin    https://github.com/ANGGOTA/gettalk.git (push)

main  https://github.com/ORGANIZATION/gettalk.git (fetch)
main  https://github.com/ORGANIZATION/gettalk.git (push)
```

Catatan:

Developer biasanya melakukan:

```text
pull dari main
push ke origin
```

---

## 4. Install Dependency

Frontend:

```bash
cd frontend
npm install
```

Backend:

```bash
cd ../backend
npm install
```

---

## 5. Buat Environment Lokal

Jangan mengubah file environment standar jika hanya membutuhkan konfigurasi lokal.

Gunakan file:

```text
frontend/.env.development.local
backend/.env.development.local
```

Contoh frontend:

```env
VITE_APP_ENV=development
VITE_API_URL=http://localhost:3000
VITE_SOCKET_URL=http://localhost:3000
VITE_API_TIMEOUT_MS=10000
```

Contoh backend:

```env
NODE_ENV=development
HOST=0.0.0.0
PORT=3000
CORS_ORIGIN=http://localhost:5173
```

File `.local` tidak boleh di-commit.

---

## 6. Jalankan Backend

Terminal pertama:

```bash
cd backend
npm run dev
```

Test:

```text
http://localhost:3000/health
```

Expected:

```json
{
  "status": "ok"
}
```

---

## 7. Jalankan Frontend

Terminal kedua:

```bash
cd frontend
npm run dev
```

Buka:

```text
http://localhost:5173
```

---

## 8. Pastikan Working Tree Bersih

Sebelum mulai bekerja:

```bash
git status
```

Pastikan tidak ada perubahan yang tidak diketahui.

---

## 9. Update dari Repository Utama

Sebelum membuat feature branch:

```bash
git fetch main
```

Kemudian:

```bash
git checkout main
```

Update branch:

```bash
git pull main main
```

Update fork pribadi:

```bash
git push origin main
```

---

## 10. Buat Feature Branch

Jangan bekerja langsung di `main`.

Contoh:

```bash
git checkout -b feature/authentication
```

atau:

```bash
git checkout -b feature/chat-message
```

atau:

```bash
git checkout -b fix/socket-connection
```

---

## 11. Kerjakan Perubahan

Setelah selesai, periksa:

```bash
git status
```

Kemudian test aplikasi.

Minimal untuk perubahan backend:

```bash
npm run dev
```

dan test:

```text
GET /health
```

Untuk perubahan frontend:

```bash
npm run dev
```

dan pastikan aplikasi dapat dibuka.

---

## 12. Commit

Lihat perubahan:

```bash
git diff
```

Tambahkan file:

```bash
git add .
```

Kemudian commit:

```bash
git commit -m "feat: add authentication module"
```

Contoh commit lainnya:

```bash
git commit -m "feat: add socket connection handler"
git commit -m "fix: fix socket cors configuration"
git commit -m "docs: update team workflow"
git commit -m "chore: add backend bootstrap"
```

---

## 13. Push ke Fork

Push branch:

```bash
git push -u origin feature/authentication
```

Branch sekarang berada di repository fork pribadi.

---

## 14. Buat Pull Request

Buka repository fork di GitHub.

GitHub biasanya akan menampilkan:

```text
Compare & pull request
```

Klik tombol tersebut.

Pastikan arah Pull Request adalah:

```text

base branch:
main

compare branch:
feature/authentication
```



---

## 15. Isi Pull Request

Gunakan informasi berikut:

### Description

Jelaskan perubahan yang dilakukan.

Contoh:

```text
Menambahkan bootstrap authentication module.

Perubahan:
- Menambahkan struktur module auth
- Menambahkan route authentication
- Menambahkan middleware authentication

Testing:
- npm run dev
- GET /health
```

### Checklist

```text
- [ ] Code sudah ditest
- [ ] Tidak ada secret yang di-commit
- [ ] Environment baru sudah didokumentasikan
- [ ] Tidak mengubah main secara langsung
- [ ] Tidak ada file sementara yang ikut di-commit
```

---

## 16. Setelah Pull Request Di-merge

Setelah PR selesai di-merge, jangan terus menggunakan branch lama.

Kembali ke main:

```bash
git checkout main
```

Update dari main:

```bash
git pull main main
```

Update fork:

```bash
git push origin main
```

Hapus feature branch lokal:

```bash
git branch -d feature/authentication
```

Jika branch remote di fork juga ingin dihapus:

```bash
git push origin --delete feature/authentication
```

---

## 17. Memulai Feature Berikutnya

Selalu mulai dari `main` terbaru:

```bash
git checkout main
git pull main main
git push origin main
```

Kemudian buat branch baru:

```bash
git checkout -b feature/nama-fitur
```

Jangan membuat feature branch baru dari feature branch lama kecuali memang diperlukan.

---

# Quick Reference

### Pertama kali clone

```bash
git clone https://github.com/ANGGOTA/gettalk.git
cd gettalk

git remote add main https://github.com/ORGANIZATION/gettalk.git
```

### Mulai pekerjaan

```bash
git fetch main
git checkout main
git pull main main
git push origin main

git checkout -b feature/nama-fitur
```

### Setelah selesai

```bash
git status
git diff

git add .
git commit -m "feat: description"

git push -u origin feature/nama-fitur
```

Kemudian buat Pull Request ke:

```text
ORGANIZATION/gettalk:main
```

### Setelah PR di-merge

```bash
git checkout main
git pull main main
git push origin main
```