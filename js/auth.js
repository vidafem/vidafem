// js/auth.js - Control de Acceso (Versión Unificada)

// Verificamos si estamos en la página que tiene el formulario Login
const loginForm = document.getElementById('loginForm');

async function firstLoginApiCall_(payload) {
    const body = Object.assign({}, payload || {});
    if (body.action !== "login" && !body.session_token) {
        try {
            const raw = sessionStorage.getItem("vidafem_session");
            const s = raw ? JSON.parse(raw) : null;
            if (s && s.session_token) body.session_token = s.session_token;
        } catch (e) {}
    }
    const r = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify(body)
    });
    return r.json();
}

async function handleFirstLoginFlow(sessionData) {
    const role = sessionData.first_login_role || sessionData.role;
    const userId = sessionData.first_login_id ||
        (sessionData.data && (sessionData.data.usuario || sessionData.data.id_paciente));

    if (!role || !userId) return true;

    const wantsChange = window.appConfirm
        ? await window.appConfirm({
            title: "Primer ingreso",
            message: "Puedes cambiar tu contrasena ahora.\nSi eliges omitir, seguiras con la actual y este aviso no volvera a salir.",
            confirmText: "Cambiar ahora",
            cancelText: "Omitir"
        })
        : confirm("Primer ingreso: deseas cambiar tu contrasena ahora");

    if (!wantsChange) {
        const keepRes = await firstLoginApiCall_({
            action: "first_login_keep",
            role: role,
            user_id: userId,
            requester: userId
        });
        if (!keepRes || !keepRes.success) {
            alert((keepRes && keepRes.message) || "No se pudo completar el primer ingreso.");
            return false;
        }
        return true;
    }

    const pass1 = prompt("Ingresa tu nueva contrasena:");
    if (pass1 === null) {
        const keepRes = await firstLoginApiCall_({
            action: "first_login_keep",
            role: role,
            user_id: userId,
            requester: userId
        });
        return !!(keepRes && keepRes.success);
    }

    const newPass = String(pass1 || "").trim();
    if (!newPass) {
        alert("La contrasena no puede estar vacia.");
        return false;
    }

    const pass2 = prompt("Confirma tu nueva contrasena:");
    if (pass2 === null) return false;
    if (newPass !== String(pass2)) {
        alert("Las contrasenas no coinciden.");
        return false;
    }

    const updRes = await firstLoginApiCall_({
        action: "first_login_update_password",
        role: role,
        user_id: userId,
        new_password: newPass,
        requester: userId
    });
    if (!updRes || !updRes.success) {
        alert((updRes && updRes.message) || "No se pudo actualizar la contrasena.");
        return false;
    }

    try {
        sessionStorage.setItem("vidafem_session", JSON.stringify(sessionData));
    } catch (e) {}

    return true;
}

if (loginForm) {
    loginForm.addEventListener('submit', function(e) {
        e.preventDefault(); 

        const usuarioInput = document.getElementById('usuario').value.trim();
        const passwordInput = document.getElementById('password').value.trim();
        const btnLogin = document.getElementById('btnLogin');
        const mensajeEstado = document.getElementById('mensajeEstado');

        // 1. Interfaz: Mostrar estado "Cargando"
        btnLogin.disabled = true;
        btnLogin.textContent = "VERIFICANDO...";
        if(mensajeEstado) {
            mensajeEstado.style.color = "#666";
            mensajeEstado.textContent = "Conectando con el servidor...";
        }

        // 2. Preparar los datos
        const datos = {
            action: "login",
            usuario: usuarioInput,
            password: passwordInput
        };

        // 3. Conexión con Google Apps Script
        fetch(API_URL, {
            method: "POST",
            body: JSON.stringify(datos)
        })
        .then(response => response.json())
        .then(async data => {
            if (data.success) {
                // ÉXITO
                if(mensajeEstado) {
                    mensajeEstado.style.color = "green";
                    mensajeEstado.textContent = "¡Bienvenido! Redirigiendo...";
                }
                
                // Guardar sesión completa (incluye el rol) en sessionStorage (no persistente)
                try {
                    sessionStorage.setItem("vidafem_session", JSON.stringify(data));
                } catch(e) {
                    console.warn('No se pudo guardar la sesión en sessionStorage', e);
                }

                // 4. REDIRECCIÓN INTELIGENTE SEGÚN EL ROL
                const proceedToApp = () => {
                    if (data.role === 'paciente') {
                        // Si es paciente, va a su portal exclusivo
                        window.location.href = "paciente.html";
                    } else if (data.role === 'superadmin') {
                        window.location.href = "superadmin.html";
                    } else {
                        // Si es admin/doctor, va al panel medico
                        window.location.href = "admin.html";
                    }
                };

                if (data.must_change_password) {
                    const ok = await handleFirstLoginFlow(data);
                    if (ok) {
                        setTimeout(proceedToApp, 400);
                    } else {
                        btnLogin.disabled = false;
                        btnLogin.textContent = "INGRESAR";
                    }
                } else {
                    setTimeout(proceedToApp, 1000); // Espera corta para leer el mensaje de exito
                } // Pequeña espera para que lea el mensaje de éxito

            } else {
                // ERROR (Credenciales incorrectas)
                if(mensajeEstado) {
                    mensajeEstado.style.color = "red";
                    mensajeEstado.textContent = data.message;
                }
                btnLogin.disabled = false;
                btnLogin.textContent = "INGRESAR";
            }
        })
        .catch(error => {
            console.error("Error:", error);
            if(mensajeEstado) {
                mensajeEstado.style.color = "red";
                mensajeEstado.textContent = "Error de conexión. Intente nuevamente.";
            }
            btnLogin.disabled = false;
            btnLogin.textContent = "INGRESAR";
        });
    });
}



