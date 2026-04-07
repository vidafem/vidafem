// js/diagnostico.js - VERSIÓN DINÁMICA FINAL (Títulos Personalizados + Editor Corregido)

let currentPatientId = null;
let currentReportId = null;
let CONFIG_CAMPOS = {};
let SERVICES_METADATA = [];
let hasUnsavedChanges = false;
let currentGeneratedDocs = { report_pdf: "", recipe_pdf: "", certificate_pdf: "", external_pdf: "", report_type: "" };
let currentExternalPdfItems = [];
let externalPdfLocalSeq = 0;
let currentMedicalCertificate = null;
// Ya no usamos existingFileIds fija, todo se lee del DOM

// VARIABLES EDITOR
let canvas, ctx, currentImgElement = null;
let isDrawing = false;
let isDragging = false;
let editorObjectsMap = {}; // id_imagen -> lista de objetos
let editorObjects = [];    // Objetos de la imagen activa
let selectedObjectIndex = null;
let dragOffset = { x: 0, y: 0 };
let currentColor = "#ff0000";
let currentTool = "brush";
let currentTextSize = 24;
let currentLineWidth = 3;
let editorBaseImage = null;
let startX, startY;
let snapshot;
let history = [];
let editingTextIndex = null;
let isDiagnosisSaveInProgress = false;
let isManagingDiagnosisAssets = false;
const DIAGNOSIS_HTML_TEMPLATE_PATH = "plantilla_vidafem.html";
let diagnosisHtmlTemplateCache_ = "";

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

function shouldForceWorkerForDiagnosisAction_(action) {
  const key = String(action || "").trim();
  if (!key) return false;
  return key === "save_diagnosis_advanced"
    || key === "get_diagnosis_report"
    || key === "delete_diagnosis_asset"
    || key === "delete_diagnosis"
    || key === "get_file_base64"
    || key === "get_diagnosis_history";
}

function resolveDiagnosisApiUrl_(body) {
  const action = body && body.action ? String(body.action).trim() : "";
  const forceWorker = shouldForceWorkerForDiagnosisAction_(action);
  const runtime = window.VF_API_RUNTIME || {};
  const urls = window.VF_API_URLS || {};
  const env = String(runtime.env || "prod").trim().toLowerCase() === "test" ? "test" : "prod";
  const workerUrl = urls.worker && urls.worker[env] ? String(urls.worker[env]).trim() : "";
  if (forceWorker && workerUrl) return workerUrl;
  return API_URL;
}

function postDiagnosisApiJson_(payload) {
  const body = Object.assign({}, payload || {});
  const session = getSessionDataSafe();
  if (!body.session_token && session && session.session_token) {
    body.session_token = session.session_token;
  }
  const targetUrl = resolveDiagnosisApiUrl_(body);
  return fetch(targetUrl, {
    method: "POST",
    body: JSON.stringify(body)
  }).then(async (r) => {
    const raw = await r.text();
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch (e) {}
    if (parsed && typeof parsed === "object") return parsed;
    return {
      success: false,
      message: "HTTP " + r.status + " - " + (String(raw || "").trim() || "Respuesta invalida del servidor.")
    };
  });
}

async function fetchDiagnosisReportReadback_(reportId) {
  const targetId = String(reportId || "").trim();
  const requester = getRequesterFromSession();
  if (!targetId || !requester) return null;
  const res = await postDiagnosisApiJson_({
    action: "get_diagnosis_report",
    id_reporte: targetId,
    requester: requester
  });
  if (!res || !res.success || !Array.isArray(res.data)) return null;
  return res.data.find((item) => String(item && item.id_reporte || "").trim() === targetId) || res.data[0] || null;
}

function getDiagnosisPersistedStateFromReport_(report) {
  const src = report && typeof report === "object" ? report : {};
  let data = {};
  try {
    data = src.datos_json && typeof src.datos_json === "object"
      ? Object.assign({}, src.datos_json)
      : JSON.parse(String(src.datos_json || "{}"));
  } catch (e) {
    data = {};
  }
  return {
    data: data,
    docs: {
      pdf_url: src.pdf_url,
      pdf_receta_link: data.pdf_receta_link || src.pdf_receta_url || src.pdfRecetaUrl,
      pdf_certificado_link: data.pdf_certificado_link || src.pdf_certificado_url || src.pdfCertificadoUrl,
      pdf_externo_link: data.pdf_externo_link || src.pdf_externo_url || src.pdfExternoUrl,
      pdf_externos: src.pdf_externos || data.pdf_externos || []
    }
  };
}

const GENERATED_DIAGNOSIS_DOC_META = {
  report_pdf: {
    label: "PDF informe",
    managerLabel: "informe",
    color: "#36235d",
    icon: "fas fa-file-pdf",
    deleteTitle: "Borrar solo el PDF del informe"
  },
  recipe_pdf: {
    label: "PDF receta",
    managerLabel: "receta",
    color: "#27ae60",
    icon: "fas fa-prescription-bottle-alt",
    deleteTitle: "Borrar solo el PDF de la receta"
  },
  certificate_pdf: {
    label: "PDF certificado",
    managerLabel: "certificado medico",
    color: "#8e44ad",
    icon: "fas fa-file-medical",
    deleteTitle: "Borrar solo el PDF del certificado medico"
  },
  external_pdf: {
    label: "PDF examen adjunto",
    managerLabel: "examen adjunto",
    color: "#2980b9",
    icon: "fas fa-paperclip",
    deleteTitle: "Borrar solo el PDF adjunto"
  }
};

function createExternalPdfLocalId_() {
  externalPdfLocalSeq += 1;
  return "external_pdf_local_" + String(externalPdfLocalSeq);
}

function defaultExternalPdfLabel_(value, fallbackIndex) {
  const raw = String(value || "").trim();
  if (raw) {
    return raw.replace(/\.pdf$/i, "").trim() || raw;
  }
  return "Adjunto PDF " + String(Number(fallbackIndex || 0) + 1);
}

function escapeHtmlDiagnosis_(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeJsSingleQuotedDiagnosis_(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function extractDriveFileIdFromUrlDiagnosis_(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  let match = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match && match[1]) return match[1];
  match = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) return match[1];
  match = raw.match(/[-\w]{25,}/);
  return match && match[0] ? match[0] : "";
}

function normalizeExternalPdfItems_(items) {
  const list = Array.isArray(items) ? items : [];
  const out = [];
  list.forEach((item, index) => {
    const current = item || {};
    const url = String(current.url || current.pdf_externo_link || "").trim();
    const fileId = String(current.file_id || current.fileId || extractDriveFileIdFromUrlDiagnosis_(url) || "").trim();
    const file = current.file || null;
    const name = String(current.name || (file && file.name) || "").trim();
    const label = defaultExternalPdfLabel_(current.label || current.nombre_visible || current.display_name || name, index);
    if (!url && !fileId && !file && !name) return;
    out.push({
      id: String(current.id || fileId || createExternalPdfLocalId_()).trim(),
      label: label,
      name: name,
      url: url,
      file_id: fileId,
      mime: String(current.mime || (file && file.type) || "application/pdf").trim() || "application/pdf",
      file: file,
      is_new: !!current.is_new || !!file || !!current.data
    });
  });
  return out;
}

function getLegacyExternalPdfItems_(payload) {
  const data = payload || {};
  const url = String(data.pdf_externo_link || "").trim();
  if (!url) return [];
  return [{
    id: String(extractDriveFileIdFromUrlDiagnosis_(url) || createExternalPdfLocalId_()).trim(),
    label: defaultExternalPdfLabel_(data.pdf_externo_nombre || data.titulo_adjunto || "Adjunto PDF", 0),
    name: "",
    url: url,
    file_id: extractDriveFileIdFromUrlDiagnosis_(url),
    mime: "application/pdf",
    file: null,
    is_new: false
  }];
}

function getStoredExternalPdfItemsFromPayload_(payload) {
  const data = payload || {};
  const modern = normalizeExternalPdfItems_(data.pdf_externos);
  return modern.length ? modern : getLegacyExternalPdfItems_(data);
}

function setCurrentExternalPdfItems_(items) {
  currentExternalPdfItems = normalizeExternalPdfItems_(items);
  renderExternalPdfItems_();
}

function getCurrentExternalPdfItems_() {
  return normalizeExternalPdfItems_(currentExternalPdfItems);
}

function hasExistingExternalPdfLoaded_() {
  return getCurrentExternalPdfItems_().length > 0;
}

function buildExternalPdfStorageItem_(item) {
  const current = item || {};
  return {
    id: String(current.id || createExternalPdfLocalId_()).trim(),
    label: defaultExternalPdfLabel_(current.label || current.name || "Adjunto PDF", 0),
    name: String(current.name || "").trim(),
    url: String(current.url || "").trim(),
    file_id: String(current.file_id || current.fileId || extractDriveFileIdFromUrlDiagnosis_(current.url) || "").trim()
  };
}

