ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS fraudlogix_enabled integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS fraudlogix_keys (
  id serial PRIMARY KEY,
  api_key character varying(200) NOT NULL UNIQUE,
  monthly_quota integer DEFAULT 1000,
  enabled boolean DEFAULT true
);