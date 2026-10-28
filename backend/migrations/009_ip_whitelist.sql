CREATE TABLE IF NOT EXISTS white_ip (
  id serial PRIMARY KEY,
  ip character varying(255) NOT NULL,
  uflow character varying(255) REFERENCES users(uflow) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_white_ip_uflow_ip_unique ON white_ip (uflow, ip) WHERE uflow IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_white_ip_uflow_null_unique ON white_ip (ip) WHERE uflow IS NULL;