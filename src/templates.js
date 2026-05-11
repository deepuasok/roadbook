// templates.js — first-run picker + Reset menu
(function () {
  const TEMPLATES_META = [
    { key: "blank",              title: "Blank",              desc: "Three empty lanes (Now / Next / Later) — start fresh." },
    { key: "product-launch",     title: "Product Launch",     desc: "Discovery → Build → Beta → GA across one year." },
    { key: "saas-quarterly",     title: "SaaS Quarterly",     desc: "Q1–Q4 with Growth / Product / Platform tracks." },
    { key: "engineering-sprint", title: "Engineering Sprint", desc: "Now / Next / Later × Frontend / Backend / Infra." }
  ];

  function open() {
    const overlay = document.getElementById("templateOverlay");
    const grid = document.getElementById("templateGrid");
    grid.innerHTML = "";
    TEMPLATES_META.forEach((t) => {
      const btn = document.createElement("button");
      btn.className = "template-card";
      btn.type = "button";
      btn.innerHTML = `
        <div class="tc-title"></div>
        <div class="tc-desc"></div>
      `;
      btn.querySelector(".tc-title").textContent = t.title;
      btn.querySelector(".tc-desc").textContent = t.desc;
      btn.addEventListener("click", () => {
        const tpl = window.ROADBOOK_TEMPLATES && window.ROADBOOK_TEMPLATES[t.key];
        if (!tpl) {
          window.Roadbook.app.toast(`Template "${t.key}" not bundled`, true);
          return;
        }
        window.Roadbook.state.replaceAll(tpl);
        close();
        window.Roadbook.app.fullRender();
        window.Roadbook.app.toast(`Loaded "${t.title}"`);
      });
      grid.appendChild(btn);
    });
    overlay.classList.add("show");
    setTimeout(() => {
      const first = grid.querySelector(".template-card");
      if (first) first.focus();
    }, 40);
  }

  function close() {
    document.getElementById("templateOverlay").classList.remove("show");
  }

  window.Roadbook = window.Roadbook || {};
  window.Roadbook.templates = { open, close, META: TEMPLATES_META };
})();
