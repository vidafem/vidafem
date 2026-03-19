// js/agenda.js - Controlador de Agenda con WhatsApp

let isReschedulingFromAgenda = false;
let agendaCalendarState_ = {
    currentMonth: "",
    selectedDate: "",
    markedCounts: {}
};

function normalizeAgendaDurationMinutes_(value) {
    const num = Number(value);
    return [30, 60, 120, 180, 240, 300].includes(num) ? num : 30;
}

function timeTextToMinutesAgenda_(value) {
    const raw = String(value || "").trim();
    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return NaN;
    return (Number(match[1]) * 60) + Number(match[2]);
}

function minutesToTimeTextAgenda_(minutes) {
    const total = Number(minutes);
    if (!isFinite(total)) return "";
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    return String(hours).padStart(2, "0") + ":" + String(mins).padStart(2, "0");
}

function getAgendaEndTime_(startTime, durationMinutes) {
    const start = timeTextToMinutesAgenda_(startTime);
    if (!isFinite(start)) return "";
    return minutesToTimeTextAgenda_(start + normalizeAgendaDurationMinutes_(durationMinutes));
}

function getAgendaDurationLabel_(durationMinutes) {
    const mins = normalizeAgendaDurationMinutes_(durationMinutes);
    if (mins === 30) return "30 minutos";
    const hours = mins / 60;
    return hours + " hora" + (hours === 1 ? "" : "s");
}

function normalizePhoneForWa(phone) {
    if (!phone) return "";
    let digits = String(phone).replace(/[^\d]/g, "");
    if (!digits) return "";

    // Ecuador local: 09XXXXXXXX o 9XXXXXXXX
    if (digits.length === 10 && digits.charAt(0) === "0") {
        digits = "593" + digits.substring(1);
    } else if (digits.length === 9) {
        digits = "593" + digits;
    }

    return digits;
}

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

function getAgendaTodayIso_() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function normalizeAgendaIsoDate_(value) {
    if (!value) return "";
    const raw = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return "";
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function getAgendaMonthKey_(value) {
    const normalized = normalizeAgendaIsoDate_(value || getAgendaTodayIso_());
    return normalized ? normalized.slice(0, 7) : getAgendaTodayIso_().slice(0, 7);
}

function parseAgendaDateParts_(value) {
    const normalized = normalizeAgendaIsoDate_(value);
    const parts = normalized.split("-");
    if (parts.length !== 3) return null;
    return {
        year: Number(parts[0]),
        month: Number(parts[1]),
        day: Number(parts[2])
    };
}

function formatAgendaDateButtonLabel_(value) {
    const parts = parseAgendaDateParts_(value);
    if (!parts) return "Seleccionar fecha";
    const date = new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0);
    return date.toLocaleDateString("es-EC", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric"
    });
}

function formatAgendaMonthTitle_(monthKey) {
    const parts = String(monthKey || "").split("-");
    if (parts.length !== 2) return "";
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, 1, 12, 0, 0, 0);
    return date.toLocaleDateString("es-EC", { month: "long", year: "numeric" });
}

