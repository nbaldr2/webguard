-- WebGuard V2: Migration 005 - Enterprise Upgrades
-- Adds multi-tenant filters, customizable rate limits, and seeds new browsers.

BEGIN;

-- 1. Alter bad_ip to support multi-tenant uflow column
ALTER TABLE bad_ip ADD COLUMN IF NOT EXISTS uflow VARCHAR(255) REFERENCES users(uflow) ON DELETE CASCADE;
-- Drop unique constraint on bad_ip to allow different users to blacklist the same IP
ALTER TABLE bad_ip DROP CONSTRAINT IF EXISTS bad_ip_bad_ip_key;
-- Add composite unique constraints via partial indexes to support NULL values uniquely
CREATE UNIQUE INDEX IF NOT EXISTS idx_bad_ip_uflow_null_unique ON bad_ip (bad_ip) WHERE uflow IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bad_ip_uflow_ip_unique ON bad_ip (uflow, bad_ip) WHERE uflow IS NOT NULL;

-- 2. Alter hostname to support multi-tenant uflow column
ALTER TABLE hostname ADD COLUMN IF NOT EXISTS uflow VARCHAR(255) REFERENCES users(uflow) ON DELETE CASCADE;
ALTER TABLE hostname DROP CONSTRAINT IF EXISTS hostname_hostname_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_hostname_uflow_null_unique ON hostname (hostname) WHERE uflow IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_hostname_uflow_name_unique ON hostname (uflow, hostname) WHERE uflow IS NOT NULL;

-- 3. Alter isp to support multi-tenant uflow column
ALTER TABLE isp ADD COLUMN IF NOT EXISTS uflow VARCHAR(255) REFERENCES users(uflow) ON DELETE CASCADE;
ALTER TABLE isp DROP CONSTRAINT IF EXISTS isp_isp_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_isp_uflow_null_unique ON isp (isp) WHERE uflow IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_isp_uflow_name_unique ON isp (uflow, isp) WHERE uflow IS NOT NULL;

-- 4. Add rate_limit column to user_settings
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS rate_limit INT DEFAULT 120;

-- 5. Seed new browsers into browser table
INSERT INTO browser (browser) VALUES
  ('Arc'),
  ('Tor Browser'),
  ('Waterfox'),
  ('Pale Moon')
ON CONFLICT (browser) DO NOTHING;

COMMIT;
