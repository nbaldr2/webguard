import { Router, Response } from 'express';
import { db } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Protect code generator routes
router.use(authMiddleware);

// Get User Integration Snippets (PHP and Node.js)
router.get('/snippet', async (req: AuthenticatedRequest, res: Response) => {
  const uflow = req.user?.uflow;
  if (!uflow) return res.status(400).json({ status: 'error', message: 'No uflow in token' });

  const source = (req.query.source as string || '').trim();

  try {
    // 1. Fetch PHP templates from DB
    const codeRes = await db.query('SELECT tds_p1, tds_p2 FROM code WHERE id = 1 LIMIT 1');
    if (codeRes.rows.length === 0) {
      return res.status(500).json({ status: 'error', message: 'Snippet template not found' });
    }

    const { tds_p1, tds_p2 } = codeRes.rows[0];

    // Determine current API URL dynamically
    const protocol = req.protocol;
    const host = req.get('host');
    const apiDetectUrl = `${protocol}://${host}/api/detect`;

    // PHP Snippet
    const p1Replaced = tds_p1.replace('__API_URL__detect', apiDetectUrl)
      .replace(/^<\?php\s*/i, '')
      .trim();
    const p2Clean = tds_p2.replace(/\s*\?>\s*$/i, '').trim();
    const phpSnippet = source
      ? `${p1Replaced}${uflow}','src'=>'${source}'${p2Clean}`
      : `${p1Replaced}${uflow}${p2Clean}`;

    // Node.js Express Middleware Snippet
    const sourceField = source ? `,\n        src: '${source}'` : '';
    const nodeSnippet = `// WebGuard V2 Anti-bot Express Middleware
// Add this to your Express application routes

const fetch = require('node-fetch'); // or use native fetch in Node 18+

const webguardAntibot = async (req, res, next) => {
  const visitorIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const referrer = req.headers['referer'] || '';
  const userAgent = req.headers['user-agent'] || '';
  const queryString = req.url.split('?')[1] || '';

  try {
    const response = await fetch('${apiDetectUrl}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fd: '${uflow}',
        ip: visitorIp,
        ref: referrer,
        ua: userAgent,
        data: queryString${sourceField}
      })
    });
    
    const result = await response.text();
    
    if (result === '1') {
      next(); // Legitimate visitor -> Allow
    } else {
      // Bot detected -> Show 404
      res.status(404).send('Not Found');
    }
  } catch (err) {
    console.error('WebGuard check error:', err);
    next(); // Fail open so your site doesn't crash if WebGuard API is offline
  }
};

// Usage:
// app.use(webguardAntibot);
// or:
// app.get('/protected-route', webguardAntibot, (req, res) => { ... });
`;

    return res.json({
      status: 'success',
      data: {
        php: phpSnippet,
        node: nodeSnippet,
      },
    });
  } catch (err) {
    console.error('Snippet generation error:', err);
    return res.status(500).json({ status: 'error', message: 'Failed to generate code snippets' });
  }
});

export default router;