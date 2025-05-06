# Usa una imagen oficial de PHP con Apache
FROM php:8.2-apache

# Copia todos los archivos de tu proyecto al directorio del servidor
COPY . /var/www/html/

# Da permisos correctos
RUN chown -R www-data:www-data /var/www/html

# Expone el puerto 80 (usado por Apache)
EXPOSE 80
