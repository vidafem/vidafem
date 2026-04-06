// js/clinical.js - Controlador Principal del Expediente (Versión Blindada y Limpia)

// VARIABLE GLOBAL DEL ID PACIENTE
let currentPatientId = null;
let currentPatientName = "";
let currentPatientPhone = "";
let isSchedulingAppointment = false;
let isReschedulingAppointment = false;
let isDeletingReport = false;
let isDeletingDiagnosisAsset = false;
let currentDiagnosisAssetModalState = null;
let deletingAppointments = {};
let isRescheduleHoursLoading = false;
let rescheduleHoursRequestSeq = 0;
let bulkDeleteBySection = { citas: false, diagnosticos: false, evolucion: false };

const patientBulkSelectionState = {
    citas: { active: false, selected: new Set(), items: [] },
    diagnosticos: { active: false, selected: new Set(), items: [] },
    evolucion: { active: false, selected: new Set(), items: [] }
};

function getSessionDataSafe() {
    try {
        const raw = sessionStorage.getItem('vidafem_session');
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

function requireDoctorSession() {
    const s = getSessionDataSafe();
    const role = s && s.role ? String(s.role).toLowerCase() : "";
    const token = s ? String(s.session_token || "").trim() : "";
    if (!s || !token || (role !== "admin" && role !== "doctor")) {
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

function buildClinicalApiUrl_() {
    const baseUrl = String(API_URL || "").trim();
    if (!baseUrl) return "";
    const glue = baseUrl.indexOf("?") === -1 ? "?" : "&";
    return baseUrl + glue + "t=" + Date.now();
}

function postClinicalApiJson_(payload) {
    const body = Object.assign({}, payload || {});
    if (!body.session_token && typeof window.getSessionToken === "function") {
        const token = String(window.getSessionToken() || "").trim();
        if (token) body.session_token = token;
    }
    if (!body.session_token) {
        const session = getSessionDataSafe();
        const fallbackToken = session ? String(session.session_token || "").trim() : "";
        if (fallbackToken) body.session_token = fallbackToken;
    }

    return fetch(buildClinicalApiUrl_(), {
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

const DIAGNOSIS_ASSET_META = {
    report_pdf: {
        label: "informe",
        buttonLabel: "Reporte",
        color: "#36235d",
        icon: "fas fa-file-pdf",
        deleteTitle: "Borrar solo el PDF del informe"
    },
    recipe_pdf: {
        label: "receta",
        buttonLabel: "Receta",
        color: "#27ae60",
        icon: "fas fa-prescription-bottle-alt",
        deleteTitle: "Borrar solo el PDF de la receta"
    },
    certificate_pdf: {
        label: "certificado medico",
        buttonLabel: "Certificado",
        color: "#8e44ad",
        icon: "fas fa-file-medical",
        deleteTitle: "Borrar solo el PDF del certificado medico"
    },
    external_pdf: {
        label: "examen adjunto",
        buttonLabel: "Examen Adjunto",
        color: "#2980b9",
        icon: "fas fa-paperclip",
        deleteTitle: "Borrar solo el PDF adjunto"
    }
};

function escapeHtmlClinical_(value) {
    return String(value === undefined || value === null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function defaultDiagnosisExternalPdfLabelClinical_(value, fallbackIndex) {
    const raw = String(value || "").trim();
    if (raw) return raw.replace(/\.pdf$/i, "").trim() || raw;
    return "Adjunto PDF " + String(Number(fallbackIndex || 0) + 1);
}

function extractDriveFileIdFromDiagnosisUrlClinical_(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    let match = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) return match[1];
    match = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) return match[1];
    match = raw.match(/[-\w]{25,}/);
    return match && match[0] ? match[0] : "";
}

function normalizeDiagnosisExternalPdfItemsClinical_(payload) {
    const data = payload || {};
    const modern = Array.isArray(data.pdf_externos)
        ? data.pdf_externos
        : (Array.isArray(data.external_pdfs) ? data.external_pdfs : []);
    const list = modern.length ? modern : (data.pdf_externo_link ? [{
        id: extractDriveFileIdFromDiagnosisUrlClinical_(data.pdf_externo_link) || "external_pdf_1",
        label: defaultDiagnosisExternalPdfLabelClinical_(data.pdf_externo_nombre || data.titulo_adjunto || "Adjunto PDF", 0),
        url: data.pdf_externo_link,
        file_id: extractDriveFileIdFromDiagnosisUrlClinical_(data.pdf_externo_link),
        name: ""
    }] : []);

    return list.map((item, index) => {
        const current = item || {};
        const url = String(current.url || current.pdf_externo_link || "").trim();
        const fileId = String(current.file_id || current.fileId || extractDriveFileIdFromDiagnosisUrlClinical_(url) || "").trim();
        if (!url && !fileId) return null;
        return {
            id: String(current.id || fileId || ("external_pdf_" + (index + 1))).trim(),
            label: defaultDiagnosisExternalPdfLabelClinical_(current.label || current.nombre_visible || current.display_name || current.name, index),
            url: url,
            file_id: fileId,
            name: String(current.name || "").trim()
        };
    }).filter(Boolean);
}

function buildDiagnosisExternalPdfSummaryLabelClinical_(items) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return "Adjunto PDF";
    const first = String(list[0].label || "").trim();
    if (list.length === 1) return first || "Adjunto PDF";
    return (first || "Adjunto PDF") + " +" + String(list.length - 1);
}

function buildDiagnosisCardTitleClinical_(report, extraData) {
    const rep = report || {};
    const rawType = String(rep.tipo_examen || "").trim();
    const upperType = rawType.toUpperCase();
    const externalItems = normalizeDiagnosisExternalPdfItemsClinical_(extraData);
    const externalSummary = buildDiagnosisExternalPdfSummaryLabelClinical_(externalItems);
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
        if (externalItems.length) return externalSummary;
        if (String(extraData && extraData.pdf_receta_link || "").trim()) return "RECETA";
        return "ADJUNTO / RECETA";
    }
    return rawType || "REPORTE";
}

function buildDiagnosisAssetViewHtml_(assetType, url, customLabel) {
    const meta = DIAGNOSIS_ASSET_META[assetType];
    const cleanUrl = String(url || "").trim();
    if (!meta || !cleanUrl) return "";
    const buttonLabel = customLabel ? escapeHtmlClinical_(customLabel) : meta.buttonLabel;
    return `
        <button onclick='window.open(${JSON.stringify(cleanUrl)}, "_blank")' class="btn-mini" style="background:${meta.color}; color:white;">
            <i class="${meta.icon}"></i> ${buttonLabel}
        </button>
    `;
}

function buildDiagnosisAssetDeleteTriggerHtml_(reportId, docs) {
    const report = Object.assign({ id_reporte: String(reportId || "").trim() }, docs || {});
    return `
        <button onclick='openDiagnosisAssetManagerFromHistory(${JSON.stringify(encodeURIComponent(JSON.stringify(report)))})' style="background:none; border:none; color:#c0392b; cursor:pointer;" title="Abrir opciones de borrado">
            <i class="fas fa-trash"></i>
        </button>
    `;
}

function appointmentComparableValue_(value) {
    return String(value === undefined || value === null ? "" : value).trim();
}

function appointmentMatchesSavedData_(appointment, expected) {
    const row = appointment || {};
    const target = expected || {};
    return appointmentComparableValue_(row.fecha) === appointmentComparableValue_(target.fecha)
        && appointmentComparableValue_(row.hora) === appointmentComparableValue_(target.hora)
        && appointmentComparableValue_(row.motivo) === appointmentComparableValue_(target.motivo);
}

function verifyDoctorAppointmentSavedAfterFetchError_(requester, expected) {
    return postClinicalApiJson_({
        action: "get_patient_appointments",
        id_paciente: expected && expected.id_paciente,
        requester: requester
    })
    .then((res) => {
        if (!res || !res.success || !Array.isArray(res.data)) return null;
        return res.data.find((item) => appointmentMatchesSavedData_(item, expected)) || null;
    })
    .catch(() => null);
}

function verifyDoctorAppointmentRescheduledAfterFetchError_(requester, expected) {
    return postClinicalApiJson_({
        action: "get_patient_appointments",
        id_paciente: currentPatientId,
        requester: requester
    })
    .then((res) => {
        if (!res || !res.success || !Array.isArray(res.data)) return null;
        return res.data.find((item) => {
            return appointmentComparableValue_(item.id_cita) === appointmentComparableValue_(expected.id_cita)
                && appointmentComparableValue_(item.fecha) === appointmentComparableValue_(expected.nueva_fecha)
                && appointmentComparableValue_(item.hora) === appointmentComparableValue_(expected.nueva_hora);
        }) || null;
    })
    .catch(() => null);
}

function formatClinicalReportDate_(value) {
    const raw = String(value || "").trim();
    if (!raw) return "-";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const parts = raw.split("-");
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
        const dateOnly = raw.split("T")[0];
        const parts = dateOnly.split("-");
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString("es-EC");
    }
    return raw;
}

function openDoctorAppointmentSuccessModal_(result, data, fechaVal, horaVal, formEl) {
    window.closeModal('modalAppointment');
    if (formEl && typeof formEl.reset === "function") {
        formEl.reset();
    }

    const nombrePac = (result && result.nombre) || currentPatientName || "Paciente";
    const telPac = (result && result.telefono) || currentPatientPhone || "";
    const mensaje = `\n\nHola ${nombrePac}, tu cita ha sido agendada correctamente.\n\nFecha: ${fechaVal}\nHora: ${horaVal}\nLugar: Consultorio VIDAFEM Cdla. La Garzota. Av. Agustín Freire Icaza, diagonal a la Unidad Educativa Provincia de Tungurahua a 2 min del terminal terrestre.\n\n${data.recomendaciones ? '*Recomendaciones:* ' + data.recomendaciones : ''}`;

    const btnWa = document.getElementById('btnWaSuccess');
    const successTitle = document.getElementById('successApptTitle');
    const successText = document.getElementById('successApptText');
    if (successTitle) successTitle.innerText = "¡Cita agendada!";
    if (successText) successText.innerText = "La cita se ha guardado correctamente en el sistema.";

    const waNumber = normalizePhoneForWa_(telPac);
    if (btnWa) {
        if (waNumber) {
            btnWa.href = `https://wa.me/${waNumber}?text=${encodeURIComponent(mensaje)}`;
            btnWa.style.display = "flex";
            btnWa.innerHTML = '<i class="fab fa-whatsapp" style="font-size:1.2rem;"></i> Enviar Comprobante por WhatsApp';
        } else {
            btnWa.style.display = "none";
        }
    }

    window.openModal('modalSuccessAppt');

    if (typeof loadAppointmentHistory === 'function') {
        loadAppointmentHistory(currentPatientId);
    }
}

function normalizeDurationMinutes_(value) {
    const num = Number(value);
    return [30, 60, 120, 180, 240, 300].includes(num) ? num : 30;
}

function getSelectedServiceDurationMinutes_(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return 30;
    const opt = select.options[select.selectedIndex];
    return normalizeDurationMinutes_(opt ? opt.getAttribute('data-duration') : 30);
}

function setDoctorAppointmentTimePlaceholder_(message) {
    const timeSelect = document.getElementById('apptTime');
    if (!timeSelect) return;
    timeSelect.innerHTML = `<option value="">${message}</option>`;
    timeSelect.disabled = true;
}

function syncDoctorAppointmentFlow_() {
    const serviceSelect = document.getElementById('apptReason');
    const dateInput = document.getElementById('apptDate');
    if (!serviceSelect || !dateInput) return;

    const hasService = !!String(serviceSelect.value || "").trim();
    dateInput.disabled = !hasService;

    if (!hasService) {
        dateInput.value = "";
        setDoctorAppointmentTimePlaceholder_('Elige servicio primero...');
        return;
    }

    if (!dateInput.value) {
        setDoctorAppointmentTimePlaceholder_('Elige fecha...');
    }
}

function getPatientBulkState_(section) {
    return patientBulkSelectionState[section] || null;
}

function getPatientBulkConfig_(section) {
    const config = {
        citas: {
            toggleBtnId: "appointmentsBulkToggleBtn",
            barId: "appointmentsBulkBar",
            deleteBtnId: "appointmentsBulkDeleteBtn",
            deleteAction: "delete_bulk_citas",
            deleteButtonBaseText: "Eliminar Seleccionadas",
            confirmTitle: "Eliminar citas seleccionadas",
            confirmMessage: "Se borrarán las citas seleccionadas de este paciente. Esta acción no se puede deshacer.",
            emptySelectionMessage: "Selecciona al menos una cita para eliminar."
        },
        diagnosticos: {
            toggleBtnId: "diagnosisBulkToggleBtn",
            barId: "diagnosisBulkBar",
            deleteBtnId: "diagnosisBulkDeleteBtn",
            deleteAction: "delete_bulk_diagnosis",
            deleteButtonBaseText: "Eliminar Seleccionados",
            confirmTitle: "Eliminar diagnósticos seleccionados",
            confirmMessage: "Se borrarán los diagnósticos elegidos y sus archivos asociados. Esta acción no se puede deshacer.",
            emptySelectionMessage: "Selecciona al menos un diagnóstico para eliminar."
        },
        evolucion: {
            toggleBtnId: "evolutionBulkToggleBtn",
            barId: "evolutionBulkBar",
            deleteBtnId: "evolutionBulkDeleteBtn",
            deleteAction: "delete_bulk_patient_evolution",
            deleteButtonBaseText: "Eliminar Seleccionadas",
            confirmTitle: "Eliminar evoluciones seleccionadas",
            confirmMessage: "Se borrarán las evoluciones seleccionadas. Esta acción no se puede deshacer.",
            emptySelectionMessage: "Selecciona al menos una evolución para eliminar."
        }
    };
    return config[section] || null;
}

function getTodayLocalIso_() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function normalizePatientBulkId_(value) {
    return String(value === undefined || value === null ? "" : value).trim();
}

function isPatientBulkModeActive_(section) {
    const state = getPatientBulkState_(section);
    return !!(state && state.active);
}

function isPatientBulkItemSelected_(section, id) {
    const state = getPatientBulkState_(section);
    const key = normalizePatientBulkId_(id);
    return !!(state && key && state.selected.has(key));
}

function refreshPatientBulkSection_(section) {
    if (section === "citas") {
        loadAppointmentHistory(currentPatientId);
        return;
    }
    if (section === "diagnosticos") {
        loadDiagnosisHistory();
        return;
    }
    if (section === "evolucion" && typeof loadEvolutionModule === "function") {
        loadEvolutionModule();
    }
}

function updatePatientBulkBar_(section) {
    const state = getPatientBulkState_(section);
    const config = getPatientBulkConfig_(section);
    if (!state || !config) return;

    const toggleBtn = document.getElementById(config.toggleBtnId);
    const bulkBar = document.getElementById(config.barId);
    const deleteBtn = document.getElementById(config.deleteBtnId);
    const selectedCount = state.selected.size;
    const hasItems = Array.isArray(state.items) && state.items.length > 0;

    if (toggleBtn) {
        toggleBtn.innerHTML = state.active
            ? '<i class="fas fa-times"></i> Cancelar Selección'
            : '<i class="fas fa-check-square"></i> Seleccionar Varias';
    }

    if (bulkBar) {
        bulkBar.classList.toggle("active", !!state.active && hasItems);
    }

    if (deleteBtn) {
        deleteBtn.innerHTML = `<i class="fas fa-trash"></i> ${config.deleteButtonBaseText} (${selectedCount})`;
        deleteBtn.disabled = selectedCount === 0 || !!bulkDeleteBySection[section];
    }
}

function setPatientBulkItems_(section, items) {
    const state = getPatientBulkState_(section);
    if (!state) return;

    state.items = Array.isArray(items) ? items : [];
    const validIds = new Set(
        state.items
            .map(function(item) { return normalizePatientBulkId_(item && item.id); })
            .filter(Boolean)
    );

    state.selected = new Set(
        Array.from(state.selected).filter(function(id) {
            return validIds.has(id);
        })
    );

    if (!state.items.length) {
        state.active = false;
        state.selected.clear();
    }

    updatePatientBulkBar_(section);
}

function syncPatientBulkCardStates_(section) {
    const state = getPatientBulkState_(section);
    if (!state) return;

    document.querySelectorAll(`[data-bulk-section="${section}"][data-bulk-id]`).forEach(function(card) {
        const id = normalizePatientBulkId_(card.getAttribute("data-bulk-id"));
        const selected = !!id && state.selected.has(id);
        card.classList.toggle("bulk-selected-card", selected);

        const input = card.querySelector('.patient-bulk-check input[type="checkbox"]');
        if (input) input.checked = selected;
    });
}

function buildPatientBulkCheckboxHtml_(section, id, label) {
    if (!isPatientBulkModeActive_(section)) return "";
    const checked = isPatientBulkItemSelected_(section, id) ? "checked" : "";
    const safeIdLiteral = JSON.stringify(normalizePatientBulkId_(id));
    return `
        <label class="patient-bulk-check" onclick="event.stopPropagation();">
            <input type="checkbox" ${checked} onchange="togglePatientBulkItemSelection('${section}', ${safeIdLiteral}, this.checked)">
            <span>${label || "Seleccionar"}</span>
        </label>
    `;
}

window.togglePatientBulkMode = function(section, forceActive) {
    const state = getPatientBulkState_(section);
    if (!state) return;

    const shouldActivate = typeof forceActive === "boolean" ? forceActive : !state.active;
    state.active = shouldActivate;
    if (!shouldActivate) state.selected.clear();

    updatePatientBulkBar_(section);
    refreshPatientBulkSection_(section);
};

window.togglePatientBulkItemSelection = function(section, id, checked) {
    const state = getPatientBulkState_(section);
    const key = normalizePatientBulkId_(id);
    if (!state || !key) return;

    if (checked) state.selected.add(key);
    else state.selected.delete(key);

    updatePatientBulkBar_(section);
    syncPatientBulkCardStates_(section);
};

window.selectAllPatientBulkItems = function(section) {
    const state = getPatientBulkState_(section);
    if (!state) return;

    state.selected = new Set(
        (state.items || [])
            .map(function(item) { return normalizePatientBulkId_(item && item.id); })
            .filter(Boolean)
    );

    updatePatientBulkBar_(section);
    syncPatientBulkCardStates_(section);
};

window.clearPatientBulkSelection = function(section) {
    const state = getPatientBulkState_(section);
    if (!state) return;
    state.selected.clear();
    updatePatientBulkBar_(section);
    syncPatientBulkCardStates_(section);
};

window.selectOldPatientAppointments = function() {
    const state = getPatientBulkState_("citas");
    if (!state) return;

    state.selected = new Set(
        (state.items || [])
            .filter(function(item) { return !!(item && item.isPast); })
            .map(function(item) { return normalizePatientBulkId_(item && item.id); })
            .filter(Boolean)
    );

    updatePatientBulkBar_("citas");
    syncPatientBulkCardStates_("citas");
};

window.deleteSelectedPatientItems = async function(section) {
    const state = getPatientBulkState_(section);
    const config = getPatientBulkConfig_(section);
    if (!state || !config) return;

    const ids = Array.from(state.selected);
    if (!ids.length) {
        alert(config.emptySelectionMessage);
        return;
    }
    if (bulkDeleteBySection[section]) {
        alert("Ya se está procesando una eliminación masiva. Espera un momento.");
        return;
    }

    const ok = window.appConfirm
        ? await window.appConfirm({
            title: config.confirmTitle,
            message: `${config.confirmMessage}\n\nSeleccionados: ${ids.length}`,
            confirmText: "Sí, eliminar",
            cancelText: "Cancelar"
        })
        : confirm(config.confirmMessage);
    if (!ok) return;

    const requester = getRequesterFromSession();
    if (!requester || !currentPatientId) {
        alert("Sesión inválida o paciente no seleccionado.");
        return;
    }

    bulkDeleteBySection[section] = true;
    updatePatientBulkBar_(section);

    const deleteBtn = document.getElementById(config.deleteBtnId);
    const originalDeleteHtml = deleteBtn ? deleteBtn.innerHTML : "";
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Eliminando...';
    }

    postClinicalApiJson_({
        action: config.deleteAction,
        requester: requester,
        id_paciente: currentPatientId,
        ids: ids
    })
    .then(function(res) {
        if (!res.success) {
            alert("Error: " + (res.message || "No se pudo completar la eliminación masiva."));
            return;
        }

        const deletedCount = Number(res.deleted_count || ids.length || 0);
        alert(deletedCount === 1
            ? "Se eliminó 1 registro correctamente."
            : `Se eliminaron ${deletedCount} registros correctamente.`);

        state.selected.clear();
        refreshPatientBulkSection_(section);
    })
    .catch(function() {
        alert("Error de conexión al eliminar los registros seleccionados.");
    })
    .finally(function() {
        bulkDeleteBySection[section] = false;
        if (deleteBtn) deleteBtn.innerHTML = originalDeleteHtml;
        updatePatientBulkBar_(section);
    });
};

window.isPatientBulkModeActive_ = isPatientBulkModeActive_;
window.isPatientBulkItemSelected_ = isPatientBulkItemSelected_;
window.setPatientBulkItems_ = setPatientBulkItems_;
window.syncPatientBulkCardStates_ = syncPatientBulkCardStates_;

// Override with warning-aware toast handling for bulk deletions.
window.deleteSelectedPatientItems = async function(section) {
    const state = getPatientBulkState_(section);
    const config = getPatientBulkConfig_(section);
    if (!state || !config) return;

    const ids = Array.from(state.selected);
    if (!ids.length) {
        alert(config.emptySelectionMessage);
        return;
    }
    if (bulkDeleteBySection[section]) {
        alert("Ya se está procesando una eliminación masiva. Espera un momento.");
        return;
    }

    const ok = window.appConfirm
        ? await window.appConfirm({
            title: config.confirmTitle,
            message: `${config.confirmMessage}\n\nSeleccionados: ${ids.length}`,
            confirmText: "Sí, eliminar",
            cancelText: "Cancelar"
        })
        : confirm(config.confirmMessage);
    if (!ok) return;

    const requester = getRequesterFromSession();
    if (!requester || !currentPatientId) {
        alert("Sesión inválida o paciente no seleccionado.");
        return;
    }

    bulkDeleteBySection[section] = true;
    updatePatientBulkBar_(section);

    const deleteBtn = document.getElementById(config.deleteBtnId);
    const originalDeleteHtml = deleteBtn ? deleteBtn.innerHTML : "";
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Eliminando...';
    }

    postClinicalApiJson_({
        action: config.deleteAction,
        requester: requester,
        id_paciente: currentPatientId,
        ids: ids
    })
    .then(function(res) {
        if (!res.success) {
            alert("Error: " + (res.message || "No se pudo completar la eliminación masiva."));
            return;
        }

        const deletedCount = Number(res.deleted_count || ids.length || 0);
        const successMsg = deletedCount === 1
            ? "Se eliminó 1 registro correctamente."
            : `Se eliminaron ${deletedCount} registros correctamente.`;

        if (window.showToast) {
            window.showToast(
                res.warning
                    ? "Eliminación completada con advertencia de sincronización."
                    : successMsg,
                res.warning ? "warning" : "success"
            );
        } else if (res.warning) {
            alert(successMsg + "\nAdvertencia: " + res.warning);
        } else {
            alert(successMsg);
        }

        state.selected.clear();
        refreshPatientBulkSection_(section);
    })
    .catch(function() {
        alert("Error de conexión al eliminar los registros seleccionados.");
    })
    .finally(function() {
        bulkDeleteBySection[section] = false;
        if (deleteBtn) deleteBtn.innerHTML = originalDeleteHtml;
        updatePatientBulkBar_(section);
    });
};

// ==========================================
// 1. FUNCIONES GLOBALES (Modales y Utilidades)
// ==========================================
window.openModal = function(id) {
    const modal = document.getElementById(id);
    if(modal) modal.classList.add('active');
}

window.closeModal = function(id) {
    const modal = document.getElementById(id);
    if(modal) modal.classList.remove('active');
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. Validar sesión y obtener ID del paciente
    const sessionData = requireDoctorSession();
    if (!sessionData) return;

    // Obtener ID del paciente
    const urlParams = new URLSearchParams(window.location.search);
    const patientId = urlParams.get('id');
    const initialTab = String(urlParams.get('tab') || 'historial').toLowerCase();

    if (!patientId) {
        alert("Error: No se ha seleccionado un paciente. Volviendo al inicio.");
        window.navigateWithEnv("admin.html");
        return;
    }

    // Guardamos el ID en la variable global
    currentPatientId = patientId;
    
    // 2. Cargar Cabecera Mini (Siempre visible)
    loadMiniHeader(patientId, sessionData.data && (sessionData.data.usuario || sessionData.data.usuario_doctor));

    // 3. Cargar la pestaña por defecto (Historial Clínico)
    // Verificamos si existe la función antes de llamarla
    const tabToOpen = (initialTab === 'citas' || initialTab === 'diagnostico' || initialTab === 'evolucion') ? initialTab : 'historial';
    switchTab(tabToOpen);
    
    // 4. Configurar listeners de Citas si existen los elementos
    setupAppointmentListeners();
});

// Carga solo la barrita superior con ID y Edad
function loadMiniHeader(id) {
    const nameLabel = document.getElementById('clinName');
    if(nameLabel) nameLabel.innerText = "Cargando...";
    const requester = arguments[1] || null;
    const useWorker = !!(window.VF_API_RUNTIME && window.VF_API_RUNTIME.backend === "worker");
    const body = useWorker
        ? { action: "get_patient_profile", id_paciente: id, requester: requester }
        : { action: "get_data", sheet: "pacientes", requester: requester };

    postClinicalApiJson_(body)
    .then(response => {
        if (response.success) {
            const patient = useWorker
                ? response.data
                : ((Array.isArray(response.data) ? response.data : []).find(p => String(p.id_paciente) === String(id)));
            if (patient) {
                currentPatientName = String(patient.nombre_completo || "");
                currentPatientPhone = String(patient.telefono || "");
                safeText('headerPatientName', patient.nombre_completo);
                safeText('clinName', patient.nombre_completo);
                safeText('clinId', "ID: " + patient.cedula);
                safeText('clinAge', calculateAge(patient.fecha_nacimiento));
            }
        }
    });
}

function safeText(elementId, text) {
    const el = document.getElementById(elementId);
    if (el) el.innerText = text || "---";
}

function calculateAge(dateString) {
    if (!dateString) return "-";
    const today = new Date();
    const birthDate = new Date(dateString);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age + " años";
}

// ==========================================
// 2. SISTEMA DE PESTAÑAS (ROUTER)
// ==========================================
window.switchTab = function(tabName) {
    const safeTab = (tabName === 'citas' || tabName === 'diagnostico' || tabName === 'evolucion') ? tabName : 'historial';

    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.querySelectorAll('.menu-link[data-tab]').forEach(link => link.classList.remove('active'));

    const target = document.getElementById(`tab-${safeTab}`);
    if(target) target.classList.add('active');

    const activeLink = document.querySelector(`.menu-link[data-tab="${safeTab}"]`);
    if (activeLink) activeLink.classList.add('active');

    const id = currentPatientId;
    if (safeTab === 'historial' && typeof loadHistoryModule === 'function') {
        loadHistoryModule(id);
    }
    if (safeTab === 'citas') {
        loadAppointmentHistory(id);
    }
    if (safeTab === 'diagnostico') {
        loadDiagnosisHistory();
    }
    if (safeTab === 'evolucion' && typeof loadEvolutionModule === 'function') {
        loadEvolutionModule();
    }
}

// ==========================================
// 3. MÓDULO DE CITAS (LISTADO Y AGENDAMIENTO)
// ==========================================
function loadAppointmentHistory(patientId) {
    const container = document.querySelector('#tab-citas .clinical-timeline-container');
    if (!container) return; 
    
    container.innerHTML = '<p>Cargando historial...</p>';

    postClinicalApiJson_({
        action: "get_patient_appointments",
        id_paciente: patientId,
        requester: (function(){ try{ const s=JSON.parse(sessionStorage.getItem('vidafem_session')||'null'); return s && (s.data && (s.data.usuario || s.data.usuario_doctor || s.data.nombre_doctor)) ? (s.data.usuario || s.data.usuario_doctor || s.data.nombre_doctor) : null; }catch(e){return null;} })()
    })
    .then(res => {
        container.innerHTML = ""; 
        if (res.success && res.data.length > 0) {
            const todayIso = getTodayLocalIso_();
            setPatientBulkItems_("citas", res.data.map(function(cita) {
                return {
                    id: cita.id_cita,
                    isPast: String(cita.fecha || "") < todayIso
                };
            }));

            res.data.forEach(cita => {
                const item = document.createElement('div');
                item.className = "card";
                item.setAttribute("data-bulk-section", "citas");
                item.setAttribute("data-bulk-id", String(cita.id_cita || ""));
                item.style.marginBottom = "10px";
                item.style.borderLeft = "4px solid #ccc";
                
                let estadoColor = "#ccc";
                let icon = "fa-clock";
                
                if(cita.estado === "ASISTIO") { item.style.borderLeftColor = "#27ae60"; estadoColor = "#27ae60"; icon = "fa-check-circle"; }
                if(cita.estado === "NO_ASISTIO") { item.style.borderLeftColor = "#e74c3c"; estadoColor = "#e74c3c"; icon = "fa-times-circle"; }
                if(cita.estado === "REAGENDADO") { item.style.borderLeftColor = "#f39c12"; estadoColor = "#f39c12"; icon = "fa-history"; }

                const bulkCheckHtml = buildPatientBulkCheckboxHtml_("citas", cita.id_cita, "Seleccionar");
                item.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <h4 style="margin:0; color:var(--c-primary);"><i class="fas fa-calendar-day"></i> ${cita.fecha} <small style="color:#666; margin-left:10px;">${cita.hora}</small></h4>
                            <p style="margin:5px 0;">${cita.motivo}</p>
                            ${cita.recomendaciones ? `<small style="color:#e67e22;">${cita.recomendaciones}</small>` : ''}
                        </div>
                        <div style="text-align:right; display:flex; flex-direction:column; gap:5px; align-items:flex-end;">
                            ${bulkCheckHtml}
                            <span style="color:${estadoColor}; font-weight:bold; font-size:0.9rem;">
                                <i class="fas ${icon}"></i> ${cita.estado}
                            </span>
                            <div style="display:flex; gap:5px;">
                                <button onclick="openReschedule('${cita.id_cita}')" style="background:#fff; border:1px solid #f39c12; color:#f39c12; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:0.8rem;">
                                    <i class="fas fa-edit"></i> Reagendar
                                </button>
                                <button onclick="deleteAppointmentFromUI('${cita.id_cita}')" style="background:#fff; border:1px solid #e74c3c; color:#e74c3c; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:0.8rem;">
                                    <i class="fas fa-trash"></i> Borrar
                                </button>
                            </div>
                        </div>
                    </div>
                `;
                container.appendChild(item);
            });
            syncPatientBulkCardStates_("citas");
        } else {
            setPatientBulkItems_("citas", []);
            container.innerHTML = `<div class="empty-state"><p>No hay citas registradas.</p></div>`;
        }
    });
}

window.openAppointmentModal = function() {
    const id = currentPatientId;
    const form = document.getElementById('formAppointment');
    if (form) form.reset();

    const inputId = document.getElementById('apptPatientId');
    if(inputId) inputId.value = id;

    const select = document.getElementById('apptReason');
    const txtRecs = document.getElementById('apptRecs');
    const dateInput = document.getElementById('apptDate');
    if (dateInput) {
        dateInput.min = new Date().toISOString().split('T')[0];
        dateInput.value = "";
        dateInput.disabled = true;
        dateInput.onchange = loadAvailableHours;
    }
    setDoctorAppointmentTimePlaceholder_('Elige servicio primero...');

    if(select) {
        select.innerHTML = '<option>Cargando servicios...</option>';
        const requester = getRequesterFromSession();
        const loadServicesPromise = (window.vfDataBridge && window.vfDataBridge.getServices)
            ? window.vfDataBridge.getServices(requester)
            : postClinicalApiJson_({ action: "get_services", requester: requester });
        loadServicesPromise
        .then(res => {
            select.innerHTML = '<option value="">Selecciona un servicio...</option>';
            
            if(res.success && res.data.length > 0) {
                res.data.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.nombre_servicio;
                    opt.innerText = s.nombre_servicio;
                    opt.setAttribute('data-recs', s.recomendaciones || "");
                    opt.setAttribute('data-duration', s.duracion_minutos || 30);
                    select.appendChild(opt);
                });
            }
        });

        select.onchange = function() {
            const selectedOption = select.options[select.selectedIndex];
            const savedRecs = selectedOption ? selectedOption.getAttribute('data-recs') : "";
            if(txtRecs) {
                if (savedRecs) {
                    txtRecs.value = savedRecs;
                    txtRecs.style.backgroundColor = "#fff9c4";
                    setTimeout(() => txtRecs.style.backgroundColor = "#fff", 500);
                } else {
                    txtRecs.value = "";
                }
            }
            syncDoctorAppointmentFlow_();
            if ((document.getElementById('apptDate') || {}).value) loadAvailableHours();
        };

        syncDoctorAppointmentFlow_();
    }

    window.openModal('modalAppointment');
}

function loadAvailableHours() {
    const dateInput = document.getElementById('apptDate');
    const timeSelect = document.getElementById('apptTime');
    const serviceSelect = document.getElementById('apptReason');
    const dateVal = dateInput ? dateInput.value : "";
    const serviceVal = serviceSelect ? String(serviceSelect.value || "").trim() : "";
    if(!timeSelect) return;

    if (!serviceVal) {
        if (dateInput) dateInput.disabled = true;
        setDoctorAppointmentTimePlaceholder_('Elige servicio primero...');
        return;
    }

    if (dateInput) dateInput.disabled = false;
    if(!dateVal) {
        setDoctorAppointmentTimePlaceholder_('Elige fecha...');
        return;
    }

    const durationMinutes = getSelectedServiceDurationMinutes_('apptReason');
    
    timeSelect.innerHTML = '<option>Verificando...</option>';
    timeSelect.disabled = true;

    postClinicalApiJson_({
        action: "get_taken_slots",
        fecha: dateVal,
        requester: getRequesterFromSession(),
        mode: "available",
        duration_minutes: durationMinutes
    })
    .then(res => {
        const available = res.data || [];
        timeSelect.innerHTML = "";
        timeSelect.disabled = false;
        
        let hasSlots = false;
        available.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.innerText = t;
            timeSelect.appendChild(opt);
            hasSlots = true;
        });
        if(!hasSlots) {
            timeSelect.innerHTML = '<option value="">Sin cupos</option>';
            timeSelect.disabled = true;
            return;
        }
        timeSelect.insertAdjacentHTML('afterbegin', '<option value="">Selecciona hora...</option>');
    })
    .catch(() => {
        setDoctorAppointmentTimePlaceholder_('No se pudo verificar horarios');
    });
}

function setupAppointmentListeners() {
    const formAppt = document.getElementById('formAppointment');
    if(formAppt) {
        const newForm = formAppt.cloneNode(true);
        formAppt.parentNode.replaceChild(newForm, formAppt);
        
        newForm.addEventListener('submit', function(e) {
            e.preventDefault();
            if (isSchedulingAppointment) {
                alert("Ya se esta procesando la cita. Espera un momento.");
                return;
            }
            const btn = this.querySelector('button');
            const originalText = btn.innerText;
            btn.disabled = true; btn.innerText = "Enviando...";
            isSchedulingAppointment = true;

            const fechaVal = document.getElementById('apptDate').value;
            const horaVal = document.getElementById('apptTime').value;
            const motivoVal = document.getElementById('apptReason').value;
            const requesterDoc = getRequesterFromSession();

            if (!requesterDoc) {
                alert("Sesión inválida. Inicia sesión nuevamente.");
                btn.disabled = false; btn.innerText = originalText;
                isSchedulingAppointment = false;
                return;
            }
            if (!fechaVal) {
                alert("Selecciona una fecha para la cita.");
                btn.disabled = false; btn.innerText = originalText;
                isSchedulingAppointment = false;
                return;
            }
            if (!horaVal || horaVal === "Sin cupos" || /selecciona/i.test(horaVal)) {
                alert("Selecciona una hora válida para la cita.");
                btn.disabled = false; btn.innerText = originalText;
                isSchedulingAppointment = false;
                return;
            }
            if (!motivoVal || !motivoVal.trim()) {
                alert("Ingresa el motivo de la cita.");
                btn.disabled = false; btn.innerText = originalText;
                isSchedulingAppointment = false;
                return;
            }

            const data = {
                id_paciente: document.getElementById('apptPatientId').value,
                fecha: fechaVal,
                hora: horaVal,
                motivo: motivoVal + " | Nota: " + document.getElementById('apptNotes').value,
                servicio_nombre: motivoVal,
                recomendaciones: document.getElementById('apptRecs').value,
                duracion_minutos: getSelectedServiceDurationMinutes_('apptReason'),
                creado_por: "DOCTOR"
            };
            postClinicalApiJson_({ action: "schedule_appointment", data: data, requester: requesterDoc })
            .then(res => {
                if (res.success) {
                    window.closeModal('modalAppointment');
                    this.reset();
                    if (res.warning && window.showToast) {
                        window.showToast(String(res.warning), "warning");
                    } else if (res.warning) {
                        alert("Advertencia: " + res.warning);
                    }
                    
                    const nombrePac = res.nombre || "Paciente";
                    const telPac = res.telefono || "";
                    const mensaje = `\n\nHola ${nombrePac}, tu cita ha sido agendada correctamente.\n\nFecha: ${fechaVal}\nHora: ${horaVal}\nLugar: Consultorio VIDAFEM Cdla. La Garzota. Av. Agustín Freire Icaza, diagonal a la Unidad Educativa Provincia de Tungurahua a 2 min del terminal terrestre.\n\n${data.recomendaciones ? '*Recomendaciones:* ' + data.recomendaciones : ''}`;
                    
                    const btnWa = document.getElementById('btnWaSuccess');
                    const successTitle = document.getElementById('successApptTitle');
                    const successText = document.getElementById('successApptText');
                    if (successTitle) successTitle.innerText = "¡Cita agendada!";
                    if (successText) successText.innerText = "La cita se ha guardado correctamente en el sistema.";
                    
                    const waNumber = normalizePhoneForWa_(telPac);
                    if (waNumber) {
                        btnWa.href = `https://wa.me/${waNumber}?text=${encodeURIComponent(mensaje)}`;
                        btnWa.style.display = "flex";
                        btnWa.innerHTML = '<i class="fab fa-whatsapp" style="font-size:1.2rem;"></i> Enviar Comprobante por WhatsApp';
                    } else {
                        btnWa.style.display = "none"; 
                    }

                    window.openModal('modalSuccessAppt');

                    if(typeof loadAppointmentHistory === 'function') {
                        loadAppointmentHistory(currentPatientId);
                    }
                } else {
                    alert(res.message);
                }
            })
            .catch(() => {
                verifyDoctorAppointmentSavedAfterFetchError_(requesterDoc, data).then((recovered) => {
                    if (recovered) {
                        openDoctorAppointmentSuccessModal_(recovered, data, fechaVal, horaVal, this);
                        if (window.showToast) {
                            window.showToast("La cita se guardo, pero el navegador no pudo leer la respuesta del servidor.", "warning");
                        }
                    } else {
                        alert("Error de conexión al agendar la cita.");
                    }
                });
            })
            .finally(() => {
                btn.disabled = false;
                btn.innerText = originalText;
                isSchedulingAppointment = false;
            });
        });
    }
}

