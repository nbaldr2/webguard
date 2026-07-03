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
    // 1. Create a test user: uflow = 'utest', password = 'password', active = 1, start_sub = now, end_sub = now + 10 days
    await client.query(`
      INSERT INTO users (uflow, tg_user, password, active, start_sub, end_sub)
      VALUES ('utest', 'test_bot_admin', 'MD5_will_be_bypassed', 1, NOW(), NOW() + INTERVAL '10 days')
      ON CONFLICT (uflow) DO UPDATE 
      SET active = 1, end_sub = NOW() + INTERVAL '10 days';
    `);

    // 2. Insert test user settings (default empty allowed countries/systems)
    await client.query(`
      INSERT INTO user_settings (uflow, countries, systems)
      VALUES ('utest', '', '')
      ON CONFLICT (uflow) DO UPDATE SET countries = '', systems = '';
    `);

    // 3. Seed some blacklist entries
    await client.query(`
      INSERT INTO bad_ip (bad_ip) VALUES ('8.8.8.8') ON CONFLICT DO NOTHING;
      INSERT INTO hostname (hostname) VALUES ('crawl-spoof') ON CONFLICT DO NOTHING;
      INSERT INTO isp (isp) VALUES ('badisp') ON CONFLICT DO NOTHING;
    `);

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
        ip: '8.8.4.4', // Standard public DNS IP
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
      name: 'Authentic Googlebot (Allow via FCrDNS)',
      payload: {
        fd: 'utest',
        ip: '66.249.66.1', // Real Googlebot IP range
        ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        ref: ''
      },
      expected: '1'
    },
    {
      name: 'Spoofed Googlebot (Block via FCrDNS)',
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
    }
  ];

  console.log('\nStarting bot detection API tests...');
  let passedCount = 0;
  let runCount = 0;

  for (const tc of testCases) {
    runCount++;
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