function getShiftedAgendaMonth_(monthKey, offset) {
    const parts = String(monthKey || "").split("-");
    const date = parts.length === 2
        ? new Date(Number(parts[0]), Number(parts[1]) - 1, 1, 12, 0, 0, 0)
        : new Date();
    date.setMonth(date.getMonth() + Number(offset || 0));
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function syncAgendaDateUi_(dateString) {
    const normalized = normalizeAgendaIsoDate_(dateString || getAgendaTodayIso_());
    const input = document.getElementById("agendaDateInput");
    const label = document.getElementById("agendaDateLabel");
    if (input) input.value = normalized;
    if (label) label.innerText = formatAgendaDateButtonLabel_(normalized);
    agendaCalendarState_.selectedDate = normalized;
    agendaCalendarState_.currentMonth = getAgendaMonthKey_(normalized);
}

function renderAgendaCalendar_() {
    const titleEl = document.getElementById("agendaCalendarTitle");
    const grid = document.getElementById("agendaCalendarGrid");
    if (!titleEl || !grid) return;

    const monthKey = agendaCalendarState_.currentMonth || getAgendaMonthKey_(agendaCalendarState_.selectedDate || getAgendaTodayIso_());
    const monthParts = String(monthKey || "").split("-");
    if (monthParts.length !== 2) {
        grid.innerHTML = '<p style="color:#888;">No se pudo construir el calendario.</p>';
        return;
    }

    titleEl.innerText = formatAgendaMonthTitle_(monthKey);

    const year = Number(monthParts[0]);
    const monthIndex = Number(monthParts[1]) - 1;
    const firstDay = new Date(year, monthIndex, 1, 12, 0, 0, 0);
    const daysInMonth = new Date(year, monthIndex + 1, 0, 12, 0, 0, 0).getDate();
    const today = getAgendaTodayIso_();
    const selected = normalizeAgendaIsoDate_(agendaCalendarState_.selectedDate || today);
    const markedCounts = agendaCalendarState_.markedCounts || {};
    const weekdayLabels = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];
    const mondayFirstOffset = (firstDay.getDay() + 6) % 7;

    const cells = [];
    weekdayLabels.forEach((label) => {
        cells.push(`<div class="agenda-calendar-weekday">${label}</div>`);
    });

    for (let i = 0; i < mondayFirstOffset; i++) {
        cells.push('<div class="agenda-calendar-empty"></div>');
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const classes = ["agenda-calendar-day"];
        const count = Number(markedCounts[dateKey] || 0);
        if (dateKey === today) classes.push("today");
        if (dateKey === selected) classes.push("selected");
        if (count > 0) classes.push("has-appointments");

        cells.push(`
            <button type="button" class="${classes.join(" ")}" onclick="selectAgendaCalendarDate('${dateKey}')">
                <span class="agenda-calendar-day-number">${day}</span>
                ${count > 0 ? `<span class="agenda-calendar-day-count">${count}</span>` : ""}
            </button>
        `);
    }

    grid.innerHTML = cells.join("");
}

function loadAgendaMonthSummary_(monthKey) {
    const requester = getRequesterFromSession();
    if (!requester) return;

    const grid = document.getElementById("agendaCalendarGrid");
    agendaCalendarState_.currentMonth = monthKey || getAgendaMonthKey_(agendaCalendarState_.selectedDate || getAgendaTodayIso_());
    if (grid) {
        grid.innerHTML = '<p style="color:#888; grid-column:1 / -1; text-align:center;"><i class="fas fa-circle-notch fa-spin"></i> Cargando calendario...</p>';
    }

    fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({
            action: "get_agenda_month_summary",
            requester: requester,
            month: agendaCalendarState_.currentMonth
        })
    })
    .then((r) => r.json())
    .then((res) => {
        if (!res || !res.success) {
            agendaCalendarState_.markedCounts = {};
            renderAgendaCalendar_();
            return;
        }
        agendaCalendarState_.markedCounts = (res.data && res.data.counts) || {};
        renderAgendaCalendar_();
    })
    .catch(() => {
        agendaCalendarState_.markedCounts = {};
        renderAgendaCalendar_();
    });
}

function setAgendaDateAndLoad_(dateString) {
    const normalized = normalizeAgendaIsoDate_(dateString || getAgendaTodayIso_());
    syncAgendaDateUi_(normalized);
    loadAgendaMonthSummary_(getAgendaMonthKey_(normalized));
    loadAgenda(normalized);
}

document.addEventListener("DOMContentLoaded", () => {
    if (!requireDoctorSession()) return;

    const dateInput = document.getElementById("agendaDateInput");
    if (dateInput) {
        setAgendaDateAndLoad_(dateInput.value || getAgendaTodayIso_());
    }

    const reschDate = document.getElementById("reschDate");
    if (reschDate) {
        reschDate.min = getAgendaTodayIso_();
        reschDate.addEventListener("change", loadRescheduleHours);
    }
});

