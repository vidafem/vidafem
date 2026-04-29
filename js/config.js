// js/config.js
// Configuracion global de conexion

const APP_GIT_VERSION = "d102a91";
console.log(`%c VIDAFEM %c Version: ${APP_GIT_VERSION} `, "background:#36235d; color:white; font-weight:bold; padding:4px 8px; border-radius:4px 0 0 4px;", "background:#27ae60; color:white; font-weight:bold; padding:4px 8px; border-radius:0 4px 4px 0;");

const PROD_API_URL = "https://script.google.com/macros/s/AKfycbxnfbCeCIQa8BWLfJwh6J20SNSksLEcHYdthf9mEfyev8tLF5wYg4uo7BsaMA5R4-NZUw/exec";
const TEST_API_URL = "https://script.google.com/macros/s/AKfycbxnfbCeCIQa8BWLfJwh6J20SNSksLEcHYdthf9mEfyev8tLF5wYg4uo7BsaMA5R4-NZUw/exec";
const VF_ENV_STORAGE_KEY = "vidafem_runtime_env";
const VF_BACKEND_STORAGE_KEY = "vidafem_backend_runtime";
const PROD_WORKER_API_URL = "https://vidafem-api.adminvidafem.workers.dev";
const TEST_WORKER_API_URL = "http://127.0.0.1:8787";

function getStoredRuntimeEnv_() {
  try {
    const raw = sessionStorage.getItem(VF_ENV_STORAGE_KEY);
    const env = String(raw || "").trim().toLowerCase();
    return env === "test" || env === "prod" ? env : "";
  } catch (e) {
    return "";
  }
}

function storeRuntimeEnv_(env) {
  try {
    const value = String(env || "").trim().toLowerCase();
    if (value === "test" || value === "prod") {
      sessionStorage.setItem(VF_ENV_STORAGE_KEY, value);
    }
  } catch (e) {}
}

function normalizeBackendRuntime_(value) {
  const backend = String(value || "").trim().toLowerCase();
  return backend === "worker" || backend === "apps_script" ? backend : "";
}

function getStoredBackendRuntime_() {
  try {
    return normalizeBackendRuntime_(sessionStorage.getItem(VF_BACKEND_STORAGE_KEY));
  } catch (e) {
    return "";
  }
}

function storeBackendRuntime_(backend) {
  try {
    const value = normalizeBackendRuntime_(backend);
    if (value) sessionStorage.setItem(VF_BACKEND_STORAGE_KEY, value);
  } catch (e) {}
}

function resolveApiUrlByRuntime_(env, backend) {
  const safeEnv = String(env || "").trim().toLowerCase() === "test" ? "test" : "prod";
  const safeBackend = normalizeBackendRuntime_(backend) || "apps_script";
  const appsScriptUrl = safeEnv === "test" ? TEST_API_URL : PROD_API_URL;
  const workerUrl = safeEnv === "test" ? TEST_WORKER_API_URL : PROD_WORKER_API_URL;

  if (safeBackend === "worker" && String(workerUrl || "").trim()) {
    return {
      backend: "worker",
      requested_backend: "worker",
      url: workerUrl
    };
  }

  return {
    backend: "apps_script",
    requested_backend: safeBackend,
    url: appsScriptUrl
  };
}

function resolveApiRuntime_() {
  let env = "";
  let source = "default";
  let backend = "";
  let backendSource = "default";
  let backendForcedReason = "";
  try {
    const params = new URLSearchParams(window.location.search || "");
    const raw = String(params.get("vf_env") || "").trim().toLowerCase();
    if (raw === "test" || raw === "prod") {
      env = raw;
      source = "query";
      storeRuntimeEnv_(env);
    }
    const rawBackend = normalizeBackendRuntime_(params.get("vf_backend"));
    if (rawBackend) {
      backend = rawBackend;
      backendSource = "query";
      storeBackendRuntime_(backend);
    }
  } catch (e) {}

  if (!env) {
    const stored = getStoredRuntimeEnv_();
    if (stored) {
      env = stored;
      source = "session";
    }
  }

  if (!backend) {
    const storedBackend = getStoredBackendRuntime_();
    if (storedBackend) {
      backend = storedBackend;
      backendSource = "session";
    }
  }

  if (!env) {
    env = "prod";
  }

  if (!backend) {
    backend = env === "prod" ? "worker" : "apps_script";
  }

  const apiTarget = resolveApiUrlByRuntime_(env, backend);

  return {
    env: env,
    source: source,
    backend: apiTarget.backend,
    requested_backend: apiTarget.requested_backend,
    backend_source: backendSource,
    backend_forced_reason: backendForcedReason,
    url: apiTarget.url
  };
}

