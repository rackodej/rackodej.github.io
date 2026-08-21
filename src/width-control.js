// src/width-control.js
(function () {
    const KEY = "veg:content-col-width";
    const MIN = 480;
    const MAX = 1280;
    const DEF = 760;
    const STEP = 8;
  
    const d = document;
    const root = d.documentElement;
  
    const clamp = (x) => Math.min(MAX, Math.max(MIN, x));
    const read = () => {
      const v = parseInt(localStorage.getItem(KEY) || "", 10);
      return Number.isFinite(v) ? clamp(v) : DEF;
    };
  
    function apply(px) {
      root.style.setProperty("--content-col-width", px + "px");
      const val = d.getElementById("wc-val");
      if (val) val.textContent = px + "px";
      const range = d.getElementById("wc-range");
      if (range && Math.abs(parseInt(range.value, 10) - px) >= STEP) {
        range.value = String(px);
      }
    }
  
    function buildDock() {
      const dock = d.createElement("div");
      dock.className = "width-dock";
      dock.setAttribute("role", "group");
      dock.setAttribute("aria-label", "Ширина контента");
  
      const current = read();
  
      dock.innerHTML = `
        <span style="font-weight:600">Ширина</span>
        <input id="wc-range" type="range" min="${MIN}" max="${MAX}" step="${STEP}" value="${current}">
        <span id="wc-val" class="value">${current}px</span>
        <button type="button" id="wc-fit" title="Подогнать под доступную ширину">Подогнать</button>
        <button type="button" id="wc-reset" title="Сбросить на 760px">Сброс</button>
      `;
  
      d.body.appendChild(dock);
  
      const range = d.getElementById("wc-range");
      range.addEventListener("input", () => {
        const px = clamp(parseInt(range.value, 10));
        apply(px);
      });
      range.addEventListener("change", () => {
        const px = clamp(parseInt(range.value, 10));
        localStorage.setItem(KEY, String(px));
      });
  
      // «Подогнать»: рассчитает максимально возможную ширину контента с учётом сайдбара и гэпа
      d.getElementById("wc-fit").addEventListener("click", () => {
        const grid = d.querySelector(".layout-two-col");
        if (!grid) return;
        const style = getComputedStyle(grid);
        const gap = parseFloat(style.columnGap) || 0;
        const total = grid.clientWidth;
  
        const aside = grid.querySelector(".aside-col");
        const asideW = aside ? aside.offsetWidth : 300;
  
        const px = clamp(Math.round(total - asideW - gap));
        apply(px);
        localStorage.setItem(KEY, String(px));
      });
  
      d.getElementById("wc-reset").addEventListener("click", () => {
        apply(DEF);
        localStorage.setItem(KEY, String(DEF));
      });
    }
  
    d.addEventListener("DOMContentLoaded", () => {
      apply(read());
      buildDock();
    });
  })();
  