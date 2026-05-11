// drag.js — pointer-event drag, drop, resize.
// Drag/resize snap to 14-day boundaries from Jan 1 of the active year.
// Move preserves duration; resize changes endDate only.
(function () {
  const ROW_H = 34;

  let dragState = null;

  function attachCard(card) {
    card.addEventListener("pointerdown", onPointerDown);
    const handle = card.querySelector(".resize");
    if (handle) handle.addEventListener("pointerdown", onResizeStart);
  }

  function activeYearInt() {
    return parseInt(window.Roadbook.state.get().activeYear, 10) || 2026;
  }
  function yearDays() {
    return window.Roadbook.dates.daysInYear(activeYearInt());
  }

  // ---------- Resize ----------
  function onResizeStart(e) {
    e.preventDefault();
    e.stopPropagation();
    const card = e.currentTarget.closest(".card");
    if (!card) return;
    const body = card.closest(".lane-body");
    const rect = body.getBoundingClientRect();
    const item = window.Roadbook.state.findItem(card.dataset.id);
    if (!item) return;

    card.setPointerCapture(e.pointerId);
    dragState = {
      mode: "resize",
      id: card.dataset.id,
      pointerId: e.pointerId,
      startX: e.clientX,
      bodyRect: rect,
      initialEnd: item.endDate,
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
    const year = activeYearInt();
    const dates = window.Roadbook.dates;
    const totalDays = yearDays();
    const dx = e.clientX - dragState.startX;
    const daysDelta = Math.round((dx / dragState.bodyRect.width) * totalDays);
    let newEnd = dates.addDaysIso(dragState.initialEnd, daysDelta);
    // Snap end to 14-day grid (aligned to start)
    const startDay = dates.dayOfYear(item.startDate);
    let endDay = dates.dayOfYear(newEnd);
    const minEndDay = startDay + dates.SNAP_DAYS - 1;
    if (endDay < minEndDay) endDay = minEndDay;
    // Quantize span to multiples of SNAP_DAYS
    const span = endDay - startDay + 1;
    const snappedSpan = Math.max(dates.SNAP_DAYS, Math.round(span / dates.SNAP_DAYS) * dates.SNAP_DAYS);
    endDay = Math.min(totalDays, startDay + snappedSpan - 1);
    newEnd = dates.isoFromYMD(year, 1, 1);
    newEnd = dates.addDaysIso(newEnd, endDay - 1);

    if (newEnd !== item.endDate) {
      window.Roadbook.state.commitSilent(() => { item.endDate = newEnd; });
      window.Roadbook.app.updateCardDom(item);
    }
  }

  function onResizeEnd(e) {
    if (!dragState) return;
    try { e.currentTarget.releasePointerCapture(dragState.pointerId); } catch (_) {}
    e.currentTarget.removeEventListener("pointermove", onResizeMove);
    e.currentTarget.removeEventListener("pointerup", onResizeEnd);
    e.currentTarget.removeEventListener("pointercancel", onResizeEnd);
    window.Roadbook.state.snapshot();
    dragState = null;
  }

  // ---------- Move ----------
  function onPointerDown(e) {
    if (e.target.classList && e.target.classList.contains("resize")) return;
    if (e.button !== 0 && e.button !== undefined && e.pointerType === "mouse") return;
    const card = e.currentTarget;
    const id = card.dataset.id;
    const item = window.Roadbook.state.findItem(id);
    if (!item) return;

    const body = card.closest(".lane-body");
    const startRect = body.getBoundingClientRect();

    dragState = {
      mode: "move",
      id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      bodyRect: startRect,
      originStart: item.startDate,
      originEnd: item.endDate,
      originLane: item.laneId,
      originRow: item.row,
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

    const laneEl = elementLaneBodyAt(e.clientX, e.clientY);
    if (!laneEl) return;
    const rect = laneEl.getBoundingClientRect();
    const dates = window.Roadbook.dates;
    const year = activeYearInt();
    const totalDays = yearDays();
    const item = window.Roadbook.state.findItem(dragState.id);
    if (!item) return;
    const span = dates.diffDays(dragState.originStart, dragState.originEnd); // inclusive count = span+1 days

    // Determine new startDate from x position
    const xInLane = e.clientX - rect.left;
    let dayIndex = Math.floor((xInLane / rect.width) * totalDays);
    if (dayIndex < 0) dayIndex = 0;
    // Snap to nearest 14-day boundary
    const snapped = Math.round(dayIndex / dates.SNAP_DAYS) * dates.SNAP_DAYS;
    let newStartDay = Math.min(totalDays - span - 1, Math.max(0, snapped));
    let newStartDate = dates.isoFromYMD(year, 1, 1);
    newStartDate = dates.addDaysIso(newStartDate, newStartDay);
    const newEndDate = dates.addDaysIso(newStartDate, span);

    // Row
    const y = e.clientY - rect.top;
    const row = Math.max(0, Math.floor(y / ROW_H));

    showGhost(laneEl, newStartDate, newEndDate, row);
    dragState.dropTarget = {
      laneId: laneEl.dataset.lane,
      startDate: newStartDate,
      endDate: newEndDate,
      row
    };
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
      dragState = null;
      window.Roadbook.modal.open(card.dataset.id);
      return;
    }

    if (drop) {
      const item = window.Roadbook.state.findItem(dragState.id);
      if (item) {
        const oldLane = item.laneId;
        const changed = (
          item.startDate !== drop.startDate ||
          item.endDate !== drop.endDate ||
          item.row !== drop.row ||
          item.laneId !== drop.laneId
        );
        if (changed) {
          window.Roadbook.state.commit(() => {
            item.startDate = drop.startDate;
            item.endDate = drop.endDate;
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

  function showGhost(body, startDate, endDate, row) {
    document.querySelectorAll(".ghost").forEach((g) => g.classList.remove("show"));
    const g = body.querySelector(".ghost");
    if (!g) return;
    const dates = window.Roadbook.dates;
    const totalDays = yearDays();
    const startDay = dates.dayOfYear(startDate);
    const endDay = dates.dayOfYear(endDate);
    const spanDays = endDay - startDay + 1;
    g.style.left = `calc((${startDay} - 1) * (100% / ${totalDays}))`;
    g.style.width = `calc(${spanDays} * (100% / ${totalDays}) - 6px)`;
    g.style.top = `${row * ROW_H}px`;
    g.classList.add("show");
  }
  function hideGhosts() {
    document.querySelectorAll(".ghost").forEach((g) => g.classList.remove("show"));
  }

  window.Roadbook = window.Roadbook || {};
  window.Roadbook.drag = { attachCard, ROW_H };
})();
