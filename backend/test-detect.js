const { Client } = require('pg');

const pgConfig = {
  host: 'localhost',
  port: 5432,
  user: 'soufianerochdi',
  password: '',
  database: 'webguard',
};

async function setupTestData() {
  const client = new Client(pgConfig);
  await client.connect();
  
  console.log('Seeding test user and settings...');
  try {
    // 1. Create test users: uflow = 'utest' and 'utest2'
    await client.query(`
      INSERT INTO users (uflow, tg_user, password, active, start_sub, end_sub)
      VALUES ('utest', 'test_bot_admin', 'MD5_will_be_bypassed', 1, NOW(), NOW() + INTERVAL '10 days')
      ON CONFLICT (uflow) DO UPDATE 
      SET active = 1, end_sub = NOW() + INTERVAL '10 days';
    `);
    await client.query(`
      INSERT INTO users (uflow, tg_user, password, active, start_sub, end_sub)
      VALUES ('utest2', 'test_bot_admin2', 'MD5_will_be_bypassed', 1, NOW(), NOW() + INTERVAL '10 days')
      ON CONFLICT (uflow) DO UPDATE 
      SET active = 1, end_sub = NOW() + INTERVAL '10 days';
    `);

    // 2. Insert test user settings (default empty countries/systems, custom rate limits)
    await client.query(`
      INSERT INTO user_settings (uflow, countries, systems, rate_limit)
      VALUES ('utest', '', '', 3)
      ON CONFLICT (uflow) DO UPDATE SET countries = '', systems = '', rate_limit = 3;
    `);
    await client.query(`
      INSERT INTO user_settings (uflow, countries, systems, rate_limit)
      VALUES ('utest2', '', '', 120)
      ON CONFLICT (uflow) DO UPDATE SET countries = '', systems = '', rate_limit = 120;
    `);

    // 3. Clear existing test data and seed blacklist entries
    await client.query("DELETE FROM bad_ip WHERE bad_ip IN ('8.8.8.8', '10.0.0.1', '192.168.1.0/24') OR uflow IN ('utest', 'utest2')");
    
    // Global block (uflow = NULL)
    await client.query(`INSERT INTO bad_ip (bad_ip, uflow) VALUES ('8.8.8.8', NULL)`);
    // Customer specific IP block for utest (should allow on utest2)
    await client.query(`INSERT INTO bad_ip (bad_ip, uflow) VALUES ('10.0.0.1', 'utest')`);
    // Customer specific CIDR block for utest (should block 192.168.1.x on utest, allow on utest2)
    await client.query(`INSERT INTO bad_ip (bad_ip, uflow) VALUES ('192.168.1.0/24', 'utest')`);

    // Hostname/ISP entries
    await client.query("INSERT INTO hostname (hostname) VALUES ('crawl-spoof') ON CONFLICT DO NOTHING");
    await client.query("INSERT INTO isp (isp) VALUES ('badisp') ON CONFLICT DO NOTHING");

    console.log('Test data setup completed successfully.');
  } catch (err) {
    console.error('Error seeding test data:', err);
  } finally {
    await client.end();
  }
}

