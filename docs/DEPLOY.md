# FitTrack — DigitalOcean Deployment Guide

Step-by-step guide to deploy FitTrack to a DigitalOcean Droplet with Docker Compose, Caddy (auto-HTTPS), and Google account whitelisting.

**Production URL**: `https://oliradlett.co.uk/fittrack`

---

## Prerequisites

- A DigitalOcean account
- DNS for `oliradlett.co.uk` pointing to your Droplet
- Google Cloud Console project with OAuth 2.0 credentials
- (Optional) Strava, Whoop, Wahoo API credentials for fitness integrations

---

## 1. Create a Droplet

1. **Create → Droplets** in the DigitalOcean dashboard.
2. Choose:
   - **Image**: Ubuntu 24.04 LTS
   - **Plan**: Basic — Regular — **2 GB / 1 CPU** minimum ($12/mo). 4 GB recommended if running all services.
   - **Region**: London (closest to you)
   - **Authentication**: SSH keys (recommended) or password
3. Create the Droplet and note its **public IPv4 address** (e.g. `203.0.113.42`).

## 2. Point Your Domain

In your DNS provider (Cloudflare, Namecheap, etc.):

| Type | Host | Value | TTL |
|------|------|-------|-----|
| A | `@` | `<droplet-ip>` | 300 |

Wait for DNS propagation (usually < 5 min).

## 3. SSH Into the Droplet

```bash
ssh root@<droplet-ip>
```

## 4. Install Docker & Docker Compose

```bash
# Update packages
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Ensure Python 3.10+ (required by start.sh / fittrack.py)
apt install -y python3
python3 --version   # should be 3.10+

# Verify
docker --version
docker compose version
```

## 5. Clone the Repository

```bash
# Install git
apt install -y git

# Clone
cd /opt
git clone <your-repo-url> fitness-tracker
cd fitness-tracker
```

## 6. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` — **every variable matters in production**:

```bash
nano .env
```

### Required values:

```env
# ─── Database ─────────────────────────────────────────────
POSTGRES_USER=fittrack
POSTGRES_PASSWORD=<generate-a-strong-password>   # openssl rand -base64 32
POSTGRES_DB=fittrack
DATABASE_URL=postgresql+asyncpg://fittrack:<password>@db:5432/fittrack

# ─── Redis ────────────────────────────────────────────────
REDIS_URL=redis://redis:6379/0

# ─── Backend ──────────────────────────────────────────────
SECRET_KEY=<generate-a-strong-secret>             # openssl rand -base64 48
DEBUG=false
ALLOWED_ORIGINS=https://oliradlett.co.uk
PUBLIC_URL=https://oliradlett.co.uk

# ─── Account Whitelist ────────────────────────────────────
# Only these Google accounts can log in. Comma-separated.
ALLOWED_EMAILS=you@gmail.com

# ─── Frontend ─────────────────────────────────────────────
# Must be empty string — clients use relative URLs via Caddy proxy
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_PUBLIC_URL=https://oliradlett.co.uk
NEXTAUTH_URL=https://oliradlett.co.uk/fittrack
NEXTAUTH_SECRET=<generate-a-strong-secret>        # openssl rand -base64 48
INTERNAL_API_URL=http://backend:8000

# ─── Google OAuth ─────────────────────────────────────────
GOOGLE_CLIENT_ID=<from-google-cloud-console>
GOOGLE_CLIENT_SECRET=<from-google-cloud-console>

# ─── GitHub OAuth (optional) ─────────────────────────────
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# ─── Fitness Integrations (optional) ─────────────────────
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
WHOOP_CLIENT_ID=
WHOOP_CLIENT_SECRET=
WAHOO_CLIENT_ID=
WAHOO_CLIENT_SECRET=

# ─── Komoot (optional) ───────────────────────────────────
KOMOOT_EMAIL=
KOMOOT_PASSWORD=
KOMOOT_USER_ID=

# ─── Strava Webhook (optional) ───────────────────────────
STRAVA_VERIFY_TOKEN=fittrack_strava_webhook
```

Generate secrets with:
```bash
openssl rand -base64 48
```

## 7. Configure Caddy for Your Domain

Edit the Caddyfile to use your real domain and get automatic HTTPS:

```bash
nano infra/Caddyfile
```

Replace the contents with:

```caddyfile
{
    email you@gmail.com    # Used for Let's Encrypt notifications
}

:80 {
    redir https://{host}{uri} permanent
}

oliradlett.co.uk {
    # Frontend — Next.js basePath is /fittrack
    handle /fittrack/* {
        reverse_proxy frontend:3000
    }

    # Backend API
    handle /api/v1/* {
        reverse_proxy backend:8000
    }

    handle /health {
        reverse_proxy backend:8000
    }

    # Root → redirect to /fittrack
    handle / {
        redir /fittrack permanent
    }
}
```

> **Note**: Remove `tls internal` — Caddy will automatically obtain a Let's Encrypt certificate.