function renderExternalPdfItems_() {
  const host = document.getElementById("existingPdfMsg");
  if (!host) return;

  const items = getCurrentExternalPdfItems_();
  if (!items.length) {
    host.innerHTML = `
      <div style="margin-bottom:12px; padding:12px; border:1px dashed #cbd5e1; border-radius:10px; background:#f8fafc; color:#64748b;">
        Todavia no has agregado archivos PDF en este registro.
      </div>
    `;
    return;
  }

  host.innerHTML = items.map((item, index) => {
    const safeItemId = escapeJsSingleQuotedDiagnosis_(item.id || "");
    const safeLabel = escapeHtmlDiagnosis_(item.label || "");
    const safeName = escapeHtmlDiagnosis_(item.name || "");
    const linkHtml = item.url
      ? `<a href="${item.url}" target="_blank" style="color:#2980b9; text-decoration:none; font-weight:600;"><i class="fas fa-file-pdf"></i> Ver PDF</a>`
      : `<span style="color:#b45309; font-weight:600;"><i class="fas fa-clock"></i> Pendiente de guardar</span>`;
    const metaHtml = safeName
      ? `<div style="color:#667085; font-size:0.8em; margin-top:4px;">Archivo: ${safeName}</div>`
      : "";
    return `
      <div style="margin:12px 0; padding:14px; border:1px solid #dbe6f2; border-radius:12px; background:#f8fbff;">
        <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
          <div style="flex:1 1 320px;">
            <label style="display:block; font-size:0.82em; color:#475467; font-weight:700; margin-bottom:6px;">Nombre visible</label>
            <input type="text" class="doc-input" value="${safeLabel}" oninput="updateExternalPdfItemLabel_('${safeItemId}', this.value)" placeholder="Ej: Examen hormonal abril" style="width:100%;">
            ${metaHtml}
          </div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            ${linkHtml}
            <button type="button" onclick="removeExternalPdfItem_('${safeItemId}')" style="border:none; background:none; color:#c0392b; font-weight:700; cursor:pointer;">
              <i class="fas fa-trash"></i> Quitar
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

window.updateExternalPdfItemLabel_ = function(id, value) {
  const targetId = String(id || "").trim();
  if (!targetId) return;
  currentExternalPdfItems = getCurrentExternalPdfItems_().map((item, index) => {
    if (String(item.id || "").trim() !== targetId) return item;
    return Object.assign({}, item, {
      label: defaultExternalPdfLabel_(value, index)
    });
  });
};

window.removeExternalPdfItem_ = function(id) {
  const targetId = String(id || "").trim();
  if (!targetId) return;
  currentExternalPdfItems = getCurrentExternalPdfItems_().filter((item) => String(item.id || "").trim() !== targetId);
  renderExternalPdfItems_();
};

window.handleExternalPdfFilesSelected = function(input) {
  const files = Array.from((input && input.files) || []);
  if (!files.length) return;

  const nextItems = getCurrentExternalPdfItems_().slice();
  files.forEach((file, index) => {
    const fileName = String(file && file.name || "").trim();
    const mime = String(file && file.type || "").trim().toLowerCase();
    if (!fileName) return;
    if (mime && mime !== "application/pdf" && !/\.pdf$/i.test(fileName)) return;
    nextItems.push({
      id: createExternalPdfLocalId_(),
      label: defaultExternalPdfLabel_(fileName, nextItems.length + index),
      name: fileName,
      url: "",
      file_id: "",
      mime: mime || "application/pdf",
      file: file,
      is_new: true
    });
  });

  currentExternalPdfItems = nextItems;
  renderExternalPdfItems_();
  if (input) input.value = "";
};

function readExternalPdfFileAsDataUrl_(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => resolve(String((e && e.target && e.target.result) || ""));
    reader.onerror = () => reject(new Error("No se pudo leer uno de los archivos PDF adjuntos."));
    reader.readAsDataURL(file);
  });
}

function parseSignatureBool_(value, fallback = true) {
  if (value === undefined || value === null || value === "") return !!fallback;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return !!fallback;
  if (raw === "si" || raw === "true" || raw === "1" || raw === "yes" || raw === "on") return true;
  if (raw === "no" || raw === "false" || raw === "0" || raw === "off") return false;
  return !!fallback;
}

function setVirtualSignatureCheckbox_(value) {
  const checkbox = document.getElementById("includeVirtualSignature");
  if (!checkbox) return;
  checkbox.checked = parseSignatureBool_(value, true);
}

function loadVirtualSignaturePreference_() {
  const s = getSessionDataSafe();
  const defaultValue = s && s.data ? s.data.usar_firma_virtual : true;
  setVirtualSignatureCheckbox_(defaultValue);
}

function shouldIncludeVirtualSignature_() {
  const checkbox = document.getElementById("includeVirtualSignature");
  return checkbox ? !!checkbox.checked : true;
}

function getClinicalReportDateInputValue_() {
  const input = document.getElementById("reportDateInput") || document.getElementById("fecha");
  return input ? String(input.value || "").trim() : "";
}

function setClinicalReportDateInputValue_(value) {
  const input = document.getElementById("reportDateInput") || document.getElementById("fecha");
  if (!input) return;
  const raw = String(value || "").trim();
  if (!raw) {
    input.value = "";
    return;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    input.value = raw;
    return;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    input.value = raw.split("T")[0];
    return;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    input.value = parsed.toISOString().split("T")[0];
  }
}

function getClinicalReportDateForDisplay_(payload) {
  const data = payload || {};
  const raw = String(
    getClinicalReportDateInputValue_()
    || data.fecha_reporte
    || data.fecha
    || ""
  ).trim();
  if (!raw) return new Date();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(raw + "T12:00:00");
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const parsedIso = new Date(raw);
    if (!Number.isNaN(parsedIso.getTime())) return parsedIso;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function parseDisplayedCedulaFromHeader_() {
  const cedulaEl = document.getElementById("displayCedula");
  const raw = cedulaEl ? String(cedulaEl.innerText || cedulaEl.textContent || "").trim() : "";
  if (!raw) return "";
  const match = raw.match(/:\s*(.+)$/);
  return String(match && match[1] ? match[1] : raw).trim();
}

function formatCertificateShortDate_(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const p = raw.split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = String(date.getFullYear());
  return d + "/" + m + "/" + y;
}

function formatCertificateLongDate_(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (!date || Number.isNaN(date.getTime())) return "";
  const weekdays = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return weekdays[date.getDay()] + " " + date.getDate() + " de " + months[date.getMonth()] + " de " + date.getFullYear();
}

function normalizeMedicalCertificateData_(input) {
  const data = input && typeof input === "object" ? input : {};
  return {
    ciudad: String(data.ciudad || "Guayaquil").trim(),
    nombre_paciente: String(data.nombre_paciente || "").trim(),
    cedula: String(data.cedula || "").trim(),
    cuadro_clinico: String(data.cuadro_clinico || "").trim(),
    diagnostico: String(data.diagnostico || "").trim(),
    lugar_trabajo: String(data.lugar_trabajo || "").trim(),
    ocupacion: String(data.ocupacion || "").trim(),
    lugar_atencion: String(data.lugar_atencion || "Cdla. Garzota II, AV. Agustin Freire Icaza Mz. 152 Villa 13").trim(),
    establecimiento: String(data.establecimiento || "Consultorio Gineco Obstetrico VIDAFEM").trim(),
    reposo_sugerido: String(data.reposo_sugerido || "NO").trim().toUpperCase() === "SI" ? "SI" : "NO",
    reposo_inicio: String(data.reposo_inicio || "").trim(),
    reposo_fin: String(data.reposo_fin || "").trim()
  };
}

function calculateCertificateRestDays_(startDate, endDate) {
  const start = new Date(String(startDate || "") + "T12:00:00");
  const end = new Date(String(endDate || "") + "T12:00:00");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const diff = Math.round((end.getTime() - start.getTime()) / 86400000);
  return diff >= 0 ? (diff + 1) : 0;
}

function getCertificateRestSummaryText_(data) {
  const cert = normalizeMedicalCertificateData_(data);
  if (cert.reposo_sugerido !== "SI") return "";
  const days = calculateCertificateRestDays_(cert.reposo_inicio, cert.reposo_fin);
  const startText = formatCertificateShortDate_(cert.reposo_inicio);
  const endText = formatCertificateShortDate_(cert.reposo_fin);
  if (!days || !startText || !endText) return "";
  return "Tiempo de reposo: " + days + " día(s), desde el " + startText + " hasta el " + endText + ".";
}

function isMedicalCertificateEnabled_() {
  const container = document.getElementById("medicalCertificateContainer");
  return !!(container && !container.classList.contains("hidden"));
}

function fillMedicalCertificateModalFields_(source) {
  const cert = normalizeMedicalCertificateData_(source);
  const reportDate = getClinicalReportDateInputValue_() || formatCertificateShortDate_(new Date());
  const dateLabel = document.getElementById("certDateDisplay");
  if (dateLabel) {
    const longText = formatCertificateLongDate_(getClinicalReportDateForDisplay_({ fecha_reporte: reportDate }));
    dateLabel.textContent = (cert.ciudad || "Guayaquil") + ", " + longText;
  }
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = String(value || "");
  };
  setValue("certCiudad", cert.ciudad || "Guayaquil");
  setValue("certPacienteNombre", cert.nombre_paciente || document.getElementById("patientNameDisplay").value || "");
  setValue("certPacienteCedula", cert.cedula || parseDisplayedCedulaFromHeader_());
  setValue("certCuadroClinico", cert.cuadro_clinico);
  setValue("certDiagnostico", cert.diagnostico);
  setValue("certLugarTrabajo", cert.lugar_trabajo);
  setValue("certOcupacion", cert.ocupacion);
  setValue("certReposoSugerido", cert.reposo_sugerido);
  setValue("certReposoInicio", cert.reposo_inicio);
  setValue("certReposoFin", cert.reposo_fin);
  toggleMedicalRestDateInputs_();
  updateMedicalCertificateSummary_();
}

function readMedicalCertificateFromModal_() {
  const getValue = (id) => {
    const el = document.getElementById(id);
    return el ? String(el.value || "").trim() : "";
  };
  return normalizeMedicalCertificateData_({
    ciudad: getValue("certCiudad") || "Guayaquil",
    nombre_paciente: getValue("certPacienteNombre"),
    cedula: getValue("certPacienteCedula"),
    cuadro_clinico: getValue("certCuadroClinico"),
    diagnostico: getValue("certDiagnostico"),
    lugar_trabajo: getValue("certLugarTrabajo"),
    ocupacion: getValue("certOcupacion"),
    reposo_sugerido: getValue("certReposoSugerido") || "NO",
    reposo_inicio: getValue("certReposoInicio"),
    reposo_fin: getValue("certReposoFin")
  });
}

function validateMedicalCertificateData_(data) {
  const cert = normalizeMedicalCertificateData_(data);
  const required = [
    ["nombre_paciente", "nombre del paciente"],
    ["cedula", "cedula / C.I."],
    ["cuadro_clinico", "cuadro clinico"],
    ["diagnostico", "diagnostico"],
    ["lugar_trabajo", "lugar donde labora"],
    ["ocupacion", "ocupacion"]
  ];
  for (let i = 0; i < required.length; i++) {
    const key = required[i][0];
    if (!String(cert[key] || "").trim()) {
      return { ok: false, message: "Completa el campo: " + required[i][1] + "." };
    }
  }
  if (cert.reposo_sugerido === "SI") {
    if (!cert.reposo_inicio || !cert.reposo_fin) {
      return { ok: false, message: "Debes indicar fecha de inicio y fin del reposo." };
    }
    const days = calculateCertificateRestDays_(cert.reposo_inicio, cert.reposo_fin);
    if (!days) {
      return { ok: false, message: "La fecha fin del reposo no puede ser menor que la fecha inicio." };
    }
  }
  return { ok: true, data: cert };
}

function hasMeaningfulMedicalCertificateContent_(payload) {
  const cert = payload && payload.certificado_medico && typeof payload.certificado_medico === "object"
    ? payload.certificado_medico
    : null;
  if (!cert) return false;
  const textFields = [
    cert.cuadro_clinico,
    cert.diagnostico,
    cert.lugar_trabajo,
    cert.ocupacion
  ];
  return textFields.some((v) => !!String(v || "").trim());
}

function getMedicalCertificateDataForSave_() {
  if (!isMedicalCertificateEnabled_()) return null;
  const modal = document.getElementById("modalMedicalCertificate");
  const modalDraft = readMedicalCertificateFromModal_();
  const hasModalDraft = hasMeaningfulMedicalCertificateContent_({ certificado_medico: modalDraft });
  const shouldUseModalDraft = !!(modal && (modal.classList.contains("active") || hasModalDraft));
  const cert = normalizeMedicalCertificateData_(shouldUseModalDraft ? modalDraft : (currentMedicalCertificate || {}));
  cert.nombre_paciente = cert.nombre_paciente || String(document.getElementById("patientNameDisplay").value || "").trim();
  cert.cedula = cert.cedula || parseDisplayedCedulaFromHeader_();
  const valid = validateMedicalCertificateData_(cert);
  if (!valid.ok) {
    throw new Error(valid.message);
  }
  return valid.data;
}

function getMedicalCertificateDataRequired_() {
  const modal = document.getElementById("modalMedicalCertificate");
  const modalDraft = readMedicalCertificateFromModal_();
  const hasModalDraft = hasMeaningfulMedicalCertificateContent_({ certificado_medico: modalDraft });
  const shouldUseModalDraft = !!(modal && (modal.classList.contains("active") || hasModalDraft));
  const cert = normalizeMedicalCertificateData_(shouldUseModalDraft ? modalDraft : (currentMedicalCertificate || {}));
  cert.nombre_paciente = cert.nombre_paciente || String(document.getElementById("patientNameDisplay").value || "").trim();
  cert.cedula = cert.cedula || parseDisplayedCedulaFromHeader_();
  const valid = validateMedicalCertificateData_(cert);
  if (!valid.ok) {
    throw new Error(valid.message);
  }
  return valid.data;
}

function updateMedicalCertificateSummary_() {
  const summary = document.getElementById("medicalCertificateSummary");
  if (!summary) return;
  const cert = normalizeMedicalCertificateData_(readMedicalCertificateFromModal_());
  const name = cert.nombre_paciente || "Paciente";
  const rest = cert.reposo_sugerido === "SI" ? (getCertificateRestSummaryText_(cert) || "Reposo pendiente de fechas.") : "Sin reposo.";
  summary.innerHTML = "<strong>" + escapeHtmlDiagnosis_(name) + "</strong><br><small style=\"color:#666;\">" + escapeHtmlDiagnosis_(rest) + "</small>";
}

function toggleMedicalRestDateInputs_() {
  const select = document.getElementById("certReposoSugerido");
  const box = document.getElementById("certReposoDates");
  if (!select || !box) return;
  const show = String(select.value || "NO").trim().toUpperCase() === "SI";
  box.style.display = show ? "grid" : "none";
}

window.toggleMedicalCertificateModule = function(show) {
  const btn = document.getElementById("btnOpenMedicalCertificate");
  const container = document.getElementById("medicalCertificateContainer");
  if (!btn || !container) return;
  if (show) {
    btn.style.display = "none";
    container.classList.remove("hidden");
    if (!currentMedicalCertificate) {
      currentMedicalCertificate = normalizeMedicalCertificateData_({
        nombre_paciente: String(document.getElementById("patientNameDisplay").value || "").trim(),
        cedula: parseDisplayedCedulaFromHeader_(),
        ciudad: "Guayaquil"
      });
    }
    fillMedicalCertificateModalFields_(currentMedicalCertificate);
    updateMedicalCertificateSummary_();
    return;
  }
  if (confirm("¿Quitar el certificado medico de este formulario?")) {
    btn.style.display = "block";
    container.classList.add("hidden");
    currentMedicalCertificate = null;
    updateMedicalCertificateSummary_();
  }
};

window.openMedicalCertificateModal = function() {
  const modal = document.getElementById("modalMedicalCertificate");
  if (!modal) return;
  fillMedicalCertificateModalFields_(currentMedicalCertificate || {});
  modal.classList.add("active");
};

window.closeMedicalCertificateModal = function() {
  const modal = document.getElementById("modalMedicalCertificate");
  if (!modal) return;
  // Si se cierra sin guardar, restauramos los datos persistidos para descartar borradores.
  fillMedicalCertificateModalFields_(currentMedicalCertificate || {});
  modal.classList.remove("active");
};

window.saveMedicalCertificateModal = function() {
  const cert = readMedicalCertificateFromModal_();
  const valid = validateMedicalCertificateData_(cert);
  if (!valid.ok) {
    alert(valid.message);
    return;
  }
  currentMedicalCertificate = valid.data;
  updateMedicalCertificateSummary_();
  closeMedicalCertificateModal();
};

function getDiagnosisJsPdf_() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error("No se pudo cargar la libreria PDF.");
  }
  return window.jspdf.jsPDF;
}

function diagnosisPdfValueToText_(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    return value.map((item) => diagnosisPdfValueToText_(item)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (e) {
      return "";
    }
  }
  return String(value).trim();
}

function getDiagnosisDoctorDisplayName_() {
  const session = getSessionDataSafe();
  const data = session && session.data ? session.data : {};
  return String(data.nombre_doctor || data.nombre || data.usuario || "").trim();
}

function getDiagnosisDoctorMeta_() {
  const session = getSessionDataSafe();
  const data = session && session.data ? session.data : {};
  const roleRaw = String(data.rol || data.ocupacion || "DOCTOR").trim().toUpperCase();
  return {
    name: String(data.nombre_doctor || data.nombre || data.usuario || "").trim(),
    role: roleRaw || "DOCTOR",
    register: String(data.registro_sanitario || "").trim()
  };
}

function getDiagnosisPatientCode_() {
  const codeEl = document.getElementById("clinId");
  const code = codeEl ? String(codeEl.innerText || codeEl.textContent || "").trim() : "";
  return code || ("ID: " + String(currentPatientId || "--"));
}

function getDiagnosisPatientCedulaForPdf_() {
  const cedulaEl = document.getElementById("displayCedula");
  const raw = cedulaEl ? String(cedulaEl.innerText || cedulaEl.textContent || "").trim() : "";
  if (!raw) return "--";
  const match = raw.match(/:\s*(.+)$/);
  return String(match && match[1] ? match[1] : raw).trim() || "--";
}

function getDiagnosisPatientAgeForPdf_() {
  const ageEl = document.getElementById("displayEdad");
  const raw = ageEl ? String(ageEl.innerText || ageEl.textContent || "").trim() : "";
  return raw || "--";
}

function getDiagnosisServiceMeta_(serviceName) {
  const target = String(serviceName || "").trim();
  const list = Array.isArray(SERVICES_METADATA) ? SERVICES_METADATA : [];
  if (!target || !list.length) return null;
  const exact = list.find((item) => String((item && item.nombre_servicio) || "").trim() === target);
  if (exact) return exact;
  const upper = target.toUpperCase();
  return list.find((item) => String((item && item.nombre_servicio) || "").trim().toUpperCase() === upper) || null;
}

function getDiagnosisReportTitle_(serviceName) {
  const service = String(serviceName || "").trim();
  const meta = getDiagnosisServiceMeta_(service);
  const custom = meta && meta.titulo_reporte ? String(meta.titulo_reporte).trim() : "";
  if (custom) return custom.toUpperCase();
  if (service) return service.toUpperCase();
  return "REPORTE CLINICO";
}

function diagnosisValueToHtmlLines_(value) {
  const safe = escapeHtmlDiagnosis_(diagnosisPdfValueToText_(value));
  if (!safe) return "";
  return safe.replace(/\n/g, "<br>");
}

function diagnosisNormalizeOptionValues_(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((v) => String(v || "").trim())
    .filter(Boolean);
}

function diagnosisParseConfiguredOptions_(raw) {
  return String(raw || "")
    .split(",")
    .map((v) => String(v || "").trim())
    .filter(Boolean);
}

function diagnosisBuildCheckboxLines_(options, selectedValues) {
  const configured = Array.isArray(options) ? options : [];
  const selected = Array.isArray(selectedValues) ? selectedValues : [];
  const selectedSet = new Set(selected.map((v) => String(v || "").trim()).filter(Boolean));
  const finalOptions = configured.length
    ? configured
    : Array.from(selectedSet);
  return finalOptions.map((opt) => {
    const text = String(opt || "").trim();
    if (!text) return "";
    const mark = selectedSet.has(text) ? "[x]" : "[ ]";
    return mark + " " + text;
  }).filter(Boolean);
}

function formatDiagnosisGeneratedAtText_(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date();
  try {
    return date.toLocaleString("es-EC");
  } catch (e) {
    return date.toISOString();
  }
}

function formatDiagnosisDateOnlyText_(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue || Date.now());
  if (!date || Number.isNaN(date.getTime())) {
    try {
      return new Date().toLocaleDateString("es-EC");
    } catch (e) {
      return "--";
    }
  }
  try {
    return date.toLocaleDateString("es-EC");
  } catch (e) {
    return date.toISOString().split("T")[0];
  }
}

function buildDiagnosisTemplateFieldsHtml_(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) {
    return "<div style=\"font-size:10pt;color:#666;\">Sin campos clinicos para mostrar.</div>";
  }
  return list.map((entry) => renderDiagnosisTemplateEntryHtml_(entry)).filter(Boolean).join("");
}

function renderDiagnosisTemplateEntryHtml_(entry) {
  const type = String((entry && entry.type) || "").trim().toLowerCase();
  const label = escapeHtmlDiagnosis_(String((entry && entry.label) || "").trim());
  if (!label) return "";

  if (type === "select") {
    const selectedText = diagnosisValueToHtmlLines_(entry && entry.value);
    if (!selectedText) return "";
    return ""
      + "<section style=\"margin:0 0 4mm 0; page-break-inside:avoid;\">"
      + "<div style=\"display:flex;align-items:flex-start;gap:2mm;flex-wrap:wrap;font-size:10pt;line-height:1.45;color:#222;\">"
      + "<span style=\"font-weight:700;color:#36235d;\">" + label + ":</span>"
      + "<span>" + selectedText + "</span>"
      + "</div>"
      + "</section>";
  }

  if (type === "casillas_opciones") {
    const options = Array.isArray(entry && entry.options) ? entry.options : [];
    const selected = Array.isArray(entry && entry.selected) ? entry.selected : diagnosisNormalizeOptionValues_(entry && entry.value);
    const lines = diagnosisBuildCheckboxLines_(options, selected);
    if (!lines.length) return "";
    const linesHtml = lines
      .map((line) => "<div style=\"margin:0 0 1mm 0;\">" + escapeHtmlDiagnosis_(line) + "</div>")
      .join("");
    return ""
      + "<section style=\"margin:0 0 4mm 0; page-break-inside:avoid;\">"
      + "<div style=\"font-size:10pt;font-weight:700;color:#36235d;margin-bottom:1mm;\">" + label + "</div>"
      + "<div style=\"font-size:10pt;line-height:1.45;color:#222;\">" + linesHtml + "</div>"
      + "</section>";
  }

  const value = diagnosisValueToHtmlLines_(entry && entry.value);
  if (!value) return "";
  return ""
    + "<section style=\"margin:0 0 4mm 0; page-break-inside:avoid;\">"
    + "<div style=\"font-size:10pt;font-weight:700;color:#36235d;margin-bottom:1mm;\">" + label + "</div>"
    + "<div style=\"font-size:10pt;line-height:1.45;color:#222;\">" + value + "</div>"
    + "</section>";
}

function buildDiagnosisTemplateImagesHtml_(images) {
  const list = Array.isArray(images) ? images : [];
  if (!list.length) return "";
  const blocks = list.map((item, index) => {
    const title = escapeHtmlDiagnosis_(String((item && item.title) || ("Imagen " + (index + 1))).trim());
    const src = escapeHtmlDiagnosis_(String((item && item.dataUrl) || "").trim());
    const size = String((item && item.size) || "").trim().toLowerCase();
    if (!src) return "";
    const frameStyle = size === "large"
      ? "width:100%;height:112mm;"
      : size === "medium"
        ? "width:48%;height:80mm;"
        : "width:31%;height:53mm;";
    return ""
      + "<figure style=\"margin:0 0 4mm 0; page-break-inside:avoid; " + frameStyle + " display:inline-flex; flex-direction:column;\">"
      + "<figcaption style=\"font-size:9pt;font-weight:700;color:#36235d;margin:0 0 1.5mm 0;\">" + title + "</figcaption>"
      + "<img src=\"" + src + "\" alt=\"" + title + "\" style=\"width:100%;height:100%;display:block;border:1px solid #ddd;border-radius:2mm;object-fit:contain;background:#fff;\">"
      + "</figure>";
  }).filter(Boolean).join("");
  if (!blocks) return "";
  return ""
    + "<section style=\"margin-top:2mm;\">"
    + "<div style=\"font-size:10pt;font-weight:700;color:#36235d;margin:0 0 2mm 0;\">Evidencia Fotográfica</div>"
    + "<div style=\"display:flex;flex-wrap:wrap;gap:2.4mm;align-items:flex-start;\">"
    + blocks
    + "</div>"
    + "</section>";
}

function buildDiagnosisTemplatePatientHeaderHtml_(payload, generatedAtText) {
  const data = payload || {};
  const patientName = String(
    data.nombre_paciente
    || ((document.getElementById("patientNameDisplay") || {}).value)
    || "PACIENTE"
  ).trim();
  const ageText = getDiagnosisPatientAgeForPdf_();
  const cedula = getDiagnosisPatientCedulaForPdf_();
  return ""
    + "<table style=\"width:100%;border-collapse:collapse;margin:0 0 4mm 0;font-size:10pt;color:#1f2937;\">"
    + "<tr>"
    + "<td style=\"padding:0 0 1.2mm 0;font-weight:700;\">PACIENTE: " + escapeHtmlDiagnosis_(patientName) + "</td>"
    + "<td style=\"padding:0 0 1.2mm 0;font-weight:700;text-align:right;\">EDAD: " + escapeHtmlDiagnosis_(ageText) + "</td>"
    + "</tr>"
    + "<tr>"
    + "<td style=\"padding:0;font-weight:700;\">C.I.: " + escapeHtmlDiagnosis_(cedula) + "</td>"
    + "<td style=\"padding:0;font-weight:700;text-align:right;\">FECHA: " + escapeHtmlDiagnosis_(generatedAtText) + "</td>"
    + "</tr>"
    + "</table>";
}

function formatDiagnosisDoctorRoleForSignature_(value) {
  const raw = String(value || "DOCTOR").trim().toUpperCase();
  if (!raw) return "DOCTOR";
  if (raw.length > 22 && raw.indexOf(" Y ") > -1) return raw.replace(" Y ", "<br>Y ");
  if (raw.length > 24 && raw.indexOf(" / ") > -1) return raw.replace(" / ", "<br>");
  return raw;
}

function getDiagnosisSignatureLogoSrc_() {
  const fromHeader = document.querySelector(".logo-icon");
  if (fromHeader && String(fromHeader.src || "").trim()) {
    return String(fromHeader.src || "").trim();
  }
  const candidates = [
    "assets/logo2.png",
    "./assets/logo2.png",
    "../assets/logo2.png",
    "/assets/logo2.png"
  ];
  for (let i = 0; i < candidates.length; i++) {
    try {
      return new URL(candidates[i], window.location.href).toString();
    } catch (e) {}
  }
  return "";
}

function buildDiagnosisTemplateSignatureHtml_(payload) {
  const data = payload || {};
  const includeSignature = !!data.incluir_firma_virtual;
  if (!includeSignature) return "";

  const meta = getDiagnosisDoctorMeta_();
  const doctorName = String(meta.name || "").trim();
  if (!doctorName) return "";
  const roleLine = formatDiagnosisDoctorRoleForSignature_(meta.role);
  const registerLine = String(meta.register || "").trim();
  const logoSrc = getDiagnosisSignatureLogoSrc_();

  return ""
    + "<section style=\"margin-top:39mm; page-break-inside:avoid; text-align:center;\">"
    + "<div style=\"display:inline-block; min-width:95mm; padding-top:2mm; border-top:1px solid #b9b9b9;\">"
    + "<div style=\"font-size:12pt; font-style:italic; font-weight:700; color:#2f2541; line-height:1.2;\">"
    + escapeHtmlDiagnosis_(doctorName)
    + "</div>"
    + "<div style=\"display:inline-flex; align-items:center; justify-content:center; gap:3.2mm; margin-top:1.3mm;\">"
    + (logoSrc
      ? "<img src=\"" + escapeHtmlDiagnosis_(logoSrc) + "\" alt=\"Logo institucional\" style=\"height:12.5mm; width:auto; object-fit:contain;\" onerror=\"this.style.display='none';\"/>"
      : "")
    + "<div style=\"text-align:left;\">"
    + "<div style=\"font-size:9pt; font-weight:700; color:#4a386d; line-height:1.25;\">"
    + roleLine
    + "</div>"
    + (registerLine
      ? "<div style=\"font-size:8.3pt; font-style:italic; color:#5a5a5a; margin-top:0.7mm;\">Reg. San. "
        + escapeHtmlDiagnosis_(registerLine)
        + "</div>"
      : "")
    + "</div>"
    + "</div>"
    + "</div>"
    + "</section>";
}

function buildDiagnosisTemplateMainHtml_(payload, fieldEntries, resolvedImages) {
  const data = payload || {};
  const serviceName = String(data.tipo_examen || "").trim();
  const reportTitle = getDiagnosisReportTitle_(serviceName);
  const generatedAt = formatDiagnosisDateOnlyText_(getClinicalReportDateForDisplay_(data));
  const headerHtml = buildDiagnosisTemplatePatientHeaderHtml_(data, generatedAt);
  const bodyHtml = buildDiagnosisTemplateBodyHtml_(data, fieldEntries, resolvedImages);
  const signatureHtml = buildDiagnosisTemplateSignatureHtml_(data);

  return ""
    + "<article style=\"font-family:Arial,sans-serif;color:#222;\">"
    + headerHtml
    + "<h1 style=\"font-size:15pt;letter-spacing:0.2px;color:#36235d;margin:0 0 4mm 0;text-align:center;\">"
    + escapeHtmlDiagnosis_(reportTitle)
    + "</h1>"
    + bodyHtml
    + signatureHtml
    + "</article>";
}

function buildDiagnosisTemplateBodyHtml_(payload, fieldEntries, resolvedImages) {
  const data = payload || {};
  const service = String(data.tipo_examen || "").trim();
  const entries = Array.isArray(fieldEntries) ? fieldEntries : [];
  const images = Array.isArray(resolvedImages) ? resolvedImages : [];
  const config = CONFIG_CAMPOS && Array.isArray(CONFIG_CAMPOS[service]) ? CONFIG_CAMPOS[service] : [];

  if (!config.length) {
    return buildDiagnosisTemplateFieldsHtml_(entries) + buildDiagnosisTemplateImagesHtml_(images);
  }

  const renderedByKey = new Set();
  const out = [];
  let insertedImages = false;

  config.forEach((item) => {
    const type = String((item && item.tipo) || "").trim().toLowerCase();
    const key = String((item && item.nombre) || "").trim();

    if (type === "titulo") {
      const title = escapeHtmlDiagnosis_(String((item && item.etiqueta) || "").trim());
      if (!title) return;
      out.push("<section style=\"margin:2mm 0 4mm 0; page-break-inside:avoid;\"><h3 style=\"font-size:11pt;color:#36235d;margin:0;padding-bottom:1.2mm;border-bottom:1px solid #e1dfef;\">" + title + "</h3></section>");
      return;
    }

    if (type === "imagenes") {
      if (!insertedImages && images.length) {
        out.push(buildDiagnosisTemplateImagesHtml_(images));
        insertedImages = true;
      }
      return;
    }

    if (!key) return;
    const entry = entries.find((e) => String((e && e.key) || "").trim() === key);
    if (!entry) return;
    const block = renderDiagnosisTemplateEntryHtml_(entry);
    if (!block) return;
    renderedByKey.add(key);
    out.push(block);
  });

  entries.forEach((entry) => {
    const key = String((entry && entry.key) || "").trim();
    if (key && renderedByKey.has(key)) return;
    const block = renderDiagnosisTemplateEntryHtml_(entry);
    if (block) out.push(block);
  });

  if (!insertedImages && images.length) {
    out.push(buildDiagnosisTemplateImagesHtml_(images));
  }

  return out.join("");
}

function buildDiagnosisTemplateRecipeRowsHtml_(meds) {
  const rows = Array.isArray(meds) ? meds : [];
  return rows.map((item) => {
    const name = escapeHtmlDiagnosis_(String(item && item.nombre || "").trim());
    if (!name) return "";
    const qty = escapeHtmlDiagnosis_(String(item && item.cantidad || "").trim());
    const freq = diagnosisValueToHtmlLines_(item && item.frecuencia);
    return ""
      + "<tr>"
      + "<td style=\"border:1px solid #d6d6e7;padding:2.2mm 2.5mm;font-size:10pt;vertical-align:top;\">" + name + "</td>"
      + "<td style=\"border:1px solid #d6d6e7;padding:2.2mm 2.5mm;font-size:10pt;text-align:center;vertical-align:top;\">" + (qty || "--") + "</td>"
      + "<td style=\"border:1px solid #d6d6e7;padding:2.2mm 2.5mm;font-size:10pt;vertical-align:top;\">" + (freq || "--") + "</td>"
      + "</tr>";
  }).filter(Boolean).join("");
}

function buildDiagnosisTemplateRecipeHtml_(payload) {
  const data = payload || {};
  const meds = buildDiagnosisRecipeRows_(data);
  const generatedAt = formatDiagnosisDateOnlyText_(getClinicalReportDateForDisplay_(data));
  const headerHtml = buildDiagnosisTemplatePatientHeaderHtml_(data, generatedAt);
  const rowsHtml = buildDiagnosisTemplateRecipeRowsHtml_(meds);
  const obs = diagnosisValueToHtmlLines_(data.observaciones_receta);
  const signatureHtml = buildDiagnosisTemplateSignatureHtml_(data);

  return ""
    + "<article style=\"font-family:Arial,sans-serif;color:#222;\">"
    + headerHtml
    + "<h1 style=\"font-size:15pt;letter-spacing:0.2px;color:#36235d;margin:0 0 4mm 0;text-align:center;\">RECETA MEDICA</h1>"
    + "<table style=\"width:100%;border-collapse:collapse;margin:0 0 3.5mm 0;\">"
    + "<thead>"
    + "<tr>"
    + "<th style=\"border:1px solid #d6d6e7;background:#f2f1fa;color:#36235d;padding:2.2mm 2.5mm;font-size:9.5pt;text-align:center;\">MEDICAMENTO</th>"
    + "<th style=\"border:1px solid #d6d6e7;background:#f2f1fa;color:#36235d;padding:2.2mm 2.5mm;font-size:9.5pt;text-align:center;width:22mm;\">CANT</th>"
    + "<th style=\"border:1px solid #d6d6e7;background:#f2f1fa;color:#36235d;padding:2.2mm 2.5mm;font-size:9.5pt;text-align:center;\">INDICACIONES</th>"
    + "</tr>"
    + "</thead>"
    + "<tbody>"
    + (rowsHtml || "<tr><td colspan=\"3\" style=\"border:1px solid #d6d6e7;padding:2.5mm;font-size:10pt;color:#666;\">Sin medicamentos registrados.</td></tr>")
    + "</tbody>"
    + "</table>"
    + (obs
      ? "<section style=\"margin-top:2mm; page-break-inside:avoid;\">"
        + "<div style=\"font-size:10pt;font-weight:700;color:#36235d;margin-bottom:1mm;\">OBSERVACIONES</div>"
        + "<div style=\"font-size:10pt;line-height:1.45;color:#222;\">" + obs + "</div>"
        + "</section>"
      : "")
    + signatureHtml
    + "</article>";
}

function buildDiagnosisTemplateMedicalCertificateHtml_(payload) {
  const data = payload || {};
  const cert = normalizeMedicalCertificateData_(data.certificado_medico || {});
  const reportDate = getClinicalReportDateForDisplay_(data);
  const longDate = formatCertificateLongDate_(reportDate);
  const diagnosisLines = diagnosisValueToHtmlLines_(cert.diagnostico);
  const restSummary = getCertificateRestSummaryText_(cert);
  const reposoLinea = cert.reposo_sugerido === "SI" ? "SI" : "NO";
  const signatureHtml = buildDiagnosisTemplateSignatureHtml_(data);

  return ""
    + "<article style=\"font-family:Arial,sans-serif;color:#111;\">"
    + "<h1 style=\"font-size:26pt; margin:0 0 12mm 0; text-align:center; color:#000; letter-spacing:0.5px;\">CERTIFICADO MÉDICO</h1>"
    + "<p style=\"margin:0 0 14mm 0; text-align:right; font-size:10.5pt;\">"
    + escapeHtmlDiagnosis_(String(cert.ciudad || "Guayaquil") + ", " + longDate)
    + "</p>"
    + "<p style=\"font-size:11pt; line-height:1.7; margin:0 0 2.5mm 0; text-align:justify;\">"
    + "Por medio del presente se certifica que la paciente <strong>" + escapeHtmlDiagnosis_(cert.nombre_paciente) + "</strong> con <strong>C.I " + escapeHtmlDiagnosis_(cert.cedula) + "</strong>. "
    + "Acudió a consulta médica en el establecimiento, presentando un cuadro clínico de <strong>" + diagnosisValueToHtmlLines_(cert.cuadro_clinico) + "</strong>, "
    + "por lo cual fue valorada y atendida conforme a la sintomatología referida. Con diagnóstico:"
    + "</p>"
    + "<div style=\"font-size:11pt; line-height:1.6; margin:0 0 2.5mm 7mm;\">&#8226; " + (diagnosisLines || "--") + "</div>"
    + "<p style=\"font-size:11pt; line-height:1.7; margin:0 0 2.5mm 0; text-align:justify;\">"
    + "El presente certificado se otorga a petición de la persona interesada para los fines que crea conveniente."
    + "</p>"
    + "<p style=\"font-size:11pt; line-height:1.7; margin:0 0 9mm 0;\">"
    + "<strong>Reposo médico:</strong> " + escapeHtmlDiagnosis_(reposoLinea)
    + (restSummary ? ("<br><strong>" + escapeHtmlDiagnosis_(restSummary) + "</strong>") : "")
    + "</p>"
    + signatureHtml
    + "</article>";
}

async function buildDiagnosisMedicalCertificatePdfDataUrl_(payload) {
  const data = payload || {};
  if (!hasMeaningfulMedicalCertificateContent_(data)) return "";
  try {
    const htmlTemplatePdf = await buildDiagnosisPdfFromHtmlTemplateDataUrl_(function() {
      return buildDiagnosisTemplateMedicalCertificateHtml_(data);
    });
    if (htmlTemplatePdf) return htmlTemplatePdf;
  } catch (e) {
    console.warn("No se pudo renderizar el certificado medico con plantilla HTML.", e);
  }

  // Fallback: generar PDF clasico para evitar quedarnos sin certificado
  const cert = normalizeMedicalCertificateData_(data.certificado_medico || {});
  const jsPDF = getDiagnosisJsPdf_();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const reportDate = getClinicalReportDateForDisplay_(data);
  const longDate = formatCertificateLongDate_(reportDate);
  const restSummary = getCertificateRestSummaryText_(cert);
  const reposoLinea = cert.reposo_sugerido === "SI" ? "SI" : "NO";
  let y = 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.text("CERTIFICADO MÉDICO", 105, y, { align: "center" });
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(String((cert.ciudad || "Guayaquil") + ", " + (longDate || "")).trim(), 195, y, { align: "right" });
  y += 14;

  const writeParagraph = (text) => {
    const lines = doc.splitTextToSize(String(text || "").trim(), 178);
    y = ensureDiagnosisPdfSpace_(doc, y, Math.max(8, (lines.length * 5) + 2));
    doc.text(lines, 16, y);
    y += Math.max(8, lines.length * 5 + 2);
  };

  writeParagraph(
    "Por medio del presente se certifica que la paciente "
    + cert.nombre_paciente
    + " con C.I " + cert.cedula
    + ". Acudió a consulta médica en el establecimiento, presentando un cuadro clínico de "
    + cert.cuadro_clinico
    + ", por lo cual fue valorada y atendida conforme a la sintomatología referida."
  );

  writeParagraph("Diagnóstico: " + cert.diagnostico);

  writeParagraph(
    "El presente certificado se otorga a petición de la persona interesada para los fines que crea conveniente."
  );

  y += 10;
  writeParagraph("Reposo médico: " + reposoLinea);
  if (restSummary) {
    writeParagraph(restSummary);
  }

  if (data.incluir_firma_virtual) {
    const doctorName = getDiagnosisDoctorDisplayName_();
    if (doctorName) {
      y += 14;
      y = ensureDiagnosisPdfSpace_(doc, y, 20);
      doc.setDrawColor(190, 190, 190);
      doc.line(120, y + 8, 190, y + 8);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(doctorName, 155, y + 14, { align: "center" });
    }
  }

  return doc.output("datauristring");
}

async function loadDiagnosisHtmlTemplate_() {
  if (diagnosisHtmlTemplateCache_) return diagnosisHtmlTemplateCache_;
  const candidates = [
    DIAGNOSIS_HTML_TEMPLATE_PATH,
    "./plantilla_vidafem.html",
    "../plantilla_vidafem.html",
    "/plantilla_vidafem.html"
  ];
  let lastError = "";
  for (let i = 0; i < candidates.length; i++) {
    const raw = String(candidates[i] || "").trim();
    if (!raw) continue;
    try {
      const templateUrl = new URL(raw, window.location.href).toString();
      const response = await fetch(templateUrl, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) {
        lastError = "HTTP " + response.status + " en " + templateUrl;
        continue;
      }
      diagnosisHtmlTemplateCache_ = await response.text();
      if (diagnosisHtmlTemplateCache_) return diagnosisHtmlTemplateCache_;
    } catch (e) {
      lastError = (e && e.message) ? e.message : String(e || "");
    }
  }
  throw new Error("No se pudo cargar la plantilla HTML del reporte. " + (lastError || ""));
}

async function waitForDiagnosisTemplateImages_(root) {
  const scope = root || document;
  const images = Array.from(scope.querySelectorAll("img"));
  if (!images.length) return;
  await Promise.all(images.map((img) => new Promise((resolve) => {
    if (img.complete) {
      resolve();
      return;
    }
    const done = () => resolve();
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
    setTimeout(done, 1500);
  })));
}

function withDiagnosisTimeout_(promise, timeoutMs, timeoutMessage) {
  const ms = Math.max(1000, Number(timeoutMs || 0));
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(String(timeoutMessage || "La operación tardó demasiado.")));
    }, ms);

    Promise.resolve(promise)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

function diagnosisDataUrlToBlob_(dataUrl) {
  const raw = String(dataUrl || "").trim();
  if (!raw || raw.indexOf(",") === -1) {
    throw new Error("PDF local inválido.");
  }
  const parts = raw.split(",");
  const header = parts[0] || "";
  const body = parts.slice(1).join(",");
  const mimeMatch = /data:([^;]+)/i.exec(header);
  const mime = mimeMatch && mimeMatch[1] ? mimeMatch[1] : "application/pdf";
  const binary = window.atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

async function openDiagnosisPdfInWindow_(pdfWindow, pdfUrl) {
  if (!pdfWindow) return false;
  const target = String(pdfUrl || "").trim();
  if (!target) return false;

  if (!/^data:application\/pdf/i.test(target)) {
    pdfWindow.location.href = target;
    return true;
  }

  const blob = diagnosisDataUrlToBlob_(target);
  const blobUrl = URL.createObjectURL(blob);
  try {
    pdfWindow.location.replace(blobUrl);
  } catch (e) {
    pdfWindow.document.open();
    pdfWindow.document.write('<html><body style="margin:0;background:#111;"><iframe src="' + blobUrl + '" style="border:none;width:100vw;height:100vh;"></iframe></body></html>');
    pdfWindow.document.close();
  }
  setTimeout(() => {
    try {
      URL.revokeObjectURL(blobUrl);
    } catch (e) {}
  }, 120000);
  return true;
}

function isDiagnosisCanvasSliceMostlyBlank_(canvas, startY, sliceHeight) {
  if (!canvas || sliceHeight <= 0 || sliceHeight > 96) return false;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  try {
    const image = ctx.getImageData(0, startY, canvas.width, sliceHeight).data;
    let nonWhite = 0;
    const step = 24;
    for (let y = 0; y < sliceHeight; y += 3) {
      for (let x = 0; x < canvas.width; x += step) {
        const idx = ((y * canvas.width) + x) * 4;
        if (image[idx] < 246 || image[idx + 1] < 246 || image[idx + 2] < 246) {
          nonWhite += 1;
          if (nonWhite > 4) return false;
        }
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

function findDiagnosisBestSliceHeight_(canvas, startY, targetSliceHeight) {
  if (!canvas || !targetSliceHeight) return targetSliceHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return targetSliceHeight;

  const totalHeight = canvas.height;
  const targetEnd = Math.min(totalHeight, startY + targetSliceHeight);
  if (targetEnd >= totalHeight) return totalHeight - startY;

  const minSliceHeight = Math.max(220, Math.floor(targetSliceHeight * 0.58));
  const minEnd = Math.min(totalHeight, startY + minSliceHeight);
  const searchStart = Math.max(minEnd, targetEnd - 240);
  const searchEnd = Math.min(totalHeight - 1, targetEnd + 140);
  const searchHeight = searchEnd - searchStart + 1;
  if (searchHeight <= 2) return targetSliceHeight;

  try {
    const image = ctx.getImageData(0, searchStart, canvas.width, searchHeight).data;
    const sampleStepX = Math.max(6, Math.floor(canvas.width / 180));
    const pixelsPerRow = Math.ceil(canvas.width / sampleStepX);

    let bestY = targetEnd;
    let bestDensity = Number.POSITIVE_INFINITY;

    for (let row = 0; row < searchHeight; row += 1) {
      let nonWhite = 0;
      for (let x = 0; x < canvas.width; x += sampleStepX) {
        const idx = ((row * canvas.width) + x) * 4;
        const r = image[idx];
        const g = image[idx + 1];
        const b = image[idx + 2];
        if (r < 245 || g < 245 || b < 245) nonWhite += 1;
      }
      const density = nonWhite / pixelsPerRow;
      const y = searchStart + row;

      if (density < bestDensity) {
        bestDensity = density;
        bestY = y;
      }
      if (density <= 0.002 && y >= targetEnd - 80) {
        bestY = y;
        bestDensity = density;
        break;
      }
    }

    if (bestDensity <= 0.16 && bestY > startY + 120) {
      return bestY - startY;
    }
  } catch (e) {
    return targetSliceHeight;
  }

  return targetSliceHeight;
}

function buildDiagnosisPdfDataUrlFromCanvas_(canvas, JsPdfCtor) {
  const doc = new JsPdfCtor({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageHeightPx = Math.max(1, Math.round(canvas.width * (pageHeight / pageWidth)));
  let offsetY = 0;
  let pageIndex = 0;

  while (offsetY < canvas.height) {
    const remaining = canvas.height - offsetY;
    let sliceHeight = Math.min(pageHeightPx, remaining);
    if (sliceHeight < remaining) {
      sliceHeight = findDiagnosisBestSliceHeight_(canvas, offsetY, sliceHeight);
      sliceHeight = Math.max(80, Math.min(sliceHeight, remaining));
    }
    if (pageIndex > 0 && sliceHeight < 28 && isDiagnosisCanvasSliceMostlyBlank_(canvas, offsetY, sliceHeight)) {
      break;
    }
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceHeight;
    const pageCtx = pageCanvas.getContext("2d");
    if (!pageCtx) {
      throw new Error("No se pudo preparar una pagina intermedia del PDF.");
    }
    pageCtx.drawImage(canvas, 0, offsetY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
    const imgData = pageCanvas.toDataURL("image/jpeg", 0.95);
    const renderHeight = (sliceHeight * pageWidth) / canvas.width;
    if (pageIndex > 0) doc.addPage();
    doc.addImage(imgData, "JPEG", 0, 0, pageWidth, renderHeight, undefined, "FAST");
    offsetY += sliceHeight;
    pageIndex += 1;
  }

  return doc.output("datauristring");
}

async function buildDiagnosisPdfFromHtmlTemplateDataUrl_(innerHtmlBuilder) {
  if (!window.html2canvas) return "";
  const JsPdfCtor = getDiagnosisJsPdf_();
  const templateHtml = await loadDiagnosisHtmlTemplate_();
  if (!templateHtml) return "";

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-100000px";
  host.style.top = "0";
  host.style.opacity = "1";
  host.style.pointerEvents = "none";
  host.style.zIndex = "-1";

  try {
    host.innerHTML = templateHtml;
    const content = host.querySelector(".content");
    const page = host.querySelector(".page");
    if (!content || !page) return "";

    const builtInnerHtml = String(typeof innerHtmlBuilder === "function" ? innerHtmlBuilder() : "").trim();
    if (!builtInnerHtml) return "";
    page.style.overflow = "hidden";
    page.style.boxShadow = "none";
    page.style.margin = "0";

    document.body.appendChild(host);
    await waitForDiagnosisTemplateImages_(host);

    const parser = document.createElement("div");
    parser.innerHTML = builtInnerHtml;
    const article = parser.querySelector("article");
    const articleStyle = article
      ? String(article.getAttribute("style") || "font-family:Arial,sans-serif;color:#222;")
      : "font-family:Arial,sans-serif;color:#222;";
    const blocks = article
      ? Array.from(article.children).map((el) => el.outerHTML).filter(Boolean)
      : [builtInnerHtml];

    const renderArticleHtml = (blockList) => {
      return "<article style=\"" + escapeHtmlDiagnosis_(articleStyle) + "\">" + (Array.isArray(blockList) ? blockList.join("") : "") + "</article>";
    };

    const maxContentHeight = Math.max(220, content.clientHeight || 0);
    const pages = [];
    let currentBlocks = [];

    for (let i = 0; i < blocks.length; i++) {
      const blockHtml = blocks[i];
      currentBlocks.push(blockHtml);
      content.innerHTML = renderArticleHtml(currentBlocks);

      if (content.scrollHeight <= maxContentHeight + 2) {
        continue;
      }

      if (currentBlocks.length === 1) {
        pages.push(currentBlocks.slice());
        currentBlocks = [];
        continue;
      }

      const overflowBlock = currentBlocks.pop();
      pages.push(currentBlocks.slice());
      currentBlocks = [overflowBlock];
      content.innerHTML = renderArticleHtml(currentBlocks);
      if (content.scrollHeight > maxContentHeight + 2 && currentBlocks.length === 1) {
        pages.push(currentBlocks.slice());
        currentBlocks = [];
      }
    }

    if (currentBlocks.length) pages.push(currentBlocks.slice());
    if (!pages.length) pages.push(blocks.length ? blocks : [builtInnerHtml]);

    const doc = new JsPdfCtor({ unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    for (let p = 0; p < pages.length; p++) {
      content.innerHTML = renderArticleHtml(pages[p]);
      await waitForDiagnosisTemplateImages_(content);

      const canvas = await withDiagnosisTimeout_(
        window.html2canvas(page, {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
          logging: false,
          imageTimeout: 2000
        }),
        22000,
        "El render HTML del PDF tardó demasiado."
      );
      if (!canvas || !canvas.width || !canvas.height) continue;

      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      if (p > 0) doc.addPage();
      doc.addImage(imgData, "JPEG", 0, 0, pageWidth, pageHeight, undefined, "FAST");
    }

    return doc.output("datauristring");
  } finally {
    if (host && host.parentNode) {
      host.parentNode.removeChild(host);
    }
  }
}

async function buildDiagnosisReportPdfFromHtmlTemplateDataUrl_(payload, fieldEntries, images) {
  return buildDiagnosisPdfFromHtmlTemplateDataUrl_(function() {
    return buildDiagnosisTemplateMainHtml_(payload, fieldEntries, images);
  });
}

async function buildDiagnosisRecipePdfFromHtmlTemplateDataUrl_(payload) {
  return buildDiagnosisPdfFromHtmlTemplateDataUrl_(function() {
    return buildDiagnosisTemplateRecipeHtml_(payload);
  });
}

function diagnosisPdfLabelFromKey_(key, serviceName) {
  const cleanKey = String(key || "").trim();
  const service = String(serviceName || "").trim();
  const config = CONFIG_CAMPOS && Array.isArray(CONFIG_CAMPOS[service]) ? CONFIG_CAMPOS[service] : [];
  const field = config.find((item) => String((item && item.nombre) || "").trim() === cleanKey);
  if (field && String(field.etiqueta || "").trim()) {
    return String(field.etiqueta || "").trim();
  }

  const labels = {
    motivo: "Motivo de consulta",
    evaluacion: "Evaluacion",
    vagina: "Vagina",
    vulva: "Vulva",
    ano: "Ano",
    hallazgos: "Hallazgos",
    diagnostico: "Diagnóstico",
    biopsia: "Biopsia",
    recomendaciones: "Recomendaciones",
    observaciones_receta: "Observaciones",
  };
  return labels[cleanKey] || cleanKey.replace(/_/g, " ");
}

function buildDiagnosisPdfFieldEntries_(payload) {
  const data = payload || {};
  const service = String(data.tipo_examen || "").trim();
  const entries = [];
  const dynamicData = data.datos_json && typeof data.datos_json === "object" && !Array.isArray(data.datos_json)
    ? data.datos_json
    : null;

  if (dynamicData) {
    const used = {};
    const config = CONFIG_CAMPOS && Array.isArray(CONFIG_CAMPOS[service]) ? CONFIG_CAMPOS[service] : [];
    config.forEach((item) => {
      const type = String((item && item.tipo) || "").trim().toLowerCase();
      const key = String((item && item.nombre) || "").trim();
      if (!key || type === "titulo" || type === "imagenes") return;
      used[key] = true;

      if (type === "casillas_opciones") {
        const selected = diagnosisNormalizeOptionValues_(dynamicData[key]);
        const options = diagnosisParseConfiguredOptions_(item && item.opciones);
        const lines = diagnosisBuildCheckboxLines_(options, selected);
        if (!lines.length) return;
        entries.push({
          key: key,
          label: String((item && item.etiqueta) || key).trim(),
          value: lines.join("\n"),
          type: "casillas_opciones",
          options: options,
          selected: selected
        });
        return;
      }

      if (type === "select") {
        const selectedValue = diagnosisPdfValueToText_(dynamicData[key]);
        if (!selectedValue) return;
        entries.push({
          key: key,
          label: String((item && item.etiqueta) || key).trim(),
          value: selectedValue,
          type: "select"
        });
        return;
      }

      const value = diagnosisPdfValueToText_(dynamicData[key]);
      if (!value) return;
      entries.push({
        key: key,
        label: String((item && item.etiqueta) || key).trim(),
        value: value,
        type: type
      });
    });

    Object.keys(dynamicData).forEach((key) => {
      if (used[key]) return;
      const value = diagnosisPdfValueToText_(dynamicData[key]);
      if (!value) return;
      entries.push({
        key: key,
        label: diagnosisPdfLabelFromKey_(key, service),
        value: value
      });
    });
    return entries;
  }

  [
    "motivo",
    "evaluacion",
    "vagina",
    "vulva",
    "ano",
    "hallazgos",
    "diagnostico",
    "biopsia",
    "recomendaciones"
  ].forEach((key) => {
    const value = diagnosisPdfValueToText_(data[key]);
    if (!value) return;
    entries.push({
      key: key,
      label: diagnosisPdfLabelFromKey_(key, service),
      value: value
    });
  });

  return entries;
}

function hasMeaningfulClinicalPdfContent_(payload) {
  const data = payload || {};
  if (buildDiagnosisPdfFieldEntries_(data).length > 0) return true;
  return Array.isArray(data.imagenes) && data.imagenes.length > 0;
}

function ensureDiagnosisPdfSpace_(doc, currentY, requiredHeight) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginBottom = 16;
  if ((currentY + requiredHeight) <= (pageHeight - marginBottom)) {
    return currentY;
  }
  doc.addPage();
  return 18;
}

function writeDiagnosisPdfField_(doc, currentY, label, value) {
  const safeLabel = String(label || "").trim();
  const safeValue = diagnosisPdfValueToText_(value);
  if (!safeLabel || !safeValue) return currentY;

  const lines = doc.splitTextToSize(safeValue, 118);
  let y = ensureDiagnosisPdfSpace_(doc, currentY, Math.max(12, (lines.length * 5) + 4));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(safeLabel + ":", 14, y);
  doc.setFont("helvetica", "normal");
  doc.text(lines, 72, y);
  return y + Math.max(8, lines.length * 5 + 2);
}

function buildDiagnosisRecipeRows_(payload) {
  const meds = Array.isArray(payload && payload.medicamentos) ? payload.medicamentos : [];
  return meds
    .map((item) => ({
      nombre: String((item && item.nombre) || "").trim(),
      cantidad: String((item && item.cantidad) || "").trim(),
      frecuencia: String((item && item.frecuencia) || "").trim()
    }))
    .filter((item) => !!item.nombre);
}

function blobToDataUrlDiagnosis_(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer un archivo para el PDF."));
    reader.readAsDataURL(blob);
  });
}

async function fetchUrlAsDataUrlDiagnosis_(url) {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) {
    throw new Error("No se pudo cargar un archivo remoto para el PDF.");
  }
  const blob = await response.blob();
  return blobToDataUrlDiagnosis_(blob);
}

async function ensureDiagnosisImageDataUrl_(item) {
  const current = item || {};
  const embedded = String(current.data || current.src || "").trim();
  if (/^data:image\//i.test(embedded)) {
    return embedded;
  }

  const fileId = String(current.fileId || current.file_id || "").trim();
  if (fileId) {
    try {
      const res = await postDiagnosisApiJson_({
        action: "get_file_base64",
        file_id: fileId,
        requester: getRequesterFromSession()
      });
      if (res && res.success && String(res.data || "").trim()) {
        return String(res.data || "").trim();
      }
    } catch (e) {}
  }

  const url = String(current.url || current.src || "").trim();
  if (!url) return "";
  if (/^data:image\//i.test(url)) return url;
  try {
    return await fetchUrlAsDataUrlDiagnosis_(url);
  } catch (e) {
    return "";
  }
}

function loadDiagnosisImageMeta_(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve({
      width: img.naturalWidth || img.width || 1,
      height: img.naturalHeight || img.height || 1
    });
    img.onerror = () => reject(new Error("No se pudo cargar una imagen para el PDF."));
    img.src = dataUrl;
  });
}

function getDiagnosisPdfImageBox_(size) {
  const key = String(size || "").trim().toLowerCase();
  if (key === "large") return { width: 170, height: 110 };
  if (key === "medium") return { width: 120, height: 82 };
  return { width: 86, height: 62 };
}

async function appendDiagnosisPdfImages_(doc, startY, images) {
  const list = Array.isArray(images) ? images : [];
  let y = startY;
  let printedSectionTitle = false;

  for (let i = 0; i < list.length; i++) {
    const image = list[i] || {};
    const dataUrl = await ensureDiagnosisImageDataUrl_(image);
    if (!dataUrl) continue;

    const title = String(image.title || ("Imagen " + (i + 1))).trim();
    const box = getDiagnosisPdfImageBox_(image.size);
    let meta = { width: box.width, height: box.height };
    try {
      meta = await loadDiagnosisImageMeta_(dataUrl);
    } catch (e) {}

    const ratio = Math.min(box.width / Math.max(1, meta.width), box.height / Math.max(1, meta.height));
    const drawWidth = Math.max(20, Math.round(meta.width * ratio));
    const drawHeight = Math.max(20, Math.round(meta.height * ratio));

    if (!printedSectionTitle) {
      y = ensureDiagnosisPdfSpace_(doc, y, drawHeight + 24);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Imágenes clínicas", 14, y);
      y += 7;
      printedSectionTitle = true;
    } else {
      y = ensureDiagnosisPdfSpace_(doc, y, drawHeight + 16);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(title, 14, y);
    y += 4;

    doc.addImage(
      dataUrl,
      /^data:image\/png/i.test(dataUrl) ? "PNG" : "JPEG",
      14,
      y,
      drawWidth,
      drawHeight,
      undefined,
      "FAST"
    );
    y += drawHeight + 8;
  }

  return y;
}

async function buildDiagnosisReportPdfDataUrl_(payload) {
  const data = payload || {};
  const fieldEntries = buildDiagnosisPdfFieldEntries_(data);
  const images = Array.isArray(data.imagenes) ? data.imagenes : [];

  const resolvedImages = [];
  for (let i = 0; i < images.length; i++) {
    const image = images[i] || {};
    const dataUrl = await ensureDiagnosisImageDataUrl_(image);
    if (!dataUrl) continue;
    resolvedImages.push({
      title: String(image.title || ("Imagen " + (i + 1))).trim(),
      size: String(image.size || "small").trim().toLowerCase(),
      data: dataUrl,
      dataUrl: dataUrl
    });
  }

  try {
    const htmlTemplatePdf = await buildDiagnosisReportPdfFromHtmlTemplateDataUrl_(data, fieldEntries, resolvedImages);
    if (htmlTemplatePdf) return htmlTemplatePdf;
  } catch (e) {
    console.warn("No se pudo renderizar el PDF con plantilla HTML, se usa fallback clasico.", e);
  }

  const jsPDF = getDiagnosisJsPdf_();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const serviceName = String(data.tipo_examen || "").trim();
  const patientName = String(
    data.nombre_paciente
    || ((document.getElementById("patientNameDisplay") || {}).value)
    || "PACIENTE"
  ).trim();
  const doctorName = getDiagnosisDoctorDisplayName_();
  const generatedAt = getClinicalReportDateForDisplay_(data);
  let y = 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(getDiagnosisReportTitle_(serviceName), 14, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Servicio: " + (serviceName || "REPORTE"), 14, y);
  y += 6;
  doc.text("Paciente: " + patientName, 14, y);
  y += 6;
  doc.text(getDiagnosisPatientCode_(), 14, y);
  y += 6;
  if (doctorName) {
    doc.text("Profesional: " + doctorName, 14, y);
    y += 6;
  }
  doc.text("Fecha: " + (Number.isNaN(generatedAt.getTime()) ? new Date().toLocaleDateString("es-EC") : generatedAt.toLocaleDateString("es-EC")), 14, y);
  y += 8;

  fieldEntries.forEach((entry) => {
    y = writeDiagnosisPdfField_(doc, y, entry.label, entry.value);
  });

  y = await appendDiagnosisPdfImages_(doc, y + 2, resolvedImages);

  if (data.incluir_firma_virtual) {
    y += 30;
    y = ensureDiagnosisPdfSpace_(doc, y, 20);
    doc.setDrawColor(190, 190, 190);
    doc.line(120, y + 8, 190, y + 8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Firma virtual", 142, y + 14);
  }

  return doc.output("datauristring");
}

async function buildDiagnosisRecipePdfDataUrl_(payload) {
  const data = payload || {};
  const meds = buildDiagnosisRecipeRows_(data);
  const obs = String(data.observaciones_receta || "").trim();
  if (!meds.length && !obs) return "";

  try {
    const htmlTemplatePdf = await buildDiagnosisRecipePdfFromHtmlTemplateDataUrl_(data);
    if (htmlTemplatePdf) return htmlTemplatePdf;
  } catch (e) {
    console.warn("No se pudo renderizar la receta con plantilla HTML, se usa fallback clasico.", e);
  }

  const jsPDF = getDiagnosisJsPdf_();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const patientName = String(
    data.nombre_paciente
    || ((document.getElementById("patientNameDisplay") || {}).value)
    || "PACIENTE"
  ).trim();
  const doctorName = getDiagnosisDoctorDisplayName_();
  let y = 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("RECETA MEDICA", 14, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Paciente: " + patientName, 14, y);
  y += 6;
  doc.text(getDiagnosisPatientCode_(), 14, y);
  y += 6;
  if (doctorName) {
    doc.text("Profesional: " + doctorName, 14, y);
    y += 6;
  }
  const recipeDate = getClinicalReportDateForDisplay_(data);
  doc.text("Fecha: " + (Number.isNaN(recipeDate.getTime()) ? new Date().toLocaleDateString("es-EC") : recipeDate.toLocaleDateString("es-EC")), 14, y);
  y += 10;

  meds.forEach((item, index) => {
    y = ensureDiagnosisPdfSpace_(doc, y, 16);
    doc.setFont("helvetica", "bold");
    doc.text((index + 1) + ". " + item.nombre, 14, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    if (item.cantidad) {
      doc.text("Cantidad: " + item.cantidad, 20, y);
      y += 5;
    }
    if (item.frecuencia) {
      doc.text("Frecuencia: " + item.frecuencia, 20, y);
      y += 5;
    }
    y += 1;
  });

  if (obs) {
    y += 2;
    y = writeDiagnosisPdfField_(doc, y, "Observaciones", obs);
  }

  if (data.incluir_firma_virtual) {
    y += 30;
    y = ensureDiagnosisPdfSpace_(doc, y, 20);
    doc.setDrawColor(190, 190, 190);
    doc.line(120, y + 8, 190, y + 8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Firma virtual", 142, y + 14);
  }

  return doc.output("datauristring");
}

async function buildDiagnosisPdfPayloadsForSave_(payload) {
  const data = payload || {};
  const out = {};
  const examType = String(data.tipo_examen || "").trim().toUpperCase();
  const isRecipeOnly = examType === "RECETA";
  const isExternalPdfOnly = examType === "EXAMENPDF";
  const isCertificateOnly = examType === "CERTIFICADO MEDICO" || examType === "CERTIFICADOMEDICO";
  const shouldBuildReport = !isRecipeOnly && !isExternalPdfOnly && !isCertificateOnly && hasMeaningfulClinicalPdfContent_(data);

  if (shouldBuildReport) {
    const reportPdf = await withDiagnosisTimeout_(
      buildDiagnosisReportPdfDataUrl_(data),
      30000,
      "La generación del PDF del informe tardó demasiado."
    );
    if (reportPdf) out.report_pdf_data_url = reportPdf;
  }

  if (hasMeaningfulRecipeContent_(data)) {
    const recipePdf = await withDiagnosisTimeout_(
      buildDiagnosisRecipePdfDataUrl_(data),
      30000,
      "La generación del PDF de receta tardó demasiado."
    );
    if (recipePdf) out.recipe_pdf_data_url = recipePdf;
  }

  if (isCertificateOnly || hasMeaningfulMedicalCertificateContent_(data)) {
    const certPdf = await withDiagnosisTimeout_(
      buildDiagnosisMedicalCertificatePdfDataUrl_(data),
      30000,
      "La generación del PDF del certificado tardó demasiado."
    );
    if (certPdf) out.certificate_pdf_data_url = certPdf;
    if (isCertificateOnly && !certPdf) {
      throw new Error("No se pudo generar el PDF del certificado medico. Verifica los datos e intenta de nuevo.");
    }
  }

  return out;
}

async function buildDiagnosisCertificatePdfPayloadForSave_(payload) {
  const data = payload || {};
  if (!hasMeaningfulMedicalCertificateContent_(data)) return {};
  const certPdf = await withDiagnosisTimeout_(
    buildDiagnosisMedicalCertificatePdfDataUrl_(data),
    30000,
    "La generación del PDF del certificado tardó demasiado."
  );
  return certPdf ? { certificate_pdf_data_url: certPdf } : {};
}

// Tamaños oficiales del reporte (documento del usuario)
const PHOTO_SIZE_PRESETS = {
  small: { widthCm: 4.32, heightCm: 5.3, perRow: 3 },
  medium: { widthCm: 6.57, heightCm: 8.0, perRow: 2 },
  large: { widthCm: 9.04, heightCm: 11.0, perRow: 1 }
};
const PREVIEW_DPI = 96;
const EXPORT_DPI = 300;

function cmToPx(cm, dpi) {
  return Math.round((cm / 2.54) * dpi);
}

async function resizeBase64Image(base64Str, scale = 1, sizeLabel = "small") {
  const preset = PHOTO_SIZE_PRESETS[sizeLabel] || PHOTO_SIZE_PRESETS.small;
  const targetW = cmToPx(preset.widthCm, EXPORT_DPI);
  const targetH = cmToPx(preset.heightCm, EXPORT_DPI);
  return new Promise((resolve) => {
    const img = new window.Image();
    img.src = base64Str;
    img.onload = () => {
      const scaleFit = Math.min(targetW / img.width, targetH / img.height);
      const drawW = img.width * scaleFit;
      const drawH = img.height * scaleFit;
      const offsetX = (targetW - drawW) / 2;
      const offsetY = (targetH - drawH) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const localCtx = canvas.getContext("2d");
      localCtx.fillStyle = "#fff";
      localCtx.fillRect(0, 0, targetW, targetH);
      localCtx.drawImage(img, offsetX, offsetY, drawW, drawH);
      resolve(canvas.toDataURL("image/jpeg", 0.98));
    };
    img.onerror = () => resolve(base64Str);
  });
}

function applyGalleryLayout(galleryId, size) {
  const grid = document.getElementById(galleryId);
  if (!grid) return;
  const preset = PHOTO_SIZE_PRESETS[size] || PHOTO_SIZE_PRESETS.small;
  grid.style.gridTemplateColumns = `repeat(${preset.perRow}, minmax(0, 1fr))`;
  grid.dataset.size = size;
  const frames = grid.querySelectorAll(".photo-frame");
  frames.forEach((frame) => {
    frame.style.aspectRatio = `${preset.widthCm} / ${preset.heightCm}`;
  });
}



document.addEventListener("DOMContentLoaded", () => {
  if (!requireDoctorSession()) return;
  loadVirtualSignaturePreference_();
  updateMedicalCertificateSummary_();
  console.log("🚀 Iniciando Diagnóstico...");

  // 1. Obtener IDs de la URL
  const urlParams = new URLSearchParams(window.location.search);
  const pId = urlParams.get("patientId") || urlParams.get("id"); 
  const rId = urlParams.get("reportId") || urlParams.get("reporte"); // <--- AHORA LEEMOS EL REPORTE

  // Poner fecha de hoy por defecto
  const fechaInput = document.getElementById("reportDateInput") || document.getElementById("fecha");
  if (fechaInput) {
      const today = new Date();
      fechaInput.value = today.toISOString().split('T')[0];
      fechaInput.addEventListener("change", function() {
        fillMedicalCertificateModalFields_(currentMedicalCertificate || {});
      });
  }

  const certModal = document.getElementById("modalMedicalCertificate");
  if (certModal) {
    certModal.addEventListener("input", updateMedicalCertificateSummary_);
    certModal.addEventListener("change", updateMedicalCertificateSummary_);
  }

  // 2. Cargar Datos del Paciente
  if (pId) {
    currentPatientId = pId;
    const hiddenInput = document.getElementById("selectedPatientId");
    if(hiddenInput) hiddenInput.value = pId;

    if (typeof loadPatientFullData === 'function') loadPatientFullData(pId);
    
    // Ajustar botón volver
    const btnBack = document.querySelector(".btn-back-sidebar");
    if (btnBack) btnBack.href = window.withEnvUrl(`clinical.html?id=${pId}&tab=diagnostico`);
  }

  // 3. CARGA SECUENCIAL CLAVE (Configuración -> Luego Datos)
  // Primero cargamos el menú de servicios (Excel)
  if(typeof loadServicesDropdown === 'function') {
      // Modificamos loadServicesDropdown para que devuelva una Promesa y sepamos cuando terminó
      loadServicesDropdown().then(() => {
          // SOLO SI TERMINÓ DE CARGAR EL MENU Y HAY UN REPORTE, CARGAMOS LOS DATOS
          if (rId) {
              console.log("✏️ Modo Edición detectado. ID:", rId);
              currentReportId = rId; // Guardar ID global
              loadReportForEdit(rId);
          } else {
              setGeneratedDocsState_({});
          }
      });
  }
});

// ==========================================
// 1. GESTIÓN DE FOTOS DINÁMICAS (NUEVO SISTEMA)
// ==========================================

// Generador de ID único para cada slot
function generateId() {
  return "photo_" + Math.random().toString(36).substr(2, 9);
}

// MODIFICADA: Ahora acepta targetId para saber dónde dibujar la foto
window.addPhotoSlot = function (existingData = null, targetContainerId = "dynamicPhotoContainer") {
  const container = document.getElementById(targetContainerId);
  if (!container) return; // Si no existe el contenedor, no hace nada

  const id = generateId(); // ID único interno

  const div = document.createElement("div");
  div.className = "photo-card";
  div.id = `card_${id}`;

  // Valores por defecto
  const imgSrc = existingData ? existingData.src : "";
  const titleVal = existingData ? existingData.title : "";
  const isHidden = imgSrc ? "" : "hidden";
  const placeHidden = imgSrc ? "hidden" : "";
  
  // Guardamos fileId si existe para no resubir
  const fileIdAttr = existingData && existingData.fileId ? `data-fileid="${existingData.fileId}"` : "";
  const fileUrlAttr = existingData && existingData.fileUrl ? `data-fileurl="${existingData.fileUrl}"` : "";
  const sizeAttr = existingData && existingData.size && PHOTO_SIZE_PRESETS[existingData.size]
    ? `data-size="${existingData.size}"`
    : "";

  div.innerHTML = `
        <button type="button" class="btn-remove-photo" onclick="removePhotoSlot('${id}')" title="Eliminar foto"><i class="fas fa-times"></i></button>
        
        <input type="text" class="photo-input-title" placeholder="Título (Ej: Muestra 1)" value="${titleVal}">
        
        <div class="photo-frame" onclick="triggerDynamicPhoto('${id}')">
            <input type="file" id="input_${id}" accept="image/*" hidden onchange="previewDynamicPhoto('${id}')">
            
            <div id="place_${id}" class="photo-placeholder ${placeHidden}" style="text-align:center; color:#999;">
                <i class="fas fa-camera" style="font-size:2rem; margin-bottom:5px;"></i><br>
                Clic para subir
            </div>
            
            <img id="img_${id}" src="${imgSrc}" class="${isHidden}" ${fileIdAttr} ${fileUrlAttr} ${sizeAttr}>
            
            <div id="actions_${id}" class="photo-actions ${isHidden}">
                <button type="button" class="btn-action edit" onclick="openEditorDynamic('${id}', event)"><i class="fas fa-pencil-alt"></i> Editar</button>
            </div>
        </div>
    `;

  container.appendChild(div);
  const sizeSel = document.getElementById(`photoSizeSelect_${targetContainerId}`);
  const selectedSize = sizeSel && PHOTO_SIZE_PRESETS[sizeSel.value] ? sizeSel.value : "small";
  applyGalleryLayout(targetContainerId, selectedSize);
};

window.removePhotoSlot = function (id) {
  if (confirm("¿Eliminar esta foto?")) {
    const card = document.getElementById(`card_${id}`);
    card.remove();
  }
};

window.triggerDynamicPhoto = function (id) {
  const img = document.getElementById(`img_${id}`);
  // Solo abre selector si no hay imagen. Si hay, usa los botones de acción.
  if (img.classList.contains("hidden")) {
    document.getElementById(`input_${id}`).click();
  }
};

window.previewDynamicPhoto = function (id) {
  const f = document.getElementById(`input_${id}`).files[0];
  if (f) {
    const r = new FileReader();
    r.onload = (e) => {
      const img = document.getElementById(`img_${id}`);
      const place = document.getElementById(`place_${id}`);
      const actions = document.getElementById(`actions_${id}`);

      img.src = e.target.result;
      img.classList.remove("hidden");
      place.classList.add("hidden");
      actions.classList.remove("hidden");

      // Marcar como "NUEVA" quitando el data-fileid si tenía
      img.removeAttribute("data-fileid");
      img.removeAttribute("data-fileurl");
      const container = img.closest(".photo-grid-dynamic");
      const sizeSel = container ? document.getElementById(`photoSizeSelect_${container.id}`) : null;
      const selectedSize = sizeSel && PHOTO_SIZE_PRESETS[sizeSel.value] ? sizeSel.value : "small";
      img.dataset.size = selectedSize;
    };
    r.readAsDataURL(f);
  }
};

// ==========================================
// 2. EDITOR DE FOTOS (CORREGIDO TEXTO Y VISIBILIDAD)
// ==========================================

window.openEditorDynamic = function (id, event) {
  if (event) event.stopPropagation();

  const img = document.getElementById(`img_${id}`);
  currentImgElement = img; // Guardamos referencia

  // --- Inicializar/recuperar objetos de la imagen ---
  if (!editorObjectsMap[id]) {
    // Crear array de objetos para esta imagen
    editorObjectsMap[id] = [{ type: 'image', src: img.src, x: 0, y: 0, w: 0, h: 0 }];
  } else {
    // Si la imagen fue editada y su src cambió, actualizar el objeto base
    editorObjectsMap[id][0].src = img.src;
  }
  editorObjects = editorObjectsMap[id];

  // --- MANEJO CORS GOOGLE DRIVE ---
  if (
    img.src.includes("drive.google.com") ||
    img.src.includes("googleusercontent")
  ) {
    const fileId = img.getAttribute("data-fileid");
    if (!fileId) {
      alert("Error: ID de archivo perdido. Recarga la página.");
      return;
    }

    const btn = event.currentTarget;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    postDiagnosisApiJson_({ action: "get_file_base64", file_id: fileId, requester: getRequesterFromSession() })
      .then((res) => {
        btn.innerHTML = originalHtml;
        if (res.success) initCanvas(res.data, id);
        else alert("Error cargando imagen: " + res.message);
      });
  } else {
    initCanvas(img.src, id);
  }
};

function initCanvas(src, imgId) {
  // Para seleccionar herramienta de mover (reactivado)
  window.setToolSelect = function(btn) {
      currentTool = 'select';
      updateUI('.tool-btn', btn);
      // Reactivar eventos normales
      setupCanvasEvents();
    };
  const modal = document.getElementById("photoEditor");
  const overlay = document.getElementById("editorOverlay");
  canvas = document.getElementById("drawingCanvas");
  ctx = canvas.getContext("2d");

  const image = new window.Image();
  image.crossOrigin = "Anonymous";
  image.src = src;

  image.onload = () => {
    editorBaseImage = image;
    // --- Crop/drag/zoom ---
    // Tamaño actual de la foto (S/M/L) y resolución alta para impresión
    let cropMode = "large";
    const card = document.getElementById(`card_${imgId}`);
    const gallery = card ? card.parentElement : null;
    const sizeSel = gallery ? document.getElementById(`photoSizeSelect_${gallery.id}`) : null;
    if (currentImgElement && currentImgElement.dataset && PHOTO_SIZE_PRESETS[currentImgElement.dataset.size]) {
      cropMode = currentImgElement.dataset.size;
    } else if (sizeSel && PHOTO_SIZE_PRESETS[sizeSel.value]) {
      cropMode = sizeSel.value;
    }
    const preset = PHOTO_SIZE_PRESETS[cropMode] || PHOTO_SIZE_PRESETS.large;
    const cropW = cmToPx(preset.widthCm, EXPORT_DPI);
    const cropH = cmToPx(preset.heightCm, EXPORT_DPI);
    const previewW = cmToPx(preset.widthCm, PREVIEW_DPI);
    const previewH = cmToPx(preset.heightCm, PREVIEW_DPI);

    canvas.width = cropW;
    canvas.height = cropH;
    canvas.style.width = `${previewW}px`;
    canvas.style.height = `${previewH}px`;
    canvas.style.touchAction = "none";

    // Estado de crop/drag/zoom
    let imgX = 0, imgY = 0, imgScale = Math.max(cropW / image.width, cropH / image.height);
    let dragging = false, dragStart = {x:0, y:0}, lastPos = {x:0, y:0};
    let moveImageMode = false;

    let hasSavedBasePosition = false;
    // Si ya hay datos de posición de imagen base, restaurar
    if (editorObjects && editorObjects.length > 0 && editorObjects[0].type === 'image') {
      const base = editorObjects[0];
      if (base.w && base.h) {
        imgX = base.x;
        imgY = base.y;
        imgScale = base.w / image.width;
        hasSavedBasePosition = true;
      }
    }

    function drawOverlayObjects() {
      for (let i = 1; i < editorObjects.length; i++) {
        const obj = editorObjects[i];
        if (obj.type === "text") {
          ctx.font = `bold ${obj.size}px Arial`;
          ctx.fillStyle = obj.color;
          ctx.fillText(obj.text, obj.x, obj.y);
        } else if (obj.type === "circle") {
          ctx.beginPath();
          ctx.arc(obj.x, obj.y, obj.r, 0, 2 * Math.PI);
          ctx.lineWidth = obj.width;
          ctx.strokeStyle = obj.color;
          ctx.stroke();
        } else if (obj.type === "arrow") {
          ctx.lineWidth = obj.width;
          ctx.strokeStyle = obj.color;
          drawArrow(ctx, obj.x1, obj.y1, obj.x2, obj.y2);
        } else if (obj.type === "brush" && obj.points && obj.points.length > 1) {
          ctx.beginPath();
          ctx.moveTo(obj.points[0].x, obj.points[0].y);
          for (let j = 1; j < obj.points.length; j++) {
            ctx.lineTo(obj.points[j].x, obj.points[j].y);
          }
          ctx.strokeStyle = obj.color;
          ctx.lineWidth = obj.width;
          ctx.stroke();
        }
      }
    }

    function drawCropImage() {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.save();
      ctx.fillStyle = '#1f1f1f';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(image, imgX, imgY, image.width*imgScale, image.height*imgScale);
      if (editorObjects && editorObjects.length > 1) {
        drawOverlayObjects();
      }
      ctx.restore();
      // Dibuja borde del crop
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(0,0,canvas.width,canvas.height);
      ctx.restore();
    }

    // Interacción crop/drag/zoom solo si moveImageMode
    canvas.onmousedown = function(e) {
      if (moveImageMode) {
        dragging = true;
        dragStart = {x: e.offsetX, y: e.offsetY};
        lastPos = {x: imgX, y: imgY};
      }
    };
    canvas.onmousemove = function(e) {
      if (moveImageMode && dragging) {
        imgX = lastPos.x + (e.offsetX - dragStart.x);
        imgY = lastPos.y + (e.offsetY - dragStart.y);
        drawCropImage();
      }
    };
    canvas.onmouseup = function() { dragging = false; };
    canvas.onmouseleave = function() { dragging = false; };
    canvas.ontouchstart = function(e) {
      if (!moveImageMode || !e.touches || !e.touches[0]) return;
      e.preventDefault();
      dragging = true;
      const p = {
        x: (e.touches[0].clientX - canvas.getBoundingClientRect().left) * (canvas.width / canvas.getBoundingClientRect().width),
        y: (e.touches[0].clientY - canvas.getBoundingClientRect().top) * (canvas.height / canvas.getBoundingClientRect().height)
      };
      dragStart = p;
      lastPos = { x: imgX, y: imgY };
    };
    canvas.ontouchmove = function(e) {
      if (!moveImageMode || !dragging || !e.touches || !e.touches[0]) return;
      e.preventDefault();
      const p = {
        x: (e.touches[0].clientX - canvas.getBoundingClientRect().left) * (canvas.width / canvas.getBoundingClientRect().width),
        y: (e.touches[0].clientY - canvas.getBoundingClientRect().top) * (canvas.height / canvas.getBoundingClientRect().height)
      };
      imgX = lastPos.x + (p.x - dragStart.x);
      imgY = lastPos.y + (p.y - dragStart.y);
      drawCropImage();
    };
    canvas.ontouchend = function(e) { if (e) e.preventDefault(); dragging = false; };
    canvas.onwheel = function(e) {
      if (moveImageMode) {
        e.preventDefault();
        const scaleAmount = e.deltaY < 0 ? 1.05 : 0.95;
        const prevScale = imgScale;
        imgScale *= scaleAmount;
        const mx = e.offsetX, my = e.offsetY;
        imgX = mx - (mx - imgX) * (imgScale/prevScale);
        imgY = my - (my - imgY) * (imgScale/prevScale);
        drawCropImage();
      }
    };

    // Solo centrar automáticamente si es la primera vez
    if (!hasSavedBasePosition) {
      imgScale = Math.max(cropW / image.width, cropH / image.height);
      imgX = (cropW - image.width * imgScale) / 2;
      imgY = (cropH - image.height * imgScale) / 2;
    }
    drawCropImage();


    // Botón para activar/desactivar crop/drag/zoom (modo seguro y robusto)
    window.setTool = function(tool, btn) {
      currentTool = tool;
      updateUI(".tool-btn", btn);
      if (tool === 'moveimage') {
        moveImageMode = true;
        // Desactivar eventos de edición de objetos
        canvas.onmousedown = function(e) {
          dragging = true;
          dragStart = {x: e.offsetX, y: e.offsetY};
          lastPos = {x: imgX, y: imgY};
        };
        canvas.onmousemove = function(e) {
          if (dragging) {
            imgX = lastPos.x + (e.offsetX - dragStart.x);
            imgY = lastPos.y + (e.offsetY - dragStart.y);
            drawCropImage();
          }
        };
        canvas.onmouseup = function() { dragging = false; };
        canvas.onmouseleave = function() { dragging = false; };
        canvas.ontouchstart = function(e) {
          if (!e.touches || !e.touches[0]) return;
          e.preventDefault();
          dragging = true;
          const p = {
            x: (e.touches[0].clientX - canvas.getBoundingClientRect().left) * (canvas.width / canvas.getBoundingClientRect().width),
            y: (e.touches[0].clientY - canvas.getBoundingClientRect().top) * (canvas.height / canvas.getBoundingClientRect().height)
          };
          dragStart = p;
          lastPos = { x: imgX, y: imgY };
        };
        canvas.ontouchmove = function(e) {
          if (!dragging || !e.touches || !e.touches[0]) return;
          e.preventDefault();
          const p = {
            x: (e.touches[0].clientX - canvas.getBoundingClientRect().left) * (canvas.width / canvas.getBoundingClientRect().width),
            y: (e.touches[0].clientY - canvas.getBoundingClientRect().top) * (canvas.height / canvas.getBoundingClientRect().height)
          };
          imgX = lastPos.x + (p.x - dragStart.x);
          imgY = lastPos.y + (p.y - dragStart.y);
          drawCropImage();
        };
        canvas.ontouchend = function(e) { if (e) e.preventDefault(); dragging = false; };
        canvas.onwheel = function(e) {
          e.preventDefault();
          const scaleAmount = e.deltaY < 0 ? 1.05 : 0.95;
          const prevScale = imgScale;
          imgScale *= scaleAmount;
          const mx = e.offsetX, my = e.offsetY;
          imgX = mx - (mx - imgX) * (imgScale/prevScale);
          imgY = my - (my - imgY) * (imgScale/prevScale);
          drawCropImage();
        };
        drawCropImage();
      } else {
        moveImageMode = false;
        // Persistir el ajuste de la imagen antes de pasar a dibujar objetos
        if (editorObjects && editorObjects.length > 0 && editorObjects[0].type === "image") {
          editorObjects[0].x = imgX;
          editorObjects[0].y = imgY;
          editorObjects[0].w = image.width * imgScale;
          editorObjects[0].h = image.height * imgScale;
        }
        if (currentImgElement) currentImgElement.dataset.size = cropMode;
        // Restaurar eventos de edición de objetos
        setupCanvasEvents();
        drawEditorObjects();
      }
    };

    window.__saveEditedPhotoInternal = function () {
      if (currentImgElement) {
        // Guardar crop/drag/zoom en el objeto base
        if (editorObjects && editorObjects.length > 0 && editorObjects[0].type === 'image') {
          editorObjects[0].x = imgX;
          editorObjects[0].y = imgY;
          editorObjects[0].w = image.width * imgScale;
          editorObjects[0].h = image.height * imgScale;
        }
        // Renderizar la imagen base y todos los objetos sobre ella
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(image, imgX, imgY, image.width*imgScale, image.height*imgScale);
        // Redibujar objetos (excepto la imagen base)
        for (let i = 1; i < editorObjects.length; i++) {
          const obj = editorObjects[i];
          if (obj.type === 'text') {
            ctx.font = `bold ${obj.size}px Arial`;
            ctx.fillStyle = obj.color;
            ctx.fillText(obj.text, obj.x, obj.y);
          } else if (obj.type === 'circle') {
            ctx.beginPath();
            ctx.arc(obj.x, obj.y, obj.r, 0, 2 * Math.PI);
            ctx.lineWidth = obj.width;
            ctx.strokeStyle = obj.color;
            ctx.stroke();
          } else if (obj.type === 'arrow') {
            ctx.lineWidth = obj.width;
            ctx.strokeStyle = obj.color;
            drawArrow(ctx, obj.x1, obj.y1, obj.x2, obj.y2);
          } else if (obj.type === 'brush') {
            ctx.beginPath();
            ctx.moveTo(obj.points[0].x, obj.points[0].y);
            for (let j = 1; j < obj.points.length; j++) {
              ctx.lineTo(obj.points[j].x, obj.points[j].y);
            }
            ctx.strokeStyle = obj.color;
            ctx.lineWidth = obj.width;
            ctx.stroke();
          }
        }
        // Guardar la imagen final editada
        currentImgElement.src = canvas.toDataURL("image/jpeg", 0.98);
        currentImgElement.dataset.size = cropMode;
        currentImgElement.removeAttribute("data-fileid");
        currentImgElement.removeAttribute("data-fileurl");
        closeEditor();
      }
    };

    modal.classList.add("active");
    overlay.classList.add("active");
    document.body.style.overflow = "hidden";
    const preventScroll = function(e) { e.preventDefault(); };
    modal.__preventScroll = preventScroll;
    overlay.__preventScroll = preventScroll;
    modal.addEventListener("touchmove", preventScroll, { passive: false });
    overlay.addEventListener("touchmove", preventScroll, { passive: false });
    // No activar setupCanvasEvents hasta que se acepte el crop
  };
  image.onerror = () => {
    alert("No se pudo cargar la imagen. Intenta recargar la página o volver a subir la foto.");
    closeEditor();
  };
}

// EVENTOS DE DIBUJO (CON SOLUCIÓN TEXTO)
function setupCanvasEvents() {
  let lastPointerPos = null;
    // Permitir doble clic para editar texto existente
    canvas.ondblclick = function(e) {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);
      for (let i = editorObjects.length - 1; i > 0; i--) {
        const obj = editorObjects[i];
        if (obj.type === 'text') {
          ctx.font = `bold ${obj.size}px Arial`;
          const w = ctx.measureText(obj.text).width;
          const h = obj.size;
          if (x >= obj.x && x <= obj.x + w && y >= obj.y - h && y <= obj.y) {
            openTextEditModal(obj.text, i);
            break;
          }
        }
      }
    };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Inicializar selects si existen
  const textSizeSel = document.getElementById("textSizeSelect");
  if (textSizeSel) {
    textSizeSel.value = currentTextSize;
    textSizeSel.onchange = function() {
      currentTextSize = parseInt(this.value);
    };
  }
  const lineWidthSel = document.getElementById("lineWidthSelect");
  if (lineWidthSel) {
    lineWidthSel.value = currentLineWidth;
    lineWidthSel.onchange = function() {
      currentLineWidth = parseInt(this.value);
    };
  }

  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e) => {
    const pos = getPos(e);
    lastPointerPos = pos;
    // Selección de objeto si no es herramienta de dibujo
    if (currentTool === "select") {
      selectedObjectIndex = getObjectAtPos(pos.x, pos.y);
      if (selectedObjectIndex !== null && selectedObjectIndex > 0) {
        const obj = editorObjects[selectedObjectIndex];
        dragOffset.x = pos.x - obj.x;
        dragOffset.y = pos.y - obj.y;
      }
      isDrawing = false;
      return;
    }
    // SI LA HERRAMIENTA ES TEXTO, CLICK PARA ESCRIBIR
    if (currentTool === "text") {
      window.openTextEditModal("", null, pos.x, pos.y);
      return;
    }
    // Círculo
    if (currentTool === "circle") {
      isDrawing = true;
      startX = pos.x;
      startY = pos.y;
      snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return;
    }
    // Flecha
    if (currentTool === "arrow") {
      isDrawing = true;
      startX = pos.x;
      startY = pos.y;
      snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return;
    }
    // Pincel
    if (currentTool === "brush") {
      isDrawing = true;
      startX = pos.x;
      startY = pos.y;
      editorObjects.push({type:'brush', points:[{x:pos.x, y:pos.y}], color:currentColor, width:currentLineWidth});
      return;
    }
  };

  // Modal de texto global y robusto
  window.openTextEditModal = function(text, objIndex, x, y) {
    const modal = document.getElementById("textEditModal");
    const input = document.getElementById("textEditInput");
    input.value = text || "";
    modal.classList.remove("hidden");
    input.focus();
    editingTextIndex = objIndex;
    // Guardar posición para nuevo texto
    if (x && y) {
      modal.dataset.x = x;
      modal.dataset.y = y;
    } else {
      modal.dataset.x = "";
      modal.dataset.y = "";
    }
  };
  window.closeTextEditModal = function() {
    const modal = document.getElementById("textEditModal");
    const input = document.getElementById("textEditInput");
    const text = input.value.trim();
    if (editingTextIndex !== null && editingTextIndex !== undefined) {
      // Editar texto existente
      if (text) {
        editorObjects[editingTextIndex].text = text;
        drawEditorObjects();
      }
    } else if (text) {
      // Nuevo texto
      let x = parseFloat(modal.dataset.x) || canvas.width/2;
      let y = parseFloat(modal.dataset.y) || canvas.height/2;
      editorObjects.push({type:'text', text, x, y, color:currentColor, size:currentTextSize});
      drawEditorObjects();
    }
    editingTextIndex = null;
    modal.classList.add("hidden");
  };

  const draw = (e) => {
    const pos = getPos(e);
    lastPointerPos = pos;
    if (currentTool === "select" && selectedObjectIndex !== null && selectedObjectIndex > 0) {
      // Mover objeto
      const obj = editorObjects[selectedObjectIndex];
      obj.x = pos.x - dragOffset.x;
      obj.y = pos.y - dragOffset.y;
      drawEditorObjects();
      return;
    }
    if (!isDrawing || currentTool === "text") return;
    if (currentTool === "brush") {
      const obj = editorObjects[editorObjects.length-1];
      obj.points.push({x:pos.x, y:pos.y});
      drawEditorObjects();
    } else if (currentTool === "circle") {
      drawEditorObjects();
      const r = Math.sqrt(Math.pow(pos.x - startX, 2) + Math.pow(pos.y - startY, 2));
      ctx.beginPath();
      ctx.lineWidth = currentLineWidth;
      ctx.strokeStyle = currentColor;
      ctx.arc(startX, startY, r, 0, 2 * Math.PI);
      ctx.stroke();
    } else if (currentTool === "arrow") {
      drawEditorObjects();
      ctx.lineWidth = currentLineWidth;
      ctx.strokeStyle = currentColor;
      drawArrow(ctx, startX, startY, pos.x, pos.y);
    }
    if (e.type === "touchmove") e.preventDefault();
  };

  const stopDraw = (e) => {
    if (isDrawing) {
      isDrawing = false;
      let pos = lastPointerPos || { x: startX, y: startY };
      if (e && e.changedTouches && e.changedTouches[0]) {
        const rect = canvas.getBoundingClientRect();
        pos = {
          x: (e.changedTouches[0].clientX - rect.left) * (canvas.width / rect.width),
          y: (e.changedTouches[0].clientY - rect.top) * (canvas.height / rect.height)
        };
      }
      if (currentTool === "brush") {
        // Ya está en editorObjects
      } else if (currentTool === "circle") {
        // Guardar círculo como objeto editable
        const r = Math.sqrt(Math.pow(startX - pos.x, 2) + Math.pow(startY - pos.y, 2));
        editorObjects.push({type:'circle', x:startX, y:startY, r, color:currentColor, width:currentLineWidth});
        drawEditorObjects();
      } else if (currentTool === "arrow") {
        // Guardar flecha como objeto editable
        editorObjects.push({type:'arrow', x1:startX, y1:startY, x2:pos.x, y2:pos.y, color:currentColor, width:currentLineWidth});
        drawEditorObjects();
      }
      history.push(canvas.toDataURL("image/jpeg", 0.98));
    }
    selectedObjectIndex = null;
  };

  canvas.onmousedown = startDraw;
    // Selección de objetos
    canvas.onmousedown = startDraw;
  canvas.onmousemove = draw;
    canvas.onmousemove = draw;
  canvas.onmouseup = stopDraw;
    canvas.onmouseup = stopDraw;
  canvas.ontouchstart = startDraw;
    canvas.ontouchstart = startDraw;
  canvas.ontouchmove = draw;
    canvas.ontouchmove = draw;
  canvas.ontouchend = stopDraw;
  canvas.ontouchend = stopDraw;

  // Para seleccionar herramienta de mover
  window.setToolSelect = function(btn) {
    currentTool = 'select';
    updateUI('.tool-btn', btn);
  };
}

function getObjectAtPos(x, y) {
  // Buscar de arriba hacia abajo (último dibujado primero)
  for (let i = editorObjects.length - 1; i > 0; i--) {
    const obj = editorObjects[i];
    if (obj.type === 'text') {
      // Aproximar caja de texto
      ctx.font = `bold ${obj.size}px Arial`;
      const w = ctx.measureText(obj.text).width;
      const h = obj.size;
      if (x >= obj.x && x <= obj.x + w && y >= obj.y - h && y <= obj.y) return i;
    } else if (obj.type === 'circle') {
      const r = obj.r || 30;
      if (Math.sqrt(Math.pow(x - obj.x, 2) + Math.pow(y - obj.y, 2)) <= r) return i;
    } else if (obj.type === 'arrow') {
      // Aproximar como línea gruesa
      const dist = Math.abs((obj.y2 - obj.y1) * x - (obj.x2 - obj.x1) * y + obj.x2 * obj.y1 - obj.y2 * obj.x1) /
        Math.sqrt(Math.pow(obj.y2 - obj.y1, 2) + Math.pow(obj.x2 - obj.x1, 2));
      if (dist < 15) return i;
    } else if (obj.type === 'brush') {
      // Aproximar como puntos
      for (const pt of obj.points) {
        if (Math.abs(x - pt.x) < 8 && Math.abs(y - pt.y) < 8) return i;
      }
    }
  }
  return null;
}

function drawEditorObjects() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < editorObjects.length; i++) {
    const obj = editorObjects[i];
    if (obj.type === 'image') {
      const drawW = obj.w || canvas.width;
      const drawH = obj.h || canvas.height;
      if (editorBaseImage && editorBaseImage.complete && editorBaseImage.naturalWidth > 0) {
        ctx.drawImage(editorBaseImage, obj.x, obj.y, drawW, drawH);
      } else if (currentImgElement && currentImgElement.complete) {
        ctx.drawImage(currentImgElement, obj.x, obj.y, drawW, drawH);
      } else {
        const img = new window.Image();
        img.src = obj.src;
        if (img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, obj.x, obj.y, drawW, drawH);
          editorBaseImage = img;
        } else if (!img.__hooked) {
          img.__hooked = true;
          img.onload = () => {
            editorBaseImage = img;
            drawEditorObjects();
          };
        }
      }
    } else if (obj.type === 'text') {
      ctx.font = `bold ${obj.size}px Arial`;
      ctx.fillStyle = obj.color;
      ctx.fillText(obj.text, obj.x, obj.y);
      if (i === selectedObjectIndex) {
        // Dibujar caja de selección
        const w = ctx.measureText(obj.text).width;
        const h = obj.size;
        ctx.strokeStyle = '#00f';
        ctx.strokeRect(obj.x, obj.y - h, w, h);
      }
    } else if (obj.type === 'circle') {
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, obj.r, 0, 2 * Math.PI);
      ctx.lineWidth = obj.width;
      ctx.strokeStyle = obj.color;
      ctx.stroke();
      if (i === selectedObjectIndex) {
        ctx.strokeStyle = '#00f';
        ctx.beginPath();
        ctx.arc(obj.x, obj.y, obj.r + 4, 0, 2 * Math.PI);
        ctx.stroke();
      }
    } else if (obj.type === 'arrow') {
      ctx.lineWidth = obj.width;
      ctx.strokeStyle = obj.color;
      drawArrow(ctx, obj.x1, obj.y1, obj.x2, obj.y2);
      if (i === selectedObjectIndex) {
        ctx.strokeStyle = '#00f';
        ctx.beginPath();
        ctx.arc(obj.x1, obj.y1, 8, 0, 2 * Math.PI);
        ctx.arc(obj.x2, obj.y2, 8, 0, 2 * Math.PI);
        ctx.stroke();
      }
    } else if (obj.type === 'brush') {
      ctx.beginPath();
      ctx.moveTo(obj.points[0].x, obj.points[0].y);
      for (let j = 1; j < obj.points.length; j++) {
        ctx.lineTo(obj.points[j].x, obj.points[j].y);
      }
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = obj.width;
      ctx.stroke();
      if (i === selectedObjectIndex) {
        const pt = obj.points[0];
        ctx.strokeStyle = '#00f';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 8, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
  }
}


function drawArrow(ctx, x1, y1, x2, y2) {
  const head = 15;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(
    x2 - head * Math.cos(angle - Math.PI / 6),
    y2 - head * Math.sin(angle - Math.PI / 6)
  );
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - head * Math.cos(angle + Math.PI / 6),
    y2 - head * Math.sin(angle + Math.PI / 6)
  );
  ctx.stroke();
}

// Herramientas UI
window.setTool = function (tool, btn) {
  currentTool = tool;
  updateUI(".tool-btn", btn);
};
window.setToolColor = function (color, btn) {
  currentColor = color;
  updateUI(".color-btn", btn);
};
// Cambiamos addTextToCanvas para que solo seleccione la herramienta
window.addTextToCanvas = function (btn) {
  currentTool = "text";
  updateUI(".tool-btn", btn);
  // UX mejorada: sin alert, solo selecciona herramienta
};

function updateUI(selector, btn) {
  document
    .querySelectorAll(selector)
    .forEach((b) => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
}

window.undoLastStroke = function () {
  if (history.length > 1) {
    history.pop();
    const img = new Image();
    img.src = history[history.length - 1];
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
  }
};
window.clearCanvas = function () {
  // Borra todos los objetos y deja solo la imagen base
  if (editorObjects.length > 0) {
    editorObjects = editorObjects.filter(obj => obj.type === 'image');
    drawEditorObjects();
    history.push(canvas.toDataURL());
  }
};

window.saveEditedPhoto = function () {
  if (typeof window.__saveEditedPhotoInternal === "function") {
    window.__saveEditedPhotoInternal();
    return;
  }
  if (currentImgElement) {
    currentImgElement.src = canvas.toDataURL("image/jpeg", 0.98);
    currentImgElement.removeAttribute("data-fileid");
    currentImgElement.removeAttribute("data-fileurl");
    closeEditor();
  }
};
window.closeEditor = function () {
  const modal = document.getElementById("photoEditor");
  const overlay = document.getElementById("editorOverlay");
  if (modal && modal.__preventScroll) modal.removeEventListener("touchmove", modal.__preventScroll);
  if (overlay && overlay.__preventScroll) overlay.removeEventListener("touchmove", overlay.__preventScroll);
  document.getElementById("photoEditor").classList.remove("active");
  document.getElementById("editorOverlay").classList.remove("active");
  document.body.style.overflow = "";
};

// ==========================================
// 3. GUARDADO (RECOLECCIÓN DINÁMICA)
// ==========================================

// Función auxiliar de seguridad (Evita el crash si falta un input)
function getValSafe(id) {
  const el = document.getElementById(id);
  return el ? el.value : ""; // Si no existe, devuelve vacío en lugar de error
}

// --- PEGAR ESTO AL FINAL DE diagnostico.js O ANTES DE saveDiagnosis ---

// Función auxiliar para comprimir imágenes
function compressImage(base64Str, maxWidth = 1000, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // Exportar a mayor resolución para PDF
      const TARGET_WIDTH = 2000;
      if (width > TARGET_WIDTH) {
        height *= TARGET_WIDTH / width;
        width = TARGET_WIDTH;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      // Devolver base64 comprimido (alta calidad)
      resolve(canvas.toDataURL('image/jpeg', 0.98));
    };
    img.onerror = () => resolve(base64Str); // Si falla, devuelve original
  });
}

// --- MODIFICAR LA PARTE DE saveDiagnosis ASÍ ---

// Reemplaza tu función saveDiagnosis actual por esta versión unificada:

async function saveDiagnosis(generarPdf, btn) {
  // Usamos saveCommon para respetar tu estructura, validaciones y manejo de errores
  saveCommon("COLPOSCOPIA", generarPdf, btn, async () => {
    
    // 1. RECOLECTAR IMÁGENES (Mantenemos tu lógica de fotos y compresión)
    const cards = document.querySelectorAll(".photo-card img"); 
    const imgs = [];

    if(btn) btn.innerText = "Procesando imágenes...";

    for (let i = 0; i < cards.length; i++) {
        const imgEl = cards[i];
        const card = imgEl.closest('.photo-card');
        const titleInput = card.querySelector(".photo-input-title");
        const title = titleInput ? titleInput.value : `Imagen ${i + 1}`;
        const existingId = imgEl.getAttribute("data-fileid");
        const existingUrl = imgEl.getAttribute("data-fileurl");
        const size = (imgEl.dataset && PHOTO_SIZE_PRESETS[imgEl.dataset.size]) ? imgEl.dataset.size : "small";
        
        if (imgEl.src.startsWith("data:")) {
            // Normalizamos a tamaño final de impresión
            const processedBase64 = await resizeBase64Image(imgEl.src, 1, size);
            imgs.push({ index: i + 1, title: title, data: processedBase64, isNew: true, size });
        } else if (existingId || existingUrl) {
            // Mantenemos si ya existía
            imgs.push({ index: i + 1, title: title, fileId: existingId, url: existingUrl, isNew: false, size });
        }
    }

    // 2. RECOLECTAR RECETA (CORREGIDO: Ahora busca la Universal)
    let recetaData = { medicamentos: [], observaciones_receta: "" };
    
    // Intentamos leer la tabla de receta universal que es la que se ve en pantalla
    const filasReceta = document.querySelectorAll("#tablaRecetaUniversal tbody tr");
    if (filasReceta.length > 0) {
        filasReceta.forEach(tr => {
            const nombre = tr.querySelector(".med-name-uni").value;
            const cant = tr.querySelector(".med-qty-uni").value;
            const frec = tr.querySelector(".med-freq-uni").value;
            if (nombre) {
                recetaData.medicamentos.push({ nombre: nombre, cantidad: cant, frecuencia: frec });
            }
        });
        const obsReceta = document.getElementById("receta_obs_universal");
        if(obsReceta) recetaData.observaciones_receta = obsReceta.value;
    } 
    // Si no encontró nada ahí, intenta con la función auxiliar por si acaso
    else if (typeof getUniversalRecipeData === 'function') {
        const aux = getUniversalRecipeData();
        if(aux) recetaData = aux;
    }

    // 3. RECOLECTAR PDFS EXTERNOS
    if(btn) btn.innerText = "Leyendo archivos PDF...";
    const pdfFiles = await getExternalPdfPayloadForSave_();

    // Restaurar estado visual del botón antes de retornar
    if(btn) btn.innerHTML = `<i class="fas fa-circle-notch fa-spin-fast"></i> Guardando...`;

    // 4. RETORNAR EL PAQUETE COMPLETO (Esto se envía a saveCommon -> Servidor)
    return {
      // Datos clínicos (Colposcopía)
      evaluacion: getValSafe("colpo_evaluacion"),
      vagina: getValSafe("colpo_vagina"),
      vulva: getValSafe("colpo_vulva"),
      ano: getValSafe("colpo_ano"),
      hallazgos: getValSafe("colpo_hallazgos"),
      diagnostico: getValSafe("colpo_diagnostico"),
      biopsia: getValSafe("colpo_biopsia"),
      recomendaciones: getValSafe("colpo_recomendaciones"),
      
      // Datos adjuntos (Ahora sí viajan correctamente)
      imagenes: imgs,
      medicamentos: recetaData.medicamentos,
      observaciones_receta: recetaData.observaciones_receta,
      certificado_medico: getMedicalCertificateDataForSave_(),
      pdf_externos: pdfFiles
    };
  });
}
function saveRecipe(generarPdf, btn) {
  function readLegacyRecipeData_() {
    const meds = [];
    document.querySelectorAll("#medicationTable tbody tr").forEach((tr) => {
      const nameEl = tr.querySelector(".med-name");
      const qtyEl = tr.querySelector(".med-qty");
      const freqEl = tr.querySelector(".med-freq");
      const nombre = String((nameEl && nameEl.value) || "").trim();
      if (!nombre) return;
      meds.push({
        nombre,
        cantidad: String((qtyEl && qtyEl.value) || "").trim(),
        frecuencia: String((freqEl && freqEl.value) || "").trim(),
      });
    });
    const obsEl = document.getElementById("receta_observaciones");
    const observaciones = String((obsEl && obsEl.value) || "").trim();
    return {
      medicamentos: meds,
      observaciones_receta: observaciones,
      hasData: meds.length > 0 || !!observaciones,
    };
  }

  saveCommon("RECETA", generarPdf, btn, async () => {
    const legacy = readLegacyRecipeData_();
    const certData = getMedicalCertificateDataForSave_();
    const pdfFiles = await getExternalPdfPayloadForSave_();
    const out = {};
    if (legacy.hasData) {
      out.medicamentos = legacy.medicamentos;
      out.observaciones_receta = legacy.observaciones_receta;
      out.certificado_medico = certData;
      out.pdf_externos = pdfFiles;
      return out;
    }

    const universal = typeof getUniversalRecipeData === "function"
      ? getUniversalRecipeData()
      : null;

    out.medicamentos = universal && Array.isArray(universal.medicamentos) ? universal.medicamentos : [];
    out.observaciones_receta = universal ? String(universal.observaciones_receta || "").trim() : "";
    out.certificado_medico = certData;
    out.pdf_externos = pdfFiles;
    return out;
  });
}

function saveGeneral(generarPdf, btn) {
  saveCommon("CONSULTA GENERAL", generarPdf, btn, async () => {
    const receta = getUniversalRecipeData();
    const pdfFiles = await getExternalPdfPayloadForSave_();
    const out = {
      motivo: document.getElementById("gen_motivo").value,
      evaluacion: document.getElementById("gen_evaluacion").value,
      diagnostico: document.getElementById("gen_diagnostico").value,
      recomendaciones: document.getElementById("gen_recomendaciones").value,
    };
    if (receta) {
      out.medicamentos = receta.medicamentos;
      out.observaciones_receta = receta.observaciones_receta;
    }
    out.certificado_medico = getMedicalCertificateDataForSave_();
    out.pdf_externos = pdfFiles;
    return out;
  });
}

async function saveCommon(tipo, generarPdf, btnClicked, getDataFn) {
  if (!currentPatientId) return alert("Error ID Paciente");
  if (isDiagnosisSaveInProgress) return alert("Ya hay un guardado en proceso. Espera un momento.");
  if (generarPdf) {
    const ok = window.appConfirm
      ? await window.appConfirm({
          title: "Generar informe",
          message: "Se guardaran los datos y se generara el PDF.\nDeseas continuar?",
          confirmText: "Si, generar",
          cancelText: "Cancelar",
        })
      : confirm("Guardar y generar PDF?");
    if (!ok) return;
  }
  
  // --- CORRECCIÓN: Declarar la variable aquí ---
  let pdfWindow = null;

  // 1. ABRIR VENTANA DE CARGA (Anti-Bloqueo)
  if (generarPdf) {
      pdfWindow = window.open("", "_blank");
      if (pdfWindow) {
          pdfWindow.document.write("<html><body style='text-align:center; padding:50px; font-family:sans-serif;'><h2>⏳ Generando Documento...</h2><p>Procesando solicitud...</p></body></html>");
      } else {
          alert("⚠️ Habilite las ventanas emergentes para ver el PDF.");
          return; // Cancelar si está bloqueado
      }
  }

  const originalContent = btnClicked.innerHTML;
  const allBtns = document.querySelectorAll(".btn-submit");
  allBtns.forEach((b) => (b.disabled = true));
  isDiagnosisSaveInProgress = true;

  if (generarPdf) {
    btnClicked.innerHTML = `<i class="fas fa-circle-notch fa-spin-fast"></i> Abriendo PDF...`;
    btnClicked.style.background = "#e67e22";
  } else {
    btnClicked.innerHTML = `<i class="fas fa-circle-notch fa-spin-fast"></i> Guardando...`;
  }

  try {
    const specificData = await getDataFn();
    const requesterDoc = getRequesterFromSession();
    if (!requesterDoc) {
      throw new Error("Sesión inválida. Vuelve a iniciar sesión.");
    }

    const patientName = (document.getElementById("patientNameDisplay").value || "").trim();
    if (!patientName) {
      throw new Error("Falta el nombre del paciente. Recarga la pagina e intenta de nuevo.");
    }

    // Validaciones suaves por tipo para evitar envios vacios por error.
    if (tipo === "RECETA") {
      const meds = Array.isArray(specificData.medicamentos) ? specificData.medicamentos : [];
      const validMeds = meds.filter((m) => String(m && m.nombre || "").trim());
      const hasCertificateContent = hasMeaningfulMedicalCertificateContent_(specificData);
      const hasExternalPdf = Array.isArray(specificData.pdf_externos) && specificData.pdf_externos.length > 0;
      if (validMeds.length === 0 && !hasCertificateContent && !hasExternalPdf) {
        throw new Error("Agrega al menos un medicamento, un certificado medico o un PDF adjunto antes de guardar en RECETA.");
      }
    }
    if (tipo === "EXAMENPDF") {
      const externalPdfItems = Array.isArray(specificData.pdf_externos) ? specificData.pdf_externos : [];
      if (!externalPdfItems.length) {
        throw new Error("Adjunta un archivo PDF antes de guardar en EXAMENPDF.");
      }
    }
    if (tipo === "CERTIFICADO MEDICO") {
      const hasCertificateContent = hasMeaningfulMedicalCertificateContent_(specificData);
      if (!hasCertificateContent) {
        throw new Error("Completa el certificado medico antes de guardar en este modo.");
      }
    }
    if (tipo === "TODO") {
      const hasRecipeContent = hasMeaningfulRecipeContent_(specificData);
      const hasCertificateContent = hasMeaningfulMedicalCertificateContent_(specificData);
      const hasExternalPdf = Array.isArray(specificData.pdf_externos) && specificData.pdf_externos.length > 0;
      if (!hasRecipeContent && !hasExternalPdf && !hasCertificateContent) {
        throw new Error("Agrega una receta, certificado medico o un PDF adjunto antes de guardar en TODO.");
      }
    }
    if (tipo === "CONSULTA GENERAL") {
      const hasContent =
        String(specificData.motivo || "").trim() ||
        String(specificData.evaluacion || "").trim() ||
        String(specificData.diagnostico || "").trim() ||
        String(specificData.recomendaciones || "").trim();
      if (!hasContent) {
        throw new Error("Ingresa al menos un dato clinico para guardar la consulta.");
      }
    }

    const data = {
      id_reporte: currentReportId,
      id_paciente: currentPatientId,
      nombre_paciente: patientName,
      tipo_examen: tipo,
      fecha_reporte: getClinicalReportDateInputValue_(),
      generar_pdf: generarPdf,
      incluir_firma_virtual: shouldIncludeVirtualSignature_(),
      ...specificData,
    };

    let generatedPdfPayload = null;

    if (generarPdf) {
      btnClicked.innerHTML = `<i class="fas fa-circle-notch fa-spin-fast"></i> Armando PDF...`;
      generatedPdfPayload = await buildDiagnosisPdfPayloadsForSave_(data);
      Object.assign(data, generatedPdfPayload);
      btnClicked.innerHTML = `<i class="fas fa-circle-notch fa-spin-fast"></i> Subiendo...`;
    } else if (hasMeaningfulMedicalCertificateContent_(data)) {
      generatedPdfPayload = await buildDiagnosisCertificatePdfPayloadForSave_(data);
      Object.assign(data, generatedPdfPayload);
    }

    const res = await postDiagnosisApiJson_({
      action: "save_diagnosis_advanced",
      data: data,
      requester: requesterDoc
    });

    if (res.success) {
      currentReportId = String(res.id_reporte || currentReportId || "").trim() || currentReportId;
      const requiresCertificateReadback = hasMeaningfulMedicalCertificateContent_(specificData);
      const verifiedReport = requiresCertificateReadback
        ? await fetchDiagnosisReportReadback_(currentReportId)
        : null;
      const verifiedState = verifiedReport ? getDiagnosisPersistedStateFromReport_(verifiedReport) : null;
      if (requiresCertificateReadback && !verifiedState) {
        throw new Error("El backend respondió éxito, pero no se pudo releer el certificado guardado.");
      }
      if (requiresCertificateReadback) {
        const verifiedCert = verifiedState && verifiedState.data && verifiedState.data.certificado_medico;
        const verifiedCertPdf = String(verifiedState && verifiedState.docs && verifiedState.docs.pdf_certificado_link || "").trim();
        if (!verifiedCert || !verifiedCertPdf) {
          throw new Error("El certificado se generó localmente, pero Cloudflare/Supabase no lo persistió completo. Falta el PDF o los datos guardados en el backend.");
        }
      }
      const savedExternalPdfItems = verifiedState
        ? getStoredExternalPdfItemsFromPayload_(verifiedState.docs)
        : getStoredExternalPdfItemsFromPayload_({
            pdf_externos: res.pdf_externos || specificData.pdf_externos || [],
            pdf_externo_link: res.pdf_externo_url || ""
          });
      setCurrentExternalPdfItems_(savedExternalPdfItems);
      setGeneratedDocsState_({
        report_type: tipo,
        pdf_url: verifiedState ? verifiedState.docs.pdf_url : res.pdf_url,
        pdf_receta_link: verifiedState ? verifiedState.docs.pdf_receta_link : (res.pdf_receta_url || res.pdf_receta_link),
        pdf_certificado_link: verifiedState ? verifiedState.docs.pdf_certificado_link : (res.pdf_certificado_url || res.pdf_certificado_link),
        pdf_externo_link: verifiedState ? verifiedState.docs.pdf_externo_link : (res.pdf_externo_url || res.pdf_externo_link),
        pdf_externos: verifiedState ? verifiedState.docs.pdf_externos : (res.pdf_externos || [])
      });
      hasUnsavedChanges = false;
      
      btnClicked.innerHTML = `<i class="fas fa-check"></i> ¡Listo!`;
      btnClicked.style.background = "#27ae60";
      
      if (generarPdf && pdfWindow) {
          const primaryPdf = String(res.pdf_url || "").trim();
          const recipePdf = String(res.pdf_receta_url || "").trim();
          const certificatePdf = String(res.pdf_certificado_url || "").trim();
          const externalPdf = savedExternalPdfItems.length
            ? String(savedExternalPdfItems[0].url || "").trim()
            : String(res.pdf_externo_url || "").trim();
          const hasRecipeContent = hasMeaningfulRecipeContent_(specificData);
          const hasCertificateContent = hasMeaningfulMedicalCertificateContent_(specificData);
          const hasExternalPdf = savedExternalPdfItems.length > 0;
          let targetPdfUrl = "";

          if (tipo === "EXAMENPDF") {
            targetPdfUrl = externalPdf || certificatePdf || recipePdf || primaryPdf;
          } else if (tipo === "CERTIFICADO MEDICO") {
            targetPdfUrl = certificatePdf || recipePdf || externalPdf || primaryPdf;
          } else if (tipo === "RECETA") {
            targetPdfUrl = recipePdf || certificatePdf || externalPdf || primaryPdf;
          } else if (tipo === "TODO") {
            if (hasRecipeContent && recipePdf) targetPdfUrl = recipePdf;
            else if (hasCertificateContent && certificatePdf) targetPdfUrl = certificatePdf;
            else if (hasExternalPdf && externalPdf) targetPdfUrl = externalPdf;
            else targetPdfUrl = certificatePdf || recipePdf || externalPdf || primaryPdf;
          } else {
            targetPdfUrl = primaryPdf || certificatePdf || recipePdf || externalPdf;
          }

            if (targetPdfUrl) {
              await openDiagnosisPdfInWindow_(pdfWindow, targetPdfUrl);
          } else {
              const localReportPdf = String(generatedPdfPayload && generatedPdfPayload.report_pdf_data_url || "").trim();
              const localRecipePdf = String(generatedPdfPayload && generatedPdfPayload.recipe_pdf_data_url || "").trim();
              const localCertificatePdf = String(generatedPdfPayload && generatedPdfPayload.certificate_pdf_data_url || "").trim();
              let localTargetPdf = "";
              if (tipo === "EXAMENPDF") {
                localTargetPdf = localCertificatePdf || localRecipePdf || localReportPdf;
              } else if (tipo === "CERTIFICADO MEDICO") {
                localTargetPdf = localCertificatePdf || localRecipePdf || localReportPdf;
              } else if (tipo === "RECETA") {
                localTargetPdf = localRecipePdf || localCertificatePdf || localReportPdf;
              } else if (tipo === "TODO") {
                if (hasRecipeContent && localRecipePdf) localTargetPdf = localRecipePdf;
                else if (hasCertificateContent && localCertificatePdf) localTargetPdf = localCertificatePdf;
                else localTargetPdf = localCertificatePdf || localRecipePdf || localReportPdf;
              } else {
                localTargetPdf = localReportPdf || localCertificatePdf || localRecipePdf;
              }

              if (localTargetPdf) {
                await openDiagnosisPdfInWindow_(pdfWindow, localTargetPdf);
                if (window.showToast) {
                  window.showToast("Guardado correcto. Se abrio el PDF local porque el servidor no devolvio enlace.", "warning");
                }
              } else {
                pdfWindow.close();
                alert("Guardado, pero no se pudo obtener ninguna URL de PDF (ni remota ni local).");
              }
          }
          setTimeout(() => window.navigateWithEnv(`clinical.html?id=${currentPatientId}&tab=diagnostico`), 1500);
      } else {
          setTimeout(() => {
             btnClicked.disabled = false;
             btnClicked.innerHTML = originalContent;
             btnClicked.style.background = "";
             if (window.showToast) {
               window.showToast(
                 res.warning
                   ? "Diagnóstico guardado con advertencia de sincronizacion."
                   : "Guardado correctamente.",
                 res.warning ? "warning" : "success"
               );
             } else if (res.warning) {
               alert("Guardado correctamente. Advertencia: " + res.warning);
             } else {
               alert("Guardado correctamente.");
             }
             restoreAllButtons(allBtns, btnClicked, originalContent);
          }, 800);
      }
    } else {
      if(pdfWindow) pdfWindow.close();
      alert("Error: " + (res.message || "No se pudo guardar."));
      restoreAllButtons(allBtns, btnClicked, originalContent);
    }
  } catch (e) {
    if(pdfWindow) pdfWindow.close();
    console.error(e);
    alert(e && e.message ? e.message : "Error de conexión.");
    restoreAllButtons(allBtns, btnClicked, originalContent);
  } finally {
    isDiagnosisSaveInProgress = false;
  }
}

function restoreAllButtons(allBtns, btnClicked, originalContent) {
  allBtns.forEach((b) => (b.disabled = false));
  btnClicked.innerHTML = originalContent;
  btnClicked.style.background = "";
}

function normalizeGeneratedDocsState_(docs) {
  const input = docs || {};
  const externalItems = getStoredExternalPdfItemsFromPayload_(input);
  const reportType = String(input.report_type || input.tipo_examen || currentGeneratedDocs.report_type || "").trim().toUpperCase();
  let reportPdf = String(input.report_pdf || input.pdf_url || "").trim();
  const certificatePdf = String(input.certificate_pdf || input.pdf_certificado_link || input.pdf_certificado_url || input.pdfCertificadoUrl || "").trim();
  const isCertificateOnly = reportType === "CERTIFICADO MEDICO" || reportType === "CERTIFICADOMEDICO";
  if (isCertificateOnly && certificatePdf) {
    reportPdf = "";
  }
  return {
    report_type: reportType,
    report_pdf: reportPdf,
    recipe_pdf: String(input.recipe_pdf || input.pdf_receta_link || input.pdf_receta_url || input.pdfRecetaUrl || "").trim(),
    certificate_pdf: certificatePdf,
    external_pdf: String(input.external_pdf || input.pdf_externo_link || input.pdf_externo_url || input.pdfExternoUrl || (externalItems[0] && externalItems[0].url) || "").trim()
  };
}

function setGeneratedDocsState_(docs) {
  currentGeneratedDocs = normalizeGeneratedDocsState_(docs);
  if (docs && (Object.prototype.hasOwnProperty.call(docs, "pdf_externos") || Object.prototype.hasOwnProperty.call(docs, "pdf_externo_link") || Object.prototype.hasOwnProperty.call(docs, "external_pdf"))) {
    setCurrentExternalPdfItems_(getStoredExternalPdfItemsFromPayload_(docs));
  }
  renderGeneratedDocsCard_();
  renderGeneratedDocsManagerModal_();
}

function renderGeneratedDocsCard_() {
  const card = document.getElementById("generatedDocsCard");
  const list = document.getElementById("generatedDocsList");
  const deleteBtn = document.getElementById("btnDeleteGeneratedDocs");
  if (!card || !list) return;

  const docs = normalizeGeneratedDocsState_(currentGeneratedDocs);
  const items = Object.keys(GENERATED_DIAGNOSIS_DOC_META).filter((key) => !!docs[key]);
  if (!currentReportId || !items.length) {
    card.classList.add("hidden");
    list.innerHTML = "";
    if (deleteBtn) deleteBtn.disabled = true;
    return;
  }

  list.innerHTML = items.map((key) => {
    const meta = GENERATED_DIAGNOSIS_DOC_META[key];
    const url = docs[key];
    return `
      <div style="display:flex; align-items:center; gap:6px; padding:10px 12px; border:1px solid #e5e7eb; border-radius:10px; background:#fff;">
        <a href="${url}" target="_blank" style="display:inline-flex; align-items:center; gap:8px; color:${meta.color}; text-decoration:none; font-weight:700;">
          <i class="${meta.icon}"></i> ${meta.label}
        </a>
      </div>
    `;
  }).join("");
  if (deleteBtn) deleteBtn.disabled = false;
  card.classList.remove("hidden");
}

function toggleGeneratedDocsManagerModal_(show) {
  const modal = document.getElementById("modalGeneratedDocsManager");
  if (!modal) return;
  modal.classList[show ? "add" : "remove"]("active");
}

function buildGeneratedDocsManagerActionButton_(options) {
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

function renderGeneratedDocsManagerModal_() {
  const optionsBox = document.getElementById("generatedDocsManagerOptions");
  if (!optionsBox) return;

  const docs = normalizeGeneratedDocsState_(currentGeneratedDocs);
  const items = Object.keys(GENERATED_DIAGNOSIS_DOC_META).filter((key) => !!docs[key]);
  let html = "";

  items.forEach((key) => {
    const meta = GENERATED_DIAGNOSIS_DOC_META[key];
    const actionLabel = meta.managerLabel || meta.label.toLowerCase();
    html += buildGeneratedDocsManagerActionButton_({
      action: `deleteGeneratedDiagnosisAsset('${key}')`,
      icon: meta.icon,
      title: "Borrar " + actionLabel,
      description: "Solo se elimina el archivo PDF. La información escrita del registro se conserva."
    });
  });

  if (!items.length) {
    html += `
      <div style="padding:14px 16px; border:1px dashed #d0d7e2; border-radius:14px; background:#fafcff; color:#5f6b7a;">
        No hay PDFs generados para borrar de forma individual en este momento.
      </div>
    `;
  }

  if (currentReportId) {
    html += buildGeneratedDocsManagerActionButton_({
      action: "deleteCurrentDiagnosisReportFromManager()",
      icon: "fas fa-trash-alt",
      title: "Borrar todo",
      description: "Elimina el diagnostico completo junto con sus archivos asociados.",
      tone: "danger"
    });
  }

  optionsBox.innerHTML = html || `
    <div style="padding:14px 16px; border:1px dashed #d0d7e2; border-radius:14px; background:#fafcff; color:#5f6b7a;">
      No hay acciones disponibles para este registro.
    </div>
  `;
}

function clearDeletedDiagnosisAssetUi_(assetType) {
  const docs = normalizeGeneratedDocsState_(currentGeneratedDocs);
  if (assetType === "report_pdf") docs.report_pdf = "";
  if (assetType === "recipe_pdf") docs.recipe_pdf = "";
  if (assetType === "certificate_pdf") docs.certificate_pdf = "";
  if (assetType === "external_pdf") {
    docs.external_pdf = "";
    setCurrentExternalPdfItems_([]);
  }
  currentGeneratedDocs = docs;
  renderGeneratedDocsCard_();
  renderGeneratedDocsManagerModal_();
}

window.openGeneratedDocsManagerModal = function() {
  if (!currentReportId) {
    alert("Aún no existe un reporte guardado.");
    return;
  }
  renderGeneratedDocsManagerModal_();
  toggleGeneratedDocsManagerModal_(true);
};

window.closeGeneratedDocsManagerModal = function() {
  toggleGeneratedDocsManagerModal_(false);
};

window.deleteGeneratedDiagnosisAsset = async function(assetType) {
  if (isManagingDiagnosisAssets) {
    alert("Ya se esta procesando una accion. Espera un momento.");
    return;
  }
  const meta = GENERATED_DIAGNOSIS_DOC_META[assetType];
  const actionLabel = meta && meta.managerLabel ? meta.managerLabel : (meta ? meta.label.toLowerCase() : "");
  if (!meta) {
    alert("Tipo de documento no válido.");
    return;
  }
  if (!currentReportId) {
    alert("Aún no existe un reporte guardado.");
    return;
  }

  const requester = getRequesterFromSession();
  if (!requester) return;

  const ok = window.appConfirm
    ? await window.appConfirm({
        title: "Eliminar archivo",
        message: "Se borrará solo el archivo de " + actionLabel + ".\nLa información clínica y la receta escrita se conservarán.",
        confirmText: "Si, borrar archivo",
        cancelText: "Cancelar"
      })
    : confirm("Borrar solo el archivo de " + actionLabel + "?");
  if (!ok) return;

  try {
    isManagingDiagnosisAssets = true;
    const res = await postDiagnosisApiJson_({
      action: "delete_diagnosis_asset",
      id_reporte: currentReportId,
      asset_type: assetType,
      requester: requester
    });
    if (!res || !res.success) {
      throw new Error((res && res.message) || "No se pudo eliminar el archivo.");
    }
    if (res.remaining_docs) {
      setGeneratedDocsState_(res.remaining_docs);
    } else {
      clearDeletedDiagnosisAssetUi_(assetType);
    }
    if (assetType === "external_pdf") setCurrentExternalPdfItems_([]);
    renderGeneratedDocsManagerModal_();
    if (window.showToast) {
      window.showToast(
        res.warning
          ? ("Archivo eliminado con advertencia: " + res.warning)
          : "Archivo eliminado correctamente.",
        res.warning ? "warning" : "success"
      );
    } else if (res.warning) {
      alert("Archivo eliminado. Advertencia: " + res.warning);
    }
  } catch (e) {
    alert(e && e.message ? e.message : "No se pudo eliminar el archivo.");
  } finally {
    isManagingDiagnosisAssets = false;
  }
};

window.deleteCurrentDiagnosisReportFromManager = async function() {
  if (isManagingDiagnosisAssets) {
    alert("Ya se esta procesando una accion. Espera un momento.");
    return;
  }
  if (!currentReportId) {
    alert("Aún no existe un reporte guardado.");
    return;
  }

  const requester = getRequesterFromSession();
  if (!requester) return;

  const ok = window.appConfirm
    ? await window.appConfirm({
        title: "Borrar todo",
        message: "Se eliminará el diagnóstico completo con sus archivos asociados.\nEsta acción no se puede deshacer.",
        confirmText: "Si, borrar todo",
        cancelText: "Cancelar"
      })
    : confirm("Eliminar el diagnóstico completo?");
  if (!ok) return;

  try {
    isManagingDiagnosisAssets = true;
    const res = await postDiagnosisApiJson_({
      action: "delete_diagnosis",
      id_reporte: currentReportId,
      requester: requester
    });
    if (!res || !res.success) {
      throw new Error((res && res.message) || "No se pudo eliminar el diagnóstico.");
    }

    currentReportId = null;
    setGeneratedDocsState_({});
    closeGeneratedDocsManagerModal();

    if (window.showToast) {
      window.showToast(
        res.warning
          ? ("Diagnóstico eliminado con advertencia: " + res.warning)
          : "Diagnóstico eliminado correctamente.",
        res.warning ? "warning" : "success"
      );
    } else if (res.warning) {
      alert("Diagnóstico eliminado. Advertencia: " + res.warning);
    }

    setTimeout(() => window.navigateWithEnv(`clinical.html?id=${currentPatientId}&tab=diagnostico`), 900);
  } catch (e) {
    alert(e && e.message ? e.message : "No se pudo eliminar el diagnóstico.");
  } finally {
    isManagingDiagnosisAssets = false;
  }
};
// ==========================================
// CONTROL DE MÓDULOS OPCIONALES (RECETA Y ARCHIVOS)
// ==========================================

// 1. Mostrar/Ocultar Receta
window.toggleRecetaModule = function(show) {
    const btn = document.getElementById("btnOpenReceta");
    const container = document.getElementById("recetaUniversalContainer");
    
    if (show) {
        if(btn) btn.style.display = "none";
        if(container) {
            container.classList.remove("hidden");
            // Si está vacía, agregamos una fila
            if(document.querySelector("#tablaRecetaUniversal tbody").children.length === 0) {
                addMedRowUniversal();
            }
        }
    } else {
        // CERRAR Y BORRAR DATOS
        if(confirm("¿Quitar la receta? Se borrarán los datos ingresados.")) {
            if(btn) btn.style.display = "block";
            if(container) container.classList.add("hidden");
            // Limpiar inputs
            document.querySelector("#tablaRecetaUniversal tbody").innerHTML = "";
            const obs = document.getElementById("receta_obs_universal");
            if(obs) obs.value = "";
        }
    }
}

// 2. Mostrar/Ocultar Archivo Adjunto
window.togglePdfModule = function(show) {
    const btn = document.getElementById("btnOpenPdf");
    const container = document.getElementById("pdfUploadContainer");
    
    if (show) {
        if(btn) btn.style.display = "none";
        if(container) container.classList.remove("hidden");
        renderExternalPdfItems_();
    } else {
        // CERRAR Y BORRAR
        if(confirm("¿Quitar todos los archivos PDF adjuntos de este formulario?")) {
            if(btn) btn.style.display = "block";
            if(container) container.classList.add("hidden");
            
            // Limpiar input file
            const input = document.getElementById("pdfExternoFile");
            if(input) input.value = "";
            
            // Limpiar visualización de archivo existente
            setCurrentExternalPdfItems_([]);
        }
    }
}
// ==========================================
// 4. CARGA DE DATOS (EDICIÓN)
// ==========================================
// js/diagnostico.js - FUNCIÓN DE CARGA BLINDADA
function loadReportForEdit(reportId) {
  // CORRECCIÓN 1: Solo cambiamos texto a los botones PRINCIPALES de guardar
  const mainSaveBtns = document.querySelectorAll(".btn-save-main"); 
  mainSaveBtns.forEach((b) => (b.innerText = "⏳ Cargando..."));

  const requestPromise = postDiagnosisApiJson_({
    action: "get_diagnosis_report",
    id_reporte: reportId,
    requester: getRequesterFromSession()
  });

    requestPromise
    .then((res) => {
      console.log("Respuesta de diagnosticos_archivos:", res);
      if (!res || !Array.isArray(res.data)) {
      alert("Error: No se pudo cargar la información del diagnóstico (respuesta inválida de la API).");
      console.error("Respuesta inesperada de la API de diagnosticos_archivos:", res);
      return;
      }
      const report = res.data.find((x) => String(x.id_reporte) === String(reportId));
      if (!report) return alert("Reporte no encontrado");

      let data = {};
      try {
        if (report && typeof report.datos_json === "string") {
          data = JSON.parse(report.datos_json || "{}");
        } else if (report && report.datos_json && typeof report.datos_json === "object") {
          data = Object.assign({}, report.datos_json);
        }
      } catch (e) {
        console.error(e);
        data = {};
      }
      currentMedicalCertificate = null;
      setCurrentExternalPdfItems_(getStoredExternalPdfItemsFromPayload_(data));
      setGeneratedDocsState_({
        report_type: data.tipo_examen || report.tipo_examen,
        pdf_url: report.pdf_url,
        pdf_receta_link: data.pdf_receta_link || report.pdf_receta_url || report.pdfRecetaUrl,
        pdf_certificado_link: data.pdf_certificado_link || report.pdf_certificado_url || report.pdfCertificadoUrl,
        pdf_externo_link: data.pdf_externo_link || report.pdf_externo_url || report.pdfExternoUrl
      });

      // 1. Configurar Servicio
      const selector = document.getElementById("reportTypeSelector");
      let serviceValue = resolveReportServiceValue_(data.tipo_examen || report.tipo_examen);
      if (isLegacyColposcopyService_(serviceValue)) {
        ensureSelectorOption_(selector, serviceValue, "COLPOSCOPIA", { color: "#e67e22", fontWeight: "bold" });
      } else if (isExternalPdfOnlyService_(serviceValue)) {
        ensureSelectorOption_(selector, EXTERNAL_PDF_ONLY_VALUE, "EXAMENPDF", { color: "#2980b9", fontWeight: "bold" });
      } else if (isLegacyGeneralService_(serviceValue)) {
        ensureSelectorOption_(selector, serviceValue, "CONSULTA GENERAL", { color: "#3498db", fontWeight: "bold" });
      }
      selector.value = serviceValue;
      initCustomSelect();
      toggleForm(); // Dibujar campos

      // 2. Restaurar Textos de Botones Principales
      mainSaveBtns.forEach(b => {
        if(b.innerHTML.includes("PDF")) b.innerHTML = '<i class="fas fa-print"></i> Guardar y PDF';
        else b.innerHTML = '<i class="fas fa-save"></i> Guardar Cambios';
      });

      // 3. RELLENAR CAMPOS DINÁMICOS
      if (data.datos_json && typeof data.datos_json === 'object') {
        Object.keys(data.datos_json).forEach(key => {
          const input = document.getElementById("dyn_" + key);
          if (input) {
            input.value = data.datos_json[key];
            return;
          }

          const checkboxes = document.querySelectorAll(`.dyn-check-option[data-field-key="${key}"]`);
          if (!checkboxes || !checkboxes.length) return;

          const raw = data.datos_json[key];
          const selectedValues = Array.isArray(raw)
            ? raw.map(v => String(v || "").trim()).filter(Boolean)
            : String(raw || "").split(',').map(v => v.trim()).filter(Boolean);
          const selectedSet = new Set(selectedValues);

          checkboxes.forEach((cb) => {
            cb.checked = selectedSet.has(String(cb.value || "").trim());
          });
        });
      }

      setClinicalReportDateInputValue_(data.fecha_reporte || report.fecha);

      // Rellenar campos fijos (Legacy)
      if (isLegacyColposcopyService_(serviceValue)) {
        setVal("colpo_evaluacion", data.evaluacion);
        setVal("colpo_vagina", data.vagina);
        setVal("colpo_vulva", data.vulva);
        setVal("colpo_ano", data.ano);
        setVal("colpo_hallazgos", data.hallazgos);
        setVal("colpo_diagnostico", data.diagnostico);
        setVal("colpo_biopsia", data.biopsia);
        setVal("colpo_recomendaciones", data.recomendaciones);
      } else if (isLegacyGeneralService_(serviceValue)) {
        setVal("gen_motivo", data.motivo);
        setVal("gen_evaluacion", data.evaluacion);
        setVal("gen_diagnostico", data.diagnostico);
        setVal("gen_recomendaciones", data.recomendaciones);
      }

      // 4. RECETA (Usando el nuevo sistema de botones)
      if (data.medicamentos && Array.isArray(data.medicamentos) && data.medicamentos.length > 0) {
        toggleRecetaModule(true);
        const tbody = document.querySelector("#tablaRecetaUniversal tbody");
        tbody.innerHTML = "";
        data.medicamentos.forEach(med => {
          const tr = document.createElement("tr");
          tr.innerHTML = `
          <td><input type="text" class="doc-input med-name-uni" value="${med.nombre}" style="width:100%"></td>
          <td><input type="text" class="doc-input med-qty-uni" value="${med.cantidad}" style="width:100%"></td>
          <td><input type="text" class="doc-input med-freq-uni" value="${med.frecuencia}" style="width:100%"></td>
          <td style="text-align:center;"><button type="button" onclick="this.closest('tr').remove()" style="color:red; background:none; border:none; cursor:pointer;">&times;</button></td>
          `;
          tbody.appendChild(tr);
        });
        if(data.observaciones_receta) {
           document.getElementById("receta_obs_universal").value = data.observaciones_receta;
        }
      }

      // 5. FOTOS (CORRECCIÓN VISUALIZACIÓN)
      if (Object.prototype.hasOwnProperty.call(data, "incluir_firma_virtual")) {
        setVirtualSignatureCheckbox_(data.incluir_firma_virtual);
      }

      const dynamicContainers = document.querySelectorAll('[id^="dyn_gallery_"]');
      const staticContainer = document.getElementById("dynamicPhotoContainer"); 
      if (data.imagenes && Array.isArray(data.imagenes)) {
        data.imagenes.forEach(img => {
          let src = img.data;
          if (!src && img.url) {
            src = img.url;
          }
          if (!src && img.fileId) {
            src = `https://lh3.googleusercontent.com/d/${img.fileId}`; 
          }
          const imgObj = { src: src, title: img.title, fileId: img.fileId, fileUrl: img.url || "" };
          if (staticContainer && isLegacyColposcopyService_(serviceValue)) {
            addPhotoSlot(imgObj, "dynamicPhotoContainer");
          } else if (dynamicContainers.length > 0) {
            addPhotoSlot(imgObj, dynamicContainers[0].id);
          }
        });
      }

      // 6. ARCHIVO ADJUNTO (CORRECCIÓN BORRADO)
      if (getCurrentExternalPdfItems_().length) {
        togglePdfModule(true);
      }
      if (data.certificado_medico && typeof data.certificado_medico === "object") {
        currentMedicalCertificate = normalizeMedicalCertificateData_(data.certificado_medico);
        if (typeof toggleMedicalCertificateModule === "function") {
          toggleMedicalCertificateModule(true);
        }
      }
      console.log("Datos cargados. Activando detector de cambios.");
      setTimeout(() => {
        hasUnsavedChanges = false;
        activateChangeDetection(); 
      }, 1000);
    })
    .catch(err => {
      alert("Error cargando: " + err);
      console.error(err);
    });
}

