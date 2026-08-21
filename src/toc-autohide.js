(() => {
  "use strict";

  function boot() {
    const toc = document.querySelector(".toc-dock");
    if (!toc) return;

    const button = toc.querySelector(".toc-toggle");
    const content = toc.querySelector(".toc-content");
    if (!button || !content) return;

    button.addEventListener("click", () => {
      const collapsed = toc.classList.toggle("toc-collapsed");
      button.setAttribute("aria-expanded", String(!collapsed));
      button.textContent = collapsed ? button.dataset.showLabel : button.dataset.hideLabel;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
