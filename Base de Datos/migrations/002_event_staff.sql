-- 002_event_staff.sql
-- Personal organizador de un evento, por parte del club (solo se usa si sport_events.staff_mode = 'Specific').
-- Cada persona puede ser un usuario de la plataforma (user_id) o solo un nombre (alguien sin cuenta): display_name
-- siempre existe y es lo que se muestra en el portal público. Si el usuario se borra, la fila queda con su nombre.
CREATE TABLE `event_staff` (
  `event_staff_id` int NOT NULL AUTO_INCREMENT,
  `sport_event_id` int NOT NULL,
  `user_id` int DEFAULT NULL,
  `display_name` varchar(100) NOT NULL,
  `role_title` varchar(60) NOT NULL DEFAULT 'Organizador',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_staff_id`),
  UNIQUE KEY `uq_event_staff_user` (`sport_event_id`, `user_id`),
  KEY `idx_event_staff_user` (`user_id`),
  CONSTRAINT `fk_event_staff_event` FOREIGN KEY (`sport_event_id`) REFERENCES `sport_events` (`sport_event_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_event_staff_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `chk_event_staff_name` CHECK (CHAR_LENGTH(TRIM(`display_name`)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