// Helpers Comunes
function loadPatientFullData(id) {
  // Obtener requester desde la sesión
  let requester = null;
  try {
    const s = sessionStorage.getItem('vidafem_session');
    if (s) requester = JSON.parse(s).data.usuario;
  } catch (e) {}
  if (!requester) {
    alert("No autenticado. Por favor inicia sesión de nuevo.");
    window.navigateWithEnv("index.html");
    return;
  }
  const useWorker = !!(window.VF_API_RUNTIME && window.VF_API_RUNTIME.backend === "worker");
  const requestPromise = useWorker
    ? postDiagnosisApiJson_({ action: "get_doctor_patients", requester: requester })
    : fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "get_data", sheet: "pacientes", requester }),
      }).then((r) => r.json());
  requestPromise
    .then((res) => {
      if (!res || !Array.isArray(res.data)) {
        alert("Error: No se pudo cargar la información del paciente (respuesta inválida de la API).");
        console.error("Respuesta inesperada de la API de pacientes:", res);
        return;
      }
      const p = res.data.find((x) => String(x.id_paciente) === String(id));
      if (p) {
        document.getElementById("displayNombre").innerText = p.nombre_completo;
        document.getElementById("displayCedula").innerText =
          "C.I.: " + (p.cedula || "--");
        document.getElementById("displayEdad").innerText = calculateAge(
          p.fecha_nacimiento
        );
        document.getElementById("displayNacimiento").innerText =
          p.fecha_nacimiento ? p.fecha_nacimiento.split("T")[0] : "--";
        document.getElementById("patientNameDisplay").value = p.nombre_completo;
      } else {
        alert("Paciente no encontrado en la base de datos.");
      }
    })
    .catch((err) => {
      alert("Error cargando datos del paciente: " + err);
      console.error(err);
    });
}
function calculateAge(d) {
  if (!d) return "-";
  const t = new Date();
  const b = new Date(d);
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return a + " años";
}

