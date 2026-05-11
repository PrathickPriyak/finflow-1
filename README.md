# Fin Flow

Credit Card Swiping Business Management System

## Quick Start with Docker

```bash
# 1. Copy and configure environment
cp .env.example .env
# Edit .env: set JWT_SECRET, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD

# 2. Start all services
make start

# 3. Access the app
open http://localhost
```

Default login uses credentials from `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD` in `.env`.

## Features

- **Transactions**: Type 01 (Pay-to-Card) and Type 02 (Card Swipe) with full lifecycle
- **Payments**: Outgoing customer payouts with date range filters and Excel export
- **Collections**: Incoming collections with date range filters and Excel export
- **Wallets**: Cash, Bank, and Gateway wallets with operation tracking
- **Customers**: Credit scoring, ledger download, bulk operations
- **Expenses**: Categorized expense tracking with auto PG charge expenses
- **Daily Closing**: End-of-day reconciliation with profit calculation
- **Reports**: Dashboard analytics, data integrity checks, balance verification
- **Audit Trail**: Full action logging with visualizer
- **PWA**: Mobile-responsive with offline capability
- **Excel Exports**: Comprehensive downloads for transactions, payments, collections, wallets, expenses

## Commands

| Command | Description |
|---------|-------------|
| `make start` | Build and start all services |
| `make stop` | Stop all services |
| `make logs` | View logs |
| `make clean` | Remove everything (containers, images, data) |
| `make backup` | Backup database to ./backups/ |
| `make restore FILE=path` | Restore database from backup |

## Architecture

- **Frontend**: React 18 + TailwindCSS + Shadcn UI (port 80 via Nginx)
- **Backend**: FastAPI + Motor async MongoDB driver (port 8001)
- **Database**: MongoDB 6
- **Auth**: JWT + HTTP-only cookies + OTP email verification

## Environment Variables

See `.env.example` for all available options. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes | JWT signing secret (`openssl rand -hex 32`) |
| `DEFAULT_ADMIN_EMAIL` | Yes | SuperAdmin email |
| `DEFAULT_ADMIN_PASSWORD` | Yes | SuperAdmin password (12+ chars, uppercase, number, special) |
| `DEV_MODE` | No | `true` shows OTP on screen (default: `false`) |
| `CORS_ORIGINS` | No | Allowed origins (default: `*`) |
| `PORT` | No | Frontend port (default: `80`) |

## What Happens on Startup

The `migrate` container automatically:
1. Renames any legacy collections (upgrades from older versions)
2. Creates database indexes (30+ indexes across all collections)
3. Creates default modules, roles, expense types, card networks, bank payment types
4. Creates/updates SuperAdmin account from environment variables
5. Fixes any stale data fields

No manual database setup required.

## Docker Deployment

See [DOCKER.md](DOCKER.md) for detailed deployment instructions including:
- Custom port configuration
- Cloudflare Tunnel setup
- Backup & restore procedures
- Production security checklist
