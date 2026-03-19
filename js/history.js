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
        alert("Sesion invalida o expirada. Inicia sesion nuevamente.");
        try { sessionStorage.removeItem("vidafem_session"); } catch (e) {}
        window.location.href = "index.html";
        return null;
    }
    return s;
}

function getRequesterFromSession() {
    const s = requireDoctorSession();
    if (!s) return null;
    return (s.data && (s.data.usuario || s.data.usuario_doctor || s.data.nombre_doctor)) || null;
}

function loadHistoryModule(patientId) {
    if (!requireDoctorSession()) return;

    const requester = getRequesterFromSession();
    if (!requester) return;

    fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "get_data", sheet: "pacientes", requester: requester })
    })
    .then(r => r.json())
    .then(res => {
        if (res.success) {
            const patient = res.data.find(p => String(p.id_paciente) === String(patientId));
            if (patient) renderCard1(patient);
        }
    });

    fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "get_history", id_paciente: patientId, requester: requester })
    })
    .then(r => r.json())
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

    fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "save_history", data: dataObj, requester: requester })
    })
    .then(r => r.json())
    .then(res => {
        if (res.success) {
            alert("Historia clinica actualizada.");
            inputs.forEach(inp => inp.disabled = true);
            btn.innerHTML = '<i class="fas fa-edit"></i> Editar Informacion';
            btn.style.background = "";
            btn.disabled = false;
        } else {
            alert("Error: " + res.message);
            btn.disabled = false;
        }
    })
    .catch(() => {
        alert("Error de conexion al guardar historia clinica.");
        btn.disabled = false;
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