const LEGACY_COLPOSCOPY_VALUE = "__legacy_colposcopia__";
const LEGACY_GENERAL_VALUE = "__legacy_consulta_general__";
const EXTERNAL_PDF_ONLY_VALUE = "examenpdf";
const EVERYTHING_VALUE = "todo";
const CERTIFICATE_ONLY_VALUE = "certificadomedico";

function isRecipeService_(value) {
  const raw = String(value || "").trim();
  return raw.toLowerCase() === "receta" || raw.toUpperCase() === "RECETA";
}

function isEverythingService_(value) {
  const raw = String(value || "").trim();
  return raw.toLowerCase() === EVERYTHING_VALUE || raw.toUpperCase() === "TODO";
}

function isExternalPdfOnlyService_(value) {
  const raw = String(value || "").trim();
  return raw.toLowerCase() === EXTERNAL_PDF_ONLY_VALUE || raw.toUpperCase() === "EXAMENPDF";
}

function isCertificateOnlyService_(value) {
  const raw = String(value || "").trim();
  const upper = raw.toUpperCase();
  return raw.toLowerCase() === CERTIFICATE_ONLY_VALUE || upper === "CERTIFICADO MEDICO" || upper === "CERTIFICADOMEDICO";
}

function isLegacyColposcopyService_(value) {
  return String(value || "").trim() === LEGACY_COLPOSCOPY_VALUE;
}

