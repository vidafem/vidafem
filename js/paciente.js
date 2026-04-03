// js/paciente.js - Portal del Paciente (CORRECCIÓN DE PESTAÑAS - FUERZA BRUTA)

let currentPatientId = null;
let autoUpdateInterval = null;
let doctorVacationState_ = {
    loading: true,
    checked_once: false,
    error: "",
    active: false,
    fecha_hasta: "",
    titulo: "",
    mensaje: "",
    block_message: ""
};
let doctorVacationRequest_ = null;
let infographicFeedState_ = {
    signature: "",
    list: [],
    currentIndex: 0,
    autoTimer: null
};

function notify(message, type) {
    if (window.showToast) {
        window.showToast(message, type || "info");
    } else {
        alert(message);
    }
}

function notifySyncAwareResult_(res, successMessage, warningMessage) {
    const hasWarning = !!(res && res.warning);
    if (hasWarning) {
        notify(
            String(warningMessage || (successMessage + " con advertencia de sincronización.")) +
            (res.warning ? " " + String(res.warning) : ""),
            "warning"
        );
        return;
    }
    notify(String(successMessage || "Operacion completada."), "success");
}

function postApiWithSession_(payload, urlOverride) {
    const body = Object.assign({}, payload || {});
    if (!body.session_token) {
        const session = getPatientSessionData_();
        if (session && session.session_token) {
            body.session_token = session.session_token;
        }
    }
    return fetch(urlOverride || API_URL, {
        method: "POST",
        body: JSON.stringify(body)
    }).then(r => r.json());
}

function getPatientSessionData_() {
    try {
        const raw = sessionStorage.getItem("vidafem_session");
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function toInputDate_(value) {
    if (!value) return "";
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().split("T")[0];
}

function normalizePatientIdKey_(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const lower = raw.toLowerCase();
    if (/^\d+$/.test(lower)) return String(Number(lower));
    return lower;
}

function syncPatientHeroPlacement_() {
    const section = document.getElementById("view-inicio");
    const layout = document.getElementById("patientHomeLayout");
    const grid = document.getElementById("dashboardGrid");
    if (!section || !layout || !grid) return;

    const hero = section.querySelector(".patient-hero-card") || layout.querySelector(".patient-hero-card");
    const sidebar = layout.querySelector(".patient-home-sidebar");
    if (!hero || !sidebar) return;

    if (window.innerWidth >= 901) {
        if (hero.parentElement !== sidebar) sidebar.insertBefore(hero, grid);
        return;
    }

    if (hero.parentElement !== section) section.insertBefore(hero, layout);
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. VERIFICAR SESIÓN
    const sessionData = getPatientSessionData_();
    const token = sessionData ? String(sessionData.session_token || "").trim() : "";
    if (!sessionData || !token) {
        window.navigateWithEnv("index.html");
        return;
    }
    
    // Verificación de seguridad extra
    if (sessionData.role !== 'paciente') {
        window.navigateWithEnv("index.html");
        return;
    }

    // Configurar Datos del Usuario
    currentPatientId = sessionData.data.id_paciente || sessionData.data.id;
    
    const selfId = document.getElementById('selfId');
    if(selfId) selfId.value = currentPatientId;

    syncSelfScheduleAccessUi_();
    fetchDoctorVacationState_({ force: true, silentError: true, lockUi: true });
    
    const nameDisplay = document.getElementById('patientNameDisplay');
    if(nameDisplay) nameDisplay.innerText = sessionData.data.nombre_completo;

    fillPatientProfile(sessionData.data);
    setupPatientProfileEditForm();
    loadTreatingDoctorInfo();
    setupProfilePasswordFormPatient();
    syncPatientHeroPlacement_();
    window.addEventListener("resize", syncPatientHeroPlacement_);

    // 2. INICIALIZAR VISTA: Forzamos ir al Inicio primero
    switchView('inicio');

    // 3. CARGAR DATOS
    refreshAllData();

    // 4. AUTO-REFRESCO (Cada 10 segundos)
    if (autoUpdateInterval) clearInterval(autoUpdateInterval);
    autoUpdateInterval = setInterval(refreshAllData, 10000);
});

// FUNCIÓN MAESTRA DE ACTUALIZACIÓN
window.refreshAllData = function() {
    if(document.hidden) return; 
    
    checkPromoAndDashboard(); 
    loadMyAppointments(); 
    loadMyResults(); 
}

// --- NAVEGACIÓN "NUCLEAR" (Garantiza que se limpie la pantalla) ---
window.switchView = function(viewName) {
    // 1. Ocultar TODAS las secciones forzando con !important
    const sections = document.querySelectorAll('.view-section');
    sections.forEach(el => {
        // Esto sobrescribe cualquier CSS que esté bloqueando el ocultamiento
        el.style.setProperty('display', 'none', 'important');
        el.classList.remove('active');
    });
    
    // 2. Desactivar visualmente los links del menú
    document.querySelectorAll('.menu-link').forEach(el => el.classList.remove('active'));
    
    // 3. Identificar y mostrar SOLO la sección destino
    const targetId = 'view-' + viewName;
    const target = document.getElementById(targetId);
    
    // 4. Activar el link del menú correspondiente
    // Buscamos el link que llama a esta función para ponerle la clase active
    const menuLinks = document.querySelectorAll('.menu-link');
    menuLinks.forEach(link => {
        if(link.getAttribute('onclick') && link.getAttribute('onclick').includes(viewName)) {
            link.classList.add('active');
        }
    });
    
    if (target) {
        // Excepción: El inicio usa Flexbox, el resto Block
        if (viewName === 'inicio') {
             target.style.setProperty('display', 'flex', 'important');
        } else {
             target.style.setProperty('display', 'block', 'important');
        }
        
        setTimeout(() => {
            target.classList.add('active');
        }, 10);
        
        // Recargar datos específicos si es necesario
        if(viewName === 'historial') loadMyResults();
        if(viewName === 'perfil') loadTreatingDoctorInfo();
        if(viewName === 'inicio') {
            syncPatientHeroPlacement_();
            ensureInfographicAutoplay_();
        }
        else clearInfographicAutoplay_();
    } else {
        console.error("No se encontró la sección: " + targetId);
    }
}

function fillPatientProfile(data) {
    if (!data) return;
    const elName = document.getElementById("profilePatientName");
    const elCedula = document.getElementById("profilePatientCedula");
    const elEmail = document.getElementById("profilePatientEmail");
    const elPhone = document.getElementById("profilePatientPhone");
    const elAddress = document.getElementById("profilePatientAddress");
    const elJob = document.getElementById("profilePatientJob");
    const elBirth = document.getElementById("profilePatientBirth");

    if (elName) elName.innerText = data.nombre_completo || "--";
    if (elCedula) elCedula.innerText = data.cedula || "--";
    if (elEmail) elEmail.innerText = data.correo || "--";
    if (elPhone) elPhone.innerText = data.telefono || "--";
    if (elAddress) elAddress.innerText = data.direccion || "--";
    if (elJob) elJob.innerText = data.ocupacion || "--";
    if (elBirth) elBirth.innerText = data.fecha_nacimiento || "--";
}

function openPatientProfileEditModal_() {
    const sessionData = getPatientSessionData_();
    if (!sessionData || !sessionData.data) {
        notify("Sesión inválida. Inicia sesión nuevamente.", "warning");
        return;
    }
    const d = sessionData.data;

    const cedula = document.getElementById("profileEditPatientCedula");
    const name = document.getElementById("profileEditPatientName");
    const email = document.getElementById("profileEditPatientEmail");
    const phone = document.getElementById("profileEditPatientPhone");
    const address = document.getElementById("profileEditPatientAddress");
    const job = document.getElementById("profileEditPatientJob");
    const birth = document.getElementById("profileEditPatientBirth");

    if (cedula) cedula.value = d.cedula || "";
    if (name) name.value = d.nombre_completo || "";
    if (email) email.value = d.correo || "";
    if (phone) phone.value = d.telefono || "";
    if (address) address.value = d.direccion || "";
    if (job) job.value = d.ocupacion || "";
    if (birth) birth.value = toInputDate_(d.fecha_nacimiento);

    const modal = document.getElementById("modalPatientProfileEdit");
    if (modal) modal.classList.add("active");
}

function setupPatientProfileEditForm() {
    const btnOpen = document.getElementById("btnEditPatientProfile");
    if (btnOpen) btnOpen.addEventListener("click", openPatientProfileEditModal_);

    const inputName = document.getElementById("profileEditPatientName");
    const inputMail = document.getElementById("profileEditPatientEmail");
    const inputPhone = document.getElementById("profileEditPatientPhone");
    const inputAddress = document.getElementById("profileEditPatientAddress");
    const inputJob = document.getElementById("profileEditPatientJob");

    if (inputName) inputName.addEventListener("input", (e) => { e.target.value = String(e.target.value || "").toUpperCase(); });
    if (inputMail) inputMail.addEventListener("input", (e) => { e.target.value = String(e.target.value || "").toLowerCase(); });
    if (inputPhone) inputPhone.addEventListener("input", (e) => { e.target.value = String(e.target.value || "").replace(/[^\d]/g, ""); });
    if (inputAddress) inputAddress.addEventListener("input", (e) => { e.target.value = String(e.target.value || "").toUpperCase(); });
    if (inputJob) inputJob.addEventListener("input", (e) => { e.target.value = String(e.target.value || "").toUpperCase(); });

    const form = document.getElementById("formPatientProfileEdit");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const sessionData = getPatientSessionData_();
        if (!sessionData || !sessionData.data) {
            notify("Sesión inválida. Inicia sesión nuevamente.", "warning");
            return;
        }

        const userId = String(sessionData.data.id_paciente || sessionData.data.id || "").trim();
        if (!userId) {
            notify("No se pudo identificar al paciente.", "error");
            return;
        }

        const payload = {
            nombre_completo: String((inputName && inputName.value) || "").trim(),
            correo: String((inputMail && inputMail.value) || "").trim(),
            telefono: String((inputPhone && inputPhone.value) || "").trim(),
            direccion: String((inputAddress && inputAddress.value) || "").trim(),
            ocupacion: String((inputJob && inputJob.value) || "").trim(),
            fecha_nacimiento: String((document.getElementById("profileEditPatientBirth") || {}).value || "").trim()
        };

        const btnSave = document.getElementById("btnSavePatientProfile");
        const oldText = btnSave ? btnSave.innerText : "";
        if (btnSave) {
            btnSave.disabled = true;
            btnSave.innerText = "Guardando...";
        }

        try {
            const res = await postApiWithSession_({
                action: "self_update_patient_profile",
                user_id: userId,
                requester: userId,
                data: payload
            });

            if (!res || !res.success) {
                notify("Error: " + (res && res.message ? res.message : "No se pudo actualizar."), "error");
                return;
            }

            if (!sessionData.data) sessionData.data = {};
            if (res.data) {
                sessionData.data.nombre_completo = res.data.nombre_completo || sessionData.data.nombre_completo || "";
                sessionData.data.cedula = res.data.cedula || sessionData.data.cedula || "";
                sessionData.data.correo = res.data.correo || "";
                sessionData.data.telefono = res.data.telefono || "";
                sessionData.data.direccion = res.data.direccion || "";
                sessionData.data.ocupacion = res.data.ocupacion || "";
                sessionData.data.fecha_nacimiento = res.data.fecha_nacimiento || "";
            }
            sessionStorage.setItem("vidafem_session", JSON.stringify(sessionData));

            const nameDisplay = document.getElementById("patientNameDisplay");
            if (nameDisplay) nameDisplay.innerText = sessionData.data.nombre_completo || "Paciente";

            fillPatientProfile(sessionData.data);
            window.closeModal("modalPatientProfileEdit");
            notifySyncAwareResult_(
                res,
                "Perfil actualizado.",
                "Perfil actualizado con advertencia de sincronización."
            );
        } catch (err) {
            notify("Error de conexión.", "error");
        } finally {
            if (btnSave) {
                btnSave.disabled = false;
                btnSave.innerText = oldText;
            }
        }
    });
}

