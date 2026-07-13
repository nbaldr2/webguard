import dns from 'dns';
import net from 'net';
import { db } from '../db';
import redis, { isRedisConnected } from '../redis';

// Fallback in-memory cache when Redis is unavailable
const memCache = new Map<string, { country: string; isp: string; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const REDIS_TTL = 60 * 60 * 24; // 24 hours in seconds for Redis

interface IPInfo {
  country: string;
  isp: string;
}

async function cacheGet(ip: string): Promise<{ country: string; isp: string } | null> {
  if (isRedisConnected()) {
    try {
      const data = await redis.get(`ip:${ip}`);
      if (data) return JSON.parse(data);
    } catch { /* fall through */ }
  }
  const cached = memCache.get(ip);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return { country: cached.country, isp: cached.isp };
  }
  return null;
}

async function cacheSet(ip: string, data: { country: string; isp: string }): Promise<void> {
  if (isRedisConnected()) {
    try {
      await redis.setex(`ip:${ip}`, REDIS_TTL, JSON.stringify(data));
      return;
    } catch { /* fall through */ }
  }
  memCache.set(ip, { ...data, timestamp: Date.now() });
}

// Verdict cache: stores the allow/block decision + reason for a (uflow, ip) pair.
// On a cache hit we skip the entire detection pipeline (geo API, rDNS, blacklist &
// settings DB queries) and just replay the cached verdict. Keyed by uflow so that
// per-user blacklists / whitelists stay isolated.
interface CachedVerdict {
  country: string;
  isp: string;
  isBot: number;
  blockReason: string;
}

async function verdictCacheGet(ip: string, uflow: string): Promise<CachedVerdict | null> {
  if (!isRedisConnected()) return null;
  try {
    const data = await redis.get(`v:${uflow}:${ip}`);
    if (data) return JSON.parse(data);
  } catch { /* fall through */ }
  return null;
}

async function verdictCacheSet(ip: string, uflow: string, verdict: CachedVerdict): Promise<void> {
  if (!isRedisConnected()) return;
  try {
    await redis.setex(`v:${uflow}:${ip}`, REDIS_TTL, JSON.stringify(verdict));
  } catch { /* ignore */ }
}

// Sliding-window rate limit using Redis sorted sets (ZADD/ZREM)
async function isRateLimited(ip: string, uflow: string, limit: number = 60, windowSec: number = 60): Promise<boolean> {
  if (!isRedisConnected()) return false; // Fail open if Redis is offline
  
  const key = `ratelimit:${uflow}:${ip}`;
  const now = Date.now();
  const clearBefore = now - (windowSec * 1000);
  
  try {
    const multi = redis.multi();
    // Remove old logs outside of window
    multi.zremrangebyscore(key, 0, clearBefore);
    // Add current request log
    multi.zadd(key, now, String(now));
    // Count remaining logs in window
    multi.zcard(key);
    // Set TTL on key
    multi.expire(key, windowSec);
    
    const results = await multi.exec();
    if (!results) return false;
    
    // ZCARD command is 3rd in the transaction sequence (index 2)
    const cardResult = results[2];
    const count = typeof cardResult === 'number' ? cardResult : (cardResult && cardResult[1] ? Number(cardResult[1]) : 0);
    
    return count > limit;
  } catch (err) {
    console.warn('Rate limit check Redis error:', (err as Error).message);
    return false;
  }
}

// Known automated scraper/bot JA3 TLS signatures
const BLOCKED_JA3 = [
  '37f46e8c75d7b5791c144e5917805ad3', // curl (common OpenSSL)
  'c3b7a5a8820f4c02288dbff46b9a896d', // python-requests
  'e2c45163d76e737c3ed03a08fb635a96'  // Go HTTP client
];

// Check if the user agent matches known crawlers, bots, scrapers, or automation tools
function isBotOrCrawlerUA(ua: string): boolean {
  const uaLower = ua.toLowerCase();
  
  const botKeywords = [
    'bot', 'crawler', 'spider', 'crawl', 'scraper', 'scraping',
    'ahrefs', 'semrush', 'gptbot', 'claudebot', 'commoncrawl',
    'facebookexternalhit', 'twitterbot', 'linkedinbot', 'slackbot',
    'discordbot', 'whatsapp', 'telegrambot', 'pinterestbot',
    'headless', 'selenium', 'playwright', 'puppeteer', 'webdriver',
    'curl', 'wget', 'python', 'urllib', 'http-client', 'httpclient',
    'perl', 'libwww', 'axios', 'node-fetch', 'go-http-client', 'java/'
  ];
  
  if (botKeywords.some(keyword => uaLower.includes(keyword))) {
    return true;
  }
  
  if (/https?:\/\//i.test(ua)) {
    return true;
  }
  
  return false;
}

