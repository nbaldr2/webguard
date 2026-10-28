import { Router, Response } from 'express';
import { db } from '../db';
import redis from '../redis';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Flush all verdict cache entries for a uflow
async function flushVerdictCache(uflow: string): Promise<void> {
  try {
    const keys = await redis.keys(`v:${uflow}:*`);
    if (keys.length > 0) await redis.del(...keys);
  } catch {}
}

// Protect all settings routes
router.use(authMiddleware);

// Get Whitelist Countries Status and options
router.get('/countries', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  try {
    // 1. Get user settings country whitelist
    const settingsRes = await db.query('SELECT countries FROM user_settings WHERE uflow = $1 LIMIT 1', [uflow]);
    const allowedCountriesStr = settingsRes.rows[0]?.countries || '';
    const allowedCountries = allowedCountriesStr ? allowedCountriesStr.split(',').map((c: string) => c.trim()) : [];

    // 2. Return options (we can provide a hardcoded list of standard country codes, or let frontend handle it)
    return res.json({
      status: 'success',
      allowedCountries,
    });
  } catch (err) {
    console.error('Get countries settings error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch countries settings' });
  }
});

// Update Allowed Countries
router.post('/countries', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { countries } = req.body; // Array of country codes (e.g. ['US', 'FR'])

  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });
  if (!Array.isArray(countries)) {
    return res.status(400).json({ status: 'error', message: 'Countries must be an array' });
  }

  const countriesStr = countries.join(', ');

  try {
    await db.query(
      `INSERT INTO user_settings (uflow, countries) 
       VALUES ($1, $2) 
       ON CONFLICT (uflow) DO UPDATE SET countries = EXCLUDED.countries`,
      [uflow, countriesStr]
    );

    await flushVerdictCache(uflow);
    return res.json({ status: 'success', message: 'Country whitelist updated successfully' });
  } catch (err) {
    console.error('Update countries error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to update countries' });
  }
});

// Get Blocked Countries
router.get('/blocked-countries', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  try {
    const settingsRes = await db.query('SELECT blocked_countries FROM user_settings WHERE uflow = $1 LIMIT 1', [uflow]);
    const blockedCountriesStr = settingsRes.rows[0]?.blocked_countries || '';
    const blockedCountries = blockedCountriesStr
      ? blockedCountriesStr.split(',').map((c: string) => c.trim().toUpperCase()).filter((c: string) => c.length > 0)
      : [];
    return res.json({ status: 'success', blockedCountries });
  } catch (err) {
    console.error('Get blocked countries error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch blocked countries' });
  }
});

// Update Blocked Countries
router.post('/blocked-countries', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  const { countries } = req.body;

  if (!Array.isArray(countries)) {
    return res.status(400).json({ status: 'error', message: 'Countries must be an array' });
  }

  try {
    const countriesStr = countries.join(', ');

    await db.query(
      `INSERT INTO user_settings (uflow, blocked_countries)
       VALUES ($1, $2)
       ON CONFLICT (uflow) DO UPDATE SET blocked_countries = EXCLUDED.blocked_countries`,
      [uflow, countriesStr]
    );

    await flushVerdictCache(uflow);
    return res.json({ status: 'success', message: 'Blocked countries updated successfully' });
  } catch (err) {
    console.error('Update blocked countries error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to update blocked countries' });
  }
});


// Get Whitelisted Operating Systems and global options
router.get('/system', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  try {
    // 1. Get user whitelisted systems
    const settingsRes = await db.query('SELECT systems FROM user_settings WHERE uflow = $1 LIMIT 1', [uflow]);
    const allowedSystemsStr = settingsRes.rows[0]?.systems || '';
    const allowedSystems = allowedSystemsStr ? allowedSystemsStr.split(',').map((s: string) => s.trim()) : [];

    // 2. Get global OS options
    const globalSystemsRes = await db.query('SELECT system FROM system ORDER BY system ASC');
    const systemOptions = globalSystemsRes.rows.map(row => row.system);

    return res.json({
      status: 'success',
      allowedSystems,
      systemOptions,
    });
  } catch (err) {
    console.error('Get system settings error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch system settings' });
  }
});