function fillTreatingDoctorInfo(data) {
    const elName = document.getElementById("profileTreatingDoctorName");
    const elPhone = document.getElementById("profileTreatingDoctorPhone");
    const elEmail = document.getElementById("profileTreatingDoctorEmail");

    if (elName) elName.innerText = (data && data.nombre_doctor) || "--";
    if (elPhone) elPhone.innerText = (data && data.telefono) || "--";
    if (elEmail) elEmail.innerText = (data && data.correo) || "--";
}

function loadTreatingDoctorInfo() {
    if (!currentPatientId) return;
    postApiWithSession_({
        action: "get_my_doctor_info",
        requester: currentPatientId
    })
    .then(res => {
        if (res && res.success) {
            fillTreatingDoctorInfo(res.data || {});
        } else {
            fillTreatingDoctorInfo(null);
        }
    })
    .catch(() => {
        fillTreatingDoctorInfo(null);
    });
}

function isDoctorVacationActive_() {
    return !!(doctorVacationState_ && doctorVacationState_.active);
}

function buildVacationSeenKey_(vac) {
    const until = String((vac && vac.fecha_hasta) || "").trim();
    const title = String((vac && vac.titulo) || "").trim();
    return "vacSeen_" + until + "_" + title;
}

function normalizeDoctorVacationState_(res) {
    if (res && res.success) {
        return {
            loading: false,
            checked_once: true,
            error: "",
            active: !!res.active,
            fecha_hasta: String(res.fecha_hasta || "").trim(),
            titulo: String(res.titulo || "").trim(),
            mensaje: String(res.mensaje || "").trim(),
            block_message: String(res.block_message || "").trim()
        };
    }

    return {
        loading: false,
        checked_once: false,
        error: (res && res.message) ? String(res.message) : "No se pudo verificar si tu médico está disponible.",
        active: false,
        fecha_hasta: "",
        titulo: "",
        mensaje: "",
        block_message: ""
    };
}

function syncSelfScheduleAccessUi_() {
    const desktopBtn = document.getElementById("btnOpenSelfSchedule");
    const mobileBtn = document.getElementById("btnFloatingScheduleMobile");
    const buttons = [desktopBtn, mobileBtn];
    const isBlocked = isDoctorVacationActive_();
    const isLoading = !!doctorVacationState_.loading;
    const title = isLoading
        ? "Verificando disponibilidad..."
        : (isBlocked
            ? (doctorVacationState_.block_message || "Tu médico no acepta citas por vacaciones.")
            : "Agendar cita");

    buttons.forEach((btn) => {
        if (!btn) return;
        btn.disabled = false;
        btn.classList.toggle("is-loading", isLoading);
        btn.classList.toggle("is-blocked", isBlocked);
        btn.setAttribute("aria-busy", isLoading ? "true" : "false");
        btn.setAttribute("title", title);
    });

    updateSelfScheduleVacationNotice_();
    updateSelfScheduleSubmitState();
}

function updateSelfScheduleVacationNotice_() {
    const gate = document.getElementById("selfVacationGate");
    const fields = document.getElementById("selfApptFormFields");
    const submitWrap = document.getElementById("selfApptSubmitWrap");
    const gateTitle = document.getElementById("selfVacationGateTitle");
    const gateMsg = document.getElementById("selfVacationGateMsg");
    const gateUntil = document.getElementById("selfVacationGateUntil");
    if (!gate || !fields || !submitWrap || !gateTitle || !gateMsg || !gateUntil) return;

    gate.classList.remove("is-loading", "is-error");

    if (doctorVacationState_.loading) {
        gate.style.display = "flex";
        gate.classList.add("is-loading");
        gateTitle.innerText = "Verificando disponibilidad...";
        gateMsg.innerText = "Estamos consultando si tu médico está disponible para nuevas citas.";
        gateUntil.innerText = "--";
        fields.style.display = "none";
        submitWrap.style.display = "none";
        return;
    }

    if (doctorVacationState_.error) {
        gate.style.display = "flex";
        gate.classList.add("is-error");
        gateTitle.innerText = "No se pudo verificar la agenda";
        gateMsg.innerText = doctorVacationState_.error;
        gateUntil.innerText = "--";
        fields.style.display = "none";
        submitWrap.style.display = "none";
        return;
    }

    if (isDoctorVacationActive_()) {
        gate.style.display = "flex";
        gateTitle.innerText = doctorVacationState_.titulo || "Aviso importante";
        gateMsg.innerText = doctorVacationState_.mensaje || "Tu médico se encuentra temporalmente fuera del consultorio.";
        gateUntil.innerText = doctorVacationState_.fecha_hasta || "--";
        fields.style.display = "none";
        submitWrap.style.display = "none";
        return;
    }

    gate.style.display = "none";
    fields.style.display = "";
    submitWrap.style.display = "";
}

function fetchDoctorVacationState_(options) {
    const opts = options || {};
    if (!currentPatientId) {
        doctorVacationState_ = normalizeDoctorVacationState_({ success: false, message: "No se pudo identificar al paciente." });
        syncSelfScheduleAccessUi_();
        return Promise.resolve(doctorVacationState_);
    }

    if (doctorVacationRequest_ && !opts.force) {
        return doctorVacationRequest_;
    }

    if (opts.lockUi || !doctorVacationState_.checked_once) {
        doctorVacationState_ = Object.assign({}, doctorVacationState_, {
            loading: true,
            error: ""
        });
        syncSelfScheduleAccessUi_();
    }

    const timestamp = Date.now();
    const vacationPromise = (window.vfDataBridge && window.vfDataBridge.getDoctorVacationForPatient)
        ? window.vfDataBridge.getDoctorVacationForPatient(currentPatientId)
        : postApiWithSession_(
            { action: "get_my_doctor_vacation", requester: currentPatientId },
            API_URL + "?t=" + timestamp
          );

    doctorVacationRequest_ = vacationPromise
        .then((res) => {
            doctorVacationState_ = normalizeDoctorVacationState_(res);
            syncSelfScheduleAccessUi_();
            return doctorVacationState_;
        })
        .catch(() => {
            doctorVacationState_ = normalizeDoctorVacationState_({
                success: false,
                message: "No se pudo verificar si tu médico está disponible en este momento."
            });
            syncSelfScheduleAccessUi_();
            if (!opts.silentError) {
                notify(doctorVacationState_.error, "warning");
            }
            return doctorVacationState_;
        })
        .finally(() => {
            doctorVacationRequest_ = null;
        });

    return doctorVacationRequest_;
}