window.openReschedule = function(idCita) {
    const inputId = document.getElementById('reschIdCita');
    const dateIn = document.getElementById('reschDate');
    const timeIn = document.getElementById('reschTime');
    
    if(inputId) inputId.value = idCita;
    if(dateIn) {
        dateIn.value = "";
        dateIn.min = new Date().toISOString().split('T')[0];
        dateIn.onchange = loadRescheduleHours;
    }
    if(timeIn) {
        timeIn.innerHTML = '<option value="">Selecciona fecha...</option>';
        timeIn.disabled = true;
        timeIn.onchange = updateDoctorRescheduleSubmitState;
    }
    
    window.openModal('modalReschedule');
    isRescheduleHoursLoading = false;
    updateDoctorRescheduleSubmitState();
}

function updateDoctorRescheduleSubmitState() {
    const form = document.getElementById('formReschedule');
    if (!form) return;
    const btn = form.querySelector('button[type="submit"]');
    const dateVal = (document.getElementById('reschDate') || {}).value || "";
    const timeVal = (document.getElementById('reschTime') || {}).value || "";
    const canSubmit = !!dateVal && !!timeVal && !isRescheduleHoursLoading && !isReschedulingAppointment;
    if (btn) btn.disabled = !canSubmit;
}

function loadRescheduleHours() {
    const dateVal = document.getElementById('reschDate').value;
    const timeSelect = document.getElementById('reschTime');
    if(!timeSelect) return;
    if(!dateVal) {
        timeSelect.innerHTML = '<option value="">Selecciona fecha...</option>';
        timeSelect.disabled = true;
        updateDoctorRescheduleSubmitState();
        return;
    }
    
    const reqId = ++rescheduleHoursRequestSeq;
    isRescheduleHoursLoading = true;
    timeSelect.disabled = true;
    timeSelect.innerHTML = '<option value="">Verificando disponibilidad...</option>';
    updateDoctorRescheduleSubmitState();

    postClinicalApiJson_({
        action: "get_taken_slots",
        fecha: dateVal,
        requester: getRequesterFromSession(),
        mode: "available",
        appointment_id: document.getElementById('reschIdCita').value
    })
    .then(res => {
        if (reqId !== rescheduleHoursRequestSeq) return;
        const available = res.data || [];
        timeSelect.innerHTML = "";
        available.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.innerText = t;
            timeSelect.appendChild(opt);
        });
        if (timeSelect.children.length === 0) {
            timeSelect.innerHTML = '<option value="">Sin horarios disponibles</option>';
            timeSelect.disabled = true;
        } else {
            timeSelect.insertAdjacentHTML('afterbegin', '<option value="">Selecciona hora...</option>');
            timeSelect.disabled = false;
        }
    })
    .catch(() => {
        if (reqId !== rescheduleHoursRequestSeq) return;
        timeSelect.innerHTML = '<option value="">No se pudo verificar horarios</option>';
        timeSelect.disabled = true;
        alert("Error de conexión al consultar horarios.");
    })
    .finally(() => {
        if (reqId !== rescheduleHoursRequestSeq) return;
        isRescheduleHoursLoading = false;
        updateDoctorRescheduleSubmitState();
    });
}

