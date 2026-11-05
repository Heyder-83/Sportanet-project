# Conexión TLS a Azure Database for MySQL (Flexible Server)

Guía para desplegar Sportanet en Azure App Service conectando con TLS validado a MySQL.
**Local y Docker no cambian**: con `DB_SSL=false` (o sin definir) todo funciona como hasta ahora.

## 1. Variables nuevas

| Variable | Valor | Efecto |
|---|---|---|
| `DB_SSL` | `true` / `false` (también `1/0`, `yes/no`, `on/off`). Vacío = `false`. Un valor desconocido (p. ej. `tru`) es un error. | Con `true` activa TLS en el pool principal, en el pool SPN_AD y en `scripts/migrate.js` (principal y `--ad`). `rejectUnauthorized` queda **siempre** en `true`; no hay variable que lo desactive. |
| `DB_SSL_CA` | Ruta a un archivo **PEM** con la(s) CA raíz. Relativa a `backend/` (igual que `backend/.env`) o absoluta. | Se lee el archivo y se pasa su contenido a `mysql2`. Opcional: si se omite se usan las CA de confianza de Node. |

Si `DB_SSL=true` y `DB_SSL_CA` falta, no se puede leer, no es PEM, tiene un certificado corrupto o todos están caducados, **la app (o el script) no arranca** y muestra un mensaje claro. Nunca se cae a una conexión sin TLS ni sin validar.

`DB_SSL` y `DB_SSL_CA` son comunes a la base principal y a SPN_AD (si `DB_AD_HOST` apunta a otro servidor, debe ser también uno que use la misma CA).

## 2. Certificados oficiales que hay que obtener

