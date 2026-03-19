// js/config.js
// Configuracion global de conexion

const API_URL = "https://script.google.com/macros/s/AKfycbxqXxfIonXV7JiiisTjYR__wuz70qc81gZ6qsSn5ZExtwuPxTRoN3X8r-uIw0nHrlvIfA/exec";

const MESSAGES = {
  loading: "Verificando credenciales...",
  error: "Error de conexion con el servidor.",
  success: "Bienvenido a VIDAFEM!"
};

function getSessionToken_() {
  try {
    const raw = sessionStorage.getItem("vidafem_session");
    if (!raw) return "";
    const session = JSON.parse(raw);
    return String((session && session.session_token) || "").trim();
  } catch (e) {
    return "";
  }
}

window.getSessionToken = getSessionToken_;

window.apiLogoutSession = async function apiLogoutSession() {
  try {
    const token = getSessionToken_();
    if (!token) return { success: true };
    const r = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "logout", session_token: token })
    });
    const j = await r.json();
    return j || { success: true };
  } catch (e) {
    return { success: false, message: String(e || "") };
  }
};

// Inyecta session_token automaticamente para peticiones POST al API.
(function patchApiFetchWithSessionToken_() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  if (window.__vfFetchSessionPatchApplied) return;
  window.__vfFetchSessionPatchApplied = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    try {
      const requestUrl = typeof input === "string"
        ? input
        : (input && input.url ? String(input.url) : "");
      const url = String(requestUrl || "");
      const isApiCall = !!API_URL && url.indexOf(API_URL) === 0;

      const opts = init ? Object.assign({}, init) : {};
      const method = String((opts.method || "GET")).toUpperCase();

      if (isApiCall && method === "POST" && typeof opts.body === "string" && opts.body) {
        const payload = JSON.parse(opts.body);
        if (payload && typeof payload === "object" && payload.action !== "login" && !payload.session_token) {
          const token = getSessionToken_();
          if (token) {
            payload.session_token = token;
            opts.body = JSON.stringify(payload);
          }
        }
      }

      return originalFetch(input, opts);
    } catch (e) {
      return originalFetch(input, init);
    }
  };
})();

// Toast global en pantalla (reemplaza alerts en flujos criticos)
(function initGlobalToast() {
  if (window.showToast) return;

  let toastEl = null;
  let hideTimer = null;

  function ensureToast() {
    if (toastEl) return;

    const style = document.createElement("style");
    style.type = "text/css";
    style.textContent = [
      "#appToast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:4600;max-width:min(92vw,560px);",
      "background:#2d2a3a;color:#fff;padding:12px 16px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.25);",
      "font-size:.95rem;display:none;line-height:1.35;}",
      "#appToast.show{display:block;}",
      "#appToast.success{background:#2e7d32;}",
      "#appToast.error{background:#c62828;}",
      "#appToast.warning{background:#ef6c00;}",
      "#appToast.info{background:#2d2a3a;}"
    ].join("");
    document.head.appendChild(style);

    toastEl = document.createElement("div");
    toastEl.id = "appToast";
    document.body.appendChild(toastEl);
  }

  window.showToast = function showToast(message, type, ms) {
    ensureToast();
    toastEl.className = "";
    toastEl.id = "appToast";
    toastEl.textContent = message || "";
    toastEl.classList.add("show", type || "info");
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, ms || 2400);
  };
})();