function loadAgenda(dateString) {
    const requester = getRequesterFromSession();
    if (!requester) return;
    syncAgendaDateUi_(dateString);

    const container = document.getElementById("agendaGrid");
    if (!container) return;
    container.innerHTML = "<p>Cargando citas...</p>";

    fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "get_agenda", fecha: dateString, requester: requester })
    })
    .then(r => r.json())
    .then(res => {
        container.innerHTML = "";

        if (res.success && res.data.length > 0) {
            res.data.forEach(cita => {
                const card = document.createElement("div");
                card.className = "agenda-card";
                const endTime = getAgendaEndTime_(cita.hora, cita.duracion_minutos);
                const durationLabel = getAgendaDurationLabel_(cita.duracion_minutos);

                if (cita.estado === "ASISTIO") card.classList.add("attended");
                if (cita.estado === "NO_ASISTIO") card.classList.add("missed");
                if (cita.estado === "REAGENDADO") card.style.borderLeftColor = "#f39c12";

                let btnWhatsappHTML = "";
                if (cita.telefono) {
                    const waNumber = normalizePhoneForWa(cita.telefono);
                    const recMsg = cita.recomendaciones ? `\nRecomendaciones: ${cita.recomendaciones}` : "";
                    const waMsg = `Hola ${cita.nombre_paciente}, le saludamos de VIDAFEM para confirmar la cita del dia de manana ${cita.fecha} a las ${cita.hora}.${recMsg}\nMe confirma por favor. Gracias.`;
                    if (waNumber) {
                        const urlWa = `https://wa.me/${waNumber}?text=${encodeURIComponent(waMsg)}`;
                        btnWhatsappHTML = `
                            <a href="${urlWa}" target="_blank" class="btn-status" style="background:#25D366; color:white; text-decoration:none;" title="Enviar WhatsApp">
                                <i class="fab fa-whatsapp"></i>
                            </a>
                        `;
                    }
                }

                let notaHTML = "";
                if (cita.nota) {
                    notaHTML = `
                        <div style="background:#fff3cd; color:#856404; padding:8px; border-radius:5px; margin-top:10px; font-size:0.85rem; border-left:3px solid #ffeeba;">
                            <i class="fas fa-comment-dots"></i> <strong>Nota:</strong> ${cita.nota}
                        </div>
                    `;
                }

                card.innerHTML = `
                    <div class="agenda-time"><i class="far fa-clock"></i> ${cita.hora}${endTime ? ` - ${endTime}` : ""}</div>
                    <div style="font-size:0.82rem; color:#7f8c8d; margin-bottom:8px;">Bloque reservado: ${durationLabel}</div>
                    <a href="#" onclick="goToClinical('${cita.id_paciente}')" class="agenda-patient">
                        ${cita.nombre_paciente} <i class="fas fa-external-link-alt" style="font-size:0.8rem"></i>
                    </a>
                    <span class="agenda-proc">${cita.motivo}</span>
                    ${notaHTML}
                    <div class="agenda-actions">
                        <button class="btn-status btn-check" onclick="setApptStatus('${cita.id_cita}', 'ASISTIO', this)" title="Asistio">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="btn-status btn-cross" onclick="setApptStatus('${cita.id_cita}', 'NO_ASISTIO', this)" title="Falto">
                            <i class="fas fa-times"></i>
                        </button>
                        <button class="btn-status" onclick="openReschedule('${cita.id_cita}')" style="background:#fcf8e3; color:#f39c12;" title="Reagendar">
                            <i class="fas fa-calendar-alt"></i>
                        </button>
                        ${btnWhatsappHTML}
                    </div>
                `;
                container.appendChild(card);
            });
        } else {
            container.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#aaa;"><p>No hay citas para el ${dateString}.</p></div>`;
        }
    })
    .catch(() => {
        container.innerHTML = '<p style="color:#c0392b;">Error de conexion al cargar agenda.</p>';
    });
}

