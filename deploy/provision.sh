#!/usr/bin/env bash
#
# provision.sh — turn a blank Ubuntu 24.04 EC2 instance into the UCF Meeting &
# Action Item Tracker server.
#
# Run once, as root, on a fresh instance:
#
#     sudo DOMAIN=ucfmom.nium.org.in CERT_EMAIL=you@nium.org.in ./provision.sh
#
# It is idempotent: running it again after a change is safe and is the intended
# way to apply one. It installs Node, PostgreSQL, Redis, nginx and certbot;
# creates the service account, the database and the directory layout; writes the
# systemd units and the nginx site; and locks the firewall down to 22/80/443.
#
# It does NOT deploy the application — that is deploy.sh, which you run as the
# `mom` user afterwards. Provisioning and deploying are separate on purpose:
# you provision once and deploy many times, and a deployment must never be able
# to change the firewall.

set -Eeuo pipefail

DOMAIN="${DOMAIN:-}"
CERT_EMAIL="${CERT_EMAIL:-}"
APP_USER="${APP_USER:-mom}"
APP_HOME="${APP_HOME:-/opt/mom}"
APP_DIR="$APP_HOME/app"
ENV_FILE="/etc/mom/mom.env"
DB_NAME="${DB_NAME:-mom_tracker}"
DB_USER="${DB_USER:-ucf}"
NODE_MAJOR=20
PG_VERSION=16

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m [!]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m [x]\033[0m %s\n' "$*" >&2; exit 1; }

trap 'die "provisioning failed on line $LINENO — nothing after this point ran"' ERR

[[ $EUID -eq 0 ]] || die "run this with sudo."
[[ -n $DOMAIN ]]  || die "set DOMAIN, e.g. DOMAIN=ucfmom.nium.org.in sudo -E ./provision.sh"

# ─────────────────────────────── packages ───────────────────────────────
log "Updating the package index"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

log "Installing base packages"
apt-get install -y -qq \
  ca-certificates curl gnupg git jq unzip rsync \
  build-essential \
  "postgresql-$PG_VERSION" "postgresql-client-$PG_VERSION" \
  redis-server \
  nginx certbot python3-certbot-nginx \
  ufw unattended-upgrades \
  fonts-liberation

# Liberation Serif is not decoration. The MoM is set in Times New Roman with
# Liberation Serif as the fallback, and a headless render on a server without
# it silently substitutes a sans-serif face into a government document.

# ───────────────────────── a browser, to print PDFs ─────────────────────────
# The MoM PDF is produced by printing the document with a browser. Nothing is
# bundled — puppeteer-core drives whatever is installed — so the server needs
# one. On Windows that is Edge, which is always there; here it has to be
# installed.
#
# Deliberately NOT in the apt list above: on Ubuntu 24.04 `chromium` and
# `chromium-browser` are snap transitional packages, and whether either
# resolves depends on the image. Under `set -e` a missing package would abort
# provisioning entirely — for a feature that is one route out of forty. So it
# is tried, and a failure is a warning with the fix printed.
if command -v chromium >/dev/null || command -v chromium-browser >/dev/null \
   || command -v google-chrome >/dev/null; then
  log "A browser for printing PDFs is already installed"
else
  log "Installing a browser, for printing the MoM as PDF"
  if apt-get install -y -qq chromium 2>/dev/null \
     || apt-get install -y -qq chromium-browser 2>/dev/null \
     || snap install chromium 2>/dev/null; then
    log "OK — $(command -v chromium || command -v chromium-browser)"
  else
    warn "Could not install a browser. Everything else works; the"
    warn "\"PDF with annexures\" download will report that none was found."
    warn "Install one later with:  sudo snap install chromium"
    warn "or point MOM_BROWSER_PATH in $ENV_FILE at an existing browser."
  fi
fi

if ! command -v node >/dev/null || [[ "$(node -v)" != v${NODE_MAJOR}.* ]]; then
  log "Installing Node.js $NODE_MAJOR"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
else
  log "Node.js $(node -v) is already installed"
fi

log "Enabling pnpm through corepack"
corepack enable
corepack prepare pnpm@10.28.0 --activate

if ! command -v aws >/dev/null; then
  log "Installing the AWS CLI (the backup job uploads with it)"
  tmp=$(mktemp -d)
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o "$tmp/awscli.zip"
  unzip -q "$tmp/awscli.zip" -d "$tmp"
  "$tmp/aws/install" --update >/dev/null
  rm -rf "$tmp"
fi

# ──────────────────────────────── swap ────────────────────────────────
# `next build` peaks well above what a 4 GB box has spare while Postgres and
# Redis are also resident. Without swap the build is OOM-killed halfway and
# leaves a half-written .next directory, which looks like a code problem.
if [[ ! -f /swapfile ]]; then
  log "Creating a 2 GB swap file for the build"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap -q /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -q -w vm.swappiness=10
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi

# ─────────────────────────── the service account ───────────────────────────
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  log "Creating the $APP_USER service account"
  adduser --system --group --home "$APP_HOME" --shell /bin/bash "$APP_USER"
fi
install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$APP_HOME" "$APP_DIR"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_HOME/var" "$APP_HOME/var/branding" "$APP_HOME/backups"
install -d -o root -g "$APP_USER" -m 0750 /etc/mom

# ────────────────────────────── PostgreSQL ──────────────────────────────
log "Configuring PostgreSQL $PG_VERSION"
systemctl enable --now postgresql

# Listen on localhost only. Nothing outside this box has any business reaching
# the database, and the security group is a second line, not the first.
PG_CONF="/etc/postgresql/$PG_VERSION/main/postgresql.conf"
sed -i "s/^#\?listen_addresses.*/listen_addresses = 'localhost'/" "$PG_CONF"

# Sized for a 4 GB instance carrying fifty users. Defaults assume a much
# smaller machine and leave most of the RAM unused.
set_pg() {
  if grep -qE "^#?$1" "$PG_CONF"; then
    sed -i "s|^#\?$1.*|$1 = $2|" "$PG_CONF"
  else
    echo "$1 = $2" >> "$PG_CONF"
  fi
}
set_pg shared_buffers            "1GB"
set_pg effective_cache_size      "2GB"
set_pg maintenance_work_mem      "256MB"
set_pg work_mem                  "16MB"
set_pg max_connections           "60"
set_pg timezone                  "'Asia/Kolkata'"
set_pg log_min_duration_statement "1000"

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  DB_PASSWORD="$(openssl rand -base64 30 | tr -d '/+=' | head -c 32)"
  log "Creating the $DB_USER role and the $DB_NAME database"
  sudo -u postgres psql -q -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD';"
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
  printf '%s\n' "$DB_PASSWORD" > /etc/mom/db-password
  chmod 0640 /etc/mom/db-password
  chgrp "$APP_USER" /etc/mom/db-password
  warn "Database password written to /etc/mom/db-password — paste it into DATABASE_URL in $ENV_FILE"
else
  log "The $DB_USER role already exists; leaving it and its password alone"
fi

systemctl restart postgresql

# ──────────────────────────────── Redis ────────────────────────────────
log "Configuring Redis"
sed -i 's/^# *maxmemory .*/maxmemory 256mb/'                 /etc/redis/redis.conf
sed -i 's/^# *maxmemory-policy .*/maxmemory-policy noeviction/' /etc/redis/redis.conf
# noeviction, not allkeys-lru: this Redis holds the notification queue. Evicting
# a job to save memory would drop a WhatsApp message with nothing to show for it.
sed -i 's/^bind .*/bind 127.0.0.1 -::1/'                     /etc/redis/redis.conf
systemctl enable --now redis-server
systemctl restart redis-server

# ─────────────────────────── the environment file ───────────────────────────
if [[ ! -f $ENV_FILE ]]; then
  log "Writing a starter $ENV_FILE"
  install -o root -g "$APP_USER" -m 0640 /dev/null "$ENV_FILE"
  cat > "$ENV_FILE" <<EOF
# UCF Meeting & Action Item Tracker — server environment.
# Readable by the $APP_USER group only. Never commit this file anywhere.

NODE_ENV=production
PORT=4000
API_PREFIX=api/v1
WEB_ORIGIN=https://$DOMAIN
APP_TZ=Asia/Kolkata
LOG_LEVEL=info

DATABASE_URL=postgresql://$DB_USER:REPLACE_ME@localhost:5432/$DB_NAME?schema=public

JWT_ACCESS_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
JWT_REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=30d

QUEUE_DRIVER=bullmq
REDIS_URL=redis://127.0.0.1:6379

# Documents live in S3 and nowhere else. Credentials come from the instance
# role — leave S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY unset.
STORAGE_DRIVER=s3
S3_REGION=ap-south-2
S3_BUCKET=REPLACE_ME
S3_PREFIX=files
S3_SSE=AES256

# WhatsApp only. Email is deliberately off; 'none' is a supported setting.
EMAIL_PROVIDER=none

WHATSAPP_PROVIDER=console
# WHATSAPP_PROVIDER=gupshup
# GUPSHUP_API_KEY=
# GUPSHUP_SOURCE=
# GUPSHUP_APP_NAME=
# WEBHOOK_HMAC_SECRET=

MOM_EMBLEM_PATH=$APP_HOME/var/branding/emblem.png

# Where the nightly dump is uploaded. Same bucket, different prefix, and the
# instance role may write there but not delete.
BACKUP_S3_URI=s3://REPLACE_ME/backups
EOF
  warn "$ENV_FILE needs DATABASE_URL, S3_BUCKET and BACKUP_S3_URI filled in before anything will start"
else
  log "$ENV_FILE already exists; leaving it alone"
fi

# ───────────────────────────── systemd units ─────────────────────────────
log "Installing the systemd units"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for unit in mom-api.service mom-web.service mom-backup.service mom-backup.timer; do
  sed -e "s|@APP_USER@|$APP_USER|g" -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@APP_HOME@|$APP_HOME|g" \
      "$HERE/systemd/$unit" > "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable mom-api.service mom-web.service mom-backup.timer

# deploy.sh restarts the services, and restore.sh stops them. Both run as the
# unprivileged service account, so it needs exactly those verbs on exactly
# those units — not a general sudo grant, which would make a deployment able
# to change the firewall.
cat > /etc/sudoers.d/mom-deploy <<SUDO
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart mom-api, /usr/bin/systemctl restart mom-web, \\
                               /usr/bin/systemctl start mom-api,   /usr/bin/systemctl start mom-web, \\
                               /usr/bin/systemctl stop mom-api,    /usr/bin/systemctl stop mom-web, \\
                               /usr/bin/systemctl start mom-api mom-web, \\
                               /usr/bin/systemctl stop mom-api mom-web
SUDO
chmod 0440 /etc/sudoers.d/mom-deploy
visudo -cf /etc/sudoers.d/mom-deploy >/dev/null || die "the sudoers fragment is malformed"

# ──────────────────────────────── nginx ────────────────────────────────
log "Installing the nginx site for $DOMAIN"
sed "s|@DOMAIN@|$DOMAIN|g" "$HERE/nginx/mom.conf" > /etc/nginx/sites-available/mom.conf

# An instance in an IPv4-only VPC — which is the default — has no AF_INET6, and
# nginx refuses to start at all rather than skipping the line it cannot bind.
# The failure reads as a config error, so it is worth removing rather than
# explaining.
if [[ ! -f /proc/net/if_inet6 ]]; then
  warn "no IPv6 on this instance; removing the IPv6 listen directives"
  sed -i '/listen \[::\]/d' /etc/nginx/sites-available/mom.conf
fi
ln -sfn /etc/nginx/sites-available/mom.conf /etc/nginx/sites-enabled/mom.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# ──────────────────────────────── firewall ────────────────────────────────
log "Locking the firewall to 22, 80 and 443"
ufw --force reset >/dev/null
ufw default deny incoming  >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp   >/dev/null
ufw allow 80/tcp   >/dev/null
ufw allow 443/tcp  >/dev/null
ufw --force enable >/dev/null

log "Enabling unattended security upgrades"
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

# ──────────────────────────────── TLS ────────────────────────────────
# Last, because certbot needs the DNS record to already point here. If it does
# not yet, this step fails and everything before it is still done — rerun the
# script once DNS has propagated.
if [[ -n $CERT_EMAIL ]]; then
  if [[ -d /etc/letsencrypt/live/$DOMAIN ]]; then
    log "A certificate for $DOMAIN already exists; renewal is handled by certbot's timer"
  else
    log "Requesting a Let's Encrypt certificate for $DOMAIN"
    if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERT_EMAIL" --redirect; then
      log "HTTPS is live"
    else
      warn "certbot failed — check that $DOMAIN resolves to this instance's public IP, then rerun"
    fi
  fi
else
  warn "CERT_EMAIL not set, so no certificate was requested. Run:"
  warn "  sudo certbot --nginx -d $DOMAIN --agree-tos -m you@nium.org.in --redirect"
fi

cat <<BANNER

  Provisioned.

  Next, in order:
    1. Fill in $ENV_FILE
         DATABASE_URL   password is in /etc/mom/db-password
         S3_BUCKET      and BACKUP_S3_URI
    2. Put the Telangana emblem at $APP_HOME/var/branding/emblem.png
    3. Deploy:  sudo -u $APP_USER $APP_DIR/deploy/deploy.sh
    4. Check:   systemctl status mom-api mom-web

BANNER
