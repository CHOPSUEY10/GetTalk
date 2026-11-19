#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$HOME/GetTalk"
FORCE_INSTALL="${1:-}"

install_deps_if_needed() {
  if [ ! -d "node_modules" ] || [ "$FORCE_INSTALL" = "--install" ]; then
    echo "-> Menginstal dependencies untuk $(pwd)..."
    npm install || {
      echo "-> Mendeteksi konflik package-lock lintas OS, melakukan clean install..."
      rm -rf node_modules package-lock.json
      npm install
    }
  else
    echo "-> node_modules sudah ada, melewati npm install (gunakan './deploy.sh --install' jika ada package baru)."
  fi
}

echo "============================================================"
echo " [1/4] Build & Deploy Frontend Aplikasi Utama (GetTalk)"
echo "============================================================"
cd "$REPO_DIR/frontend"
install_deps_if_needed
npm run build
# Bersihkan folder target Nginx dan salin hasil build frontend/dist ke sana
sudo mkdir -p /var/www/GetTalk/frontend/dist
sudo rm -rf /var/www/GetTalk/frontend/dist/*
sudo cp -r dist/* /var/www/GetTalk/frontend/dist/
# Pastikan permission & SELinux context
sudo chmod -R a+rX /var/www/GetTalk/frontend/dist
sudo chcon -Rt httpd_sys_content_t /var/www/GetTalk/frontend/dist

echo "============================================================"
echo " [2/4] Build & Deploy Backend Aplikasi Utama (Node.js/PM2)"
echo "============================================================"
cd "$REPO_DIR/backend"
install_deps_if_needed
npm run db:generate
npm run db:deploy
# Restart proses backend utama di PM2
pm2 restart all

echo "============================================================"
echo " [3/4] Build & Deploy Frontend SecAdmin (Security Dashboard)"
echo "============================================================"
cd "$REPO_DIR/security/frontend"
install_deps_if_needed
npm run build
# Bersihkan folder target Nginx dan salin hasil build security/frontend/dist ke sana
sudo mkdir -p /var/www/GetTalk/security/frontend/dist
sudo rm -rf /var/www/GetTalk/security/frontend/dist/*
sudo cp -r dist/* /var/www/GetTalk/security/frontend/dist/
# Pastikan permission & SELinux context
sudo chmod -R a+rX /var/www/GetTalk/security/frontend/dist
sudo chcon -Rt httpd_sys_content_t /var/www/GetTalk/security/frontend/dist

echo "============================================================"
echo " [4/4] Build & Deploy Backend SecAdmin (Go Telemetry & IDS)"
echo "============================================================"
cd "$REPO_DIR/security/backend"
mkdir -p bin
go build -o bin/gettalk-telemetry.new ./cmd/telemetry
# Salin binary terbaru & sinkronkan konfigurasi ke /opt/gettalk/security
sudo mkdir -p /opt/gettalk/security/backend/bin /opt/gettalk/security/configs
sudo mv bin/gettalk-telemetry.new /opt/gettalk/security/backend/bin/gettalk-telemetry
sudo cp -r "$REPO_DIR/security/configs/"* /opt/gettalk/security/configs/
# Pastikan kepemilikan, permission executable, & SELinux context (agar tidak 203/EXEC)
sudo chown gettalk-sec-api:gettalk-sec-api /opt/gettalk/security/backend/bin/gettalk-telemetry
sudo chmod 755 /opt/gettalk/security/backend/bin/gettalk-telemetry
sudo chcon -t bin_t /opt/gettalk/security/backend/bin/gettalk-telemetry
# Restart systemd service SecAdmin
sudo systemctl restart gettalk-security-api
sudo systemctl is-active gettalk-security-api

echo "============================================================"
echo " [SELESAI] Validasi & Reload Nginx"
echo "============================================================"
sudo nginx -t && sudo systemctl reload nginx
echo "Seluruh komponen GetTalk & SecAdmin berhasil di-build dan di-deploy!"