// Fetch IP details from user-configured external APIs with failover and caching
export async function getIPInfo(ip: string, uflow?: string): Promise<IPInfo> {
  // Check cache first (Redis or in-memory fallback)
  const cached = await cacheGet(ip);
  if (cached) return cached;

  // Fetch user's enabled IP providers from DB
  let providers: any[] = [];
  if (uflow) {
    try {
      const res = await db.query(
        'SELECT name, url_template, api_key, country_field, isp_field FROM ip_providers WHERE uflow = $1 AND enabled = true ORDER BY sort_order ASC, id ASC',
        [uflow]
      );
      providers = res.rows;
    } catch (err) {
      console.warn('Failed to fetch IP providers from DB, using defaults:', (err as Error).message);
    }
  }

  // Fallback defaults if no providers configured
  if (providers.length === 0) {
    providers = [
      { name: 'ip-api.com', url_template: 'http://ip-api.com/json/{ip}', api_key: '', country_field: 'countryCode', isp_field: 'isp' },
      { name: 'ipapi.co', url_template: 'https://ipapi.co/{ip}/json/', api_key: '', country_field: 'country_code', isp_field: 'org' },
    ];
  }

  for (const provider of providers) {
    try {
      let url = provider.url_template.replace('{ip}', ip);
      if (provider.api_key) {
        url = url.replace('{key}', provider.api_key);
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${provider.name} returned ${res.status}`);
      const data = await res.json() as any;
      const country = extractField(data, provider.country_field) || 'N/A';
      const isp = extractField(data, provider.isp_field) || 'N/A';
      if (country === 'N/A') throw new Error(`${provider.name} returned no country`);
      await cacheSet(ip, { country, isp });
      return { country, isp };
    } catch (err) {
      console.warn(`IP provider "${provider.name}" failed: ${(err as Error).message}. Trying fallback...`);
    }
  }

  return { country: 'N/A', isp: 'N/A' };
}

// Extract nested field value from JSON object using dot notation (e.g. "data.country")
function extractField(obj: any, field: string): string | null {
  const parts = field.split('.');
  let value = obj;
  for (const part of parts) {
    if (value == null || typeof value !== 'object') return null;
    value = value[part];
  }
  return value != null ? String(value) : null;
}

// Parse OS from user agent string
// Note: Windows 11 still reports "Windows NT 10.0" in classic UAs.
// We use browser-version heuristics (Chrome/Edge 96+, Firefox 95+) to distinguish it.
// Windows Server detection relies on explicit "Windows Server" text in the UA or test tags.
export function getDetectedOS(ua: string): string {
  // --- Windows Server (must check before NT version numbers) ---
  if (/windows server 2022/i.test(ua) || /windows nt 10\.0[^)]*server 2022/i.test(ua)) return 'Windows Server 2022';
  if (/windows server 2019/i.test(ua) || /windows nt 10\.0[^)]*server 2019/i.test(ua)) return 'Windows Server 2019';
  if (/windows server 2016/i.test(ua) || /windows nt 10\.0[^)]*server 2016/i.test(ua)) return 'Windows Server 2016';
  if (/windows server 2012 r2/i.test(ua) || /windows nt 6\.3[^)]*server/i.test(ua))    return 'Windows Server 2012 R2';
  if (/windows server 2012(?! r2)/i.test(ua) || /windows nt 6\.2[^)]*server/i.test(ua)) return 'Windows Server 2012';
  if (/windows server 2008 r2/i.test(ua) || /windows nt 6\.1[^)]*server/i.test(ua))    return 'Windows Server 2008 R2';

  // --- Windows 11 ---
  // Windows 11 uses "Windows NT 10.0" in legacy UA strings just like Windows 10.
  // Heuristic: Chrome 96+, Edge 96+, or Firefox 95+ on Win64 indicates Win11 era.
  if (/windows nt 10\.0/i.test(ua) && /win64/i.test(ua)) {
    const chromeVer = (ua.match(/chrome\/(\d+)/i) || [])[1];
    const edgeVer   = (ua.match(/edg(?:e|)\/(\d+)/i) || [])[1];
    const ffVer     = (ua.match(/firefox\/(\d+)/i) || [])[1];
    if (
      (chromeVer && parseInt(chromeVer, 10) >= 96) ||
      (edgeVer   && parseInt(edgeVer,   10) >= 96) ||
      (ffVer     && parseInt(ffVer,     10) >= 95)
    ) {
      return 'Windows 11';
    }
  }

  // --- Standard Windows ---
  if (/windows nt 10/i.test(ua))   return 'Windows 10';
  if (/windows nt 6\.3/i.test(ua)) return 'Windows 8.1';
  if (/windows nt 6\.2/i.test(ua)) return 'Windows 8';
  if (/windows nt 6\.1/i.test(ua)) return 'Windows 7';

  // --- Apple ---
  if (/ipad/i.test(ua))               return 'iPad';
  if (/iphone/i.test(ua))             return 'iPhone';
  if (/macintosh|mac os x/i.test(ua)) return 'Mac OS X';

  // --- Android & Linux ---
  if (/android/i.test(ua))  return 'Android';
  if (/linux/i.test(ua))    return 'Linux';

  // --- Generic Mobile catch-all ---
  if (/mobile|webos|blackberry|symbian|windows phone|opera mini/i.test(ua)) return 'Mobile';

  return 'Unknown OS';
}

// Parse Browser from user agent
export function getDetectedBrowser(ua: string): string {
  // Order matters: more specific patterns first to avoid false matches.

  // In-app browsers (WebView / social app browsers)
  if (/instagram/i.test(ua))              return 'Instagram App';
  if (/fbav|fban|facebookexternalhit/i.test(ua)) return 'Facebook App';
  if (/twitter(?:lite|bot)?/i.test(ua))   return 'Twitter App';
  if (/musical_ly|tiktok/i.test(ua))      return 'TikTok App';

  // Desktop/mobile browsers — Edge before Chrome (Edge UA includes 'Chrome')
  if (/torbrowser/i.test(ua))             return 'Tor Browser';
  if (/arc\//i.test(ua))                  return 'Arc';
  if (/waterfox/i.test(ua))              return 'Waterfox';
  if (/palemoon/i.test(ua))              return 'Pale Moon';
  if (/edg(?:e|)\//i.test(ua))            return 'Edge';
  // Opera GX / Opera — check OPR before generic Chrome
  if (/OPR\//i.test(ua))                  return /GX/i.test(ua) ? 'Opera GX' : 'Opera';
  if (/opera/i.test(ua))                  return 'Opera';
  // Brave — self-identifies via Brave header, but UA falls back to Chrome
  if (/brave/i.test(ua))                  return 'Brave';
  // Vivaldi
  if (/vivaldi/i.test(ua))               return 'Vivaldi';
  // Yandex Browser
  if (/yabrowser/i.test(ua))             return 'Yandex Browser';
  // Samsung Browser (common on Android)
  if (/samsungbrowser/i.test(ua))        return 'Samsung Browser';
  // UC Browser
  if (/ucbrowser|ucweb/i.test(ua))       return 'UC Browser';
  // Standard Chrome (must come after Edge, OPR, Brave, Vivaldi, Yandex, Samsung, UC)
  if (/chrome/i.test(ua))                return 'Chrome';
  // Safari — comes after Chrome since Chrome UA includes 'Safari'
  if (/safari/i.test(ua))                return 'Safari';
  // Firefox
  if (/firefox|fxios/i.test(ua))         return 'Firefox';
  // Internet Explorer
  if (/msie|trident/i.test(ua))          return 'IE';
  // Android / iOS WebView
  if (/wv|webview/i.test(ua))            return 'WebView';

  return 'Unknown Browser';
}

// Check if IP is in the bad_ip table (supporting CIDR subnets and uflow segmentation)
async function isIPBad(ip: string, uflow: string): Promise<boolean> {
  const isIPValid = net.isIP(ip) !== 0;
  
  let psqlQuery = '';
  let params: any[] = [];
  
  if (isIPValid) {
    psqlQuery = `
      SELECT 1 FROM bad_ip 
      WHERE (uflow IS NULL OR uflow = $2) AND (
         $1 = bad_ip 
         OR $1 LIKE REPLACE(bad_ip, '*', '%')
         OR (bad_ip LIKE '%/%' AND $1::inet << bad_ip::cidr)
      )
      LIMIT 1
    `;
    params = [ip, uflow];
  } else {
    psqlQuery = `
      SELECT 1 FROM bad_ip 
      WHERE (uflow IS NULL OR uflow = $2) AND (
         $1 = bad_ip 
         OR $1 LIKE REPLACE(bad_ip, '*', '%')
      )
      LIMIT 1
    `;
    params = [ip, uflow];
  }
  
  const dbRes = await db.query(psqlQuery, params);
  return dbRes.rows.length > 0;
}

// Check if hostname exactly matches a blacklisted pattern (supporting uflow segmentation)
// Uses exact match so residential rDNS hostnames (e.g. subs.proxad.net) are NOT
// blocked by short substring patterns.
async function isHostnameBad(hostname: string, uflow: string): Promise<boolean> {
  if (hostname === 'N/A' || !hostname) return false;
  const dbRes = await db.query(
    `SELECT 1 FROM hostname 
     WHERE (uflow IS NULL OR uflow = $2) 
       AND $1 = hostname
     LIMIT 1`,
    [hostname, uflow]
  );
  return dbRes.rows.length > 0;
}

// Check if ISP matches blacklisted pattern (supporting uflow segmentation)
async function isISPBad(isp: string, uflow: string): Promise<boolean> {
  if (isp === 'N/A' || !isp) return false;
  const dbRes = await db.query(
    `SELECT 1 FROM isp 
     WHERE (uflow IS NULL OR uflow = $2) 
       AND $1 ILIKE CONCAT('%', isp, '%') 
     LIMIT 1`,
    [isp, uflow]
  );
  return dbRes.rows.length > 0;
}

// Enhanced detection engine pipeline
export async function detectBot(params: {
  uflow: string;
  ip: string;
  ua: string;
  ref: string;
  source?: string;
  headers?: Record<string, string | string[] | undefined>;
}): Promise<{ isBot: number; blockReason: string }> {
  const { uflow, ip, ua, ref, source, headers } = params;
  const date = new Date();

  // 1. Validate user and subscription status
  const userRes = await db.query(
    'SELECT active, end_sub FROM users WHERE uflow = $1 LIMIT 1',
    [uflow]
  );

  if (userRes.rows.length === 0) {
    throw new Error('API ERROR: Invalid uflow');
  }

  const user = userRes.rows[0];
  
  // Subscription check
if (user.active === 0) {
    await logVisit({ uflow, ip, country: 'N/A', hostname: 'N/A', isp: 'N/A', os: 'N/A', browser: 'N/A', ref, isBot: 1, source: source || '', blockReason: '' });
    return { isBot: 1, blockReason: '' };
  }

  if (user.active === 2) {
    return { isBot: 0, blockReason: 'Account banned' };
  }

  if (user.end_sub && new Date(user.end_sub) < date) {
    // Expired subscription -> Block/Alert client
    throw new Error('API ERROR: Subscription expired');
  }

  const detectedOS = getDetectedOS(ua);
  const detectedBrowser = getDetectedBrowser(ua);

  // Fast-path: replay cached allow/block verdict for repeat visitors.
  // Skips the geo API, reverse DNS, blacklist lookups and settings query entirely.
  // (Settings/blacklist changes are picked up after the 24h TTL expires.)
  const cachedVerdict = await verdictCacheGet(ip, uflow);
  if (cachedVerdict) {
    await logVisit({
      uflow,
      ip,
      country: cachedVerdict.country,
      hostname: 'N/A',
      isp: cachedVerdict.isp,
      os: detectedOS,
      browser: detectedBrowser,
      ref,
      isBot: cachedVerdict.isBot,
      source: source || '',
      blockReason: cachedVerdict.blockReason,
    });
    return { isBot: cachedVerdict.isBot, blockReason: cachedVerdict.blockReason };
  }

  let isBot = 1; // Default to human (1)
  let blockReason = '';

  // 2. Run Bot Detection Pipeline (fast checks first, expensive I/O deferred)
  const settingsRes = await db.query(
    'SELECT countries, systems, browsers, rate_limit, blocked_countries FROM user_settings WHERE uflow = $1 LIMIT 1',
    [uflow]
  );
  const settings = settingsRes.rows[0] || { countries: '', systems: '', browsers: '', rate_limit: 120, blocked_countries: '' };

  // Immediate Crawler/Bot UA Check — no I/O needed
  if (isBot === 1 && isBotOrCrawlerUA(ua)) {
    isBot = 0;
    blockReason = 'Blocked Crawler/Bot';
  }

  // JA3 TLS Fingerprint Check — no I/O needed
  // Only active when Nginx/proxy forwards X-JA3-Fingerprint or X-SSL-JA3 header
  if (isBot === 1 && headers) {
    const ja3 = headers['x-ja3-fingerprint'] || headers['x-ssl-ja3'] || headers['x-ja3'];
    if (ja3 && typeof ja3 === 'string' && BLOCKED_JA3.includes(ja3.toLowerCase())) {
      isBot = 0;
      blockReason = 'Blocked JA3 TLS fingerprint';
    }
  }

  // Sliding-window Rate Limit — Redis I/O (fast, async)
  if (isBot === 1 && await isRateLimited(ip, uflow, settings.rate_limit || 120)) {
    isBot = 0;
    blockReason = 'Rate limit exceeded';
  }


  // Client Hints Consistency check (User-Agent vs Sec-Ch-Ua-Platform / Sec-Ch-Ua)
  if (isBot === 1 && headers) {
    const chPlatform = headers['sec-ch-ua-platform'] || headers['Sec-Ch-Ua-Platform'];
    if (chPlatform && typeof chPlatform === 'string') {
      const platformClean = chPlatform.replace(/"/g, '').toLowerCase();
      const uaLower = ua.toLowerCase();
      if (platformClean === 'windows' && !uaLower.includes('windows')) {
        isBot = 0;
        blockReason = 'Client Hints / UA mismatch (Windows)';
      } else if (platformClean === 'macos' && (!uaLower.includes('macintosh') && !uaLower.includes('mac os x'))) {
        isBot = 0;
        blockReason = 'Client Hints / UA mismatch (macOS)';
      } else if (platformClean === 'android' && !uaLower.includes('android')) {
        isBot = 0;
        blockReason = 'Client Hints / UA mismatch (Android)';
      } else if (platformClean === 'linux' && !uaLower.includes('linux')) {
        isBot = 0;
        blockReason = 'Client Hints / UA mismatch (Linux)';
      } else if (platformClean === 'ios' && (!uaLower.includes('iphone') && !uaLower.includes('ipad'))) {
        isBot = 0;
        blockReason = 'Client Hints / UA mismatch (iOS)';
      }
    }
  }

  // OS check — no I/O needed
  if (isBot === 1) {
    if (detectedOS === 'Unknown OS') {
      isBot = 0;
      blockReason = 'Unknown OS';
    } else {
      if (settings.systems && settings.systems.trim().length > 0) {
        const allowedSystems = settings.systems
          .split(',')
          .map((s: string) => s.trim().toLowerCase());
        if (!allowedSystems.includes(detectedOS.toLowerCase())) {
          isBot = 0;
          blockReason = 'OS not whitelisted';
        }
      } else {
        const systemRes = await db.query(
          'SELECT 1 FROM system WHERE system = $1 LIMIT 1',
          [detectedOS]
        );
        if (systemRes.rows.length === 0) {
          isBot = 0;
          blockReason = 'Unknown OS';
        }
      }
    }
  }

  // Browser check — no I/O needed
  if (isBot === 1) {
    if (detectedBrowser === 'Unknown Browser') {
      isBot = 0;
      blockReason = 'Unknown browser';
    } else if (settings.browsers && settings.browsers.trim().length > 0) {
      const allowedBrowsers = settings.browsers
        .split(',')
        .map((b: string) => b.trim().toLowerCase());
      if (!allowedBrowsers.includes(detectedBrowser.toLowerCase())) {
        isBot = 0;
        blockReason = 'Browser not whitelisted';
      }
    } else {
      const browserRes = await db.query(
        'SELECT 1 FROM browser WHERE browser = $1 LIMIT 1',
        [detectedBrowser]
      );
      if (browserRes.rows.length === 0) {
        isBot = 0;
        blockReason = 'Browser not whitelisted';
      }
    }
  }

  // IP Blacklist check — fast DB query, no DNS/API needed
  if (isBot === 1 && await isIPBad(ip, uflow)) {
    isBot = 0;
    blockReason = 'Blacklisted IP';
  }

  // Deferred: fetch IP info (country, ISP) — only if needed for remaining checks
  let ipInfo: IPInfo = { country: 'N/A', isp: 'N/A' };
  if (isBot === 1) {
    ipInfo = await getIPInfo(ip, uflow);

    // Country whitelist check
    if (isBot === 1 && ipInfo.country !== 'N/A') {
      if (settings.countries && settings.countries.trim().length > 0) {
        const allowedCountries = settings.countries
          .split(',')
          .map((c: string) => c.trim().toUpperCase());
        if (!allowedCountries.includes(ipInfo.country.toUpperCase())) {
          isBot = 0;
          blockReason = 'Country not whitelisted';
        }
      }
    }

    // Blocked countries check (blacklist overrides whitelist)
    if (isBot === 1 && ipInfo.country !== 'N/A') {
      if (settings.blocked_countries && settings.blocked_countries.trim().length > 0) {
        const blockedCountries = settings.blocked_countries
          .split(',')
          .map((c: string) => c.trim().toUpperCase());
        if (blockedCountries.includes(ipInfo.country.toUpperCase())) {
          isBot = 0;
          blockReason = 'Blocked country';
        }
      }
    }
  }

  // Deferred: reverse DNS lookup — only if needed for remaining checks
  let hostname = 'N/A';
  if (isBot === 1) {
    try {
      const hostnames = await dns.promises.reverse(ip);
      if (hostnames && hostnames.length > 0) {
        hostname = hostnames[0];
      }
    } catch (err) {
      // Ignore reverse DNS lookup failures
    }
  }

  // Hostname / ISP / Cloud checks
  if (isBot === 1) {
    if (await isHostnameBad(hostname, uflow)) {
      isBot = 0;
      blockReason = 'Blacklisted hostname';
    } else if (await isISPBad(ipInfo.isp, uflow)) {
      isBot = 0;
      blockReason = 'Blacklisted ISP';
    } else if (isCloudProvider(ipInfo.isp) && isConsumerUA(ua)) {
      isBot = 0;
      blockReason = 'Cloud/Datacenter IP';
    }
  }

  // Auto-ban blocked IPs (all block reasons except already-blacklisted)
  if (isBot === 0 && blockReason && blockReason !== 'Blacklisted IP') {
    await db.query('INSERT INTO bad_ip (bad_ip) VALUES ($1) ON CONFLICT DO NOTHING', [ip]);
  }
  // 3. Log the visit in PostgreSQL
  await logVisit({
    uflow,
    ip,
    country: ipInfo.country,
    hostname,
    isp: ipInfo.isp,
    os: detectedOS,
    browser: detectedBrowser,
    ref,
    isBot,
    source: source || '',
    blockReason,
  });

  // Cache the verdict (allow/block + reason) for this (uflow, ip) so repeat
  // visitors skip the full detection pipeline for the next 24h.
  await verdictCacheSet(ip, uflow, {
    country: ipInfo.country,
    isp: ipInfo.isp,
    isBot,
    blockReason,
  });

  return { isBot, blockReason };
}

// Log visit to PostgreSQL
async function logVisit(params: {
  uflow: string;
  ip: string;
  country: string;
  hostname: string;
  isp: string;
  os: string;
  browser: string;
  ref: string;
  isBot: number;
  source: string;
  blockReason: string;
}) {
  await db.query(
    `INSERT INTO visits (uflow, date, ip, country, hostname, isp, system, browser, referee, isbot, source, block_reason)
     VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      params.uflow,
      params.ip,
      params.country,
      params.hostname,
      params.isp,
      params.os,
      params.browser,
      params.ref || '',
      params.isBot,
      params.source || '',
      params.blockReason || '',
    ]
  );
}

// Helpers
function isCloudProvider(isp: string): boolean {
  const providers = [
    'amazon', 'aws', 'google cloud', 'gce', 'microsoft', 'azure', 'digitalocean', 
    'vultr', 'linode', 'hetzner', 'ovh', 'leaseweb', 'colocrossing', 'quadranet', 
    'psychz', 'contabo', 'hosting', 'cloud', 'server', 'vps', 'datacenter',
    'scaleway', 'kamatera', 'oracle', 'alibaba', 'tencent', 'ovhcloud', 'cogent',
    'm247', 'choopa', 'zenlayer', 'fastly', 'cloudflare', 'akamai', 'softlayer',
    'rackspace', 'equinix'
  ];
  const ispLower = isp.toLowerCase();
  return providers.some(p => ispLower.includes(p));
}

function isConsumerUA(ua: string): boolean {
  // Checks if the user agent claims to be a consumer browser
  const consumerKeywords = ['windows', 'macintosh', 'android', 'iphone', 'ipad', 'playstation', 'nintendo'];
  const uaLower = ua.toLowerCase();
  return consumerKeywords.some(k => uaLower.includes(k));
}
