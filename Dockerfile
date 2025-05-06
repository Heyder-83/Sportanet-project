FROM php:8.2-apache

# Copia el código fuente
COPY . /var/www/html/

# Permisos
RUN chown -R www-data:www-data /var/www/html

# Habilita mod_rewrite
RUN a2enmod rewrite

# Permite .htaccess
RUN sed -i 's/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf

# Expone el puerto
EXPOSE 80