// Update Whitelisted Operating Systems
router.post('/system', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { systems } = req.body; // Array of systems (e.g. ['Windows 10', 'Mac OS X'])

  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });
  if (!Array.isArray(systems)) {
    return res.status(400).json({ status: 'error', message: 'Systems must be an array' });
  }

  const systemsStr = systems.join(', ');

  try {
    await db.query(
      `INSERT INTO user_settings (uflow, systems) 
       VALUES ($1, $2) 
       ON CONFLICT (uflow) DO UPDATE SET systems = EXCLUDED.systems`,
      [uflow, systemsStr]
    );

    await flushVerdictCache(uflow);
    return res.json({ status: 'success', message: 'Operating system whitelist updated successfully' });
  } catch (err) {
    console.error('Update systems error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to update operating systems' });
  }
});

// Get Whitelisted Browsers and global options
router.get('/browser', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  try {
    // 1. Get user whitelisted browsers
    const settingsRes = await db.query('SELECT browsers FROM user_settings WHERE uflow = $1 LIMIT 1', [uflow]);
    const allowedBrowsersStr = settingsRes.rows[0]?.browsers || '';
    const allowedBrowsers = allowedBrowsersStr ? allowedBrowsersStr.split(',').map((b: string) => b.trim()).filter(Boolean) : [];

    // 2. Get global browser options from browser table
    const globalBrowsersRes = await db.query('SELECT browser FROM browser ORDER BY browser ASC');
    const browserOptions = globalBrowsersRes.rows.map(row => row.browser);

    return res.json({
      status: 'success',
      allowedBrowsers,
      browserOptions,
    });
  } catch (err) {
    console.error('Get browser settings error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch browser settings' });
  }
});

// Update Whitelisted Browsers
router.post('/browser', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { browsers } = req.body; // Array of browser names

  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });
  if (!Array.isArray(browsers)) {
    return res.status(400).json({ status: 'error', message: 'Browsers must be an array' });
  }

  const browsersStr = browsers.join(', ');

  try {
    await db.query(
      `INSERT INTO user_settings (uflow, browsers) 
       VALUES ($1, $2) 
       ON CONFLICT (uflow) DO UPDATE SET browsers = EXCLUDED.browsers`,
      [uflow, browsersStr]
    );

    await flushVerdictCache(uflow);
    return res.json({ status: 'success', message: 'Browser whitelist updated successfully' });
  } catch (err) {
    console.error('Update browsers error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to update browsers' });
  }
});

// Toggle Antibot status (active = 1 is ON, active = 0 is OFF)
router.post('/toggle-active', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { active } = req.body; // boolean or number (1 or 0)

  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  const activeVal = active ? 1 : 0;

  try {
    const userRes = await db.query('SELECT active FROM users WHERE uflow = $1 LIMIT 1', [uflow]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }
    const currentActive = userRes.rows[0].active;
    if (currentActive === 2) {
      return res.status(403).json({ status: 'error', message: 'Account is pending activation or banned' });
    }

    await db.query('UPDATE users SET active = $1 WHERE uflow = $2', [activeVal, uflow]);

    return res.json({
      status: 'success',
      active: activeVal === 1,
      message: `Antibot protection ${activeVal === 1 ? 'activated' : 'deactivated'}`
    });
  } catch (err) {
    console.error('Toggle active error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to toggle protection' });
  }
});

// Get Blacklists (IPs, Hostnames, ISPs)
router.get('/ip-rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const badIpsRes = await db.query('SELECT id, bad_ip FROM bad_ip ORDER BY id DESC');
    const hostnamesRes = await db.query('SELECT id, hostname FROM hostname ORDER BY id DESC');
    const ispsRes = await db.query('SELECT id, isp FROM isp ORDER BY id DESC');

    return res.json({
      status: 'success',
      data: {
        badIps: badIpsRes.rows,
        hostnames: hostnamesRes.rows,
        isps: ispsRes.rows,
      },
    });
  } catch (err) {
    console.error('Get ip rules error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch blacklist rules' });
  }
});

