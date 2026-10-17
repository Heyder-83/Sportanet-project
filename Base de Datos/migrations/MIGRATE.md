# Migraciones de Sportanet

Cada archivo `.sql` de esta carpeta es **un cambio** de estructura de la base de datos.

## Convención

- Nombre: `NNN_descripcion_corta.sql` (por ejemplo `002_users_avatar.sql`).
- `NNN` es la versión: se guarda en la tabla `schema_migrations` y define el orden. No repitas versiones.
- **Un cambio por archivo.** MySQL no revierte `ALTER`/`CREATE`/`DROP`: si un archivo con varias sentencias falla a mitad, las anteriores ya quedaron aplicadas.
- No hace falta que el archivo escriba en `schema_migrations`: `scripts/migrate.js` registra la versión al terminar bien.
- Un archivo ya aplicado en `sportanet_v1` **no se edita**; los cambios nuevos van en un archivo nuevo.

## Antes de numerar la primera migración

Mira qué versiones hay registradas en la BD principal:

```sql
SELECT version, description, applied_at FROM schema_migrations;
```

Si una versión nueva coincide con una ya registrada, `migrate.js` la considera aplicada y la omite. Numera por encima de la más alta.

## Flujo (desde `backend/`)

```text
npm run db:reset:test      recrea sportanet_test desde schema.sql y aplica todas las migraciones
npm run testsql            tests contra sportanet_test
npm test                   tests unitarios (sin BD)
npm run migrate -- --dry-run   qué se aplicaría en la BD de backend/.env (sportanet_v1), sin cambiar nada
npm run migrate            aplica los pendientes (pide confirmación escribiendo el nombre de la BD)
```

Antes de aplicar en `sportanet_v1`: respaldo y autorización (PROJECT_LOGIC §14). En PowerShell no uses `>` para respaldar (guarda UTF-16 y corrompe el dump):

```powershell
mysqldump -h localhost -P 3306 -u root -p --result-file=respaldo.sql sportanet_v1
```

Después de migrar `sportanet_v1`, regenera `schema.sql` (`mysqldump --no-data --result-file=...`) y súbelo junto con la migración.
