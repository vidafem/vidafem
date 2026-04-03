// js/history.js - Modulo de Historial Clinico

function getSessionDataSafe() {
    try {
        const raw = sessionStorage.getItem("vidafem_session");
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

function requireDoctorSession() {
    const s = getSessionDataSafe();
    const role = s && s.role ? String(s.role).toLowerCase() : "";
    if (!s || (role !== "admin" && role !== "doctor")) {
        alert("Sesión inválida o expirada. Inicia sesión nuevamente.");
        try { sessionStorage.removeItem("vidafem_session"); } catch (e) {}
        window.navigateWithEnv("index.html");
        return null;
    }
    return s;
}

function getRequesterFromSession() {
    const s = requireDoctorSession();
    if (!s) return null;
    return (s.data && (s.data.usuario || s.data.usuario_doctor || s.data.nombre_doctor)) || null;
}

function buildHistoryApiUrl_() {
    const baseUrl = String(API_URL || "").trim();
    if (!baseUrl) return "";
    const glue = baseUrl.indexOf("?") === -1 ? "?" : "&";
    return baseUrl + glue + "t=" + Date.now();
}

function postHistoryApiJson_(payload) {
    const body = Object.assign({}, payload || {});
    if (!body.session_token && typeof window.getSessionToken === "function") {
        const token = String(window.getSessionToken() || "").trim();
        if (token) body.session_token = token;
    }

    return fetch(buildHistoryApiUrl_(), {
        method: "POST",
        cache: "no-store",
        body: JSON.stringify(body)
    }).then(async (r) => {
        const text = await r.text();
        try {
            return text ? JSON.parse(text) : {};
        } catch (e) {
            throw new Error("Respuesta invalida del servidor.");
        }
    });
}

function historyComparableValue_(value) {
    const raw = String(value === undefined || value === null ? "" : value).trim();
    if (!raw) return "";
    return raw.indexOf("T") > -1 ? raw.split("T")[0] : raw;
}

function historyMatchesSavedData_(expected, actual) {
    const source = expected || {};
    const target = actual || {};
    const fields = [
        "app", "apf", "alergias", "aqx",
        "menarquia", "prs", "num_parejas",
        "ago_g", "ago_p", "ago_c", "ago_a",
        "fecha_aborto", "pap", "fum",
        "anticonceptivos", "tipo_anti", "tiempo_uso",
        "tipo_ultimo"
    ];

    return fields.every((key) => {
        return historyComparableValue_(source[key]) === historyComparableValue_(target[key]);
    });
}

function verifyHistorySaveAfterFetchError_(patientId, requester, expected) {
    return postHistoryApiJson_({
        action: "get_history",
        id_paciente: patientId,
        requester: requester
    })
    .then((res) => {
        return !!(res && res.success && res.data && historyMatchesSavedData_(expected, res.data));
    })
    .catch(() => false);
}

function loadHistoryModule(patientId) {
    if (!requireDoctorSession()) return;

    const requester = getRequesterFromSession();
    if (!requester) return;
    const useWorker = !!(window.VF_API_RUNTIME && window.VF_API_RUNTIME.backend === "worker");

    postHistoryApiJson_(useWorker
        ? { action: "get_patient_profile", id_paciente: patientId, requester: requester }
        : { action: "get_data", sheet: "pacientes", requester: requester })
    .then(res => {
        if (res.success) {
            const patient = useWorker
                ? res.data
                : ((Array.isArray(res.data) ? res.data : []).find(p => String(p.id_paciente) === String(patientId)));
            if (patient) renderCard1(patient);
        }
    });

    postHistoryApiJson_({ action: "get_history", id_paciente: patientId, requester: requester })
    .then(res => {
        if (res.success && res.data) {
            fillHistoryForm(res.data);
        }
    });
}

function renderCard1(p) {
    safeTextHistory("h_nombre", p.nombre_completo);
    safeTextHistory("h_cedula", p.cedula);
    safeTextHistory("h_fecha", formatDateShow(p.fecha_nacimiento));
    safeTextHistory("h_edad", calculateAgeHistory(p.fecha_nacimiento));
    safeTextHistory("h_ocupacion", p.ocupacion);
    safeTextHistory("h_direccion", p.direccion);
}

function fillHistoryForm(data) {
    const form = document.getElementById("formHistory");
    if (!form) return;

    const inputs = form.querySelectorAll("input:not([type='radio']), textarea, select");
    inputs.forEach(input => {
        if (data[input.name] !== undefined) {
            if (input.type === "date") {
                try { input.value = String(data[input.name]).split("T")[0]; } catch (e) {}
            } else {
                input.value = data[input.name];
            }
        }
    });

    if (data.tipo_ultimo) {
        const radio = form.querySelector(`input[name="tipo_ultimo"][value="${data.tipo_ultimo}"]`);
        if (radio) radio.checked = true;
    }
}

window.toggleGlobalEdit = function() {
    const btn = document.getElementById("btnGlobalEdit");
    const form = document.getElementById("formHistory");
    if (!form) {
        alert("Error critico: No se encuentra el formulario de historial. Recarga la pagina.");
        return;
    }

    const inputs = form.querySelectorAll(".history-input");
    if (btn.innerText.includes("Editar")) {
        inputs.forEach(inp => inp.disabled = false);
        btn.innerHTML = '<i class="fas fa-save"></i> Guardar Historia';
        btn.style.background = "#27ae60";
    } else {
        saveHistoryChanges(btn, inputs, form);
    }
};

function saveHistoryChanges(btn, inputs, form) {
    btn.innerText = "Guardando...";
    btn.disabled = true;

    const requester = getRequesterFromSession();
    if (!requester) {
        btn.disabled = false;
        btn.innerText = "Guardar Historia";
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const patientId = urlParams.get("id");
    let dataObj = { id_paciente: patientId };

    const formInputs = form.querySelectorAll("input:not([type='radio']), textarea, select");
    formInputs.forEach(i => dataObj[i.name] = i.value);

    const selectedRadio = form.querySelector('input[name="tipo_ultimo"]:checked');
    dataObj.tipo_ultimo = selectedRadio ? selectedRadio.value : "";

    postHistoryApiJson_({ action: "save_history", id_paciente: patientId, data: dataObj, requester: requester })
    .then(res => {
        if (res.success) {
            const msg = res.warning
                ? ("Historia clínica actualizada.\nAdvertencia: " + res.warning)
                : "Historia clínica actualizada.";
            alert(msg);
            if (res.warning && window.showToast) {
                window.showToast("Historia clínica guardada con advertencia de sincronización.", "warning");
            }
            inputs.forEach(inp => inp.disabled = true);
            btn.innerHTML = '<i class="fas fa-edit"></i> Editar Información';
            btn.style.background = "";
            btn.disabled = false;
        } else {
            alert("Error: " + res.message);
            btn.innerHTML = '<i class="fas fa-save"></i> Guardar Historia';
            btn.disabled = false;
        }
    })
    .catch(() => {
        verifyHistorySaveAfterFetchError_(patientId, requester, dataObj).then((recovered) => {
            if (recovered) {
                const fallbackMsg = "Historia clínica actualizada.\nAdvertencia: el navegador no pudo leer la respuesta del servidor, pero los datos si quedaron guardados.";
                alert(fallbackMsg);
                if (window.showToast) {
                    window.showToast("Historia clínica guardada con verificación posterior.", "warning");
                }
                inputs.forEach(inp => inp.disabled = true);
                btn.innerHTML = '<i class="fas fa-edit"></i> Editar Información';
                btn.style.background = "";
            } else {
                alert("Error de conexión al guardar historia clínica.");
                btn.innerHTML = '<i class="fas fa-save"></i> Guardar Historia';
            }
            btn.disabled = false;
        });
    });
}

function safeTextHistory(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text || "---";
}

function formatDateShow(dateString) {
    if (!dateString) return "-";
    const parts = dateString.split("T")[0].split("-");
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function calculateAgeHistory(dateString) {
    if (!dateString) return "-";
    const today = new Date();
    const birthDate = new Date(dateString);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age + " anos";
}