// Add Blacklist Rule (IP, Hostname, or ISP)
router.post('/ip-rules', async (req: AuthenticatedRequest, res: Response) => {
  const { type, value } = req.body; // type: 'ip' | 'hostname' | 'isp', value: string to blacklist

  if (!type || !value) {
    return res.status(400).json({ status: 'error', message: 'Type and value are required' });
  }

  const cleanValue = value.trim();

  try {
    if (type === 'ip') {
      await db.query('INSERT INTO bad_ip (bad_ip) VALUES ($1) ON CONFLICT DO NOTHING', [cleanValue]);
      try { await redis.del(`v:${req.user!.uflow}:${cleanValue}`); } catch {}
    } else if (type === 'hostname') {
      await db.query('INSERT INTO hostname (hostname) VALUES ($1) ON CONFLICT DO NOTHING', [cleanValue]);
    } else if (type === 'isp') {
      await db.query('INSERT INTO isp (isp) VALUES ($1) ON CONFLICT DO NOTHING', [cleanValue]);
    } else {
      return res.status(400).json({ status: 'error', message: 'Invalid rule type' });
    }

    return res.json({ status: 'success', message: 'Blacklist rule added successfully' });
  } catch (err) {
    console.error('Add blacklist rule error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to add blacklist rule' });
  }
});

// Delete Blacklist Rule
router.delete('/ip-rules/:type/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { type, id } = req.params;

  try {
    let result;
    if (type === 'ip') {
      result = await db.query('DELETE FROM bad_ip WHERE id = $1', [id]);
    } else if (type === 'hostname') {
      result = await db.query('DELETE FROM hostname WHERE id = $1', [id]);
    } else if (type === 'isp') {
      result = await db.query('DELETE FROM isp WHERE id = $1', [id]);
    } else {
      return res.status(400).json({ status: 'error', message: 'Invalid rule type' });
    }

    if (result.rowCount === 0) {
      return res.status(440).json({ status: 'error', message: 'Blacklist rule not found' });
    }

    return res.json({ status: 'success', message: 'Blacklist rule deleted successfully' });
  } catch (err) {
    console.error('Delete blacklist rule error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to delete blacklist rule' });
  }
});

// Delete IP blacklist rule by IP value directly
router.delete('/ip-rules/ip/by-value/:ip', async (req: AuthenticatedRequest, res: Response) => {
  const { ip } = req.params;
  try {
    const result = await db.query('DELETE FROM bad_ip WHERE bad_ip = $1', [ip]);
    try { await redis.del(`v:${req.user!.uflow}:${ip}`); } catch {}
    return res.json({
      status: 'success',
      message: 'IP removed from blacklist',
      deletedCount: result.rowCount,
    });
  } catch (err) {
    console.error('Delete IP by value error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to delete IP' });
  }
});

// ── IP Intelligence Providers ──

// List providers for the authenticated user
router.get('/ip-providers', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  try {
    const result = await db.query(
      'SELECT id, name, url_template, api_key, country_field, isp_field, enabled, sort_order FROM ip_providers WHERE uflow = $1 ORDER BY sort_order ASC, id ASC',
      [uflow]
    );
    return res.json({ status: 'success', data: result.rows });
  } catch (err) {
    console.error('Get IP providers error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch IP providers' });
  }
});

