// state.js — store, persistence, history (undo/redo)
// Exposes a single global: window.Roadbook.state
(function () {
  const PREFIX = "roadbook";
  const ACCENT_KEY = `${PREFIX}-accent`;
  const THEME_KEY = `${PREFIX}-theme`;
  const META_KEY = `${PREFIX}-meta`;
  const YEAR_KEY = `${PREFIX}-active-year`;
  const LAYOUT_KEY = (y) => `${PREFIX}-layout-${y}`;
  const SCHEMA_VERSION = 2; // v2 = month granularity (1-12)
  const HISTORY_LIMIT = 50;

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

  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

  function load() {
    try {
      const metaRaw = localStorage.getItem(META_KEY);
      if (metaRaw) {
        const m = JSON.parse(metaRaw);
        store.title = m.title || DEFAULTS.title;
        store.eyebrow = m.eyebrow || DEFAULTS.eyebrow;
      }
      store.accent = localStorage.getItem(ACCENT_KEY) || DEFAULTS.accent;
      store.theme = localStorage.getItem(THEME_KEY) || DEFAULTS.theme;
      store.activeYear = localStorage.getItem(YEAR_KEY) === "2027" ? "2027" : "2026";

      ["2026", "2027"].forEach((y) => {
        const raw = localStorage.getItem(LAYOUT_KEY(y));
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            store.data[y] = normalizeYear(parsed);
          } catch (_) {
            store.data[y] = { lanes: [], items: [] };
          }
        }
      });
    } catch (_) {
      // Carry on with defaults
    }

    // Backfill missing lane colors
    ["2026", "2027"].forEach((y) => {
      (store.data[y].lanes || []).forEach((l, i) => {
        if (!l.color) l.color = PALETTE[i % PALETTE.length];
      });
    });

    snapshot();
  }

  function normalizeYear(y) {
    const out = { granularity: "month", lanes: [], items: [] };
    if (y && Array.isArray(y.lanes)) {
      out.lanes = y.lanes.map((l, i) => ({
        id: l.id || `lane-${i}-${Math.random().toString(36).slice(2, 7)}`,
        name: String(l.name || "Untitled lane"),
        description: String(l.description || ""),
        color: PALETTE.includes(l.color) ? l.color : PALETTE[i % PALETTE.length]
      }));
    }
    // Decide whether to migrate quarter → month units.
    // Trigger: granularity missing/quarter, OR all items fit start≤4 && span≤4 (legacy v1 data).
    const explicitlyQuarter = y && (y.granularity === "quarter" || y.granularity === undefined);
    const looksLikeQuarterData = y && Array.isArray(y.items) && y.items.length > 0
      && y.items.every((it) => {
        const s = parseInt(it.start, 10) || 1;
        const sp = parseInt(it.span, 10) || 1;
        return s >= 1 && s <= 4 && sp >= 1 && sp <= 4 && s + sp - 1 <= 4;
      });
    const migrate = y && y.granularity !== "month" && (explicitlyQuarter || looksLikeQuarterData);

    if (y && Array.isArray(y.items)) {
      out.items = y.items.map((it, i) => {
        let start = parseInt(it.start, 10) || 1;
        let span = parseInt(it.span, 10) || 1;
        if (migrate) {
          start = (start - 1) * 3 + 1;
          span = span * 3;
        }
        return {
          id: it.id || `it-${i}-${Math.random().toString(36).slice(2, 7)}`,
          laneId: String(it.laneId || (out.lanes[0] && out.lanes[0].id) || ""),
          title: String(it.title || "Untitled"),
          start: clamp(start, 1, 12),
          span: clamp(span, 1, 12),
          row: Math.max(0, parseInt(it.row, 10) || 0),
          status: ["planned", "funded", "soon", "pending", "conditional"].includes(it.status) ? it.status : "planned",
          type: ["other", "build", "data", "polish"].includes(it.type) ? it.type : "other",
          due: typeof it.due === "string" ? it.due : "",
          complete: clamp(parseInt(it.complete, 10) || 0, 0, 100)
        };
      });
    }
    return out;
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function persist() {
    try {
      localStorage.setItem(META_KEY, JSON.stringify({
        title: store.title,
        eyebrow: store.eyebrow,
        schema: SCHEMA_VERSION
      }));
      localStorage.setItem(ACCENT_KEY, store.accent);
      localStorage.setItem(THEME_KEY, store.theme);
      localStorage.setItem(YEAR_KEY, store.activeYear);
      ["2026", "2027"].forEach((y) => {
        localStorage.setItem(LAYOUT_KEY(y), JSON.stringify(store.data[y]));
      });
    } catch (_) { /* storage full or disabled */ }
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
    mutator();
    persist();
    snapshot();
  }

  // commitSilent — mutates + persists but does not push history (used for live drag)
  function commitSilent(mutator) {
    mutator();
    persist();
  }

  function setActiveYear(year) {
    if (year !== "2026" && year !== "2027") return;
    if (store.activeYear === year) return;
    commit(() => { store.activeYear = year; });
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
    // Used by template loader and JSON import
    commit(() => {
      if (payload.title) store.title = String(payload.title).slice(0, 120);
      if (payload.eyebrow) store.eyebrow = String(payload.eyebrow).slice(0, 80);
      if (payload.activeYear === "2026" || payload.activeYear === "2027") {
        store.activeYear = payload.activeYear;
      }
      if (payload.data) {
        ["2026", "2027"].forEach((y) => {
          if (payload.data[y]) store.data[y] = normalizeYear(payload.data[y]);
        });
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
})();
