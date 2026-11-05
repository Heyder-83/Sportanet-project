-- 005_user_profile_image.sql
-- Imagen de perfil opcional, almacenada como data URL PNG/JPEG/WebP y limitada por la API.
SELECT COUNT(*) INTO @profile_image_exists
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'users'
  AND column_name = 'profile_image';

SET @profile_image_sql = IF(
  @profile_image_exists = 0,
  'ALTER TABLE `users` ADD COLUMN `profile_image` MEDIUMTEXT NULL AFTER `phone`',
  'SELECT 1'
);

PREPARE profile_image_stmt FROM @profile_image_sql;
EXECUTE profile_image_stmt;
DEALLOCATE PREPARE profile_image_stmt;
