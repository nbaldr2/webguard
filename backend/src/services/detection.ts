import dns from 'dns';
import net from 'net';
import { db } from '../db';
import redis, { isRedisConnected } from '../redis';

// Fallback in-memory cache when Redis is unavailable
const memCache = new Map<string, { country: string; isp: string; timestamp: number }>();
const CACHE_TTL = 3 * 24 * 60 * 60 * 1000; // 3 days (ms)
const REDIS_TTL = 60 * 60 * 24 * 3; // 3 days in seconds

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

// Check if IP is in the white_ip table (supporting CIDR subnets, wildcards, and uflow segmentation)
export async function isIPWhitelisted(ip: string, uflow: string): Promise<boolean> {
  const isIPValid = net.isIP(ip) !== 0;

  let psqlQuery = '';
  let params: any[] = [];

  if (isIPValid) {
    psqlQuery = `
      SELECT 1 FROM white_ip
      WHERE (uflow IS NULL OR uflow = $2) AND (
         $1 = ip
         OR $1 LIKE REPLACE(ip, '*', '%')
         OR (ip LIKE '%/%' AND $1::inet << ip::cidr)
      )
      LIMIT 1
    `;
    params = [ip, uflow];
  } else {
    psqlQuery = `
      SELECT 1 FROM white_ip
      WHERE (uflow IS NULL OR uflow = $2) AND (
         $1 = ip
         OR $1 LIKE REPLACE(ip, '*', '%')
      )
      LIMIT 1
    `;
    params = [ip, uflow];
  }

  const dbRes = await db.query(psqlQuery, params);
  return dbRes.rows.length > 0;
}

