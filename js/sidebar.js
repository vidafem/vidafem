// js/sidebar.js - Control unificado del sidebar

document.addEventListener("DOMContentLoaded", () => {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const toggleDesktop = document.getElementById("toggleDesktop");
  const toggleMobile = document.getElementById("toggleMobile");
  const menuLinks = document.querySelectorAll(".menu-link");
  const btnLogout = document.getElementById("btnLogout");

  if (!sidebar) return;

  const desktopDelayMs = 500;
  const mobileDelayMs = 1500;
  let desktopTimer = null;
  let mobileTimer = null;
  let pointerInsideSidebar = false;

  function isMobile() {
    return window.innerWidth <= 900;
  }

  function clearDesktopTimer() {
    if (desktopTimer) {
      clearTimeout(desktopTimer);
      desktopTimer = null;
    }
  }

  function clearMobileTimer() {
    if (mobileTimer) {
      clearTimeout(mobileTimer);
      mobileTimer = null;
    }
  }

  function closeMobileMenu() {
    sidebar.classList.remove("active");
    if (overlay) overlay.classList.remove("active");
    clearMobileTimer();
  }

  function collapseDesktop() {
    if (!isMobile()) sidebar.classList.add("collapsed");
  }

  function scheduleDesktopCollapse() {
    if (isMobile()) return;
    clearDesktopTimer();
    desktopTimer = setTimeout(() => {
      if (!pointerInsideSidebar) collapseDesktop();
    }, desktopDelayMs);
  }

  function scheduleMobileClose() {
    if (!isMobile()) return;
    if (!sidebar.classList.contains("active")) return;
    clearMobileTimer();
    mobileTimer = setTimeout(() => {
      closeMobileMenu();
    }, mobileDelayMs);
  }

  function markInteraction() {
    if (isMobile()) {
      scheduleMobileClose();
    } else {
      clearDesktopTimer();
      if (!pointerInsideSidebar) scheduleDesktopCollapse();
    }
  }

  function toggleMobileState() {
    sidebar.classList.toggle("active");
    if (overlay) overlay.classList.toggle("active");
    if (sidebar.classList.contains("active")) {
      scheduleMobileClose();
    } else {
      clearMobileTimer();
    }
  }

  // Estado visual inicial
  setTimeout(() => {
    if (isMobile()) {
      closeMobileMenu();
    } else {
      collapseDesktop();
    }
  }, desktopDelayMs);

  if (toggleDesktop) {
    toggleDesktop.addEventListener("click", () => {
      sidebar.classList.toggle("collapsed");
      clearDesktopTimer();
    });
  }

  if (toggleMobile) {
    toggleMobile.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMobileState();
    });
  }

  if (overlay) {
    overlay.addEventListener("click", closeMobileMenu);
  }

  menuLinks.forEach((link) => {
    const currentPath = window.location.pathname.split("/").pop();
    if (link.getAttribute("href") === currentPath) {
      link.classList.add("active");
    }

    link.addEventListener("click", () => {
      if (isMobile()) closeMobileMenu();
      else scheduleDesktopCollapse();
    });
  });

  // Desktop: solo colapsar cuando no se esta usando
  sidebar.addEventListener("mouseenter", () => {
    pointerInsideSidebar = true;
    clearDesktopTimer();
    if (!isMobile()) sidebar.classList.remove("collapsed");
  });

  sidebar.addEventListener("mouseleave", () => {
    pointerInsideSidebar = false;
    scheduleDesktopCollapse();
  });

  sidebar.addEventListener("mousemove", markInteraction);
  sidebar.addEventListener("click", markInteraction);
  sidebar.addEventListener("touchstart", markInteraction, { passive: true });

  // Click fuera: cerrar movil o colapsar desktop
  document.addEventListener("click", (e) => {
    const insideSidebar = sidebar.contains(e.target);
    const isToggle = (toggleMobile && toggleMobile.contains(e.target)) || (toggleDesktop && toggleDesktop.contains(e.target));
    if (insideSidebar || isToggle) return;

    if (isMobile()) {
      closeMobileMenu();
    } else {
      pointerInsideSidebar = false;
      scheduleDesktopCollapse();
    }
  });

  window.addEventListener("resize", () => {
    clearDesktopTimer();
    clearMobileTimer();
    if (isMobile()) {
      sidebar.classList.remove("collapsed");
      closeMobileMenu();
    } else {
      sidebar.classList.remove("active");
      if (overlay) overlay.classList.remove("active");
      scheduleDesktopCollapse();
    }
  });

  if (btnLogout) {
    const newBtn = btnLogout.cloneNode(true);
    btnLogout.parentNode.replaceChild(newBtn, btnLogout);
    newBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const ok = window.appConfirm
        ? await window.appConfirm({
            title: "Cerrar sesion",
            message: "Deseas cerrar sesion ahora",
            confirmText: "Si, salir",
            cancelText: "Cancelar"
          })
        : confirm("Deseas cerrar sesion");
      if (!ok) return;
      try { if (window.apiLogoutSession) await window.apiLogoutSession(); } catch (err) {}
      try { sessionStorage.removeItem("vidafem_session"); } catch (err) {}
      window.location.href = "index.html";
    });
  }
});