// Add a provider
router.post('/ip-providers', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  const { name, url_template, api_key, country_field, isp_field, enabled, sort_order } = req.body;
  if (!name || !url_template || !country_field || !isp_field) {
    return res.status(400).json({ status: 'error', message: 'name, url_template, country_field, and isp_field are required' });
  }

  try {
    const result = await db.query(
      `INSERT INTO ip_providers (uflow, name, url_template, api_key, country_field, isp_field, enabled, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, url_template, api_key, country_field, isp_field, enabled, sort_order`,
      [uflow, name.trim(), url_template, api_key || '', country_field, isp_field, enabled !== false, sort_order || 0]
    );
    return res.json({ status: 'success', data: result.rows[0] });
  } catch (err) {
    console.error('Add IP provider error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to add IP provider' });
  }
});

// Update a provider
router.put('/ip-providers/:id', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { id } = req.params;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  const { name, url_template, api_key, country_field, isp_field, enabled, sort_order } = req.body;

  try {
    const result = await db.query(
      `UPDATE ip_providers SET
        name = COALESCE($1, name),
        url_template = COALESCE($2, url_template),
        api_key = COALESCE($3, api_key),
        country_field = COALESCE($4, country_field),
        isp_field = COALESCE($5, isp_field),
        enabled = COALESCE($6, enabled),
        sort_order = COALESCE($7, sort_order)
       WHERE id = $8 AND uflow = $9
       RETURNING id, name, url_template, api_key, country_field, isp_field, enabled, sort_order`,
      [name, url_template, api_key, country_field, isp_field, enabled, sort_order, id, uflow]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Provider not found' });
    }
    return res.json({ status: 'success', data: result.rows[0] });
  } catch (err) {
    console.error('Update IP provider error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to update IP provider' });
  }
});

// Delete a provider
router.delete('/ip-providers/:id', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { id } = req.params;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  try {
    const result = await db.query('DELETE FROM ip_providers WHERE id = $1 AND uflow = $2', [id, uflow]);
    if (result.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'Provider not found' });
    }
    return res.json({ status: 'success', message: 'Provider deleted' });
  } catch (err) {
    console.error('Delete IP provider error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to delete IP provider' });
  }
});

// ── Organizations ──

// List all blocked organizations
router.get('/organizations', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  try {
    const result = await db.query(
      'SELECT id, name FROM organizations WHERE uflow IS NULL OR uflow = $1 ORDER BY name ASC',
      [uflow]
    );
    return res.json({ status: 'success', data: result.rows });
  } catch (err) {
    console.error('Get organizations error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch organizations' });
  }
});

// Add a blocked organization
router.post('/organizations', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { name } = req.body;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });
  if (!name || !name.trim()) return res.status(400).json({ status: 'error', message: 'Organization name is required' });

  try {
    const result = await db.query(
      'INSERT INTO organizations (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id, name',
      [name.trim()]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ status: 'error', message: 'Organization already exists' });
    }
    return res.json({ status: 'success', data: result.rows[0] });
  } catch (err) {
    console.error('Add organization error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to add organization' });
  }
});

// Remove a blocked organization
router.delete('/organizations/:id', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { id } = req.params;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  try {
    const result = await db.query('DELETE FROM organizations WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'Organization not found' });
    }
    return res.json({ status: 'success', message: 'Organization removed' });
  } catch (err) {
    console.error('Delete organization error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to delete organization' });
  }
});

// ── IP Intelligence Providers ──

// List all intel providers
router.get('/intel-providers', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  try {
    const result = await db.query(
      'SELECT id, name, url_template, api_key, method, enabled, sort_order, is_proxy, is_vpn, is_hosting, is_datacenter, is_residential FROM intel_providers WHERE uflow = $1 ORDER BY sort_order ASC, id ASC',
      [uflow]
    );
    return res.json({ status: 'success', data: result.rows });
  } catch (err) {
    console.error('Get intel providers error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch intel providers' });
  }
});

