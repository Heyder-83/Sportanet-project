# SPN_AD — base de datos de administradores

Base **aparte** de `sportanet_v1`. Guarda las cuentas de administración de Sportanet (no son usuarios de la plataforma y no existen en `users`), el hash de su TSU y el historial de sus inicios de sesión.

- `schema.sql`: estructura (`admins`, `admin_logins`, `schema_migrations`). Sin datos.
- `migrations/`: cambios posteriores, con la misma convención que `Base de Datos/migrations/MIGRATE.md` (`NNN_descripcion.sql`, un cambio por archivo).

## Qué se guarda y qué no

| Dato | Cómo |
|---|---|
| TSU | Nunca en claro: `tsu_hash` (HMAC-SHA-256, 64 caracteres hex, calculado por la aplicación con una clave del servidor). Único y de un solo uso (`tsu_used_at`). |
| Contraseña | Hash bcrypt en `pwd`. |
| Secreto del 2FA | Cifrado (AES-256-GCM) en `totp_secret_enc`; la clave de cifrado **no** está en esta base. |
| Inicios de sesión | Solo fecha y hora y resultado (`admin_logins`). **No se guarda IP ni ubicación.** |
| Intentos fallidos | `failed_attempts` y `locked_until` por cuenta (el límite es de 5). |

La autorización para guardar la fecha y hora de cada inicio de sesión (finalidad: seguridad de la plataforma; retención prevista: 12 meses) debe constar en el contrato que firma cada administrador (Ley 1581 de 2012). Eso lo redacta y valida el equipo con su abogado, no el código.

## Variables de entorno (en `backend/.env`; sin valores por defecto)

```text
DB_AD_NAME=spn_ad
DB_AD_USER=spn_ad_app
DB_AD_PASSWORD=<contraseña larga y distinta de la de la base principal>
# opcionales: DB_AD_HOST, DB_AD_PORT (por defecto usan DB_HOST / DB_PORT)
```

`db/connectionAd.js` falla al cargarse si falta alguna, si `DB_AD_NAME` es la base principal, y en producción si `DB_AD_USER` es igual a `DB_USER`.

## Usuario de MySQL aislado (se ejecuta una vez, como root, a mano)

La aplicación debe conectarse a SPN_AD con un usuario que **solo** vea esa base, y el usuario de la base principal no debe ver SPN_AD:

```sql
CREATE DATABASE spn_ad CHARACTER SET utf8mb4;
CREATE USER 'spn_ad_app'@'%' IDENTIFIED BY '<contraseña>';
GRANT SELECT, INSERT, UPDATE ON spn_ad.* TO 'spn_ad_app'@'%';  -- sin DELETE, DROP ni ALTER
-- Para migrar usa una cuenta con CREATE/ALTER solo mientras dura la migración.
```

Restringe `'%'` al host de tu servidor cuando lo conozcas. En producción lo más seguro es una instancia de MySQL distinta, no solo otra base en el mismo servidor.

## Comandos (desde `backend/`)

```text
npm run db:reset:ad-test       recrea spn_ad_test desde schema.sql (solo *_test)
npm run migrate:ad:test        aplica migraciones pendientes a spn_ad_test
npm run testad                 pruebas del esquema y de connectionAd (contra spn_ad_test)
npm run migrate:ad -- --dry-run   qué se aplicaría en SPN_AD real, sin cambiar nada
npm run migrate:ad             aplica en SPN_AD real (pide escribir el nombre de la BD; respaldo antes)
```

Para las pruebas añade a `backend/.env.test`:

```text
DB_AD_NAME=spn_ad_test
DB_AD_USER=<usuario con permisos sobre spn_ad_test>
DB_AD_PASSWORD=<su contraseña>
```