// Check if hostname matches blacklisted pattern (supporting uflow segmentation)
async function isHostnameBad(hostname: string, uflow: string): Promise<boolean> {
  if (hostname === 'N/A' || !hostname) return false;
  const dbRes = await db.query(
    `SELECT 1 FROM hostname 
     WHERE (uflow IS NULL OR uflow = $2) 
       AND $1 ILIKE CONCAT('%', hostname, '%') 
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

// Check if ISP matches a blocked organization name (case-insensitive exact match)
async function isOrganizationBad(isp: string, uflow: string): Promise<boolean> {
  if (isp === 'N/A' || !isp) return false;
  const dbRes = await db.query(
    `SELECT 1 FROM organizations 
     WHERE (uflow IS NULL OR uflow = $2) 
       AND $1 ILIKE name
     LIMIT 1`,
    [isp, uflow]
  );
  return dbRes.rows.length > 0;
}

// Extract nested field value from JSON object using dot notation
function extractNestedField(obj: any, path: string): any {
  if (!path) return null;
  const parts = path.split('.');
  let value = obj;
  for (const part of parts) {
    if (value == null || typeof value !== 'object') return null;
    value = value[part];
  }
  return value;
}

// Check if referrer matches a blacklisted pattern
async function isReferrerBad(ref: string, uflow: string): Promise<boolean> {
  if (!ref || ref === '') return false;
  const dbRes = await db.query(
    `SELECT 1 FROM referrer_blacklist 
     WHERE uflow = $1 
       AND $2 ILIKE CONCAT('%', pattern, '%')
     LIMIT 1`,
    [uflow, ref]
  );
  return dbRes.rows.length > 0;
}

// Check if IP is a VPN/proxy/hosting/datacenter using configured intel providers
// All provider API calls run in parallel with a 5-second timeout per provider.
// Returns the block reason if detected, or empty string if clean.
async function checkIntelProviders(ip: string, uflow: string): Promise<string> {
  try {
    const settingsRes = await db.query(
      'SELECT vpn_detection_enabled FROM user_settings WHERE uflow = $1',
      [uflow]
    );
    if (settingsRes.rows[0]?.vpn_detection_enabled === 0) return '';

    const providers = await db.query(
      `SELECT id, name, url_template, api_key, method, is_proxy, is_vpn, is_hosting, is_datacenter, is_residential
       FROM intel_providers WHERE uflow = $1 AND enabled = true ORDER BY sort_order ASC, id ASC`,
      [uflow]
    );

    if (providers.rows.length === 0) return '';

    // Run all provider checks in parallel with a 5-second timeout per provider
    const results = await Promise.all(providers.rows.map(async (provider) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        let url = provider.url_template.replace(/\{ip\}/g, ip).replace(/\{key\}/g, provider.api_key || '');
        let data: any;

        if (provider.method === 'POST') {
          // POST providers (e.g. sntlhq) are unreliable for server-side IP checking
          // They auto-detect the caller IP, ignoring the target IP. Skip them.
          clearTimeout(timeout);
          return null;
        } else {
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timeout);
          if (!res.ok) return null;
          data = await res.json();
        }

        // Check residential flag — if the IP is a residential proxy, skip it (legitimate user)
        const residentialVal = extractNestedField(data, provider.is_residential);
        if (residentialVal === true || residentialVal === 1 || residentialVal === 'true' || residentialVal === 'yes') {
          return null;
        }

        const proxyVal = extractNestedField(data, provider.is_proxy);
        const vpnVal = extractNestedField(data, provider.is_vpn);
        const hostingVal = extractNestedField(data, provider.is_hosting);
        const dchVal = extractNestedField(data, provider.is_datacenter);

        const isTruthy = (v: any): boolean => {
          if (v === true || v === 1) return true;
          if (typeof v === 'string') {
            const lower = v.toLowerCase();
            return lower === 'true' || lower === 'yes' || lower === 'vpn' || lower === 'proxy' || lower === 'dch' || lower === 'hosting';
          }
          return false;
        };

        if (isTruthy(proxyVal)) return `Proxy/VPN detected (${provider.name})`;
        if (isTruthy(vpnVal)) return `Proxy/VPN detected (${provider.name})`;
        if (dchVal && isTruthy(dchVal)) return `Datacenter IP detected (${provider.name})`;
        if (hostingVal && (isTruthy(hostingVal) || hostingVal === 'DCH')) return `Hosting/Cloud detected (${provider.name})`;
      } catch {
        // Timeout or network error — skip this provider
      }
      return null;
    }));

    // Return the first positive result
    for (const result of results) {
      if (result) return result;
    }
  } catch {
    // DB error, skip intel check
  }
  return '';
}

// Check IP against proxycheck.io API with automatic key rotation and daily quota tracking
// Uses Redis counters per key (reset automatically at midnight via TTL)
async function checkProxycheck(ip: string, uflow: string): Promise<string> {
  try {
    const settingsRes = await db.query(
      'SELECT proxycheck_enabled FROM user_settings WHERE uflow = $1',
      [uflow]
    );
    if (settingsRes.rows[0]?.proxycheck_enabled === 0) return '';

    const keys = await db.query(
      'SELECT id, api_key, daily_quota FROM proxycheck_keys WHERE enabled = true ORDER BY id ASC'
    );
    if (keys.rows.length === 0) return '';

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    for (const key of keys.rows) {
      const quotaKey = `proxycheck:${key.api_key}:${today}`;
      try {
        const usedStr = await redis.get(quotaKey);
        const used = parseInt(usedStr || '0', 10);
        if (used >= key.daily_quota) continue;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const url = `https://proxycheck.io/v2/${ip}?key=${key.api_key}&vpn=1`;
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) continue;

        await redis.incr(quotaKey);
        await redis.expire(quotaKey, 86400);

        const data: any = await res.json();
        if (data.status !== 'ok') continue;

        const ipData = data[ip];
        if (!ipData) continue;

        const isProxy = ipData.proxy === 'yes';
        const proxyType = (ipData.type || '').toLowerCase();

        if (isProxy && (proxyType === 'vpn' || proxyType === 'proxy')) return `Proxy/VPN detected (proxycheck.io)`;
        if (proxyType === 'hosting' || proxyType === 'host' || proxyType === 'dc') return `Hosting/Cloud detected (proxycheck.io)`;
      } catch {
        continue;
      }
    }
  } catch {
    // DB error, skip proxycheck
  }
  return '';
}