// Add an intel provider
router.post('/intel-providers', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { name, url_template, api_key, method, is_proxy, is_vpn, is_hosting, is_datacenter } = req.body;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });
  if (!name || !url_template) return res.status(400).json({ status: 'error', message: 'Name and URL template are required' });

  try {
    const result = await db.query(
      `INSERT INTO intel_providers (uflow, name, url_template, api_key, method, is_proxy, is_vpn, is_hosting, is_datacenter, is_residential)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (uflow, name) DO UPDATE SET
         url_template = EXCLUDED.url_template, api_key = EXCLUDED.api_key, method = EXCLUDED.method,
         is_proxy = EXCLUDED.is_proxy, is_vpn = EXCLUDED.is_vpn, is_hosting = EXCLUDED.is_hosting, is_datacenter = EXCLUDED.is_datacenter, is_residential = EXCLUDED.is_residential
       RETURNING id, name, url_template, api_key, method, enabled, sort_order, is_proxy, is_vpn, is_hosting, is_datacenter, is_residential`,
      [uflow, name.trim(), url_template.trim(), api_key || '', method || 'GET', is_proxy || '', is_vpn || '', is_hosting || '', is_datacenter || '', '']
    );
    return res.json({ status: 'success', data: result.rows[0] });
  } catch (err) {
    console.error('Add intel provider error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to add intel provider' });
  }
});

// Toggle intel provider enabled
router.put('/intel-providers/:id/toggle', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { id } = req.params;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  try {
    const result = await db.query(
      'UPDATE intel_providers SET enabled = NOT enabled WHERE id = $1 AND uflow = $2 RETURNING id, name, enabled',
      [id, uflow]
    );
    if (result.rows.length === 0) return res.status(404).json({ status: 'error', message: 'Provider not found' });
    return res.json({ status: 'success', data: result.rows[0] });
  } catch (err) {
    console.error('Toggle intel provider error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to toggle intel provider' });
  }
});

// Delete an intel provider
router.delete('/intel-providers/:id', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { id } = req.params;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  try {
    const result = await db.query('DELETE FROM intel_providers WHERE id = $1 AND uflow = $2', [id, uflow]);
    if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Provider not found' });
    return res.json({ status: 'success', message: 'Provider removed' });
  } catch (err) {
    console.error('Delete intel provider error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to delete intel provider' });
  }
});

// ── VPN Detection Toggle ──

router.get('/vpn-detection', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  try {
    const result = await db.query('SELECT vpn_detection_enabled FROM user_settings WHERE uflow = $1', [uflow]);
    return res.json({ status: 'success', enabled: result.rows[0]?.vpn_detection_enabled !== 0 });
  } catch (err) {
    console.error('Get VPN detection error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch VPN detection setting' });
  }
});

router.put('/vpn-detection', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { enabled } = req.body;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  try {
    await db.query(
      `INSERT INTO user_settings (uflow, vpn_detection_enabled) VALUES ($1, $2)
       ON CONFLICT (uflow) DO UPDATE SET vpn_detection_enabled = EXCLUDED.vpn_detection_enabled`,
      [uflow, enabled ? 1 : 0]
    );
    return res.json({ status: 'success', enabled: !!enabled });
  } catch (err) {
    console.error('Update VPN detection error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to update VPN detection setting' });
  }
});

// ── Proxycheck.io Toggle ──

router.get('/proxycheck', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });
  try {
    const result = await db.query('SELECT proxycheck_enabled FROM user_settings WHERE uflow = $1', [uflow]);
    return res.json({ status: 'success', enabled: result.rows[0]?.proxycheck_enabled !== 0 });
  } catch (err) {
    console.error('Get proxycheck error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch proxycheck setting' });
  }
});

router.put('/proxycheck', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { enabled } = req.body;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });
  try {
    await db.query(
      `INSERT INTO user_settings (uflow, proxycheck_enabled) VALUES ($1, $2)
       ON CONFLICT (uflow) DO UPDATE SET proxycheck_enabled = EXCLUDED.proxycheck_enabled`,
      [uflow, enabled ? 1 : 0]
    );
    return res.json({ status: 'success', enabled: !!enabled });
  } catch (err) {
    console.error('Update proxycheck error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to update proxycheck setting' });
  }
});

// ── AbuseIPDB Toggle ──

