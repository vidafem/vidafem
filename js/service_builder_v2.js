(function () {
  "use strict";

  var TEMPLATE_URL = "admin_service_builder.html";
  var PAGE_WIDTH = 794;
  var mounted = false;
  var pendingOpen = null;
  var isDirty = false;
  var scopeChoiceResolver = null;
  var scopeHookInstalled = false;

  var els = {};

  function qs(id) {
    return document.getElementById(id);
  }

  function getRequester() {
    if (typeof window.getRequesterFromSession === "function") {
      return window.getRequesterFromSession();
    }
    try {
      var raw = sessionStorage.getItem("vidafem_session");
      if (!raw) return null;
      var s = JSON.parse(raw);
      return s && s.data
        ? s.data.usuario || s.data.usuario_doctor || s.data.nombre_doctor || null
        : null;
    } catch (e) {
      return null;
    }
  }

  function installScopeHook() {
    if (scopeHookInstalled) return;
    var previousChoose = window.chooseServiceScope;
    window.chooseServiceScope = function (scope) {
      if (scopeChoiceResolver) {
        var resolve = scopeChoiceResolver;
        scopeChoiceResolver = null;
        resolve(scope || null);
        if (typeof window.closeModal === "function") window.closeModal("modalServiceScopeChoice");
        return;
      }
      if (typeof previousChoose === "function") {
        return previousChoose(scope);
      }
    };
    scopeHookInstalled = true;
  }

  function askScopeOnCreate() {
    var modal = qs("modalServiceScopeChoice");
    if (modal) {
      installScopeHook();
      return new Promise(function (resolve) {
        scopeChoiceResolver = resolve;
        if (typeof window.openModal === "function") window.openModal("modalServiceScopeChoice");
        else modal.classList.add("active");
      });
    }
    var forAll = confirm("Guardar para todos? Aceptar = todos, Cancelar = solo para mi.");
    return Promise.resolve(forAll ? "ALL" : "OWNER");
  }

  function markHideables(view) {
    if (!view) return;
    var nodes = view.querySelectorAll(".card, .section-title");
    nodes.forEach(function (n) {
      n.classList.add("sbv2-hide-when-open");
    });
  }

  function ensureMounted() {
    if (mounted) return;
    fetch(TEMPLATE_URL)
      .then(function (r) {
        return r.text();
      })
      .then(function (html) {
        var view = qs("view-services");
        if (!view) return;
        var wrapper = document.createElement("div");
        wrapper.innerHTML = html;
        view.appendChild(wrapper);
        mounted = true;
        cacheEls();
        bindEvents();
        markHideables(view);
        if (pendingOpen !== null) {
          openPanel(pendingOpen);
          pendingOpen = null;
        }
      })
      .catch(function (e) {
        console.error("No se pudo cargar el builder v2", e);
      });
  }

  function cacheEls() {
    els.panel = qs("serviceBuilderV2Panel");
    els.view = qs("view-services");
    els.name = qs("sbv2ServiceName");
    els.title = qs("sbv2ReportTitleInput");
    els.recs = qs("sbv2ServiceRecs");
    els.duration = qs("sbv2DurationMinutes");
    els.original = qs("sbv2ServiceOriginalName");
    els.fields = qs("sbv2FieldsContainer");
    els.addBtn = qs("sbv2AddFieldBtn");
    els.saveBtn = qs("sbv2SaveBtn");
    els.deleteBtn = qs("sbv2DeleteBtn");
    els.closeBtn = qs("sbv2CloseBtn");
    els.previewTitle = qs("sbv2ReportTitle");
    els.previewFields = qs("sbv2PreviewFields");
    els.previewRecs = qs("sbv2PreviewRecs");
    els.page = qs("sbv2Page");
  }

  function bindEvents() {
    if (!els.panel) return;

    els.addBtn.addEventListener("click", function () {
      addFieldRow();
      setDirty(true);
      renderPreview();
    });

    els.fields.addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      var row = btn.closest(".sbv2-field-row");
      if (!row) return;

      if (btn.dataset.action === "remove") {
        row.remove();
        setDirty(true);
        renderPreview();
      } else if (btn.dataset.action === "move-up") {
        if (row.previousElementSibling) {
          row.parentElement.insertBefore(row, row.previousElementSibling);
          setDirty(true);
          renderPreview();
        }
      } else if (btn.dataset.action === "move-down") {
        if (row.nextElementSibling) {
          row.parentElement.insertBefore(row.nextElementSibling, row);
          setDirty(true);
          renderPreview();
        }
      }
    });

    els.fields.addEventListener("input", function (e) {
      if (e.target.classList.contains("sbv2-field-label")) {
        setDirty(true);
        renderPreview();
      }
      if (e.target.classList.contains("sbv2-field-options-input")) {
        setDirty(true);
        renderPreview();
      }
    });

    els.fields.addEventListener("change", function (e) {
      if (e.target.classList.contains("sbv2-field-type")) {
        toggleOptions(e.target);
        setDirty(true);
        renderPreview();
      }
    });

    [els.name, els.title, els.recs, els.duration].forEach(function (el) {
      if (!el) return;
      el.addEventListener("input", function () {
        setDirty(true);
        renderPreview();
      });
      el.addEventListener("change", function () {
        setDirty(true);
        renderPreview();
      });
    });

    els.saveBtn.addEventListener("click", saveService);
    els.deleteBtn.addEventListener("click", deleteService);
    els.closeBtn.addEventListener("click", function () {
      requestClose();
    });

  }

  function openPanel(existingService) {
    if (!els.panel || !els.view) return;
    resetForm();

    if (existingService) {
      els.original.value = existingService.nombre_servicio || "";
      els.name.value = existingService.nombre_servicio || "";
      els.title.value = existingService.titulo_reporte || "";
      els.recs.value = existingService.recomendaciones || "";
      if (els.duration) {
        els.duration.value = String(existingService.duracion_minutos || 30);
      }
      els.deleteBtn.style.display = "inline-flex";

      fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "get_service_config", requester: getRequester() }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (res) {
          if (res.success && res.data) {
            var config = res.data[existingService.nombre_servicio];
            if (Array.isArray(config)) {
              config.forEach(function (c) {
                addFieldRow(c.nombre, c.etiqueta, c.tipo, c.opciones);
              });
              renderPreview();
            }
          }
        });
    } else {
      addFieldRow();
    }

    setDirty(false);
    els.view.classList.add("sbv2-open");
    els.panel.setAttribute("aria-hidden", "false");
    renderPreview();
  }

  function closePanel() {
    if (!els.panel || !els.view) return;
    els.view.classList.remove("sbv2-open");
    els.panel.setAttribute("aria-hidden", "true");
  }

  function requestClose() {
    if (!isDirty) {
      closePanel();
      return;
    }
    var ok = confirm("Tienes cambios sin guardar. ¿Deseas cerrar sin guardar?");
    if (ok) closePanel();
  }

  function resetForm() {
    els.fields.innerHTML = "";
    els.original.value = "";
    els.name.value = "";
    els.title.value = "";
    els.recs.value = "";
    if (els.duration) els.duration.value = "30";
    els.deleteBtn.style.display = "none";
  }

  function addFieldRow(nombre, etiqueta, tipo, opciones) {
    var row = document.createElement("div");
    row.className = "sbv2-field-row";
    var labelVal = etiqueta || "";
    var typeVal = tipo || "texto";
    var optionsVal = opciones || "";

    row.innerHTML =
      '<div class="sbv2-field-actions">' +
      '<button type="button" class="sbv2-btn sbv2-btn-ghost" data-action="move-up" title="Mover arriba">' +
      '<i class="fas fa-chevron-up"></i>' +
      "</button>" +
      '<button type="button" class="sbv2-btn sbv2-btn-ghost" data-action="move-down" title="Mover abajo">' +
      '<i class="fas fa-chevron-down"></i>' +
      "</button>" +
      '<button type="button" class="sbv2-btn sbv2-btn-ghost" data-action="remove" title="Eliminar">' +
      '<i class="fas fa-times"></i>' +
      "</button>" +
      "</div>" +
      '<div class="sbv2-field-main">' +
      '<input type="text" class="sbv2-field-label" placeholder="Nombre del Campo (Ej: Tipo de Sangre)" value="' +
      escapeHtml(labelVal) +
      '">' +
      '<select class="sbv2-field-type">' +
      optionHtml(typeVal) +
      "</select>" +
      "</div>" +
      '<div class="sbv2-field-options">' +
      '<input type="text" class="sbv2-field-options-input" placeholder="Opciones separadas por coma" value="' +
      escapeHtml(optionsVal) +
      '">' +
      "<small>* Escribe las opciones separadas por comas.</small>" +
      "</div>";

    if (typeVal === "select") row.classList.add("sbv2-options-active");
    els.fields.appendChild(row);
  }

  function optionHtml(typeVal) {
    return [
      option("texto", "Texto Corto", typeVal),
      option("parrafo", "Parrafo", typeVal),
      option("numero", "Numero", typeVal),
      option("select", "Lista Desplegable", typeVal),
      option("imagenes", "Galeria Fotos", typeVal),
      option("titulo", "-- Titulo Seccion --", typeVal),
    ].join("");
  }

  function option(value, label, selected) {
    return (
      '<option value="' +
      value +
      '"' +
      (value === selected ? " selected" : "") +
      ">" +
      label +
      "</option>"
    );
  }

  function toggleOptions(select) {
    var row = select.closest(".sbv2-field-row");
    if (!row) return;
    if (select.value === "select") row.classList.add("sbv2-options-active");
    else row.classList.remove("sbv2-options-active");
  }

  function renderPreview() {
    if (!els.previewFields) return;
    var title = (els.title.value || "").trim();
    els.previewTitle.textContent = title || "TITULO DEL INFORME";

    var fields = collectFields();
    if (!fields.length) {
      els.previewFields.innerHTML =
        '<div style="color:#777;">Sin campos configurados.</div>';
    } else {
      els.previewFields.innerHTML = fields
        .map(function (f) {
          if (f.type === "titulo") {
            return (
              '<div class="sbv2-section-title">' +
              escapeHtml(f.label) +
              "</div>"
            );
          }

          var valueHtml = "";
          if (f.type === "parrafo") {
            valueHtml = '<div class="sbv2-field-value-box"></div>';
          } else if (f.type === "select") {
            var opts = f.options.length ? f.options : ["Opcion 1", "Opcion 2"];
            valueHtml =
              '<div class="sbv2-field-select-options">' +
              opts.slice(0, 4).map(function (o) {
                return "<span>" + escapeHtml(o) + "</span>";
              }).join("") +
              "</div>";
          } else if (f.type === "imagenes") {
            valueHtml =
              '<div class="sbv2-field-images"><div></div><div></div><div></div></div>';
          } else {
            valueHtml = '<div class="sbv2-field-value-line"></div>';
          }

          return (
            '<div class="sbv2-field-preview">' +
            '<div class="sbv2-field-name">' +
            escapeHtml(f.label) +
            "</div>" +
            "<div>" +
            valueHtml +
            "</div>" +
            "</div>"
          );
        })
        .join("");
    }

    // Las recomendaciones automáticas son para agenda/correo/WhatsApp,
    // no forman parte del cuerpo del informe en la previsualización.
    if (els.previewRecs) {
      els.previewRecs.innerHTML = "";
      els.previewRecs.style.display = "none";
    }
  }

  function collectFields() {
    var rows = els.fields.querySelectorAll(".sbv2-field-row");
    var list = [];
    rows.forEach(function (row) {
      var label = row.querySelector(".sbv2-field-label").value.trim();
      var type = row.querySelector(".sbv2-field-type").value;
      var optionsRaw = row.querySelector(".sbv2-field-options-input").value || "";
      var options = optionsRaw
        .split(",")
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);

      if (!label && type !== "titulo") return;
      list.push({
        label: label || "Titulo",
        type: type,
        options: options,
      });
    });
    return list;
  }

  function saveService() {
    var name = els.name.value.trim();
    if (!name) {
      alert("El nombre del servicio es obligatorio.");
      return;
    }

    var requester = getRequester();
    var oldText = els.saveBtn.innerText;
    els.saveBtn.disabled = true;
    els.saveBtn.innerText = "Guardando...";

    var scopePromise = askScopeOnCreate();

    scopePromise
      .then(function (scopeVisibility) {
        if (!scopeVisibility) {
          throw { cancelled: true };
        }

        var payload = {
          originalName: els.original.value,
          nombre_servicio: name,
          titulo_reporte: els.title.value.trim(),
          recomendaciones: els.recs.value.trim(),
          duracion_minutos: Number((els.duration && els.duration.value) || 30),
          campos: buildCampos(),
          scope_visibility: scopeVisibility,
        };

        return fetch(API_URL, {
          method: "POST",
          body: JSON.stringify({
            action: "save_service_full",
            requester: requester,
            data: payload,
          }),
        }).then(function (r) {
          return r.json();
        });
      })
      .then(function (res) {
        if (!res) return;
        if (res.success) {
          alert("Servicio guardado correctamente.");
          setDirty(false);
          closePanel();
          if (typeof loadServicesAdmin === "function") loadServicesAdmin();
        } else {
          alert("Error: " + res.message);
        }
      })
      .catch(function (err) {
        if (err && err.cancelled) return;
        alert("Error guardando servicio.");
      })
      .finally(function () {
        els.saveBtn.disabled = false;
        els.saveBtn.innerText = oldText;
      });
  }

  function deleteService() {
    var name = els.original.value.trim() || els.name.value.trim();
    if (!name) return;
    if (!confirm("Eliminar servicio '" + name + "'?")) return;

    fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "delete_service_full", nombre: name, requester: getRequester() }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (res) {
        if (res.success) {
          alert("Eliminado.");
          setDirty(false);
          closePanel();
          if (typeof loadServicesAdmin === "function") loadServicesAdmin();
        } else {
          alert("Error: " + res.message);
        }
      });
  }

  function buildCampos() {
    var campos = [];
    var fields = collectFields();
    fields.forEach(function (f) {
      var nombreInterno = toKey(f.label);
      if (f.type === "titulo") {
        nombreInterno =
          "titulo_" + Math.random().toString(36).slice(2, 7);
      }
      campos.push({
        nombre: nombreInterno,
        etiqueta: f.label,
        tipo: f.type,
        opciones: (f.options || []).join(", "),
      });
    });
    return campos;
  }

  function toKey(label) {
    var s = (label || "").trim().toLowerCase();
    if (s.normalize) {
      s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }
    s = s.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!s) {
      s = "campo_" + Math.random().toString(36).slice(2, 7);
    }
    return s;
  }

  function setDirty(next) {
    isDirty = !!next;
  }


  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  window.openServiceBuilder = function (existingService) {
    if (!mounted) {
      pendingOpen = existingService || null;
      ensureMounted();
      return;
    }
    openPanel(existingService || null);
  };

  ensureMounted();
})();
