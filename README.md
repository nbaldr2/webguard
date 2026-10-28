# WebGuard V2 — Antibot Shield System

Real-time bot detection and traffic protection system for PHP and Node.js websites. Multi-layered detection engine with Redis caching, IP threat intelligence, and a React dashboard.

## Architecture

```
┌──────────────┐     POST /api/detect       ┌────────────────┐     PostgreSQL
│  Client Site ├───────────────────────────►│  Express API    ├────────► visits
│  (PHP/Node)  │◄──── 1 (allow) / 0 (block) │  :5005          │         bad_ip
└──────────────┘                            │                 │         hard_block
                                            │  Detection      │         hostname
┌──────────────┐                            │  Engine         │         isp
│  Dashboard   │  GET/POST /api/*           │                 │         organizations
│  (React/Vite)├───────────────────────────►│                 │         referrer_blacklist
│  Port 80     │◄──── JSON ─────────────── │                 │         user_settings
└──────────────┘                            │                 │         users
                                            │  Redis          │         intel_providers
                                            │  :6379          │         ip_providers
                                            └────────────────┘         system/browser
```

## Detection Pipeline

Checks run sequentially. Once any check blocks the visitor (`isBot = 0`), all subsequent checks are skipped. `isBot = 1` means human/allowed.

### Pre-Pipeline (detect.ts)

| # | Check | Description | Result |
|---|-------|-------------|--------|
| 0 | **Hard Block** | IP in `hard_block` table. No logging, caching, or dashboard. | Immediately returns `0` |

### Full Pipeline (detection.ts)

| # | Check | Data Source | Block Reason |
|---|-------|-------------|--------------|
| 1 | **User Validation** | `users` table | Invalid uflow / Inactive / Banned / Subscription expired |
| 2 | **OS + Browser Detection** | User-Agent parsing | — (determines OS/browser for later checks) |
| 3 | **Settings Fetch** | `user_settings` table | — (loads whitelists, rate limit) |
| 4 | **Cache Validation** | Redis (`wg:v:{uflow}:{ip}`) | Replays cached verdict if OS/browser whitelist hasn't changed. Skips pipeline entirely on valid cache hit. |
| 5 | **Crawler/Bot UA** | User-Agent regex | `Blocked Crawler/Bot` |
| 6 | **JA3 TLS Fingerprint** | X-JA3-Fingerprint header | `Blocked JA3 TLS fingerprint` |
| 7 | **Rate Limit** | Redis sliding window | `Rate limit exceeded` |
| 8 | **Referrer Blacklist** | `referrer_blacklist` table (ILIKE) | `Blocked referrer` |
| 9 | **Client Hints Consistency** | Sec-Ch-Ua-Platform header vs UA | `Client Hints / UA mismatch` |
| 10 | **OS Whitelist** | `user_settings.systems` → `system` table fallback | `OS not whitelisted` / `Unknown OS` |
| 11 | **Browser Whitelist** | `user_settings.browsers` → `browser` table fallback | `Browser not whitelisted` / `Unknown browser` |
| 12 | **IP Blacklist** | `bad_ip` table (exact, wildcard `*`, CIDR `/`) | `Blacklisted IP` |
| 13 | **Geo IP Lookup** | Configured IP providers with failover | — (gets country + ISP) |
| 14 | **Country Whitelist** | `user_settings.countries` | `Country not whitelisted` |
| 15 | **Blocked Countries** | `user_settings.blocked_countries` | `Blocked country` |
| 16 | **Reverse DNS** | DNS PTR lookup | — (gets hostname) |
| 17 | **Hostname Blacklist** | `hostname` table (ILIKE `%pattern%`) | `Blacklisted hostname` |
| 18 | **ISP Blacklist** | `isp` table (ILIKE `%pattern%`) | `Blacklisted ISP` |
| 19 | **Organization Blacklist** | `organizations` table (ILIKE exact) | `Blocked organization` |
| 20 | **Cloud/Datacenter** | ISP keyword matching + consumer UA detection | `Cloud/Datacenter IP` |
| 21 | **IP Threat Intelligence** | External APIs (parallel, 5s timeout per provider) | `Proxy/VPN detected` / `Datacenter IP detected` / `Hosting/Cloud detected` |
| 22 | **Auto-Ban** | INSERT into `bad_ip` | — (for all block reasons except `Blacklisted IP`) |
| 23 | **Visit Log** | INSERT into `visits` | — |
| 24 | **Verdict Cache** | Redis SETEX (3-day TTL) | — |

### Cache Invalidation

| Trigger | Action |
|---------|--------|
| Settings save (countries, systems, browsers, blocked_countries) | Flush entire verdict cache for uflow |
| Ban IP (dashboard/history) | Delete verdict cache for that IP |
| Unban IP (dashboard/history) | Delete verdict cache for that IP |
| Cache validation (step 4) | Discard cache if OS/browser settings changed |
| Clear Cache button (dashboard) | SCAN + DEL all verdict keys for uflow |

### IP Threat Intelligence Providers

Parallel API calls with 5-second timeout per provider. Residential proxies are auto-skipped (not blocked).

| Provider | Type | Checks |
|----------|------|--------|
| **ip2location.io** | GET | `proxy.is_public_proxy`, `proxy.is_vpn`, `proxy.is_data_center`, `usage_type === DCH` |
| **findip.net** | GET | `intelligence.flags.is_proxy`, `intelligence.flags.is_vpn`, `intelligence.flags.is_hosting` |

## Features