// Select movil: usa un panel propio para listas largas y evita overflow
(function initMobileSelectOverlay() {
  function isMobile() {
    return window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
  }

  let overlay = null;
  let overlayTitle = null;
  let overlayList = null;
  let activeSelect = null;

  function ensureOverlay() {
    if (overlay) return;

    const style = document.createElement("style");
    style.type = "text/css";
    style.textContent = [
      "#mobileSelectOverlay{position:fixed;inset:0;z-index:4300;display:none;background:rgba(0,0,0,.45);}",
      "#mobileSelectOverlay.active{display:flex;align-items:flex-end;justify-content:center;}",
      "#mobileSelectPanel{width:100%;max-width:540px;background:#fff;border-radius:16px 16px 0 0;box-shadow:0 -12px 30px rgba(0,0,0,.25);padding:14px 16px 10px;}",
      "#mobileSelectHeader{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}",
      "#mobileSelectHeader h4{margin:0;font-size:1rem;color:#36235d;}",
      "#mobileSelectClose{border:none;background:#f2f2f2;border-radius:10px;padding:6px 10px;font-size:.9rem;cursor:pointer;}",
      "#mobileSelectList{max-height:70vh;overflow:auto;border:1px solid #eee;border-radius:12px;}",
      "#mobileSelectList button{width:100%;text-align:left;border:none;background:#fff;padding:10px 12px;font-size:.95rem;border-bottom:1px solid #f3f3f3;cursor:pointer;}",
      "#mobileSelectList button:last-child{border-bottom:none;}",
      "#mobileSelectList button[disabled]{color:#aaa;cursor:default;}",
      "#mobileSelectList button.active{background:#f5f1fb;color:#36235d;font-weight:600;}",
      "body.mobile-select-lock{overflow:hidden;}"
    ].join("");
    document.head.appendChild(style);

    overlay = document.createElement("div");
    overlay.id = "mobileSelectOverlay";

    const panel = document.createElement("div");
    panel.id = "mobileSelectPanel";

    const header = document.createElement("div");
    header.id = "mobileSelectHeader";

    overlayTitle = document.createElement("h4");
    overlayTitle.textContent = "Selecciona una opcion";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.id = "mobileSelectClose";
    closeBtn.textContent = "Cerrar";
    closeBtn.addEventListener("click", closeOverlay);

    header.appendChild(overlayTitle);
    header.appendChild(closeBtn);

    overlayList = document.createElement("div");
    overlayList.id = "mobileSelectList";

    panel.appendChild(header);
    panel.appendChild(overlayList);
    overlay.appendChild(panel);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeOverlay();
    });

    document.body.appendChild(overlay);
  }

  function getSelectLabel(select) {
    let label = "";
    const id = select.getAttribute("id");
    if (id) {
      const l = document.querySelector("label[for='" + id + "']");
      if (l) label = l.innerText.trim();
    }
    if (!label) {
      const group = select.closest(".form-group");
      if (group) {
        const gl = group.querySelector("label");
        if (gl) label = gl.innerText.trim();
      }
    }
    return label || "Selecciona una opcion";
  }

  function closeOverlay() {
    if (!overlay) return;
    overlay.classList.remove("active");
    document.body.classList.remove("mobile-select-lock");
    activeSelect = null;
  }

  function openOverlay(select) {
    if (!select || select.disabled || select.multiple) return;
    if (!isMobile()) return;

    ensureOverlay();

    activeSelect = select;
    overlayTitle.textContent = getSelectLabel(select);
    overlayList.innerHTML = "";

    Array.prototype.forEach.call(select.options || [], function (opt) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = opt.textContent;
      if (opt.disabled) btn.disabled = true;
      if (opt.value === select.value) btn.classList.add("active");
      btn.addEventListener("click", function () {
        if (opt.disabled) return;
        select.value = opt.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        closeOverlay();
      });
      overlayList.appendChild(btn);
    });

    overlay.classList.add("active");
    document.body.classList.add("mobile-select-lock");
    try { select.blur(); } catch (e) {}
  }

  function shouldHandle(target) {
    if (!target || target.tagName !== "SELECT") return false;
    if (target.disabled || target.multiple) return false;
    if (target.dataset && target.dataset.noMobileSelect === "1") return false;
    return true;
  }

  function handleSelectActivate(e) {
    if (!isMobile()) return;
    const target = e.target;
    if (!shouldHandle(target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    openOverlay(target);
  }

  document.addEventListener("pointerdown", handleSelectActivate, true);
  document.addEventListener("touchstart", handleSelectActivate, { capture: true, passive: false });
  document.addEventListener("mousedown", handleSelectActivate, true);
  document.addEventListener("focusin", handleSelectActivate, true);
  document.addEventListener("keydown", function (e) {
    if ((e.key !== "Enter" && e.key !== " ") || !shouldHandle(e.target) || !isMobile()) return;
    e.preventDefault();
    openOverlay(e.target);
  }, true);

  document.addEventListener("change", function (e) {
    if (activeSelect && e.target === activeSelect) closeOverlay();
  });

  window.addEventListener("resize", function () {
    if (!isMobile()) closeOverlay();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeOverlay();
  });
})();

