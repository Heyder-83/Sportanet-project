// ===== ESTADO DE LA APLICACIÓN =====
const APP_STATE = {
    isLoggedIn: false,
    currentUser: null,
    token: localStorage.getItem('auth_token') || null
};

// ===== INICIALIZACIÓN =====
function initHeaderEvents() {
    // Verificar si el usuario ya está logueado
    checkAuthStatus();
    
    // Elementos del DOM
    const modal = document.getElementById("modal-auth");
    const btnLogin = document.getElementById("btn-login");
    const closeModal = document.getElementById("close-modal");
    const hamburger = document.getElementById("hamburger");
    const navMenu = document.getElementById("nav-menu");
    
    // Formularios
    const formLogin = document.getElementById("form-login");
    const formRegistro = document.getElementById("form-registro");
    
    // Botones de toggle
    const mostrarRegistro = document.getElementById("mostrar-registro");
    const mostrarLogin = document.getElementById("mostrar-login");

    // ===== MENÚ HAMBURGUESERO =====
    hamburger?.addEventListener("click", () => {
        hamburger.classList.toggle("active");
        navMenu.classList.toggle("active");
    });

    // Cerrar menú al hacer click en un enlace
    document.querySelectorAll(".nav-link").forEach(link => {
        link.addEventListener("click", () => {
            hamburger.classList.remove("active");
            navMenu.classList.remove("active");
        });
    });

    // ===== MODAL =====
    
    // Abrir modal login
    btnLogin?.addEventListener("click", (e) => {
        e.preventDefault();
        openModal();
    });

    // Cerrar modal
    closeModal?.addEventListener("click", () => {
        closeAuthModal();
    });

    // Cerrar modal al hacer click fuera
    window.addEventListener("click", (e) => {
        if (e.target === modal) {
            closeAuthModal();
        }
    });

    // Cerrar modal con ESC
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeAuthModal();
        }
    });

    // ===== TOGGLE ENTRE FORMULARIOS =====
    
    mostrarRegistro?.addEventListener("click", (e) => {
        e.preventDefault();
        formLogin.classList.remove("active-form");
        formRegistro.classList.add("active-form");
        document.getElementById("modal-title").textContent = "Crear Cuenta";
        clearFormMessages();
    });

    mostrarLogin?.addEventListener("click", (e) => {
        e.preventDefault();
        formRegistro.classList.remove("active-form");
        formLogin.classList.add("active-form");
        document.getElementById("modal-title").textContent = "Iniciar Sesión";
        clearFormMessages();
    });

    // ===== ENVÍO DE FORMULARIOS =====
    
    formLogin?.addEventListener("submit", async (e) => {
        e.preventDefault();
        await handleLogin();
    });

    formRegistro?.addEventListener("submit", async (e) => {
        e.preventDefault();
        await handleRegistro();
    });

    // ===== LOGOUT =====
    document.getElementById("btn-logout")?.addEventListener("click", () => {
        handleLogout();
    });
}

// ===== FUNCIONES DE VALIDACIÓN =====

/**
 * Valida un email
 * @param {string} email 
 * @returns {boolean}
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Valida una contraseña (mínimo 6 caracteres)
 * @param {string} password 
 * @returns {boolean}
 */
function isValidPassword(password) {
    return password.length >= 6;
}

/**
 * Valida el formulario de login
 * @returns {boolean}
 */
function validateLoginForm() {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    let isValid = true;

    // Limpiar errores previos
    clearErrorMessages("login");

    // Validar email
    if (!email) {
        showError("login", "email", "El correo es requerido");
        isValid = false;
    } else if (!isValidEmail(email)) {
        showError("login", "email", "Ingresa un correo válido");
        isValid = false;
    }

    // Validar contraseña
    if (!password) {
        showError("login", "password", "La contraseña es requerida");
        isValid = false;
    } else if (!isValidPassword(password)) {
        showError("login", "password", "La contraseña debe tener al menos 6 caracteres");
        isValid = false;
    }

    return isValid;
}

/**
 * Valida el formulario de registro
 * @returns {boolean}
 */