function ensureDoctorVacationStateLoaded_(forceRefresh, lockUi) {
    if (!forceRefresh && doctorVacationState_.checked_once && !doctorVacationState_.loading && !doctorVacationState_.error) {
        return Promise.resolve(doctorVacationState_);
    }
    return fetchDoctorVacationState_({ force: !!forceRefresh, silentError: !!forceRefresh, lockUi: !!lockUi });
}

function showDoctorVacationModal_(vac) {
    const titleEl = document.getElementById("txtVacationTitle");
    const msgEl = document.getElementById("txtVacationMsg");
    const untilEl = document.getElementById("txtVacationUntil");
    if (titleEl) titleEl.innerText = String((vac && vac.titulo) || "Aviso importante");
    if (msgEl) msgEl.innerText = String((vac && vac.mensaje) || "Tu médico se encuentra fuera temporalmente.");
    if (untilEl) untilEl.innerText = String((vac && vac.fecha_hasta) || "--");

    const modal = document.getElementById("modalDoctorVacationNotice");
    if (modal) modal.classList.add("active");
}

function setupProfilePasswordFormPatient() {
    const form = document.getElementById("formProfilePasswordPatient");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const session = sessionStorage.getItem("vidafem_session");
        if (!session) {
            window.navigateWithEnv("index.html");
            return;
        }

        const sessionData = JSON.parse(session);
        const newPass = document.getElementById("profilePatientNewPassword");
        const confirmPass = document.getElementById("profilePatientConfirmPassword");
        const passVal = newPass ? newPass.value.trim() : "";
        const confirmVal = confirmPass ? confirmPass.value.trim() : "";

        if (!passVal || !confirmVal) {
            notify("Completa la nueva contraseña.", "warning");
            return;
        }
        if (passVal !== confirmVal) {
            notify("Las contraseñas no coinciden.", "warning");
            return;
        }

        const ok = window.appConfirm
            ? await window.appConfirm({
                title: "Cambiar contraseña",
                message: "¿Estás seguro de cambiar tu contraseña?",
                confirmText: "Si, cambiar",
                cancelText: "Cancelar",
            })
            : confirm("¿Estás seguro de cambiar tu contraseña?");
        if (!ok) return;

        const userId = sessionData.data.id_paciente || sessionData.data.id;
        if (!userId) {
            notify("No se pudo identificar al paciente.", "error");
            return;
        }

        postApiWithSession_({
            action: "self_update_password",
            role: "paciente",
            user_id: userId,
            new_password: passVal,
            requester: userId,
        })
        .then(res => {
            if (res && res.success) {
                if (newPass) newPass.value = "";
                if (confirmPass) confirmPass.value = "";
                notifySyncAwareResult_(
                    res,
                    "Contraseña actualizada.",
                    "Contraseña actualizada con advertencia de sincronización."
                );
                try {
                    const updated = JSON.parse(sessionStorage.getItem("vidafem_session"));
                    sessionStorage.setItem("vidafem_session", JSON.stringify(updated));
                } catch(e) {}
            } else {
                notify("Error: " + (res && res.message ? res.message : "No se pudo actualizar."), "error");
            }
        })
        .catch(() => {
            notify("Error de conexión.", "error");
        });
    });
}

function clearInfographicAutoplay_() {
    if (infographicFeedState_.autoTimer) {
        clearInterval(infographicFeedState_.autoTimer);
        infographicFeedState_.autoTimer = null;
    }
}

function buildInfographicSignature_(list) {
    if (!Array.isArray(list) || list.length === 0) return "";
    return list.map((p) => `${p.id_post || ""}|${p.fecha_actualizacion || ""}|${p.imagen_url || ""}`).join("||");
}

function getInfographicById_(idPost) {
    return (infographicFeedState_.list || []).find((p) => String(p.id_post) === String(idPost)) || null;
}

function escapeHtml_(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => {
        if (char === "&") return "&amp;";
        if (char === "<") return "&lt;";
        if (char === ">") return "&gt;";
        if (char === '"') return "&quot;";
        return "&#39;";
    });
}

function formatInfographicRichText_(value) {
    return escapeHtml_(String(value || "").replace(/\r\n/g, "\n")).replace(/\n/g, "<br>");
}

function buildInfographicPreviewText_(value) {
    const raw = String(value || "").replace(/\r\n/g, "\n").trim();
    if (!raw) return { text: "", truncated: false };
    const maxChars = 220;
    if (raw.length <= maxChars) return { text: raw, truncated: false };

    let preview = raw.substring(0, maxChars);
    const lastBreak = Math.max(preview.lastIndexOf(" "), preview.lastIndexOf("\n"));
    if (lastBreak > 140) preview = preview.substring(0, lastBreak);
    preview = preview.replace(/[ ,;:.!?-]+$/g, "");
    return { text: `${preview}...`, truncated: true };
}

function openInfographicDetailsModal_(post) {
    const modal = document.getElementById("modalVisor");
    const titleNode = document.getElementById("visorTitle");
    const contentNode = document.getElementById("visorContent");
    if (!modal || !titleNode || !contentNode || !post) return;

    const title = String(post.titulo || "").trim() || "Más información";
    const message = String(post.mensaje || "").trim();
    const updated = String(post.fecha_actualizacion || "").trim();
    const imageCandidates = getInfographicImageCandidates_(post.imagen_url);
    const imageBlock = imageCandidates.length
        ? `
            <div class="infographic-modal-media">
                <img
                    class="infographic-modal-image"
                    src="${escapeHtml_(imageCandidates[0])}"
                    data-fallbacks="${escapeHtml_(imageCandidates.join("||"))}"
                    alt="${escapeHtml_(title)}"
                    loading="eager"
                >
            </div>
        `
        : "";
    titleNode.textContent = "Detalle de publicación";
    contentNode.innerHTML = `
        <article class="infographic-modal-copy">
            ${imageBlock}
            <div class="infographic-modal-body">
                <h4 class="infographic-modal-title">${escapeHtml_(title)}</h4>
                ${updated ? `<div class="infographic-modal-meta">Actualizado: ${escapeHtml_(updated)}</div>` : ""}
                ${message ? `<div class="infographic-modal-text">${formatInfographicRichText_(message)}</div>` : `<p>No hay contenido ampliado disponible para esta publicación.</p>`}
            </div>
        </article>
    `;
    bindInfographicImageFallbacks_(contentNode);
    modal.classList.add("active");
}

function refreshInfographicDots_() {
    const dotsWrap = document.getElementById("patientInfDots");
    if (!dotsWrap) return;
    const dots = dotsWrap.querySelectorAll(".patient-infographic-dot");
    dots.forEach((dot, idx) => {
        if (idx === infographicFeedState_.currentIndex) dot.classList.add("active");
        else dot.classList.remove("active");
    });
}

function showInfographicSlide_(index) {
    const slides = document.querySelectorAll("#patientInfographicStage .patient-infographic-slide");
    if (!slides.length) return;
    let target = Number(index || 0);
    if (target < 0) target = slides.length - 1;
    if (target >= slides.length) target = 0;
    infographicFeedState_.currentIndex = target;
    slides.forEach((el, i) => {
        if (i === target) el.classList.add("active");
        else el.classList.remove("active");
    });
    refreshInfographicDots_();
}

function moveInfographicSlide_(delta) {
    const total = (infographicFeedState_.list || []).length;
    if (!total) return;
    showInfographicSlide_(infographicFeedState_.currentIndex + Number(delta || 1));
}

function ensureInfographicAutoplay_() {
    clearInfographicAutoplay_();
    if (!infographicFeedState_.list || infographicFeedState_.list.length <= 1) return;
    infographicFeedState_.autoTimer = setInterval(() => {
        if (document.hidden) return;
        moveInfographicSlide_(1);
    }, 7500);
}

function extractDriveFileIdFromPublicUrl_(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const matchPath = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (matchPath && matchPath[1]) return matchPath[1];
    const matchQuery = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (matchQuery && matchQuery[1]) return matchQuery[1];
    return "";
}