router.get('/abuseipdb', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });
  try {
    const result = await db.query('SELECT abuseipdb_enabled FROM user_settings WHERE uflow = $1', [uflow]);
    return res.json({ status: 'success', enabled: result.rows[0]?.abuseipdb_enabled !== 0 });
  } catch (err) {
    console.error('Get abuseipdb error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch abuseipdb setting' });
  }
});

router.put('/abuseipdb', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { enabled } = req.body;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });
  try {
    await db.query(
      `INSERT INTO user_settings (uflow, abuseipdb_enabled) VALUES ($1, $2)
       ON CONFLICT (uflow) DO UPDATE SET abuseipdb_enabled = EXCLUDED.abuseipdb_enabled`,
      [uflow, enabled ? 1 : 0]
    );
    return res.json({ status: 'success', enabled: !!enabled });
  } catch (err) {
    console.error('Update abuseipdb error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to update abuseipdb setting' });
  }
});

// ── VPNapi.io Toggle ──

router.get('/vpnapi', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });
  try {
    const result = await db.query('SELECT vpnapi_enabled FROM user_settings WHERE uflow = $1', [uflow]);
    return res.json({ status: 'success', enabled: result.rows[0]?.vpnapi_enabled !== 0 });
  } catch (err) {
    console.error('Get vpnapi error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch vpnapi setting' });
  }
});

router.put('/vpnapi', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { enabled } = req.body;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });
  try {
    await db.query(
      `INSERT INTO user_settings (uflow, vpnapi_enabled) VALUES ($1, $2)
       ON CONFLICT (uflow) DO UPDATE SET vpnapi_enabled = EXCLUDED.vpnapi_enabled`,
      [uflow, enabled ? 1 : 0]
    );
    return res.json({ status: 'success', enabled: !!enabled });
  } catch (err) {
    console.error('Update vpnapi error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to update vpnapi setting' });
  }
});

// ── IPLocate Toggle ──

router.get('/iplocate', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });
  try {
    const result = await db.query('SELECT iplocate_enabled FROM user_settings WHERE uflow = $1', [uflow]);
    return res.json({ status: 'success', enabled: result.rows[0]?.iplocate_enabled !== 0 });
  } catch (err) {
    console.error('Get iplocate error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch iplocate setting' });
  }
});

router.put('/iplocate', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { enabled } = req.body;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });
  try {
    await db.query(
      `INSERT INTO user_settings (uflow, iplocate_enabled) VALUES ($1, $2)
       ON CONFLICT (uflow) DO UPDATE SET iplocate_enabled = EXCLUDED.iplocate_enabled`,
      [uflow, enabled ? 1 : 0]
    );
    return res.json({ status: 'success', enabled: !!enabled });
  } catch (err) {
    console.error('Update iplocate error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to update iplocate setting' });
  }
});

// ── FraudLogix Toggle ──

router.get('/fraudlogix', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });
  try {
    const result = await db.query('SELECT fraudlogix_enabled FROM user_settings WHERE uflow = $1', [uflow]);
    return res.json({ status: 'success', enabled: result.rows[0]?.fraudlogix_enabled !== 0 });
  } catch (err) {
    console.error('Get fraudlogix error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch fraudlogix setting' });
  }
});

router.put('/fraudlogix', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { enabled } = req.body;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });
  try {
    await db.query(
      `INSERT INTO user_settings (uflow, fraudlogix_enabled) VALUES ($1, $2)
       ON CONFLICT (uflow) DO UPDATE SET fraudlogix_enabled = EXCLUDED.fraudlogix_enabled`,
      [uflow, enabled ? 1 : 0]
    );
    return res.json({ status: 'success', enabled: !!enabled });
  } catch (err) {
    console.error('Update fraudlogix error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to update fraudlogix setting' });
  }
});

// ── Referrer Blacklist ──

