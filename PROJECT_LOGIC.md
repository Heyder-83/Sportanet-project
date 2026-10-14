# Sportanet — Lógica funcional del proyecto

## 1. Descripción general

Sportanet es una plataforma web para la publicación, promoción, administración e inscripción en eventos deportivos. Su propósito es conectar a organizadores con participantes mediante un sistema centralizado que permita consultar eventos, conocer sus condiciones, registrarse y gestionar la participación.

La plataforma se desarrollará de manera incremental, priorizando las funcionalidades esenciales y manteniendo la arquitectura tecnológica existente.

## 2. Tecnologías del proyecto

- **Frontend:** HTML, CSS y JavaScript.
- **Backend:** Node.js y Express.
- **Base de datos:** MySQL.
- **Autenticación:** JWT.
- **Seguridad de contraseñas:** bcrypt.
- **Control de versiones:** Git y GitHub.

No se debe cambiar de tecnología sin autorización expresa.

La base de datos utilizada conserva el nombre `sportanet_v1`, aunque su estructura fue actualizada al esquema v2. El nombre de la base de datos no determina por sí solo la versión de su estructura.

## 3. Tipos de usuario y permisos

### 3.1. Participante

El participante puede:

- Registrarse e iniciar sesión.
- Consultar los eventos publicados.
- Consultar los detalles, fechas, horarios, ubicación, precio y disponibilidad de un evento.
- Inscribirse en eventos que admitan inscripciones.
- Consultar sus propias inscripciones y sus estados.
- Cancelar una inscripción cuando las reglas del evento lo permitan.
- Consultar el historial de sus participaciones.
- Acceder a la información de su cuenta y actualizarla.
- Solicitar la eliminación de su cuenta, respetando las reglas de integridad e historial.

Un participante no puede crear, modificar ni eliminar eventos de otros usuarios.

### 3.2. Organizador

El organizador puede:

- Crear eventos deportivos.
- Editar y administrar los eventos que le pertenecen.
- Guardar eventos como borradores.
- Publicar, completar o cancelar eventos según las reglas del sistema.
- Definir fechas, horarios, ubicación, capacidad, precio y condiciones de participación.
- Consultar las inscripciones de sus propios eventos.
- Consultar el número de participantes y los cupos disponibles.
- Gestionar las confirmaciones de inscripción según el procedimiento establecido.

Un organizador no puede modificar ni eliminar eventos de otros organizadores, salvo que disponga de permisos administrativos.

### 3.3. Administrador

El administrador dispone de permisos de supervisión y gestión de la plataforma, incluyendo la administración de usuarios y la intervención sobre eventos cuando sea necesario.

Los privilegios administrativos nunca deben asignarse mediante el formulario público de registro. Deben concederse mediante un procedimiento autorizado.

### 3.4. Seguridad de los roles

Los permisos deben comprobarse en el backend. Ocultar botones en el frontend no constituye un mecanismo de autorización.

El backend debe verificar la identidad del usuario mediante un JWT válido y comprobar sus permisos antes de ejecutar cada operación protegida.

El identificador de usuario recibido desde el cliente no debe utilizarse como prueba de identidad.

## 4. Registro, inicio de sesión y cuentas

El registro debe validar los datos obligatorios, comprobar que el correo electrónico no esté registrado y aplicar las restricciones de unicidad definidas en la base de datos.

Las contraseñas deben almacenarse mediante bcrypt, nunca en texto plano.

El inicio de sesión debe verificar las credenciales y emitir un JWT firmado con un secreto configurado mediante variables de entorno.

El backend debe rechazar tokens inválidos, expirados o ausentes cuando una ruta requiera autenticación.

Las respuestas de la API no deben exponer contraseñas, hashes, secretos, tokens innecesarios ni detalles internos de la base de datos.

Las operaciones de consulta, modificación y eliminación de cuentas deben respetar los permisos del usuario autenticado.

## 5. Gestión de eventos deportivos

### 5.1. Información de un evento

Cada evento debe disponer, según las capacidades del esquema vigente, de los siguientes datos:

- Identificador único.
- Nombre o título.
- Descripción.
- Deporte o categoría deportiva.
- Organizador responsable.
- Fecha y hora de inicio.
- Fecha y hora de finalización.
- Zona horaria.
- Ubicación o recinto deportivo.
- Ciudad y departamento, cuando corresponda.
- Capacidad máxima de participantes.
- Precio de inscripción y moneda.
- Fecha límite de inscripción, si aplica.
- Imagen promocional opcional.
- Estado del evento.
- Fechas de creación y última actualización.

