import express from 'express';
import cors from 'cors';
import { config } from './config';

// Import routers
import authRouter from './routes/auth';
import dashboardRouter from './routes/dashboard';
import settingsRouter from './routes/settings';
import codeRouter from './routes/code';
import detectRouter from './routes/detect';
import tgRouter from './routes/tg';

const app = express();

// Trust proxy for correct IP detection behind Nginx
app.set('trust proxy', 1);

// Configure CORS
app.use(cors({
  origin: '*', // For development, allow all. In production, restrict to specific domains.
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Request body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log requests in development
if (config.env === 'development') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
}

// Register API Routes
app.use('/api/auth', authRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/code', codeRouter);

// Bot Detection endpoints (mount at multiple paths for backwards compatibility)
app.use('/api/detect', detectRouter);
app.use('/detect', detectRouter);
app.use('/bguv2.php', detectRouter);
app.use('/bguv3.php', detectRouter);

// Telegram bot endpoints
app.use('/api/tg', tgRouter);
app.use('/tg.php', tgRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ status: 'error', message: 'Internal server error' });
});

// Start listening
app.listen(config.port, () => {
  console.log(`WebGuard V2 Backend running in ${config.env} mode on port ${config.port}`);
});