### Dashboard
- Live visitor polling (6s interval)
- KPI cards: visits today, bots blocked, unique IPs, bot rate
- Visit activity chart (last 5 days)
- OS / Browser / Country pie charts
- Recent visits with block reasons
- Ban/unban IPs directly from the log
- Clear Visits + Clear Cache buttons

### History
- Period filters: Today, Yesterday, Last 3/7/30 Days
- Search by IP, country, ISP, OS, browser
- Type filter: All / Allowed / Blocked
- Local ban/unban without page refresh
- Load More pagination

### Settings
- **Country Whitelist** — allow only specific countries (blocks `N/A`)
- **Blocked Countries** — immediately block specific countries
- **OS Whitelist** — allow only whitelisted operating systems
- **Browser Whitelist** — allow only whitelisted browsers
- **Hard Blocked IPs** — block immediately, no pipeline/log/cache
- **IP Blacklist** — exact, wildcard (`*`), CIDR (`/`)
- **Hostname Patterns** — ILIKE substring match on reverse DNS
- **ISP Blacklist** — ILIKE substring match on ISP
- **Referrer Blacklist** — ILIKE substring match on HTTP referrer
- **Blocked Organizations** — ILIKE exact match on ISP organization

### General Settings
- **IP Intelligence Providers** — configure country/ISP lookup APIs with failover
- **IP Threat Intelligence** — configure VPN/proxy/hosting detection APIs
- **VPN / Proxy / Hosting Detection** — master toggle
- **Quick Add Presets** — one-click add common IP providers

### Code Generator
- PHP snippet with source identifier
- Node.js Express middleware
- Base64-encrypted PHP snippet option
- Shortcut variables (click to copy): email, URL, identity fields, random generators, dates

## Database Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts (uflow, active, subscription) |
| `user_settings` | Per-user whitelists, rate limit, VPN detection toggle |
| `visits` | All visitor traffic logs |
| `bad_ip` | IP blacklist (exact, wildcard, CIDR, auto-banned) |
| `hard_block` | Hard block IPs (no pipeline, no log, no cache) |
| `hostname` | Hostname blacklist patterns |
| `isp` | ISP blacklist patterns |
| `organizations` | Blocked ISP organization names |
| `referrer_blacklist` | Blocked HTTP referrer patterns |
| `system` | Global OS whitelist (fallback) |
| `browser` | Global browser whitelist (fallback) |
| `ip_providers` | Country/ISP lookup API configuration |
| `intel_providers` | VPN/proxy/hosting threat intelligence API configuration |

## API Endpoints

### Detection
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/detect` | Check visitor. Body: `{ fd, ip, ref, ua, src }`. Returns `1` (allow) or `0` (block). Sets `X-WebGuard-Block-Reason` header on block. |

### Dashboard
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/dashboard/stats` | KPI statistics |
| `POST` | `/api/dashboard/visits-chart` | Last 5 days chart data |
| `POST` | `/api/dashboard/pie-charts` | OS/Browser/Country breakdown |
| `POST` | `/api/dashboard/recent-visits` | Paginated visit log |
| `POST` | `/api/dashboard/clear-visits` | Delete all visits for user |
| `POST` | `/api/dashboard/clear-cache` | Flush verdict cache for user |
| `POST` | `/api/dashboard/visits-history` | Filtered history (period, type, search, limit, offset) |

### Settings — Whitelists / Blacklists
| Method | Path | Description |
|--------|------|-------------|
| `GET/POST` | `/api/settings/countries` | Country whitelist |
| `GET/POST` | `/api/settings/system` | OS whitelist |
| `GET/POST` | `/api/settings/browser` | Browser whitelist |
| `GET/POST` | `/api/settings/blocked-countries` | Blocked countries |
| `GET/POST/DELETE` | `/api/settings/ip-rules` | IP/Hostname/ISP blacklist |
| `GET/POST/DELETE` | `/api/settings/organizations` | Organization blacklist |
| `GET/POST/DELETE` | `/api/settings/referrer-blacklist` | Referrer blacklist |
| `GET/POST/DELETE` | `/api/settings/hard-block` | Hard blocked IPs |

### Settings — Providers
| Method | Path | Description |
|--------|------|-------------|
| `GET/POST/PUT/DELETE` | `/api/settings/ip-providers` | Country/ISP lookup providers |
| `GET/POST/PUT/DELETE` | `/api/settings/intel-providers` | Threat intelligence providers |
| `GET/PUT` | `/api/settings/vpn-detection` | VPN detection toggle |

### Auth
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Register new user |
| `POST` | `/api/auth/login` | Login |

### Code Generator
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/code/snippet?source=NAME` | Get PHP/Node integration snippets |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express, TypeScript |
| Frontend | React 19, TypeScript, Vite |
| Database | PostgreSQL |
| Cache | Redis (ioredis, keyPrefix: `wg:`) |
| Charts | Chart.js, react-chartjs-2 |
| Icons | Lucide React |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5005` | Backend API port |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USER` | `soufianerochdi` | PostgreSQL user |
| `DB_PASSWORD` | — | PostgreSQL password |
| `DB_NAME` | `webguard` | PostgreSQL database |
| `JWT_SECRET` | — | JWT signing secret |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PREFIX` | `wg:` | Redis key prefix |

## Production Deployment (VPS)

```bash
# Build frontend
cd frontend && npm run build

# Build backend
cd backend && npm run build

# Frontend: Nginx serves on port 80
# Location /api/ proxies to backend on port 5005
# Backend: PM2 manages the process

pm2 start dist/index.js --name webguard-api
pm2 save
```

## License

MIT
