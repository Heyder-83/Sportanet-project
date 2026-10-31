# Sportanet

## Descripción del Proyecto

Sportanet es una plataforma web diseñada para facilitar la búsqueda, gestión y participación en eventos deportivos. Permite a los usuarios registrarse, crear perfiles personalizados, explorar eventos disponibles e inscribirse en actividades deportivas de su interés.

## Tecnologías Usadas

### Frontend
- **HTML5** - Estructura semántica
- **CSS3** - Diseño responsive con Flexbox y Grid
- **JavaScript** - Lógica de aplicación y validaciones
- **Fetch API** - Comunicación con el backend

### Backend
- **Node.js** - Runtime de JavaScript
- **Express.js** - Framework web
- **MySQL2** - Driver de base de datos
- **bcrypt** - Encriptación de contraseñas
- **JWT (jsonwebtoken)** - Autenticación basada en tokens
- **CORS** - Control de acceso entre dominios

### Base de Datos
- **MySQL 8** - Sistema de gestión de base de datos relacional

## Requisitos Previos

| Herramienta | Versión | Para qué |
|---|---|---|
| Node.js | **20.6 o superior** (probado con 22 y 24) | Los scripts usan `node --env-file` y `node --test`; con Node 14 no funcionan |
| MySQL Server | **8.0** | Bases de datos (ver siguiente sección). MariaDB 10.11 sirve para correr pruebas, pero no es el objetivo |
| Cliente `mysql` / `mysqldump` | el de MySQL 8 | Crear las bases reales y hacer respaldos |
| Git | cualquiera | Clonar el repositorio |
| Navegador moderno | — | Frontend |

## Bases de Datos

Sportanet usa **cuatro bases de datos** en el mismo servidor MySQL. Las de prueba existen para que ninguna prueba toque datos reales.

| Base | Para qué | Quién la crea | Qué contiene |
|---|---|---|---|
| `sportanet_v1` | **Principal.** La usa la aplicación: usuarios, organizadores, clubes, sedes, eventos, inscripciones | Tú, a mano (una vez) | Estructura de `Base de Datos/schema.sql` + migraciones de `Base de Datos/migrations/` |
| `sportanet_test` | Pruebas de integración de la base principal (`npm run testsql`) | **Se crea sola** con `npm run db:reset:test` | Copia de la estructura; las pruebas insertan y borran filas |
| `spn_ad` | **Administradores.** Cuentas de administración, hash de su TSU, historial de inicios de sesión, lista de TSU (solo desarrollo). Es una base **aparte** a propósito: no es parte de `sportanet_v1` | Tú, a mano (una vez) | Estructura de `Base de Datos/spn_ad/schema.sql` + sus migraciones |
| `spn_ad_test` | Pruebas de SPN_AD (`npm run testad`) | **Se crea sola** con `npm run db:reset:ad-test` | Copia de la estructura de SPN_AD |

Reglas importantes:
- **Una base de pruebas se recrea desde cero** cada vez que ejecutas su `db:reset`: borra la base y la crea de nuevo. Por eso los scripts **se niegan a funcionar** si el nombre de la base no termina en `_test`. Nunca apuntes `.env.test` a `sportanet_v1` ni a `spn_ad`.
- SPN_AD no usa la tabla `users`: los administradores solo existen allí. Más detalles en [`Base de Datos/spn_ad/README.md`](Base%20de%20Datos/spn_ad/README.md).
- Para probar solo la API principal no necesitas SPN_AD: si `DB_AD_NAME` no está definido en `backend/.env`, el servidor arranca sin las rutas `/api/admin`.

## Instalación

### 1. Clonar e instalar dependencias

```bash
git clone https://github.com/Heyder-83/Sportanet-project.git
cd Sportanet-project/backend
npm ci
```

### 2. Crear las bases reales (una sola vez, con un usuario con permisos como `root`)

Base principal. Desde la raíz del repositorio:

```bash
mysql -u root -p -e "CREATE DATABASE sportanet_v1 CHARACTER SET utf8mb4;"
cd "Base de Datos"
mysql -u root -p sportanet_v1 -e "source schema.sql"
cd ../backend
npm run migrate -- --dry-run     # muestra qué migraciones se aplicarían, sin cambiar nada
npm run migrate                  # las aplica (pide escribir el nombre de la base para confirmar)
```

> En PowerShell no uses `mysql ... < archivo.sql` (la redirección no funciona igual). Usa `-e "source archivo.sql"` como arriba.

SPN_AD (solo si vas a trabajar con administradores). Crea la base, el usuario aislado y sus permisos como se explica en [`Base de Datos/spn_ad/README.md`](Base%20de%20Datos/spn_ad/README.md) y luego:

```bash
cd "Base de Datos/spn_ad"
mysql -u root -p spn_ad -e "source schema.sql"
cd ../../backend
npm run migrate:ad -- --dry-run
npm run migrate:ad
```

Antes de aplicar migraciones en una base real haz un **respaldo** (en PowerShell no uses `>`: guarda en UTF-16 y corrompe el dump):

```powershell
mysqldump -h localhost -P 3306 -u root -p --result-file=respaldo.sql sportanet_v1
```

Las bases `sportanet_test` y `spn_ad_test` **no se crean a mano**: lo hacen los comandos de la sección *Pruebas*.

### 3. Configurar las variables de entorno

Hay **dos archivos**, ambos dentro de `backend/` y **ninguno se sube a Git** (están en `.gitignore`). Se copian de las plantillas:

```bash
cd backend
cp .env.example .env
cp .env.test.example .env.test
```

#### `backend/.env` — la aplicación (bases reales)

```ini
PORT=5000

# Base principal
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=<tu contraseña de MySQL>
DB_NAME=sportanet_v1

# Tokens de usuarios: mínimo 32 caracteres aleatorios
JWT_SECRET=<aleatorio, 32+ caracteres>

# --- Solo si trabajas con administradores (SPN_AD). Sin DB_AD_NAME las rutas /api/admin no se montan ---
DB_AD_NAME=spn_ad
DB_AD_USER=spn_ad_app
DB_AD_PASSWORD=<contraseña distinta de la de DB_PASSWORD>
TSU_HMAC_KEY=<aleatorio, 32+ caracteres, distinto de JWT_SECRET>
ADMIN_JWT_SECRET=<aleatorio, 32+ caracteres, distinto de JWT_SECRET y TSU_HMAC_KEY>
```

Genera cada secreto con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

El servidor **no arranca** si falta `JWT_SECRET` o si es corto; con SPN_AD activo exige también las demás variables. `DB_AD_USER` debe ser un usuario distinto de `DB_USER` (en producción es obligatorio). Opcionales: `DB_AD_HOST` y `DB_AD_PORT` (por defecto usan `DB_HOST` y `DB_PORT`).

#### `backend/.env.test` — las pruebas (bases `_test`)

```ini
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=<tu contraseña de MySQL>
DB_NAME=sportanet_test

JWT_SECRET=<cualquier valor de 32+ caracteres; puede ser distinto del real>

DB_AD_NAME=spn_ad_test
DB_AD_USER=root
DB_AD_PASSWORD=<tu contraseña de MySQL>
# Opcionales: si faltan, las pruebas usan claves de prueba propias
TSU_HMAC_KEY=<32+ caracteres>
ADMIN_JWT_SECRET=<32+ caracteres>
```

- El usuario de `.env.test` necesita permiso para **crear y borrar bases** (`DROP DATABASE` / `CREATE DATABASE`), porque los `db:reset` recrean las bases de prueba. En un equipo de desarrollo normalmente es `root`.
- Si `DB_AD_USER` es igual a `DB_USER`, en pruebas solo aparece una advertencia de seguridad; es esperado.
- Las bases de prueba **no necesitan datos reales**: no copies información de `sportanet_v1`.

