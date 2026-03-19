// js/diagnostico.js - VERSIÓN DINÁMICA FINAL (Títulos Personalizados + Editor Corregido)

let currentPatientId = null;
let currentReportId = null;
let CONFIG_CAMPOS = {};
let SERVICES_METADATA = [];
let hasUnsavedChanges = false;
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
  console.log("🚀 Iniciando Diagnóstico...");

  // 1. Obtener IDs de la URL
  const urlParams = new URLSearchParams(window.location.search);
  const pId = urlParams.get("patientId") || urlParams.get("id"); 
  const rId = urlParams.get("reportId") || urlParams.get("reporte"); // <--- AHORA LEEMOS EL REPORTE

  // Poner fecha de hoy por defecto
  const fechaInput = document.getElementById("fecha");
  if (fechaInput) {
      const today = new Date();
      fechaInput.value = today.toISOString().split('T')[0];
  }

  // 2. Cargar Datos del Paciente
  if (pId) {
    currentPatientId = pId;
    const hiddenInput = document.getElementById("selectedPatientId");
    if(hiddenInput) hiddenInput.value = pId;

    if (typeof loadPatientFullData === 'function') loadPatientFullData(pId);
    
    // Ajustar botón volver
    const btnBack = document.querySelector(".btn-back-sidebar");
    if (btnBack) btnBack.href = `clinical.html?id=${pId}&tab=diagnostico`;
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
            
            <img id="img_${id}" src="${imgSrc}" class="${isHidden}" ${fileIdAttr} ${sizeAttr}>
            
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

    fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "get_file_base64", file_id: fileId, requester: getRequesterFromSession() }),
    })
      .then((r) => r.json())
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
        const size = (imgEl.dataset && PHOTO_SIZE_PRESETS[imgEl.dataset.size]) ? imgEl.dataset.size : "small";
        
        if (imgEl.src.startsWith("data:")) {
            // Normalizamos a tamaño final de impresión
            const processedBase64 = await resizeBase64Image(imgEl.src, 1, size);
            imgs.push({ index: i + 1, title: title, data: processedBase64, isNew: true, size });
        } else if (existingId) {
            // Mantenemos si ya existía
            imgs.push({ index: i + 1, title: title, fileId: existingId, isNew: false, size });
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

    // 3. RECOLECTAR PDF EXTERNO (El archivo subido)
    if(btn) btn.innerText = "Leyendo archivo PDF...";
    let pdfFile = null;
    if (typeof getPdfExternoData === 'function') {
        pdfFile = await getPdfExternoData();
    }

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
      pdf_externo: pdfFile 
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

  saveCommon("RECETA", generarPdf, btn, () => {
    const legacy = readLegacyRecipeData_();
    if (legacy.hasData) {
      return {
        medicamentos: legacy.medicamentos,
        observaciones_receta: legacy.observaciones_receta,
      };
    }

    const universal = typeof getUniversalRecipeData === "function"
      ? getUniversalRecipeData()
      : null;

    return {
      medicamentos: universal && Array.isArray(universal.medicamentos) ? universal.medicamentos : [],
      observaciones_receta: universal ? String(universal.observaciones_receta || "").trim() : "",
    };
  });
}

