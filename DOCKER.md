# Fin Flow - Docker Deployment

## Quick Start

```bash
# 1. Copy environment file and edit
cp .env.example .env
nano .env  # Set JWT_SECRET, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD

# 2. Start all services
docker-compose up -d

# 3. Access the app
open http://localhost  # or http://localhost:PORT
```

## Custom Port Deployment

If port 80 is already in use, set a custom port:

```bash
# Option 1: Edit .env file
PORT=8080

# Option 2: Set environment variable
PORT=8080 docker-compose up -d --build

# Then access at:
open http://localhost:8080
```

## Services

| Service | Description |
|---------|-------------|
| frontend | React app served by Nginx (configurable port, default: 80) |
| backend | FastAPI server (internal port 8001) |
| mongo | MongoDB 6 database (internal only, no published ports) |
| migrate | One-time database setup (v3.0.0) |

## Network Security

MongoDB runs on an **isolated Docker network** with no published ports. Only the backend and migrate containers can reach it. Other Docker Compose projects on the same server cannot access it — each project gets its own network.

No database credentials are needed because MongoDB is only accessible within the `finflow_default` network.

## Environment Variables

Edit `.env` before starting:

```env
# REQUIRED: Change this! (generate with: openssl rand -hex 32)
JWT_SECRET=your-secret-key-here

# Frontend port (default: 80, change if port is in use)
PORT=80

# Set to false for production
DEV_MODE=false

# Your domain(s) for CORS
CORS_ORIGINS=https://your-domain.com

# Logging (json for production monitoring, text for debugging)
LOG_FORMAT=json
LOG_LEVEL=INFO

# Default admin account (REQUIRED)
DEFAULT_ADMIN_EMAIL=admin@yourdomain.com
DEFAULT_ADMIN_PASSWORD=YourSecurePassword123!

# SMTP for OTP emails (required for production login)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=noreply@finflow.com
SMTP_SSL=true
```

## Default Login

- **Email**: Value of DEFAULT_ADMIN_EMAIL
- **Password**: Value of DEFAULT_ADMIN_PASSWORD
- **OTP**: Sent via email (requires SMTP configuration)

## Database Migration

Migration runs automatically on first start. Manual commands:

```bash
# Run migrations only
docker-compose run --rm migrate python migrate.py

# Check status
docker-compose run --rm migrate python migrate.py --check
```

## Cloudflare Tunnel Setup

This app is optimized for Cloudflare Tunnel deployment:
- Real client IP captured via `CF-Connecting-IP` header
- All Cloudflare IP ranges trusted in nginx
- Health check endpoint at `/health` for Cloudflare

### Install Cloudflared

```bash
# Download and install
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# Login to Cloudflare
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create finflow
```

### Configure Tunnel

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <your-tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: your-domain.com
    service: http://localhost:80
  - service: http_status:404
```

### Run Tunnel

```bash
# Start tunnel (foreground)
cloudflared tunnel run finflow

# Or as a service
cloudflared service install
systemctl start cloudflared
```

## Common Commands

```bash
# View logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f backend

# Restart a service
docker-compose restart backend

# Stop all services
docker-compose down

# Reset everything (DELETES DATA)
docker-compose down -v
docker-compose up -d
```

## Backup & Restore

```bash
# Backup database
docker-compose exec mongo mongodump --archive=/data/backup.gz --gzip --db finflow

# Copy backup to host
docker cp finflow-mongo:/data/backup.gz ./backup.gz

# Restore from backup
docker cp ./backup.gz finflow-mongo:/data/backup.gz
docker-compose exec mongo mongorestore --archive=/data/backup.gz --gzip
```

## Production Checklist

- [ ] Set strong `JWT_SECRET` (use: `openssl rand -hex 32`)
- [ ] Set `DEV_MODE=false`
- [ ] Set `CORS_ORIGINS` to your domain(s)
- [ ] Configure Cloudflare Tunnel
- [ ] Set up database backups (cron job)
- [ ] Configure email service for OTP delivery (SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_SSL)

## Troubleshooting

### Container won't start
```bash
docker-compose logs <service-name>
```

### Database connection issues
```bash
# Check if mongo is healthy
docker-compose exec mongo mongosh --eval "db.adminCommand('ping')"
```

### API returns 502
```bash
# Check backend logs
docker-compose logs backend

# Restart backend
docker-compose restart backend
```

### Migration failed
```bash
# Run migration manually
docker-compose run --rm migrate python migrate.py

# Check migration status
docker-compose run --rm migrate python migrate.py --check
```
