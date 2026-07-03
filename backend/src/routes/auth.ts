import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db } from '../db';
import { config } from '../config';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Legacy MD5 helper for backwards compatibility
function md5(str: string): string {
  return crypto.createHash('md5').update(str).digest('hex');
}

// User Registration
router.post('/register', async (req, res) => {
  const { tg_user, password } = req.body;

  if (!tg_user || !password) {
    return res.status(400).json({ status: 'error', message: 'Telegram user and password are required' });
  }

  try {
    // Check if user already exists
    const userCheck = await db.query('SELECT 1 FROM users WHERE tg_user = $1 LIMIT 1', [tg_user]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ status: 'error', message: 'User already exists' });
    }

    // Generate unique uflow (u + 4 random digits)
    let uflow = '';
    let isUnique = false;
    while (!isUnique) {
      const rand = Math.floor(1000 + Math.random() * 9000);
      uflow = `u${rand}`;
      const uflowCheck = await db.query('SELECT 1 FROM users WHERE uflow = $1 LIMIT 1', [uflow]);
      if (uflowCheck.rows.length === 0) {
        isUnique = true;
      }
    }

    // Hash password with bcrypt
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user (default active = 2, pending activation)
    const insertRes = await db.query(
      `INSERT INTO users (uflow, tg_user, password, active, start_sub) 
       VALUES ($1, $2, $3, 2, NOW()) 
       RETURNING id, uflow, tg_user, active`,
      [uflow, tg_user, hashedPassword]
    );

    const newUser = insertRes.rows[0];

    // Create default settings for country whitelist
    await db.query('INSERT INTO user_settings (uflow, countries) VALUES ($1, $2)', [uflow, '']);

    // Generate JWT token
    const token = jwt.sign(
      { id: newUser.id, uflow: newUser.uflow, tg_user: newUser.tg_user },
      config.jwtSecret,
      { expiresIn: config.jwtExpiration as any }
    );

    return res.status(201).json({
      status: 'success',
      token,
      user: {
        id: newUser.id,
        uflow: newUser.uflow,
        tg_user: newUser.tg_user,
        active: newUser.active,
      },
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// User Login (Uflow + Password)
router.post('/login', async (req, res) => {
  const { uflow, password } = req.body;

  if (!uflow || !password) {
    return res.status(400).json({ status: 'error', message: 'Uflow and password are required' });
  }

  try {
    const userRes = await db.query(
      'SELECT id, uflow, tg_user, password, active, end_sub FROM users WHERE uflow = $1 LIMIT 1',
      [uflow]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({ status: 'error', message: 'Invalid uflow or password' });
    }

    const user = userRes.rows[0];
    let isPasswordValid = false;

    // Check if the stored password is a legacy MD5 hash (length 32)
    if (user.password.length === 32) {
      const md5Hash = md5(password);
      if (md5Hash === user.password) {
        isPasswordValid = true;
        // Upgrade password to bcrypt
        const bcryptHash = await bcrypt.hash(password, 10);
        await db.query('UPDATE users SET password = $1 WHERE id = $2', [bcryptHash, user.id]);
        console.log(`Upgraded password for user ${user.uflow} from MD5 to bcrypt`);
      }
    } else {
      isPasswordValid = await bcrypt.compare(password, user.password);
    }

    if (!isPasswordValid) {
      return res.status(401).json({ status: 'error', message: 'Invalid uflow or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, uflow: user.uflow, tg_user: user.tg_user },
      config.jwtSecret,
      { expiresIn: config.jwtExpiration as any }
    );

    return res.json({
      status: 'success',
      token,
      user: {
        id: user.id,
        uflow: user.uflow,
        tg_user: user.tg_user,
        active: user.active,
        end_sub: user.end_sub,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Get Current User (Authenticated)
router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ status: 'error', message: 'Not authenticated' });
  }

  try {
    const userRes = await db.query(
      'SELECT id, uflow, tg_user, active, start_sub, end_sub FROM users WHERE id = $1 LIMIT 1',
      [req.user.id]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    return res.json({
      status: 'success',
      user: userRes.rows[0],
    });
  } catch (err) {
    console.error('Get user me error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

export default router;
