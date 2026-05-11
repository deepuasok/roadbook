// drag.js — pointer-event drag, drop, resize (works for mouse + touch)
(function () {
  const ROW_H = 34;

  let dragState = null; // { id, pointerId, originLane, originStart, originSpan, originRow, mode: 'move'|'resize' }

  function attachCard(card) {
    card.addEventListener("pointerdown", onPointerDown);
    const handle = card.querySelector(".resize");
    if (handle) handle.addEventListener("pointerdown", onResizeStart);
  }

  function onResizeStart(e) {
    e.preventDefault();
    e.stopPropagation();
    const card = e.currentTarget.closest(".card");
    if (!card) return;
    const body = card.closest(".lane-body");
    const rect = body.getBoundingClientRect();
    const colW = rect.width / 4;
    const item = window.Roadbook.state.findItem(card.dataset.id);
    if (!item) return;

    card.setPointerCapture(e.pointerId);

    dragState = {
      mode: "resize",
      id: card.dataset.id,
      pointerId: e.pointerId,
      startX: e.clientX,
      colW,
      initialSpan: item.span,
      card
    };
    card.classList.add("selected");

    e.currentTarget.addEventListener("pointermove", onResizeMove);
    e.currentTarget.addEventListener("pointerup", onResizeEnd);
    e.currentTarget.addEventListener("pointercancel", onResizeEnd);
  }

  function onResizeMove(e) {
    if (!dragState || dragState.mode !== "resize") return;
    const item = window.Roadbook.state.findItem(dragState.id);
    if (!item) return;
    const dx = e.clientX - dragState.startX;
    const dSpan = Math.round(dx / dragState.colW);
    const newSpan = Math.max(1, Math.min(5 - item.start, dragState.initialSpan + dSpan));
    if (newSpan !== item.span) {
      window.Roadbook.state.commitSilent(() => { item.span = newSpan; });
      dragState.card.style.setProperty("--span", newSpan);
    }
  }

  function onResizeEnd(e) {
    if (!dragState) return;
    try { e.currentTarget.releasePointerCapture(dragState.pointerId); } catch (_) {}
    e.currentTarget.removeEventListener("pointermove", onResizeMove);
    e.currentTarget.removeEventListener("pointerup", onResizeEnd);
    e.currentTarget.removeEventListener("pointercancel", onResizeEnd);
    // Push a single history entry for the whole resize
    window.Roadbook.state.snapshot();
    dragState = null;
  }

  function onPointerDown(e) {
    if (e.target.classList && e.target.classList.contains("resize")) return;
    if (e.button !== 0 && e.button !== undefined && e.pointerType === "mouse") return;
    const card = e.currentTarget;
    const id = card.dataset.id;
    const item = window.Roadbook.state.findItem(id);
    if (!item) return;

    const body = card.closest(".lane-body");
    const startRect = body.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;

    dragState = {
      mode: "move",
      id,
      pointerId: e.pointerId,
      startX, startY,
      originLane: item.laneId,
      originStart: item.start,
      originRow: item.row,
      colW: startRect.width / 4,
      card
    };

    card.setPointerCapture(e.pointerId);
    card.addEventListener("pointermove", onPointerMove);
    card.addEventListener("pointerup", onPointerUp);
    card.addEventListener("pointercancel", onPointerUp);
  }

  function onPointerMove(e) {
    if (!dragState || dragState.mode !== "move") return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (!dragState.dragging && Math.hypot(dx, dy) < 4) return;

    if (!dragState.dragging) {
      dragState.dragging = true;
      dragState.card.classList.add("dragging");
    }

    // Detect the lane currently under the pointer
    const laneEl = elementLaneBodyAt(e.clientX, e.clientY);
    if (!laneEl) return;
    const rect = laneEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const item = window.Roadbook.state.findItem(dragState.id);
    if (!item) return;
    const quarter = Math.max(1, Math.min(4, Math.floor(x / (rect.width / 4)) + 1));
    const row = Math.max(0, Math.floor(y / ROW_H));
    const start = Math.max(1, Math.min(quarter, 5 - item.span));
    showGhost(laneEl, start, item.span, row);
    dragState.dropTarget = { laneId: laneEl.dataset.lane, start, row };
  }

  function onPointerUp(e) {
    if (!dragState) return;
    const card = dragState.card;
    try { card.releasePointerCapture(dragState.pointerId); } catch (_) {}
    card.removeEventListener("pointermove", onPointerMove);
    card.removeEventListener("pointerup", onPointerUp);
    card.removeEventListener("pointercancel", onPointerUp);

    const dragging = dragState.dragging;
    const drop = dragState.dropTarget;
    card.classList.remove("dragging");
    hideGhosts();

    if (!dragging) {
      // Treat as click
      dragState = null;
      window.Roadbook.modal.open(card.dataset.id);
      return;
    }

    if (drop) {
      const item = window.Roadbook.state.findItem(dragState.id);
      if (item) {
        const oldLane = item.laneId;
        const changed = (item.start !== drop.start || item.row !== drop.row || item.laneId !== drop.laneId);
        if (changed) {
          window.Roadbook.state.commit(() => {
            item.start = drop.start;
            item.row = drop.row;
            item.laneId = drop.laneId;
          });
        }
        const newCard = window.Roadbook.app.replaceCard(item, oldLane);
        if (newCard) attachCard(newCard);
        window.Roadbook.app.resizeLaneBody(oldLane);
        window.Roadbook.app.resizeLaneBody(drop.laneId);
      }
    }
    dragState = null;
  }

  function elementLaneBodyAt(x, y) {
    const stack = document.elementsFromPoint(x, y);
    return stack.find((el) => el.classList && el.classList.contains("lane-body")) || null;
  }

  function showGhost(body, start, span, row) {
    document.querySelectorAll(".ghost").forEach((g) => g.classList.remove("show"));
    const g = body.querySelector(".ghost");
    if (!g) return;
    g.style.left = `calc((${start} - 1) * 25%)`;
    g.style.width = `calc(${span} * 25% - 6px)`;
    g.style.top = `${row * ROW_H}px`;
    g.classList.add("show");
  }
  function hideGhosts() {
    document.querySelectorAll(".ghost").forEach((g) => g.classList.remove("show"));
  }

  window.Roadbook = window.Roadbook || {};
  window.Roadbook.drag = { attachCard, ROW_H };
})();
