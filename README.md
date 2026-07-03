# WebGuard V2 — Premium Antibot Shield System

WebGuard V2 is a real-time bot detection, cloaking, and traffic analysis system. It protects PHP and Node.js websites from scrapers, crawlers, bots, and malicious traffic using a multi-layered detection engine.

## Architecture

```
┌─────────────┐    POST /api/detect     ┌──────────────┐     PostgreSQL
│  Client Site ├─────────────────────────►  Express API ├─────────────► visits
│  (PHP/Node)  │◄─────── 1 or 0 ────────┤  :5005       │     bad_ip
└─────────────┘                          │              │     hostname
                                         │  Detection   │     isp
┌─────────────┐    POST /api/dashboard   │  Engine      │     users
│  Dashboard  ├─────────────────────────►│              │     ip_providers
│  (React/Vite│◄──── JSON stats ────────└──────────────┘     user_settings
│   :5173     │                          │              │
└─────────────┘                          │   Redis      │
                                         │   (cache)    │
                                         └──────────────┘
```

## Features

### Multi-Layer Detection Pipeline

Checks run in order — the first match blocks immediately:

| # | Check | Description | Latency |
|---|-------|-------------|---------|
| 1 | **OS Detection** | Unknown OS or not whitelisted → block | ~0ms |
| 2 | **Browser Detection** | Unknown browser or not whitelisted → block | ~0ms |
| 3 | **IP Blacklist** | Matches `bad_ip` table (wildcard support) | ~2ms |
| 4 | **Country Whitelist** | Country not in allowed list → block | ~50ms |
| 5 | **FCrDNS** | Spoofed search crawlers (Googlebot, Bingbot) | ~200ms |
| 6 | **Hostname Blacklist** | Reverse DNS matches blocked patterns | ~2ms |
| 7 | **ISP Blacklist** | ISP matches blocked patterns | ~2ms |
| 8 | **Cloud/Datacenter** | Hosting IP + consumer UA → block + auto-ban | ~0ms |

### Real-Time Dashboard

- Live visitor log (polling every 6s)
- KPI cards: Visits Today, Bots Blocked, Unique IPs, Bot Rate, etc.
- Visit activity chart (last 5 days)
- OS/Browser/Country pie charts
- Paginated visit history with "Load More"
- Ban/unban IPs directly from the log
- Block reason shown for each blocked visit

### Settings & Whitelists

- **Country Whitelist** — restrict traffic to specific country codes
- **OS Whitelist** — allow only known operating systems
- **Browser Whitelist** — allow only known browsers
- **IP Blacklist** — block IPs and wildcard patterns
- **Hostname Blacklist** — block reverse DNS keywords
- **ISP Blacklist** — block ISP keywords

### IP Intelligence Providers

Configure multiple IP geolocation APIs with automatic failover:

- ip-api.com, ipapi.co, ipwhois.io (no key needed)
- ipinfo.io, ipdata.co, ipregistry.co (free tier with API key)
- ipbase.com, ipgeolocation.io, abstractapi.com, ipxapi.com, ip2location

### Code Snippets

- **PHP** — curl-based detection snippet
- **Node.js** — Express middleware
- **Encrypt PHP Snippet** — base64-encode the PHP snippet for obfuscation
- **Source Identifier** — tag each snippet to track where visits originate

### Caching

- **Redis** — IP geolocation results cached for 24h across restarts
- **In-memory fallback** — seamless degrade if Redis is unavailable

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express, TypeScript |
| Frontend | React 19, TypeScript, Vite |
| Database | PostgreSQL |
| Cache | Redis (ioredis) |
| Charts | Chart.js, react-chartjs-2 |
| Icons | Lucide React |

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis (optional — falls back to in-memory cache)

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/nbaldr2/webguard.git
cd webguard

# 2. Install dependencies
cd backend && npm install
cd ../frontend && npm install

# 3. Configure database
psql -U postgres -c "CREATE DATABASE webguard;"
psql -U postgres -d webguard -f database.sql

# 4. Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env with your database credentials

# 5. Start development servers
cd backend && npm run dev    # API on :5005
cd frontend && npm run dev   # Dashboard on :5173
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5005` | Backend API port |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USER` | `soufianerochdi` | PostgreSQL user |
| `DB_PASSWORD` | — | PostgreSQL password |
| `DB_NAME` | `webguard` | PostgreSQL database |
| `JWT_SECRET` | — | JWT signing secret (change in production) |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PREFIX` | `wg:` | Redis key prefix |

## API Endpoints

### Detection
- `POST /api/detect` — Check visitor (returns `1` = allow, `0` = block)

### Dashboard
- `POST /api/dashboard/stats` — KPI statistics
- `POST /api/dashboard/visits-chart` — Last 5 days chart data
- `POST /api/dashboard/pie-charts` — OS/Browser/Country breakdown
- `POST /api/dashboard/recent-visits` — Paginated visit log
- `POST /api/dashboard/clear-visits` — Clear all visits for user

### Settings
- `GET/POST /api/settings/countries` — Country whitelist
- `GET/POST /api/settings/system` — OS whitelist
- `GET/POST /api/settings/browser` — Browser whitelist
- `GET/POST/DELETE /api/settings/ip-rules` — Blacklist management
- `GET/POST/PUT/DELETE /api/settings/ip-providers` — IP provider configuration

### Auth
- `POST /api/auth/register` — Register new user
- `POST /api/auth/login` — Login

### Code Generator
- `GET /api/code/snippet?source=NAME` — Get integration snippets

## Deployment

```bash
# Build backend
cd backend && npm run build
NODE_ENV=production node dist/index.js

# Build frontend
cd frontend && npm run build
# Serve frontend/dist with nginx or similar
```

## License

MIT
