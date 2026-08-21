(() => {
  const BASE_STACKS = {
    system: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  };
  const BASE_WEBFONTS = {};

  // Сливаем внешние пресеты, если заданы
  const EXTRA = window.__DEV_FONT_EXTRA || { stacks: {}, webfonts: {} };
  const STACKS = { ...BASE_STACKS, ...EXTRA.stacks };
  const WEBFONTS = { ...BASE_WEBFONTS, ...EXTRA.webfonts };

  // Экспорт для позднего добавления + ручного перезапуска
  const api = {
    get stacks() { return STACKS; },
    get webfonts() { return WEBFONTS; },
    reloadPresets, setFontStack, setCustomStack,
  };
  window.__devFonts = api;

  // Создаём UI
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:fixed','right:12px','bottom:12px','z-index:99999',
    'background:#fff','border:1px solid #d0d7de','border-radius:8px',
    'box-shadow:0 8px 28px rgba(0,0,0,.15)','padding:10px 12px','font:14px/1.4 system-ui',
    'color:#111','min-width:260px'
  ].join(';');

  panel.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;justify-content:space-between">
      <strong>Fonts</strong>
      <button type="button" data-close style="font:12px system-ui;padding:2px 8px">×</button>
    </div>
    <div style="margin-top:8px">
      <label style="display:block;margin:6px 0 4px">Гарнитура</label>
      <select data-preset style="width:100%;">
        <!-- options will be injected -->
      </select>
    </div>
    <div style="margin-top:8px">
      <label style="display:block;margin:6px 0 4px">Custom stack</label>
      <input data-custom type="text" placeholder='e.g. "Inter", system-ui, sans-serif' style="width:100%;">
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button data-apply style="flex:1">Применить</button>
      <button data-reload style="flex:1">Reload presets</button>
    </div>
  `;

  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'f' || e.key === 'F')) {
      if (!panel.isConnected) document.body.appendChild(panel);
      else panel.remove();
    }
  });

  panel.querySelector('[data-close]').onclick = () => panel.remove();
  panel.querySelector('[data-apply]').onclick = applySelection;
  panel.querySelector('[data-reload]').onclick = () => { reloadPresets(); saveState(); };
  panel.querySelector('[data-preset]').onchange = onPresetChange;

  // состояние
  const LS_KEY = 'dev.fonts.v1';
  function saveState() {
    const sel = panel.querySelector('[data-preset]').value;
    const custom = panel.querySelector('[data-custom]').value;
    localStorage.setItem(LS_KEY, JSON.stringify({ sel, custom }));
  }
  function loadState() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
  }

  function injectOptions() {
    const sel = panel.querySelector('[data-preset]');
    sel.innerHTML = '';
    Object.keys(STACKS).forEach(key => {
      const opt = document.createElement('option');
      opt.value = key; opt.textContent = key;
      sel.appendChild(opt);
    });
    const optCustom = document.createElement('option');
    optCustom.value = '__custom__';
    optCustom.textContent = 'Custom';
    sel.appendChild(optCustom);
  }

  function reloadPresets() {
    injectOptions();
  }

  function onPresetChange() {
    const val = panel.querySelector('[data-preset]').value;
    if (val === '__custom__') {
      panel.querySelector('[data-custom]').focus();
    } else {
      // заполняем инпут текущим стэком, удобно править
      panel.querySelector('[data-custom]').value = STACKS[val] || '';
    }
    saveState();
  }

  // применение
  function ensureWebfontLoaded(key) {
    const href = WEBFONTS[key];
    if (!href) return;
    let link = document.getElementById('dev-webfont-link');
    if (!link) {
      link = document.createElement('link');
      link.id = 'dev-webfont-link';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (link.href !== href) link.href = href;
  }

  function setFontStack(stack) {
    document.documentElement.style.setProperty('--font-xp', stack);
  }

  function setCustomStack(stack) {
    panel.querySelector('[data-custom]').value = stack || '';
    panel.querySelector('[data-preset]').value = '__custom__';
    setFontStack(stack);
  }

  function applySelection() {
    const key = panel.querySelector('[data-preset]').value;
    if (key === '__custom__') {
      const custom = panel.querySelector('[data-custom]').value.trim();
      if (custom) setFontStack(custom);
    } else {
      const stack = STACKS[key];
      if (stack) {
        ensureWebfontLoaded(key);
        setFontStack(stack);
      }
    }
    saveState();
  }

  // начальная загрузка
  (function init() {
    if (!panel.isConnected) document.body.appendChild(panel);
    reloadPresets();
    const st = loadState();
    if (st.sel && (st.sel in STACKS)) {
      panel.querySelector('[data-preset]').value = st.sel;
      panel.querySelector('[data-custom]').value = STACKS[st.sel] || '';
      ensureWebfontLoaded(st.sel);
      setFontStack(STACKS[st.sel]);
    } else if (st.sel === '__custom__' && st.custom) {
      panel.querySelector('[data-preset]').value = '__custom__';
      panel.querySelector('[data-custom]').value = st.custom;
      setFontStack(st.custom);
    } else {
      // default — system
      panel.querySelector('[data-preset]').value = 'system';
      panel.querySelector('[data-custom]').value = STACKS['system'];
      setFontStack(STACKS['system']);
    }
  })();
})();
