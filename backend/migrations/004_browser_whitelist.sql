-- WebGuard V2: Migration 004 - Browser Whitelist
-- Creates the global `browser` table (allowed browsers list) and adds a
-- `browsers` column to `user_settings` for per-user browser overrides.
-- Also seeds the full list of supported browsers that getDetectedBrowser() maps to.
--

BEGIN;

-- 1. Global browser whitelist table
CREATE TABLE IF NOT EXISTS browser (
  id     SERIAL PRIMARY KEY,
  browser VARCHAR(100) NOT NULL,
  CONSTRAINT browser_unique UNIQUE (browser)
);

-- 2. Per-user browser whitelist column in user_settings
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS browsers TEXT DEFAULT '';

-- 3. Seed all recognized browsers
INSERT INTO browser (browser) VALUES
  ('Chrome'),
  ('Firefox'),
  ('Edge'),
  ('Safari'),
  ('Opera'),
  ('Opera GX'),
  ('Brave'),
  ('Samsung Browser'),
  ('UC Browser'),
  ('Vivaldi'),
  ('Yandex Browser'),
  ('IE'),
  ('Facebook App'),
  ('Instagram App'),
  ('Twitter App'),
  ('TikTok App'),
  ('WebView')
ON CONFLICT (browser) DO NOTHING;

COMMIT;