Antes de implementar cualquier campo, se debe verificar si existe en el esquema actual. Si falta un campo necesario, se debe proponer el cambio de base de datos correspondiente y esperar autorización antes de aplicarlo.

No se deben inventar columnas ni asumir que el esquema actual coincide con esta especificación funcional.

### 5.2. Estados de los eventos

Los estados previstos son:

- **Draft:** evento guardado como borrador y no visible públicamente.
- **Published:** evento publicado y consultable por los participantes.
- **Completed:** evento finalizado; deja de aparecer entre los eventos activos, pero permanece disponible para el historial.
- **Canceled:** evento cancelado; debe mostrarse su estado y aplicarse las reglas correspondientes a sus inscripciones.

Los cambios de estado deben validarse en el backend. Un participante no puede cambiar el estado de un evento.

Un evento solo debe considerarse finalizado cuando se cumplan las reglas definidas para su fecha y estado. No se debe eliminar automáticamente la información histórica.

### 5.3. Ubicación y recintos

La ubicación es un dato esencial de los eventos presenciales.

Cuando el esquema lo permita, se debe asociar el evento a un recinto o sede reutilizable. La información puede incluir nombre del recinto, dirección, ciudad, departamento y coordenadas opcionales.

Los eventos virtuales o híbridos deben poder distinguirse de los presenciales si esa funcionalidad está habilitada.

No se deben duplicar innecesariamente los datos de un club, organizador y recinto. Cada entidad debe representar un concepto diferente.

## 6. Inscripciones

El sistema debe permitir que un participante se inscriba en un evento publicado y habilitado para inscripciones.

Antes de aceptar una inscripción, el backend debe verificar:

1. Que el usuario esté autenticado y tenga permisos de participante.
2. Que el evento exista.
3. Que el evento admita inscripciones.
4. Que el plazo de inscripción no haya terminado.
5. Que exista disponibilidad de cupos, si el evento tiene capacidad limitada.
6. Que el participante no tenga ya una inscripción activa o equivalente.
7. Que se cumplan las condiciones económicas del evento, cuando correspondan.

Las restricciones críticas deben verificarse en el backend y en la base de datos, no únicamente en el navegador.

Cuando varios usuarios intenten ocupar los últimos cupos simultáneamente, el sistema debe evitar sobrepasar la capacidad máxima mediante operaciones atómicas o transacciones.

No se debe informar que una inscripción fue registrada hasta que la base de datos confirme la operación.

## 7. Estados de inscripción y confirmación

Las inscripciones deben disponer de estados coherentes con el esquema implementado, como:

- **Pending:** inscripción pendiente de completar las validaciones o confirmaciones necesarias.
- **Confirmed:** participación confirmada.
- **Canceled:** inscripción cancelada.

Si se implementa una lista de espera, debe añadirse como funcionalidad explícita y con reglas propias.

La confirmación debe representar un estado real almacenado en MySQL. El frontend no puede confirmar una inscripción únicamente mostrando un mensaje de éxito.

La respuesta de la API debe indicar si la inscripción fue creada, quedó pendiente, fue confirmada o fue rechazada, según el resultado real de la operación.

El organizador solo puede consultar y administrar inscripciones de los eventos que le corresponden, respetando sus permisos.

## 8. Pagos

Sportanet contempla eventos gratuitos y eventos con costo de inscripción.

La información económica debe incluir el precio y la moneda del evento, además del estado de pago de la inscripción cuando corresponda.

En la primera implementación, el sistema puede almacenar estados de pago sin procesar transacciones reales.

No se debe marcar un pago como completado únicamente porque el frontend envíe una solicitud o muestre una confirmación.

La integración con una pasarela de pago, las devoluciones y las notificaciones verificadas de pago constituyen una fase independiente que requiere autorización y diseño específico.

## 9. Calendario de eventos

Sportanet debe permitir consultar los eventos publicados mediante una vista de calendario, organizados por fecha.

El calendario debe mostrar la información esencial para identificar cada evento y permitir acceder a sus detalles.

Como funcionalidad complementaria, el sistema debe permitir generar un archivo de calendario compatible con aplicaciones habituales mediante el formato `.ics`.

Las fechas y horas deben respetar la zona horaria del evento para evitar desplazamientos incorrectos.

La generación del calendario debe basarse en los datos reales almacenados en la base de datos.