## 8. Configure Google OAuth

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth 2.0 Client ID** (Web application).
3. Set **Authorized redirect URIs**:
   ```
   https://oliradlett.co.uk/fittrack/api/auth/callback/google
   ```
4. Copy the **Client ID** and **Client Secret** into your `.env`.

## 9. Build and Start

Use the start script (works on Linux, macOS, and WSL):

```bash
# Build all images and start with migrations
./start.sh up --build --migrate

# Or step by step:
./start.sh build
./start.sh up
./start.sh migrate

# Verify all services are running
./start.sh status
```

## 10. Verify

1. Visit `https://oliradlett.co.uk/fittrack` — Caddy will auto-provision HTTPS.
2. Sign in with your whitelisted Google account.
3. Try signing in with a different Google account — it should be **rejected**.

---

## 11. Set Up Continuous Deployment (Optional)

The repo includes a GitHub Actions workflow ([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)) that auto-deploys to your Droplet whenever CI passes on `main`.

### How it works

1. You push / merge to `main`
2. The existing **CI** workflow runs lint + tests
3. If CI passes, the **Deploy** workflow triggers automatically
4. It SSHs into your Droplet, pulls the latest code, rebuilds images, runs migrations, and restarts services

### Setup

1. **Generate an SSH key pair** (on your local machine):
   ```bash
   ssh-keygen -t ed25519 -C "github-deploy" -f ~/.ssh/fittrack-deploy -N ""
   ```

2. **Add the public key to the Droplet**:
   ```bash
   ssh root@<droplet-ip> "cat >> ~/.ssh/authorized_keys" < ~/.ssh/fittrack-deploy.pub
   ```

3. **Add GitHub repository secrets**:
   Go to **Settings → Secrets and variables → Actions** in your GitHub repo and add:

   | Secret | Value |
   |--------|-------|
   | `DROPLET_HOST` | Your Droplet IP (e.g. `203.0.113.42`) |
   | `DROPLET_USER` | `root` |
   | `DROPLET_SSH_KEY` | Contents of `~/.ssh/fittrack-deploy` (the **private** key) |

4. **Push to `main`** — the workflow will run automatically.

> **Note**: The `.env` file on the Droplet is **not** in git. It persists across deploys. To change env vars, SSH into the Droplet and edit `/opt/fitness-tracker/.env`, then restart services.

---

## Whitelisting Accounts

The `ALLOWED_EMAILS` env var controls who can log in. It's enforced in **two layers**:

| Layer | File | What it does |
|-------|------|-------------|
| **Frontend** (NextAuth) | [`frontend/src/lib/auth.ts`](frontend/src/lib/auth.ts:11) | Rejects sign-in before calling backend. Returns `false` from `signIn` callback. |
| **Backend** (sync-user + OAuth) | [`backend/app/api/auth.py`](backend/app/api/auth.py:55) | Returns HTTP 403 if email not in allowlist. Defense-in-depth. |

To add more users, update `.env`:
```env
ALLOWED_EMAILS=you@gmail.com,family@gmail.com,friend@gmail.com
```

Then restart:
```bash
./start.sh restart backend frontend
```

> Leave `ALLOWED_EMAILS` empty to allow **all** Google accounts (not recommended for personal use).

---

## Common Operations

All commands use `./start.sh` (Linux/macOS/WSL) or `.\start.ps1` (Windows PowerShell).

### View logs
```bash
./start.sh logs backend          # Tail backend logs
./start.sh logs                  # Tail all service logs
```

### Restart after config changes
```bash
./start.sh restart               # Restart all
./start.sh restart backend       # Restart single service
```

### Update to latest code
```bash
cd /opt/fitness-tracker
git pull
./start.sh up --build --migrate
```

### Database backup & restore
```bash
./start.sh backup                            # Backup to backups/
./start.sh backup -o my-backup.sql.gz        # Custom output path
./start.sh restore backups/fittrack_20260101_120000.sql.gz
```

### Full reset (teardown + rebuild + migrate)
```bash
./start.sh reset
```

---

## Firewall (Recommended)

```bash
# Install UFW
apt install -y ufw

# Allow SSH, HTTP, HTTPS
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp     # HTTP/3 (QUIC)

# Block everything else (including direct DB/Redis access)
ufw enable
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `502 Bad Gateway` from Caddy | Backend/frontend not ready | `./start.sh logs backend frontend` |
| `SSL certificate error` | DNS not propagated | Wait 5 min, verify A record |
| Sign-in rejected | Email not in `ALLOWED_EMAILS` | Update `.env` and restart: `./start.sh restart` |
| `SECRET_KEY` validation error | Still using default value | Generate a real secret: `openssl rand -base64 48` |
| Migrations fail | DB not ready | `./start.sh logs db`, wait for healthcheck |
| NextAuth `redirect_uri` mismatch | Google Console config wrong | Ensure redirect URI matches: `https://oliradlett.co.uk/fittrack/api/auth/callback/google` |
| Pages load at `/` instead of `/fittrack` | Next.js basePath not applied | Rebuild frontend: `./start.sh build frontend` |
