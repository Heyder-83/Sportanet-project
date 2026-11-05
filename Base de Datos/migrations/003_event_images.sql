-- 003_event_images.sql
-- Galería de un evento. La imagen de portada sigue en sport_events.cover_image; aquí van las demás.
-- Solo se guarda la ruta o URL del archivo (las imágenes no viven en la base de datos).
CREATE TABLE `event_images` (
  `event_image_id` int NOT NULL AUTO_INCREMENT,
  `sport_event_id` int NOT NULL,
  `url` varchar(500) NOT NULL,
  `alt_text` varchar(200) DEFAULT NULL,
  `position` smallint unsigned NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_image_id`),
  KEY `idx_event_images_event` (`sport_event_id`, `position`),
  CONSTRAINT `fk_event_images_event` FOREIGN KEY (`sport_event_id`) REFERENCES `sport_events` (`sport_event_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_event_images_url` CHECK (CHAR_LENGTH(TRIM(`url`)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
