-- Base de Datos/spn_ad/schema.sql
-- Esquema de SPN_AD: base de datos APARTE para las cuentas de administración de Sportanet.
-- Separada de sportanet_v1 a propósito: los administradores no son usuarios de la plataforma (no existen en
-- `users`) y esta base se conecta con un usuario de MySQL propio (ver README.md de esta carpeta).
-- Solo estructura, sin datos. Compatible con MySQL 8 y MariaDB (no fija collation).
--
-- Decisiones de diseño (Fase 1F):
--   * NO se guarda la IP ni la ubicación de los inicios de sesión: solo fecha y hora (con cláusula de seguridad
--     en el contrato firmado por el administrador; Ley 1581 de 2012).
--   * El TSU nunca se guarda en claro: solo tsu_hash (HMAC-SHA-256 en hexadecimal, calculado por la aplicación
--     con una clave del servidor). Es UNIQUE para poder buscar la cuenta por TSU al crearla.
--   * El secreto del 2FA (TOTP) debe poder leerse para validar códigos: se guarda CIFRADO (AES-256-GCM, la
--     aplicación lo cifra; la clave NO está en esta base).
--   * El nombre no es único: el identificador de la cuenta es admin_id.

CREATE TABLE `schema_migrations` (
  `version` varchar(50) NOT NULL,
  `description` varchar(255) NOT NULL,
  `applied_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Una cuenta de administrador. Nace 'pending' (la crean los dueños con su TSU) y pasa a 'active' cuando el
-- administrador completa el registro (nombre, contraseña y 2FA). El TSU es de un solo uso (tsu_used_at).
CREATE TABLE `admins` (
  `admin_id` int NOT NULL AUTO_INCREMENT,
  `full_name` varchar(100) DEFAULT NULL,
  `pwd` varchar(255) DEFAULT NULL,
  `tsu_hash` char(64) NOT NULL,
  `tsu_used_at` datetime DEFAULT NULL,
  `totp_secret_enc` varchar(255) DEFAULT NULL,
  `status` enum('pending','active','suspended') NOT NULL DEFAULT 'pending',
  `failed_attempts` tinyint unsigned NOT NULL DEFAULT 0,
  `locked_until` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `activated_at` datetime DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`admin_id`),
  UNIQUE KEY `uq_admins_tsu_hash` (`tsu_hash`),
  -- Una cuenta activa o suspendida siempre está completa: no puede existir un admin sin contraseña ni 2FA.
  CONSTRAINT `chk_admins_complete` CHECK (
    `status` = 'pending'
    OR (`full_name` IS NOT NULL AND `pwd` IS NOT NULL AND `totp_secret_enc` IS NOT NULL AND `activated_at` IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Intentos de inicio de sesión de cada administrador: fecha y hora y resultado. Sin IP.
-- Retención prevista: 12 meses (un trabajo de limpieza llegará en una fase posterior).
CREATE TABLE `admin_logins` (
  `login_id` bigint NOT NULL AUTO_INCREMENT,
  `admin_id` int NOT NULL,
  `attempted_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `outcome` enum('success','bad_password','bad_2fa','locked') NOT NULL,
  PRIMARY KEY (`login_id`),
  KEY `idx_admin_logins_admin_time` (`admin_id`, `attempted_at`),
  CONSTRAINT `fk_admin_logins_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins` (`admin_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
