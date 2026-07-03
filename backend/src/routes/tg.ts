import { Router, Request, Response } from 'express';
import { db } from '../db';

const router = Router();

// Telegram Bot API Handler
// Receives uflow and action via POST
router.post('/', async (req: Request, res: Response) => {
  const { uflow, action } = req.body;

  if (!uflow && action !== '9' && action !== 9) {
    return res.status(400).send('Error: Missing uflow parameter');
  }

  const actionNum = parseInt(action, 10);
  if (isNaN(actionNum)) {
    return res.status(400).send('Error: Invalid action');
  }

  try {
    if (actionNum === 1) {
      // Activate
      const result = await db.query('UPDATE users SET active = 1 WHERE uflow = $1', [uflow]);
      if (result.rowCount && result.rowCount > 0) {
        return res.send(`User with ${uflow} ACTIVATED successfully`);
      } else {
        return res.send(`User with ${uflow} not found`);
      }
    }

    if (actionNum === 2) {
      // Ban/Pending
      const result = await db.query('UPDATE users SET active = 2 WHERE uflow = $1', [uflow]);
      if (result.rowCount && result.rowCount > 0) {
        return res.send(`User ${uflow} Banned successfully`);
      } else {
        return res.send(`User with ${uflow} not found`);
      }
    }

    // Subscriptions
    const durations: { [key: number]: number } = {
      3: 3,
      4: 6,   // 5 + 1
      5: 11,  // 10 + 1
      6: 16,  // 15 + 1
      7: 26,  // 25 + 1
      8: 36,  // 35 + 1
    };

    if (durations[actionNum] !== undefined) {
      const days = durations[actionNum];
      const currentDate = new Date();
      const endDate = new Date(currentDate.getTime() + days * 24 * 60 * 60 * 1000);

      const result = await db.query(
        `UPDATE users SET start_sub = $1, end_sub = $2, active = 1 WHERE uflow = $3`,
        [currentDate, endDate, uflow]
      );

      if (result.rowCount && result.rowCount > 0) {
        return res.send(`${uflow}-Subscribed ${days} days | Ends: ${endDate.toISOString()}`);
      } else {
        return res.send(`User with ${uflow} not found`);
      }
    }

    if (actionNum === 9) {
      // Clean visits older than 5 days
      const result = await db.query(
        "DELETE FROM visits WHERE date < NOW() - INTERVAL '5 days'"
      );
      return res.send(`Visits older than 5 days have been deleted successfully. Count: ${result.rowCount}`);
    }

    return res.status(400).send('Error: Invalid action code');
  } catch (err) {
    console.error('Telegram bot handler error:', err);
    return res.status(500).send(`Error updating user: ${(err as Error).message}`);
  }
});

export default router;
