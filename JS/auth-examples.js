/**
 * ===== EJEMPLOS DE USO DEL SISTEMA DE AUTENTICACIÓN =====
 * 
 * Este archivo contiene ejemplos prácticos de cómo usar el sistema
 * de login/registro que ya está implementado en header.js
 */

// ===== 1. OBTENER EL ESTADO DE AUTENTICACIÓN =====

/**
 * Verificar si el usuario está logueado
 */
function isUserLoggedIn() {
    const token = localStorage.getItem('auth_token');
    return !!token; // Devuelve true/false
}

/**
 * Obtener los datos del usuario actual
 */
function getCurrentUser() {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
}

/**
 * Obtener el token de autenticación
 */
// Obtener token desde localStorage
function getAuthToken() {
    return localStorage.getItem('auth_token');
}

// Ejemplo de uso:
if (isUserLoggedIn()) {
    const user = getCurrentUser();
    console.log(`Bienvenido, ${user.nombre}`);
} else {
    console.log('Usuario no autenticado');
}

// ===== 2. HACER PETICIONES AUTENTICADAS AL BACKEND =====

/**
 * Función auxiliar para hacer peticiones con autenticación
 * @param {string} url - URL del endpoint
 * @param {object} options - Opciones de fetch
 * @returns {Promise}
 */
async function authenticatedFetch(url, options = {}) {
    const token = getAuthToken();
    
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    // Agregar token en header Authorization si está disponible
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
        ...options,
        headers
    });

    // Si el token expiró (401), limpiar sesión
    if (response.status === 401) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user');
        // Redirigir a login o recargar página
        location.reload();
    }

    return response;
}

// Ejemplo de uso:
async function fetchUserProfile() {
    try {
        const response = await authenticatedFetch('/api/user/profile');
        const data = await response.json();
        console.log('Perfil del usuario:', data);
    } catch (error) {
        console.error('Error al obtener perfil:', error);
    }
}

// ===== 3. VALIDACIONES EN EL CLIENTE =====

/**
 * Validar formato de email
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Validar fortaleza de contraseña
 */
function getPasswordStrength(password) {
    let strength = 0;
    
    if (password.length >= 6) strength++;
    if (password.length >= 12) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[!@#$%^&*]/.test(password)) strength++;

    return {
        score: strength,
        label: ['Muy débil', 'Débil', 'Normal', 'Fuerte', 'Muy fuerte', 'Excelente'][strength]
    };
}

// Ejemplo de uso:
const password = "MiContraseña123!";
const strength = getPasswordStrength(password);
console.log(`Fortaleza: ${strength.label} (${strength.score}/5)`);

// ===== 4. PROTEGER RUTAS =====

/**
 * Redirigir a login si no está autenticado
 */
function requireAuth() {
    if (!isUserLoggedIn()) {
        // Abrir el modal de login
        const modal = document.getElementById('modal-auth');
        if (modal) {
            modal.classList.add('show');
        }
        return false;
    }
    return true;
}

/**
 * Proteger rutas - mostrar contenido solo si está autenticado
 */
function protectContent(selector) {
    const element = document.querySelector(selector);
    if (element) {
        if (isUserLoggedIn()) {
            element.style.display = 'block';
        } else {
            element.style.display = 'none';
        }
    }
}

// Ejemplo de uso:
protectContent('.contenido-protegido'); // Mostrar solo si está logueado

// ===== 5. INTERCEPTAR ENVÍO DE FORMULARIOS =====

/**
 * Ejecutar algo solo si el usuario está autenticado
 */
document.addEventListener('DOMContentLoaded', () => {
    const formularioPrivado = document.getElementById('form-privado');
    
    if (formularioPrivado) {
        formularioPrivado.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // Verificar autenticación
            if (!requireAuth()) {
                return;
            }

            // Proceder con el envío
            const formData = new FormData(formularioPrivado);
            const token = getAuthToken();

            try {
                const response = await fetch('/api/submit-form', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(Object.fromEntries(formData))
                });

                if (response.ok) {
                    console.log('Formulario enviado exitosamente');
                }
            } catch (error) {
                console.error('Error al enviar formulario:', error);
            }
        });
    }
});

// ===== 6. ACTUALIZAR INTERFAZ DESPUÉS DE LOGIN =====

/**
 * Personalizar la interfaz basada en el usuario logueado
 */
function customizeUIForLoggedUser() {
    const user = getCurrentUser();
    
    if (!user) return;

    // Mostrar nombre del usuario
    const userNameEl = document.getElementById('user-name');
    if (userNameEl) {
        userNameEl.textContent = `Hola, ${user.nombre}`;
    }

    // Mostrar/ocultar elementos según el rol
    if (user.rol === 'admin') {
        document.querySelectorAll('[data-role="admin"]').forEach(el => {
            el.style.display = 'block';
        });
    }

    // Personalizar contenido
    document.querySelectorAll('[data-user-dependent]').forEach(el => {
        el.textContent = el.dataset.userMessage || `Hola, ${user.nombre}`;
    });
}

