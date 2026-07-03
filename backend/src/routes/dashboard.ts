import { Router, Response } from 'express';
import { db } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Protect all dashboard routes
router.use(authMiddleware);

// Get KPI Stats for Dashboard
router.post('/stats', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  try {
    // 1. Bad IPs On Database (Global count)
    const badIpsRes = await db.query('SELECT COUNT(*) as count FROM bad_ip');
    const totalBadIps = parseInt(badIpsRes.rows[0].count, 10);

    // 2. Visits today for user
    const visitsTodayRes = await db.query(
      `SELECT COUNT(*) as count FROM visits 
       WHERE uflow = $1 AND date >= CURRENT_DATE`,
      [uflow]
    );
    const visitsToday = parseInt(visitsTodayRes.rows[0].count, 10);

    // 3. Bots blocked today for user
    const botsTodayRes = await db.query(
      `SELECT COUNT(*) as count FROM visits 
       WHERE uflow = $1 AND isbot = 0 AND date >= CURRENT_DATE`,
      [uflow]
    );
    const botsToday = parseInt(botsTodayRes.rows[0].count, 10);

    // 4. Unique IPs today
    const uniqueIpsRes = await db.query(
      `SELECT COUNT(DISTINCT ip) as count FROM visits 
       WHERE uflow = $1 AND date >= CURRENT_DATE`,
      [uflow]
    );
    const uniqueIps = parseInt(uniqueIpsRes.rows[0].count, 10);

    // 5. Visits (last 24 hours)
    const visits24hRes = await db.query(
      `SELECT COUNT(*) as count FROM visits 
       WHERE uflow = $1 AND date >= NOW() - INTERVAL '24 hours'`,
      [uflow]
    );
    const visits24h = parseInt(visits24hRes.rows[0].count, 10);

    // 6. Top country today
    const topCountryRes = await db.query(
      `SELECT country, COUNT(*) as cnt FROM visits 
       WHERE uflow = $1 AND date >= CURRENT_DATE 
       GROUP BY country ORDER BY cnt DESC LIMIT 1`,
      [uflow]
    );
    const topCountry = topCountryRes.rows[0]?.country || 'N/A';

    // 7. All-time totals
    const allTimeRes = await db.query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN isbot = 0 THEN 1 ELSE 0 END) as bots,
        SUM(CASE WHEN isbot = 1 THEN 1 ELSE 0 END) as humans,
        COUNT(DISTINCT ip) as unique_ips
       FROM visits WHERE uflow = $1`,
      [uflow]
    );
    const allTime = allTimeRes.rows[0];
    const totalVisits = parseInt(allTime.total, 10);
    const totalBots = parseInt(allTime.bots, 10);
    const totalHumans = parseInt(allTime.humans, 10);
    const totalUniqueIps = parseInt(allTime.unique_ips, 10);

    // 8. Last 7 days
    const last7dRes = await db.query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN isbot = 0 THEN 1 ELSE 0 END) as bots,
        SUM(CASE WHEN isbot = 1 THEN 1 ELSE 0 END) as humans
       FROM visits WHERE uflow = $1 AND date >= CURRENT_DATE - INTERVAL '6 days'`,
      [uflow]
    );
    const last7d = last7dRes.rows[0];
    const visits7days = parseInt(last7d.total, 10);
    const bots7days = parseInt(last7d.bots, 10);
    const humans7days = parseInt(last7d.humans, 10);

    // Calculate bot rates
    const botRateToday = visitsToday > 0 ? Math.round((botsToday / visitsToday) * 100) : 0;
    const botRate7days = visits7days > 0 ? Math.round((bots7days / visits7days) * 100) : 0;
    const humansToday = visitsToday - botsToday;

    return res.json({
      status: 'success',
      data: {
        totalBadIps,
        visitsToday,
        botsToday,
        humansToday,
        uniqueIps,
        visits24h,
        botRateToday,
        topCountry,
        totalVisits,
        totalBots,
        totalHumans,
        totalUniqueIps,
        visits7days,
        bots7days,
        humans7days,
        botRate7days,
      },
    });
  } catch (err) {
    console.error('Stats error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch statistics' });
  }
});

