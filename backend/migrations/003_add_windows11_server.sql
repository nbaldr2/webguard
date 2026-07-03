-- WebGuard V2: Migration 003 - Add Windows 11 & Windows Server OS entries
-- Windows 11 shares "Windows NT 10.0" with Windows 10 in legacy UA strings.
-- Windows Server versions map to their NT kernel counterparts.
-- Detection is done via best-effort UA heuristics in detection.ts.
--

BEGIN;

INSERT INTO system (system) VALUES
  ('Windows 11'),
  ('Windows Server 2022'),
  ('Windows Server 2019'),
  ('Windows Server 2016'),
  ('Windows Server 2012 R2'),
  ('Windows Server 2012'),
  ('Windows Server 2008 R2')
ON CONFLICT (system) DO NOTHING;

COMMIT;
