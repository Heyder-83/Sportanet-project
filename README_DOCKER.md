# Sportanet - Guía de arranque con Docker

Esta guía permite levantar el backend y la base de datos de Sportanet en cualquier PC con Docker instalado, sin depender de una configuración local previa.

## Requisitos

- Docker Desktop o Docker Engine
- Docker Compose
- Git

## 1. Clonar el proyecto

```bash
git clone <URL_DEL_REPOSITORIO>
cd Sportanet-project
```

## 2. Configurar variables de entorno

Copia el archivo de ejemplo para el backend y ajusta los valores si es necesario:

```bash
copy backend\.env.example backend\.env
```

Contenido recomendado para Docker:

```env
DB_HOST=db
DB_PORT=3306
DB_USER=sportanet
DB_PASSWORD=sportanet
DB_NAME=sportanet_v1
PORT=5000
JWT_SECRET=change_this_to_a_random_string_of_at_least_32_characters
```

> Si el proyecto se despliega en un entorno externo o en producción, usa un JWT_SECRET real y aleatorio, con al menos 32 caracteres.

## 3. Levantar el stack

Desde la raíz del proyecto:

```bash
docker compose up --build
```

Esto iniciará:

- MySQL en el puerto 3307 del host
- Backend en el puerto 5000 del host

## 4. Verificar que funciona

Abre en el navegador o consulta desde terminal:

```bash
curl http://localhost:5000/api/health/metrics
```

Debe devolver algo como:

```json
{"acceptedRequests":0,"blockedRequests":0,"totalRequests":0,"requestsPerWindow":0,"windowMs":60000}
```

## 5. Servicios disponibles

- Backend API: http://localhost:5000
- MySQL: localhost:3307
- Base de datos interna: sportanet_v1

## 6. Detener el stack

```bash
docker compose down
```

## 7. Reiniciar desde cero

Si quieres borrar la base de datos local y volver a crear el esquema:

```bash
docker compose down -v
docker compose up --build
```

## 8. Datos de conexión internos dentro de Docker

El backend se conecta a la base de datos usando:

```env
DB_HOST=db
DB_PORT=3306
DB_USER=sportanet
DB_PASSWORD=sportanet
DB_NAME=sportanet_v1
```

Eso es lo que usa el contenedor backend para hablar con el contenedor MySQL dentro de la red Docker.

## 9. Nota importante

El proyecto incluye migraciones SQL en `Base de Datos/migrations`. Al iniciar el backend, estas migraciones se ejecutan automáticamente para dejar la base lista.

Si quieres volver a ejecutar la base desde cero para pruebas, usa:

```bash
docker compose down -v
```

## 10. Solución de problemas

### Error: puerto 3306 ocupado en el host

El proyecto usa 3307 para MySQL en el host para evitar conflictos con instalaciones locales de MySQL.

### Error: Docker no encuentra la API

Asegúrate de tener Docker Desktop ejecutándose o Docker Engine activo.

### Error de conexión a la base de datos

Verifica que el contenedor `db` esté en estado saludable:

```bash
docker compose ps
```

Y revisa los logs:

```bash
docker compose logs db
docker compose logs backend
```

## 11. Comandos útiles

```bash
docker compose up --build
docker compose down
docker compose logs -f
docker compose ps
```