// Get Visits Chart Data (Last 5 Days)
router.post('/visits-chart', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  try {
    const query = `
      SELECT 
        date_trunc('day', date)::date as day,
        SUM(CASE WHEN isbot = 1 THEN 1 ELSE 0 END) as human_count,
        SUM(CASE WHEN isbot = 0 THEN 1 ELSE 0 END) as bot_count
      FROM visits
      WHERE uflow = $1 AND date >= CURRENT_DATE - INTERVAL '4 days'
      GROUP BY day
      ORDER BY day ASC
    `;
    const chartRes = await db.query(query, [uflow]);

    // Format the date properly for the frontend
    const data = chartRes.rows.map(row => ({
      day: new Date(row.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      humans: parseInt(row.human_count, 10),
      bots: parseInt(row.bot_count, 10),
      total: parseInt(row.human_count, 10) + parseInt(row.bot_count, 10)
    }));

    return res.json({
      status: 'success',
      data,
    });
  } catch (err) {
    console.error('Visits chart error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch chart data' });
  }
});

// Get Pie Chart Data (OS, Browser, Countries)
router.post('/pie-charts', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  try {
    const browserQuery = `
      SELECT browser as name, COUNT(*) as value 
      FROM visits 
      WHERE uflow = $1 
      GROUP BY browser ORDER BY value DESC LIMIT 5
    `;
    const osQuery = `
      SELECT system as name, COUNT(*) as value 
      FROM visits 
      WHERE uflow = $1 
      GROUP BY system ORDER BY value DESC LIMIT 5
    `;
    const countryQuery = `
      SELECT country as name, COUNT(*) as value 
      FROM visits 
      WHERE uflow = $1 
      GROUP BY country ORDER BY value DESC LIMIT 5
    `;

    const [browsers, os, countries] = await Promise.all([
      db.query(browserQuery, [uflow]),
      db.query(osQuery, [uflow]),
      db.query(countryQuery, [uflow]),
    ]);

    return res.json({
      status: 'success',
      data: {
        browsers: browsers.rows.map(r => ({ name: r.name, value: parseInt(r.value, 10) })),
        systems: os.rows.map(r => ({ name: r.name, value: parseInt(r.value, 10) })),
        countries: countries.rows.map(r => ({ name: r.name, value: parseInt(r.value, 10) })),
      },
    });
  } catch (err) {
    console.error('Pie charts error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch pie charts' });
  }
});

// Get Recent Visits (paginated, default 100)
router.post('/recent-visits', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  const limit = Math.min(Math.max(parseInt(req.body.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(req.body.offset, 10) || 0, 0);

  try {
    const countRes = await db.query(
      'SELECT COUNT(*) as total FROM visits WHERE uflow = $1',
      [uflow]
    );
    const total = parseInt(countRes.rows[0].total, 10);

    const query = `
      SELECT 
        v.id, v.ip, v.country, v.hostname, v.isp, v.system as os, v.browser, v.referee, v.date, v.isbot, v.source, v.block_reason as blockReason,
        EXISTS(
          SELECT 1 FROM bad_ip b 
          WHERE v.ip = b.bad_ip 
             OR v.ip LIKE REPLACE(b.bad_ip, '*', '%')
        ) as is_banned
      FROM visits v
      WHERE v.uflow = $1
      ORDER BY v.date DESC
      LIMIT $2 OFFSET $3
    `;
    const visitsRes = await db.query(query, [uflow, limit, offset]);

    return res.json({
      status: 'success',
      data: visitsRes.rows.map(row => ({
        ...row,
        date: row.date.toISOString(),
      })),
      total,
      hasMore: offset + limit < total,
    });
  } catch (err) {
    console.error('Recent visits error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch visits' });
  }
});

// Clear all visits for the authenticated user
router.post('/clear-visits', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  try {
    const result = await db.query('DELETE FROM visits WHERE uflow = $1', [uflow]);
    return res.json({
      status: 'success',
      message: `Cleared ${result.rowCount} visits`,
      deletedCount: result.rowCount,
    });
  } catch (err) {
    console.error('Clear visits error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to clear visits' });
  }
});

export default router;