function validateRegistroForm() {
    const nombre = document.getElementById("reg-nombre").value.trim();
    const email = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-password").value;
    const passwordConfirm = document.getElementById("reg-password-confirm").value;
    let isValid = true;

    // Limpiar errores previos
    clearErrorMessages("registro");

    // Validar nombre
    if (!nombre) {
        showError("registro", "nombre", "El nombre es requerido");
        isValid = false;
    } else if (nombre.length < 3) {
        showError("registro", "nombre", "El nombre debe tener al menos 3 caracteres");
        isValid = false;
    }

    // Validar email
    if (!email) {
        showError("registro", "email", "El correo es requerido");
        isValid = false;
    } else if (!isValidEmail(email)) {
        showError("registro", "email", "Ingresa un correo válido");
        isValid = false;
    }

    // Validar contraseña
    if (!password) {
        showError("registro", "password", "La contraseña es requerida");
        isValid = false;
    } else if (!isValidPassword(password)) {
        showError("registro", "password", "La contraseña debe tener al menos 6 caracteres");
        isValid = false;
    }

    // Validar confirmación de contraseña
    if (password !== passwordConfirm) {
        showError("registro", "password_confirm", "Las contraseñas no coinciden");
        isValid = false;
    }

    return isValid;
}

// ===== FUNCIONES DE MANEJO DE ERRORES =====

/**
 * Muestra un mensaje de error en el formulario
 * @param {string} form - 'login' o 'registro'
 * @param {string} field - nombre del campo
 * @param {string} message - mensaje de error
 */
function showError(form, field, message) {
    const prefix = form === "login" ? "login" : "reg";
    const errorElement = document.getElementById(`error-${prefix}-${field}`);
    const inputElement = document.getElementById(`${prefix}-${field}`);

    if (errorElement) {
        errorElement.textContent = message;
        errorElement.classList.add("show");
    }

    if (inputElement) {
        inputElement.classList.add("error");
    }
}

/**
 * Limpia todos los mensajes de error de un formulario
 * @param {string} form - 'login' o 'registro'
 */
function clearErrorMessages(form) {
    const prefix = form === "login" ? "login" : "reg";
    document.querySelectorAll(`#error-${prefix}-email, #error-${prefix}-password, #error-${prefix}-nombre, #error-${prefix}-password_confirm`).forEach(el => {
        el.textContent = "";
        el.classList.remove("show");
    });

    document.querySelectorAll(`#${prefix}-email, #${prefix}-password, #${prefix}-nombre, #${prefix}-password_confirm`).forEach(el => {
        el.classList.remove("error");
    });
}

/**
 * Limpia todos los mensajes de los formularios
 */
function clearFormMessages() {
    document.getElementById("login-message").textContent = "";
    document.getElementById("login-message").classList.remove("show", "success", "error");
    
    document.getElementById("registro-message").textContent = "";
    document.getElementById("registro-message").classList.remove("show", "success", "error");

    clearErrorMessages("login");
    clearErrorMessages("registro");
}

// ===== FUNCIONES DE FORMULARIO =====

/**
 * Maneja el envío del formulario de login
 */
async function handleLogin() {
    if (!validateLoginForm()) {
        return;
    }

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const messageEl = document.getElementById("login-message");
    const btnSubmit = document.getElementById("btn-submit-login");

    try {
        // Mostrar estado de carga
        btnSubmit.disabled = true;
        btnSubmit.textContent = "Cargando...";

        // 🔗 CONECTAR CON TU BACKEND AQUÍ
        const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok) {
            // Login exitoso
            showMessage("login", "success", "¡Sesión iniciada exitosamente!");
            
            // Guardar token
            if (data.token) {
                localStorage.setItem("auth_token", data.token);
                APP_STATE.token = data.token;
            }

            // Guardar datos del usuario
            if (data.user) {
                localStorage.setItem("user", JSON.stringify(data.user));
                APP_STATE.currentUser = data.user;
                APP_STATE.isLoggedIn = true;
            }

            // Cerrar modal después de 1.5 segundos
            setTimeout(() => {
                closeAuthModal();
                updateUIAfterLogin();
                location.reload(); // Recarga la página para aplicar cambios
            }, 1500);
        } else {
            // Error del servidor
            showMessage("login", "error", data.message || "Error al iniciar sesión. Verifica tus credenciales.");
        }
    } catch (error) {
        console.error("Error al conectar con el servidor:", error);
        showMessage("login", "error", "Error de conexión. Intenta más tarde.");
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = "Ingresar";
    }
}

