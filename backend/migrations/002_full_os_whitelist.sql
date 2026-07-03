-- WebGuard V2: Migration 002 - Full OS Whitelist Population
-- Ensures all 10 supported operating systems are present in the system table.
-- These are the OS names that getDetectedOS() in detection.ts maps User-Agents to.
--

BEGIN;

INSERT INTO system (system) VALUES
  ('Windows 10'),
  ('Windows 8.1'),
  ('Windows 8'),
  ('Windows 7'),
  ('Mac OS X'),
  ('iPhone'),
  ('iPad'),
  ('Android'),
  ('Linux'),
  ('Mobile')
ON CONFLICT (system) DO NOTHING;

COMMIT;