// Globito de ayuda no invasivo para campos con formato esperado.
// Uso: agrega data-format-hint="Tu mensaje" a inputs/select/textarea.
(function initFieldHintBubble() {
  let bubble = null;
  let hideTimer = null;
  let activeEl = null;

  function ensureBubble() {
    if (bubble) return;

    const style = document.createElement("style");
    style.type = "text/css";
    style.textContent = [
      ".vf-hint-bubble{position:fixed;z-index:4900;max-width:min(86vw,340px);",
      "background:#b01833;color:#fff;padding:8px 12px;border-radius:10px;",
      "font-size:.82rem;line-height:1.25;box-shadow:0 8px 20px rgba(0,0,0,.25);",
      "opacity:0;transform:translateY(6px) scale(.98);transition:opacity .16s ease,transform .16s ease;",
      "pointer-events:none;font-weight:600;}",
      ".vf-hint-bubble.show{opacity:1;transform:translateY(0) scale(1);}",
      ".vf-hint-bubble::after{content:'';position:absolute;width:0;height:0;}",
      ".vf-hint-bubble.above::after{left:22px;bottom:-8px;border-left:8px solid transparent;border-right:8px solid transparent;border-top:8px solid #b01833;}",
      ".vf-hint-bubble.below::after{left:22px;top:-8px;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:8px solid #b01833;}"
    ].join("");
    document.head.appendChild(style);

    bubble = document.createElement("div");
    bubble.className = "vf-hint-bubble";
    document.body.appendChild(bubble);
  }

  function hintTarget(node) {
    if (!node || !node.closest) return null;
    return node.closest("input[data-format-hint], textarea[data-format-hint], select[data-format-hint]");
  }

  function clearHideTimer() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
  }

  function hideBubble(delayMs) {
    if (!bubble) return;
    clearHideTimer();
    const run = function () {
      bubble.classList.remove("show");
      activeEl = null;
    };
    if (delayMs && delayMs > 0) hideTimer = setTimeout(run, delayMs);
    else run();
  }

  function showBubble(el) {
    const msg = (el && el.getAttribute("data-format-hint")) || "";
    if (!msg) return;

    ensureBubble();
    clearHideTimer();
    activeEl = el;

    bubble.textContent = msg;
    bubble.classList.remove("above", "below", "show");
    bubble.style.left = "-9999px";
    bubble.style.top = "-9999px";

    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 360;
    const vh = window.innerHeight || document.documentElement.clientHeight || 640;
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    const gap = 10;

    let left = rect.left + (rect.width / 2) - (bw / 2);
    left = Math.max(8, Math.min(left, vw - bw - 8));

    const fitsAbove = rect.top > (bh + 18);
    let top;
    if (fitsAbove) {
      top = rect.top - bh - gap;
      bubble.classList.add("above");
    } else {
      top = rect.bottom + gap;
      if ((top + bh) > (vh - 8)) top = Math.max(8, vh - bh - 8);
      bubble.classList.add("below");
    }

    bubble.style.left = left + "px";
    bubble.style.top = top + "px";
    bubble.classList.add("show");

    hideTimer = setTimeout(function () {
      hideBubble(0);
    }, 2300);
  }

  document.addEventListener("focusin", function (e) {
    const el = hintTarget(e.target);
    if (el) showBubble(el);
  });

  document.addEventListener("mouseover", function (e) {
    const el = hintTarget(e.target);
    if (!el) return;
    if (activeEl === el && bubble && bubble.classList.contains("show")) return;
    showBubble(el);
  });

  document.addEventListener("mouseout", function (e) {
    const el = hintTarget(e.target);
    if (!el) return;
    const to = e.relatedTarget;
    if (to && el.contains(to)) return;
    hideBubble(220);
  });

  document.addEventListener("touchstart", function (e) {
    const el = hintTarget(e.target);
    if (el) showBubble(el);
  }, { passive: true });

  window.addEventListener("scroll", function () { hideBubble(0); }, { passive: true });
  window.addEventListener("resize", function () { hideBubble(0); });
})();