function saveGeneral(generarPdf, btn) {
  saveCommon("CONSULTA GENERAL", generarPdf, btn, () => {
    return {
      motivo: document.getElementById("gen_motivo").value,
      evaluacion: document.getElementById("gen_evaluacion").value,
      diagnostico: document.getElementById("gen_diagnostico").value,
      recomendaciones: document.getElementById("gen_recomendaciones").value,
    };
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
      throw new Error("Sesion invalida. Vuelve a iniciar sesion.");
    }

    const patientName = (document.getElementById("patientNameDisplay").value || "").trim();
    if (!patientName) {
      throw new Error("Falta el nombre del paciente. Recarga la pagina e intenta de nuevo.");
    }

    // Validaciones suaves por tipo para evitar envios vacios por error.
    if (tipo === "RECETA") {
      const meds = Array.isArray(specificData.medicamentos) ? specificData.medicamentos : [];
      const validMeds = meds.filter((m) => String(m && m.nombre || "").trim());
      if (validMeds.length === 0) {
        throw new Error("Agrega al menos un medicamento antes de guardar la receta.");
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
      generar_pdf: generarPdf,
      incluir_firma_virtual: shouldIncludeVirtualSignature_(),
      ...specificData,
    };

    const res = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "save_diagnosis_advanced", data: data, requester: requesterDoc }),
    }).then((r) => r.json());

    if (res.success) {
      hasUnsavedChanges = false;
      
      btnClicked.innerHTML = `<i class="fas fa-check"></i> ¡Listo!`;
      btnClicked.style.background = "#27ae60";
      
      if (generarPdf && pdfWindow) {
          const recipeOnlyPdf = tipo === "RECETA" ? String(res.pdf_receta_url || "").trim() : "";
          if (recipeOnlyPdf) {
              pdfWindow.location.href = recipeOnlyPdf;
          } else if (res.pdf_url) {
              pdfWindow.location.href = res.pdf_url;
          } else if (res.pdf_receta_url) {
              pdfWindow.location.href = res.pdf_receta_url;
          } else {
              pdfWindow.close(); // Si no hay link, cerramos la ventana blanca
              alert("Guardado, pero el servidor no devolvió el PDF.");
          }
          setTimeout(() => window.location.href = `clinical.html?id=${currentPatientId}&tab=diagnostico`, 1500);
      } else {
          setTimeout(() => {
             btnClicked.disabled = false;
             btnClicked.innerHTML = originalContent;
             btnClicked.style.background = "";
             alert("Guardado correctamente.");
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
    alert(e && e.message ? e.message : "Error de conexion.");
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
    } else {
        // CERRAR Y BORRAR
        if(confirm("¿Quitar el archivo adjunto?")) {
            if(btn) btn.style.display = "block";
            if(container) container.classList.add("hidden");
            
            // Limpiar input file
            const input = document.getElementById("pdfExternoFile");
            if(input) input.value = "";
            
            // Limpiar visualización de archivo existente
            const existingMsg = document.getElementById("existingPdfMsg");
            if(existingMsg) existingMsg.remove();
            
            // Marcar para borrado en backend
            window.pdfExternoEliminado = true;
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

    fetch(API_URL, {
    method: "POST",
    body: JSON.stringify({ action: "get_data", sheet: "diagnosticos_archivos", requester: getRequesterFromSession() }),
    })
    .then((r) => r.json())
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
      try { data = JSON.parse(report.datos_json); } catch (e) { console.error(e); }

      // 1. Configurar Servicio
      const selector = document.getElementById("reportTypeSelector");
      let serviceValue = resolveReportServiceValue_(data.tipo_examen);
      if (isLegacyColposcopyService_(serviceValue)) {
        ensureSelectorOption_(selector, serviceValue, "COLPOSCOPIA", { color: "#e67e22", fontWeight: "bold" });
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
          if (input) input.value = data.datos_json[key];
        });
      }

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
          if (!src && img.fileId) {
            src = `https://lh3.googleusercontent.com/d/${img.fileId}`; 
          }
          const imgObj = { src: src, title: img.title, fileId: img.fileId };
          if (staticContainer && isLegacyColposcopyService_(serviceValue)) {
            addPhotoSlot(imgObj, "dynamicPhotoContainer");
          } else if (dynamicContainers.length > 0) {
            addPhotoSlot(imgObj, dynamicContainers[0].id);
          }
        });
      }

      // 6. ARCHIVO ADJUNTO (CORRECCIÓN BORRADO)
      if (data.pdf_externo_link) {
        togglePdfModule(true);
        const container = document.getElementById("pdfUploadContainer");
        const oldMsg = document.getElementById("existingPdfMsg");
        if(oldMsg) oldMsg.remove();
        const msg = document.createElement("div");
        msg.id = "existingPdfMsg";
        msg.style.marginTop = "10px";
        msg.style.padding = "10px";
        msg.style.background = "#e8f8f5";
        msg.style.border = "1px solid #2ecc71";
        msg.style.borderRadius = "5px";
        msg.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <a href="${data.pdf_externo_link}" target="_blank" style="color:#27ae60; font-weight:bold; text-decoration:none;">
            <i class="fas fa-file-pdf"></i> Ver Archivo Actual
          </a>
          <button type="button" onclick="togglePdfModule(false)" style="color:red; border:none; background:none; cursor:pointer; font-weight:bold;">
            <i class="fas fa-trash"></i> Eliminar
          </button>
        </div>
        `;
        container.insertBefore(msg, container.firstChild);
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
    window.location.href = 'index.html';
    return;
  }
  fetch(API_URL, {
    method: "POST",
    body: JSON.stringify({ action: "get_data", sheet: "pacientes", requester }),
  })
    .then((r) => r.json())
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

function isRecipeService_(value) {
  const raw = String(value || "").trim();
  return raw.toLowerCase() === "receta" || raw.toUpperCase() === "RECETA";
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

function loadServicesDropdown() {
  const s = document.getElementById("reportTypeSelector");
  if (!s) return Promise.resolve();

  // 1. Limpieza y opciones fijas iniciales
  s.innerHTML = `
      <option value="" selected disabled>-- Seleccione Procedimiento --</option>
      <option value="receta" style="font-weight:bold; color:#27ae60;">📝 RECETA MÉDICA</option>
  `;

  console.log("🔄 Cargando configuración de servicios...");

  // 2. HACEMOS DOS PETICIONES SIMULTÁNEAS (Campos + Títulos/Metadatos)
  // Esto es necesario para tener el Título del Informe listo cuando selecciones
  const requester = getRequesterFromSession();
  const p1 = fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "get_service_config", requester: requester }) }).then(r => r.json());
  const p2 = fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "get_services", requester: requester }) }).then(r => r.json());

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
      const serviciosNuevos = Object.keys(CONFIG_CAMPOS);
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
    const forms = document.querySelectorAll(".report-form, #form-colposcopia, #form-general, #form-receta, #form-dinamico");
    forms.forEach(f => f.classList.add("hidden"));

    // 2. Mostrar el correcto según la selección
    if (isLegacyColposcopyService_(servicio)) {
        document.getElementById("form-colposcopia").classList.remove("hidden");
    } 
    else if (isRecipeService_(servicio)) {
        document.getElementById("form-receta").classList.remove("hidden");
        openUniversalRecipeModuleIfNeeded_();
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
async function saveDynamicService(servicio, generatePdf, btn, recetaData) {
    // 1. Confirmación inicial
    if (generatePdf) {
        const ok = window.appConfirm
          ? await window.appConfirm({
              title: "Generar informe",
              message: "Se guardaran los datos de " + servicio + " y se generara el PDF.\nDeseas continuar?",
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
    
    try {
        // 1. Recolectar datos del formulario dinámico
        const inputs = document.querySelectorAll("#form-dinamico .doc-input");
        const datosDinamicos = {};
        inputs.forEach(inp => {
            const key = inp.id.replace("dyn_", "");
            datosDinamicos[key] = inp.value;
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
            if (imgEl.src.startsWith('data:')) {
              const resizedBase64 = await resizeBase64Image(imgEl.src, 1, size);
              imgs.push({ index: i + 1, title: title, data: resizedBase64, isNew: true, size });
            } else if (existingId) {
              imgs.push({ index: i + 1, title: title, fileId: existingId, isNew: false, size });
            }
          }
        }
        // 3. PDF Externo
        let pdfFile = null;
        if (!document.getElementById("pdfUploadContainer").classList.contains("hidden")) {
             if (typeof getPdfExternoData === 'function') pdfFile = await getPdfExternoData();
        } else {
             if(window.pdfExternoEliminado) {
                 pdfFile = { delete: true }; 
             }
        }

        const dataObj = {
            id_reporte: currentReportId,
            id_paciente: currentPatientId,
            nombre_paciente: document.getElementById("patientNameDisplay").value,
            tipo_examen: servicio,
            generar_pdf: generatePdf,
            incluir_firma_virtual: shouldIncludeVirtualSignature_(),
            datos_json: datosDinamicos, 
            medicamentos: recetaData ? recetaData.medicamentos : [],
            observaciones_receta: recetaData ? recetaData.observaciones_receta : "",
            imagenes: imgs,
            pdf_externo: pdfFile
        };

        let requesterDoc = null; try { const s = sessionStorage.getItem('vidafem_session'); if(s) requesterDoc = JSON.parse(s).data.usuario; } catch(e){}
        const r = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({ action: "save_diagnosis_advanced", data: dataObj, requester: requesterDoc })
        });
        const res = await r.json();

        if(res.success) {
            hasUnsavedChanges = false; 
            btn.innerHTML = '<i class="fas fa-check"></i> OK';
            btn.style.background = "#27ae60";
            
            // SI SE PIDIÓ PDF Y TENEMOS VENTANA ABIERTA
            if(generatePdf && pdfWindow) {
                if(res.pdf_url) {
                    console.log("PDF URL recibida:", res.pdf_url);
                    pdfWindow.location.href = res.pdf_url;
                    setTimeout(() => window.location.href = `clinical.html?id=${currentPatientId}&tab=diagnostico`, 2000);
                } else {
                    pdfWindow.close();
                    alert("⚠️ Aviso: Se guardaron los datos pero el servidor no devolvió el enlace del PDF.");
                    window.location.href = `clinical.html?id=${currentPatientId}&tab=diagnostico`;
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
function getPdfExternoData() {
    return new Promise((resolve) => {
        const input = document.getElementById('pdfExternoFile');
        if (input && input.files && input.files[0]) {
            const file = input.files[0];
            const reader = new FileReader();
            // Convertimos el archivo a texto base64 para enviarlo a Google
            reader.onload = (e) => resolve({ 
                name: file.name, 
                mime: file.type, 
                data: e.target.result 
            });
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        } else {
            resolve(null); // No hay archivo
        }
    });
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
