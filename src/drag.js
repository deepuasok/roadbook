// drag.js — pointer-event drag, drop, resize.
//
// UX: during drag/resize, the card follows the cursor smoothly via CSS transform
// (move) or live --span-days (resize). A ghost outline previews the 14-day snap
// target. On pointerup, state commits to the snap target and the card lands.
// This keeps the visual feedback continuous while the data stays clean to a
// 2-week grid measured from Jan 1 of the active year.
(function () {
  const ROW_H = 34;
  const DRAG_THRESHOLD = 4; // px before drag activates (so clicks still register)

  let dragState = null;
  // Drop intent hook — called before state.commit at each commit site
  // (move, resize-end, resize-start). Receives (item, kind, patch). If the
  // handler returns false, the commit is skipped and the card snaps back to
  // its original DOM position. Used by the cloud build to capture a drag as
  // a proposal when the user is a collaborator. Null-default keeps OSS
  // behavior identical.
  let onDropIntentFn = null;
  function setOnDropIntent(fn) { onDropIntentFn = typeof fn === "function" ? fn : null; }
  function fireDropIntent(item, kind, patch) {
    if (!onDropIntentFn) return true;
    try { return onDropIntentFn(item, kind, patch) !== false; }
    catch (e) { console.error("[drag] onDropIntent threw:", e); return true; }
  }

  function attachCard(card) {
    card.addEventListener("pointerdown", onPointerDown);
    const handleEnd = card.querySelector(".resize");
    const handleStart = card.querySelector(".resize-start");
    if (handleEnd) handleEnd.addEventListener("pointerdown", (e) => onResizeStart(e, "end"));
    if (handleStart) handleStart.addEventListener("pointerdown", (e) => onResizeStart(e, "start"));
  }

  function activeYearInt() {
    return parseInt(window.Roadbook.state.get().activeYear, 10) || 2026;
  }
  function yearDays() {
    return window.Roadbook.dates.daysInYear(activeYearInt());
  }
  function dayDistanceFromPixels(dx, bodyWidth) {
    const totalDays = yearDays();
    return Math.round((dx / bodyWidth) * totalDays);
  }

  // ----------------------------- RESIZE -----------------------------
  // `side` is "end" (right handle, changes endDate) or "start" (left handle,
  // changes startDate). Same handler family for both; the math swaps based on side.
  function onResizeStart(e, side) {
    e.preventDefault();
    e.stopPropagation();
    const card = e.currentTarget.closest(".card");
    if (!card) return;
    const body = card.closest(".lane-body");
    const item = window.Roadbook.state.findItem(card.dataset.id);
    if (!item) return;
    const dates = window.Roadbook.dates;

    const bodyRect = body.getBoundingClientRect();
    const startDay = dates.dayOfYear(item.startDate);
    const endDay = dates.dayOfYear(item.endDate);

    try { card.setPointerCapture(e.pointerId); } catch (_) {}
    card.classList.add("resizing");

    dragState = {
      mode: "resize",
      side, // "start" or "end"
      id: card.dataset.id,
      pointerId: e.pointerId,
      startX: e.clientX,
      bodyRect,
      body,
      initialStartDay: startDay,
      initialEndDay: endDay,
      currentStartDay: startDay,
      currentEndDay: endDay,
      card
    };

    // setPointerCapture redirects subsequent pointer events to `card`, so the
    // move/up listeners must be on `card` — not on the resize handle (a child).
    card.addEventListener("pointermove", onResizeMove);
    card.addEventListener("pointerup", onResizeEnd);
    card.addEventListener("pointercancel", onResizeEnd);
  }

  function onResizeMove(e) {
    if (!dragState || dragState.mode !== "resize") return;
    const dates = window.Roadbook.dates;
    const totalDays = yearDays();
    const SNAP = dates.SNAP_DAYS;
    const dx = e.clientX - dragState.startX;
    const daysDelta = dayDistanceFromPixels(dx, dragState.bodyRect.width);
    const row = parseInt(dragState.card.style.getPropertyValue("--row"), 10) || 0;

    if (dragState.side === "end") {
      // Right edge — change endDay; keep startDay fixed. Min span 14 days.
      const minEnd = dragState.initialStartDay + SNAP - 1;
      const targetEnd = Math.max(minEnd, Math.min(totalDays, dragState.initialEndDay + daysDelta));
      const newSpan = targetEnd - dragState.initialStartDay + 1;
      dragState.card.style.setProperty("--span-days", newSpan);
      dragState.currentEndDay = targetEnd;
      const snappedSpan = Math.max(SNAP, Math.round(newSpan / SNAP) * SNAP);
      const snappedEnd = Math.min(totalDays, dragState.initialStartDay + snappedSpan - 1);
      showGhostByDays(dragState.body, dragState.initialStartDay, snappedEnd, row);
    } else {
      // Left edge — change startDay; keep endDay fixed. Min span 14 days.
      const maxStart = dragState.initialEndDay - SNAP + 1;
      const targetStart = Math.max(1, Math.min(maxStart, dragState.initialStartDay + daysDelta));
      const newSpan = dragState.initialEndDay - targetStart + 1;
      dragState.card.style.setProperty("--start-day", targetStart);
      dragState.card.style.setProperty("--span-days", newSpan);
      dragState.currentStartDay = targetStart;
      // Snap preview: round the start to nearest SNAP, then ghost shows the snapped position.
      const dayIndex = targetStart - 1; // 0-based for snap math
      const snappedStartDay = Math.max(0, Math.min(
        dragState.initialEndDay - SNAP,
        Math.round(dayIndex / SNAP) * SNAP
      )) + 1; // back to 1-based
      showGhostByDays(dragState.body, snappedStartDay, dragState.initialEndDay, row);
    }
  }

  function onResizeEnd(e) {
    if (!dragState) return;
    const dates = window.Roadbook.dates;
    const item = window.Roadbook.state.findItem(dragState.id);
    const card = dragState.card;
    try { card.releasePointerCapture(dragState.pointerId); } catch (_) {}
    card.removeEventListener("pointermove", onResizeMove);
    card.removeEventListener("pointerup", onResizeEnd);
    card.removeEventListener("pointercancel", onResizeEnd);
    hideGhosts();
    card.classList.remove("resizing");

    if (item) {
      const totalDays = yearDays();
      const SNAP = dates.SNAP_DAYS;
      const year = activeYearInt();
      const yearStart = dates.isoFromYMD(year, 1, 1);

      if (dragState.side === "end") {
        const currentSpan = dragState.currentEndDay - dragState.initialStartDay + 1;
        const snappedSpan = Math.max(SNAP, Math.round(currentSpan / SNAP) * SNAP);
        const finalEnd = Math.min(totalDays, dragState.initialStartDay + snappedSpan - 1);
        const newEndDate = dates.addDaysIso(yearStart, finalEnd - 1);
        if (newEndDate !== item.endDate) {
          if (fireDropIntent(item, "resize-end", { endDate: newEndDate })) {
            window.Roadbook.state.commit(() => { item.endDate = newEndDate; });
          }
        }
      } else {
        // Snap startDay to nearest 14-day boundary; preserve endDate
        const dayIndex = dragState.currentStartDay - 1;
        const snappedStartDay = Math.max(0, Math.min(
          dragState.initialEndDay - SNAP,
          Math.round(dayIndex / SNAP) * SNAP
        )) + 1;
        const newStartDate = dates.addDaysIso(yearStart, snappedStartDay - 1);
        if (newStartDate !== item.startDate) {
          if (fireDropIntent(item, "resize-start", { startDate: newStartDate })) {
            window.Roadbook.state.commit(() => { item.startDate = newStartDate; });
          }
        }
      }
      window.Roadbook.app.updateCardDom(item);
    }
    dragState = null;
  }

  // ----------------------------- MOVE -----------------------------
  function onPointerDown(e) {
    if (e.target.classList && (e.target.classList.contains("resize") || e.target.classList.contains("resize-start"))) return;
    if (e.button !== 0 && e.button !== undefined && e.pointerType === "mouse") return;
    const card = e.currentTarget;
    const item = window.Roadbook.state.findItem(card.dataset.id);
    if (!item) return;

    const body = card.closest(".lane-body");
    const cardRect = card.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();

    // Snapshot every lane body's Y range once at drag start. Doing this on
    // each pointermove was the source of jitter — DOM rects can shift if a
    // lane resizes mid-drag. The index is authoritative until pointerup.
    const laneIndex = buildLaneIndex();
    const originLaneEntry = laneIndex.find((l) => l.laneId === item.laneId) || laneIndex[0];

    dragState = {
      mode: "move",
      id: card.dataset.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      cardScreenLeft: cardRect.left,
      cardScreenTop: cardRect.top,
      cardWidth: cardRect.width,
      cardHeight: cardRect.height,
      originLane: item.laneId,
      originLaneEntry,
      laneIndex,
      originStartDate: item.startDate,
      originEndDate: item.endDate,
      originRow: item.row,
      card
    };

    try { card.setPointerCapture(e.pointerId); } catch (_) {}
    card.addEventListener("pointermove", onPointerMove);
    card.addEventListener("pointerup", onPointerUp);
    card.addEventListener("pointercancel", onPointerUp);
  }

  function onPointerMove(e) {
    if (!dragState || dragState.mode !== "move") return;
    const dx = e.clientX - dragState.startClientX;
    const dy = e.clientY - dragState.startClientY;

    if (!dragState.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!dragState.dragging) {
      dragState.dragging = true;
      dragState.card.classList.add("dragging");
    }

    // 1. Smooth visual follow via transform
    dragState.card.style.transform = `translate(${dx}px, ${dy}px)`;

    // 2. Detect the lane using the card's visual center against the indexed
    // lane Y ranges, with hysteresis against the origin lane. Switching only
    // commits when the card center crosses past a different lane's midpoint —
    // not on every boundary nudge — which kills the "small wobble flips
    // swimlane" feel that vanilla boundary detection produces.
    const cardLeftScreen = dragState.cardScreenLeft + dx;
    const cardTopScreen = dragState.cardScreenTop + dy;
    const cardCenterY = cardTopScreen + dragState.cardHeight / 2;
    const targetEntry = pickLane(cardCenterY, dragState.originLaneEntry, dragState.laneIndex);
    if (!targetEntry) return;
    const targetBody = targetEntry.body;
    setTargetLane(targetBody);

    const targetRect = { top: targetEntry.top, left: targetEntry.left, width: targetEntry.width };
    const dates = window.Roadbook.dates;
    const year = activeYearInt();
    const totalDays = yearDays();
    const SNAP = dates.SNAP_DAYS;
    const spanDays = dates.diffDays(dragState.originStartDate, dragState.originEndDate) + 1;

    // Card visual left edge in screen space (transform applied)
    const xInTarget = cardLeftScreen - targetRect.left;
    let dayIndex = Math.floor((xInTarget / targetRect.width) * totalDays);
    const snappedDay = Math.round(dayIndex / SNAP) * SNAP;
    const newStartDay = Math.max(0, Math.min(totalDays - spanDays, snappedDay));
    const yearStart = dates.isoFromYMD(year, 1, 1);
    const newStartDate = dates.addDaysIso(yearStart, newStartDay);
    const newEndDate = dates.addDaysIso(newStartDate, spanDays - 1);

    // Row from card top in target body (mirrors how X uses the card's left edge)
    const yInTarget = cardTopScreen - targetRect.top;
    const row = Math.max(0, Math.floor(yInTarget / ROW_H));

    showGhostByDays(targetBody, newStartDay + 1, newStartDay + spanDays, row);
    dragState.dropTarget = {
      laneId: targetBody.dataset.lane,
      startDate: newStartDate,
      endDate: newEndDate,
      row
    };
  }

  function onPointerUp(e) {
    if (!dragState) return;
    const card = dragState.card;
    const dragging = dragState.dragging;
    const drop = dragState.dropTarget;

    try { card.releasePointerCapture(dragState.pointerId); } catch (_) {}
    card.removeEventListener("pointermove", onPointerMove);
    card.removeEventListener("pointerup", onPointerUp);
    card.removeEventListener("pointercancel", onPointerUp);

    // Clear visual transform so the card settles into its DOM position
    card.style.transform = "";
    card.classList.remove("dragging");
    hideGhosts();
    clearTargetLane();

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
          const patch = {
            startDate: drop.startDate,
            endDate: drop.endDate,
            row: drop.row,
            laneId: drop.laneId
          };
          if (fireDropIntent(item, "move", patch)) {
            window.Roadbook.state.commit(() => {
              item.startDate = patch.startDate;
              item.endDate = patch.endDate;
              item.row = patch.row;
              item.laneId = patch.laneId;
              window.Roadbook.app.compactLaneRows(oldLane);
              if (drop.laneId !== oldLane) window.Roadbook.app.compactLaneRows(drop.laneId);
            });
          }
        }
        const newCard = window.Roadbook.app.replaceCard(item, oldLane);
        if (newCard) attachCard(newCard);
        window.Roadbook.app.syncLaneCardRows(oldLane);
        window.Roadbook.app.syncLaneCardRows(drop.laneId);
        window.Roadbook.app.resizeLaneBody(oldLane);
        window.Roadbook.app.resizeLaneBody(drop.laneId);
      }
    }
    dragState = null;
  }

  // ----------------------------- Helpers -----------------------------
  // Build a snapshot of every lane body's geometry. Used as the authoritative
  // hit-test source for the lifetime of one drag, so DOM reflow mid-drag can't
  // confuse lane selection.
  function buildLaneIndex() {
    const bodies = document.querySelectorAll(".lane-body");
    const index = [];
    for (const body of bodies) {
      const r = body.getBoundingClientRect();
      index.push({
        laneId: body.dataset.lane,
        body,
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        width: r.width,
        height: r.height,
        mid: r.top + r.height / 2
      });
    }
    index.sort((a, b) => a.top - b.top);
    return index;
  }

  // Pick the lane the card should snap to, given the card's vertical center
  // and the origin lane. Hysteresis: switching away from origin only commits
  // when the card center has crossed past the target lane's midpoint, not
  // merely past its top/bottom edge. This mirrors Bryntum/Smartsheet behavior
  // and prevents the "small wobble flips swimlane" feel.
  function pickLane(centerY, origin, index) {
    if (!index.length) return origin;
    if (!origin) origin = index[0];

    // Naive pick — the lane the center is actually in, or the nearest lane
    // if the center sits in a gap (lane header strip / divider).
    let naive = null;
    for (const lane of index) {
      if (centerY >= lane.top && centerY <= lane.bottom) { naive = lane; break; }
    }
    if (!naive) {
      let bestDist = Infinity;
      for (const lane of index) {
        const d = centerY < lane.top ? lane.top - centerY : centerY - lane.bottom;
        if (d < bestDist) { bestDist = d; naive = lane; }
      }
    }
    if (!naive || naive.laneId === origin.laneId) return origin;

    // Hysteresis: a non-origin lane only wins when the card center has
    // crossed past its midpoint.
    if (naive.mid > origin.mid) {
      // Candidate is below origin → need centerY to be at/past its midpoint going down
      return centerY >= naive.mid ? naive : origin;
    }
    // Candidate is above origin → need centerY to be at/past its midpoint going up
    return centerY <= naive.mid ? naive : origin;
  }

  let currentTargetLane = null;
  function setTargetLane(body) {
    if (currentTargetLane === body) return;
    if (currentTargetLane) currentTargetLane.classList.remove("lane-target");
    if (body) body.classList.add("lane-target");
    currentTargetLane = body;
  }
  function clearTargetLane() {
    if (currentTargetLane) currentTargetLane.classList.remove("lane-target");
    currentTargetLane = null;
  }

  // showGhostByDays — startDay/endDay are 1-based day-of-year inclusive
  function showGhostByDays(body, startDay, endDay, row) {
    document.querySelectorAll(".ghost").forEach((g) => g.classList.remove("show"));
    const g = body.querySelector(".ghost");
    if (!g) return;
    const totalDays = yearDays();
    const spanDays = Math.max(1, endDay - startDay + 1);
    g.style.left = `calc((${startDay} - 1) * (100% / ${totalDays}))`;
    g.style.width = `calc(${spanDays} * (100% / ${totalDays}) - 6px)`;
    g.style.top = `${row * ROW_H}px`;
    g.classList.add("show");
  }
  function hideGhosts() {
    document.querySelectorAll(".ghost").forEach((g) => g.classList.remove("show"));
  }

  window.Roadbook = window.Roadbook || {};
  window.Roadbook.drag = { attachCard, ROW_H, setOnDropIntent };
})();