function getInfographicImageCandidates_(value) {
    const raw = String(value || "").trim();
    const list = [];
    if (raw) list.push(raw);
    const fileId = extractDriveFileIdFromPublicUrl_(raw);
    if (fileId) {
        const thumbUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`;
        const viewUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
        if (list.indexOf(thumbUrl) === -1) list.push(thumbUrl);
        if (list.indexOf(viewUrl) === -1) list.push(viewUrl);
    }
    return list;
}

function bindInfographicImageFallbacks_(root) {
    if (!root) return;
    const images = root.querySelectorAll(".patient-infographic-photo, .infographic-modal-image");
    images.forEach((img) => {
        if (img.dataset.bound === "1") return;
        img.dataset.bound = "1";
        const candidates = String(img.dataset.fallbacks || "")
            .split("||")
            .map((item) => String(item || "").trim())
            .filter(Boolean);
        let index = 0;
        img.addEventListener("error", () => {
            index += 1;
            if (index < candidates.length) {
                img.src = candidates[index];
                return;
            }
            img.classList.add("is-broken");
        });
    });
}

function renderInfographicFeed_(list) {
    const wrap = document.getElementById("patientInfographicWrap");
    const layout = document.getElementById("patientHomeLayout");
    const stage = document.getElementById("patientInfographicStage");
    const dots = document.getElementById("patientInfDots");
    const btnPrev = document.getElementById("btnInfPrev");
    const btnNext = document.getElementById("btnInfNext");
    if (!wrap || !stage || !dots) return;

    const feed = Array.isArray(list) ? list : [];
    const signature = buildInfographicSignature_(feed);
    if (!feed.length) {
        clearInfographicAutoplay_();
        infographicFeedState_.list = [];
        infographicFeedState_.signature = "";
        stage.innerHTML = "";
        dots.innerHTML = "";
        wrap.style.display = "none";
        if (layout) layout.classList.add("without-infographic");
        return;
    }

    if (layout) layout.classList.remove("without-infographic");

    if (signature === infographicFeedState_.signature && infographicFeedState_.list.length === feed.length) {
        wrap.style.display = "block";
        return;
    }

    infographicFeedState_.signature = signature;
    infographicFeedState_.list = feed;
    infographicFeedState_.currentIndex = 0;

    const slidesHtml = feed.map((p, idx) => {
        const title = p.titulo ? String(p.titulo) : "";
        const msg = p.mensaje ? String(p.mensaje) : "";
        const preview = buildInfographicPreviewText_(msg);
        const imageCandidates = getInfographicImageCandidates_(p.imagen_url);
        const slideBg = imageCandidates.length ? "background:#cfccd6;" : "background:linear-gradient(135deg,#d9d5ec,#efeef7);";
        const media = imageCandidates.length
            ? `<img class="patient-infographic-photo" src="${imageCandidates[0]}" data-fallbacks="${imageCandidates.join("||")}" alt="Infografia ${idx + 1}" loading="${idx === 0 ? "eager" : "lazy"}">`
            : "";
        const showAgenda = p.show_btn_agenda !== false;
        const showInfo = p.show_btn_info !== false;
        const showSource = p.show_btn_source === true;
        const showContact = p.show_btn_contacto !== false;
        const btnAgendaText = p.btn_agenda_text || "Agenda tu cita";
        const btnInfoText = p.btn_info_text || "Más información";
        const btnSourceText = p.btn_source_text || "Ir a fuente";
        const btnContactText = p.btn_contacto_text || "Contactanos";
        const hasInfo = showInfo && (!!title || !!msg);
        const hasSource = showSource && !!String(p.btn_source_url || "").trim();
        const agendaBtn = showAgenda
            ? `<button type="button" class="inf-btn inf-btn-solid" onclick="onInfographicAction('agenda','${p.id_post}')">${escapeHtml_(btnAgendaText)}</button>`
            : "";
        const infoBtn = hasInfo
            ? `<button type="button" class="inf-btn inf-btn-outline" onclick="onInfographicAction('info','${p.id_post}')">${escapeHtml_(btnInfoText)}</button>`
            : "";
        const sourceBtn = hasSource
            ? `<button type="button" class="inf-btn inf-btn-source" onclick="onInfographicAction('fuente','${p.id_post}')">${escapeHtml_(btnSourceText)}</button>`
            : "";
        const contactBtn = showContact
            ? `<button type="button" class="inf-btn inf-btn-wa" onclick="onInfographicAction('contacto','${p.id_post}')">${escapeHtml_(btnContactText)}</button>`
            : "";
        return `
            <article class="patient-infographic-slide ${idx === 0 ? "active" : ""}" style="${slideBg}">
                ${media}
                <div class="patient-infographic-overlay">
                    ${title ? `<h3>${escapeHtml_(title)}</h3>` : ""}
                    ${preview.text ? `<p>${formatInfographicRichText_(preview.text)}</p>` : ""}
                    <div class="inf-btn-row">
                        ${agendaBtn}
                        ${infoBtn}
                        ${sourceBtn}
                        ${contactBtn}
                    </div>
                </div>
            </article>
        `;
    }).join("");
    stage.innerHTML = slidesHtml;
    bindInfographicImageFallbacks_(stage);

    dots.innerHTML = feed.map((_, idx) => (
        `<button type="button" class="patient-infographic-dot ${idx === 0 ? "active" : ""}" onclick="showInfographicSlideFromDot(${idx})" aria-label="Ir a slide ${idx + 1}"></button>`
    )).join("");

    if (btnPrev && !btnPrev.dataset.bound) {
        btnPrev.dataset.bound = "1";
        btnPrev.addEventListener("click", () => moveInfographicSlide_(-1));
    }
    if (btnNext && !btnNext.dataset.bound) {
        btnNext.dataset.bound = "1";
        btnNext.addEventListener("click", () => moveInfographicSlide_(1));
    }

    wrap.style.display = "block";
    showInfographicSlide_(0);
    ensureInfographicAutoplay_();
}

window.showInfographicSlideFromDot = function(idx) {
    showInfographicSlide_(idx);
};

window.onInfographicAction = function(type, idPost) {
    const post = getInfographicById_(idPost);
    if (!post) return;

    if (type === "agenda") {
        openSelfSchedule();
        return;
    }
    if (type === "info") {
        openInfographicDetailsModal_(post);
        return;
    }
    if (type === "fuente") {
        const url = String(post.btn_source_url || "").trim();
        if (!url) {
            notify("Esta publicación no tiene una fuente externa configurada.", "info");
            return;
        }
        window.open(url, "_blank", "noopener");
        return;
    }
    if (type === "contacto") {
        const number = String(post.doctor_wa_number || "").trim();
        if (!number) {
            notify("No hay teléfono de WhatsApp configurado para este médico.", "warning");
            return;
        }
        const msg = `Hola, vi la publicación: ${post.titulo || "Información"} y deseo más detalles.`;
        window.open(`https://wa.me/${number}?text=${encodeURIComponent(msg)}`, "_blank");
    }
};

// ==========================================
// 1. DASHBOARD Y PROMOCIONES
// ==========================================
function checkPromoAndDashboard() {
    const timestamp = new Date().getTime();
    const promoPromise = (window.vfDataBridge && window.vfDataBridge.getActivePromotionForPatient)
        ? window.vfDataBridge.getActivePromotionForPatient(currentPatientId)
        : postApiWithSession_({ action: "get_active_promotion", requester: currentPatientId }, API_URL + "?t=" + timestamp);
    const citasListPromise = postApiWithSession_({ action: "get_patient_appointments", id_paciente: currentPatientId, requester: currentPatientId }, API_URL + "?t=" + timestamp);
    const vacationPromise = fetchDoctorVacationState_({ force: true, silentError: true });
    const infographicPromise = postApiWithSession_({ action: "get_patient_infographics", requester: currentPatientId }, API_URL + "?t=" + timestamp);

    Promise.all([promoPromise, citasListPromise, vacationPromise, infographicPromise]).then(([resPromo, resCitas, vacationState, resInfographic]) => {
        const grid = document.getElementById('dashboardGrid');
        if (!grid) return;

        const cards = [];
        const isVacationActive = isDoctorVacationActive_();

        if (isVacationActive) {
            const vacKey = buildVacationSeenKey_(doctorVacationState_);
            if (!sessionStorage.getItem(vacKey)) {
                showDoctorVacationModal_(doctorVacationState_);
                sessionStorage.setItem(vacKey, "1");
            }
            cards.push(
                `
                <article class="summary-card card-vacation">
                    <div class="summary-icon"><i class="fas fa-umbrella-beach"></i></div>
                    <div class="summary-title">${doctorVacationState_.titulo || "Vacaciones del médico"}</div>
                    <div class="summary-value">No se están tomando nuevas citas.</div>
                    <div class="summary-meta">Hasta: ${doctorVacationState_.fecha_hasta || "--"}</div>
                    <div class="summary-note">${doctorVacationState_.mensaje || doctorVacationState_.block_message || ""}</div>
                </article>`
            );
        }

        let nextAppt = null;
        if (resCitas.success && Array.isArray(resCitas.data) && resCitas.data.length > 0) {
            const hoy = new Date().toISOString().split('T')[0];
            let futuras = resCitas.data.filter(c => (c.estado === 'PENDIENTE' || c.estado === 'REAGENDADO') && c.fecha >= hoy);

            futuras.sort((a, b) => {
                if (a.fecha === b.fecha) return a.hora.localeCompare(b.hora);
                return a.fecha.localeCompare(b.fecha);
            });
            nextAppt = futuras[0];
        }

        if (nextAppt) {
            cards.push(
                `
                <article class="summary-card card-appt">
                    <div class="summary-icon"><i class="fas fa-calendar-day"></i></div>
                    <div class="summary-title">Próxima cita</div>
                    <div class="summary-value">${nextAppt.fecha}</div>
                    <div class="summary-time">${nextAppt.hora}</div>
                    <div class="summary-note">${nextAppt.motivo || "Cita programada"}</div>
                    <div class="summary-card-actions">
                        <button type="button" class="btn-primary-small" onclick="switchView('citas')" style="background:var(--c-primary); border:none; width:100%;">
                            <i class="fas fa-list"></i> Ver mis citas
                        </button>
                    </div>
                </article>`
            );
        } else {
            cards.push(
                `
                <article class="summary-card card-empty">
                    <div class="summary-icon"><i class="fas fa-calendar-check"></i></div>
                    <div class="summary-title">Próxima cita</div>
                    <div class="summary-value">No tienes citas pendientes</div>
                    <div class="summary-note">Cuando lo necesites, puedes agendar una nueva revisión desde este panel.</div>
                </article>`
            );
        }

        cards.push(
            `
            <article class="summary-card card-results">
                <div class="summary-icon"><i class="fas fa-file-medical-alt"></i></div>
                <div class="summary-title">Resultados</div>
                <div class="summary-value">Consulta tus diagnósticos, exámenes y archivos compartidos por tu médico.</div>
                <div class="summary-card-actions">
                    <button type="button" class="btn-primary-small" onclick="switchView('historial')" style="background:var(--c-primary); border:none; width:100%;">
                        <i class="fas fa-file-medical-alt"></i> Ver mis resultados
                    </button>
                </div>
            </article>`
        );

        if (resPromo.success && resPromo.active) {
            const txtMsg = document.getElementById('txtPromoMsg');
            const txtDate = document.getElementById('txtPromoDate');
            if (txtMsg) txtMsg.innerText = resPromo.mensaje;
            if (txtDate) txtDate.innerText = resPromo.fin;

            if (!sessionStorage.getItem('promoSeen')) {
                const modalPromo = document.getElementById('modalPromo');
                if (modalPromo) modalPromo.classList.add('active');
                sessionStorage.setItem('promoSeen', 'true');
            }

            cards.push(
                `
                <article class="summary-card card-promo">
                    <div class="summary-icon"><i class="fas fa-bullhorn"></i></div>
                    <div class="summary-title">Promoción especial</div>
                    <div class="summary-value">${resPromo.mensaje}</div>
                    <div class="summary-meta">${resPromo.fin ? ("Válida hasta: " + resPromo.fin) : ""}</div>
                    <div class="summary-card-actions">
                        <button type="button" class="btn-primary-small" onclick="promoAction('agendar')" style="background:var(--c-primary); border:none; width:100%; justify-content:center;" ${isVacationActive ? "disabled" : ""}>
                            <i class="fas fa-calendar-check"></i> Aprovechar promo
                        </button>
                    </div>
                </article>`
            );
        }

        grid.innerHTML = cards.join("");
        grid.dataset.count = String(cards.length);
        renderInfographicFeed_((resInfographic && resInfographic.success && Array.isArray(resInfographic.list)) ? resInfographic.list : []);
        updateSelfScheduleSubmitState();
    }).catch(err => console.error("Error Dashboard:", err));
}

