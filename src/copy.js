// assets/js/copy-code.js
(() => {
    function addButtons() {
      const candidates = new Set();
      document.querySelectorAll('pre[class*="language-"]').forEach(pre => candidates.add(pre));
      document.querySelectorAll('pre code[class*="language-"]').forEach(code => {
        const pre = code.closest("pre");
        if (pre) candidates.add(pre);
      });
  
      candidates.forEach(pre => {
        if (!pre || pre.dataset.copybound === "1" || pre.classList.contains("no-copy")) return;
        pre.dataset.copybound = "1";
  
        const style = window.getComputedStyle(pre);
        if (style.position === "static") pre.style.position = "relative";
  
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "copy-code-btn btn"; // class used only for positioning; visuals are inherited
        btn.setAttribute("aria-label", "Copy code to clipboard");
        btn.textContent = "Copy";
  
        const live = document.createElement("span");
        live.className = "sr-only copy-live";
        live.setAttribute("aria-live", "polite");
        live.setAttribute("role", "status");
        live.textContent = "";
  
        pre.appendChild(btn);
        pre.appendChild(live);
  
        btn.addEventListener("click", async () => {
          const code = pre.querySelector("code");
          const text = (code ? code.innerText : pre.innerText).replace(/\s+$/, "");
          try {
            await navigator.clipboard.writeText(text);
            btn.dataset.copied = "true";
            btn.textContent = "Copied";
          } catch {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            try {
              document.execCommand("copy");
              btn.dataset.copied = "true";
              btn.textContent = "Copied";
            } catch {
              btn.textContent = "Press Ctrl+C";
            }
            document.body.removeChild(ta);
          }
  
          const msg = pre.querySelector(".copy-live");
          if (msg) msg.textContent = "Code copied to clipboard";
          setTimeout(() => {
            btn.dataset.copied = "false";
            btn.textContent = "Copy";
            if (msg) msg.textContent = "";
          }, 1600);
        });
      });
    }
  
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", addButtons);
    } else {
      addButtons();
    }
  })();
  