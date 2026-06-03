// state.js — store, persistence, history (undo/redo)
// Exposes a single global: window.Roadbook.state
(function () {
  const PREFIX = "roadbook";
  const ACCENT_KEY = `${PREFIX}-accent`;
  const THEME_KEY = `${PREFIX}-theme`;
  const META_KEY = `${PREFIX}-meta`;
  const YEAR_KEY = `${PREFIX}-active-year`;
  const LAYOUT_KEY = (y) => `${PREFIX}-layout-${y}`;
  const SCHEMA_VERSION = 3; // v3 = day-precise (startDate/endDate ISO), 14-day drag snap
  const HISTORY_LIMIT = 50;
  const SNAP_DAYS = 14;

  const PALETTE = [
    "cream", "sage", "blush", "mint", "peach", "rose",
    "sky", "lavender", "lemon", "coral", "stone", "periwinkle"
  ];

  const DEFAULTS = {
    title: "Roadbook",
    eyebrow: "Product · 2026",
    accent: "#6366F1",
    theme: "light",
    activeYear: "2026",
    data: {
      "2026": { lanes: [], items: [] },
      "2027": { lanes: [], items: [] }
    }
  };

  const store = {
    title: DEFAULTS.title,
    eyebrow: DEFAULTS.eyebrow,
    accent: DEFAULTS.accent,
    theme: DEFAULTS.theme,
    activeYear: DEFAULTS.activeYear,
    data: {
      "2026": { lanes: [], items: [] },
      "2027": { lanes: [], items: [] }
    },
    history: [],
    historyIndex: -1
  };

  // Storage mode: "local" (default — localStorage) or "memory" (host app
  // manages persistence externally, e.g. Supabase). Default keeps OSS behavior.
  let storageMode = "local";
  let onPersistCallback = null;
  // Mutation gate: when set, called before every commit. Returning false
  // blocks the commit (used by the cloud build to put collaborators into a
  // read-only / propose-only mode). Null-default keeps OSS behavior identical.
  let canCommitFn = null;
  function setStorageMode(mode) { storageMode = mode === "memory" ? "memory" : "local"; }
  function setOnPersist(cb) { onPersistCallback = typeof cb === "function" ? cb : null; }
  function setCanCommit(fn) { canCommitFn = typeof fn === "function" ? fn : null; }

  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

  // ---------- Date utilities ----------
  function isLeap(year) {
    const y = parseInt(year, 10);
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }
  function daysInYear(year) {
    return isLeap(year) ? 366 : 365;
  }
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function isoFromYMD(y, m, d) { return `${y}-${pad2(m)}-${pad2(d)}`; }
  function parseIso(iso) {
    if (typeof iso !== "string") return null;
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (isNaN(d.getTime())) return null;
    return d;
  }
  function isoToDate(iso) { return parseIso(iso); }
  function dateToIso(d) {
    return isoFromYMD(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  function addDaysIso(iso, n) {
    const d = parseIso(iso);
    if (!d) return iso;
    d.setUTCDate(d.getUTCDate() + n);
    return dateToIso(d);
  }
  function dayOfYear(iso) {
    const d = parseIso(iso);
    if (!d) return 1;
    const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.floor((d - start) / 86400000) + 1;
  }
  function lastDayOfMonth(year, monthIndex0) {
    return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  }
  function diffDays(isoA, isoB) {
    const a = parseIso(isoA), b = parseIso(isoB);
    if (!a || !b) return 0;
    return Math.round((b - a) / 86400000);
  }
  function clampToYear(iso, year) {
    const d = parseIso(iso);
    if (!d) return isoFromYMD(year, 1, 1);
    const y = d.getUTCFullYear();
    if (y < year) return isoFromYMD(year, 1, 1);
    if (y > year) return isoFromYMD(year, 12, 31);
    return iso;
  }
  // Snap an ISO date to the nearest SNAP_DAYS boundary measured from Jan 1 of that year
  function snapToBiweek(iso, year) {
    const day = dayOfYear(iso) - 1; // 0-based
    const snapped = Math.round(day / SNAP_DAYS) * SNAP_DAYS;
    const yearStart = new Date(Date.UTC(year, 0, 1));
    yearStart.setUTCDate(yearStart.getUTCDate() + snapped);
    return dateToIso(yearStart);
  }
  // Snap end date relative to start so duration is a multiple of SNAP_DAYS
  function snapDurationFromStart(startIso, endIso) {
    const startDay = dayOfYear(startIso);
    const endDay = dayOfYear(endIso);
    let duration = endDay - startDay + 1; // inclusive days
    duration = Math.max(SNAP_DAYS, Math.round(duration / SNAP_DAYS) * SNAP_DAYS);
    return addDaysIso(startIso, duration - 1);
  }

  function load() {
    if (storageMode === "memory") {
      // The host app will populate the store via replaceAll(). Just take a
      // baseline snapshot so undo/redo has an entry to fall back to.
      snapshot();
      return;
    }
    try {
      // The set of years lives in META (m.years). Older saves without it fall
      // back to the original 2026/2027 pair.
      let yearList = ["2026", "2027"];
      const metaRaw = localStorage.getItem(META_KEY);
      if (metaRaw) {
        const m = JSON.parse(metaRaw);
        store.title = m.title || DEFAULTS.title;
        store.eyebrow = m.eyebrow || DEFAULTS.eyebrow;
        if (Array.isArray(m.years) && m.years.length) yearList = m.years.map(String);
      }
      store.accent = localStorage.getItem(ACCENT_KEY) || DEFAULTS.accent;
      store.theme = localStorage.getItem(THEME_KEY) || DEFAULTS.theme;

      // Build the data map from the persisted year list.
      store.data = {};
      yearList.forEach((y) => {
        const raw = localStorage.getItem(LAYOUT_KEY(y));
        if (raw) {
          try { store.data[y] = normalizeYear(JSON.parse(raw), y); }
          catch (_) { store.data[y] = { lanes: [], items: [] }; }
        } else {
          store.data[y] = { lanes: [], items: [] };
        }
      });
      // Guarantee at least one year exists.
      if (!Object.keys(store.data).length) store.data = { "2026": { lanes: [], items: [] } };

      // Active year must be one we actually have; else fall back to the first.
      const storedActive = localStorage.getItem(YEAR_KEY);
      store.activeYear = (storedActive && store.data[storedActive]) ? storedActive : years()[0];
    } catch (_) {
      // Carry on with defaults
    }

    // Backfill missing lane colors
    years().forEach((y) => {
      (store.data[y].lanes || []).forEach((l, i) => {
        if (!l.color) l.color = PALETTE[i % PALETTE.length];
      });
    });

    snapshot();
  }

  function normalizeYear(y, yearLabel) {
    const year = parseInt(yearLabel, 10) || 2026;
    const out = { granularity: "day", lanes: [], items: [] };
    if (y && Array.isArray(y.lanes)) {
      out.lanes = y.lanes.map((l, i) => ({
        id: l.id || `lane-${i}-${Math.random().toString(36).slice(2, 7)}`,
        name: String(l.name || "Untitled lane"),
        description: String(l.description || ""),
        color: PALETTE.includes(l.color) ? l.color : PALETTE[i % PALETTE.length]
      }));
    }

    if (!y || !Array.isArray(y.items)) return out;

    // Detect schema and migrate.
    // v3 (day): granularity === "day" OR items have startDate/endDate
    // v2 (month): granularity === "month" OR items have start in 1-12, span in 1-12
    // v1 (quarter): items have start/span in 1-4
    const firstItem = y.items[0] || {};
    const isV3 = y.granularity === "day" || (firstItem.startDate && firstItem.endDate);
    const explicitV2 = y.granularity === "month";
    const looksLikeV2 = !isV3 && !explicitV2 && y.items.length > 0
      && y.items.every((it) => {
        const s = parseInt(it.start, 10) || 1;
        const sp = parseInt(it.span, 10) || 1;
        return s >= 1 && s <= 12 && sp >= 1 && sp <= 12 && s + sp - 1 <= 12;
      });
    const explicitV1 = y.granularity === "quarter";
    const looksLikeV1 = !isV3 && !explicitV2 && !looksLikeV2 && y.items.length > 0
      && y.items.every((it) => {
        const s = parseInt(it.start, 10) || 1;
        const sp = parseInt(it.span, 10) || 1;
        return s >= 1 && s <= 4 && sp >= 1 && sp <= 4 && s + sp - 1 <= 4;
      });

    out.items = y.items.map((it, i) => {
      let startDate, endDate;
      if (isV3) {
        startDate = typeof it.startDate === "string" ? it.startDate : isoFromYMD(year, 1, 1);
        endDate = typeof it.endDate === "string" ? it.endDate : addDaysIso(startDate, SNAP_DAYS - 1);
      } else {
        let startMonth = parseInt(it.start, 10) || 1;
        let span = parseInt(it.span, 10) || 1;
        if (explicitV1 || looksLikeV1) {
          startMonth = (startMonth - 1) * 3 + 1;
          span = span * 3;
        }
        startMonth = clamp(startMonth, 1, 12);
        span = clamp(span, 1, 13 - startMonth);
        const endMonth = startMonth + span - 1;
        startDate = isoFromYMD(year, startMonth, 1);
        endDate = isoFromYMD(year, endMonth, lastDayOfMonth(year, endMonth - 1));
      }

      // Clamp to active year boundaries (v0.3 — cross-year items not supported)
      startDate = clampToYear(startDate, year);
      endDate = clampToYear(endDate, year);
      if (diffDays(startDate, endDate) < 0) endDate = startDate;

      return {
        id: it.id || `it-${i}-${Math.random().toString(36).slice(2, 7)}`,
        laneId: String(it.laneId || (out.lanes[0] && out.lanes[0].id) || ""),
        title: String(it.title || "Untitled"),
        startDate,
        endDate,
        row: Math.max(0, parseInt(it.row, 10) || 0),
        status: ["planned", "funded", "soon", "pending", "conditional", "deprioritized"].includes(it.status) ? it.status : "planned",
        type: ["other", "build", "data", "polish"].includes(it.type) ? it.type : "other",
        complete: clamp(parseInt(it.complete, 10) || 0, 0, 100),
        businessObjective: typeof it.businessObjective === "string" ? it.businessObjective : "",
        definitionOfDone: typeof it.definitionOfDone === "string" ? it.definitionOfDone : ""
      };
    });
    return out;
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function persist() {
    if (storageMode === "local") {
      try {
        localStorage.setItem(META_KEY, JSON.stringify({
          title: store.title,
          eyebrow: store.eyebrow,
          years: Object.keys(store.data),
          schema: SCHEMA_VERSION
        }));
        localStorage.setItem(ACCENT_KEY, store.accent);
        localStorage.setItem(THEME_KEY, store.theme);
        localStorage.setItem(YEAR_KEY, store.activeYear);
        Object.keys(store.data).forEach((y) => {
          localStorage.setItem(LAYOUT_KEY(y), JSON.stringify(store.data[y]));
        });
      } catch (_) { /* storage full or disabled */ }
    }
    if (onPersistCallback) {
      try { onPersistCallback(); } catch (_) { /* host owns errors */ }
    }
  }

  // ---------- History ----------
  function captureState() {
    return {
      title: store.title,
      eyebrow: store.eyebrow,
      activeYear: store.activeYear,
      data: deepCopy(store.data)
    };
  }

  function applyState(snap) {
    store.title = snap.title;
    store.eyebrow = snap.eyebrow;
    store.activeYear = snap.activeYear;
    store.data = deepCopy(snap.data);
  }

  function snapshot() {
    // Truncate forward history when a new action lands after undo
    store.history = store.history.slice(0, store.historyIndex + 1);
    store.history.push(captureState());
    if (store.history.length > HISTORY_LIMIT) {
      store.history.shift();
    } else {
      store.historyIndex++;
    }
    store.historyIndex = store.history.length - 1;
  }

  function canUndo() { return store.historyIndex > 0; }
  function canRedo() { return store.historyIndex < store.history.length - 1; }

  function undo() {
    if (!canUndo()) return false;
    store.historyIndex--;
    applyState(store.history[store.historyIndex]);
    persist();
    return true;
  }

  function redo() {
    if (!canRedo()) return false;
    store.historyIndex++;
    applyState(store.history[store.historyIndex]);
    persist();
    return true;
  }

  // ---------- Public API ----------
  function currentYear() { return store.data[store.activeYear]; }
  function findItem(id) { return currentYear().items.find((i) => i.id === id); }
  function findLane(id) { return currentYear().lanes.find((l) => l.id === id); }

  // commit(mutator) — wraps mutation in snapshot + persist
  function commit(mutator) {
    if (canCommitFn && canCommitFn() === false) return false;
    mutator();
    persist();
    snapshot();
    return true;
  }

  // commitSilent — mutates + persists but does not push history (used for live drag)
  function commitSilent(mutator) {
    if (canCommitFn && canCommitFn() === false) return false;
    mutator();
    persist();
    return true;
  }

  // Sorted list of year keys (ascending).
  function years() {
    return Object.keys(store.data).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  }

  function setActiveYear(year) {
    year = String(year);
    if (!store.data[year]) return;
    if (store.activeYear === year) return;
    commit(() => { store.activeYear = year; });
  }

  // Append the next consecutive year (max existing + 1) and switch to it.
  // Seeds the new year with the active year's lane structure (fresh ids, no
  // items) so it's ready to use with the same swimlanes. Returns the new year.
  function addYear() {
    const ints = years().map((y) => parseInt(y, 10)).filter((n) => !isNaN(n));
    const next = String((ints.length ? Math.max(...ints) : 2025) + 1);
    if (store.data[next]) { setActiveYear(next); return next; }
    const src = store.data[store.activeYear];
    const lanes = (src && Array.isArray(src.lanes) ? src.lanes : []).map((l, i) => ({
      id: uid("lane"),
      name: l.name,
      description: l.description || "",
      color: l.color || PALETTE[i % PALETTE.length]
    }));
    commit(() => {
      store.data[next] = { granularity: "day", lanes, items: [] };
      store.activeYear = next;
    });
    return next;
  }

  // Remove a year. Guarded: never removes the last remaining year. If the
  // removed year was active, falls back to the earliest remaining year.
  // (Caller is responsible for any "this has items" confirmation.)
  function removeYear(year) {
    year = String(year);
    if (!store.data[year]) return false;
    if (years().length <= 1) return false;
    commit(() => {
      delete store.data[year];
      if (store.activeYear === year) store.activeYear = years()[0];
    });
    try { localStorage.removeItem(LAYOUT_KEY(year)); } catch (_) { /* noop */ }
    return true;
  }

  function setTitle(t) {
    if (t === store.title) return;
    commit(() => { store.title = String(t || "Roadbook").slice(0, 120); });
  }

  function setEyebrow(t) {
    if (t === store.eyebrow) return;
    commit(() => { store.eyebrow = String(t || "").slice(0, 80); });
  }

  function setAccent(hex) {
    store.accent = hex;
    persist();
  }

  function setTheme(t) {
    store.theme = t === "dark" ? "dark" : "light";
    persist();
  }

  function replaceAll(payload) {
    // Used by template loader and JSON import. Accepts any set of 4-digit
    // year keys present in payload.data.
    commit(() => {
      if (payload.title) store.title = String(payload.title).slice(0, 120);
      if (payload.eyebrow) store.eyebrow = String(payload.eyebrow).slice(0, 80);
      if (payload.data && typeof payload.data === "object") {
        const next = {};
        Object.keys(payload.data).forEach((y) => {
          if (/^\d{4}$/.test(String(y))) next[y] = normalizeYear(payload.data[y], y);
        });
        store.data = Object.keys(next).length
          ? next
          : { "2026": { lanes: [], items: [] }, "2027": { lanes: [], items: [] } };
      }
      // Active year: prefer the payload's if it exists, else keep current if
      // still valid, else the earliest available.
      if (payload.activeYear && store.data[String(payload.activeYear)]) {
        store.activeYear = String(payload.activeYear);
      } else if (!store.data[store.activeYear]) {
        store.activeYear = years()[0];
      }
    });
  }

  function exportJSON() {
    return {
      roadbookVersion: SCHEMA_VERSION,
      title: store.title,
      eyebrow: store.eyebrow,
      activeYear: store.activeYear,
      data: deepCopy(store.data)
    };
  }

  function uid(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
  }

  // Expose
  window.Roadbook = window.Roadbook || {};
  window.Roadbook.state = {
    PALETTE,
    SCHEMA_VERSION,
    SNAP_DAYS,
    setStorageMode,
    setOnPersist,
    setCanCommit,
    load,
    persist,
    snapshot,
    commit,
    commitSilent,
    undo,
    redo,
    canUndo,
    canRedo,
    currentYear,
    findItem,
    findLane,
    years,
    addYear,
    removeYear,
    setActiveYear,
    setTitle,
    setEyebrow,
    setAccent,
    setTheme,
    replaceAll,
    exportJSON,
    normalizeYear,
    uid,
    get: () => store
  };
  window.Roadbook.dates = {
    SNAP_DAYS,
    isLeap,
    daysInYear,
    isoFromYMD,
    parseIso,
    dateToIso,
    addDaysIso,
    dayOfYear,
    lastDayOfMonth,
    diffDays,
    clampToYear,
    snapToBiweek,
    snapDurationFromStart
  };
})();
