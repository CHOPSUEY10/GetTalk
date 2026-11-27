et -euo pipefail
umask 027

# Pastikan dijalankan oleh secadmin, bukan langsung sebagai root
if [ "$(id -un)" != "secadmin" ]; then
  echo "Error: Jalankan skrip ini menggunakan akun 'secadmin' (tanpa sudo di depan)."
  exit 1
fi

if ! command -v trivy >/dev/null 2>&1; then
  echo "Error: Trivy belum terinstal. Instal Trivy terlebih dahulu di server."
  exit 1
fi

REPO_DIR="/var/web/GetTalk"
MODE="${1:-}"
TRIVY_EXIT_CODE=0

# Gunakan opsi --strict untuk menggagalkan skrip jika ditemukan temuan HIGH/CRITICAL
if [ "$MODE" = "--strict" ]; then
  TRIVY_EXIT_CODE=1
fi

echo "============================================================"
echo " [1/3] Menarik Pembaruan Kode (Git Pull)"
echo "============================================================"
sudo git config --global --add safe.directory "$REPO_DIR"
sudo git -C "$REPO_DIR" pull

echo "============================================================"
echo " [2/3] Memulihkan Kepemilikan & Hak Akses Folder"
echo "============================================================"
sudo chown -R secadmin:dev "$REPO_DIR"
sudo chown -R dev:admin "$REPO_DIR/frontend" "$REPO_DIR/backend"

sudo find "$REPO_DIR" -type d -not -path "*/node_modules/*" -exec chmod 2750 {} +
sudo find "$REPO_DIR" -type f -not -path "*/node_modules/*" -not -name "*.sh" -exec chmod 640 {} +
sudo find "$REPO_DIR/infra" -maxdepth 1 -type f -name "*.sh" -exec chmod 740 {} +

echo "============================================================"
echo " [3/3] Security Scan dengan Trivy (Vuln, Secret, Misconfig)"
echo "============================================================"
# Jalankan sebagai secadmin (read-only ke frontend/backend lewat grup admin).
# File .env produksi diabaikan agar tidak memicu false positive secret scanner,
# namun secret yang ter-hardcode di kode sumber tetap akan tertangkap.
trivy fs \
  --scanners vuln,secret,misconfig \
  --severity HIGH,CRITICAL \
  --skip-dirs .git \
  --skip-dirs node_modules \
  --skip-dirs dist \
  --skip-files backend/.env \
  --skip-files security/backend/.env \
  --exit-code "$TRIVY_EXIT_CODE" \
  "$REPO_DIR"

echo "============================================================"
echo " [SELESAI] Pull, reset hak akses, dan scan Trivy tuntas."
echo "============================================================"