router.get('/referrer-blacklist', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });
  try {
    const result = await db.query(
      'SELECT id, pattern FROM referrer_blacklist WHERE uflow = $1 ORDER BY id DESC',
      [uflow]
    );
    return res.json({ status: 'success', data: result.rows });
  } catch (err) {
    console.error('Get referrer blacklist error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch referrer blacklist' });
  }
});

router.post('/referrer-blacklist', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { pattern } = req.body;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });
  if (!pattern || !pattern.trim()) return res.status(400).json({ status: 'error', message: 'Pattern is required' });
  try {
    const result = await db.query(
      'INSERT INTO referrer_blacklist (uflow, pattern) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id, pattern',
      [uflow, pattern.trim()]
    );
    if (result.rows.length === 0) return res.status(409).json({ status: 'error', message: 'Pattern already exists' });
    return res.json({ status: 'success', data: result.rows[0] });
  } catch (err) {
    console.error('Add referrer blacklist error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to add referrer pattern' });
  }
});

router.delete('/referrer-blacklist/:id', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  const { id } = req.params;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });
  try {
    const result = await db.query('DELETE FROM referrer_blacklist WHERE id = $1 AND uflow = $2', [id, uflow]);
    if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Pattern not found' });
    return res.json({ status: 'success', message: 'Referrer pattern removed' });
  } catch (err) {
    console.error('Delete referrer blacklist error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to delete referrer pattern' });
  }
});

// ── Hard Blocked IPs ──

router.get('/hard-block', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await db.query('SELECT id, ip FROM hard_block ORDER BY id DESC');
    return res.json({ status: 'success', data: result.rows });
  } catch (err) {
    console.error('Get hard block error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch hard blocked IPs' });
  }
});

router.post('/hard-block', async (req: AuthenticatedRequest, res: Response) => {
  const { ip } = req.body;
  if (!ip || !ip.trim()) return res.status(400).json({ status: 'error', message: 'IP is required' });
  try {
    const result = await db.query('INSERT INTO hard_block (ip) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id, ip', [ip.trim()]);
    if (result.rows.length === 0) return res.status(409).json({ status: 'error', message: 'IP already hard blocked' });
    return res.json({ status: 'success', data: result.rows[0] });
  } catch (err) {
    console.error('Add hard block error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to add hard blocked IP' });
  }
});

router.delete('/hard-block/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  try {
    const result = await db.query('DELETE FROM hard_block WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'IP not found' });
    return res.json({ status: 'success', message: 'Hard blocked IP removed' });
  } catch (err) {
    console.error('Delete hard block error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to delete hard blocked IP' });
  }
});

// ── IP Whitelist ──

router.get('/ip-whitelist', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await db.query('SELECT id, ip FROM white_ip ORDER BY id DESC');
    return res.json({ status: 'success', data: result.rows });
  } catch (err) {
    console.error('Get IP whitelist error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch IP whitelist' });
  }
});

router.post('/ip-whitelist', async (req: AuthenticatedRequest, res: Response) => {
  const { ip } = req.body;
  if (!ip || !ip.trim()) return res.status(400).json({ status: 'error', message: 'IP is required' });
  const cleanIp = ip.trim();
  try {
    const result = await db.query(
      'INSERT INTO white_ip (ip) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id, ip',
      [cleanIp]
    );
    if (result.rows.length === 0) return res.status(409).json({ status: 'error', message: 'IP already whitelisted' });
    try { await redis.del(`v:${req.user!.uflow}:${cleanIp}`); } catch {}
    return res.json({ status: 'success', data: result.rows[0] });
  } catch (err) {
    console.error('Add IP whitelist error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to add IP to whitelist' });
  }
});

router.delete('/ip-whitelist/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  try {
    const result = await db.query('DELETE FROM white_ip WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ status: 'error', message: 'Whitelisted IP not found' });
    return res.json({ status: 'success', message: 'Whitelisted IP removed' });
  } catch (err) {
    console.error('Delete IP whitelist error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to remove whitelisted IP' });
  }
});

export default router;