## 10. Historial de participación

Los eventos completados o cancelados deben conservar la información necesaria para consultar el historial de los participantes y organizadores.

La eliminación de una cuenta o un evento no debe destruir accidentalmente los registros históricos ni dejar relaciones inválidas.

Antes de implementar eliminaciones, se deben verificar las claves foráneas y definir una política de conservación de datos.

Cuando corresponda, se deben preferir mecanismos de cancelación o desactivación frente al borrado físico de información necesaria para el historial.

## 11. API y comunicación con el frontend

El frontend debe obtener la información de eventos e inscripciones mediante la API del backend.

Las rutas deben seguir convenciones coherentes, utilizar métodos HTTP apropiados y devolver respuestas JSON consistentes.

Como estructura funcional de referencia:

- `/api/auth`: registro e inicio de sesión.
- `/api/users`: operaciones autorizadas de cuentas.
- `/api/events`: consulta y administración de eventos.
- `/api/registrations`: inscripciones y sus estados.

Estas rutas son una propuesta de organización funcional. Antes de implementarlas, se deben revisar las rutas existentes y evitar duplicarlas o romper su compatibilidad.

Los errores deben manejarse con códigos HTTP apropiados y mensajes comprensibles, sin exponer detalles internos.

## 12. Validaciones e integridad

Todas las entradas deben validarse en el servidor.

Las validaciones deben cubrir, según la operación:

- Campos obligatorios.
- Tipos y formatos de datos.
- Unicidad de correo y demás identificadores que lo requieran.
- Fechas y horarios coherentes.
- Capacidad y disponibilidad.
- Precios no negativos.
- Estados permitidos.
- Propiedad de los eventos.
- Permisos de acceso.
- Inscripciones duplicadas.
- Integridad de las relaciones entre tablas.

Las reglas que afecten a la integridad de los datos deben reforzarse con restricciones de la base de datos cuando sea posible.

## 13. Seguridad y configuración

Las credenciales de MySQL y los secretos JWT deben almacenarse en variables de entorno y mantenerse fuera del repositorio.

No se deben incluir archivos `.env` con secretos reales en ZIP compartidos, commits ni entregas públicas.

La configuración debe contemplar el puerto del servidor, las credenciales de conexión y los orígenes autorizados para CORS.

Los errores internos deben registrarse de forma controlada y no devolverse directamente al usuario.

Las rutas protegidas deben probarse con usuarios de distintos roles y con solicitudes no autorizadas.

## 14. Principios de desarrollo

El proyecto debe desarrollarse de forma incremental.

1. Conservar las funcionalidades que ya funcionan.
2. Implementar una funcionalidad por tarea.
3. Revisar el código y el esquema real antes de modificarlos.
4. Evitar reconstrucciones innecesarias.
5. No ejecutar migraciones sin autorización y respaldo.
6. No cambiar de tecnología sin autorización.
7. Probar cada cambio antes de continuar.
8. Documentar archivos modificados, resultados y errores pendientes.
9. No declarar una prueba como exitosa si no se ejecutó.
10. Mantener actualizado `AI_CONTEXT.md` al finalizar cada tarea.

La prioridad es disponer de un sistema funcional y seguro, no implementar todas las funcionalidades avanzadas simultáneamente.

## 15. Orden de implementación

El orden recomendado es:

1. Auditar y validar el estado real del proyecto y de MySQL.
2. Proteger autenticación y operaciones de usuarios.
3. Implementar consultas de eventos.
4. Implementar creación, edición y administración de eventos.
5. Implementar inscripciones, estados y control de cupos.
6. Añadir confirmaciones y calendario.
7. Conectar las vistas del frontend con la API.
8. Implementar el modelo de pagos y, posteriormente, una pasarela real si se autoriza.
9. Ejecutar pruebas de integración, seguridad e integridad.
10. Preparar el despliegue y la configuración de producción.

## 16. Criterio de finalización

Sportanet se considerará funcional cuando los participantes puedan consultar eventos reales, inscribirse bajo las reglas establecidas, conocer el estado de su inscripción y consultar su historial; cuando los organizadores puedan gestionar sus propios eventos e inscripciones; y cuando las operaciones estén protegidas, los datos se almacenen correctamente en MySQL y el calendario refleje información real.

Las funcionalidades deberán estar implementadas y verificadas antes de considerarse terminadas. Las funciones futuras o pendientes deben identificarse claramente, sin presentarlas como funcionalidades ya disponibles.