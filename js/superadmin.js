let saDoctors = [];
let saPatients = [];
let saServices = [];
let saCurrentView = "doctors";
const SA_MOBILE_BREAKPOINT = 980;

function getSessionSafe_() {
  try {
    const raw = sessionStorage.getItem("vidafem_session");
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function getSuperadminUser_() {
  const s = getSessionSafe_();
  if (!s || String(s.role || "").toLowerCase() !== "superadmin") return null;
  return s.data && (s.data.usuario || s.data.username || s.data.nombre_doctor);
}

window.getRequesterFromSession = function () {
  return getSuperadminUser_();
};

function requireSuperadmin_() {
  const user = getSuperadminUser_();
  if (!user) {
    try { sessionStorage.removeItem("vidafem_session"); } catch (e) {}
    window.location.href = "index.html";
    return null;
  }
  return user;
}

function showMsg_(msg) {
  if (window.appAlert) window.appAlert({ title: "Aviso", message: msg });
  else alert(msg);
}

async function confirmAction_(title, message, confirmText) {
  if (window.appConfirm) {
    return window.appConfirm({
      title: title,
      message: message,
      confirmText: confirmText || "Confirmar",
      cancelText: "Cancelar"
    });
  }
  return confirm(message);
}

async function postApi_(payload) {
  const r = await fetch(API_URL, { method: "POST", body: JSON.stringify(payload) });
  return r.json();
}

function escapeHtml_(txt) {
  return String(txt || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isMobileSidebar_() {
  return window.matchMedia(`(max-width: ${SA_MOBILE_BREAKPOINT}px)`).matches;
}

function openSidebar_() {
  const sidebar = document.getElementById("saSidebar");
  const overlay = document.getElementById("saSidebarOverlay");
  const toggle = document.getElementById("saMenuToggle");
  if (!sidebar || !overlay) return;
  sidebar.classList.add("active");
  overlay.classList.add("active");
  document.body.classList.add("sa-sidebar-open");
  if (toggle) toggle.setAttribute("aria-expanded", "true");
}

function closeSidebar_() {
  const sidebar = document.getElementById("saSidebar");
  const overlay = document.getElementById("saSidebarOverlay");
  const toggle = document.getElementById("saMenuToggle");
  if (!sidebar || !overlay) return;
  sidebar.classList.remove("active");
  overlay.classList.remove("active");
  document.body.classList.remove("sa-sidebar-open");
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}

function toggleSidebar_() {
  const sidebar = document.getElementById("saSidebar");
  if (!sidebar) return;
  if (sidebar.classList.contains("active")) closeSidebar_();
  else openSidebar_();
}

function syncSidebarForViewport_() {
  if (!isMobileSidebar_()) closeSidebar_();
}

function resetDoctorForm_(mode, doctor) {
  const isCreate = mode === "create";
  document.getElementById("doctorMode").value = mode;
  document.getElementById("doctorModalTitle").textContent = isCreate ? "Nuevo medico" : "Editar medico";
  document.getElementById("btnSaveDoctor").textContent = isCreate ? "Crear medico" : "Guardar cambios";

  document.getElementById("oldUsuario").value = doctor ? (doctor.usuario || "") : "";
  document.getElementById("doctorNombre").value = doctor ? String(doctor.nombre_doctor || "").toUpperCase() : "";
  document.getElementById("doctorUsuario").value = doctor ? (doctor.usuario || "") : "";
  document.getElementById("doctorPassword").value = doctor ? (doctor.password || "") : "";
  document.getElementById("doctorCorreoNotificaciones").value = doctor ? (doctor.correo_notificaciones || "") : "";
  document.getElementById("doctorRol").value = doctor ? (doctor.rol || "DOCTOR") : "DOCTOR";
  document.getElementById("doctorTelefono").value = doctor ? (doctor.telefono || "") : "";
}

function openDoctorModal_(mode, doctor) {
  resetDoctorForm_(mode, doctor || null);
  document.getElementById("doctorModal").style.display = "flex";
}

function closeDoctorModal_() {
  document.getElementById("doctorModal").style.display = "none";
}

function openPatientPasswordModal_(patientId) {
  const p = saPatients.find(px => String(px.id_paciente) === String(patientId));
  if (!p) return;
  document.getElementById("managePatientId").value = p.id_paciente;
  document.getElementById("managePatientName").value = `${p.nombre_completo} (${p.cedula || "-"})`;
  document.getElementById("managePatientPassword").value = "";
  const select = document.getElementById("managePatientDoctor");
  select.innerHTML = doctorOptionsHtml_(p.creado_por);
  document.getElementById("patientManageModal").style.display = "flex";
}

function closePatientPasswordModal_() {
  document.getElementById("patientManageModal").style.display = "none";
}

function renderDoctors_() {
  const tbody = document.getElementById("doctorsTbody");
  tbody.innerHTML = "";
  if (!saDoctors.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Sin medicos</td></tr>';
    return;
  }

  saDoctors.forEach((d, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml_(d.nombre_doctor)}</td>
      <td>${escapeHtml_(d.usuario)}</td>
      <td>${escapeHtml_(d.rol || "-")}</td>
      <td>${escapeHtml_(d.correo_notificaciones || "-")}</td>
      <td>${escapeHtml_(d.telefono || "-")}</td>
      <td style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="sa-mini-btn edit" data-edit-doctor="${idx}">Editar</button>
        <button class="sa-mini-btn delete" data-delete-doctor="${idx}">Borrar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function doctorOptionsHtml_(selected) {
  return saDoctors
    .map(d => {
      const user = String(d.usuario || "");
      const isSel = String(selected || "") === user ? "selected" : "";
      return `<option value="${escapeHtml_(user)}" ${isSel}>${escapeHtml_(d.nombre_doctor)} (${escapeHtml_(user)})</option>`;
    })
    .join("");
}

function renderPatients_() {
  const tbody = document.getElementById("patientsTbody");
  const q = String(document.getElementById("patientSearch").value || "").trim().toLowerCase();
  const rows = saPatients.filter(p =>
    String(p.cedula || "").toLowerCase().includes(q) ||
    String(p.nombre_completo || "").toLowerCase().includes(q)
  );

  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center">Sin resultados</td></tr>';
    return;
  }

  rows.forEach((p) => {
    const pidEsc = escapeHtml_(p.id_paciente);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml_(p.cedula || "-")}</td>
      <td>${escapeHtml_(p.nombre_completo)}</td>
      <td>${escapeHtml_(p.creado_por || "SIN ASIGNAR")}</td>
      <td class="sa-actions-cell">
        <div class="sa-patient-actions">
          <button class="sa-mini-btn edit" data-manage-btn="${pidEsc}">
            <i class="fas fa-pen-to-square"></i>
            <span>Modificar</span>
          </button>
          <button class="sa-mini-btn delete" data-delete-patient="${pidEsc}">
            <i class="fas fa-trash"></i>
            <span>Eliminar</span>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function setView_(viewName) {
  const allowed = { doctors: true, patients: true, services: true };
  const next = allowed[viewName] ? viewName : "doctors";
  saCurrentView = next;

  document.querySelectorAll(".sa-view").forEach((v) => {
    v.style.display = v.id === `view-${next}` ? "" : "none";
  });

  document.querySelectorAll(".sa-nav-btn[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-view") === next);
  });

  if (next === "services") loadServicesAdmin();
  if (isMobileSidebar_()) closeSidebar_();
}

function renderServices_() {
  const list = document.getElementById("servicesList");
  if (!list) return;

  list.innerHTML = "";
  if (!saServices.length) {
    list.innerHTML = '<li class="sa-services-empty">No hay servicios registrados.</li>';
    return;
  }

  saServices.forEach((s) => {
    const li = document.createElement("li");
    li.className = "sa-service-item";
    const scopeText = String(s.scope_visibility || "").toUpperCase() === "OWNER" ? "Solo propietario" : "Para todos";
    const ownerText = s.owner_usuario ? `Propietario: ${escapeHtml_(s.owner_usuario)}` : "Propietario: sin definir";
    const durationMinutes = Number(s.duracion_minutos) || 30;
    const durationText = escapeHtml_(
      s.duracion_label || (durationMinutes === 30 ? "30 minutos" : `${durationMinutes / 60} ${durationMinutes === 60 ? "hora" : "horas"}`)
    );

    li.innerHTML = `
      <div class="sa-service-meta">
        <div class="sa-service-name">${escapeHtml_(s.nombre_servicio || "")}</div>
        <div class="sa-service-tags">${scopeText} | ${ownerText} | Duracion: ${durationText}</div>
      </div>
      <div class="sa-service-actions">
        <button class="sa-mini-btn edit" data-edit-service="${escapeHtml_(s.id)}">Editar</button>
        <button class="sa-mini-btn delete" data-delete-service="${escapeHtml_(s.id)}">Borrar</button>
      </div>
    `;
    list.appendChild(li);
  });
}

async function loadServicesAdmin() {
  const requester = requireSuperadmin_();
  if (!requester) return;
  const list = document.getElementById("servicesList");
  if (list) list.innerHTML = '<li class="sa-services-empty">Cargando...</li>';

  const res = await postApi_({ action: "get_services", requester: requester });
  if (!res.success) {
    if (list) list.innerHTML = `<li class="sa-services-empty">${escapeHtml_(res.message || "No se pudieron cargar servicios.")}</li>`;
    return;
  }

  saServices = Array.isArray(res.data) ? res.data : [];
  renderServices_();
}

window.loadServicesAdmin = loadServicesAdmin;

window.openEditService = function (id) {
  const service = saServices.find((s) => String(s.id) === String(id));
  if (!service) return;
  if (typeof window.openServiceBuilder === "function") {
    window.openServiceBuilder(service);
  }
};

window.deleteService = async function (id) {
  const requester = requireSuperadmin_();
  if (!requester) return;

  const service = saServices.find((s) => String(s.id) === String(id));
  if (!service) return;

  const ok = await confirmAction_(
    "Borrar servicio",
    `Se eliminara el servicio ${service.nombre_servicio} y toda su configuracion.`,
    "Borrar"
  );
  if (!ok) return;

  const res = await postApi_({
    action: "delete_service_full",
    nombre: service.nombre_servicio,
    requester: requester
  });

  if (!res.success) {
    showMsg_(res.message || "No se pudo borrar el servicio.");
    return;
  }

  await loadServicesAdmin();
  if (window.appToast) window.appToast("Servicio eliminado.", "success");
};

async function deleteDoctor_(idx) {
  const requester = requireSuperadmin_();
  if (!requester) return;

  const doctor = saDoctors[idx];
  if (!doctor) return;

  const pacienteCount = saPatients.filter(p => String(p.creado_por || "").trim() === String(doctor.usuario || "").trim()).length;
  const ok = await confirmAction_(
    "Borrar medico",
    `Se eliminara al medico ${doctor.nombre_doctor} (${doctor.usuario}).\nSus pacientes quedaran sin medico asignado (${pacienteCount}).`,
    "Borrar"
  );
  if (!ok) return;

  const res = await postApi_({
    action: "superadmin_delete_doctor",
    requester: requester,
    data: { usuario: doctor.usuario }
  });
  if (!res.success) {
    showMsg_(res.message || "No se pudo borrar el medico.");
    return;
  }

  await loadData_();
  if (window.appToast) window.appToast(`Medico eliminado. Pacientes sin asignar: ${res.unassigned_patients || 0}.`, "success");
}

async function deletePatient_(patientId) {
  const requester = requireSuperadmin_();
  if (!requester) return;

  const patient = saPatients.find(p => String(p.id_paciente) === String(patientId));
  const label = patient ? `${patient.nombre_completo} (${patient.cedula || patient.id_paciente})` : patientId;
  const ok = await confirmAction_(
    "Borrar paciente",
    `Se eliminara de forma irreversible al paciente ${label} y todo su historial/archivos asociados.`,
    "Eliminar"
  );
  if (!ok) return;

  const res = await postApi_({
    action: "superadmin_delete_patient",
    requester: requester,
    patient_id: patientId
  });
  if (!res.success) {
    showMsg_(res.message || "No se pudo borrar el paciente.");
    return;
  }

  await loadData_();
  if (window.appToast) window.appToast("Paciente eliminado permanentemente.", "success");
}

async function loadData_() {
  const requester = requireSuperadmin_();
  if (!requester) return;

  const res = await postApi_({ action: "superadmin_get_data", requester: requester });
  if (!res.success) {
    showMsg_(res.message || "No se pudo cargar informacion.");
    return;
  }
  saDoctors = (res.data && res.data.doctors) || [];
  saPatients = (res.data && res.data.patients) || [];
  renderDoctors_();
  renderPatients_();
  if (saCurrentView === "services") await loadServicesAdmin();
}

async function saveDoctor_(ev) {
  ev.preventDefault();
  const requester = requireSuperadmin_();
  if (!requester) return;

  const mode = document.getElementById("doctorMode").value || "edit";
  const payload = {
    old_usuario: document.getElementById("oldUsuario").value.trim(),
    nombre_doctor: document.getElementById("doctorNombre").value.trim().toUpperCase(),
    usuario: document.getElementById("doctorUsuario").value.trim(),
    password: document.getElementById("doctorPassword").value.trim(),
    rol: document.getElementById("doctorRol").value.trim().toUpperCase(),
    correo_notificaciones: document.getElementById("doctorCorreoNotificaciones").value.trim(),
    telefono: document.getElementById("doctorTelefono").value.trim()
  };
  if (!payload.nombre_doctor || !payload.usuario || !payload.password) {
    showMsg_("Completa nombre, usuario y contrasena.");
    return;
  }

  const ok = await confirmAction_(
    mode === "create" ? "Crear medico" : "Guardar cambios",
    mode === "create"
      ? `Se creara el medico ${payload.nombre_doctor}.`
      : `Se actualizaran los datos de ${payload.nombre_doctor}.`,
    mode === "create" ? "Crear" : "Guardar"
  );
  if (!ok) return;

  const btn = document.getElementById("btnSaveDoctor");
  const oldTxt = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Guardando...";
  try {
    const action = mode === "create" ? "superadmin_create_doctor" : "superadmin_update_doctor";
    const res = await postApi_({ action: action, requester: requester, data: payload });
    if (!res.success) {
      showMsg_(res.message || "No se pudo guardar.");
      return;
    }
    closeDoctorModal_();
    await loadData_();
    if (window.appToast) window.appToast(mode === "create" ? "Medico creado." : "Medico actualizado.", "success");
  } finally {
    btn.disabled = false;
    btn.textContent = oldTxt;
  }
}

async function savePatientManagement_(ev) {
  ev.preventDefault();
  const requester = requireSuperadmin_();
  if (!requester) return;

  const patientId = document.getElementById("managePatientId").value.trim();
  const doctor = document.getElementById("managePatientDoctor").value;
  const newPassword = document.getElementById("managePatientPassword").value.trim();
  if (!doctor) return;

  const ok = await confirmAction_(
    "Modificar paciente",
    "Se guardaran los cambios del medico tratante y la contrasena (si fue escrita).",
    "Guardar"
  );
  if (!ok) return;

  const res = await postApi_({
    action: "superadmin_update_patient_management",
    requester: requester,
    data: {
      patient_id: patientId,
      doctor_usuario: doctor,
      new_password: newPassword
    }
  });
  if (!res.success) {
    showMsg_(res.message || "No se pudo actualizar el paciente.");
    return;
  }
  closePatientPasswordModal_();
  await loadData_();
  if (window.appToast) window.appToast("Paciente actualizado.", "success");
}

document.addEventListener("DOMContentLoaded", () => {
  const requester = requireSuperadmin_();
  if (!requester) return;

  const welcome = `Sesion: ${requester}`;
  document.getElementById("saWelcome").textContent = welcome;
  const mobileWelcome = document.getElementById("saWelcomeMobile");
  if (mobileWelcome) mobileWelcome.textContent = welcome;

  document.getElementById("doctorNombre").addEventListener("input", (e) => {
    e.target.value = String(e.target.value || "").toUpperCase();
  });

  document.getElementById("btnNewDoctor").addEventListener("click", () => openDoctorModal_("create"));
  document.getElementById("doctorForm").addEventListener("submit", saveDoctor_);
  document.getElementById("closeDoctorModal").addEventListener("click", closeDoctorModal_);
  document.getElementById("closePatientManageModal").addEventListener("click", closePatientPasswordModal_);
  document.getElementById("patientManageForm").addEventListener("submit", savePatientManagement_);

  document.getElementById("btnRefresh").addEventListener("click", loadData_);
  document.getElementById("patientSearch").addEventListener("input", renderPatients_);
  document.querySelectorAll(".sa-nav-btn[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => setView_(btn.getAttribute("data-view")));
  });
  const menuToggle = document.getElementById("saMenuToggle");
  const menuClose = document.getElementById("saSidebarClose");
  const menuOverlay = document.getElementById("saSidebarOverlay");
  if (menuToggle) menuToggle.addEventListener("click", toggleSidebar_);
  if (menuClose) menuClose.addEventListener("click", closeSidebar_);
  if (menuOverlay) menuOverlay.addEventListener("click", closeSidebar_);
  window.addEventListener("resize", syncSidebarForViewport_);

  const newServiceBtn = document.getElementById("btnNewService");
  if (newServiceBtn) {
    newServiceBtn.addEventListener("click", () => {
      if (typeof window.openServiceBuilder === "function") window.openServiceBuilder();
    });
  }

  document.getElementById("btnLogout").addEventListener("click", async () => {
    const ok = await confirmAction_("Cerrar sesion", "Deseas cerrar sesion del panel superadmin", "Cerrar sesion");
    if (!ok) return;
    try { if (window.apiLogoutSession) await window.apiLogoutSession(); } catch (e) {}
    try { sessionStorage.removeItem("vidafem_session"); } catch (e) {}
    window.location.href = "index.html";
  });

  document.getElementById("doctorsTbody").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-edit-doctor]");
    if (btn) {
      const idx = Number(btn.getAttribute("data-edit-doctor"));
      if (!Number.isNaN(idx) && saDoctors[idx]) openDoctorModal_("edit", saDoctors[idx]);
      return;
    }
    const delBtn = ev.target.closest("[data-delete-doctor]");
    if (delBtn) {
      const idx = Number(delBtn.getAttribute("data-delete-doctor"));
      if (!Number.isNaN(idx)) deleteDoctor_(idx);
    }
  });

  document.getElementById("patientsTbody").addEventListener("click", (ev) => {
    const manageBtn = ev.target.closest("[data-manage-btn]");
    if (manageBtn) {
      openPatientPasswordModal_(manageBtn.getAttribute("data-manage-btn"));
      return;
    }
    const delBtn = ev.target.closest("[data-delete-patient]");
    if (delBtn) {
      deletePatient_(delBtn.getAttribute("data-delete-patient"));
    }
  });

  const servicesList = document.getElementById("servicesList");
  if (servicesList) {
    servicesList.addEventListener("click", (ev) => {
      const editBtn = ev.target.closest("[data-edit-service]");
      if (editBtn) {
        window.openEditService(editBtn.getAttribute("data-edit-service"));
        return;
      }
      const delBtn = ev.target.closest("[data-delete-service]");
      if (delBtn) {
        window.deleteService(delBtn.getAttribute("data-delete-service"));
      }
    });
  }

  loadData_();
  setView_("doctors");
  syncSidebarForViewport_();
});
