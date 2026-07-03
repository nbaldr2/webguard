import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../.env') });

export const config = {
  port: process.env.PORT || 5000,
  jwtSecret: process.env.JWT_SECRET || 'webguard-jwt-super-secret-token',
  jwtExpiration: process.env.JWT_EXPIRATION || '7d',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'soufianerochdi',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'webguard',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    keyPrefix: process.env.REDIS_PREFIX || 'wg:',
  },
  env: process.env.NODE_ENV || 'development',
};
