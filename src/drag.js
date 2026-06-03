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
      copy: e.ctrlKey || e.metaKey, // ctrl/cmd-drag duplicates instead of moving
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
    // Track the copy modifier live so toggling ctrl/cmd mid-drag updates intent.
    dragState.copy = e.ctrlKey || e.metaKey;
    dragState.card.classList.toggle("copying", dragState.copy);

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

    // Row from card top in target body (mirrors how X uses the card's left edge).
    // Two edge bands let you GROW the lane instead of only landing on existing
    // rows: dropping near the top edge inserts a new row above everything
    // (row -1 → compaction renumbers it to 0 and pushes the rest down), and
    // dropping at/below the last row appends a new bottom row (row = rowCount).
    // Anything between shares an existing row, as before. setGrowPreview opens a
    // one-row drop gutter so the new slot is visible and reachable mid-drag.
    const tgtLaneId = targetBody.dataset.lane;
    const others = window.Roadbook.state.currentYear().items
      .filter((i) => i.laneId === tgtLaneId && i.id !== dragState.id);
    const rowCount = others.length ? Math.max(...others.map((i) => i.row)) + 1 : 0;

    const yInTarget = cardTopScreen - targetRect.top;
    const EDGE = 9; // px band at the very top edge meaning "insert above"
    let row, growMode = "none";
    if (rowCount > 0 && yInTarget < EDGE) {
      row = -1; growMode = "above";
    } else {
      row = Math.max(0, Math.min(rowCount, Math.floor(yInTarget / ROW_H)));
      if (row >= rowCount) growMode = "below";
    }
    setGrowPreview(targetBody, rowCount, growMode);

    showGhostByDays(targetBody, newStartDay + 1, newStartDay + spanDays, row < 0 ? 0 : row);
    dragState.dropTarget = {
      laneId: tgtLaneId,
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
    card.classList.remove("dragging", "copying");
    hideGhosts();
    clearGrowPreview();
    clearTargetLane();

    if (!dragging) {
      dragState = null;
      window.Roadbook.modal.open(card.dataset.id);
      return;
    }

    if (drop) {
      const item = window.Roadbook.state.findItem(dragState.id);
      if (item && dragState.copy) {
        duplicateItem(item, drop);
      } else if (item) {
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

  // ctrl/cmd-drag: drop a clone of the item at the target, leaving the original
  // untouched. The original's card stays in the DOM (its state never changed);
  // we just render the new clone and re-pack the affected lanes.
  function duplicateItem(item, drop) {
    const originLane = item.laneId;
    const newId = window.Roadbook.state.uid("it");
    const ok = window.Roadbook.state.commit(() => {
      const y = window.Roadbook.state.currentYear();
      const clone = Object.assign({}, item, {
        id: newId,
        startDate: drop.startDate,
        endDate: drop.endDate,
        row: drop.row,
        laneId: drop.laneId
      });
      y.items.push(clone);
      window.Roadbook.app.compactLaneRows(drop.laneId);
    });
    if (ok === false) return; // read-only / blocked
    const cloneItem = window.Roadbook.state.findItem(newId);
    const cloneCard = window.Roadbook.app.placeItem(cloneItem);
    if (cloneCard) attachCard(cloneCard);
    window.Roadbook.app.syncLaneCardRows(drop.laneId);
    window.Roadbook.app.syncLaneCardRows(originLane);
    window.Roadbook.app.resizeLaneBody(drop.laneId);
    window.Roadbook.app.resizeLaneBody(originLane);
    if (cloneCard) cloneCard.focus();
    window.Roadbook.app.toast("Duplicated");
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

  // ----- Grow preview: opens a one-row drop gutter at the top or bottom edge of
  // the hovered lane so a new row is visible and droppable while dragging.
  let growState = null; // { body, mode }
  function setGrowPreview(body, rowCount, mode) {
    if (growState && growState.body !== body) clearGrowPreview();
    if (mode === "none") { clearGrowPreview(); return; }
    body.style.transition = "none"; // snap the gutter open during drag, no lag
    body.classList.toggle("grow-above", mode === "above");
    body.classList.toggle("grow-below", mode === "below");
    body.style.minHeight = ((rowCount + 1) * ROW_H) + "px"; // room for the new slot
    growState = { body, mode };
  }
  function clearGrowPreview() {
    if (!growState) return;
    const body = growState.body;
    body.classList.remove("grow-above", "grow-below");
    body.style.transition = "";
    growState = null;
    // Restore the natural height (animates closed); a commit re-resizes anyway.
    if (window.Roadbook.app && window.Roadbook.app.resizeLaneBody) {
      window.Roadbook.app.resizeLaneBody(body.dataset.lane);
    }
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