function withEnvUrl_(targetUrl) {
  const raw = String(targetUrl || "").trim();
  if (!raw) return raw;
  if (/^(?:[a-z]+:|mailto:|tel:|javascript:|#)/i.test(raw)) return raw;

  try {
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin) return raw;

    if (VF_API_RUNTIME.env === "test") {
      url.searchParams.set("vf_env", "test");
    } else {
      url.searchParams.delete("vf_env");
    }

    if (VF_API_RUNTIME.backend === "worker") {
      url.searchParams.set("vf_backend", "worker");
    } else {
      url.searchParams.delete("vf_backend");
    }

    return url.pathname + (url.search || "") + (url.hash || "");
  } catch (e) {
    return raw;
  }
}

function navigateWithEnv_(targetUrl) {
  const finalUrl = withEnvUrl_(targetUrl);
  window.location.href = finalUrl;
  return finalUrl;
}

const VF_API_RUNTIME = resolveApiRuntime_();
const API_URL = VF_API_RUNTIME.url;

window.VF_API_RUNTIME = VF_API_RUNTIME;
window.VF_API_URLS = {
  prod: PROD_API_URL,
  test: TEST_API_URL,
  apps_script: {
    prod: PROD_API_URL,
    test: TEST_API_URL
  },
  worker: {
    prod: PROD_WORKER_API_URL,
    test: TEST_WORKER_API_URL
  }
};
window.withEnvUrl = withEnvUrl_;
window.navigateWithEnv = navigateWithEnv_;

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("a[href]").forEach((link) => {
    const href = String(link.getAttribute("href") || "").trim();
    if (!href || href.startsWith("#")) return;
    link.setAttribute("href", withEnvUrl_(href));
  });

  if (VF_API_RUNTIME.env !== "test") return;
  if (document.getElementById("vfEnvBadge")) return;

  const badge = document.createElement("div");
  badge.id = "vfEnvBadge";
  badge.textContent = VF_API_RUNTIME.backend === "worker" ? "MODO PRUEBA / WORKER" : "MODO PRUEBA";
  badge.style.position = "fixed";
  badge.style.right = "12px";
  badge.style.bottom = "12px";
  badge.style.zIndex = "5000";
  badge.style.padding = "8px 10px";
  badge.style.borderRadius = "999px";
  badge.style.background = "#b45309";
  badge.style.color = "#fff";
  badge.style.fontSize = "12px";
  badge.style.fontWeight = "700";
  badge.style.letterSpacing = ".04em";
  badge.style.boxShadow = "0 8px 24px rgba(0,0,0,.18)";
  document.body.appendChild(badge);
});

// Primer puente de migracion hacia Supabase.
// Pega aqui tu Project URL y tu anon key cuando quieras comenzar a probar.
const VF_SUPABASE_CONFIG = {
  enabled: true,
  url: "https://nldwczwzncgdcvddyolw.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5sZHdjend6bmNnZGN2ZGR5b2x3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMjU1MTgsImV4cCI6MjA4OTYwMTUxOH0.6ox8Co-rf8HFllLrnxO8C4X1lbJPXS0ol2EFjxDRXe0",
  features: {
    services: true,
    serviceConfig: true,
    promoList: true,
    adminVacation: true,
    adminInfographics: true,
    patientPromo: true,
    patientDoctorVacation: true
  }
};

window.VF_SUPABASE_CONFIG = VF_SUPABASE_CONFIG;

const MESSAGES = {
  loading: "Verificando credenciales...",
  error: "Error de conexion con el servidor.",
  success: "Bienvenido a VIDAFEM!"
};

function getSessionData_() {
  try {
    const raw = sessionStorage.getItem("vidafem_session");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}

function clearRuntimeSession_(message) {
  try { sessionStorage.removeItem("vidafem_session"); } catch (e) {}
  const isLoginPage = /\/index\.html$/i.test(String(window.location.pathname || ""));
  if (!isLoginPage) {
    if (!window.__vfSession401Redirecting) {
      window.__vfSession401Redirecting = true;
      if (message) {
        try {
          if (window.showToast) window.showToast(message, "warning", 2600);
          else alert(message);
        } catch (e) {}
      }
      setTimeout(function () {
        window.navigateWithEnv("index.html");
      }, 120);
    }
  }
}

function ensureSessionBackendCompatibility_() {
  const currentBackend = normalizeBackendRuntime_(VF_API_RUNTIME && VF_API_RUNTIME.backend);
  if (!currentBackend) return;

  const session = getSessionData_();
  if (!session || !session.session_token) return;

  const sessionBackend = normalizeBackendRuntime_(session.backend_runtime || session.backend);
  if (!sessionBackend) return; // Sesiones legacy: se validan por 401.
  if (sessionBackend === currentBackend) return;

  clearRuntimeSession_("Se detecto un cambio de backend. Inicia sesion nuevamente.");
}

function getSessionToken_() {
  const session = getSessionData_();
  return String((session && session.session_token) || "").trim();
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
      let actionName = "";

      if (isApiCall && method === "POST" && typeof opts.body === "string" && opts.body) {
        const payload = JSON.parse(opts.body);
        if (payload && typeof payload === "object") {
          actionName = String(payload.action || "").trim().toLowerCase();
        }
        if (payload && typeof payload === "object" && actionName !== "login" && !payload.session_token) {
          const token = getSessionToken_();
          if (token) {
            payload.session_token = token;
            opts.body = JSON.stringify(payload);
          }
        }
      }

      return originalFetch(input, opts).then(function (response) {
        if (!isApiCall || method !== "POST" || actionName === "login" || response.status !== 401) {
          return response;
        }
        if (window.__vfSession401Redirecting) {
          return response;
        }
        clearRuntimeSession_("Tu sesion expiro o no es valida para este backend. Inicia sesion nuevamente.");
        return response;
      });
    } catch (e) {
      return originalFetch(input, init);
    }
  };
})();

ensureSessionBackendCompatibility_();

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
