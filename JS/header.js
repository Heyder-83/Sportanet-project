function initHeaderEvents() {

    const modal = document.getElementById("modal-login");
    const btnLogin = document.getElementById("btn-login");
    const closeModal = document.getElementById("close-modal");

    const formLogin = document.getElementById("form-login");
    const formRegistro = document.getElementById("form-registro");

    document.getElementById("mostrar-registro").onclick = (e) => {
        e.preventDefault();
        formLogin.style.display = "none";
        formRegistro.style.display = "block";
    };

    document.getElementById("mostrar-login").onclick = (e) => {
        e.preventDefault();
        formLogin.style.display = "block";
        formRegistro.style.display = "none";
    };

    btnLogin.onclick = (e) => {
        e.preventDefault();
        modal.classList.add("show");
    };

    closeModal.onclick = () => modal.classList.remove("show");

    window.onclick = e => {
        if (e.target === modal) modal.classList.remove("show");
    };
}
