// app.js — main entry: render lanes/cards, wire top controls, keyboard nav
(function () {
  const ROW_H = 34;
  const NARROW_DAYS = 20;  // below ~3 weeks: hide meta entirely
  const MEDIUM_DAYS = 60;  // below ~2 months: compact mode (drop status dot)

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
    // Set --year-days for date-based card positioning
    const yearInt = parseInt(s.activeYear, 10) || 2026;
    const yearDays = window.Roadbook.dates.daysInYear(yearInt);
    container.style.setProperty("--year-days", yearDays);

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

  function spanInfo(item) {
    const dates = window.Roadbook.dates;
    const startDay = dates.dayOfYear(item.startDate);
    const endDay = dates.dayOfYear(item.endDate);
    const spanDays = Math.max(1, endDay - startDay + 1);
    return { startDay, endDay, spanDays };
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
    const { startDay, spanDays } = spanInfo(item);
    card.style.setProperty("--start-day", startDay);
    card.style.setProperty("--span-days", spanDays);
    card.style.setProperty("--row", item.row);
    card.style.setProperty("--complete", item.complete || 0);
    if (spanDays < NARROW_DAYS) card.dataset.narrow = "true";
    if (spanDays < MEDIUM_DAYS) card.dataset.compact = "true";
    card.setAttribute("aria-label",
      `${item.title}, ${item.status}, ${item.startDate} to ${item.endDate}, ${spanDays} days`);
    card.innerHTML = `
      <div class="fill"></div>
      <div class="resize-start" aria-hidden="true"></div>
      <span class="dot" aria-hidden="true"></span>
      <span class="title"></span>
      <span class="meta"></span>
      <div class="resize" aria-hidden="true"></div>
      <div class="done-badge" aria-hidden="true" hidden>
        <svg viewBox="0 0 12 12" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.2L5 8.4l4-4.6"/></svg>
      </div>
    `;
    card.querySelector(".title").textContent = item.title;
    card.querySelector(".meta").innerHTML = renderMeta(item);
    const badge = card.querySelector(".done-badge");
    if (badge) badge.hidden = (item.complete || 0) < 100;
    window.Roadbook.drag.attachCard(card);
    body.appendChild(card);
    return card;
  }

  function renderMeta(item) {
    const dates = window.Roadbook.dates;
    const spanDays = dates ? dates.diffDays(item.startDate, item.endDate) + 1 : 999;
    const parts = [];
    // Only show % on wider chips so narrower ones have room for title + date
    if (spanDays >= 90 && item.complete && item.complete > 0) {
      parts.push(`<span class="pct">${item.complete}%</span>`);
    }
    if (item.endDate) parts.push(escapeHtml(fmtDate(item.endDate)));
    return parts.join(" · ");
  }

  function updateCardDom(item) {
    const card = document.querySelector(`.card[data-id="${item.id}"]`);
    if (!card) return;
    card.dataset.status = item.status;
    card.dataset.type = item.type;
    card.dataset.complete = String(item.complete || 0);
    const { startDay, spanDays } = spanInfo(item);
    card.style.setProperty("--start-day", startDay);
    card.style.setProperty("--span-days", spanDays);
    card.style.setProperty("--row", item.row);
    card.style.setProperty("--complete", item.complete || 0);
    if (spanDays < NARROW_DAYS) card.dataset.narrow = "true";
    else delete card.dataset.narrow;
    if (spanDays < MEDIUM_DAYS) card.dataset.compact = "true";
    else delete card.dataset.compact;
    card.setAttribute("aria-label",
      `${item.title}, ${item.status}, ${item.startDate} to ${item.endDate}, ${spanDays} days`);
    card.querySelector(".title").textContent = item.title;
    card.querySelector(".meta").innerHTML = renderMeta(item);
    const badge = card.querySelector(".done-badge");
    if (badge) badge.hidden = (item.complete || 0) < 100;
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

  // Collapse empty rows: renumber the rows actually in use to dense 0..n indices
  // so a vacated row doesn't leave a white gap. Pure state mutation — the caller
  // wraps it in commit() and refreshes the DOM. Returns true if anything moved.
  function compactLaneRows(laneId) {
    const items = window.Roadbook.state.currentYear().items.filter((i) => i.laneId === laneId);
    if (!items.length) return false;
    const usedRows = [...new Set(items.map((i) => i.row))].sort((a, b) => a - b);
    const remap = new Map(usedRows.map((r, idx) => [r, idx]));
    let changed = false;
    items.forEach((i) => {
      const next = remap.get(i.row);
      if (next !== i.row) { i.row = next; changed = true; }
    });
    return changed;
  }

  // Push current state rows onto the cards' --row CSS var, for the other cards
  // in a lane that shifted up when compaction removed a row above them.
  function syncLaneCardRows(laneId) {
    const body = document.querySelector(`.lane-body[data-lane="${laneId}"]`);
    if (!body) return;
    body.querySelectorAll(".card").forEach((card) => {
      const item = window.Roadbook.state.findItem(card.dataset.id);
      if (item) card.style.setProperty("--row", item.row);
    });
  }

  // ---------- Mutations ----------
  function addItem(laneId) {
    const id = window.Roadbook.state.uid("it");
    const dates = window.Roadbook.dates;
    const yearInt = parseInt(window.Roadbook.state.get().activeYear, 10) || 2026;
    const startDate = dates.isoFromYMD(yearInt, 1, 1);
    const endDate = dates.addDaysIso(startDate, dates.SNAP_DAYS - 1); // 2 weeks default
    let r = 0;
    window.Roadbook.state.commit(() => {
      const rowsUsed = window.Roadbook.state.currentYear().items
        .filter((i) => i.laneId === laneId && i.startDate === startDate)
        .map((i) => i.row);
      while (rowsUsed.includes(r)) r++;
      window.Roadbook.state.currentYear().items.push({
        id, laneId,
        title: "New item",
        startDate, endDate,
        row: r,
        status: "planned",
        type: "other",
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

    const dates = window.Roadbook.dates;
    const yearInt = parseInt(window.Roadbook.state.get().activeYear, 10) || 2026;
    const totalDays = dates.daysInYear(yearInt);
    const SNAP = dates.SNAP_DAYS;
    const startDay = dates.dayOfYear(item.startDate);
    const endDay = dates.dayOfYear(item.endDate);
    const spanDays = endDay - startDay + 1;

    if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      // Resize: change endDate by ±14 days
      const delta = e.key === "ArrowRight" ? SNAP : -SNAP;
      let newSpan = Math.max(SNAP, spanDays + delta);
      newSpan = Math.min(totalDays - startDay + 1, newSpan);
      const newEnd = dates.addDaysIso(item.startDate, newSpan - 1);
      if (newEnd !== item.endDate) {
        window.Roadbook.state.commit(() => { item.endDate = newEnd; });
        updateCardDom(item);
      }
      return;
    }

    let newStart = item.startDate;
    let row = item.row;
    let laneId = item.laneId;

    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const delta = e.key === "ArrowRight" ? SNAP : -SNAP;
      let nextStartDay = startDay - 1 + delta; // 0-based
      nextStartDay = Math.max(0, Math.min(totalDays - spanDays, nextStartDay));
      newStart = dates.addDaysIso(dates.isoFromYMD(yearInt, 1, 1), nextStartDay);
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const y = window.Roadbook.state.currentYear();
      const idx = y.lanes.findIndex((l) => l.id === laneId);
      if (e.key === "ArrowUp" && row > 0) {
        row -= 1;
      } else if (e.key === "ArrowUp" && idx > 0) {
        laneId = y.lanes[idx - 1].id;
      } else if (e.key === "ArrowDown" && idx < y.lanes.length - 1) {
        row += 1;
      }
    }

    const oldLane = item.laneId;
    const changed = newStart !== item.startDate || row !== item.row || laneId !== item.laneId;
    if (changed) {
      window.Roadbook.state.commit(() => {
        if (newStart !== item.startDate) {
          item.endDate = dates.addDaysIso(newStart, spanDays - 1);
          item.startDate = newStart;
        }
        item.row = row;
        item.laneId = laneId;
        compactLaneRows(oldLane);
        if (laneId !== oldLane) compactLaneRows(laneId);
      });
      if (oldLane !== laneId) {
        replaceCard(item, oldLane);
        syncLaneCardRows(oldLane);
        resizeLaneBody(oldLane);
      } else {
        updateCardDom(item);
      }
      syncLaneCardRows(laneId);
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

    // Share dropdown — toggles a popover with link/png/svg
    const shareBtn = document.getElementById("shareBtn");
    const shareMenu = document.getElementById("shareMenu");
    function closeShareMenu() {
      shareMenu.hidden = true;
      shareBtn.setAttribute("aria-expanded", "false");
    }
    shareBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = shareMenu.hidden;
      shareMenu.hidden = !willOpen;
      shareBtn.setAttribute("aria-expanded", willOpen ? "true" : "false");
      if (willOpen) {
        const onOutside = (ev) => {
          if (!shareMenu.contains(ev.target) && ev.target !== shareBtn && !shareBtn.contains(ev.target)) {
            closeShareMenu();
            document.removeEventListener("click", onOutside);
          }
        };
        setTimeout(() => document.addEventListener("click", onOutside), 0);
      }
    });
    document.getElementById("shareLink").addEventListener("click", () => { closeShareMenu(); window.Roadbook.share.copyShareLink(); });
    document.getElementById("sharePng").addEventListener("click", () => { closeShareMenu(); window.Roadbook.share.copyPng(); });
    document.getElementById("shareSvg").addEventListener("click", () => { closeShareMenu(); window.Roadbook.share.downloadSvg(); });

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
        const sm = document.getElementById("shareMenu");
        if (sm && !sm.hidden) {
          sm.hidden = true;
          document.getElementById("shareBtn").setAttribute("aria-expanded", "false");
        }
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

    // First-run if everything is blank. Skip if a host (e.g. cloud-sync) has
    // set window.__suppressFirstRun — they'll populate state themselves.
    const s = window.Roadbook.state.get();
    const noLanes2026 = !s.data["2026"].lanes.length;
    const noLanes2027 = !s.data["2027"].lanes.length;
    if (noLanes2026 && noLanes2027 && !window.__suppressFirstRun) {
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
    compactLaneRows,
    syncLaneCardRows,
    toast
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