function isLegacyGeneralService_(value) {
  return String(value || "").trim() === LEGACY_GENERAL_VALUE;
}

function findConfiguredServiceName_(serviceName) {
  const target = String(serviceName || "").trim().toLowerCase();
  if (!target) return "";
  return Object.keys(CONFIG_CAMPOS).find((key) => String(key || "").trim().toLowerCase() === target) || "";
}

function ensureSelectorOption_(select, value, label, styles) {
  if (!select || !value) return;
  const exists = Array.from(select.options).some((opt) => String(opt.value) === String(value));
  if (exists) return;

  const option = document.createElement("option");
  option.value = value;
  option.innerText = label || value;
  if (styles && styles.color) option.style.color = styles.color;
  if (styles && styles.fontWeight) option.style.fontWeight = styles.fontWeight;
  select.appendChild(option);
}

function resolveReportServiceValue_(tipoExamen) {
  const raw = String(tipoExamen || "").trim();
  const upper = raw.toUpperCase();
  if (!raw) return "";
  if (upper === "RECETA") return "receta";
  if (upper === "TODO") return EVERYTHING_VALUE;
  if (upper === "EXAMENPDF" || upper === "EXAMEN PDF") return EXTERNAL_PDF_ONLY_VALUE;
  if (upper === "CERTIFICADO MEDICO" || upper === "CERTIFICADOMEDICO") return CERTIFICATE_ONLY_VALUE;

  const configured = findConfiguredServiceName_(raw);
  if (configured) return configured;

  if (upper === "COLPOSCOPIA") return LEGACY_COLPOSCOPY_VALUE;
  if (upper === "CONSULTA GENERAL") return LEGACY_GENERAL_VALUE;

  return raw;
}

