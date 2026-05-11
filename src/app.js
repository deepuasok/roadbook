// app.js — main entry: render lanes/cards, wire top controls, keyboard nav
(function () {
  const ROW_H = 34;
  const COLS = 12; // months

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[c]);
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  // ---------- Render ----------
  function fullRender() {
    const s = window.Roadbook.state.get();
    document.getElementById("title").textContent = s.title;
    document.getElementById("eyebrow").textContent = s.eyebrow;
    document.getElementById("axisYear").textContent = s.activeYear;
    document.querySelectorAll(".year-pill").forEach((p) => {
      const active = p.dataset.year === s.activeYear;
      p.classList.toggle("active", active);
      p.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.documentElement.style.setProperty("--accent", s.accent);
    document.body.setAttribute("data-theme", s.theme);
    refreshUndoRedo();

    const container = document.getElementById("lanes");
    container.innerHTML = "";
    const y = window.Roadbook.state.currentYear();
    y.lanes.forEach((lane) => container.appendChild(renderLane(lane)));
    y.items.forEach((item) => placeItem(item));
    y.lanes.forEach((lane) => resizeLaneBody(lane.id));
  }

  function renderLane(lane) {
    const el = document.createElement("div");
    el.className = "lane";
    el.setAttribute("role", "listitem");
    el.dataset.laneId = lane.id;
    el.dataset.color = lane.color || "cream";
    el.innerHTML = `
      <div class="lane-head">
        <h2 contenteditable="true" spellcheck="false" data-role="name"></h2>
        <p contenteditable="true" spellcheck="false" data-role="desc" data-placeholder="Add a description"></p>
        <div class="lane-actions">
          <button class="icon-action" data-action="add-item" aria-label="Add item" title="Add item">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>
          </button>
          <button class="icon-action" data-action="color-lane" aria-label="Change lane color" title="Change color">
            <svg viewBox="0 0 16 16" fill="none"><circle cx="5" cy="5" r="2" fill="#F59E0B"/><circle cx="11" cy="5" r="2" fill="#10B981"/><circle cx="5" cy="11" r="2" fill="#3B82F6"/><circle cx="11" cy="11" r="2" fill="#EF4444"/></svg>
          </button>
          <button class="icon-action danger" data-action="delete-lane" aria-label="Remove lane" title="Remove lane">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h10M6 5V3h4v2M5 5l0.7 9h4.6l0.7-9"/></svg>
          </button>
        </div>
      </div>
      <div class="lane-body" data-lane="${lane.id}">
        <div class="ghost"></div>
      </div>
    `;
    el.querySelector('[data-role="name"]').textContent = lane.name;
    el.querySelector('[data-role="desc"]').textContent = lane.description || "";

    // Inline edits on lane name / description
    const nameEl = el.querySelector('[data-role="name"]');
    const descEl = el.querySelector('[data-role="desc"]');
    bindEditable(nameEl, (v) => {
      const l = window.Roadbook.state.findLane(lane.id);
      if (l && v && v !== l.name) window.Roadbook.state.commit(() => { l.name = v; });
    });
    bindEditable(descEl, (v) => {
      const l = window.Roadbook.state.findLane(lane.id);
      if (l && v !== l.description) window.Roadbook.state.commit(() => { l.description = v; });
    });

    el.querySelector('[data-action="add-item"]').addEventListener("click", () => addItem(lane.id));
    el.querySelector('[data-action="delete-lane"]').addEventListener("click", () => deleteLane(lane.id));
    const colorBtn = el.querySelector('[data-action="color-lane"]');
    colorBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openColorPicker(lane.id, colorBtn);
    });
    return el;
  }

  function bindEditable(el, onCommit) {
    el.addEventListener("blur", () => onCommit(el.textContent.trim()));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); el.blur(); }
    });
  }

  function placeItem(item) {
    const body = document.querySelector(`.lane-body[data-lane="${item.laneId}"]`);
    if (!body) return null;
    const card = document.createElement("div");
    card.className = "card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.dataset.id = item.id;
    card.dataset.status = item.status || "planned";
    card.dataset.type = item.type || "other";
    card.dataset.complete = String(item.complete || 0);
    card.style.setProperty("--start", item.start);
    card.style.setProperty("--span", item.span);
    card.style.setProperty("--row", item.row);
    card.style.setProperty("--complete", item.complete || 0);
    card.setAttribute("aria-label", `${item.title}, ${item.status}, month ${item.start}, span ${item.span}`);
    card.innerHTML = `
      <div class="fill"></div>
      <span class="dot" aria-hidden="true"></span>
      <span class="title"></span>
      <span class="meta"></span>
      <div class="resize" aria-hidden="true"></div>
    `;
    card.querySelector(".title").textContent = item.title;
    card.querySelector(".meta").innerHTML = renderMeta(item);
    window.Roadbook.drag.attachCard(card);
    body.appendChild(card);
    return card;
  }

  function renderMeta(item) {
    const parts = [];
    if (item.complete && item.complete > 0) parts.push(`<span class="pct">${item.complete}%</span>`);
    if (item.due) parts.push(escapeHtml(fmtDate(item.due)));
    return parts.join(" · ");
  }

  function updateCardDom(item) {
    const card = document.querySelector(`.card[data-id="${item.id}"]`);
    if (!card) return;
    card.dataset.status = item.status;
    card.dataset.type = item.type;
    card.dataset.complete = String(item.complete || 0);
    card.style.setProperty("--start", item.start);
    card.style.setProperty("--span", item.span);
    card.style.setProperty("--row", item.row);
    card.style.setProperty("--complete", item.complete || 0);
    card.setAttribute("aria-label", `${item.title}, ${item.status}, month ${item.start}, span ${item.span}`);
    card.querySelector(".title").textContent = item.title;
    card.querySelector(".meta").innerHTML = renderMeta(item);
  }

  function replaceCard(item, oldLaneId) {
    const existing = document.querySelector(`.card[data-id="${item.id}"]`);
    if (existing) existing.remove();
    return placeItem(item);
  }

  function resizeLaneBody(laneId) {
    const body = document.querySelector(`.lane-body[data-lane="${laneId}"]`);
    if (!body) return;
    const items = window.Roadbook.state.currentYear().items.filter((i) => i.laneId === laneId);
    let maxRow = 0;
    items.forEach((i) => maxRow = Math.max(maxRow, i.row));
    body.style.minHeight = ((maxRow + 1) * ROW_H) + "px";
  }

  // ---------- Mutations ----------
  function addItem(laneId) {
    const id = window.Roadbook.state.uid("it");
    let r = 0;
    window.Roadbook.state.commit(() => {
      const rowsUsed = window.Roadbook.state.currentYear().items
        .filter((i) => i.laneId === laneId && i.start === 1)
        .map((i) => i.row);
      while (rowsUsed.includes(r)) r++;
      window.Roadbook.state.currentYear().items.push({
        id, laneId,
        title: "New item",
        start: 1, span: 3, row: r, // default to one quarter (3 months)
        status: "planned",
        type: "other",
        due: "",
        complete: 0
      });
    });
    const item = window.Roadbook.state.findItem(id);
    placeItem(item);
    resizeLaneBody(laneId);
    window.Roadbook.modal.open(id);
  }

  function addLane() {
    const id = window.Roadbook.state.uid("lane");
    const usedColors = window.Roadbook.state.currentYear().lanes.map((l) => l.color);
    const palette = window.Roadbook.state.PALETTE;
    const color = palette.find((c) => !usedColors.includes(c)) || palette[usedColors.length % palette.length];
    window.Roadbook.state.commit(() => {
      window.Roadbook.state.currentYear().lanes.push({
        id, name: "New lane", description: "", color
      });
    });
    fullRender();
    // Focus the new lane name for inline edit
    setTimeout(() => {
      const newLane = document.querySelector(`.lane[data-lane-id="${id}"] [data-role="name"]`);
      if (newLane) {
        newLane.focus();
        document.execCommand && document.execCommand("selectAll", false, null);
      }
    }, 40);
  }

  function deleteLane(laneId) {
    const lane = window.Roadbook.state.findLane(laneId);
    if (!lane) return;
    const itemCount = window.Roadbook.state.currentYear().items.filter((i) => i.laneId === laneId).length;
    if (!confirm(`Delete lane "${lane.name}"${itemCount ? ` and its ${itemCount} item(s)` : ""}?`)) return;
    window.Roadbook.state.commit(() => {
      const y = window.Roadbook.state.currentYear();
      y.lanes = y.lanes.filter((l) => l.id !== laneId);
      y.items = y.items.filter((i) => i.laneId !== laneId);
    });
    fullRender();
    toast(`Deleted "${lane.name}"`);
  }

  // ---------- Color picker ----------
  function openColorPicker(laneId, anchor) {
    document.querySelectorAll(".color-popup").forEach((p) => p.remove());
    const lane = window.Roadbook.state.findLane(laneId);
    if (!lane) return;

    const popup = document.createElement("div");
    popup.className = "color-popup";
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", "Pick lane color");

    window.Roadbook.state.PALETTE.forEach((id) => {
      const sw = document.createElement("button");
      sw.className = "color-swatch" + (id === lane.color ? " active" : "");
      sw.setAttribute("aria-label", id);
      sw.title = id;
      const swatchBg = getComputedStyle(document.documentElement).getPropertyValue(`--lane-${id}`).trim();
      sw.style.background = swatchBg || "#FEFBEF";
      sw.addEventListener("click", (e) => {
        e.stopPropagation();
        window.Roadbook.state.commit(() => { lane.color = id; });
        const laneEl = document.querySelector(`.lane[data-lane-id="${laneId}"]`);
        if (laneEl) laneEl.dataset.color = id;
        popup.remove();
        toast(`${lane.name} · ${id}`);
      });
      popup.appendChild(sw);
    });

    document.body.appendChild(popup);
    const rect = anchor.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    let top = rect.bottom + window.scrollY + 6;
    let left = rect.left + window.scrollX - popupRect.width / 2 + rect.width / 2;
    left = Math.max(8, Math.min(left, document.documentElement.clientWidth - popupRect.width - 8));
    popup.style.top = top + "px";
    popup.style.left = left + "px";

    setTimeout(() => {
      const onOutside = (e) => {
        if (!popup.contains(e.target) && !anchor.contains(e.target)) {
          popup.remove();
          document.removeEventListener("click", onOutside);
        }
      };
      document.addEventListener("click", onOutside);
    }, 0);
  }

  // ---------- Keyboard nav ----------
  function onCardKeydown(e) {
    const card = e.target.closest && e.target.closest(".card");
    if (!card) return;
    const id = card.dataset.id;
    const item = window.Roadbook.state.findItem(id);
    if (!item) return;

    if (window.Roadbook.modal.isOpen()) return;

    if (e.key === "Enter") { e.preventDefault(); window.Roadbook.modal.open(id); return; }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (confirm(`Delete "${item.title}"?`)) {
        const lane = item.laneId;
        window.Roadbook.state.commit(() => {
          const y = window.Roadbook.state.currentYear();
          y.items = y.items.filter((i) => i.id !== id);
        });
        card.remove();
        resizeLaneBody(lane);
        toast("Deleted");
      }
      return;
    }

    const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (!arrows.includes(e.key)) return;
    e.preventDefault();

    if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const delta = e.key === "ArrowRight" ? 1 : -1;
      const newSpan = Math.max(1, Math.min(COLS + 1 - item.start, item.span + delta));
      if (newSpan !== item.span) {
        window.Roadbook.state.commit(() => { item.span = newSpan; });
        updateCardDom(item);
      }
      return;
    }

    let { start, row, laneId } = item;
    if (e.key === "ArrowLeft") start = Math.max(1, start - 1);
    if (e.key === "ArrowRight") start = Math.min(COLS + 1 - item.span, start + 1);
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const y = window.Roadbook.state.currentYear();
      const idx = y.lanes.findIndex((l) => l.id === laneId);
      if (e.key === "ArrowUp" && row > 0) {
        row -= 1;
      } else if (e.key === "ArrowUp" && idx > 0) {
        laneId = y.lanes[idx - 1].id;
      } else if (e.key === "ArrowDown") {
        // Within current lane: bump row; if at the (visual) bottom, move to next lane.
        if (idx < y.lanes.length - 1) {
          // Heuristic: holding ArrowDown moves between lanes when row 0 in next lane is free
          row += 1;
        }
      }
    }

    const oldLane = item.laneId;
    if (start !== item.start || row !== item.row || laneId !== item.laneId) {
      window.Roadbook.state.commit(() => {
        item.start = start;
        item.row = row;
        item.laneId = laneId;
      });
      if (oldLane !== laneId) {
        replaceCard(item, oldLane);
        resizeLaneBody(oldLane);
      } else {
        updateCardDom(item);
      }
      resizeLaneBody(laneId);
      const newCard = document.querySelector(`.card[data-id="${id}"]`);
      if (newCard) newCard.focus();
    }
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg, error = false) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.toggle("error", !!error);
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
    const s = document.getElementById("status");
    if (s) s.textContent = msg;
  }

  function refreshUndoRedo() {
    const u = document.getElementById("undoBtn");
    const r = document.getElementById("redoBtn");
    if (u) u.disabled = !window.Roadbook.state.canUndo();
    if (r) r.disabled = !window.Roadbook.state.canRedo();
  }

  // ---------- Wire top controls ----------
  function wireTop() {
    document.querySelectorAll(".year-pill").forEach((p) => {
      p.addEventListener("click", () => {
        window.Roadbook.state.setActiveYear(p.dataset.year);
        fullRender();
      });
    });

    bindEditable(document.getElementById("title"), (v) => window.Roadbook.state.setTitle(v));
    bindEditable(document.getElementById("eyebrow"), (v) => window.Roadbook.state.setEyebrow(v));

    document.getElementById("addLane").addEventListener("click", addLane);

    document.getElementById("reset").addEventListener("click", () => {
      window.Roadbook.templates.open();
    });

    document.getElementById("undoBtn").addEventListener("click", () => {
      if (window.Roadbook.state.undo()) { fullRender(); toast("Undo"); }
    });
    document.getElementById("redoBtn").addEventListener("click", () => {
      if (window.Roadbook.state.redo()) { fullRender(); toast("Redo"); }
    });

    document.getElementById("themeBtn").addEventListener("click", () => {
      const cur = window.Roadbook.state.get().theme;
      const next = cur === "dark" ? "light" : "dark";
      window.Roadbook.state.setTheme(next);
      document.body.setAttribute("data-theme", next);
      toast(`${next === "dark" ? "Dark" : "Light"} mode`);
    });

    document.getElementById("exportBtn").addEventListener("click", () => window.Roadbook.share.exportJson());
    document.getElementById("importBtn").addEventListener("click", () => window.Roadbook.share.triggerImport());
    document.getElementById("importFile").addEventListener("change", (e) => window.Roadbook.share.handleImport(e));
    document.getElementById("shareLink").addEventListener("click", () => window.Roadbook.share.copyShareLink());
    document.getElementById("sharePng").addEventListener("click", () => window.Roadbook.share.copyPng());
    document.getElementById("shareSvg").addEventListener("click", () => window.Roadbook.share.downloadSvg());

    const accentInput = document.getElementById("accentInput");
    document.getElementById("accentBtn").addEventListener("click", () => accentInput.click());
    accentInput.value = window.Roadbook.state.get().accent;
    accentInput.addEventListener("input", (e) => {
      const v = e.target.value;
      window.Roadbook.state.setAccent(v);
      document.documentElement.style.setProperty("--accent", v);
    });

    document.getElementById("tCancel").addEventListener("click", () => window.Roadbook.templates.close());
    document.getElementById("templateOverlay").addEventListener("click", (e) => {
      if (e.target.id === "templateOverlay") window.Roadbook.templates.close();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (window.Roadbook.modal.isOpen()) window.Roadbook.modal.close();
        const tpl = document.getElementById("templateOverlay");
        if (tpl.classList.contains("show")) window.Roadbook.templates.close();
      }
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "z") {
        if (window.Roadbook.modal.isOpen()) return;
        e.preventDefault();
        if (e.shiftKey) {
          if (window.Roadbook.state.redo()) { fullRender(); toast("Redo"); }
        } else {
          if (window.Roadbook.state.undo()) { fullRender(); toast("Undo"); }
        }
      }
    });

    document.addEventListener("keydown", onCardKeydown);
  }

  // ---------- Init ----------
  function init() {
    window.Roadbook.state.load();

    // If hash carries data, replace state from hash before first render
    if (window.Roadbook.share.maybeLoadFromHash()) {
      // already loaded
    }

    // First-run if everything is blank
    const s = window.Roadbook.state.get();
    const noLanes2026 = !s.data["2026"].lanes.length;
    const noLanes2027 = !s.data["2027"].lanes.length;
    if (noLanes2026 && noLanes2027) {
      // Seed with the BLANK defaults from defaults.js so the user sees a layout
      window.Roadbook.state.replaceAll({
        title: "Roadbook",
        eyebrow: "Product · 2026",
        activeYear: "2026",
        data: {
          "2026": window.Roadbook.defaults.BLANK_2026,
          "2027": window.Roadbook.defaults.BLANK_2027
        }
      });
      setTimeout(() => window.Roadbook.templates.open(), 200);
    }

    document.documentElement.style.setProperty("--accent", s.accent);
    document.body.setAttribute("data-theme", s.theme);

    wireTop();
    window.Roadbook.modal.wire();
    fullRender();
  }

  window.Roadbook = window.Roadbook || {};
  window.Roadbook.app = {
    fullRender,
    placeItem,
    updateCardDom,
    replaceCard,
    resizeLaneBody,
    toast
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