function normalizePhoneForWa_(phone) {
    if (!phone) return "";
    let digits = String(phone).replace(/[^\d]/g, "");
    if (!digits) return "";
    if (digits.length === 10 && digits.charAt(0) === "0") digits = "593" + digits.substring(1);
    else if (digits.length === 9) digits = "593" + digits;
    return digits;
}

function buildPatientRescheduleWaLink_() {
    const num = normalizePhoneForWa_(currentPatientPhone);
    if (!num) return "";
    const msg = [
        "Hola, su cita ha sido reagendada.",
        "Nueva fecha: " + (document.getElementById('reschDate') ? document.getElementById('reschDate').value : ""),
        "Nueva hora: " + (document.getElementById('reschTime') ? document.getElementById('reschTime').value : ""),
        "Gracias por preferirnos."
    ].join("\n");
    return "https://wa.me/" + num + "?text=" + encodeURIComponent(msg);
}

function openDoctorRescheduleSuccessModal_() {
    const title = document.getElementById('successApptTitle');
    const text = document.getElementById('successApptText');
    const btnWa = document.getElementById('btnWaSuccess');
    if (title) title.innerText = "Cita reagendada!";
    if (text) text.innerText = "La cita se reagendo correctamente en el sistema.";
    if (btnWa) {
        const link = buildPatientRescheduleWaLink_();
        if (link) {
            btnWa.href = link;
            btnWa.style.display = "flex";
            btnWa.innerHTML = '<i class="fab fa-whatsapp" style="font-size:1.2rem;"></i> Avisar por WhatsApp al paciente';
        } else {
            btnWa.style.display = "none";
        }
    }
    window.openModal('modalSuccessAppt');
}

