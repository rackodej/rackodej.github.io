// /src/ln-gaps.js
(() => {
    function parseGaps(s) {
      // "8->455,25->1000"  ->  [{after:8, next:455}, ...]
      if (!s) return [];
      return s.split(",").map(p => {
        const m = p.trim().match(/^(\d+)\s*->\s*(\d+)$/);
        return m ? { after: parseInt(m[1], 10), next: parseInt(m[2], 10) } : null;
      }).filter(Boolean);
    }
  
    function apply(pre) {
      const code = pre.querySelector("code");
      const ds = Object.assign({}, pre.dataset, code ? code.dataset : null);
  
      // Начало нумерации
      const start = ds.lnStart ? parseInt(ds.lnStart, 10) : null;
      if (Number.isFinite(start)) pre.style.setProperty("--ln-base", String(start - 1));
  
      // Текущий список строк (до вставки эллипсисов)
      const origLines = Array.from(pre.querySelectorAll(".highlight-line"));
  
      // Разрывы вида "idx->nextStart"
      const gaps = parseGaps(ds.lnGaps);
  
      let inserted = 0;
      for (const g of gaps) {
        const insertIdx = g.after + 1 + inserted;
        const target = origLines[insertIdx]; // строка, с которой продолжим нумерацию
  
        // Вставить линию-эллипсис ПЕРЕД target (или в конец, если target нет)
        const ell = document.createElement("span");
        ell.className = "highlight-line ellipsis";
        if (target && target.parentNode) target.parentNode.insertBefore(ell, target);
        else pre.appendChild(ell);
        inserted++;
  
        // Сбросить счётчик на целевой строке, чтобы ЕЁ номер = g.next
        const nowLines = pre.querySelectorAll(".highlight-line");
        const t = nowLines[insertIdx + 1]; // после вставки эллипсиса целевая сместилась на +1
        if (t) t.style.counterReset = `sh-line ${g.next - 1}`;
      }
    }
  
    function run() {
      document.querySelectorAll('pre[class*="language-"]').forEach(pre => {
        // Берём только те, где есть .highlight-line (Eleventy уже обернул)
        if (!pre.querySelector(".highlight-line")) return;
        apply(pre);
      });
    }
  
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run);
    } else {
      run();
    }
  })();
  