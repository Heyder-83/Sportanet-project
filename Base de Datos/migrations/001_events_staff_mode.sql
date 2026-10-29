-- 001_events_staff_mode.sql
-- Cómo se define el personal organizador de un evento (decide el club al crearlo):
--   'Club'     = lo organiza el club en general, sin delegados específicos (no hay filas en event_staff).
--   'Specific' = personas concretas, listadas en event_staff (ver 002).
-- Que 'Club' no tenga filas en event_staff lo garantiza la API (no un trigger): al cambiar a 'Club' borra el personal
-- en la misma transacción.
ALTER TABLE `sport_events`
  ADD COLUMN `staff_mode` enum('Club','Specific') NOT NULL DEFAULT 'Club' AFTER `approval_mode`;