const formResch = document.getElementById('formReschedule');
if(formResch) {
    formResch.addEventListener('submit', function(e) {
        e.preventDefault();
        if (isReschedulingAppointment) {
            alert("Ya se esta procesando el reagendamiento. Espera un momento.");
            return;
        }
        if (isRescheduleHoursLoading) {
            alert("Espera a que termine la verificación de horarios.");
            return;
        }
        const btn = this.querySelector('button');
        const originalText = btn.innerText;
        if (!btn) return;
        btn.disabled = true; btn.innerText = "Procesando...";
        isReschedulingAppointment = true;
        
        const data = {
            id_cita: document.getElementById('reschIdCita').value,
            nueva_fecha: document.getElementById('reschDate').value,
            nueva_hora: document.getElementById('reschTime').value
        };
        const requesterDoc = getRequesterFromSession();
        if (!requesterDoc) {
            alert("Sesión inválida. Inicia sesión nuevamente.");
            btn.disabled = false; btn.innerText = originalText;
            isReschedulingAppointment = false;
            return;
        }
        if (!data.id_cita) {
            alert("No se encontró la cita a reagendar.");
            btn.disabled = false; btn.innerText = originalText;
            isReschedulingAppointment = false;
            return;
        }
        if (!data.nueva_fecha) {
            alert("Selecciona la nueva fecha.");
            btn.disabled = false; btn.innerText = originalText;
            isReschedulingAppointment = false;
            return;
        }
        if (!data.nueva_hora || /cargando|selecciona|sin cupos/i.test(data.nueva_hora)) {
            alert("Selecciona una nueva hora válida.");
            btn.disabled = false; btn.innerText = originalText;
            isReschedulingAppointment = false;
            return;
        }

        postClinicalApiJson_({ action: "reschedule_appointment", data: data, requester: requesterDoc })
        .then(res => {
            if(res.success) {
                window.closeModal('modalReschedule');
                loadAppointmentHistory(currentPatientId);
                openDoctorRescheduleSuccessModal_();
                if (res.warning && window.showToast) {
                    window.showToast(String(res.warning), "warning");
                } else if (res.warning) {
                    alert("Advertencia: " + res.warning);
                }
            } else {
                alert("Error: " + res.message);
            }
        })
        .catch(() => {
            verifyDoctorAppointmentRescheduledAfterFetchError_(requesterDoc, data).then((recovered) => {
                if (recovered) {
                    window.closeModal('modalReschedule');
                    loadAppointmentHistory(currentPatientId);
                    openDoctorRescheduleSuccessModal_();
                    if (window.showToast) {
                        window.showToast("La cita se reagendo, pero el navegador no pudo leer la respuesta del servidor.", "warning");
                    }
                } else {
                    alert("Error de conexión al reagendar cita");
                }
            });
        })
        .finally(() => {
            btn.disabled = false;
            btn.innerText = originalText;
            isReschedulingAppointment = false;
            updateDoctorRescheduleSubmitState();
        });
    });
}

