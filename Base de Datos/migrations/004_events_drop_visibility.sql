-- 004_events_drop_visibility.sql
-- Sportanet no tiene eventos privados: todo evento publicado es público (si un club quiere algo cerrado, lo gestiona
-- por su cuenta). Se quitan visibility y share_token, y el índice del listado pasa a (estado, fecha de inicio).
ALTER TABLE `sport_events`
  DROP INDEX `idx_events_listing`,
  DROP INDEX `uq_events_share_token`,
  DROP COLUMN `visibility`,
  DROP COLUMN `share_token`,
  ADD INDEX `idx_events_listing` (`event_status`, `start_at`);