// Llamar al cargar la página
customizeUIForLoggedUser();

// Escuchar cambios en el storage (actualización desde otra pestaña)
window.addEventListener('storage', (e) => {
    if (e.key === 'auth_token' || e.key === 'user') {
        location.reload(); // Recargar si la sesión cambió
    }
});

// ===== 7. LOGOUT PROGRAMÁTICO =====

/**
 * Cerrar sesión sin confirmación
 */
function logout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    location.href = 'index.html'; // Redirigir a inicio
}

/**
 * Cerrar sesión con confirmación
 */
function logoutWithConfirm() {
    if (confirm('¿Deseas cerrar sesión?')) {
        logout();
    }
}

// ===== 8. MANEJO DE ERRORES DE AUTENTICACIÓN =====

/**
 * Mostrar mensaje de error amigable
 */
function showAuthError(errorCode) {
    const errors = {
        'INVALID_EMAIL': 'Por favor, ingresa un email válido',
        'PASSWORD_TOO_SHORT': 'La contraseña debe tener al menos 6 caracteres',
        'PASSWORDS_DONT_MATCH': 'Las contraseñas no coinciden',
        'EMAIL_IN_USE': 'Este email ya está registrado',
        'INVALID_CREDENTIALS': 'Email o contraseña incorrectos',
        'SERVER_ERROR': 'Error en el servidor. Intenta más tarde',
        'NETWORK_ERROR': 'Error de conexión. Verifica tu internet'
    };

    const message = errors[errorCode] || 'Ha ocurrido un error';
    alert(message); // O mostrar en un elemento de la UI
}

// ===== 9. GUARDAR DATOS ADICIONALES =====

/**
 * Guardar preferencias del usuario localmente
 */
function saveUserPreferences(preferences) {
    const userId = getCurrentUser()?.id;
    if (!userId) return;

    const key = `prefs_${userId}`;
    localStorage.setItem(key, JSON.stringify(preferences));
}

/**
 * Obtener preferencias del usuario
 */
function getUserPreferences() {
    const userId = getCurrentUser()?.id;
    if (!userId) return null;

    const key = `prefs_${userId}`;
    const prefs = localStorage.getItem(key);
    return prefs ? JSON.parse(prefs) : null;
}

// Ejemplo de uso:
saveUserPreferences({
    tema: 'oscuro',
    idioma: 'es',
    notificaciones: true
});

// ===== 10. DEBUGGING =====

/**
 * Ver estado actual de autenticación (en consola)
 */
function debugAuthStatus() {
    console.log({
        isLoggedIn: isUserLoggedIn(),
        token: getAuthToken() ? 'Presente' : 'No presente',
        user: getCurrentUser(),
        preferences: getUserPreferences(),
        app_state: typeof APP_STATE !== 'undefined' ? APP_STATE : 'No definido'
    });
}

// Ejecutar en consola: debugAuthStatus()

// ===== EJEMPLOS COMPLETOS =====

/**
 * EJEMPLO 1: Cargar eventos (solo para usuarios autenticados)
 */
async function loadUserEvents() {
    if (!requireAuth()) {
        console.log('Debes iniciar sesión para ver tus eventos');
        return;
    }

    const response = await authenticatedFetch('/api/user/events');
    const data = await response.json();
    console.log('Tus eventos:', data.events);
}

/**
 * EJEMPLO 2: Inscribirse en un evento
 */
async function enrollEvent(eventId) {
    if (!requireAuth()) {
        return;
    }

    try {
        const response = await authenticatedFetch(`/api/events/${eventId}/enroll`, {
            method: 'POST',
            body: JSON.stringify({ eventId })
        });

        const data = await response.json();
        
        if (response.ok) {
            alert('¡Te has inscrito al evento!');
        } else {
            showAuthError('SERVER_ERROR');
        }
    } catch (error) {
        showAuthError('NETWORK_ERROR');
    }
}

/**
 * EJEMPLO 3: Mostrar botón personalizado basado en autenticación
 */
function renderAuthButton() {
    const container = document.getElementById('auth-button-container');
    
    if (!container) return;

    if (isUserLoggedIn()) {
        const user = getCurrentUser();
        container.innerHTML = `
            <div class="user-welcome">
                <p>Bienvenido, ${user.nombre}</p>
                <button onclick="logout()">Cerrar sesión</button>
            </div>
        `;
    } else {
        container.innerHTML = `
            <button onclick="openModal()">Iniciar sesión</button>
        `;
    }
}

// Llamar al cargar
renderAuthButton();
