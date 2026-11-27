et -euo pipefail
umask 027

# Pastikan skrip dijalankan oleh secadmin, bukan langsung sebagai root
if [ "$(id -un)" != "secadmin" ]; then
  echo "Error: Jalankan skrip ini menggunakan akun 'secadmin' (tanpa sudo di depan)."
  exit 1
fi

REPO_DIR="/var/web/GetTalk"
FORCE_INSTALL="${1:-}"

# Helper untuk menjalankan perintah build milik aplikasi utama sebagai akun 'dev'
run_as_dev() {
  sudo -u dev -H bash -lc '
    set -euo pipefail
    umask 027
    REPO_DIR="$1"
    FORCE_INSTALL="$2"
    TARGET_CMD="$3"

    install_deps_if_needed() {
      if [ ! -d "node_modules" ] || [ "$FORCE_INSTALL" = "--install" ]; then
        echo "-> [dev] Menginstal dependencies untuk $(pwd)..."
        npm install || {
          echo "-> [dev] Mendeteksi konflik package-lock lintas OS, melakukan clean install..."
          rm -rf node_modules package-lock.json
          npm install
        }
      else
        echo "-> [dev] node_modules sudah ada, melewati npm install."
      fi
    }

    eval "$TARGET_CMD"
  ' _ "$REPO_DIR" "$FORCE_INSTALL" "$1"
}

install_deps_secadmin() {
  if [ ! -d "node_modules" ] || [ "$FORCE_INSTALL" = "--install" ]; then
    echo "-> [secadmin] Menginstal dependencies untuk $(pwd)..."
    npm install || {
      echo "-> [secadmin] Mendeteksi konflik package-lock lintas OS, melakukan clean install..."
      rm -rf node_modules package-lock.json
      npm install
    }
  else
    echo "-> [secadmin] node_modules sudah ada, melewati npm install."
  fi
}

echo "============================================================"
echo " [1/4] Build & Deploy Frontend Aplikasi Utama (sebagai dev)"
echo "============================================================"
run_as_dev '
  cd "$REPO_DIR/frontend"
  install_deps_if_needed
  npm run build
'
sudo mkdir -p /var/www/GetTalk/frontend/dist
sudo rm -rf /var/www/GetTalk/frontend/dist/*
sudo cp -r "$REPO_DIR/frontend/dist/." /var/www/GetTalk/frontend/dist/
sudo chown -R root:root /var/www/GetTalk/frontend/dist
sudo chmod -R a+rX /var/www/GetTalk/frontend/dist
sudo chcon -Rt httpd_sys_content_t /var/www/GetTalk/frontend/dist

echo "============================================================"
echo " [2/4] Build & Deploy Backend Aplikasi Utama (sebagai dev)"
echo "============================================================"
run_as_dev '
  cd "$REPO_DIR/backend"
  install_deps_if_needed
  npm run db:generate
  npm run db:deploy
  pm2 restart all --update-env
'

echo "============================================================"
echo " [3/4] Build & Deploy Frontend SecAdmin (sebagai secadmin)"
echo "============================================================"
cd "$REPO_DIR/security/frontend"
install_deps_secadmin
npm run build
sudo mkdir -p /var/www/GetTalk/security/frontend/dist
sudo rm -rf /var/www/GetTalk/security/frontend/dist/*
sudo cp -r dist/. /var/www/GetTalk/security/frontend/dist/
sudo chown -R root:root /var/www/GetTalk/security/frontend/dist
sudo chmod -R a+rX /var/www/GetTalk/security/frontend/dist
sudo chcon -Rt httpd_sys_content_t /var/www/GetTalk/security/frontend/dist

echo "============================================================"
echo " [4/4] Build & Deploy Backend SecAdmin (Go Telemetry & IDS)"
echo "============================================================"
cd "$REPO_DIR/security/backend"
mkdir -p bin
go build -o bin/gettalk-telemetry.new ./cmd/telemetry

sudo mkdir -p /opt/gettalk/security/backend/bin /opt/gettalk/security/configs /opt/gettalk/backend
sudo mv bin/gettalk-telemetry.new /opt/gettalk/security/backend/bin/gettalk-telemetry
sudo cp -r "$REPO_DIR/security/configs/"* /opt/gettalk/security/configs/

for envfile in "$REPO_DIR/backend"/.env*; do
  if [ -f "$envfile" ] && [ "$(basename "$envfile")" != ".env.example" ]; then
    sudo cp "$envfile" /opt/gettalk/backend/
  fi
done
for envfile in "$REPO_DIR/security/backend"/.env*; do
  if [ -f "$envfile" ] && [ "$(basename "$envfile")" != ".env.example" ]; then
    sudo cp "$envfile" /opt/gettalk/security/backend/
  fi
done

sudo chown -R gettalk-sec-api:gettalk-sec-api /opt/gettalk/security /opt/gettalk/backend
sudo chmod 600 /opt/gettalk/backend/.env* /opt/gettalk/security/backend/.env* 2>/dev/null || true
sudo chmod 755 /opt/gettalk/security/backend/bin/gettalk-telemetry
sudo chcon -Rt usr_t /opt/gettalk/security /opt/gettalk/backend 2>/dev/null || true
sudo chcon -t bin_t /opt/gettalk/security/backend/bin/gettalk-telemetry

sudo systemctl restart gettalk-security-api
sudo systemctl is-active gettalk-security-api

echo "============================================================"
echo " [SELESAI] Validasi & Reload Nginx"
echo "============================================================"
sudo nginx -t && sudo systemctl reload nginx
echo "Seluruh komponen GetTalk & SecAdmin berhasil di-build dan di-deploy!"
