// src/asciinema-loader.js
(function () {
    const CSS_HREF = "https://cdn.jsdelivr.net/npm/asciinema-player@3/dist/bundle/asciinema-player.css";
    const JS_SRC   = "https://cdn.jsdelivr.net/npm/asciinema-player@3/dist/bundle/asciinema-player.min.js";
  
    function ensureCss(href) {
      if (document.querySelector('link[data-asciinema="1"]')) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const l = document.createElement("link");
        l.rel = "stylesheet";
        l.href = href;
        l.dataset.asciinema = "1";
        l.onload = resolve;
        l.onerror = reject;
        document.head.appendChild(l);
      });
    }
  
    function ensureScript(src) {
      if (window.AsciinemaPlayer) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.defer = true;
        s.dataset.asciinema = "1";
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
  
    function initOne(el) {
      const src = el.getAttribute("data-asciinema-src");
      let opts = {};
      try { opts = JSON.parse(el.getAttribute("data-asciinema-opts") || "{}"); }
      catch (e) { console.error("Bad opts JSON for", src, e); }
      try { AsciinemaPlayer.create(src, el, opts); }
      catch (e) { console.error("Asciinema init failed for", src, e); }
    }
  
    function boot() {
      const holders = document.querySelectorAll(".asciinema-holder");
      if (!holders.length) return;
      ensureCss(CSS_HREF)
        .then(() => ensureScript(JS_SRC))
        .then(() => holders.forEach(initOne))
        .catch(err => console.error("Asciinema loader error:", err));
    }
  
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
  })();
  