function openUniversalRecipeModuleIfNeeded_() {
  const container = document.getElementById("recetaUniversalContainer");
  if (!container || !container.classList.contains("hidden")) return;
  if (typeof toggleRecetaModule === "function") {
    toggleRecetaModule(true);
  }
}

function openPdfModuleIfNeeded_() {
  const container = document.getElementById("pdfUploadContainer");
  if (!container || !container.classList.contains("hidden")) return;
  if (typeof togglePdfModule === "function") {
    togglePdfModule(true);
  }
}

function openMedicalCertificateModuleIfNeeded_() {
  const container = document.getElementById("medicalCertificateContainer");
  if (!container || !container.classList.contains("hidden")) return;
  if (typeof toggleMedicalCertificateModule === "function") {
    toggleMedicalCertificateModule(true);
  }
}

function loadServicesDropdown() {
  const s = document.getElementById("reportTypeSelector");
  if (!s) return Promise.resolve();

  // 1. Limpieza y opciones fijas iniciales
  s.innerHTML = `
      <option value="" selected disabled>-- Seleccione Procedimiento --</option>
      <option value="receta" style="font-weight:bold; color:#27ae60;">📝 RECETA MÉDICA</option>
      <option value="${CERTIFICATE_ONLY_VALUE}" style="font-weight:bold; color:#8e44ad;">CERTIFICADO MEDICO</option>
      <option value="${EVERYTHING_VALUE}" style="font-weight:bold; color:#16a085;">TODO</option>
  `;

  console.log("🔄 Cargando configuración de servicios...");

  // 2. HACEMOS DOS PETICIONES SIMULTÁNEAS (Campos + Títulos/Metadatos)
  // Esto es necesario para tener el Título del Informe listo cuando selecciones
  s.insertAdjacentHTML("beforeend", `<option value="${EXTERNAL_PDF_ONLY_VALUE}" style="font-weight:bold; color:#2980b9;">EXAMENPDF</option>`);
  const requester = getRequesterFromSession();
  const p1 = (window.vfDataBridge && window.vfDataBridge.getServiceConfig)
    ? window.vfDataBridge.getServiceConfig(requester)
    : postDiagnosisApiJson_({ action: "get_service_config", requester: requester });
  const p2 = (window.vfDataBridge && window.vfDataBridge.getServices)
    ? window.vfDataBridge.getServices(requester)
    : postDiagnosisApiJson_({ action: "get_services", requester: requester });

  return Promise.all([p1, p2])
    .then(([resConfig, resMeta]) => {
      
      // A. Guardar campos (Lo que ya tenías)
      if (resConfig.success) {
          CONFIG_CAMPOS = resConfig.data;
          console.log("✅ Configuración cargada:", CONFIG_CAMPOS);
      }
      
      // B. Guardar Metadatos (Aquí vienen los Títulos y Recomendaciones nuevos)
      if (resMeta.success) {
          SERVICES_METADATA = resMeta.data;
      }

      // C. Dibujar el menú con los servicios nuevos
      const serviciosNuevos = [];
      const seenServices = {};
      const metadataList = Array.isArray(SERVICES_METADATA) ? SERVICES_METADATA : [];
      const sourceNames = metadataList.length
        ? metadataList.map((item) => String((item && item.nombre_servicio) || "").trim())
        : Object.keys(CONFIG_CAMPOS);

      sourceNames.forEach((serviceName) => {
          const clean = String(serviceName || "").trim();
          if (!clean || seenServices[clean]) return;
          seenServices[clean] = true;
          serviciosNuevos.push(clean);
      });

      if(serviciosNuevos.length > 0) {
          serviciosNuevos.forEach((nombreServicio) => {
              if (isRecipeService_(nombreServicio)) return;
              const o = document.createElement("option");
              o.value = nombreServicio; 
              o.innerText = nombreServicio.toUpperCase();
              s.appendChild(o);
          });
      }
      
      // D. Iniciar el menú bonito
      initCustomSelect(); 
    })
    .catch(err => console.error("Error cargando servicios:", err));
}
function toggleForm() {
  const v = document.getElementById("reportTypeSelector").value;
  document
    .querySelectorAll(".report-form")
    .forEach((e) => e.classList.add("hidden"));
  if (isLegacyColposcopyService_(v))
    document.getElementById("form-colposcopia").classList.remove("hidden");
  else if (isRecipeService_(v)) {
    document.getElementById("form-receta").classList.remove("hidden");
    openUniversalRecipeModuleIfNeeded_();
  }
  else if (isEverythingService_(v)) {}
  else if (isExternalPdfOnlyService_(v)) {
    document.getElementById("form-examen-pdf").classList.remove("hidden");
    openPdfModuleIfNeeded_();
  }
  else if (isCertificateOnlyService_(v)) {
    document.getElementById("form-certificado-medico").classList.remove("hidden");
    openMedicalCertificateModuleIfNeeded_();
  }
  else if (isLegacyGeneralService_(v))
    document.getElementById("form-general").classList.remove("hidden");
}
function addMedRow() {
  const b = document.querySelector("#medicationTable tbody");
  const r = document.createElement("tr");
  r.innerHTML = `<td><input type="text" class="doc-input med-name"></td><td><input type="text" class="doc-input med-qty"></td><td><input type="text" class="doc-input med-freq"></td><td style="text-align:center;"><button onclick="this.parentElement.parentElement.remove()" style="color:red; border:none; background:none;"><i class="fas fa-trash"></i></button></td>`;
  b.appendChild(r);
}
function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val || "";
}
// ==========================================
// 5. LÓGICA DEL MÓDULO RECETA OPCIONAL
// ==========================================