async function runTests() {
  const API_URL = 'http://localhost:5005/api/detect';
  
  const testCases = [
    {
      name: 'Normal Human Browser (Allow)',
      payload: {
        fd: 'utest',
        ip: '72.229.28.185', // Residential IP
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ref: 'https://google.com'
      },
      expected: '1'
    },
    {
      name: 'Blacklisted IP 8.8.8.8 (Block)',
      payload: {
        fd: 'utest',
        ip: '8.8.8.8',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ref: ''
      },
      expected: '0'
    },
    {
      name: 'Authentic Googlebot (Block)',
      payload: {
        fd: 'utest',
        ip: '66.249.66.1', // Real Googlebot IP range
        ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        ref: ''
      },
      expected: '0'
    },
    {
      name: 'Spoofed Googlebot (Block)',
      payload: {
        fd: 'utest',
        ip: '8.8.4.4', // Claims to be Googlebot but IP is Google Public DNS (no reverse DNS pointing to Googlebot)
        ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        ref: ''
      },
      expected: '0'
    },
    {
      name: 'Cloud Hosting Scraper (Block via Cloud ISP Check)',
      payload: {
        fd: 'utest',
        ip: '52.95.110.1', // Amazon AWS IP
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', // Claims to be Windows Chrome
        ref: ''
      },
      expected: '0'
    },
    {
      name: 'Blacklisted ISP pattern (Block)',
      payload: {
        fd: 'utest',
        ip: '1.1.1.1',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        ref: '',
        // We simulate a bad ISP by passing it if we mocked it, but the detection service fetches from real geoip.
        // Let's rely on standard tests.
      },
      expected: null // Will depend on real geoip lookup for 1.1.1.1
    },
    {
      name: 'JA3 Fingerprint Block (curl TLS signature)',
      payload: {
        fd: 'utest',
        ip: '72.229.28.185',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ref: ''
      },
      headers: {
        'x-ja3-fingerprint': '37f46e8c75d7b5791c144e5917805ad3' // curl JA3 signature
      },
      expected: '0'
    },
    {
      name: 'Multi-tenant: IP blocked on utest (Block)',
      payload: {
        fd: 'utest',
        ip: '10.0.0.1',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ref: ''
      },
      expected: '0'
    },
    {
      name: 'Multi-tenant: IP allowed on utest2 (Allow)',
      payload: {
        fd: 'utest2',
        ip: '10.0.0.1',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ref: ''
      },
      expected: '1'
    },
    {
      name: 'CIDR: Subnet block on utest (Block 192.168.1.5)',
      payload: {
        fd: 'utest',
        ip: '192.168.1.5',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ref: ''
      },
      expected: '0'
    },
    {
      name: 'CIDR: Subnet allowed on utest2 (Allow 192.168.1.5)',
      payload: {
        fd: 'utest2',
        ip: '192.168.1.5',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ref: ''
      },
      expected: '1'
    },
    {
      name: 'Minor Browser: Arc Browser (Allow)',
      payload: {
        fd: 'utest',
        ip: '72.229.28.185',
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Arc/1.0.0 Chrome/120.0.0.0 Safari/537.36',
        ref: ''
      },
      expected: '1'
    },
    {
      name: 'Minor Browser: Tor Browser (Allow)',
      payload: {
        fd: 'utest',
        ip: '72.229.28.185',
        ua: 'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0 TorBrowser/13.0.1',
        ref: ''
      },
      expected: '1'
    },
  ];

  console.log('\nStarting bot detection API tests...');
  let passedCount = 0;
  let runCount = 0;

  for (const tc of testCases) {
    runCount++;
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tc.headers || {}) },
        body: JSON.stringify(tc.payload),
      });

      if (!res.ok) {
        throw new Error(`HTTP Error: ${res.status}`);
      }

      const resultText = await res.text();
      const status = resultText === tc.expected ? 'PASSED' : 'FAILED';
      
      if (tc.expected !== null) {
        if (resultText === tc.expected) passedCount++;
        console.log(`[${status}] ${tc.name}: Expected ${tc.expected}, Got ${resultText}`);
      } else {
        console.log(`[INFO] ${tc.name}: Got ${resultText} (Real IP Lookup)`);
      }
    } catch (err) {
      console.error(`[ERROR] ${tc.name}:`, err.message);
    }
  }

  console.log(`\nTests finished: ${passedCount}/${testCases.filter(t => t.expected !== null).length} tests passed.`);

  // ─── Rate Limit Test ───
  console.log('\nStarting Rate Limit test (Threshold = 3)...');
  const rateLimitPayload = {
    fd: 'utest',
    ip: '72.229.28.199', // Test IP
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ref: 'https://google.com'
  };

  let rateLimitPassed = true;
  for (let i = 1; i <= 4; i++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rateLimitPayload),
      });
      const resultText = await res.text();
      const blockReason = res.headers.get('X-WebGuard-Block-Reason');
      
      if (i <= 3) {
        if (resultText !== '1') {
          console.log(`[FAILED] Rate Limit Request #${i}: Expected 1 (Allow), Got ${resultText}`);
          rateLimitPassed = false;
        } else {
          console.log(`[PASSED] Rate Limit Request #${i}: Got 1 (Allow)`);
        }
      } else {
        // Request #4 should be blocked (rate limit exceeded)
        if (resultText !== '0' || blockReason !== 'Rate limit exceeded') {
          console.log(`[FAILED] Rate Limit Request #${i} (Expect Block): Got ${resultText}, Block Reason Header: ${blockReason}`);
          rateLimitPassed = false;
        } else {
          console.log(`[PASSED] Rate Limit Request #${i} (Blocked): Got ${resultText}, Block Reason Header: ${blockReason}`);
        }
      }
    } catch (err) {
      console.error(`[ERROR] Rate Limit Request #${i}:`, err.message);
      rateLimitPassed = false;
    }
  }

  if (rateLimitPassed) {
    console.log('[PASSED] Rate Limit Dynamic Test Successful.');
  } else {
    console.log('[FAILED] Rate Limit Dynamic Test Failed.');
  }
}

async function main() {
  try {
    await setupTestData();
    // Small delay to ensure DB transaction is committed and server is ready
    setTimeout(runTests, 1000);
  } catch (err) {
    console.error('Test execution failed:', err);
  }
}

main();
