-- 002_seed_settings.sql
-- Ensure the singleton settings row exists. Safe to re-run.
INSERT IGNORE INTO settings (id)
VALUES (1);