// --- FUNCIONES DE RECETA UNIVERSAL (IDs Corregidos) ---

function toggleRecetaUniversal() {
    const div = document.getElementById("recetaUniversalContainer");
    if(!div) return; // Protección anti-error
    
    if (div.classList.contains("hidden")) {
        div.classList.remove("hidden");
        // Auto-agregar fila si está vacía
        const tbody = document.querySelector("#tablaRecetaUniversal tbody");
        if(tbody && tbody.children.length === 0) {
            addMedRowUniversal();
        }
    } else {
        div.classList.add("hidden");
    }
}

function addMedRowUniversal() {
    const tbody = document.querySelector("#tablaRecetaUniversal tbody");
    if (!tbody) {
        console.error("Error: No encuentro #tablaRecetaUniversal tbody");
        return;
    }
    
    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td><input type="text" class="doc-input med-name-uni" placeholder="Nombre..." style="width:100%"></td>
        <td><input type="text" class="doc-input med-qty-uni" placeholder="#" style="width:100%"></td>
        <td><input type="text" class="doc-input med-freq-uni" placeholder="Indicaciones..." style="width:100%"></td>
        <td style="text-align:center;"><button type="button" onclick="this.closest('tr').remove()" style="color:red; background:none; border:none; cursor:pointer;">&times;</button></td>
    `;
    tbody.appendChild(tr);
}

// Función auxiliar para "cosechar" los datos de la receta
function getOptionalRecipeData() {
    const meds = [];
    document.querySelectorAll("#tablaRecetaOpcional tbody tr").forEach(tr => {
        const nombre = tr.querySelector(".med-name-opt").value;
        const cantidad = tr.querySelector(".med-qty-opt").value;
        const frecuencia = tr.querySelector(".med-freq-opt").value;
        
        if (nombre && nombre.trim() !== "") {
            meds.push({ nombre, cantidad, frecuencia });
        }
    });

    // Solo devolvemos datos si hay medicamentos o una observación escrita
    const obs = document.getElementById("receta_observaciones_opcional").value;
    
    if (meds.length > 0 || obs.trim() !== "") {
        return {
            hayReceta: true,
            medicamentos: meds,
            observaciones_receta: obs // Usamos nombre distinto para no chocar con observaciones del reporte
        };
    }
    return { hayReceta: false };
}



// ==========================================
// 2. EL DIBUJANTE (Renderizado Dinámico)
// ==========================================

// Decide qué formulario mostrar según la selección
window.toggleForm = function() {
    const select = document.getElementById("reportTypeSelector");
    if (!select) return;

    const servicio = select.value;
    
    // 1. Ocultar todos los formularios primero
    const forms = document.querySelectorAll(".report-form, #form-colposcopia, #form-general, #form-receta, #form-examen-pdf, #form-certificado-medico, #form-dinamico");
    forms.forEach(f => f.classList.add("hidden"));

    // 2. Mostrar el correcto según la selección
    if (isLegacyColposcopyService_(servicio)) {
        document.getElementById("form-colposcopia").classList.remove("hidden");
    } 
    else if (isRecipeService_(servicio)) {
        document.getElementById("form-receta").classList.remove("hidden");
        openUniversalRecipeModuleIfNeeded_();
    }
    else if (isEverythingService_(servicio)) {}
    else if (isExternalPdfOnlyService_(servicio)) {
        document.getElementById("form-examen-pdf").classList.remove("hidden");
        openPdfModuleIfNeeded_();
    }
    else if (isCertificateOnlyService_(servicio)) {
      document.getElementById("form-certificado-medico").classList.remove("hidden");
      openMedicalCertificateModuleIfNeeded_();
    }
    else if (isLegacyGeneralService_(servicio)) {
        document.getElementById("form-general").classList.remove("hidden");
    } 
    else {
        // MODO DINÁMICO (Aquí ocurre la magia)
        const divDinamico = document.getElementById("form-dinamico");
        if (divDinamico) {
            divDinamico.classList.remove("hidden");
            
            // Buscamos la configuración en el "Mapa" que cargamos del Excel
            // Usamos toLowerCase() para evitar problemas de mayúsculas/minúsculas
            const configKey = findConfiguredServiceName_(servicio);
            
            if (configKey && CONFIG_CAMPOS[configKey]) {
                // Si encontramos instrucciones, ¡DIBUJAMOS!
                renderDynamicFields(servicio, CONFIG_CAMPOS[configKey]);
            } else {
                // Si elegiste un servicio pero no configuraste campos en Excel todavía
                divDinamico.innerHTML = `
                    <div style="text-align:center; padding:40px; color:#7f8c8d; background:#f9f9f9; border-radius:10px;">
                        <i class="fas fa-tools" style="font-size:2rem; margin-bottom:15px; color:#bdc3c7;"></i><br>
                        <h3 style="margin:0; color:#2c3e50;">${servicio}</h3>
                        <p style="margin-top:10px;">Este servicio está activo pero aún no tiene campos configurados.</p>
                        <small style="color:#e67e22;">Ve a la hoja 'config_campos' en tu Excel para diseñarlo.</small>
                    </div>`;
            }
        }
    }
    setTimeout(() => {
        hasUnsavedChanges = false; // Reseteamos al cambiar de formulario
        activateChangeDetection(); // Activamos vigilancia en los campos nuevos
    }, 500);
};

// Función que crea el HTML de los campos
// Función que crea el HTML de los campos
function renderDynamicFields(nombreServicio, campos) {
    const container = document.getElementById("form-dinamico");
    
    // --- NUEVO: BUSCAR EL TÍTULO PERSONALIZADO ---
    let tituloMostrar = "REPORTE CLÍNICO"; // Valor por defecto
    
    // Verificamos si existe la variable global SERVICES_METADATA
    if (typeof SERVICES_METADATA !== 'undefined' && SERVICES_METADATA.length > 0) {
        // Buscamos el servicio actual en la lista
        const meta = SERVICES_METADATA.find(s => s.nombre_servicio === nombreServicio);
        // Si tiene un título configurado, lo usamos
        if (meta && meta.titulo_reporte && meta.titulo_reporte.trim() !== "") {
            tituloMostrar = meta.titulo_reporte.toUpperCase();
        }
    }

    let html = `
        <div class="paper-sheet">
            <div style="text-align:right; margin-bottom:10px;">
                <span style="background:#8e44ad; color:white; padding:5px 15px; border-radius:15px; font-size:0.8rem; font-weight:bold; text-transform:uppercase;">
                    ${nombreServicio}
                </span>
            </div>
            <h2 class="doc-title" style="color:#8e44ad;">${tituloMostrar}</h2>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
    `;
    
    campos.forEach(c => {
        let inputHtml = "";
        
        if (c.tipo === 'titulo') {
            html += `
                </div>
                <h4 style="grid-column: 1 / -1; margin-top:20px; color:#2c3e50; border-bottom:2px solid #eee; padding-bottom:5px;">
                    ${c.etiqueta}
                </h4>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
            `;
            return;
        }

        // --- GESTIÓN DE IMÁGENES ---
        if (c.tipo === 'imagenes') {
           const galleryId = `dyn_gallery_${c.nombre}`;
           // Controles de tamaño S/M/L por galería (responsive)
           inputHtml = `
            <div style="background:#fff; padding:15px; border:1px solid #ddd; border-radius:8px;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;">
                <label style="font-weight:bold; color:#555;">${c.etiqueta}</label>
                <button type="button" onclick="addPhotoSlot(null, '${galleryId}')" class="btn-submit" style="background:#e67e22; padding:5px 15px; font-size:0.85rem; width:auto;">
                  <i class="fas fa-camera"></i> Agregar Foto
                </button>
              </div>
              <div id="photoSizeControls_${galleryId}" class="photo-size-controls">
                <span style='font-weight:bold;'>Tamaño:</span>
                <div class="photo-size-inline">
                  <button type="button" class="photo-size-btn active" data-size="small" data-gallery="${galleryId}">S</button>
                  <button type="button" class="photo-size-btn" data-size="medium" data-gallery="${galleryId}">M</button>
                  <button type="button" class="photo-size-btn" data-size="large" data-gallery="${galleryId}">L</button>
                </div>
                <select id='photoSizeSelect_${galleryId}' style='display:none;'>
                  <option value='small' selected>Pequeño</option>
                  <option value='medium'>Mediano</option>
                  <option value='large'>Grande</option>
                </select>
              </div>
              <div id="${galleryId}" class="photo-grid-dynamic" style="display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:10px;"></div>
            </div>
           `;
        } 
        // --- NUEVO: LISTAS DESPLEGABLES (SELECT) ---
        else if (c.tipo === 'select') {
            let optionsHtml = `<option value="">-- Seleccionar --</option>`;
            if (c.opciones) {
                // Separar opciones por comas y limpiarlas
                c.opciones.split(',').forEach(opt => {
                    const cleanOpt = opt.trim();
                    optionsHtml += `<option value="${cleanOpt}">${cleanOpt}</option>`;
                });
            }
            inputHtml = `<select id="dyn_${c.nombre}" class="doc-input">${optionsHtml}</select>`;
        }
        // --- NUEVO: CASILLAS CON OPCIONES (CHECKBOXES) ---
        else if (c.tipo === 'casillas_opciones') {
          const opts = String(c.opciones || "")
            .split(',')
            .map(opt => String(opt || "").trim())
            .filter(Boolean);
          const optsHtml = (opts.length ? opts : ["Opción 1", "Opción 2"]).map((opt, idx) => {
            const safeOpt = String(opt).replace(/"/g, '&quot;');
            return `
              <label style="display:flex; align-items:center; gap:8px; margin:6px 0; color:#444;">
                <input type="checkbox"
                     class="dyn-check-option"
                     data-field-key="${c.nombre}"
                     data-option-value="${safeOpt}"
                     id="dyn_${c.nombre}_opt_${idx}"
                     value="${safeOpt}">
                <span>${opt}</span>
              </label>
            `;
          }).join('');
          inputHtml = `
            <div class="dyn-check-group" data-field-key="${c.nombre}" style="padding:8px 10px; border:1px solid #ddd; border-radius:8px; background:#fff;">
              ${optsHtml}
            </div>
          `;
        }
        // --- NUEVO: NÚMEROS CON PLACEHOLDER "0" ---
        else if (c.tipo === 'numero') {
            inputHtml = `<input type="number" id="dyn_${c.nombre}" class="doc-input" placeholder="0">`;
        } 
        else if (c.tipo === 'parrafo') {
            inputHtml = `<textarea id="dyn_${c.nombre}" class="doc-input" rows="4" placeholder="Escriba aquí..."></textarea>`;
        } 
        else {
            inputHtml = `<input type="text" id="dyn_${c.nombre}" class="doc-input">`;
        }

        const colSpan = (c.tipo === 'parrafo' || c.tipo === 'imagenes') ? 'grid-column: 1 / -1;' : '';
        
        html += `
            <div style="${colSpan}">
                 ${c.tipo !== 'imagenes' ? `<label style="font-weight:bold; font-size:0.9rem; color:#555; display:block; margin-bottom:5px;">${c.etiqueta}</label>` : ''}
                ${inputHtml}
            </div>
        `;
    });

    html += `</div></div>`;
    container.innerHTML = html;
    // Inicializar controles S/M/L para cada galería de fotos
    campos.forEach(c => {
      if (c.tipo === 'imagenes') {
        const galleryId = `dyn_gallery_${c.nombre}`;
        const sizeSel = document.getElementById(`photoSizeSelect_${galleryId}`);
        const sizeButtons = document.querySelectorAll(`#photoSizeControls_${galleryId} .photo-size-btn`);
        if(sizeSel) {
          const updateSizeUI = (size) => {
            sizeSel.value = size;
            sizeButtons.forEach((b) => b.classList.toggle("active", b.dataset.size === size));
            applyGalleryLayout(galleryId, size);
            const imgs = document.querySelectorAll(`#${galleryId} img[id^='img_']`);
            imgs.forEach((img) => { img.dataset.size = size; });
          };
          sizeButtons.forEach((btn) => {
            btn.addEventListener("click", () => updateSizeUI(btn.dataset.size));
          });
          updateSizeUI(sizeSel.value || "small");
        }
      }
    });
}