window.openAgendaCalendarModal = function() {
    syncAgendaDateUi_(document.getElementById("agendaDateInput") ? document.getElementById("agendaDateInput").value : getAgendaTodayIso_());
    openModal("modalAgendaCalendar");
    loadAgendaMonthSummary_(agendaCalendarState_.currentMonth || getAgendaMonthKey_(agendaCalendarState_.selectedDate || getAgendaTodayIso_()));
};

window.changeAgendaCalendarMonth = function(offset) {
    agendaCalendarState_.currentMonth = getShiftedAgendaMonth_(agendaCalendarState_.currentMonth || getAgendaMonthKey_(agendaCalendarState_.selectedDate || getAgendaTodayIso_()), offset);
    loadAgendaMonthSummary_(agendaCalendarState_.currentMonth);
};

window.selectAgendaCalendarDate = function(dateString) {
    closeModal("modalAgendaCalendar");
    setAgendaDateAndLoad_(dateString);
};

window.openAgendaForDate = function(dateString) {
    setAgendaDateAndLoad_(dateString);
};

function setApptStatus(id, status, btn) {
    const requester = getRequesterFromSession();
    if (!requester) return;

    const card = btn.closest(".agenda-card");
    if (card) {
        card.className = "agenda-card";
        if (status === "ASISTIO") card.classList.add("attended");
        if (status === "NO_ASISTIO") card.classList.add("missed");
    }

    fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "update_appt_status", id_cita: id, estado: status, requester: requester })
    });
}

function openReschedule(idCita) {
    document.getElementById("reschIdCita").value = idCita;
    document.getElementById("reschDate").value = "";
    document.getElementById("reschTime").innerHTML = "<option>Selecciona fecha...</option>";
    document.getElementById("modalReschedule").classList.add("active");
}

function loadRescheduleHours() {
    const requester = getRequesterFromSession();
    if (!requester) return;

    const dateVal = document.getElementById("reschDate").value;
    const timeSelect = document.getElementById("reschTime");
    if (!dateVal || !timeSelect) return;

    timeSelect.innerHTML = "<option>Cargando...</option>";

    fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({
            action: "get_taken_slots",
            fecha: dateVal,
            requester: requester,
            mode: "available",
            appointment_id: document.getElementById("reschIdCita").value
        })
    })
    .then(r => r.json())
    .then(res => {
        const available = res.data || [];
        timeSelect.innerHTML = "";
        available.forEach(t => {
            const opt = document.createElement("option");
            opt.value = t;
            opt.innerText = t;
            timeSelect.appendChild(opt);
        });
    });
}

const formResch = document.getElementById("formReschedule");
if (formResch) {
    formResch.addEventListener("submit", function(e) {
        e.preventDefault();
        if (isReschedulingFromAgenda) {
            alert("Ya se esta procesando el reagendamiento. Espera un momento.");
            return;
        }

        const requester = getRequesterFromSession();
        if (!requester) return;

        const btn = this.querySelector("button");
        btn.disabled = true;
        btn.innerText = "Procesando...";
        isReschedulingFromAgenda = true;

        const data = {
            id_cita: document.getElementById("reschIdCita").value,
            nueva_fecha: document.getElementById("reschDate").value,
            nueva_hora: document.getElementById("reschTime").value
        };

        fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({ action: "reschedule_appointment", data: data, requester: requester })
        })
        .then(r => r.json())
        .then(res => {
            if (res.success) {
                alert("Cita reagendada.");
                if (typeof closeModal === "function") closeModal("modalReschedule");
                else document.getElementById("modalReschedule").classList.remove("active");

                const dateInput = document.getElementById("agendaDateInput");
                if (dateInput) {
                    loadAgenda(dateInput.value);
                    loadAgendaMonthSummary_(getAgendaMonthKey_(dateInput.value));
                }
            } else {
                alert("Error: " + res.message);
            }
        })
        .catch(() => {
            alert("Error de conexion al reagendar cita.");
        })
        .finally(() => {
            btn.disabled = false;
            btn.innerText = "Guardar Cambios";
            isReschedulingFromAgenda = false;
        });
    });
}
