-- Base de Datos/spn_ad/schema.sql
-- Esquema de SPN_AD: base de datos APARTE para las cuentas de administración de Sportanet.
-- Separada de sportanet_v1 a propósito: los administradores no son usuarios de la plataforma (no existen en
-- `users`) y esta base se conecta con un usuario de MySQL propio (ver README.md de esta carpeta).
-- Solo estructura, sin datos. Compatible con MySQL 8 y MariaDB (no fija collation).
--
-- Decisiones de diseño (Fase 1F y SPNdev.1):
--   * NO se guarda la IP ni la ubicación de los inicios de sesión: solo fecha y hora (con cláusula de seguridad
--     en el contrato firmado por el administrador; Ley 1581 de 2012).
--   * En `admins` el TSU nunca se guarda en claro: solo tsu_hash (HMAC-SHA-256 en hexadecimal, calculado por la
--     aplicación con una clave del servidor). Es UNIQUE: un mismo TSU no puede asignarse a dos cuentas.
--   * SPNdev.1: por ahora NO hay 2FA. La columna totp_secret_enc queda reservada (opcional) para cuando se
--     incorpore; el secreto del 2FA deberá guardarse CIFRADO (AES-256-GCM, clave fuera de esta base).
--   * SPNdev.1: los TSU se cargan antes de hashear en la tabla `tsu_reserve` (lista de reserva, SOLO DESARROLLO).
--     Al asignar un TSU a una cuenta (nombre + contraseña) su fila se borra de la lista y solo queda su hash en
--     `admins.tsu_hash`.
--   * El nombre no es único: el identificador de la cuenta es admin_id.

CREATE TABLE `schema_migrations` (
  `version` varchar(50) NOT NULL,
  `description` varchar(255) NOT NULL,
  `applied_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Lista de reserva de TSU, antes de hashear. SOLO DESARROLLO (SPNdev): contiene los TSU en claro hasta que se
-- asignan, así que quien lea esta tabla puede crear cuentas de administrador. Debe desaparecer (con una migración
-- que la borre) cuando los TSU se generen con una herramienta que guarde solo el hash.
-- La carga la hace a mano el equipo con INSERT como root; la aplicación solo lee y borra (README.md).
-- ascii_bin: la comparación distingue mayúsculas de minúsculas. El CHECK impide cargar un TSU que la aplicación
-- no aceptaría después (16 a 64 caracteres alfanuméricos).
CREATE TABLE `tsu_reserve` (
  `tsu_plain` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`tsu_plain`),
  CONSTRAINT `chk_tsu_reserve_format` CHECK (`tsu_plain` REGEXP '^[A-Za-z0-9]{16,64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Una cuenta de administrador. Hoy se crea ya 'active' al asignar un TSU de la lista de reserva (nombre y
-- contraseña); 'pending' queda para cuando el alta incluya pasos posteriores (2FA). El TSU es de un solo uso.
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
  -- Una cuenta activa o suspendida siempre está completa: no puede existir un admin sin nombre, contraseña ni
  -- fecha de activación. (SPNdev.1: el 2FA aún no es obligatorio; al incorporarlo se añadirá en una migración.)
  CONSTRAINT `chk_admins_complete` CHECK (
    `status` = 'pending'
    OR (`full_name` IS NOT NULL AND `pwd` IS NOT NULL AND `activated_at` IS NOT NULL)
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
