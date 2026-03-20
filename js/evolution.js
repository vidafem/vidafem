let patientEvolutionCache = [];
let currentEvolutionDetailId = null;
let isSavingEvolution = false;
let isDeletingEvolution = false;

function formatEvolutionDateLabel_(value) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("es-EC", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    });
}

function formatEvolutionDateTime_(value) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("es-EC", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function formatEvolutionInputDateTime_(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd + "T" + hh + ":" + min;
}

function getEvolutionPatientPdfName_() {
    const fromHeader = document.getElementById("clinName");
    const raw = String((typeof currentPatientName !== "undefined" && currentPatientName) || (fromHeader && fromHeader.innerText) || "paciente").trim();
    return raw || "paciente";
}

function sortEvolutionEntriesForPdf_(list) {
    return (Array.isArray(list) ? list.slice() : []).sort(function(a, b) {
        const aTime = new Date(a && (a.fecha_consulta || a.fecha_actualizacion) || 0).getTime() || 0;
        const bTime = new Date(b && (b.fecha_consulta || b.fecha_actualizacion) || 0).getTime() || 0;
        return aTime - bTime;
    });
}

function ensureEvolutionPdfSpace_(doc, y, needed) {
    if ((y + needed) <= 282) return y;
    doc.addPage();
    return 18;
}

function writeEvolutionPdfField_(doc, y, label, value) {
    const safeValue = String(value || "--").trim() || "--";
    y = ensureEvolutionPdfSpace_(doc, y, 16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(label, 14, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(safeValue, 182);
    doc.text(lines, 14, y);
    return y + (lines.length * 5) + 4;
}

function getEvolutionEntryById_(idEvolucion) {
    return patientEvolutionCache.find(function(item) {
        return String(item.id_evolucion) === String(idEvolucion);
    }) || null;
}

function getEvolutionFormElements_() {
    return {
        form: document.getElementById("formEvolution"),
        id: document.getElementById("evolutionEntryId"),
        dateTime: document.getElementById("evolutionDateTime"),
        reason: document.getElementById("evolutionReason"),
        progress: document.getElementById("evolutionProgress"),
        diagnosis: document.getElementById("evolutionDiagnosis"),
        treatment: document.getElementById("evolutionTreatment"),
        suggestions: document.getElementById("evolutionSuggestions"),
        title: document.getElementById("evolutionFormTitle"),
        submit: document.getElementById("evolutionSubmitBtn")
    };
}

function resetEvolutionForm_() {
    const els = getEvolutionFormElements_();
    if (!els.form) return;
    els.form.reset();
    els.id.value = "";
    if (els.dateTime) els.dateTime.value = formatEvolutionInputDateTime_(new Date());
    if (els.title) els.title.innerText = "Nueva Evolución del Paciente";
    if (els.submit) els.submit.innerText = "Guardar Evolución";
}

function setEvolutionDetailText_(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value || "--";
}

function buildEvolutionPreview_(entry) {
    const source = String(entry.motivo_consulta || entry.diagnostico || entry.evolucion || "").trim();
    if (!source) return "Sin resumen registrado.";
    return source.length > 150 ? source.slice(0, 147) + "..." : source;
}

function renderEvolutionCards_(list) {
    const container = document.getElementById("evolutionHistoryList");
    if (!container) return;

    container.innerHTML = "";
    if (typeof window.setPatientBulkItems_ === "function") {
        window.setPatientBulkItems_("evolucion", (Array.isArray(list) ? list : []).map(function(entry) {
            return { id: entry.id_evolucion };
        }));
    }
    if (!Array.isArray(list) || list.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-notes-medical"></i><p>No hay evoluciones registradas.</p></div>';
        return;
    }

    list.forEach(function(entry) {
        const card = document.createElement("div");
        card.className = "card evolution-card";
        card.setAttribute("data-bulk-section", "evolucion");
        card.setAttribute("data-bulk-id", String(entry.id_evolucion || ""));
        card.addEventListener("click", function() {
            openEvolutionDetail(entry.id_evolucion);
        });

        const top = document.createElement("div");
        top.style.display = "flex";
        top.style.justifyContent = "space-between";
        top.style.alignItems = "flex-start";
        top.style.gap = "12px";

        const titleBox = document.createElement("div");
        const title = document.createElement("h4");
        title.innerText = "Consulta (" + formatEvolutionDateLabel_(entry.fecha_consulta) + ")";
        const meta = document.createElement("small");
        meta.innerHTML = '<i class="far fa-clock"></i> ' + formatEvolutionDateTime_(entry.fecha_consulta);
        titleBox.appendChild(title);
        titleBox.appendChild(meta);

        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "6px";
        actions.style.alignItems = "center";

        if (typeof window.isPatientBulkModeActive_ === "function" && window.isPatientBulkModeActive_("evolucion")) {
            const bulkLabel = document.createElement("label");
            bulkLabel.className = "patient-bulk-check";
            bulkLabel.addEventListener("click", function(ev) {
                ev.stopPropagation();
            });

            const bulkInput = document.createElement("input");
            bulkInput.type = "checkbox";
            bulkInput.checked = typeof window.isPatientBulkItemSelected_ === "function"
                ? window.isPatientBulkItemSelected_("evolucion", entry.id_evolucion)
                : false;
            bulkInput.addEventListener("change", function(ev) {
                ev.stopPropagation();
                if (typeof window.togglePatientBulkItemSelection === "function") {
                    window.togglePatientBulkItemSelection("evolucion", entry.id_evolucion, bulkInput.checked);
                }
            });

            const bulkText = document.createElement("span");
            bulkText.innerText = "Seleccionar";

            bulkLabel.appendChild(bulkInput);
            bulkLabel.appendChild(bulkText);
            actions.appendChild(bulkLabel);
        }

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "evolution-card-action edit";
        editBtn.innerHTML = '<i class="fas fa-edit"></i>';
        editBtn.title = "Editar evolución";
        editBtn.addEventListener("click", function(ev) {
            ev.stopPropagation();
            openEvolutionEditModal(entry.id_evolucion);
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "evolution-card-action delete";
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
        deleteBtn.title = "Eliminar evolución";
        deleteBtn.addEventListener("click", function(ev) {
            ev.stopPropagation();
            deleteEvolutionEntry(entry.id_evolucion);
        });

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        top.appendChild(titleBox);
        top.appendChild(actions);

        const preview = document.createElement("p");
        preview.innerText = buildEvolutionPreview_(entry);

        const footer = document.createElement("div");
        footer.className = "evolution-card-actions";

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "btn-mini";
        openBtn.style.background = "#36235d";
        openBtn.style.color = "white";
        openBtn.innerHTML = '<i class="fas fa-folder-open"></i> Ver consulta';
        openBtn.addEventListener("click", function(ev) {
            ev.stopPropagation();
            openEvolutionDetail(entry.id_evolucion);
        });

        footer.appendChild(openBtn);
        card.appendChild(top);
        card.appendChild(preview);
        card.appendChild(footer);
        container.appendChild(card);
    });

    if (typeof window.syncPatientBulkCardStates_ === "function") {
        window.syncPatientBulkCardStates_("evolucion");
    }
}

window.loadEvolutionModule = function() {
    const container = document.getElementById("evolutionHistoryList");
    if (!container) return;

    const requester = (typeof getRequesterFromSession === "function") ? getRequesterFromSession() : null;
    if (!requester || !currentPatientId) {
        container.innerHTML = '<div class="empty-state"><p>No se pudo cargar la evolución del paciente.</p></div>';
        return;
    }

    container.innerHTML = '<div style="text-align:center; padding:20px; color:#666;"><i class="fas fa-circle-notch fa-spin"></i> Buscando evoluciones...</div>';

    fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({
            action: "get_patient_evolution",
            id_paciente: currentPatientId,
            requester: requester
        })
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
        if (!res.success) {
            container.innerHTML = '<div class="empty-state"><p>' + (res.message || "No se pudo cargar la evolución.") + '</p></div>';
            patientEvolutionCache = [];
            return;
        }
        patientEvolutionCache = Array.isArray(res.data) ? res.data : [];
        renderEvolutionCards_(patientEvolutionCache);
    })
    .catch(function() {
        container.innerHTML = '<div class="empty-state"><p>Error de conexión al cargar evolución.</p></div>';
        patientEvolutionCache = [];
    });
};

window.openEvolutionCreateModal = function() {
    resetEvolutionForm_();
    openModal("modalEvolutionForm");
};

window.openEvolutionEditModal = function(idEvolucion) {
    const entry = getEvolutionEntryById_(idEvolucion);
    if (!entry) {
        alert("No se encontró la evolución seleccionada.");
        return;
    }

    const els = getEvolutionFormElements_();
    if (!els.form) return;

    els.id.value = entry.id_evolucion || "";
    if (els.dateTime) els.dateTime.value = formatEvolutionInputDateTime_(entry.fecha_consulta || entry.fecha_actualizacion);
    els.reason.value = entry.motivo_consulta || "";
    els.progress.value = entry.evolucion || "";
    els.diagnosis.value = entry.diagnostico || "";
    els.treatment.value = entry.tratamiento || "";
    els.suggestions.value = entry.sugerencias || "";
    if (els.title) els.title.innerText = "Editar Evolución del Paciente";
    if (els.submit) els.submit.innerText = "Guardar Cambios";

    closeModal("modalEvolutionDetail");
    openModal("modalEvolutionForm");
};

window.openEvolutionDetail = function(idEvolucion) {
    const entry = getEvolutionEntryById_(idEvolucion);
    if (!entry) {
        alert("No se encontró la evolución seleccionada.");
        return;
    }

    currentEvolutionDetailId = entry.id_evolucion;
    setEvolutionDetailText_("evolutionDetailTitle", "Consulta (" + formatEvolutionDateLabel_(entry.fecha_consulta) + ")");
    setEvolutionDetailText_("evolutionDetailDate", formatEvolutionDateTime_(entry.fecha_consulta));
    setEvolutionDetailText_("evolutionDetailReason", entry.motivo_consulta);
    setEvolutionDetailText_("evolutionDetailProgress", entry.evolucion);
    setEvolutionDetailText_("evolutionDetailDiagnosis", entry.diagnostico);
    setEvolutionDetailText_("evolutionDetailTreatment", entry.tratamiento);
    setEvolutionDetailText_("evolutionDetailSuggestions", entry.sugerencias);

    openModal("modalEvolutionDetail");
};

window.editEvolutionFromDetail = function() {
    if (!currentEvolutionDetailId) return;
    openEvolutionEditModal(currentEvolutionDetailId);
};

window.deleteEvolutionFromDetail = function() {
    if (!currentEvolutionDetailId) return;
    deleteEvolutionEntry(currentEvolutionDetailId, true);
};

window.downloadPatientEvolutionPdf = function() {
    if (!Array.isArray(patientEvolutionCache) || !patientEvolutionCache.length) {
        alert("No hay evoluciones registradas para exportar.");
        return;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
        alert("No se pudo cargar la libreria PDF.");
        return;
    }

    const jsPDF = window.jspdf.jsPDF;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const patientName = getEvolutionPatientPdfName_();
    const patientCode = (document.getElementById("clinId") && document.getElementById("clinId").innerText) || ("ID: " + String(currentPatientId || "--"));
    const entries = sortEvolutionEntriesForPdf_(patientEvolutionCache);
    let y = 18;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Bitacora de Evolucion del Paciente", 14, y);
    y += 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text("Paciente: " + patientName, 14, y);
    y += 6;
    doc.text(String(patientCode || ""), 14, y);
    y += 10;

    entries.forEach(function(entry, index) {
        y = ensureEvolutionPdfSpace_(doc, y, 24);
        if (index > 0) {
            doc.setDrawColor(220, 220, 228);
            doc.line(14, y - 3, 196, y - 3);
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("Consulta " + (index + 1), 14, y);
        y += 6;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text("Fecha y hora: " + formatEvolutionDateTime_(entry.fecha_consulta || entry.fecha_actualizacion), 14, y);
        y += 7;

        y = writeEvolutionPdfField_(doc, y, "Motivo de consulta", entry.motivo_consulta);
        y = writeEvolutionPdfField_(doc, y, "Evolucion", entry.evolucion);
        y = writeEvolutionPdfField_(doc, y, "Diagnostico", entry.diagnostico);
        y = writeEvolutionPdfField_(doc, y, "Tratamiento", entry.tratamiento);
        y = writeEvolutionPdfField_(doc, y, "Sugerencias", entry.sugerencias);
        y += 2;
    });

    const safeName = patientName.toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "paciente";
    doc.save("evolucion_" + safeName + ".pdf");
};

window.deleteEvolutionEntry = async function(idEvolucion, fromDetail) {
    if (isDeletingEvolution) {
        alert("Ya se está eliminando una evolución. Espera un momento.");
        return;
    }

    const ok = window.appConfirm
        ? await window.appConfirm({
            title: "Eliminar evolución",
            message: "Se borrará la consulta seleccionada. Esta acción no se puede deshacer.",
            confirmText: "Sí, eliminar",
            cancelText: "Cancelar"
        })
        : confirm("Eliminar evolución del paciente");

    if (!ok) return;

    const requester = (typeof getRequesterFromSession === "function") ? getRequesterFromSession() : null;
    if (!requester) {
        alert("Sesión inválida. Inicia sesión nuevamente.");
        return;
    }

    isDeletingEvolution = true;
    fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({
            action: "delete_patient_evolution",
            id_evolucion: idEvolucion,
            requester: requester
        })
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
        if (!res.success) {
            alert("Error: " + (res.message || "No se pudo eliminar la evolución."));
            return;
        }
        if (fromDetail) closeModal("modalEvolutionDetail");
        currentEvolutionDetailId = null;
        loadEvolutionModule();
    })
    .catch(function() {
        alert("Error de conexión al eliminar la evolución.");
    })
    .finally(function() {
        isDeletingEvolution = false;
    });
};

function buildEvolutionPayload_() {
    const els = getEvolutionFormElements_();
    return {
        id_evolucion: els.id.value || "",
        id_paciente: currentPatientId,
        fecha_consulta: els.dateTime && els.dateTime.value ? els.dateTime.value : "",
        motivo_consulta: els.reason.value.trim(),
        evolucion: els.progress.value.trim(),
        diagnostico: els.diagnosis.value.trim(),
        tratamiento: els.treatment.value.trim(),
        sugerencias: els.suggestions.value.trim()
    };
}

function bindEvolutionForm_() {
    const els = getEvolutionFormElements_();
    if (!els.form || els.form.dataset.bound === "1") return;

    els.form.addEventListener("submit", function(e) {
        e.preventDefault();

        if (isSavingEvolution) {
            alert("Ya se está guardando una evolución. Espera un momento.");
            return;
        }

        const requester = (typeof getRequesterFromSession === "function") ? getRequesterFromSession() : null;
        if (!requester || !currentPatientId) {
            alert("Sesión inválida o paciente no seleccionado.");
            return;
        }

        const payload = buildEvolutionPayload_();
        if (!payload.fecha_consulta || !payload.motivo_consulta || !payload.evolucion || !payload.diagnostico || !payload.tratamiento) {
            alert("Completa fecha/hora, motivo de consulta, evolución, diagnóstico y tratamiento.");
            return;
        }

        const submitBtn = els.submit;
        const originalText = submitBtn ? submitBtn.innerText : "";
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerText = "Guardando...";
        }
        isSavingEvolution = true;

        fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({
                action: "save_patient_evolution",
                data: payload,
                requester: requester
            })
        })
        .then(function(r) { return r.json(); })
        .then(function(res) {
            if (!res.success) {
                alert("Error: " + (res.message || "No se pudo guardar la evolución."));
                return;
            }
            closeModal("modalEvolutionForm");
            resetEvolutionForm_();
            loadEvolutionModule();
        })
        .catch(function() {
            alert("Error de conexión al guardar la evolución.");
        })
        .finally(function() {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = originalText || "Guardar Evolución";
            }
            isSavingEvolution = false;
        });
    });

    els.form.dataset.bound = "1";
}

bindEvolutionForm_();