// Check IP against abuseipdb.com API with automatic key rotation and daily quota tracking
async function checkAbuseIPDB(ip: string, uflow: string): Promise<string> {
  try {
    const settingsRes = await db.query(
      'SELECT abuseipdb_enabled FROM user_settings WHERE uflow = $1',
      [uflow]
    );
    if (settingsRes.rows[0]?.abuseipdb_enabled === 0) return '';

    const keys = await db.query(
      'SELECT id, api_key, daily_quota FROM abuseipdb_keys WHERE enabled = true ORDER BY id ASC'
    );
    if (keys.rows.length === 0) return '';

    const today = new Date().toISOString().slice(0, 10);

    for (const key of keys.rows) {
      const quotaKey = `abuseipdb:${key.api_key}:${today}`;
      try {
        const usedStr = await redis.get(quotaKey);
        const used = parseInt(usedStr || '0', 10);
        if (used >= key.daily_quota) continue;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(`https://api.abuseipdb.com/api/v2/check?ipAddress=${ip}&maxAgeInDays=90`, {
          headers: { 'Key': key.api_key, 'Accept': 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) {
          // 429 = quota exceeded, skip this key
          if (res.status === 429) {
            await redis.set(quotaKey, String(key.daily_quota), 'EX', 86400);
          }
          continue;
        }

        await redis.incr(quotaKey);
        await redis.expire(quotaKey, 86400);

        const data: any = await res.json();
        const d = data?.data;
        if (!d) continue;

        const score = d.abuseConfidenceScore || 0;
        const usageType = (d.usageType || '').toLowerCase();
        const isTor = d.isTor === true;

        if (isTor) return `Tor detected (abuseipdb)`;
        if (score >= 25) return `Abuse IP detected (abuseipdb)`;
        if (usageType.includes('data center') || usageType.includes('hosting') || usageType.includes('transit')) return `Hosting/Cloud detected (abuseipdb)`;
      } catch {
        continue;
      }
    }
  } catch {
    // DB error, skip abuseipdb
  }
  return '';
}

// Check IP against vpnapi.io API with automatic key rotation and daily quota tracking
async function checkVPNapi(ip: string, uflow: string): Promise<string> {
  try {
    const settingsRes = await db.query(
      'SELECT vpnapi_enabled FROM user_settings WHERE uflow = $1',
      [uflow]
    );
    if (settingsRes.rows[0]?.vpnapi_enabled === 0) return '';

    const keys = await db.query(
      'SELECT id, api_key, daily_quota FROM vpnapi_keys WHERE enabled = true ORDER BY id ASC'
    );
    if (keys.rows.length === 0) return '';

    const today = new Date().toISOString().slice(0, 10);

    for (const key of keys.rows) {
      const quotaKey = `vpnapi:${key.api_key}:${today}`;
      try {
        const usedStr = await redis.get(quotaKey);
        const used = parseInt(usedStr || '0', 10);
        if (used >= key.daily_quota) continue;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(`https://vpnapi.io/api/${ip}?key=${key.api_key}`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) continue;

        await redis.incr(quotaKey);
        await redis.expire(quotaKey, 86400);

        const data: any = await res.json();
        const security = data?.security;
        if (!security) continue;

        if (security.tor === true) return `Tor detected (vpnapi.io)`;
        if (security.vpn === true) return `VPN detected (vpnapi.io)`;
        if (security.proxy === true) return `Proxy detected (vpnapi.io)`;
        if (security.relay === true) return `Relay detected (vpnapi.io)`;
      } catch {
        continue;
      }
    }
  } catch {
    // DB error, skip vpnapi
  }
  return '';
}

// Check IP against iplocate.io API with automatic key rotation and daily quota tracking
async function checkIPLocate(ip: string, uflow: string): Promise<string> {
  try {
    const settingsRes = await db.query(
      'SELECT iplocate_enabled FROM user_settings WHERE uflow = $1',
      [uflow]
    );
    if (settingsRes.rows[0]?.iplocate_enabled === 0) return '';

    const keys = await db.query(
      'SELECT id, api_key, daily_quota FROM iplocate_keys WHERE enabled = true ORDER BY id ASC'
    );
    if (keys.rows.length === 0) return '';

    const today = new Date().toISOString().slice(0, 10);

    for (const key of keys.rows) {
      const quotaKey = `iplocate:${key.api_key}:${today}`;
      try {
        const usedStr = await redis.get(quotaKey);
        const used = parseInt(usedStr || '0', 10);
        if (used >= key.daily_quota) continue;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(`https://iplocate.io/api/lookup/${ip}?apikey=${key.api_key}`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) continue;

        await redis.incr(quotaKey);
        await redis.expire(quotaKey, 86400);

        const data: any = await res.json();
        const privacy = data?.privacy;
        if (!privacy) continue;

        if (privacy.is_abuser === true) return 'IPLocate ip abuser';
        if (privacy.is_anonymous === true) return 'IPLocate ip anonymous';
        if (privacy.is_bogon === true) return 'IPLocate ip bogon';
        if (privacy.is_hosting === true) return 'IPLocate ip hosting';
        if (privacy.is_icloud_relay === true) return 'IPLocate ip icloud relay';
        if (privacy.is_proxy === true) return 'IPLocate ip proxy';
        if (privacy.is_tor === true) return 'IPLocate ip tor';
        if (privacy.is_vpn === true) return 'IPLocate ip vpn';
      } catch {
        continue;
      }
    }
  } catch {
    // DB error, skip iplocate
  }
  return '';
}

// Seconds remaining until the start of the next month (for monthly quota TTLs)
function secondsUntilNextMonth(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.max(60, Math.floor((next.getTime() - now.getTime()) / 1000));
}

// Check IP against fraudlogix.com with monthly key rotation (1000 req/month per key).
// Blocks when the RiskScore is High/Extreme, or when the risk is Low/Medium but the
// IP is flagged as Proxy, VPN, TOR, DataCenter, or MaskedDevices (AbnormalTraffic and
// SearchEngineBot are ignored). If all keys fail or are exhausted, the whole step is
// skipped until the 1st of the next month.
async function checkFraudLogix(ip: string, uflow: string): Promise<string> {
  try {
    const settingsRes = await db.query(
      'SELECT fraudlogix_enabled FROM user_settings WHERE uflow = $1',
      [uflow]
    );
    if (settingsRes.rows[0]?.fraudlogix_enabled === 0) return '';

    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const ttl = secondsUntilNextMonth();

    const skipKey = `fraudlogix:skip:${month}`;
    const skip = await redis.get(skipKey);
    if (skip) return '';

    const keys = await db.query(
      'SELECT id, api_key, monthly_quota FROM fraudlogix_keys WHERE enabled = true ORDER BY id ASC'
    );
    if (keys.rows.length === 0) return '';

    let anySuccess = false;

    for (const key of keys.rows) {
      const quotaKey = `fraudlogix:${key.api_key}:${month}`;
      try {
        const usedStr = await redis.get(quotaKey);
        const used = parseInt(usedStr || '0', 10);
        if (used >= key.monthly_quota) continue;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(`https://iplist.fraudlogix.com/v5?ip=${ip}`, {
          headers: { 'x-api-key': key.api_key, 'Content-Type': 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) continue;

        anySuccess = true;
        await redis.incr(quotaKey);
        await redis.expire(quotaKey, ttl);

        const data: any = await res.json();
        const risk = String(data?.RiskScore || '').toLowerCase();
        if (risk === 'high' || risk === 'extreme') {
          return `FraudLogix risk ${data.RiskScore}`;
        }
        if (risk === 'low' || risk === 'medium') {
          if (data?.Proxy === true) return 'FraudLogix - Proxy';
          if (data?.VPN === true) return 'FraudLogix - VPN';
          if (data?.TOR === true) return 'FraudLogix - TOR';
          if (data?.DataCenter === true) return 'FraudLogix - DataCenter';
          if (data?.MaskedDevices === true) return 'FraudLogix - MaskedDevices';
        }
        return '';
      } catch {
        continue;
      }
    }

    // Every key either exhausted or failed — skip this step until next month
    if (!anySuccess) {
      try { await redis.set(skipKey, '1', 'EX', ttl); } catch {}
    }
  } catch {
    // DB error, skip fraudlogix
  }
  return '';
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

  // IP allowlist fast-path: explicitly whitelisted IPs bypass the entire detection pipeline
  // (blacklists, geo rules, intel providers, and the verdict cache) and are always allowed.
  if (await isIPWhitelisted(ip, uflow)) {
    const wlInfo = await getIPInfo(ip, uflow);
    await logVisit({
      uflow,
      ip,
      country: wlInfo.country,
      hostname: 'N/A',
      isp: wlInfo.isp,
      os: detectedOS,
      browser: detectedBrowser,
      ref,
      isBot: 1,
      source: source || '',
      blockReason: '',
    });
    await verdictCacheSet(ip, uflow, { country: wlInfo.country, isp: wlInfo.isp, isBot: 1, blockReason: '' });
    return { isBot: 1, blockReason: '' };
  }

  // 2. Fetch settings (lightweight DB query, needed for both cache validation and pipeline)
  const settingsRes = await db.query(
    'SELECT countries, systems, browsers, rate_limit, blocked_countries FROM user_settings WHERE uflow = $1 LIMIT 1',
    [uflow]
  );
  const settings = settingsRes.rows[0] || { countries: '', systems: '', browsers: '', rate_limit: 120, blocked_countries: '' };

  // Fast-path: replay cached verdict for repeat visitors ONLY if the fast checks
  // (OS, browser, country whitelist, blocked countries) still agree with the cached decision.
  // If settings changed since the cache was written, the cache is invalidated and we
  // fall through to the full detection pipeline.
  const cachedVerdict = await verdictCacheGet(ip, uflow);
  if (cachedVerdict) {
    let cacheStale = false;

    // OS check
    const osOk = (() => {
      if (detectedOS === 'Unknown OS') return false;
      if (settings.systems && settings.systems.trim().length > 0) {
        const allowed = settings.systems.split(',').map((s: string) => s.trim().toLowerCase());
        return allowed.includes(detectedOS.toLowerCase());
      }
      return true;
    })();

    // Browser check
    const browserOk = (() => {
      if (detectedBrowser === 'Unknown Browser') return false;
      if (settings.browsers && settings.browsers.trim().length > 0) {
        const allowed = settings.browsers.split(',').map((b: string) => b.trim().toLowerCase());
        return allowed.includes(detectedBrowser.toLowerCase());
      }
      return true;
    })();

    if (!osOk || !browserOk) {
      // Settings changed — cached verdict is stale
      cacheStale = true;
    }

    if (!cacheStale) {
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
  }

  let isBot = 1; // Default to human (1)
  let blockReason = '';

  // Continue with full detection pipeline from the start (after settings fetch)
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

  // Referrer Blacklist check — no I/O needed (fast ILIKE query)
  if (isBot === 1 && ref && await isReferrerBad(ref, uflow)) {
    isBot = 0;
    blockReason = 'Blocked referrer';
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
    if (isBot === 1) {
      if (settings.countries && settings.countries.trim().length > 0) {
        if (ipInfo.country === 'N/A' || !settings.countries.split(',').map((c: string) => c.trim().toUpperCase()).includes(ipInfo.country.toUpperCase())) {
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
    } else if (await isOrganizationBad(ipInfo.isp, uflow)) {
      isBot = 0;
      blockReason = 'Blocked organization';
    } else if (isCloudProvider(ipInfo.isp) && isConsumerUA(ua)) {
      isBot = 0;
      blockReason = 'Cloud/Datacenter IP';
    }
  }

  // AbuseIPDB check (abuse reports, Tor, hosting with automatic key rotation and daily quota)
  if (isBot === 1) {
    blockReason = await checkAbuseIPDB(ip, uflow);
    if (blockReason) {
      isBot = 0;
    }
  }

  // IPLocate check (geolocation + privacy/threat flags with key rotation and daily quota)
  if (isBot === 1) {
    blockReason = await checkIPLocate(ip, uflow);
    if (blockReason) {
      isBot = 0;
    }
  }

  // Intel provider check (VPN/proxy/hosting/datacenter detection via external APIs)
  if (isBot === 1) {
    blockReason = await checkIntelProviders(ip, uflow);
    if (blockReason) {
      isBot = 0;
    }
  }

  // Proxycheck.io check (VPN/proxy/hosting with automatic key rotation and daily quota)
  if (isBot === 1) {
    blockReason = await checkProxycheck(ip, uflow);
    if (blockReason) {
      isBot = 0;
    }
  }

  // VPNapi.io check (VPN/proxy/Tor/relay with automatic key rotation and daily quota)
  if (isBot === 1) {
    blockReason = await checkVPNapi(ip, uflow);
    if (blockReason) {
      isBot = 0;
    }
  }

  // FraudLogix check (High/Extreme risk or Proxy/VPN/TOR/DataCenter/MaskedDevices flags with monthly key rotation, 1K req/month per key)
  if (isBot === 1) {
    blockReason = await checkFraudLogix(ip, uflow);
    if (blockReason) {
      isBot = 0;
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
