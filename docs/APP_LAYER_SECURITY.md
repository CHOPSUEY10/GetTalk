# Perlindungan keamanan lapisan aplikasi

Kontrol ini memperkuat API GetTalk, tetapi **bukan NGFW jaringan** dan tidak
menggantikan firewall, WAF, TLS, atau aturan keamanan pada platform hosting.
Perubahan ini hanya berlaku pada proses aplikasi; tidak mengubah `.env`,
aturan jaringan, atau konfigurasi server live.

## Kontrol yang diterapkan

- CORS memvalidasi daftar `CORS_ORIGIN` melalui `backend/src/config/cors.js`:
  menolak wildcard (`*`) saat `credentials: true`, memastikan protokol valid
  (`http://` atau `https://`), memvalidasi origin yang masuk terhadap allowlist
  multi-origin, hanya memberikan `Access-Control-Allow-Credentials: true` pada
  origin sah, serta mengizinkan header kustom E2EE (`X-Message-Id`,
  `X-Metadata-Ciphertext`, `X-Metadata-Nonce`) pada preflight (`OPTIONS`).
- Header respons menetapkan `nosniff`, mencegah framing, membatasi referrer,
  serta menonaktifkan akses kamera, mikrofon, dan geolokasi.
- Header `X-Powered-By` dinonaktifkan.
- Parser JSON membatasi body hingga 100 KiB; payload yang terlalu besar
  dikembalikan sebagai HTTP 413. Rute unggah terenkripsi tetap memakai batas
  tersendiri sebesar 26 MiB.
- Pembatasan laju berbasis Redis yang sudah ada tetap berlaku pada login,
  registrasi, verifikasi MFA, permintaan pertemanan, pengiriman pesan, dan
  unggahan. Jika Redis tidak tersedia, middleware rate limit yang ada
  menggunakan kebijakan fail-open agar gangguan Redis tidak menghentikan API;
  kondisi ini dicatat oleh logger.
- Autentikasi, otorisasi, validasi request, dan autentikasi Socket.IO tetap
  dijalankan oleh middleware/rute yang sudah ada.

## Batas penerapan

Backend hanya menambahkan kontrol di lapisan aplikasi. Saat aplikasi
dipublikasikan, gunakan HTTPS dan firewall/WAF/reverse proxy yang sesuai pada
infrastruktur. Jangan mengaktifkan `trust proxy` tanpa mengetahui topologi
proxy tepercaya, karena hal itu dapat membuat identitas IP untuk kontrol laju
berbasis alamat dapat dipalsukan.

Validasi perubahan kode dapat dijalankan dari direktori `backend` dengan
`npm test`. Pengujian integrasi membutuhkan layanan database dan Redis sesuai
konfigurasi lingkungan pengembangan.

## MFA berbasis TOTP

MFA TOTP dapat diaktifkan per akun dari menu **Keamanan**. Login akun yang
mengaktifkannya memerlukan kode 6 digit dari aplikasi autentikator. Setup
memerlukan konfirmasi password dan kode autentikator pertama; setelah aktif,
sepuluh kode pemulihan sekali pakai ditampilkan satu kali. Server menyimpan
secret TOTP dalam bentuk terenkripsi dan hanya menyimpan hash kode pemulihan.
Secret enkripsi diturunkan dari `MFA_ENCRYPTION_KEY` jika disediakan, atau
`SESSION_SECRET` sebagai fallback. Tetapkan secret enkripsi yang kuat dan
stabil sebelum MFA diaktifkan di deployment, lalu pulihkan dari backup yang
aman. Mengganti secret enkripsi tanpa prosedur re-enkripsi akan membuat
secret TOTP yang tersimpan tidak dapat dibaca.

Migration `20261026000000_add_totp_mfa` bersifat aditif dan mempertahankan
akun lama dalam keadaan MFA nonaktif. Terapkan migration ke database target
dengan prosedur deployment database project (`npm run db:deploy`) sebelum
menjalankan versi aplikasi yang menggunakan kolom MFA. Migration tidak
dijalankan otomatis saat startup. Simpan kode pemulihan di tempat aman; setiap
kode hanya bisa dipakai sekali.
