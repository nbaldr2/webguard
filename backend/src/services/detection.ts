import dns from 'dns';
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

// Check if IP is in the bad_ip table
async function isIPBad(ip: string): Promise<boolean> {
  const psqlQuery = `
    SELECT 1 FROM bad_ip 
    WHERE $1 = bad_ip 
       OR $1 LIKE REPLACE(bad_ip, '*', '%')
    LIMIT 1
  `;
  const dbRes = await db.query(psqlQuery, [ip]);
  return dbRes.rows.length > 0;
}

// Check if hostname matches blacklisted pattern
async function isHostnameBad(hostname: string): Promise<boolean> {
  if (hostname === 'N/A' || !hostname) return false;
  // Check if hostname contains any blacklisted hostname pattern
  const dbRes = await db.query(
    `SELECT 1 FROM hostname WHERE $1 ILIKE CONCAT('%', hostname, '%') LIMIT 1`,
    [hostname]
  );
  return dbRes.rows.length > 0;
}

// Check if ISP matches blacklisted pattern
async function isISPBad(isp: string): Promise<boolean> {
  if (isp === 'N/A' || !isp) return false;
  const dbRes = await db.query(
    `SELECT 1 FROM isp WHERE $1 ILIKE CONCAT('%', isp, '%') LIMIT 1`,
    [isp]
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
}): Promise<number> {
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
    // Antibot toggled OFF by user -> Allow all traffic (bypass)
    await logVisit({ uflow, ip, country: 'N/A', hostname: 'N/A', isp: 'N/A', os: 'N/A', browser: 'N/A', ref, isBot: 1, source: source || '', blockReason: '' });
    return 1;
  }

  if (user.active === 2) {
    // Account pending or banned -> Block
    return 0;
  }

  if (user.end_sub && new Date(user.end_sub) < date) {
    // Expired subscription -> Block/Alert client
    throw new Error('API ERROR: Subscription expired');
  }

  const detectedOS = getDetectedOS(ua);
  const detectedBrowser = getDetectedBrowser(ua);

  let isBot = 1; // Default to human (1)
  let blockReason = '';

  // 2. Run Bot Detection Pipeline (fast checks first, expensive I/O deferred)
  const settingsRes = await db.query(
    'SELECT countries, systems, browsers FROM user_settings WHERE uflow = $1 LIMIT 1',
    [uflow]
  );
  const settings = settingsRes.rows[0] || { countries: '', systems: '', browsers: '' };

  // Immediate Crawler/Bot UA Check — no I/O needed
  if (isBot === 1 && isBotOrCrawlerUA(ua)) {
    isBot = 0;
    blockReason = 'Blocked Crawler/Bot';
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
          await db.query('INSERT INTO bad_ip (bad_ip) VALUES ($1) ON CONFLICT DO NOTHING', [ip]);
        }
      } else {
        const systemRes = await db.query(
          'SELECT 1 FROM system WHERE system = $1 LIMIT 1',
          [detectedOS]
        );
        if (systemRes.rows.length === 0) {
          isBot = 0;
          blockReason = 'Unknown OS';
          await db.query('INSERT INTO bad_ip (bad_ip) VALUES ($1) ON CONFLICT DO NOTHING', [ip]);
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
  if (isBot === 1 && await isIPBad(ip)) {
    isBot = 0;
    blockReason = 'Blacklisted IP';
  }

  // Deferred: fetch IP info (country, ISP) — only if needed for remaining checks
  let ipInfo: IPInfo = { country: 'N/A', isp: 'N/A' };
  if (isBot === 1) {
    ipInfo = await getIPInfo(ip, uflow);

    // Country whitelist check
    if (ipInfo.country !== 'N/A') {
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
    if (await isHostnameBad(hostname)) {
      isBot = 0;
      blockReason = 'Blacklisted hostname';
    } else if (await isISPBad(ipInfo.isp)) {
      isBot = 0;
      blockReason = 'Blacklisted ISP';
    } else if (isCloudProvider(ipInfo.isp) && isConsumerUA(ua)) {
      isBot = 0;
      blockReason = 'Cloud/Datacenter IP';
      await db.query('INSERT INTO bad_ip (bad_ip) VALUES ($1) ON CONFLICT DO NOTHING', [ip]);
    }
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

  return isBot;
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
    'psychz', 'contabo', 'hosting', 'cloud', 'server', 'vps', 'datacenter'
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