// 4. FUNCIONES GLOBALES DE RECETA (Para corregir el error ReferenceError)
window.toggleRecetaUniversal = function() {
    const div = document.getElementById("recetaUniversalContainer");
    if (!div) return;
    if(div.classList.contains("hidden")) {
        div.classList.remove("hidden");
        if(document.querySelector("#tablaRecetaUniversal tbody").children.length === 0) window.addMedRowUniversal();
    } else {
        div.classList.add("hidden");
    }
};

window.addMedRowUniversal = function() {
    const tbody = document.querySelector("#tablaRecetaUniversal tbody");
    if(!tbody) return;
    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td><input type="text" class="doc-input med-name-uni" placeholder="Nombre..." style="width:100%"></td>
        <td><input type="text" class="doc-input med-qty-uni" placeholder="#" style="width:100%"></td>
        <td><input type="text" class="doc-input med-freq-uni" placeholder="Dosis..." style="width:100%"></td>
        <td style="text-align:center;"><button type="button" onclick="this.closest('tr').remove()" style="color:red; background:none; border:none; cursor:pointer; font-size:1.2em;">&times;</button></td>
    `;
    tbody.appendChild(tr);
};

// Inicializador
document.addEventListener("DOMContentLoaded", function() {
 // loadFieldConfig();
 setCurrentExternalPdfItems_([]);
});
// --- FUNCIÓN MAESTRA DE GUARDADO (Poner al final de diagnostico.js) ---
function handleMasterSave(generatePdf, btn) {
    const servicio = document.getElementById("reportTypeSelector").value;
    
    // 1. Recolectar datos universales (Receta)
    const receta = getUniversalRecipeData(); // Función auxiliar de abajo

    if (isLegacyColposcopyService_(servicio)) {
        saveDiagnosis(generatePdf, btn, receta);
    } 
    else if (isRecipeService_(servicio)) {
        saveRecipe(generatePdf, btn);
    }
    else if (isEverythingService_(servicio)) {
        saveEverything(generatePdf, btn);
    }
    else if (isExternalPdfOnlyService_(servicio)) {
        saveExternalPdfOnly(generatePdf, btn);
    }
    else if (isCertificateOnlyService_(servicio)) {
      saveMedicalCertificateOnly(generatePdf, btn);
    }
    else if (isLegacyGeneralService_(servicio)) {
        saveGeneral(generatePdf, btn, receta);
    } 
    else {
        // Para los servicios nuevos del Excel
        saveDynamicService(servicio, generatePdf, btn, receta);
    }
}

// Auxiliar para leer la receta
function getUniversalRecipeData() {
    const meds = [];
    document.querySelectorAll("#tablaRecetaUniversal tbody tr").forEach(tr => {
        const nombre = tr.querySelector(".med-name-uni").value;
        const cant = tr.querySelector(".med-qty-uni").value;
        const frec = tr.querySelector(".med-freq-uni").value;
        if (nombre) meds.push({ nombre, cantidad: cant, frecuencia: frec });
    });
    const obs = document.getElementById("receta_obs_universal").value;
    
    if (meds.length > 0 || obs.trim()) {
        return { medicamentos: meds, observaciones_receta: obs };
    }
    return null; // Sin receta
}

// Función Genérica para Servicios Nuevos (CORREGIDA)
function hasMeaningfulDynamicDiagnosisContent_(dataObj, imgs) {
    const values = Object.values(dataObj || {});
    const hasText = values.some((value) => String(value === undefined || value === null ? "" : value).trim());
    return hasText || (Array.isArray(imgs) && imgs.length > 0);
}

function hasMeaningfulRecipeContent_(recetaData) {
    if (!recetaData) return false;
    const meds = Array.isArray(recetaData.medicamentos) ? recetaData.medicamentos : [];
    const hasMeds = meds.some((med) => String(med && med.nombre || "").trim());
    const hasObs = !!String(recetaData.observaciones_receta || "").trim();
    return hasMeds || hasObs;
}

function getExternalPdfPayloadForSave_() {
    return Promise.all(getCurrentExternalPdfItems_().map(async (item, index) => {
        const current = item || {};
        const baseItem = {
            id: String(current.id || createExternalPdfLocalId_()).trim(),
            label: defaultExternalPdfLabel_(current.label || current.name || "Adjunto PDF", index),
            name: String(current.name || (current.file && current.file.name) || "").trim()
        };
        if (current.file) {
            return Object.assign({}, baseItem, {
                mime: String(current.mime || current.file.type || "application/pdf").trim() || "application/pdf",
                data: await readExternalPdfFileAsDataUrl_(current.file)
            });
        }
        return Object.assign({}, baseItem, {
            url: String(current.url || "").trim(),
            file_id: String(current.file_id || current.fileId || extractDriveFileIdFromUrlDiagnosis_(current.url) || "").trim()
        });
    }));
}

function saveExternalPdfOnly(generarPdf, btn) {
    saveCommon("EXAMENPDF", generarPdf, btn, async () => {
        const pdfFiles = await getExternalPdfPayloadForSave_();
        const receta = getUniversalRecipeData();
        const out = {
            datos_json: {
                modo_guardado: "EXAMENPDF"
            }
        };
        if (receta) {
            out.medicamentos = receta.medicamentos;
            out.observaciones_receta = receta.observaciones_receta;
        }
        out.certificado_medico = getMedicalCertificateDataForSave_();
        out.pdf_externos = pdfFiles;
        return out;
    });
}

    function saveMedicalCertificateOnly(generarPdf, btn) {
      saveCommon("CERTIFICADO MEDICO", generarPdf, btn, async () => {
        const receta = getUniversalRecipeData();
        const pdfFiles = await getExternalPdfPayloadForSave_();
        const certData = getMedicalCertificateDataRequired_();
        const out = {
          datos_json: {
            modo_guardado: "CERTIFICADO_MEDICO"
          },
          certificado_medico: certData,
          pdf_externos: pdfFiles
        };
        if (receta) {
          out.medicamentos = receta.medicamentos;
          out.observaciones_receta = receta.observaciones_receta;
        }
        return out;
      });
    }

function saveEverything(generarPdf, btn) {
    saveCommon("TODO", generarPdf, btn, async () => {
        const receta = getUniversalRecipeData();
        const pdfFiles = await getExternalPdfPayloadForSave_();
        const out = {};
        if (receta) {
            out.medicamentos = receta.medicamentos;
            out.observaciones_receta = receta.observaciones_receta;
        }
        out.certificado_medico = getMedicalCertificateDataForSave_();
        out.pdf_externos = pdfFiles;
        return out;
    });
}

async function saveDynamicService(servicio, generatePdf, btn, recetaData) {
    // 1. Confirmación inicial
    if (generatePdf) {
        const ok = window.appConfirm
          ? await window.appConfirm({
              title: "Generar informe",
              message: "Se guardarán los datos de " + servicio + " y se generara el PDF.\nDeseas continuar?",
              confirmText: "Si, generar",
              cancelText: "Cancelar",
            })
          : confirm("Guardar y generar PDF de " + servicio + "?");
        if (!ok) return;
    }

    // Obtener campos dinámicos para el servicio seleccionado
    const campos = CONFIG_CAMPOS[servicio] || [];

    let pdfWindow = null;

    // 2. ABRIR VENTANA DE CARGA (Anti-Bloqueo)
    if (generatePdf) {
        pdfWindow = window.open("", "_blank");
        if (pdfWindow) {
            pdfWindow.document.write("<html><body style='text-align:center; padding:50px; font-family:sans-serif; background:#f4f4f9;'><h2>⏳ Generando Informe...</h2><p>Por favor espere, estamos procesando las imágenes y creando su PDF.</p></body></html>");
        } else {
            alert("⚠️ El navegador bloqueó la ventana emergente. Por favor permita pop-ups para este sitio.");
            return; // Cancelar si no se puede abrir la ventana
        }
    }
    
    const originalText = btn.innerHTML;
    btn.disabled = true; 
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Guardando...';
    let generatedPdfPayload = null;
    
    try {
        // 1. Recolectar datos del formulario dinámico
        const inputs = document.querySelectorAll("#form-dinamico .doc-input");
        const datosDinamicos = {};
        inputs.forEach(inp => {
            const key = inp.id.replace("dyn_", "");
            datosDinamicos[key] = inp.value;
        });

        // 1.b Recolectar grupos de casillas (multi-seleccion)
        const checkGroups = document.querySelectorAll("#form-dinamico .dyn-check-group");
        checkGroups.forEach((group) => {
          const key = String(group.getAttribute("data-field-key") || "").trim();
          if (!key) return;
          const selected = Array.from(group.querySelectorAll(".dyn-check-option:checked"))
            .map((cb) => String(cb.value || "").trim())
            .filter(Boolean);
          datosDinamicos[key] = selected;
        });

        // 2. Imágenes (redimensionar según tamaño y slider de su galería)
        const imgs = [];
        const camposImgs = campos.filter(c => c.tipo === 'imagenes');
        for (const c of camposImgs) {
          const galleryId = `dyn_gallery_${c.nombre}`;
          const sizeSel = document.getElementById(`photoSizeSelect_${galleryId}`);
          let size = sizeSel ? sizeSel.value : 'small';
          const cards = document.querySelectorAll(`#${galleryId} .photo-card img`);
          for (let i = 0; i < cards.length; i++) {
            const imgEl = cards[i];
            const card = imgEl.closest('.photo-card');
            const title = card.querySelector('.photo-input-title').value || `Imagen ${i + 1}`;
            const existingId = imgEl.getAttribute('data-fileid');
            const existingUrl = imgEl.getAttribute('data-fileurl');
            if (imgEl.src.startsWith('data:')) {
              const resizedBase64 = await resizeBase64Image(imgEl.src, 1, size);
              imgs.push({ index: i + 1, title: title, data: resizedBase64, isNew: true, size });
            } else if (existingId || existingUrl) {
              imgs.push({ index: i + 1, title: title, fileId: existingId, url: existingUrl, isNew: false, size });
            }
          }
        }
        // 3. PDFs externos
        const pdfFiles = await getExternalPdfPayloadForSave_();
        const hasDynamicContent = hasMeaningfulDynamicDiagnosisContent_(datosDinamicos, imgs);
        const hasRecipeContent = hasMeaningfulRecipeContent_(recetaData);
        const certData = getMedicalCertificateDataForSave_();
        const hasCertificateContent = hasMeaningfulMedicalCertificateContent_({ certificado_medico: certData });
        const hasExternalPdf = Array.isArray(pdfFiles) && pdfFiles.length > 0;

        if (!hasDynamicContent && !hasRecipeContent && !hasExternalPdf && !hasCertificateContent) {
          throw new Error("Completa al menos un dato del informe, certificado, receta o adjunto antes de guardar este servicio.");
        }

        const dataObj = {
            id_reporte: currentReportId,
            id_paciente: currentPatientId,
            nombre_paciente: document.getElementById("patientNameDisplay").value,
            tipo_examen: servicio,
          fecha_reporte: getClinicalReportDateInputValue_(),
            generar_pdf: generatePdf,
            incluir_firma_virtual: shouldIncludeVirtualSignature_(),
            datos_json: datosDinamicos, 
            medicamentos: recetaData ? recetaData.medicamentos : [],
            observaciones_receta: recetaData ? recetaData.observaciones_receta : "",
            certificado_medico: certData,
            imagenes: imgs,
            pdf_externos: pdfFiles
        };

        if (generatePdf) {
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Armando PDF...';
          generatedPdfPayload = await buildDiagnosisPdfPayloadsForSave_(dataObj);
            Object.assign(dataObj, generatedPdfPayload);
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Subiendo...';
        } else if (hasMeaningfulMedicalCertificateContent_(dataObj)) {
            generatedPdfPayload = await buildDiagnosisCertificatePdfPayloadForSave_(dataObj);
            Object.assign(dataObj, generatedPdfPayload);
        }

        const requesterDoc = getRequesterFromSession();
        if (!requesterDoc) {
            throw new Error("Sesión inválida. Vuelve a iniciar sesión.");
        }
        const res = await postDiagnosisApiJson_({
            action: "save_diagnosis_advanced",
            data: dataObj,
            requester: requesterDoc
        });

        if(res.success) {
            currentReportId = String(res.id_reporte || currentReportId || "").trim() || currentReportId;
          const requiresCertificateReadback = hasMeaningfulMedicalCertificateContent_(dataObj);
          const verifiedReport = requiresCertificateReadback
            ? await fetchDiagnosisReportReadback_(currentReportId)
            : null;
          const verifiedState = verifiedReport ? getDiagnosisPersistedStateFromReport_(verifiedReport) : null;
          if (requiresCertificateReadback && !verifiedState) {
            throw new Error("El backend respondió éxito, pero no se pudo releer el certificado guardado.");
          }
          if (requiresCertificateReadback) {
            const verifiedCert = verifiedState && verifiedState.data && verifiedState.data.certificado_medico;
            const verifiedCertPdf = String(verifiedState && verifiedState.docs && verifiedState.docs.pdf_certificado_link || "").trim();
            if (!verifiedCert || !verifiedCertPdf) {
              throw new Error("El certificado se generó localmente, pero Cloudflare/Supabase no lo persistió completo. Falta el PDF o los datos guardados en el backend.");
            }
          }
          const savedExternalPdfItems = verifiedState
            ? getStoredExternalPdfItemsFromPayload_(verifiedState.docs)
            : getStoredExternalPdfItemsFromPayload_({
              pdf_externos: res.pdf_externos || pdfFiles,
              pdf_externo_link: res.pdf_externo_url || ""
            });
            setCurrentExternalPdfItems_(savedExternalPdfItems);
            setGeneratedDocsState_({
                report_type: servicio,
            pdf_url: verifiedState ? verifiedState.docs.pdf_url : res.pdf_url,
            pdf_receta_link: verifiedState ? verifiedState.docs.pdf_receta_link : (res.pdf_receta_url || res.pdf_receta_link),
            pdf_certificado_link: verifiedState ? verifiedState.docs.pdf_certificado_link : (res.pdf_certificado_url || res.pdf_certificado_link),
            pdf_externo_link: verifiedState ? verifiedState.docs.pdf_externo_link : (res.pdf_externo_url || res.pdf_externo_link),
            pdf_externos: verifiedState ? verifiedState.docs.pdf_externos : (res.pdf_externos || [])
            });
            hasUnsavedChanges = false; 
            btn.innerHTML = '<i class="fas fa-check"></i> OK';
            btn.style.background = "#27ae60";
            
            // SI SE PIDIÓ PDF Y TENEMOS VENTANA ABIERTA
            if(generatePdf && pdfWindow) {
                const mainPdfUrl = String(res.pdf_url || "").trim();
                const recipePdfUrl = String(res.pdf_receta_url || "").trim();
              const certificatePdfUrl = String(res.pdf_certificado_url || "").trim();
                const externalPdfUrl = savedExternalPdfItems.length
                    ? String(savedExternalPdfItems[0].url || "").trim()
                    : String(res.pdf_externo_url || "").trim();
              const targetPdfUrl = mainPdfUrl || certificatePdfUrl || recipePdfUrl || externalPdfUrl;
                if(targetPdfUrl) {
                    console.log("PDF URL recibida:", targetPdfUrl);
                  await openDiagnosisPdfInWindow_(pdfWindow, targetPdfUrl);
                    setTimeout(() => window.navigateWithEnv(`clinical.html?id=${currentPatientId}&tab=diagnostico`), 2000);
                } else {
                  const localReportPdf = String(generatedPdfPayload && generatedPdfPayload.report_pdf_data_url || "").trim();
                  const localRecipePdf = String(generatedPdfPayload && generatedPdfPayload.recipe_pdf_data_url || "").trim();
                  const localCertificatePdf = String(generatedPdfPayload && generatedPdfPayload.certificate_pdf_data_url || "").trim();
                  const localTargetPdf = localReportPdf || localCertificatePdf || localRecipePdf;
                  if (localTargetPdf) {
                    await openDiagnosisPdfInWindow_(pdfWindow, localTargetPdf);
                    alert("⚠️ Aviso: Se guardo y se abrio PDF local porque el servidor no devolvio enlace.");
                    setTimeout(() => window.navigateWithEnv(`clinical.html?id=${currentPatientId}&tab=diagnostico`), 2000);
                  } else {
                    pdfWindow.close();
                    alert("⚠️ Aviso: Se guardaron los datos pero no se pudo obtener PDF remoto ni local.");
                    window.navigateWithEnv(`clinical.html?id=${currentPatientId}&tab=diagnostico`);
                  }
                }
            } else {
                // SOLO GUARDAR
                 setTimeout(() => {
                    btn.disabled = false; 
                    btn.innerHTML = originalText;
                    btn.style.background = "";
                    alert("Datos guardados correctamente.");
                }, 500);
            }
        } else {
            // ERROR DEL SERVIDOR
            if(pdfWindow) pdfWindow.close();
            alert("❌ ERROR DEL SERVIDOR:\n" + res.message);
            btn.disabled = false; btn.innerHTML = originalText;
        }
    } catch (e) {
        if(pdfWindow) pdfWindow.close();
        console.error(e);
        alert("Error: " + e.message);
        btn.disabled = false; btn.innerHTML = originalText;
    }
}
// Función para leer el archivo PDF externo (si existe)
async function getPdfExternoData() {
    const items = await getExternalPdfPayloadForSave_();
    return Array.isArray(items) && items.length ? items[0] : null;
}
// Función para mostrar previsualización en formularios dinámicos
window.handleDynamicImages = function(input, containerId) {
    const container = document.getElementById(containerId);
    if (input.files) {
        Array.from(input.files).forEach((file, index) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                const div = document.createElement('div');
                div.className = "photo-card dynamic-photo-item"; // Clase clave para guardar después
                div.innerHTML = `
                    <div class="photo-frame">
                        <img src="${e.target.result}" style="width:100%; height:100%; object-fit:cover;">
                    </div>
                    <input type="text" class="photo-input-title" placeholder="Descripción (Ej: Ovario Izq)" value="${file.name.split('.')[0]}">
                    <button type="button" onclick="this.parentElement.remove()" style="position:absolute; top:5px; right:5px; background:red; color:white; border:none; border-radius:50%; width:25px; height:25px; cursor:pointer;">&times;</button>
                `;
                container.appendChild(div);
            };
            reader.readAsDataURL(file);
        });
    }
};
// --- FUNCIÓN PARA CREAR EL MENÚ BONITO (Custom Select) ---
function initCustomSelect() {
    const originalSelect = document.getElementById("reportTypeSelector");
    if (!originalSelect) return;

    // 1. Evitar duplicados si ya se creó
    const existingWrapper = document.querySelector(".custom-select-wrapper");
    if (existingWrapper) existingWrapper.remove();

    // 2. Crear estructura contenedora
    const wrapper = document.createElement("div");
    wrapper.className = "custom-select-wrapper";
    
    // 3. Crear el "Botón" que se ve
    const trigger = document.createElement("div");
    trigger.className = "custom-select-trigger";
    // Texto inicial
    const selectedOption = originalSelect.options[originalSelect.selectedIndex];
    trigger.innerHTML = selectedOption ? selectedOption.innerText : "-- Seleccione --";
    
    // 4. Crear la lista desplegable
    const optionsList = document.createElement("div");
    optionsList.className = "custom-options";

    // 5. Copiar opciones del select original al nuevo menú
    Array.from(originalSelect.options).forEach(opt => {
        const div = document.createElement("div");
        div.className = "custom-option";
        div.innerHTML = opt.innerHTML; // Mantiene iconos
        div.dataset.value = opt.value;
        
        // Copiar estilos (colores) del original
        if (opt.style.color) div.style.color = opt.style.color;
        if (opt.style.fontWeight) div.style.fontWeight = opt.style.fontWeight;

        // Si es separador o deshabilitado
        if (opt.disabled) {
            div.classList.add("separator");
        } else {
            // Evento Click
            div.addEventListener("click", () => {
                trigger.innerHTML = opt.innerHTML;
                originalSelect.value = opt.value;
                
                // Disparar evento change manualmente para que toggleForm funcione
                originalSelect.dispatchEvent(new Event('change'));
                
                optionsList.classList.remove("open");
                
                // Visual selected state
                document.querySelectorAll(".custom-option").forEach(c => c.classList.remove("selected"));
                div.classList.add("selected");
            });
        }
        optionsList.appendChild(div);
    });

    // 6. Eventos Abrir/Cerrar
    trigger.addEventListener("click", (e) => {
        e.stopPropagation(); // Evita que se cierre inmediatamente
        optionsList.classList.toggle("open");
    });

    // Cerrar al hacer clic fuera
    document.addEventListener("click", (e) => {
        if (!wrapper.contains(e.target)) {
            optionsList.classList.remove("open");
        }
    });

    // 7. Insertar en el DOM
    wrapper.appendChild(trigger);
    wrapper.appendChild(optionsList);
    originalSelect.parentNode.insertBefore(wrapper, originalSelect);
}
// ==========================================
// 6. SISTEMA DE PROTECCIÓN DE CAMBIOS (NUEVO)
// ==========================================

function activateChangeDetection() {
    // 1. Detectar cambios en cualquier input, select o textarea
    const inputs = document.querySelectorAll("input, select, textarea");
    inputs.forEach(input => {
        // Evitamos duplicar listeners
        if(input.dataset.watching) return;
        
        input.dataset.watching = "true";
        input.addEventListener('input', () => { hasUnsavedChanges = true; });
        input.addEventListener('change', () => { hasUnsavedChanges = true; });
    });
}

// 2. Interceptar el botón "Volver" del Sidebar
document.addEventListener("DOMContentLoaded", () => {
    const btnBack = document.querySelector(".btn-back-sidebar");
    if(btnBack) {
        btnBack.addEventListener("click", (e) => {
            if (hasUnsavedChanges) {
                // El mensaje que pediste:
                const confirmar = confirm("⚠️ No se han guardado los datos.\n¿Desea salir de todas maneras?");
                if (!confirmar) {
                    e.preventDefault(); // CANCELA LA SALIDA
                }
            }
        });
    }
});

// 3. Interceptar cierre de pestaña o recarga (Navegador)
window.addEventListener("beforeunload", (e) => {
    if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = ""; // Necesario para Chrome/Edge
    }
});
