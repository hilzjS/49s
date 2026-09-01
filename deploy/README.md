# UK49s Platform Deployment

## Files

```
deploy/
├── deploy.sh                  # One-shot installation script (run as root)
├── systemd/
│   └── uk49s-api.service      # systemd unit for the API server
├── nginx/
│   ├── uk49s.conf             # nginx config (HTTPS via Let's Encrypt)
│   └── uk49s-http.conf        # nginx config (HTTP only)
└── env/
    ├── .env                   # Real env file — DO NOT COMMIT
    └── .env.template          # Template (safe to commit)
```

## Quick Start (on your VPS as root)

```bash
# 1. Copy the project to your VPS
scp -r /workspace/project/49s root@217.160.138.191:/tmp/

# 2. SSH into the VPS
ssh root@217.160.138.191

# 3. Move and run the deploy script
mv /tmp/uk49s /opt/uk49s
cd /opt/uk49s
chmod +x deploy/deploy.sh

# 4. (Optional) With SSL — set DOMAIN
DOMAIN=api.yourdomain.com bash deploy/deploy.sh

# 4'. (Or without SSL — HTTP only)
bash deploy/deploy.sh
```

The script will:
- Install Node.js 20, pnpm, nginx, certbot, ufw
- Create `uk49s` user
- Install dependencies (`pnpm install`)
- Build the API server
- Push the database schema
- Install + start the systemd service
- Configure nginx (with optional SSL via Let's Encrypt)
- Open firewall ports (22, 80, 443)

## After Deployment

- **API server:** `http://217.160.138.191:5000/api`
- **Health check:** `http://217.160.138.191:5000/api/healthz`
- **With domain:** `https://api.yourdomain.com/api`

## Useful Commands

```bash
# Status / logs / restart
systemctl status uk49s-api
journalctl -u uk49s-api -f
systemctl restart uk49s-api

# Edit secrets
nano /opt/uk49s/.env
systemctl restart uk49s-api   # required after .env change

# Re-run DB schema push
cd /opt/uk49s && export $(cat .env | xargs) && pnpm --filter @workspace/db run push-force
```

## Security Checklist

- [x] `.env` file mode `600`, owned by `uk49s` user
- [x] systemd service runs as `uk49s`, not root
- [x] nginx only forwards `/api/` to backend
- [x] ufw only allows 22, 80, 443
- [x] No hard-coded secrets in any source file
- [x] DATABASE_URL is read from env only

## Rotation Reminder

Rotate these in Supabase dashboard → Settings → Database:
- Old access token `sbp_6ae78eb4975401b50112bde8336ea3ebf473a2fc`
- Old password `QV0HJhjQF6uOIZId`

Current working credentials (in `.env` only):
- User: `postgres.uqqqgqhvnolafxyymaek`
- Password: `l4Tg4AlwYbcEN7qP`