/**
 * Maneja el envío del formulario de registro
 */
async function handleRegistro() {
    if (!validateRegistroForm()) {
        return;
    }

    const nombre = document.getElementById("reg-nombre").value.trim();
    const email = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-password").value;
    const messageEl = document.getElementById("registro-message");
    const btnSubmit = document.getElementById("btn-submit-registro");

    try {
        // Mostrar estado de carga
        btnSubmit.disabled = true;
        btnSubmit.textContent = "Creando cuenta...";

        // 🔗 CONECTAR CON TU BACKEND AQUÍ
        const response = await fetch("/api/auth/register", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ 
                nombre, 
                email, 
                password 
            })
        });

        const data = await response.json();

        if (response.ok) {
            // Registro exitoso
            showMessage("registro", "success", "¡Cuenta creada exitosamente! Iniciando sesión...");
            
            // Guardar token
            if (data.token) {
                localStorage.setItem("auth_token", data.token);
                APP_STATE.token = data.token;
            }

            // Guardar datos del usuario
            if (data.user) {
                localStorage.setItem("user", JSON.stringify(data.user));
                APP_STATE.currentUser = data.user;
                APP_STATE.isLoggedIn = true;
            }

            // Cerrar modal después de 1.5 segundos
            setTimeout(() => {
                closeAuthModal();
                updateUIAfterLogin();
                location.reload();
            }, 1500);
        } else {
            // Error del servidor
            showMessage("registro", "error", data.message || "Error al crear la cuenta. Intenta con otro correo.");
        }
    } catch (error) {
        console.error("Error al conectar con el servidor:", error);
        showMessage("registro", "error", "Error de conexión. Intenta más tarde.");
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = "Crear Cuenta";
    }
}

/**
 * Maneja el logout
 */
function handleLogout() {
    if (confirm("¿Estás seguro de que deseas cerrar sesión?")) {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("user");
        APP_STATE.isLoggedIn = false;
        APP_STATE.currentUser = null;
        APP_STATE.token = null;
        
        updateUIAfterLogout();
        location.reload();
    }
}

// ===== FUNCIONES DE UI =====

/**
 * Abre el modal de autenticación
 */
function openModal() {
    const modal = document.getElementById("modal-auth");
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
}

/**
 * Cierra el modal de autenticación
 */
function closeAuthModal() {
    const modal = document.getElementById("modal-auth");
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "auto";
    clearFormMessages();
}

/**
 * Muestra un mensaje en el formulario
 * @param {string} form - 'login' o 'registro'
 * @param {string} type - 'success' o 'error'
 * @param {string} message - mensaje a mostrar
 */
function showMessage(form, type, message) {
    const messageEl = document.getElementById(`${form}-message`);
    messageEl.textContent = message;
    messageEl.classList.add("show", type);
    
    // Auto-limpiar mensajes de error después de 5 segundos
    if (type === "error") {
        setTimeout(() => {
            messageEl.classList.remove("show", type);
            messageEl.textContent = "";
        }, 5000);
    }
}

/**
 * Actualiza la UI después del login
 */
function updateUIAfterLogin() {
    const user = APP_STATE.currentUser || JSON.parse(localStorage.getItem("user") || "{}");
    const btnLogin = document.getElementById("btn-login");
    const userMenuContainer = document.getElementById("user-menu-container");
    const userName = document.getElementById("user-name");

    if (btnLogin) btnLogin.style.display = "none";
    if (userMenuContainer) {
        userMenuContainer.style.display = "flex";
        if (userName) userName.textContent = `Hola, ${user.nombre || user.name || "Usuario"}`;
    }
}

/**
 * Actualiza la UI después del logout
 */
function updateUIAfterLogout() {
    const btnLogin = document.getElementById("btn-login");
    const userMenuContainer = document.getElementById("user-menu-container");

    if (btnLogin) btnLogin.style.display = "block";
    if (userMenuContainer) userMenuContainer.style.display = "none";
}

/**
 * Verifica el estado de autenticación al cargar la página
 */
function checkAuthStatus() {
    const token = localStorage.getItem("auth_token");
    const user = localStorage.getItem("user");

    if (token && user) {
        APP_STATE.isLoggedIn = true;
        APP_STATE.token = token;
        APP_STATE.currentUser = JSON.parse(user);
        updateUIAfterLogin();
    }
}

