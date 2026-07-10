import { Router, Request, Response } from 'express';
import { detectBot } from '../services/detection';

const router = Router();

// Bot Detection API Endpoint
// Handles both application/json and application/x-www-form-urlencoded
router.post('/', async (req: Request, res: Response) => {
  const { fd, ip, ref, ua, data, src, source } = req.body;

  // Validate required uflow / fd parameter
  if (!fd) {
    console.warn('API Warning: Received detect request without flow identifier (fd)');
    return res.status(400).send('API ERROR: Missing flow identifier (fd)');
  }

  const clientIp = ip || req.ip || req.socket.remoteAddress || 'N/A';
  const referrer = ref || '';
  const userAgent = ua || req.headers['user-agent'] || '';
  const visitSource = src || source || '';

  try {
    const { isBot, blockReason } = await detectBot({
      uflow: fd,
      ip: clientIp,
      ua: userAgent,
      ref: referrer,
      source: visitSource,
      headers: req.headers,
    });

    if (isBot === 0) {
      res.setHeader('X-WebGuard-Block-Reason', blockReason || 'Unknown');
    }

    // V1 compatibility: Return "1" (allow) or "0" (block) as a raw string
    return res.send(isBot.toString());
  } catch (err) {
    console.error('Bot detection API error:', err);
    // If it's a known expired sub or invalid uflow error, we can return the error text
    const errMsg = (err as Error).message;
    if (errMsg.startsWith('API ERROR')) {
      return res.status(400).send(errMsg);
    }
    // Fail open or closed? If internal database error, V1 outputs error, we can output '0' or '1'.
    // Let's return '1' (allow) to prevent breaking the customer site during server outages,
    // but log the error heavily.
    return res.send('1');
  }
});

export default router;