Microsoft indica que los clientes deben confiar en estas **dos CA raíz** ([TLS con Azure Database for MySQL](https://learn.microsoft.com/en-us/azure/mysql/security/security-tls-how-to-connect)):

| Certificado | Descarga oficial | Formato | Huella SHA-1 publicada por Microsoft |
|---|---|---|---|
| DigiCert Global Root G2 | https://cacerts.digicert.com/DigiCertGlobalRootG2.crt.pem | PEM | `DF3C24F9BFD666761B268073FE06D1CC8D4F82A4` |
| Microsoft RSA Root Certificate Authority 2017 | https://www.microsoft.com/pkiops/certs/Microsoft%20RSA%20Root%20Certificate%20Authority%202017.crt | DER (hay que convertirlo a PEM) | `73A5E64A3BFF8316FF0EDCCC618A906E4EAE4D74` |

Las huellas salen de la página de Microsoft [Azure CA details](https://docs.azure.cn/en-us/security/fundamentals/azure-ca-details); la de Microsoft RSA Root CA 2017 también coincide con el [repositorio PKI de Microsoft](https://microsoft.com/pkiops/docs/repository.htm). **No las copies de otra fuente: contrástalas tú contra esas páginas el día que hagas la descarga.**

Reglas de Microsoft que conviene respetar:
- Confía solo en **raíces**. No fijes certificados intermedios ni el del servidor: Microsoft los rota sin aviso y la conexión se rompería.
- Node.js no usa el almacén del sistema cuando pasas `ca`: hay que dar **un único archivo PEM con todas las raíces** concatenadas.
- La rotación desde *DigiCert Global Root CA* (antigua, SHA-1) hacia las dos raíces anteriores es el motivo de este bundle. Esa página de Microsoft contiene fechas contradictorias entre 2025 y 2026: confirma en el aviso de tu servidor en el portal de Azure si el tuyo ya migró. Solo si Azure te indica que tu servidor aún usa la cadena antigua, añade temporalmente también `https://cacerts.digicert.com/DigiCertGlobalRootCA.crt.pem` ([artículo de rotación](https://learn.microsoft.com/en-us/azure/mysql/security/security-tls-root-certificate-rotation)).

### Cómo construir y validar el bundle (una sola vez, en tu equipo)

Linux, macOS, WSL o Git Bash (Windows). Este repositorio **no incluye** ningún certificado: los generas tú y comprobamos su procedencia.

```bash
mkdir -p backend/certs && cd backend/certs

curl -fsSLo DigiCertGlobalRootG2.crt.pem https://cacerts.digicert.com/DigiCertGlobalRootG2.crt.pem
curl -fsSLo MicrosoftRSARootCA2017.crt "https://www.microsoft.com/pkiops/certs/Microsoft%20RSA%20Root%20Certificate%20Authority%202017.crt"

# El de Microsoft viene en DER: convertir a PEM
openssl x509 -inform DER -in MicrosoftRSARootCA2017.crt -out MicrosoftRSARootCA2017.pem

# Validar procedencia: la huella SHA-1 debe coincidir EXACTAMENTE con la tabla de arriba (y con las páginas de Microsoft)
openssl x509 -in DigiCertGlobalRootG2.crt.pem   -noout -subject -dates -fingerprint -sha1
openssl x509 -in MicrosoftRSARootCA2017.pem     -noout -subject -dates -fingerprint -sha1

# Solo si las huellas coinciden: un único bundle PEM
cat DigiCertGlobalRootG2.crt.pem MicrosoftRSARootCA2017.pem > azure-mysql-ca-bundle.pem
```

Comprueba que la aplicación lo acepta (desde `backend/`; debe imprimir `2`):

```bash
node -e "console.log(require('./utils/dbSsl').buildSslOptions({DB_SSL:'true',DB_SSL_CA:'certs/azure-mysql-ca-bundle.pem'}).ca.length)"
```

Los certificados raíz son públicos (no son secretos). El equipo decide si commitea `backend/certs/azure-mysql-ca-bundle.pem` (así viaja en el despliegue y en la imagen Docker, ya que `COPY backend` lo incluye) o lo coloca en el despliegue por otro medio. Si lo commiteas, hazlo solo después de validar las huellas.

## 3. Configuración en Azure

### 3.1 Servidor MySQL Flexible Server
1. **Server parameters** → `require_secure_transport = ON` (valor por defecto; no lo desactives).
2. `tls_version`: TLS 1.2 por defecto; TLS 1.3 recomendado por Microsoft (MySQL 8.0+; requiere reinicio del servidor). TLS 1.0/1.1 ya no existen.
3. Permite el acceso desde App Service según tu red (reglas de firewall o acceso privado/VNet). Esto depende de tu arquitectura de red y no lo cubre este documento.
4. El usuario en Flexible Server es el nombre simple (p. ej. `sportanet_app`), sin sufijo `@servidor`.
5. Crea las bases `sportanet_v1` y `SPN_AD` (esta última con su propio usuario de solo esa base, como ya exige `connectionAd.js`).

### 3.2 App Service → variables de entorno
Portal: **App Services → tu app → Settings → Environment variables → App settings**. Al añadir o editar variables, App Service **reinicia** la app. Marca como *Deployment slot setting* las que no deban viajar al intercambiar slots.

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `8080` (App Service con runtime Node; el código usa este valor si Azure no lo inyecta) |
| `DB_HOST` | FQDN del servidor: `<servidor>.mysql.database.azure.com` (**no uses la IP**: el certificado se valida contra el nombre) |
| `DB_PORT` | `3306` |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | usuario, contraseña y base principal (`sportanet_v1`) |
| `DB_AD_NAME` / `DB_AD_USER` / `DB_AD_PASSWORD` | SPN_AD, con usuario distinto al principal (en producción `connectionAd.js` lo exige) |
| `DB_SSL` | `true` |
| `DB_SSL_CA` | `certs/azure-mysql-ca-bundle.pem` (relativa a `backend/`) |
| `JWT_SECRET`, `ADMIN_JWT_SECRET`, `TSU_HMAC_KEY` | secretos reales y aleatorios (sin cambios respecto a lo que ya usa la app) |

Para contraseñas y secretos usa [referencias a Key Vault](https://learn.microsoft.com/azure/app-service/app-service-key-vault-references) en lugar de pegarlos en claro.

### 3.3 Despliegue del certificado
- **Despliegue de código (runtime Node, 20 o superior):** el archivo `backend/certs/azure-mysql-ca-bundle.pem` debe ir dentro del paquete desplegado. La ruta relativa de `DB_SSL_CA` se resuelve desde la carpeta `backend/` del código desplegado, así que no hace falta una ruta absoluta.
- **Contenedor (Dockerfile del proyecto):** si el bundle está en `backend/certs/`, `COPY backend` ya lo incluye. `.dockerignore` no lo excluye.

### 3.4 Migraciones
El `Dockerfile` ejecuta `node scripts/migrate.js --yes && node app.js` en **cada arranque**, es decir, aplicaría migraciones pendientes automáticamente sobre la base de producción. No se modificó. Valora si en producción prefieres ejecutarlas de forma controlada (`npm run migrate`, con respaldo previo, como indica `Base de Datos/migrations/MIGRATE.md`).

## 4. Verificación tras desplegar

1. `node scripts/migrate.js --status` (consola SSH de App Service) debe mostrar `Conexión: TLS activado (rejectUnauthorized=true, CA de DB_SSL_CA)` y listar las migraciones sin cambiar nada. Repite con `--ad`.
2. En MySQL, con una conexión de la app: `SHOW SESSION STATUS LIKE 'Ssl_version';` debe devolver `TLSv1.2` o `TLSv1.3`.
3. Prueba un login y una consulta de eventos.

## 5. Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| La app no arranca: `DB_SSL_CA apunta a un archivo que no existe: …` | El PEM no está en el paquete o la ruta es incorrecta. Se resuelve desde `backend/`. |
| `El archivo de DB_SSL_CA no contiene ningún certificado en formato PEM` | Es el `.crt` DER de Microsoft sin convertir. Ver sección 2. |
| `DB_SSL tiene un valor no válido` | Usa exactamente `true` o `false`. |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `SELF_SIGNED_CERT_IN_CHAIN` en el log (solo se registra el código) | El bundle no contiene la raíz de la cadena de tu servidor, o falta `DB_SSL_CA`. |
| `ERR_TLS_CERT_ALTNAME_INVALID` | `DB_HOST` no es el FQDN del servidor (p. ej. se usó una IP). |
| `ERROR 3159 … insecure transport are prohibited` | El servidor exige TLS y `DB_SSL` está en `false`. |

## 6. Qué no se tocó
JWT, bcrypt, middleware de autenticación, roles, TSU, lógica de seguridad existente y esquema de base de datos. `docker-compose.yml` y el `Dockerfile` tampoco cambian.

## Fuentes
- [Encrypted Connectivity Using TLS/SSL – Azure Database for MySQL](https://learn.microsoft.com/en-us/azure/mysql/security/security-tls-how-to-connect)
- [Transport Layer Security (TLS) in Azure Database for MySQL](https://learn.microsoft.com/en-us/azure/mysql/security/security-tls)
- [Certificate Rotation for Azure Database for MySQL](https://learn.microsoft.com/en-us/azure/mysql/security/security-tls-root-certificate-rotation)
- [Azure CA details](https://docs.azure.cn/en-us/security/fundamentals/azure-ca-details) y [Microsoft PKI Repository](https://microsoft.com/pkiops/docs/repository.htm)
- [Configure an App Service app](https://learn.microsoft.com/azure/app-service/configure-common) y [Configure a Node.js app for App Service](https://learn.microsoft.com/azure/app-service/configure-language-nodejs)
- [mysql2: opciones SSL](https://sidorares.github.io/node-mysql2/docs/documentation/ssl)
