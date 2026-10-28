ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS iplocate_enabled integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS iplocate_keys (
  id serial PRIMARY KEY,
  api_key character varying(200) NOT NULL UNIQUE,
  daily_quota integer DEFAULT 1000,
  enabled boolean DEFAULT true
);