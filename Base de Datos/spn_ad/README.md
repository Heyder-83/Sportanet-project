# SPN_AD — base de datos de administradores

Base **aparte** de `sportanet_v1`. Guarda las cuentas de administración de Sportanet (no son usuarios de la plataforma y no existen en `users`), el hash de su TSU y el historial de sus inicios de sesión.

> **Estado (SPNdev.2):** modo «mostrario de concepto». Hay lista de TSU, alta (`POST /api/admin/register`) y login (`POST /api/admin/login`, `GET /api/admin/me`), **sin 2FA** todavía.

- `schema.sql`: estructura (`admins`, `admin_logins`, `tsu_reserve`, `schema_migrations`). Sin datos.
- `migrations/`: cambios posteriores, con la misma convención que `Base de Datos/migrations/MIGRATE.md` (`NNN_descripcion.sql`, un cambio por archivo).

## Qué se guarda y qué no

| Dato | Cómo |
|---|---|
| TSU | En `admins` nunca en claro: `tsu_hash` (HMAC-SHA-256, 64 caracteres hex, calculado por la aplicación con `TSU_HMAC_KEY`). Único y de un solo uso (`tsu_used_at`). **Excepción de desarrollo:** mientras no se asigna, el TSU espera en claro en `tsu_reserve` (ver abajo). |
| Contraseña | Hash bcrypt en `pwd`. |
| Secreto del 2FA | **Aún no se usa.** `totp_secret_enc` queda reservada (opcional); cuando se incorpore, irá cifrada (AES-256-GCM) con una clave que **no** esté en esta base. |
| Inicios de sesión | Solo fecha y hora y resultado (`admin_logins`). **No se guarda IP ni ubicación.** |
| Intentos fallidos | `failed_attempts` y `locked_until` por cuenta (el límite es de 5). |

La autorización para guardar la fecha y hora de cada inicio de sesión (finalidad: seguridad de la plataforma; retención prevista: 12 meses) debe constar en el contrato que firma cada administrador (Ley 1581 de 2012). Eso lo redacta y valida el equipo con su abogado, no el código.

## Lista de TSU (`tsu_reserve`, solo desarrollo)

Los TSU se cargan **antes de hashear** en `tsu_reserve`, a mano, con INSERT como root (aún no hay script generador). Formato: 16 a 64 caracteres alfanuméricos (la tabla rechaza otro formato); se distinguen mayúsculas de minúsculas. Genera cada uno con un valor aleatorio largo, por ejemplo en PowerShell o Node:

```text
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

```sql
INSERT INTO tsu_reserve (tsu_plain) VALUES ('<TSU 1>'), ('<TSU 2>');
```

Cuando alguien crea su cuenta con un TSU, ese TSU se **borra** de la lista y en `admins` solo queda su hash (todo en una transacción: si algo falla, el TSU sigue disponible). Quien pueda leer `tsu_reserve` puede crear cuentas de administrador, por eso la tabla es solo para desarrollo y debe eliminarse (con una migración) cuando los TSU se generen con una herramienta que guarde solo el hash. No subas al repositorio ningún archivo con TSU reales.

## Alta de administradores (SPNdev.1)

```text
POST /api/admin/register
{ "full_name": "...", "pwd": "...", "tsu": "<TSU de la lista>" }
-> 201 { "message": "Admin account created", "admin": { "id": N, "full_name": "..." } }   (sin token)
-> 400 VALIDATION_ERROR (con la lista de campos) | 403 TSU_INVALID (no existe o ya se usó, misma respuesta)
```

La ruta solo se monta si `DB_AD_NAME` está definido. En ese caso `TSU_HMAC_KEY` es obligatoria.

## Login de administradores (SPNdev.2)

```text
POST /api/admin/login   { "admin_id": N, "pwd": "..." }   (el id lo devuelve register; el nombre no es único)
-> 200 { token, admin: { id, full_name } }   JWT de 30 min firmado con ADMIN_JWT_SECRET
-> 400 VALIDATION_ERROR | 401 INVALID_CREDENTIALS | 403 ADMIN_SUSPENDED | 429 ADMIN_LOCKED (+ Retry-After)
GET /api/admin/me       Authorization: Bearer <token>   -> { id, full_name }
```

5 intentos fallidos por cuenta bloquean 15 minutos y dejan `[ALERTA-ADMIN]` en el log. Cada intento queda en `admin_logins` (sin IP). Quien conozca un `admin_id` puede bloquear esa cuenta 15 min con intentos erróneos (coste aceptado del bloqueo por cuenta).

## Variables de entorno (en `backend/.env`; sin valores por defecto)

```text
DB_AD_NAME=spn_ad
DB_AD_USER=spn_ad_app
DB_AD_PASSWORD=<contraseña larga y distinta de la de la base principal>
# opcionales: DB_AD_HOST, DB_AD_PORT (por defecto usan DB_HOST / DB_PORT)
TSU_HMAC_KEY=<mínimo 32 caracteres aleatorios; distinta de JWT_SECRET; si se cambia, los hash guardados dejan de coincidir>
ADMIN_JWT_SECRET=<mínimo 32 caracteres aleatorios; distinta de JWT_SECRET y TSU_HMAC_KEY>
```

Genera cada secreto con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

`db/connectionAd.js` falla al cargarse si falta alguna, si `DB_AD_NAME` es la base principal, y en producción si `DB_AD_USER` es igual a `DB_USER`.

## Usuario de MySQL aislado (se ejecuta una vez, como root, a mano)

La aplicación debe conectarse a SPN_AD con un usuario que **solo** vea esa base, y el usuario de la base principal no debe ver SPN_AD:

```sql
CREATE DATABASE spn_ad CHARACTER SET utf8mb4;
CREATE USER 'spn_ad_app'@'%' IDENTIFIED BY '<contraseña>';
GRANT SELECT, INSERT, UPDATE ON spn_ad.admins        TO 'spn_ad_app'@'%';
GRANT SELECT, INSERT         ON spn_ad.admin_logins  TO 'spn_ad_app'@'%';
GRANT SELECT, DELETE         ON spn_ad.tsu_reserve   TO 'spn_ad_app'@'%';  -- la app lee y consume TSU; nunca los carga
-- Sin DROP, ALTER ni DELETE en admins/admin_logins.
-- Para migrar usa una cuenta con CREATE/ALTER solo mientras dura la migración.
```

Restringe `'%'` al host de tu servidor cuando lo conozcas. En producción lo más seguro es una instancia de MySQL distinta, no solo otra base en el mismo servidor.

## Comandos (desde `backend/`)

```text
npm run db:reset:ad-test       recrea spn_ad_test desde schema.sql (solo *_test)
npm run migrate:ad:test        aplica migraciones pendientes a spn_ad_test
npm run testad                 pruebas del esquema, de connectionAd y del alta de administradores (contra spn_ad_test)
npm run migrate:ad -- --dry-run   qué se aplicaría en SPN_AD real, sin cambiar nada
npm run migrate:ad             aplica en SPN_AD real (pide escribir el nombre de la BD; respaldo antes)
```

Para las pruebas añade a `backend/.env.test`:

```text
DB_AD_NAME=spn_ad_test
DB_AD_USER=<usuario con permisos sobre spn_ad_test>
DB_AD_PASSWORD=<su contraseña>
TSU_HMAC_KEY=<opcional: si falta, testad usa una clave de prueba>
```

Nota: `schema.sql` se modificó en SPNdev.1 (se añade `tsu_reserve` y el 2FA deja de ser obligatorio) porque `spn_ad` real todavía no existe. Si ya tienes `spn_ad_test` creada con la versión anterior, ejecuta `npm run db:reset:ad-test`.
