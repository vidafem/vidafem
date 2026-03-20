// js/notify.js - Notificaciones globales tipo toast
(function () {
  if (window.__vidafemNotifyLoaded) return;
  window.__vidafemNotifyLoaded = true;

  function ensureContainer() {
    let c = document.getElementById("vf-toast-container");
    if (c) return c;
    c = document.createElement("div");
    c.id = "vf-toast-container";
    c.style.position = "fixed";
    c.style.top = "18px";
    c.style.right = "18px";
    c.style.zIndex = "99999";
    c.style.display = "flex";
    c.style.flexDirection = "column";
    c.style.gap = "10px";
    c.style.maxWidth = "min(92vw, 420px)";
    document.body.appendChild(c);
    return c;
  }

  function ensureStyles() {
    if (document.getElementById("vf-toast-styles")) return;
    const style = document.createElement("style");
    style.id = "vf-toast-styles";
    style.textContent = `
      .vf-toast {
        border-radius: 10px;
        padding: 12px 14px;
        color: #fff;
        font-size: 0.92rem;
        line-height: 1.35;
        box-shadow: 0 10px 28px rgba(0,0,0,.20);
        transform: translateY(-8px);
        opacity: 0;
        transition: transform .22s ease, opacity .22s ease;
        word-break: break-word;
      }
      .vf-toast.show {
        transform: translateY(0);
        opacity: 1;
      }
      .vf-toast.info { background: #2d5b95; }
      .vf-toast.success { background: #1e8e5a; }
      .vf-toast.warning { background: #c27910; }
      .vf-toast.error { background: #b33434; }
      .vf-confirm-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,.35);
        z-index: 100000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 18px;
      }
      .vf-confirm-box {
        width: min(92vw, 420px);
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 16px 42px rgba(0,0,0,.24);
        padding: 18px 16px 14px;
        color: #2f2f2f;
      }
      .vf-confirm-title {
        font-weight: 700;
        font-size: 1.02rem;
        margin-bottom: 8px;
        color: #36235d;
      }
      .vf-confirm-msg {
        font-size: .93rem;
        line-height: 1.4;
        color: #444;
        white-space: pre-line;
      }
      .vf-confirm-actions {
        margin-top: 14px;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
      }
      .vf-btn {
        border: none;
        border-radius: 8px;
        padding: 9px 12px;
        font-size: .9rem;
        cursor: pointer;
      }
      .vf-btn-cancel {
        background: #e9ecef;
        color: #333;
      }
      .vf-btn-ok {
        background: #c0392b;
        color: #fff;
      }
    `;
    document.head.appendChild(style);
  }

  function normalizeType(type) {
    const t = String(type || "info").toLowerCase();
    if (t === "success" || t === "warning" || t === "error" || t === "info") return t;
    return "info";
  }

  function notify(message, type, timeoutMs) {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", function () {
        notify(message, type, timeoutMs);
      }, { once: true });
      return;
    }

    ensureStyles();
    const container = ensureContainer();
    const toast = document.createElement("div");
    const toastType = normalizeType(type);
    toast.className = "vf-toast " + toastType;
    toast.textContent = String(message || "");
    container.appendChild(toast);

    requestAnimationFrame(function () {
      toast.classList.add("show");
    });

    const ttl = typeof timeoutMs === "number" ? timeoutMs : 3200;
    setTimeout(function () {
      toast.classList.remove("show");
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 260);
    }, ttl);
  }

  window.appNotify = notify;
  window.notifySuccess = function (msg, ms) { notify(msg, "success", ms); };
  window.notifyError = function (msg, ms) { notify(msg, "error", ms); };
  window.notifyWarning = function (msg, ms) { notify(msg, "warning", ms); };
  window.notifyInfo = function (msg, ms) { notify(msg, "info", ms); };

  function appConfirm(options) {
    ensureStyles();
    const opts = typeof options === "string" ? { message: options } : (options || {});
    const title = opts.title || "Confirmar accion";
    const message = opts.message || "Deseas continuar?";
    const confirmText = opts.confirmText || "Eliminar";
    const cancelText = opts.cancelText || "Cancelar";

    return new Promise(function (resolve) {
      const overlay = document.createElement("div");
      overlay.className = "vf-confirm-overlay";
      overlay.innerHTML = `
        <div class="vf-confirm-box" role="dialog" aria-modal="true">
          <div class="vf-confirm-title">${title}</div>
          <div class="vf-confirm-msg">${message}</div>
          <div class="vf-confirm-actions">
            <button type="button" class="vf-btn vf-btn-cancel">${cancelText}</button>
            <button type="button" class="vf-btn vf-btn-ok">${confirmText}</button>
          </div>
        </div>
      `;

      function close(val) {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(!!val);
      }

      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) close(false);
      });
      const btnCancel = overlay.querySelector(".vf-btn-cancel");
      const btnOk = overlay.querySelector(".vf-btn-ok");
      btnCancel.addEventListener("click", function () { close(false); });
      btnOk.addEventListener("click", function () { close(true); });
      document.body.appendChild(overlay);
      btnOk.focus();
    });
  }
  window.appConfirm = appConfirm;

  const nativeAlert = window.alert ? window.alert.bind(window) : null;
  window.nativeAlert = nativeAlert;
  window.alert = function (message) {
    notify(message, "warning", 3600);
  };
})();
