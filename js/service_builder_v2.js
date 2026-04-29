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

  function getSessionToken() {
    if (typeof window.getSessionToken === "function") {
      return window.getSessionToken() || "";
    }
    try {
      var raw = sessionStorage.getItem("vidafem_session");
      if (!raw) return "";
      var s = JSON.parse(raw);
      return s && s.session_token ? String(s.session_token) : "";
    } catch (e) {
      return "";
    }
  }

  function postServiceApi(payload) {
    var body = Object.assign({}, payload || {});
    if (!body.session_token) {
      var token = String(getSessionToken() || "").trim();
      if (token) body.session_token = token;
    }
    return fetch(API_URL, {
      method: "POST",
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json();
    });
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
  
  // --- GESTIÓN DE CHIPS (CUADRITOS) DE ANTECEDENTES G.O. ---
  window.addAgoChip = function(btn) {
      var row = btn.closest('.sbv2-field-row');
      var select = row.querySelector('.ago-add-select');
      var container = row.querySelector('.ago-chips-container');
      var hiddenInput = row.querySelector('.sbv2-ago-data');
      if (!select || !container || !hiddenInput) return;
      var key = select.value;
      var defaultLabel = select.options[select.selectedIndex].text;
      if (container.querySelector('[data-key="'+key+'"]')) { alert("Este campo ya está agregado."); return; }
      var chip = document.createElement('div');
      chip.className = "ago-chip";
      chip.dataset.key = key;
      chip.style.cssText = "display:flex; align-items:center; background:#eef2f6; border:1px solid #cbd5e1; border-radius:16px; padding:4px 10px; font-size:0.85rem;";
      chip.innerHTML = '<input type="text" value="' + escapeHtml(defaultLabel) + '" oninput="window.updateAgoData(this)" style="border:none; background:transparent; width:80px; font-size:0.85rem; color:#334155; outline:none; font-weight:600;"><button type="button" onclick="window.removeAgoChip(this)" style="background:none; border:none; color:#e74c3c; cursor:pointer; margin-left:6px; font-weight:bold; font-size:1.1rem; line-height:1;">&times;</button>';
      container.appendChild(chip);
      window.updateAgoData(chip.querySelector('input'));
  };
  window.removeAgoChip = function(btn) {
      var chip = btn.closest('.ago-chip');
      var input = chip.querySelector('input');
      chip.remove();
      window.updateAgoData(input); 
  };
  window.updateAgoData = function(el) {
      var row = el ? el.closest('.sbv2-field-row') : null;
      if (!row) return;
      var container = row.querySelector('.ago-chips-container');
      var hiddenInput = row.querySelector('.sbv2-ago-data');
      var parts = [];
      container.querySelectorAll('.ago-chip').forEach(function(chip) { var k = chip.dataset.key; var l = chip.querySelector('input').value.trim() || k; parts.push(k + ":" + l); });
      hiddenInput.value = parts.join("|||");
      hiddenInput.dispatchEvent(new Event('input', {bubbles: true}));
  };

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

      const loadConfigPromise = (window.vfDataBridge && window.vfDataBridge.getServiceConfig)
        ? window.vfDataBridge.getServiceConfig(getRequester())
        : postServiceApi({ action: "get_service_config", requester: getRequester() });
      loadConfigPromise
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
    var keyVal = String(nombre || "").trim();
    var labelVal = etiqueta || "";
    var typeVal = tipo || "texto";
    var optionsVal = opciones || "";

    var thVal = "EXAMEN, RESULTADO, UNIDAD, V. REFERENCIA";
    var toVal = "DETECTADO, NO DETECTADO";
    var trVal = "";
    var normalOptionsVal = optionsVal;
    var agoOptionsVal = "";

    if (typeVal === "tabla_resultados" && optionsVal) {
      var parts = optionsVal.split("|||");
      thVal = parts[0] ? parts[0].trim() : thVal;
      toVal = parts[1] ? parts[1].trim() : toVal;
      trVal = parts[2] ? parts[2].trim() : trVal;
      normalOptionsVal = "";
    } else if (typeVal === "antecedentes_go" && optionsVal) {
      agoOptionsVal = optionsVal;
      normalOptionsVal = "";
    }

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
      '<input type="hidden" class="sbv2-field-name" value="' +
      escapeHtml(keyVal) +
      '">' +
      '<input type="text" class="sbv2-field-label" placeholder="Nombre del Campo (Ej: Tipo de Sangre)" value="' +
      escapeHtml(labelVal) +
      '">' +
      '<select class="sbv2-field-type">' +
      optionHtml(typeVal) +
      "</select>" +
      "</div>" +
      '<div class="sbv2-field-options sbv2-options-normal" ' + (typeVal === "tabla_resultados" ? 'style="display:none;"' : '') + '>' +
      '<input type="text" class="sbv2-field-options-input" placeholder="Opciones separadas por coma" value="' +
      escapeHtml(normalOptionsVal) +
      '">' +
      "<small>* Escribe las opciones separadas por comas.</small>" +
      "</div>" +
      '<div class="sbv2-field-options sbv2-options-table" ' + (typeVal === "tabla_resultados" ? '' : 'style="display:none;"') + ' style="background:#f4f6f9; padding:12px; border-radius:8px; margin-top:8px;">' +
      '<label style="font-size:0.8rem; font-weight:bold; color:#2c3e50; display:block; margin-bottom:4px;">Columnas (separadas por coma):</label>' +
      '<input type="text" class="sbv2-table-headers sbv2-input" placeholder="Ej: EXAMEN, RESULTADO, UNIDAD, V. REFERENCIA" value="' + escapeHtml(thVal) + '" style="margin-bottom:10px;">' +
      '<label style="font-size:0.8rem; font-weight:bold; color:#2c3e50; display:block; margin-bottom:4px;">Opciones de Resultado (separadas por coma):</label>' +
      '<input type="text" class="sbv2-table-opts sbv2-input" placeholder="Ej: DETECTADO, NO DETECTADO" value="' + escapeHtml(toVal) + '" style="margin-bottom:10px;">' +
      '<label style="font-size:0.8rem; font-weight:bold; color:#2c3e50; display:block; margin-bottom:4px;">Exámenes a evaluar (uno por línea o separados por coma):</label>' +
      '<textarea class="sbv2-table-rows sbv2-textarea" placeholder="Ej: Herpes Simplex Virus-1, VIH, Sífilis" rows="3">' + escapeHtml(trVal) + '</textarea>' +
      "</div>" +
      '<div class="sbv2-field-options sbv2-options-ago" ' + (typeVal === "antecedentes_go" ? '' : 'style="display:none;"') + ' style="background:#f4f6f9; padding:12px; border-radius:8px; margin-top:8px;">' +
      '<label style="font-size:0.8rem; font-weight:bold; color:#2c3e50; display:block; margin-bottom:4px;">Campos a incluir (Modifica el título o borra los que no necesites):</label>' +
      '<div class="ago-chips-container" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; min-height:38px; border:1px dashed #cbd5e1; padding:8px; border-radius:6px; background:#fff;"></div>' +
      '<div style="display:flex; gap:5px; align-items:center;">' +
      '<select class="ago-add-select sbv2-input" style="flex:1;">' +
      '<option value="menarquia">Menarquia</option><option value="prs">PRS</option>' +
      '<option value="num_parejas">N° Parejas</option><option value="ago_g">Gestas (G)</option>' +
      '<option value="ago_p">Partos (P)</option><option value="ago_c">Cesáreas (C)</option>' +
      '<option value="ago_a">Abortos (A)</option><option value="fecha_aborto">Fecha Aborto / Últ.</option>' +
      '<option value="pap">PAP</option><option value="fum">FUM</option>' +
      '<option value="anticonceptivos">Anticonceptivos</option><option value="tipo_anti">Tipo Anticonceptivo</option>' +
      '<option value="tiempo_uso">Tiempo Uso</option><option value="ante_its">Ante. ITS</option>' +
      '<option value="tipo_its">Tipo ITS</option>' +
      '</select>' +
      '<button type="button" class="sbv2-btn" onclick="window.addAgoChip(this)" style="background:#3498db; color:white;">Agregar</button>' +
      '</div>' +
      '<input type="hidden" class="sbv2-ago-data" value="' + escapeHtml(agoOptionsVal) + '">' +
      "</div>";

    if (typeVal === "select" || typeVal === "casillas_opciones" || typeVal === "tabla_resultados" || typeVal === "antecedentes_go") row.classList.add("sbv2-options-active");
    els.fields.appendChild(row);

    if (typeVal === "antecedentes_go" && agoOptionsVal) {
        var container = row.querySelector('.ago-chips-container');
        agoOptionsVal.split('|||').forEach(function(part) {
            var p = part.split(':'); var k = p[0]; var l = p[1] || k; if(!k) return;
            var chip = document.createElement('div');
            chip.className = "ago-chip"; chip.dataset.key = k;
            chip.style.cssText = "display:flex; align-items:center; background:#eef2f6; border:1px solid #cbd5e1; border-radius:16px; padding:4px 10px; font-size:0.85rem;";
            chip.innerHTML = '<input type="text" value="' + escapeHtml(l) + '" oninput="window.updateAgoData(this)" style="border:none; background:transparent; width:80px; font-size:0.85rem; color:#334155; outline:none; font-weight:600;"><button type="button" onclick="window.removeAgoChip(this)" style="background:none; border:none; color:#e74c3c; cursor:pointer; margin-left:6px; font-weight:bold; font-size:1.1rem; line-height:1;">&times;</button>';
            container.appendChild(chip);
        });
    }
  }

  function optionHtml(typeVal) {
    return [
      option("texto", "Texto Corto", typeVal),
      option("parrafo", "Parrafo", typeVal),
      option("numero", "Número", typeVal),
      option("select", "Lista Desplegable", typeVal),
      option("casillas_opciones", "Casillas opciones", typeVal),
      option("imagenes", "Galería de fotos", typeVal),
      option("tabla_resultados", "Panel de Resultados (Tabla)", typeVal),
      option("antecedentes_go", "Antecedentes Gineco-Obstétricos", typeVal),
      option("titulo", "-- Título de sección --", typeVal),
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
    var normalOpts = row.querySelector(".sbv2-options-normal");
    var tableOpts = row.querySelector(".sbv2-options-table");
    var agoOpts = row.querySelector(".sbv2-options-ago");

    if (select.value === "tabla_resultados") {
        row.classList.add("sbv2-options-active");
        if (normalOpts) normalOpts.style.display = "none";
        if (tableOpts) tableOpts.style.display = "block";
        if (agoOpts) agoOpts.style.display = "none";
    } else if (select.value === "antecedentes_go") {
        row.classList.add("sbv2-options-active");
        if (normalOpts) normalOpts.style.display = "none";
        if (tableOpts) tableOpts.style.display = "none";
        if (agoOpts) agoOpts.style.display = "block";
    } else if (select.value === "select" || select.value === "casillas_opciones") {
        row.classList.add("sbv2-options-active");
        if (normalOpts) normalOpts.style.display = "block";
        if (tableOpts) tableOpts.style.display = "none";
        if (agoOpts) agoOpts.style.display = "none";
    } else {
        row.classList.remove("sbv2-options-active");
    }
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
          } else if (f.type === "select" || f.type === "casillas_opciones") {
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
          } else if (f.type === "tabla_resultados") {
            valueHtml = '<div style="background:#f0f4f8; padding:10px; border-radius:4px; font-size:10px; border:1px dashed #cbd5e1; color:#64748b;">[ TABLA DE EXÁMENES ]</div>';
          } else if (f.type === "antecedentes_go") {
            valueHtml = '<div style="background:#fdfdfe; padding:10px; border-radius:4px; font-size:10px; border:1px dashed #cbd5e1; color:#64748b;">[ BLOQUE ANTECEDENTES G.O. AUTO-RECARGADO ]</div>';
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
      var internalNameInput = row.querySelector(".sbv2-field-name");
      var internalName = internalNameInput ? String(internalNameInput.value || "").trim() : "";
      var label = row.querySelector(".sbv2-field-label").value.trim();
      var type = row.querySelector(".sbv2-field-type").value;
      var optionsRaw = "";

      if (type === "tabla_resultados") {
          var th = row.querySelector(".sbv2-table-headers").value || "EXAMEN, RESULTADO, UNIDAD, V. REFERENCIA";
          var to = row.querySelector(".sbv2-table-opts").value || "DETECTADO, NO DETECTADO";
          var tr = row.querySelector(".sbv2-table-rows").value || "";
          optionsRaw = th + "|||" + to + "|||" + tr;
      } else if (type === "antecedentes_go") {
          var agoInp = row.querySelector(".sbv2-ago-data");
          optionsRaw = agoInp ? agoInp.value : "";
      } else {
          var normalInp = row.querySelector(".sbv2-field-options-input");
          optionsRaw = normalInp ? normalInp.value : "";
      }

      var options = (type === "tabla_resultados" || type === "antecedentes_go")
          ? [optionsRaw] 
          : optionsRaw.split(",").map(function (s) {
              return s.trim();
            }).filter(Boolean);

      if (!label && type !== "titulo") return;
      list.push({
        name: internalName,
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

        return postServiceApi({
          action: "save_service_full",
          requester: requester,
          data: payload,
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

    postServiceApi({ action: "delete_service_full", nombre: name, requester: getRequester() })
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
      var nombreInterno = String(f.name || "").trim();
      if (!nombreInterno) {
        nombreInterno = toKey(f.label);
      }
      if (f.type === "titulo" && !nombreInterno) {
        nombreInterno = "titulo_" + Math.random().toString(36).slice(2, 7);
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