// 1. Función para IR a la nueva página de creación
function goToNewDiagnosis() {
    if(currentPatientId) {
        window.navigateWithEnv(`diagnostico.html?patientId=${currentPatientId}&tab=diagnostico`);
    } else {
        alert("Error: No hay paciente seleccionado.");
    }
}

// ==========================================
// 4. MÓDULO DE DIAGNÓSTICOS (VISUALIZACIÓN)
// ==========================================

function loadDiagnosisHistory() {
    const container = document.getElementById('diagnosisHistoryList');
    if(!container) return;
    
    container.innerHTML = '<div style="text-align:center; padding:20px; color:#666;"><i class="fas fa-circle-notch fa-spin"></i> Buscando expedientes...</div>';

    // Obtener requester desde la sesión
    let requesterDoc = null;
    try {
        const s = sessionStorage.getItem('vidafem_session');
        if (s) requesterDoc = JSON.parse(s).data.usuario;
    } catch (e) {}
    postClinicalApiJson_({ action: "get_diagnosis_history", id_paciente: currentPatientId, requester: requesterDoc })
    .then(res => {
        container.innerHTML = "";
        
        if (res.success && res.data && res.data.length > 0) {
            setPatientBulkItems_("diagnosticos", res.data.map(function(rep) {
                return { id: rep.id_reporte };
            }));

            res.data.forEach(rep => {
                
                // 1. Extraer datos guardados (JSON)
                let extraData = {};
                try {
                    // A veces viene como string, a veces como objeto
                    extraData = (typeof rep.datos_json === 'string') ? JSON.parse(rep.datos_json) : rep.datos_json;
                } catch(e) { console.warn("Error leyendo JSON", e); }

                // 2. CONSTRUIR BOTONES
                let botonesHtml = "";
                const docLinks = {
                    report_pdf: String(rep.pdf_url || "").trim(),
                    recipe_pdf: String(extraData.pdf_receta_link || "").trim(),
                    certificate_pdf: String(extraData.pdf_certificado_link || "").trim(),
                    external_pdfs: normalizeDiagnosisExternalPdfItemsClinical_(extraData)
                };

                // A. VER REPORTE (El PDF principal)
                if (docLinks.report_pdf) {
                    botonesHtml += buildDiagnosisAssetViewHtml_("report_pdf", docLinks.report_pdf);
                }

                // B. VER RECETA (Si existe link guardado)
                if (docLinks.recipe_pdf) {
                    botonesHtml += buildDiagnosisAssetViewHtml_("recipe_pdf", docLinks.recipe_pdf);
                }

                if (docLinks.certificate_pdf) {
                    botonesHtml += buildDiagnosisAssetViewHtml_("certificate_pdf", docLinks.certificate_pdf);
                }

                // C. VER EXAMEN SUBIDO (Si existe link guardado)
                if (docLinks.external_pdfs.length) {
                    botonesHtml += docLinks.external_pdfs.map((item) => {
                        return buildDiagnosisAssetViewHtml_("external_pdf", item.url, item.label);
                    }).join("");
                }

                // D. EDITAR (Solo carga los datos en el formulario)
                // Usamos editReportRedirect que ya definimos o definiremos
                botonesHtml += `
                    <button onclick="editReportRedirect('${rep.id_reporte}')" class="btn-mini" style="background:#f39c12; color:white;">
                        <i class="fas fa-edit"></i> Editar
                    </button>
                `;

                const btnEliminar = buildDiagnosisAssetDeleteTriggerHtml_(rep.id_reporte, docLinks);
                const bulkCheckHtml = buildPatientBulkCheckboxHtml_("diagnosticos", rep.id_reporte, "Seleccionar");
                const reportTypeUpper = String(rep.tipo_examen || "").trim().toUpperCase();
                const cardAccentColor = reportTypeUpper === "RECETA"
                    ? "#27ae60"
                    : ((reportTypeUpper === "EXAMENPDF" || reportTypeUpper === "EXAMEN PDF") ? "#2980b9" : "#36235d");

                // 3. DIBUJAR TARJETA
                const card = document.createElement('div');
                card.className = "card";
                card.setAttribute("data-bulk-section", "diagnosticos");
                card.setAttribute("data-bulk-id", String(rep.id_reporte || ""));
                card.style.borderLeft = "5px solid " + cardAccentColor; 
                card.style.marginBottom = "15px";
                card.style.padding = "15px";
                
                const reportTitle = buildDiagnosisCardTitleClinical_(rep, extraData);

                card.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div>
                            <h4 style="margin:0; color:${cardAccentColor}; text-transform:uppercase;">${escapeHtmlClinical_(reportTitle)}</h4>
                            <small style="color:#777;">
                                <i class="far fa-calendar-alt"></i> ${formatClinicalReportDate_(extraData.fecha_reporte || rep.fecha_reporte || rep.fecha)} 
                            </small>
                        </div>
                        <div style="display:flex; align-items:center; gap:10px;">
                            ${bulkCheckHtml}
                            ${btnEliminar}
                        </div>
                    </div>
                    
                    <div style="margin-top:15px; display:flex; gap:10px; flex-wrap:wrap;">
                        ${botonesHtml}
                    </div>
                `;
                container.appendChild(card);
            });
            syncPatientBulkCardStates_("diagnosticos");

        } else {
            setPatientBulkItems_("diagnosticos", []);
            container.innerHTML = `<p style="text-align:center; color:#888;">No hay reportes registrados.</p>`;
        }
    });
}

// Estilos dinámicos para los botones pequeños
const style = document.createElement('style');
style.innerHTML = `
  .btn-mini { padding: 5px 10px; border:none; border-radius:4px; font-size:0.85rem; cursor:pointer; display:flex; align-items:center; gap:5px; }
  .btn-mini:hover { opacity: 0.9; }
  .patient-bulk-bar { display:none; gap:10px; flex-wrap:wrap; margin:0 0 16px; padding:12px; border:1px dashed #d5d9e2; border-radius:12px; background:#f8fafc; }
  .patient-bulk-bar.active { display:flex; }
  .patient-bulk-check { display:inline-flex; align-items:center; gap:8px; padding:4px 8px; border-radius:999px; background:#eef2f7; color:#4c5b6b; font-size:0.82rem; cursor:pointer; user-select:none; }
  .patient-bulk-check input { width:16px; height:16px; margin:0; cursor:pointer; }
  .bulk-selected-card { box-shadow: 0 0 0 2px rgba(54, 35, 93, 0.18); background:#fcfbff; }
`;
document.head.appendChild(style);

function normalizeDiagnosisAssetModalState_(state) {
    const src = state || {};
    return {
        id_reporte: String(src.id_reporte || "").trim(),
        report_pdf: String(src.report_pdf || src.pdf_url || "").trim(),
        recipe_pdf: String(src.recipe_pdf || src.pdf_receta_link || "").trim(),
        certificate_pdf: String(src.certificate_pdf || src.pdf_certificado_link || "").trim(),
        external_pdfs: normalizeDiagnosisExternalPdfItemsClinical_(src)
    };
}

function buildDiagnosisAssetManagerActionButton_(options) {
    const opts = options || {};
    const tone = String(opts.tone || "danger").trim().toLowerCase();
    const palette = tone === "danger"
        ? { bg: "#fff5f5", border: "#f3c3c3", color: "#b42318", iconBg: "#fdecec" }
        : { bg: "#f8fafc", border: "#d8e2ee", color: "#1f4f7a", iconBg: "#eef4fb" };

    return `
        <button type="button" onclick="${opts.action}" style="display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%; padding:14px 16px; border-radius:14px; border:1px solid ${palette.border}; background:${palette.bg}; color:${palette.color}; cursor:pointer; text-align:left;">
            <span style="display:flex; align-items:center; gap:12px;">
                <span style="display:inline-flex; align-items:center; justify-content:center; width:38px; height:38px; border-radius:999px; background:${palette.iconBg};">
                    <i class="${opts.icon || "fas fa-file"}"></i>
                </span>
                <span>
                    <strong style="display:block; font-size:0.98rem;">${opts.title || ""}</strong>
                    <small style="display:block; color:#667085; margin-top:2px;">${opts.description || ""}</small>
                </span>
            </span>
            <i class="fas fa-chevron-right" style="opacity:0.65;"></i>
        </button>
    `;
}

function renderDiagnosisAssetManagerModal_() {
    const box = document.getElementById("diagnosisAssetManagerOptions");
    if (!box) return;

    const state = normalizeDiagnosisAssetModalState_(currentDiagnosisAssetModalState);
    let html = "";

    ["report_pdf", "recipe_pdf", "certificate_pdf"].forEach((key) => {
        if (!state[key]) return;
        const meta = DIAGNOSIS_ASSET_META[key];
        html += buildDiagnosisAssetManagerActionButton_({
            action: `deleteDiagnosisAssetFromHistory('${key}')`,
            icon: meta.icon,
            title: "Borrar " + meta.label,
            description: "Solo se elimina el PDF seleccionado. Los datos clinicos se conservan."
        });
    });

    state.external_pdfs.forEach((item) => {
        const label = String(item.label || "Adjunto PDF").trim();
        html += buildDiagnosisAssetManagerActionButton_({
            action: `deleteDiagnosisAssetFromHistory('external_pdf', '${String(item.id || "").trim()}')`,
            icon: DIAGNOSIS_ASSET_META.external_pdf.icon,
            title: "Borrar adjunto: " + escapeHtmlClinical_(label),
            description: "Se elimina solo este PDF adjunto y el resto del registro se conserva."
        });
    });

    if (!state.report_pdf && !state.recipe_pdf && !state.certificate_pdf && !state.external_pdfs.length) {
        html += `
            <div style="padding:14px 16px; border:1px dashed #d0d7e2; border-radius:14px; background:#fafcff; color:#5f6b7a;">
                Este diagnóstico ya no tiene PDFs individuales para borrar por separado.
            </div>
        `;
    }

    if (state.id_reporte) {
        html += buildDiagnosisAssetManagerActionButton_({
            action: "deleteDiagnosisReportFromManager()",
            icon: "fas fa-trash-alt",
            title: "Borrar todo",
            description: "Elimina el diagnóstico completo junto con sus archivos asociados.",
            tone: "danger"
        });
    }

    box.innerHTML = html || `
        <div style="padding:14px 16px; border:1px dashed #d0d7e2; border-radius:14px; background:#fafcff; color:#5f6b7a;">
            No hay acciones disponibles para este diagnóstico.
        </div>
    `;
}

window.openDiagnosisAssetManagerFromHistory = function(encodedState) {
    let parsed = {};
    try {
        parsed = JSON.parse(decodeURIComponent(String(encodedState || "").trim() || "{}"));
    } catch (e) {
        parsed = {};
    }
    currentDiagnosisAssetModalState = normalizeDiagnosisAssetModalState_(parsed);
    renderDiagnosisAssetManagerModal_();
    openModal("modalDiagnosisAssetManager");
};

window.closeDiagnosisAssetManagerModal = function() {
    closeModal("modalDiagnosisAssetManager");
};

window.deleteDiagnosisAssetFromHistory = async function(assetType, assetId) {
    if (isDeletingDiagnosisAsset) {
        alert("Ya se está eliminando un documento. Espera un momento.");
        return;
    }
    const modalState = normalizeDiagnosisAssetModalState_(currentDiagnosisAssetModalState);
    if (!modalState.id_reporte) {
        alert("No se encontró el diagnóstico a gestionar.");
        return;
    }
    const meta = DIAGNOSIS_ASSET_META[assetType];
    if (!meta) {
        alert("Tipo de documento no válido.");
        return;
    }
    const externalItem = assetType === "external_pdf"
        ? (modalState.external_pdfs || []).find((item) => String(item.id || "").trim() === String(assetId || "").trim())
        : null;
    const assetLabel = externalItem ? ('"' + String(externalItem.label || meta.label).trim() + '"') : meta.label;
    const ok = window.appConfirm
        ? await window.appConfirm({
            title: "Eliminar " + assetLabel,
            message: "Se borrará solo el archivo " + assetLabel + ".\nLos datos clínicos y la receta escrita se conservarán.",
            confirmText: "Sí, borrar archivo",
            cancelText: "Cancelar",
        })
        : confirm("Borrar solo el archivo " + assetLabel + "?");
    if (!ok) return;

    const requesterDoc = getRequesterFromSession();
    if (!requesterDoc) {
        alert("Sesión inválida. Inicia sesión nuevamente.");
        return;
    }

    isDeletingDiagnosisAsset = true;
    try {
        const res = await postClinicalApiJson_({
            action: "delete_diagnosis_asset",
            id_reporte: modalState.id_reporte,
            asset_type: assetType,
            asset_id: assetId,
            requester: requesterDoc
        });
        if (!res || !res.success) {
            alert("Error: " + ((res && res.message) || "No se pudo eliminar el documento."));
            return;
        }
        currentDiagnosisAssetModalState = normalizeDiagnosisAssetModalState_(Object.assign({}, modalState, res.remaining_docs || {}));
        renderDiagnosisAssetManagerModal_();
        if (window.showToast) {
            window.showToast(
                res.warning
                    ? ("Documento eliminado con advertencia: " + res.warning)
                    : "Documento eliminado correctamente.",
                res.warning ? "warning" : "success"
            );
        } else if (res.warning) {
            alert("Documento eliminado. Advertencia: " + res.warning);
        }
        loadDiagnosisHistory();
    } catch (e) {
        alert("Error de conexión al borrar el documento.");
    } finally {
        isDeletingDiagnosisAsset = false;
    }
};

window.deleteDiagnosisReportFromManager = async function() {
    const modalState = normalizeDiagnosisAssetModalState_(currentDiagnosisAssetModalState);
    if (!modalState.id_reporte) {
        alert("No se encontró el diagnóstico a gestionar.");
        return;
    }
    closeDiagnosisAssetManagerModal();
    await deleteReport(modalState.id_reporte);
};

// 5. ELIMINAR REPORTE
window.deleteReport = async function(idReporte) {
    if (isDeletingReport) {
        alert("Ya se está eliminando un reporte. Espera un momento.");
        return;
    }
    const ok = window.appConfirm
        ? await window.appConfirm({
            title: "Eliminar diagnóstico",
            message: "Se borrará el diagnóstico y sus archivos asociados.\nEsta acción no se puede deshacer.",
            confirmText: "Sí, eliminar",
            cancelText: "Cancelar",
        })
        : confirm("Eliminar diagnóstico y archivos");
    if (!ok) return;
    const container = document.getElementById('diagnosisHistoryList');
    if (!container) return;
    const oldContent = container.innerHTML;
    container.innerHTML = '<p style="text-align:center; color:red;">Eliminando archivos, por favor espere...</p>';
    isDeletingReport = true;
    const requesterDoc = getRequesterFromSession();
    if (!requesterDoc) {
        alert("Sesión inválida. Inicia sesión nuevamente.");
        container.innerHTML = oldContent;
        isDeletingReport = false;
        return;
    }
    postClinicalApiJson_({ action: "delete_diagnosis", id_reporte: idReporte, requester: requesterDoc })
    .then(res => {
        if(res.success) {
            currentDiagnosisAssetModalState = null;
            closeDiagnosisAssetManagerModal();
            if (window.showToast) {
                window.showToast(
                    res.warning
                        ? "Diagnóstico eliminado con advertencia de sincronización."
                        : "Eliminado correctamente.",
                    res.warning ? "warning" : "success"
                );
            } else if (res.warning) {
                alert("Eliminado correctamente. Advertencia: " + res.warning);
            } else {
                alert("Eliminado correctamente.");
            }
            loadDiagnosisHistory(); 
        } else {
            alert("Error: " + res.message);
            container.innerHTML = oldContent; 
        }
    })
    .catch(() => {
        alert("Error de conexión");
        container.innerHTML = oldContent;
    })
    .finally(() => {
        isDeletingReport = false;
    });
}
// Función para borrar una cita desde la UI
window.deleteAppointmentFromUI = async function(idCita) {
    if (deletingAppointments[idCita]) {
        alert("Esa cita ya se está eliminando. Espera un momento.");
        return;
    }
    const ok = window.appConfirm
        ? await window.appConfirm({
            title: "Eliminar cita",
            message: "Se borrara la cita seleccionada.",
            confirmText: "Sí, eliminar",
            cancelText: "Cancelar",
        })
        : confirm("Eliminar cita");
    if (!ok) return;
    deletingAppointments[idCita] = true;
    const requesterDoc = getRequesterFromSession();
    if (!requesterDoc) {
        alert("Sesión inválida. Inicia sesión nuevamente.");
        deletingAppointments[idCita] = false;
        return;
    }
    postClinicalApiJson_({ action: "delete_cita", id_cita: idCita, requester: requesterDoc })
    .then(res => {
        if (res.success) {
            alert("Cita eliminada correctamente.");
            loadAppointmentHistory(currentPatientId);
        } else {
            alert("Error: " + res.message);
        }
    })
    .catch(() => {
        alert("Error de conexión al borrar cita");
    })
    .finally(() => {
        deletingAppointments[idCita] = false;
    });
}
// 6. REDIRIGIR A EDITAR
window.editReportRedirect = function(idReporte) {
    window.navigateWithEnv(`diagnostico.html?patientId=${currentPatientId}&reportId=${idReporte}&tab=diagnostico`);
}



