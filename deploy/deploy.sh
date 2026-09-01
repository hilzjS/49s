#!/usr/bin/env bash
# =============================================================================
# UK49s Platform — Production Deployment Script
# Run this ON your VPS as root (or with sudo)
# =============================================================================
set -euo pipefail

# ─── Configuration ──────────────────────────────────────────────────────────
APP_NAME="uk49s"
APP_USER="uk49s"
APP_DIR="/opt/uk49s"
GIT_REPO="${GIT_REPO:-}"      # Set via env or argument: GIT_REPO=https://github.com/USER/repo.git
BRANCH="${BRANCH:-main}"
NODE_VERSION="20"
PORT=5000

# ─── Colours ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1" >&2; exit 1; }

# ─── Root check ─────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  error "Run as root: sudo bash deploy.sh"
fi

# ─── 1. System packages ─────────────────────────────────────────────────────
info "Updating system packages..."
apt-get update -qq
info "Installing Node.js, PostgreSQL client, nginx, certbot..."
apt-get install -y -qq curl unzip git nginx certbot python3-certbot-nginx ufw > /dev/null

# ─── 2. Node.js ─────────────────────────────────────────────────────────────
info "Installing Node.js ${NODE_VERSION}..."
if ! command -v node &>/dev/null || ! node --version | grep -q "^v${NODE_VERSION}"; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash - > /dev/null
  apt-get install -y -qq nodejs > /dev/null
fi
info "Node.js: $(node --version), npm: $(npm --version)"

# ─── 3. pnpm ────────────────────────────────────────────────────────────────
if ! command -v pnpm &>/dev/null; then
  info "Installing pnpm..."
  npm install -g pnpm > /dev/null 2>&1
fi
info "pnpm: $(pnpm --version)"

# ─── 4. App user ────────────────────────────────────────────────────────────
info "Creating app user '${APP_USER}'..."
id "${APP_USER}" &>/dev/null || useradd -m -s /bin/bash "${APP_USER}"
mkdir -p "${APP_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

# ─── 5. Pull / copy source ─────────────────────────────────────────────────
if [[ -n "${GIT_REPO}" ]]; then
  info "Cloning repository from ${GIT_REPO}..."
  rm -rf "${APP_DIR:?}"/*
  sudo -u "${APP_USER}" git clone --depth=1 --branch "${BRANCH}" "${GIT_REPO}" "${APP_DIR}"
else
  info "No GIT_REPO set — copy source files manually to ${APP_DIR}"
  info "Then run: sudo chown -R ${APP_USER}:${APP_USER} ${APP_DIR}"
fi

# ─── 6. Install dependencies ─────────────────────────────────────────────────
info "Installing workspace dependencies..."
cd "${APP_DIR}"
sudo -u "${APP_USER}" pnpm install --frozen-lockfile 2>&1 | tail -3

# ─── 7. Environment file ─────────────────────────────────────────────────────
ENV_FILE="${APP_DIR}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  info "Creating ${ENV_FILE}..."
  cat > "${ENV_FILE}" << 'ENVEOF'
# UK49s Platform Environment Variables
# ─────────────────────────────────────────────
# Database (Supabase PostgreSQL)
DATABASE_URL=postgresql://postgres.uqqqgqhvnolafxyymaek:l4Tg4AlwYbcEN7qP@aws-1-eu-west-1.pooler.supabase.com:5432/postgres

# API Server
PORT=5000
NODE_ENV=production
LOG_LEVEL=info

# Security
# Change the secret below — used for API authentication
API_SECRET=change-me-to-a-long-random-string
ENVEOF
  chmod 600 "${ENV_FILE}"
  chown "${APP_USER}:${APP_USER}" "${ENV_FILE}"
  warn "${ENV_FILE} created with default credentials — EDIT BEFORE USE"
else
  info ".env already exists — skipping"
fi

# ─── 8. Build ───────────────────────────────────────────────────────────────
info "Building api-server..."
pnpm --filter @workspace/api-server run build 2>&1 | tail -5

# ─── 9. Database schema push ─────────────────────────────────────────────────
info "Pushing database schema..."
export DATABASE_URL
pnpm --filter @workspace/db run push-force 2>&1 | tail -3

# ─── 10. systemd service ────────────────────────────────────────────────────
info "Installing systemd service..."
cp "${APP_DIR}/deploy/systemd/uk49s-api.service" /etc/systemd/system/uk49s-api.service
systemctl daemon-reload
systemctl enable uk49s-api
info "Service enabled: uk49s-api"

# ─── 11. Nginx + SSL ───────────────────────────────────────────────────────
DOMAIN="${DOMAIN:-}"   # Set via env: DOMAIN=api.yourdomain.com
if [[ -n "${DOMAIN}" ]]; then
  info "Configuring nginx with SSL for ${DOMAIN}..."
  cp "${APP_DIR}/deploy/nginx/uk49s.conf" /etc/nginx/sites-available/uk49s
  sed -i "s/server_name _;/server_name ${DOMAIN};/" /etc/nginx/sites-available/uk49s
  ln -sf /etc/nginx/sites-available/uk49s /etc/nginx/sites-enabled/uk49s
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  info "Requesting SSL certificate..."
  certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "admin@${DOMAIN}" 2>&1 | tail -3
else
  info "No DOMAIN set — configuring nginx on port 80 only (no SSL)"
  cp "${APP_DIR}/deploy/nginx/uk49s-http.conf" /etc/nginx/sites-available/uk49s
  ln -sf /etc/nginx/sites-available/uk49s /etc/nginx/sites-enabled/uk49s
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
fi

# ─── 12. UFW firewall ──────────────────────────────────────────────────────
info "Configuring firewall (allow SSH, HTTP, HTTPS)..."
ufw --force enable
ufw allow ssh
ufw allow http
ufw allow https
info "Firewall enabled"

# ─── 13. Start ─────────────────────────────────────────────────────────────
info "Starting uk49s-api service..."
systemctl restart uk49s-api
sleep 2
systemctl status uk49s-api --no-pager | head -10

# ─── Done ───────────────────────────────────────────────────────────────────
echo ""
info "=========================================="
info "  Deployment complete!"
info "=========================================="
info "API server: http://217.160.138.191:${PORT}/api"
info "Health:      http://217.160.138.191:${PORT}/api/healthz"
if [[ -n "${DOMAIN}" ]]; then
  info "SSL:         https://${DOMAIN}/api"
fi
info ""
info "Useful commands:"
info "  systemctl restart uk49s-api   # Restart"
info "  systemctl status uk49s-api    # Status"
info "  journalctl -u uk49s-api -f    # Logs"
info "  Edit .env: nano ${ENV_FILE}"
