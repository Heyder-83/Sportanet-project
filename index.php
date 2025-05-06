<?php
// inicio.php
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sportanet - Bookings</title>
    <link rel="stylesheet" href="CSS/style.css">
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
</head>
<body>
    <header>
        <nav class="navbar">
            <div class="logo">Sportanet</div>
            <ul class="nav-links">
                <li><a href="inicio.php">Inicio</a></li>
                <li><a href="#eventos">Eventos</a></li>
                <li><a href="#inscripcion">Inscripción</a></li>
                <li><a href="#contacto">Contacto</a></li>
            </ul>
        </nav>
        <section class="hero" id="inicio">
            <div class="hero-text">
                <h1>Inscríbete a tu próximo reto deportivo</h1>
                <p>Explora, participa y vive el deporte al máximo.</p>
                <a href="#eventos" class="btn">Ver Eventos</a>
            </div>
        </section>
    </header>

    <main>
        <section class="eventos" id="eventos">
            <h2>Próximos Eventos</h2>
            <div class="eventos-grid">
                <div class="evento">
                    <h3>Torneo Tenis</h3>
                    <p>15 de junio de 2025 · Club Campestre</p>
                    <a href="#inscripcion" class="btn btn-secundario">Inscribirse</a>
                </div>
                <div class="evento">
                    <h3>Torneo de Golf</h3>
                    <p>22 de junio de 2025 · Estadio Azul</p>
                    <a href="#inscripcion" class="btn btn-secundario">Inscribirse</a>
                </div>
                <div class="evento">
                    <h3>Carrera de Ciclismo</h3>
                    <p>27 de junio de 2025 · Club Campestre</p>
                    <a href="#inscripcion" class="btn btn-secundario">Inscribirse</a>
                </div>
            </div>
        </section>

        <section class="inscripcion" id="inscripcion">
            <h2>Formulario de Inscripción</h2>
            <form action="#" method="post">
                <input type="text" name="nombre" placeholder="Nombre completo" required>
                <input type="email" name="email" placeholder="Correo electrónico" required>
                <select name="evento" required>
                    <option value="">Selecciona un evento</option>
                    <option value="maraton">Torneo Tenis</option>
                    <option value="futbol">Torneo de Golf</option>
                    <option value="ciclismo">Carrera de Ciclismo</option>
                </select>
                <button type="submit" class="btn">Enviar inscripción</button>
            </form>
        </section>

        <section class="contacto" id="contacto">
            <h2>Contáctanos</h2>
            <p>¿Tienes preguntas? Escríbenos a sportanet@gmail.com</p>
        </section>
    </main>

    <footer>
        <p>&copy; 2025 Sportanet - Todos los derechos reservados.</p>
    </footer>
</body>
</html>