// ==========================================
// 2. LISTA DE CITAS
// ==========================================
function canPatientDeleteOwnAppointment_(appointment) {
    const row = appointment || {};
    const createdBy = String(row.creado_por || "").trim().toLowerCase();
    const status = String(row.estado || "").trim().toUpperCase();
    const allowedStatuses = { PENDIENTE: true, REAGENDADO: true };
    return !!allowedStatuses[status] && (createdBy === "paciente_web" || createdBy === String(currentPatientId || "").trim().toLowerCase());
}

function loadMyAppointments() {
    const container = document.getElementById('myAppointmentsList');
    if(!container) return;
    
    if(container.children.length === 0) container.innerHTML = '<p>Actualizando...</p>';
    const timestamp = new Date().getTime();

    postApiWithSession_({ action: "get_patient_appointments", id_paciente: currentPatientId, requester: currentPatientId }, API_URL + "?t=" + timestamp)
    .then(res => {
        container.innerHTML = ""; 
        if (res.success && res.data.length > 0) {
            res.data.forEach(cita => {
                const card = document.createElement('div');
                card.className = "card";
                
                let colorBorde = '#ccc';
                if(cita.estado === 'ASISTIO') colorBorde = '#27ae60';
                if(cita.estado === 'PENDIENTE') colorBorde = '#3498db';
                if(cita.estado === 'REAGENDADO') colorBorde = '#f39c12';
                
                card.style.borderLeft = "5px solid " + colorBorde;
                
                let btnReagendar = "";
                if (cita.estado === "PENDIENTE" || cita.estado === "REAGENDADO") {
                    btnReagendar = `
                        <button onclick="openPatientReschedule('${cita.id_cita}')" style="margin-top:10px; background:white; border:1px solid #f39c12; color:#f39c12; padding:5px 10px; border-radius:5px; cursor:pointer;">
                            <i class="fas fa-sync-alt"></i> Cambiar Fecha
                        </button>`;
                }
                let btnEliminar = "";
                if (canPatientDeleteOwnAppointment_(cita)) {
                    btnEliminar = `
                        <button onclick="deletePatientAppointment('${cita.id_cita}')" style="margin-top:10px; background:white; border:1px solid #c0392b; color:#c0392b; padding:5px 10px; border-radius:5px; cursor:pointer;">
                            <i class="fas fa-trash-alt"></i> Eliminar
                        </button>`;
                }

                card.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div>
                            <h4 style="margin:0;"><i class="fas fa-calendar-day"></i> ${cita.fecha}</h4>
                            <h2 style="margin:5px 0; color:var(--c-primary);">${cita.hora}</h2>
                            <p style="color:#666;">${cita.motivo}</p>
                            ${cita.recomendaciones ? `<small style="display:block; margin-top:5px; background:#fff3cd; padding:5px;">nota: ${cita.recomendaciones}</small>` : ''}
                        </div>
                        <div style="text-align:right;">
                            <span style="font-weight:bold; font-size:0.8rem; background:#eee; padding:3px 8px; border-radius:4px;">${cita.estado}</span>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        ${btnReagendar}
                        ${btnEliminar}
                    </div>`;
                container.appendChild(card);
            });
        } else {
            container.innerHTML = `<div class="empty-state"><p>No tienes citas registradas.</p></div>`;
        }
    });
}

window.deletePatientAppointment = function(idCita) {
    const appointmentId = String(idCita || "").trim();
    if (!appointmentId) return;
    if (!confirm("Solo puedes eliminar citas que agendaste tu mismo. Esta accion no se puede deshacer.\n\nDeseas continuar?")) {
        return;
    }

    postApiWithSession_({ action: "delete_cita", id_cita: appointmentId, requester: currentPatientId })
    .then(res => {
        if (res && res.success) {
            notify("Cita eliminada con exito.", "success");
            if (res.warning) notify(String(res.warning), "warning");
            refreshAllData();
            return;
        }
        notify((res && res.message) || "No se pudo eliminar la cita.", "error");
    })
    .catch(() => {
        notify("Error al eliminar cita. Intenta nuevamente.", "error");
    });
}

// ==========================================
// 3. REAGENDAMIENTO Y AUTO-AGENDA
// ==========================================
window.openPatientReschedule = function(idCita) {
    const inputId = document.getElementById('reschIdCita');
    if(inputId) inputId.value = idCita;
    
    const dateIn = document.getElementById('reschDate');
    if(dateIn){
        dateIn.value = "";
        dateIn.min = new Date().toISOString().split('T')[0];
        dateIn.onchange = loadRescheduleHoursPatient;
    }
    
    const timeSel = document.getElementById('reschTime');
    if(timeSel) timeSel.innerHTML = '<option>Selecciona fecha...</option>';
    
    const modal = document.getElementById('modalPatientReschedule');
    if(modal) modal.classList.add('active');
}

function loadRescheduleHoursPatient() {
    const dateVal = document.getElementById('reschDate').value;
    const timeSelect = document.getElementById('reschTime');
    if(!dateVal || !timeSelect) return;

    timeSelect.innerHTML = "<option>Cargando...</option>";
    
    postApiWithSession_({
        action: "get_taken_slots",
        fecha: dateVal,
        requester: currentPatientId,
        mode: "available",
        appointment_id: document.getElementById('reschIdCita').value
    })
    .then(res => {
        const available = res.data || [];
        timeSelect.innerHTML = "";
        available.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.innerText = t;
            timeSelect.appendChild(opt);
        });
        if(timeSelect.children.length === 0) timeSelect.innerHTML = "<option>Lleno</option>";
    });
}

const formResch = document.getElementById('formPatientReschedule');
if(formResch) {
    formResch.addEventListener('submit', function(e) {
        e.preventDefault();
        const btn = this.querySelector('button');
        const originalText = btn.innerText;
        btn.disabled = true; btn.innerText = "Guardando...";

        const data = {
            id_cita: document.getElementById('reschIdCita').value,
            nueva_fecha: document.getElementById('reschDate').value,
            nueva_hora: document.getElementById('reschTime').value
        };

        ensureDoctorVacationStateLoaded_(true, false)
        .then((vac) => {
            if (!vac || vac.loading || vac.error) {
                notify((vac && vac.error) || "No se pudo verificar si tu médico está disponible.", "warning");
                throw new Error("vacation_check_failed");
            }
            if (vac.active) {
                showDoctorVacationModal_(vac);
                notify(vac.block_message || "Tu médico no está tomando nuevas citas por vacaciones.", "warning");
                throw new Error("vacation_blocked");
            }
            return postApiWithSession_({ action: "reschedule_appointment", data: data, requester: currentPatientId });
        })
        .then(res => {
            if(res.success) {
                notify("Cita reagendada con exito.", "success");
                if (res.warning) notify(String(res.warning), "warning");
                window.closeModal('modalPatientReschedule');
                refreshAllData(); 
            } else {
                notify("Error: " + res.message, "error");
            }
        })
        .catch((err) => {
            if (err && (err.message === "vacation_blocked" || err.message === "vacation_check_failed")) return;
            notify("Error al reagendar cita. Intenta nuevamente.", "error");
        })
        .finally(() => { btn.disabled = false; btn.innerText = originalText; });
    });
}

// ==========================================
// 4. NUEVA CITA (PACIENTE)
// ==========================================
let isSelfHoursLoading = false;
let isSelfScheduleSubmitting = false;
let selfHoursRequestSeq = 0;

function normalizeDurationMinutes_(value) {
    const num = Number(value);
    return [30, 60, 120, 180, 240, 300].includes(num) ? num : 30;
}

function getSelectedPatientServiceDurationMinutes_() {
    const select = document.getElementById('selfService');
    if (!select) return 30;
    const opt = select.options[select.selectedIndex];
    return normalizeDurationMinutes_(opt ? opt.getAttribute('data-duration') : 30);
}

function setSelfTimePlaceholder_(message) {
    const timeSelect = document.getElementById('selfTime');
    if (!timeSelect) return;
    timeSelect.innerHTML = `<option value="">${message}</option>`;
    timeSelect.disabled = true;
}

function syncSelfScheduleFlow_() {
    const serviceSelect = document.getElementById('selfService');
    const dateInput = document.getElementById('selfDate');
    if (!serviceSelect || !dateInput) return;

    const hasService = !!String(serviceSelect.value || "").trim();
    dateInput.disabled = !hasService;

    if (!hasService) {
        dateInput.value = "";
        setSelfTimePlaceholder_('Elige servicio primero...');
        updateSelfScheduleSubmitState();
        return;
    }

    if (!dateInput.value) {
        setSelfTimePlaceholder_('Elige fecha...');
    }
}

function updateSelfScheduleSubmitState() {
    const form = document.getElementById('formSelfAppt');
    if (!form) return;

    const btn = form.querySelector('button[type="submit"]');
    const dateVal = (document.getElementById('selfDate') || {}).value || "";
    const timeVal = (document.getElementById('selfTime') || {}).value || "";
    const serviceVal = (document.getElementById('selfService') || {}).value || "";
    const canSubmit = !!dateVal
        && !!timeVal
        && !!serviceVal
        && !isSelfHoursLoading
        && !isSelfScheduleSubmitting
        && !doctorVacationState_.loading
        && !doctorVacationState_.error
        && doctorVacationState_.checked_once
        && !isDoctorVacationActive_();

    if (btn) btn.disabled = !canSubmit;
}

function setSelfTimeLoadingState(isLoading) {
    const timeSelect = document.getElementById('selfTime');
    if (!timeSelect) return;

    isSelfHoursLoading = !!isLoading;
    timeSelect.disabled = !!isLoading;
    if (isLoading) {
        timeSelect.innerHTML = '<option value="">Verificando disponibilidad...</option>';
    }
    updateSelfScheduleSubmitState();
}

function normalizePhoneForWa(phone) {
    if (!phone) return "";
    let digits = String(phone).replace(/[^\d]/g, "");
    if (!digits) return "";
    if (digits.length === 10 && digits.charAt(0) === "0") {
        digits = "593" + digits.substring(1);
    } else if (digits.length === 9) {
        digits = "593" + digits;
    }
    return digits;
}

function buildDoctorWaLink(doctorPhone, dataObj) {
    const number = normalizePhoneForWa(doctorPhone);
    if (!number) return "";

    let patientName = "Paciente";
    try {
        const session = JSON.parse(sessionStorage.getItem("vidafem_session") || "null");
        if (session && session.data && session.data.nombre_completo) {
            patientName = String(session.data.nombre_completo);
        }
    } catch (e) {}

    const msg = [
        "Hola doctor/a, acabo de agendar una cita.",
        "Paciente: " + patientName,
        "Fecha: " + (dataObj.fecha || ""),
        "Hora: " + (dataObj.hora || ""),
        "Motivo: " + (dataObj.motivo || ""),
    ].join("\n");

    return "https://wa.me/" + number + "?text=" + encodeURIComponent(msg);
}

function openSelfApptSuccessModal(doctorPhone, dataObj) {
    const modal = document.getElementById("modalSelfApptSuccess");
    if (!modal) return;

    const btnWa = document.getElementById("btnWaDoctorSelfAppt");
    const hint = document.getElementById("txtWaDoctorHint");
    const link = buildDoctorWaLink(doctorPhone, dataObj || {});

    if (btnWa) {
        if (link) {
            btnWa.href = link;
            btnWa.style.display = "flex";
        } else {
            btnWa.href = "#";
            btnWa.style.display = "none";
        }
    }
    if (hint) {
        if (link) {
            hint.style.display = "none";
            hint.innerText = "";
        } else {
            hint.style.display = "block";
            hint.innerText = "No se encontró el teléfono del médico asignado.";
        }
    }

    modal.classList.add("active");
}

function prepareSelfScheduleForm_() {
    const select = document.getElementById('selfService');
    const recBox = document.getElementById('recBox');
    const recDisplay = document.getElementById('selfRecsDisplay');
    const dateIn = document.getElementById('selfDate');

    if (select) {
        select.innerHTML = '<option>Cargando servicios...</option>';
        const loadServicesPromise = (window.vfDataBridge && window.vfDataBridge.getServices)
            ? window.vfDataBridge.getServices(currentPatientId)
            : postApiWithSession_({ action: "get_services", requester: currentPatientId });
        loadServicesPromise
            .then(res => {
                select.innerHTML = '<option value="">Selecciona servicio...</option>';
                if (res.data) {
                    res.data.forEach(s => {
                        const opt = document.createElement('option');
                        opt.value = s.nombre_servicio;
                        opt.innerText = s.nombre_servicio;
                        opt.setAttribute('data-recs', s.recomendaciones || "");
                        opt.setAttribute('data-duration', s.duracion_minutos || 30);
                        select.appendChild(opt);
                    });
                }
                select.onchange = function() {
                    const opt = select.options[select.selectedIndex];
                    const recs = opt ? opt.getAttribute('data-recs') : "";
                    if (recs && recBox && recDisplay) {
                        recBox.style.display = 'block';
                        recDisplay.innerText = recs;
                    } else if (recBox) {
                        recBox.style.display = 'none';
                    }
                    syncSelfScheduleFlow_();
                    if ((document.getElementById('selfDate') || {}).value) loadSelfHours();
                    updateSelfScheduleSubmitState();
                };
                syncSelfScheduleFlow_();
                updateSelfScheduleSubmitState();
            });
    }

    if (dateIn) {
        dateIn.min = new Date().toISOString().split('T')[0];
        dateIn.onchange = loadSelfHours;
        dateIn.disabled = true;
    }

    updateSelfScheduleVacationNotice_();
    updateSelfScheduleSubmitState();
}

window.openSelfSchedule = function() {
    resetSelfScheduleForm();
    const modal = document.getElementById('modalSelfAppt');
    if(modal) modal.classList.add('active');
    updateSelfScheduleVacationNotice_();

    ensureDoctorVacationStateLoaded_(false, true).then((vac) => {
        if (!vac || vac.loading || vac.error) {
            return;
        }
        if (vac.active) {
            notify(vac.block_message || "Tu médico no está tomando nuevas citas por vacaciones.", "warning");
            return;
        }
        prepareSelfScheduleForm_();
    });
}

function resetSelfScheduleForm() {
    const dateIn = document.getElementById('selfDate');
    if (dateIn) {
        dateIn.value = "";
        dateIn.disabled = true;
    }

    const timeSelect = document.getElementById('selfTime');
    if (timeSelect) {
        timeSelect.innerHTML = '<option value="">Elige servicio primero...</option>';
        timeSelect.disabled = true;
        timeSelect.onchange = updateSelfScheduleSubmitState;
    }

    const serviceSelect = document.getElementById('selfService');
    if (serviceSelect) {
        serviceSelect.innerHTML = '<option value="">Selecciona servicio...</option>';
    }

    const note = document.getElementById('selfNote');
    if (note) note.value = "";

    const recBox = document.getElementById('recBox');
    if (recBox) recBox.style.display = 'none';

    const recDisplay = document.getElementById('selfRecsDisplay');
    if (recDisplay) recDisplay.innerText = "";

    const form = document.getElementById('formSelfAppt');
    const btn = form ? form.querySelector('button[type="submit"]') : null;
    if (btn) {
        btn.disabled = true;
        btn.innerText = "Confirmar Cita";
    }

    isSelfHoursLoading = false;
    isSelfScheduleSubmitting = false;
    updateSelfScheduleVacationNotice_();
    updateSelfScheduleSubmitState();
}

function loadSelfHours() {
    const dateInput = document.getElementById('selfDate');
    const timeSelect = document.getElementById('selfTime');
    const serviceSelect = document.getElementById('selfService');
    const dateVal = dateInput ? dateInput.value : "";
    const serviceVal = serviceSelect ? String(serviceSelect.value || "").trim() : "";
    if(!timeSelect) return;

    if (doctorVacationState_.loading || doctorVacationState_.error || isDoctorVacationActive_()) {
        timeSelect.innerHTML = '<option value="">Agenda no disponible</option>';
        timeSelect.disabled = true;
        updateSelfScheduleSubmitState();
        return;
    }

    if (!serviceVal) {
        if (dateInput) dateInput.disabled = true;
        setSelfTimePlaceholder_('Elige servicio primero...');
        updateSelfScheduleSubmitState();
        return;
    }

    if (dateInput) dateInput.disabled = false;
    if(!dateVal) {
        setSelfTimePlaceholder_('Elige fecha...');
        updateSelfScheduleSubmitState();
        return;
    }

    const reqId = ++selfHoursRequestSeq;
    setSelfTimeLoadingState(true);
    const durationMinutes = getSelectedPatientServiceDurationMinutes_();

    postApiWithSession_({
        action: "get_taken_slots",
        fecha: dateVal,
        requester: currentPatientId,
        mode: "available",
        duration_minutes: durationMinutes
    })
    .then(res => {
        if (reqId !== selfHoursRequestSeq) return;

        const available = res.data || [];
        timeSelect.innerHTML = "";
        available.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.innerText = t;
            timeSelect.appendChild(opt);
        });

        if(timeSelect.children.length === 0) {
            timeSelect.innerHTML = '<option value="">Sin horarios disponibles</option>';
            timeSelect.disabled = true;
        } else {
            timeSelect.insertAdjacentHTML('afterbegin', '<option value="">Selecciona hora...</option>');
            timeSelect.disabled = false;
        }
    })
    .catch(() => {
        if (reqId !== selfHoursRequestSeq) return;
        timeSelect.innerHTML = '<option value="">No se pudo verificar horarios</option>';
        timeSelect.disabled = true;
        notify("No se pudo verificar disponibilidad. Intenta nuevamente.", "error");
    })
    .finally(() => {
        if (reqId !== selfHoursRequestSeq) return;
        isSelfHoursLoading = false;
        updateSelfScheduleSubmitState();
    });
}

const formSelf = document.getElementById('formSelfAppt');
if(formSelf) {
    formSelf.addEventListener('submit', function(e) {
        e.preventDefault();
        const btn = this.querySelector('button');
        if (!btn) return;

        if (isSelfScheduleSubmitting) return;
        if (isSelfHoursLoading) {
            notify("Espera a que termine la verificacion de horarios.", "warning");
            return;
        }

        const recDisplay = document.getElementById('selfRecsDisplay');
        const textoRecomendacion = recDisplay ? String(recDisplay.innerText || "").trim() : "";
        const fecha = document.getElementById('selfDate').value;
        const hora = document.getElementById('selfTime').value;
        const motivo = document.getElementById('selfService').value;

        if (!fecha || !hora || !motivo) {
            notify("Completa fecha, hora y motivo para continuar.", "warning");
            updateSelfScheduleSubmitState();
            return;
        }

        isSelfScheduleSubmitting = true;
        btn.disabled = true;
        btn.innerText = "Verificando horario...";

        const data = {
            id_paciente: currentPatientId,
            fecha: fecha,
            hora: hora,
            motivo: motivo,
            servicio_nombre: motivo,
            nota: document.getElementById('selfNote').value,
            recomendaciones: textoRecomendacion,
            duracion_minutos: getSelectedPatientServiceDurationMinutes_(),
            creado_por: "PACIENTE_WEB"
        };

        // Revalidar vacaciones y disponibilidad antes de guardar para evitar carreras.
        ensureDoctorVacationStateLoaded_(true, true)
        .then((vac) => {
            if (!vac || vac.loading || vac.error) {
                notify((vac && vac.error) || "No se pudo verificar si tu médico está disponible.", "warning");
                throw new Error("vacation_check_failed");
            }
            if (vac.active) {
                notify(vac.block_message || "Tu médico no está tomando nuevas citas por vacaciones.", "warning");
                throw new Error("vacation_blocked");
            }
            return postApiWithSession_({
                action: "get_taken_slots",
                fecha: data.fecha,
                requester: currentPatientId,
                mode: "available",
                duration_minutes: data.duracion_minutos
            });
        })
        .then(check => {
            const available = (check && check.data) ? check.data : [];
            if (!available.includes(data.hora)) {
                notify("Ese horario acaba de ocuparse. Elige otra hora.", "warning");
                loadSelfHours();
                throw new Error("slot_taken");
            }

            btn.innerText = "Agendando...";
            // anadir requester (paciente) para que backend valide
            return postApiWithSession_({ action: "schedule_appointment", data: data, requester: currentPatientId });
        })
        .then(res => {
            if(!res) return;
            if(res.success) {
                notify("Cita agendada con exito.", "success");
                if (res.warning) notify(String(res.warning), "warning");
                window.closeModal('modalSelfAppt');
                resetSelfScheduleForm();
                refreshAllData();
                openSelfApptSuccessModal(res.doctor_phone || "", data);
            } else {
                notify(res.message || "No se pudo agendar la cita.", "error");
            }
        })
        .catch(err => {
            if (err && (err.message === "slot_taken" || err.message === "vacation_blocked" || err.message === "vacation_check_failed")) return;
            notify("Error al agendar cita. Intenta nuevamente.", "error");
        })
        .finally(() => {
            isSelfScheduleSubmitting = false;
            btn.innerText = "Confirmar Cita";
            updateSelfScheduleSubmitState();
        });
    });
}
window.promoAction = function(type) {
    const modal = document.getElementById('modalPromo');
    if(modal) modal.classList.remove('active');
    
    const msg = document.getElementById('txtPromoMsg') ? document.getElementById('txtPromoMsg').innerText : "Promo";
    if(type === 'agendar') {
        const note = document.getElementById('selfNote');
        if(note) note.value = "APLICA PROMO: " + msg;
        openSelfSchedule();
    }
    if(type === 'whatsapp') {
        window.open(`https://wa.me/593997330933?text=${encodeURIComponent("Hola, vi la promo y deseo mas información: " + msg)}`, '_blank');
    }
}

// ==========================================
// 5. CARGAR RESULTADOS
// ==========================================
function loadMyResults() {
    const container = document.getElementById('myDiagnosesList');
    if(!container) return;

    const timestamp = new Date().getTime();
    const useWorker = !!(window.VF_API_RUNTIME && window.VF_API_RUNTIME.backend === "worker");
    const requestPromise = useWorker
        ? postApiWithSession_({ action: "get_diagnosis_history", id_paciente: currentPatientId, requester: currentPatientId }, API_URL + "?t=" + timestamp)
        : fetch(API_URL + "?t=" + timestamp, {
            method: "POST",
            body: JSON.stringify({ action: "get_data", sheet: "diagnosticos_archivos", requester: currentPatientId })
          }).then(r => r.json());

    requestPromise
    .then(res => {
        container.innerHTML = "";

        if (!res || !res.success) {
            container.innerHTML = `<p style="text-align:center; color:red;">${(res && res.message) || "No se pudieron cargar resultados."}</p>`;
            return;
        }

        const requesterKey = normalizePatientIdKey_(currentPatientId);
        const allReports = Array.isArray(res.data) ? res.data : [];
        const getDiagnosisExternalPdfItemsForPatient_ = (payload) => {
            const data = payload || {};
            const modern = Array.isArray(data.pdf_externos)
                ? data.pdf_externos
                : (Array.isArray(data.external_pdfs) ? data.external_pdfs : []);
            const list = modern.length ? modern : (data.pdf_externo_link ? [{
                id: "external_pdf_1",
                label: String(data.pdf_externo_nombre || data.titulo_adjunto || "Adjunto PDF").trim(),
                url: String(data.pdf_externo_link || "").trim()
            }] : []);
            return list.map((item, index) => {
                const current = item || {};
                const url = String(current.url || current.pdf_externo_link || "").trim();
                if (!url) return null;
                const label = String(current.label || current.nombre_visible || current.display_name || current.name || "").trim();
                return {
                    id: String(current.id || ("external_pdf_" + (index + 1))).trim(),
                    label: label ? label.replace(/\.pdf$/i, "").trim() : ("Adjunto PDF " + String(index + 1)),
                    url: url
                };
            }).filter(Boolean);
        };
        const getDiagnosisTitleForPatient_ = (rep, extraData) => {
            const rawType = String(rep && rep.tipo_examen || "").trim();
            const upperType = rawType.toUpperCase();
            const externalItems = getDiagnosisExternalPdfItemsForPatient_(extraData);
            const externalSummary = !externalItems.length
                ? ""
                : (externalItems.length === 1
                    ? externalItems[0].label
                    : (externalItems[0].label + " +" + String(externalItems.length - 1)));
            if ((upperType === "EXAMENPDF" || upperType === "EXAMEN PDF") && externalItems.length) {
                return externalSummary;
            }
            if (upperType === "RECETA" && externalItems.length) {
                return externalSummary + " / RECETA";
            }
            if (upperType === "TODO") {
                if (externalItems.length && String(extraData && extraData.pdf_receta_link || "").trim()) {
                    return externalSummary + " / RECETA";
                }
                if (externalItems.length) {
                    return externalSummary;
                }
            }
            return rawType || "REPORTE CLINICO";
        };
        let myReports = allReports.filter(r => normalizePatientIdKey_(r.id_paciente) === requesterKey);
        if (myReports.length === 0 && allReports.length > 0) {
            // El backend ya filtra por permisos; evitamos vaciar por diferencias historicas de formato ID.
            myReports = allReports.slice();
        }
        
        if (myReports.length > 0) {
            myReports.sort((a, b) => {
                const dateA = new Date(a.fecha);
                const dateB = new Date(b.fecha);
                return dateB - dateA; 
            });

            myReports.forEach(rep => {
                let extraData = {};
                try {
                    extraData = (typeof rep.datos_json === 'string') ? JSON.parse(rep.datos_json) : rep.datos_json;
                } catch(e) {}

                let titulo = rep.tipo_examen || "REPORTE CLÍNICO";
                let iconClass = "fa-file-medical";
                let color = "#36235d"; 
                const externalPdfItems = getDiagnosisExternalPdfItemsForPatient_(extraData);
                titulo = getDiagnosisTitleForPatient_(rep, extraData);

                if (rep.tipo_examen === "COLPOSCOPIA") {
                    iconClass = "fa-microscope";
                    color = "#e67e22"; 
                } else if (rep.tipo_examen === "RECETA") {
                    iconClass = "fa-prescription-bottle-alt";
                    color = "#27ae60"; 
                } else if (externalPdfItems.length && String(rep.tipo_examen || "").trim().toUpperCase() === "EXAMENPDF") {
                    iconClass = "fa-paperclip";
                    color = "#2980b9";
                }

                const fecha = rep.fecha ? rep.fecha.split('T')[0] : "S/F";
                const safeJson = encodeURIComponent(rep.datos_json);

                let botonesHtml = "";

                // A. Botón "Ver Detalles" - DESACTIVADO A PETICIÓN TUYA
                /*
                botonesHtml += `
                    <button onclick="verDetalles('${safeJson}', '${rep.tipo_examen}')" class="btn-primary-small" style="background:#3498db; padding:8px 15px; border:none; color:white; cursor:pointer;">
                        <i class="fas fa-eye"></i> Ver Detalles
                    </button>`;
                */

                // B. Botón "Reporte PDF"
                if (rep.pdf_url) {
                    botonesHtml += `
                        <button onclick="downloadFeedback(this, '${rep.pdf_url}')" class="btn-primary-small" style="background:${color}; padding:8px 15px; border:none; color:white; cursor:pointer;">
                            <i class="fas fa-file-pdf"></i> Reporte
                        </button>`;
                }

                // C. Botón "Receta PDF"
                if (extraData && extraData.pdf_receta_link) {
                    botonesHtml += `
                        <button onclick="downloadFeedback(this, '${extraData.pdf_receta_link}')" class="btn-primary-small" style="background:#27ae60; padding:8px 15px; border:none; color:white; cursor:pointer;">
                            <i class="fas fa-prescription-bottle-alt"></i> Receta
                        </button>`;
                }
                
                // D. Botón "Examen Adjunto"
                if (externalPdfItems.length) {
                     botonesHtml += externalPdfItems.map((item) => `
                        <button onclick="downloadFeedback(this, '${item.url}')" class="btn-primary-small" style="background:#2980b9; padding:8px 15px; border:none; color:white; cursor:pointer;">
                            <i class="fas fa-paperclip"></i> ${escapeHtml_(item.label)}
                        </button>`).join("");
                }

                const card = document.createElement('div');
                card.className = "card";
                card.style.cssText = `border-left: 5px solid ${color}; margin-bottom: 15px; padding: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);`;

                card.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:15px;">
                        <div style="display:flex; align-items:center; gap:15px;">
                            <div style="background:${color}20; color:${color}; width:50px; height:50px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:1.5rem;">
                                <i class="fas ${iconClass}"></i>
                            </div>
                            <div>
                                <h4 style="margin:0; color:${color}; text-transform:uppercase; font-size:1rem;">${escapeHtml_(titulo)}</h4>
                                <small style="color:#666; font-size:0.9rem;">
                                    <i class="far fa-calendar-alt"></i> ${fecha}
                                </small>
                            </div>
                        </div>
                    </div>
                    <div style="margin-top:15px; display:flex; gap:10px; flex-wrap:wrap; border-top:1px solid #eee; padding-top:15px;">
                        ${botonesHtml}
                    </div>`;
                container.appendChild(card);
            });
        } else {
            container.innerHTML = `
                <div style="text-align:center; padding:40px; color:#aaa; border:2px dashed #eee; border-radius:10px;">
                    <i class="fas fa-folder-open" style="font-size:3rem; margin-bottom:15px; color:#ddd;"></i>
                    <p>No tienes resultados disponibles todavía.</p>
                </div>`;
        }
    })
    .catch(e => {
        console.error(e);
        container.innerHTML = '<p style="color:red; text-align:center;">Error al cargar datos.</p>';
    });
}

// --- VISOR DE DETALLES (MANTENIDO PARA INTEGRIDAD DEL CÓDIGO) ---
window.verDetalles = function(encodedJson, tipo) {
    try {
        const data = JSON.parse(decodeURIComponent(encodedJson));
        const contentDiv = document.getElementById('visorContent');
        const titleDiv = document.getElementById('visorTitle');
        const modal = document.getElementById('modalVisor');

        if(titleDiv) titleDiv.innerText = "Detalles: " + tipo;
        let html = "";

        if (tipo === "RECETA") {
            html += `<h4 style="color:#27ae60; border-bottom:1px solid #eee; padding-bottom:5px;">Medicamentos Recetados:</h4>`;
            if (data.medicamentos && data.medicamentos.length > 0) {
                html += `<ul style="list-style:none; padding:0;">`;
                data.medicamentos.forEach(m => {
                    html += `
                    <li style="background:#f9f9f9; padding:10px; margin-bottom:5px; border-radius:5px; border-left:3px solid #27ae60;">
                        <strong style="color:#333;">${m.nombre}</strong><br>
                        <small style="color:#555;">Cant: ${m.cantidad} | Indicación: ${m.frecuencia}</small>
                    </li>`;
                });
                html += `</ul>`;
            }
            if (data.observaciones) {
                html += `<h4 style="margin-top:20px; color:#555;">Observaciones:</h4><p style="background:#fff3cd; padding:10px; border-radius:5px;">${data.observaciones}</p>`;
            }
        } 
        else if (tipo === "COLPOSCOPIA") {
            html += `
                <div style="background:#f0f8ff; padding:10px; border-radius:5px; margin-bottom:15px; border-left: 3px solid #3498db;">
                    <strong style="color:#3498db;">Evaluación General:</strong>
                    <p style="margin:5px 0; color:#444;">${data.evaluacion || "Sin datos"}</p>
                </div>
                <h4 style="color:#e67e22; border-bottom:1px solid #eee; margin-top:20px;">Conclusiones</h4>
                <p><strong>Diagnóstico:</strong> ${data.diagnostico || "--"}</p>
                <div style="margin-top:15px; background:#e8f5e9; padding:10px; border-radius:5px; border-left: 3px solid #27ae60;">
                    <strong style="color:#27ae60;">Recomendaciones:</strong>
                    <p style="margin:5px 0;">${data.recomendaciones || "--"}</p>
                </div>
            `;
        }
        else {
            // GENERICO
            html += `
                <div style="padding:10px;">
                    <p><strong>Motivo:</strong> ${data.motivo || "--"}</p>
                    <p><strong>Evolución:</strong> ${data.evaluacion || "--"}</p>
                    <hr style="margin:10px 0; border:0; border-top:1px solid #eee;">
                    <p><strong>Diagnóstico:</strong> ${data.diagnostico || "--"}</p>
                    <p><strong>Tratamiento:</strong> ${data.recomendaciones || "--"}</p>
                </div>
            `;
        }

        if(contentDiv) contentDiv.innerHTML = html;
        if(modal) modal.classList.add('active');

    } catch (e) {
        console.error(e);
        alert("No se pudieron cargar los detalles.");
    }
}

// Helpers
window.closeModal = function(id) { 
    const modal = document.getElementById(id);
    if(modal) modal.classList.remove('active'); 
}

window.downloadFeedback = function(btn, url) {
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.style.opacity = "0.8";
    btn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Abriendo...`;
    
    setTimeout(() => {
        window.open(url, '_blank');
        setTimeout(() => {
            btn.innerHTML = originalContent;
            btn.disabled = false;
            btn.style.opacity = "1";
        }, 2000);
    }, 800);
}