### 4. Iniciar el backend

```bash
cd backend
npm start
```

El servidor queda en `http://localhost:5000`. El frontend tiene esa dirección fija (`JS/header.js` y `JS/events.js`), así que no cambies `PORT` sin cambiarla también allí.

### 5. Abrir el frontend

Sirve la carpeta raíz con un servidor HTTP local (por ejemplo `npx serve` o la extensión *Live Server*) y abre `index.html` o `events.html`. Abrirlos con doble clic (`file://`) no funciona: el header se carga con `fetch`.

Para ver eventos en `events.html` necesitas filas en `sport_events` con estado `Published` en `sportanet_v1`.

## Pruebas

Todos los comandos se ejecutan **desde `backend/`**.

| Comando | Necesita | Qué prueba |
|---|---|---|
| `npm test` | Solo Node (sin base de datos) | Pruebas unitarias: validaciones, middleware, rutas con base simulada |
| `npm run db:reset:test` | `.env.test` + MySQL | **Recrea `sportanet_test`** desde `schema.sql` y aplica todas las migraciones |
| `npm run testsql` | `sportanet_test` lista | Esquema, consultas y API de eventos contra MySQL real |
| `npm run db:reset:ad-test` | `.env.test` + MySQL | **Recrea `spn_ad_test`** desde `Base de Datos/spn_ad/schema.sql` |
| `npm run testad` | `spn_ad_test` lista | Esquema de SPN_AD, login y alta de administradores |
| `npm run migrate:test` / `migrate:ad:test` | `.env.test` | Aplica migraciones pendientes a la base de prueba sin recrearla |

### Montar el entorno de pruebas desde cero

```bash
cd backend
npm ci
cp .env.test.example .env.test     # y edita contraseña y secretos
npm test                           # 1. unitarias, no tocan ninguna base
npm run db:reset:test              # 2. crea sportanet_test
npm run testsql                    # 3. pruebas de integración principal
npm run db:reset:ad-test           # 4. crea spn_ad_test
npm run testad                     # 5. pruebas de SPN_AD
```

Después de añadir una migración nueva, repite `npm run db:reset:test` (y `db:reset:ad-test` si fue de SPN_AD) antes de las pruebas.

### Problemas frecuentes

| Mensaje | Causa |
|---|---|
| `ECONNREFUSED` / `ER_ACCESS_DENIED_ERROR` | MySQL apagado, puerto distinto de `DB_PORT` o contraseña incorrecta |
| `.env.test: not found` | No existe `backend/.env.test` (no viaja con el repositorio) |
| `solo puede correr contra una BD *_test` | `DB_NAME` o `DB_AD_NAME` en `.env.test` no termina en `_test` (es una protección) |
| `Faltan las migraciones de eventos` / `ER_NO_SUCH_TABLE` | Falta `npm run db:reset:test` |
| `JWT_SECRET ... al menos 32 caracteres` | Secreto ausente o corto |
| `bad option: --env-file` | Node anterior a 20.6 |
| Falla `npm test` por `--test` / `--env-file` en Windows | Ejecuta desde `backend/`, no desde la raíz |

## Flujo de Uso
1. **Registrarse** - Crea una cuenta con tu nombre, email, teléfono y contraseña
2. **Iniciar Sesión** - Accede con tus credenciales
3. **Mi Perfil** - Visualiza y edita tu información personal o elimina tu cuenta
4. **Eventos** - Explora eventos deportivos (búsqueda por nombre, próximos/pasados y orden); no requiere cuenta
5. **Inscripción** - Participa en eventos de tu interés (en desarrollo)

---

## Equipo de Desarrollo

- **Heyder Ivan Ramos Rodriguez**
- **Daniel Gustavo Montañez**
- **Juherles Jesus Renia**
- **Danilo Jose Cantor**

**Grupo:** Tecnología en Desarrollo de Software  
**Universidad:** Universidad San Buenaventura
