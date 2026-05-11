// share.js — PNG (html2canvas), SVG (native), JSON import/export, URL-hash share
(function () {
  const HTML2CANVAS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
  let html2canvasLoading = null;

  function ensureHtml2Canvas() {
    if (typeof window.html2canvas !== "undefined") return Promise.resolve(window.html2canvas);
    if (html2canvasLoading) return html2canvasLoading;
    html2canvasLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = HTML2CANVAS_CDN;
      s.onload = () => resolve(window.html2canvas);
      s.onerror = () => reject(new Error("Failed to load html2canvas (offline?)"));
      document.head.appendChild(s);
    });
    return html2canvasLoading;
  }

  // ---------- PNG ----------
  async function copyPng() {
    let h2c;
    try {
      h2c = await ensureHtml2Canvas();
    } catch (e) {
      window.Roadbook.app.toast("PNG needs network for html2canvas — try SVG", true);
      return;
    }
    const page = document.getElementById("page");
    try {
      const canvas = await h2c(page, {
        backgroundColor: getComputedStyle(document.body).getPropertyValue("--bg") || "#FFFFFF",
        scale: 2,
        useCORS: true,
        logging: false
      });
      canvas.toBlob(async (blob) => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          window.Roadbook.app.toast("PNG copied to clipboard");
        } catch (_) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${slug(window.Roadbook.state.get().title)}.png`;
          a.click();
          URL.revokeObjectURL(url);
          window.Roadbook.app.toast("Clipboard blocked — downloaded PNG instead");
        }
      }, "image/png");
    } catch (e) {
      window.Roadbook.app.toast(`PNG failed: ${e.message || e}`, true);
    }
  }

  // ---------- SVG ----------
  function buildSvg() {
    const s = window.Roadbook.state.get();
    const year = s.activeYear;
    const data = s.data[year];
    const W = 1280;
    const ROW_H = 34;
    const LANE_HEAD_W = 140;
    const LANE_PAD = 16;
    const GRID_X = LANE_HEAD_W + LANE_PAD + 12;
    const GRID_W = W - GRID_X - LANE_PAD;
    const COLS = 12;
    const MONTH_W = GRID_W / COLS;
    const HEADER_H = 96;
    const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dates = window.Roadbook.dates;
    const yearInt = parseInt(year, 10);
    const YEAR_DAYS = dates.daysInYear(yearInt);
    const DAY_W = GRID_W / YEAR_DAYS;

    const styleVar = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
    const text = styleVar("--text") || "#0A0A0A";
    const textDim = styleVar("--text-dim") || "#6B7280";
    const textMuted = styleVar("--text-muted") || "#9CA3AF";
    const bg = styleVar("--bg") || "#FFFFFF";
    const border = styleVar("--border") || "#E5E7EB";

    const laneBg = (color) => styleVar(`--lane-${color}`) || "#FEFBEF";

    const typeColor = (t) => ({
      build: styleVar("--type-build") || "#3B82F6",
      data: styleVar("--type-data") || "#8B5CF6",
      polish: styleVar("--type-polish") || "#14B8A6"
    })[t] || "transparent";

    const statusColor = (st) => ({
      planned: styleVar("--status-planned") || "#111827",
      funded: styleVar("--status-funded") || "#10B981",
      soon: styleVar("--status-soon") || "#F59E0B",
      pending: styleVar("--status-pending") || "#DC2626",
      conditional: styleVar("--status-conditional") || "#D1D5DB"
    })[st] || "#111827";

    // Compute total height
    let laneRowMax = data.lanes.map(() => 0);
    data.items.forEach((it) => {
      const li = data.lanes.findIndex((l) => l.id === it.laneId);
      if (li >= 0) laneRowMax[li] = Math.max(laneRowMax[li], it.row + 1);
    });
    const laneHeights = laneRowMax.map((r) => Math.max(1, r) * ROW_H + 32);
    const totalLaneH = laneHeights.reduce((a, b) => a + b, 0);
    const H = HEADER_H + 24 + totalLaneH + 48;

    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="-apple-system, system-ui, sans-serif">`);
    out.push(`<rect width="${W}" height="${H}" fill="${bg}"/>`);

    // Header
    out.push(`<text x="${LANE_PAD}" y="32" font-size="11" font-weight="600" fill="${textMuted}" letter-spacing="0.8">${escapeXml(String(s.eyebrow || "").toUpperCase())}</text>`);
    out.push(`<text x="${LANE_PAD}" y="62" font-size="26" font-weight="700" fill="${text}" letter-spacing="-0.5">${escapeXml(s.title || "Roadbook")}</text>`);

    // Year axis with quarter group labels + month labels
    const axisY = HEADER_H + 12;
    out.push(`<text x="${LANE_PAD}" y="${axisY}" font-size="12" font-weight="600" fill="${text}">${escapeXml(year)}</text>`);
    // Quarter labels above
    for (let q = 0; q < 4; q++) {
      const cx = GRID_X + (q * 3 + 0.5) * MONTH_W;
      out.push(`<text x="${cx}" y="${axisY - 12}" font-size="9" font-weight="700" fill="${textMuted}" letter-spacing="1.2">Q${q + 1}</text>`);
    }
    // Month names
    for (let m = 0; m < COLS; m++) {
      const cx = GRID_X + (m + 0.5) * MONTH_W;
      out.push(`<text x="${cx}" y="${axisY}" font-size="10" font-weight="600" fill="${textDim}" text-anchor="middle">${MONTH_NAMES[m]}</text>`);
    }
    out.push(`<line x1="${LANE_PAD}" y1="${axisY + 6}" x2="${W - LANE_PAD}" y2="${axisY + 6}" stroke="${border}" stroke-width="1"/>`);

    // Lanes container border
    const lanesY = axisY + 18;
    out.push(`<rect x="${LANE_PAD}" y="${lanesY}" width="${W - LANE_PAD * 2}" height="${totalLaneH}" fill="none" stroke="${styleVar("--lane-container-border") || "#EADFC3"}" stroke-width="1" rx="8"/>`);

    let cursorY = lanesY;
    data.lanes.forEach((lane, idx) => {
      const lh = laneHeights[idx];
      // Lane band (pastel) behind title column
      out.push(`<rect x="${LANE_PAD}" y="${cursorY}" width="${LANE_HEAD_W + 16}" height="${lh}" fill="${laneBg(lane.color || "cream")}"/>`);
      if (idx < data.lanes.length - 1) {
        out.push(`<line x1="${LANE_PAD}" y1="${cursorY + lh}" x2="${W - LANE_PAD}" y2="${cursorY + lh}" stroke="${border}" stroke-width="0.7"/>`);
      }
      // Lane title
      out.push(`<text x="${LANE_PAD + 16}" y="${cursorY + 26}" font-size="14" font-weight="600" fill="${text}">${escapeXml(lane.name)}</text>`);
      if (lane.description) {
        out.push(`<text x="${LANE_PAD + 16}" y="${cursorY + 44}" font-size="11" fill="${textDim}">${escapeXml(lane.description)}</text>`);
      }
      // Month gridlines for this lane (light) and quarter dividers (stronger)
      for (let m = 1; m < COLS; m++) {
        const x = GRID_X + m * MONTH_W;
        const isQ = (m % 3 === 0);
        out.push(`<line x1="${x}" y1="${cursorY + 8}" x2="${x}" y2="${cursorY + lh - 8}" stroke="${isQ ? styleVar("--border-strong") || "#D1D5DB" : border}" stroke-width="${isQ ? 0.7 : 0.4}" opacity="${isQ ? 0.7 : 0.45}"/>`);
      }

      // Items (positioned by day-of-year)
      data.items.filter((it) => it.laneId === lane.id).forEach((it) => {
        const startDay = dates.dayOfYear(it.startDate);
        const endDay = dates.dayOfYear(it.endDate);
        const spanDays = Math.max(1, endDay - startDay + 1);
        const x = GRID_X + (startDay - 1) * DAY_W;
        const w = Math.max(8, spanDays * DAY_W - 6);
        const y = cursorY + 16 + it.row * ROW_H;
        const h = 30;
        // Card body
        out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${bg}" stroke="${border}" stroke-width="1"/>`);
        // Type stripe
        const tc = typeColor(it.type);
        if (tc !== "transparent") {
          out.push(`<rect x="${x}" y="${y}" width="3" height="${h}" fill="${tc}" rx="1.5"/>`);
        }
        // Completion fill
        if (it.complete > 0) {
          const fillW = (it.complete / 100) * w;
          out.push(`<rect x="${x}" y="${y}" width="${fillW}" height="${h}" rx="6" fill="${styleVar("--fill-pct") || "rgba(16,185,129,0.14)"}"/>`);
        }
        // Status dot
        const sx = x + (tc === "transparent" ? 12 : 14);
        out.push(`<circle cx="${sx + 3}" cy="${y + h / 2}" r="3.5" fill="${statusColor(it.status)}"/>`);
        // Title
        const titleX = sx + 12;
        const titleMax = w - (titleX - x) - 12;
        out.push(`<text x="${titleX}" y="${y + h / 2 + 4}" font-size="12" font-weight="500" fill="${text}">${escapeXml(truncate(it.title, Math.max(8, Math.floor(titleMax / 6.2))))}</text>`);
      });

      cursorY += lh;
    });

    // Footer credit
    out.push(`<text x="${W - LANE_PAD}" y="${H - 18}" font-size="10" fill="${textMuted}" text-anchor="end">Built with Roadbook</text>`);

    out.push(`</svg>`);
    return out.join("\n");
  }

  function truncate(s, n) {
    if (!s) return "";
    return s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s;
  }

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[c]);
  }

  function downloadSvg() {
    const svg = buildSvg();
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(window.Roadbook.state.get().title)}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    window.Roadbook.app.toast("SVG downloaded");
  }

  function slug(s) {
    return String(s || "roadbook").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "roadbook";
  }

  // ---------- JSON import/export ----------
  function exportJson() {
    const payload = window.Roadbook.state.exportJSON();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(payload.title)}.roadbook.json`;
    a.click();
    URL.revokeObjectURL(url);
    window.Roadbook.app.toast("Exported JSON");
  }

  function triggerImport() {
    document.getElementById("importFile").click();
  }

  function handleImport(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        if (!payload || typeof payload !== "object") throw new Error("Not an object");
        if (!payload.data || !payload.data["2026"]) throw new Error("Missing data.2026");
        window.Roadbook.state.replaceAll(payload);
        window.Roadbook.app.fullRender();
        window.Roadbook.app.toast(`Imported "${payload.title || "roadmap"}"`);
      } catch (err) {
        window.Roadbook.app.toast(`Import failed: ${err.message || err}`, true);
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  // ---------- URL-hash sharing ----------
  function encodeShareUrl() {
    const payload = window.Roadbook.state.exportJSON();
    const json = JSON.stringify(payload);
    // Compress using a tiny RLE-ish scheme is overkill — modern UTF-8 + base64url is fine
    // for typical roadmap sizes (<10KB JSON → ~13KB base64, well under URL limits).
    const b64 = base64UrlEncode(json);
    const url = `${location.origin}${location.pathname}#data=${b64}`;
    return url;
  }

  function decodeShareUrl() {
    const hash = location.hash || "";
    const m = hash.match(/[#&]data=([^&]+)/);
    if (!m) return null;
    try {
      const json = base64UrlDecode(m[1]);
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  function base64UrlEncode(s) {
    const utf8 = new TextEncoder().encode(s);
    let bin = "";
    utf8.forEach((b) => bin += String.fromCharCode(b));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64UrlDecode(s) {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function copyShareLink() {
    const url = encodeShareUrl();
    try {
      await navigator.clipboard.writeText(url);
      window.Roadbook.app.toast("Share link copied");
    } catch (_) {
      prompt("Copy this share link:", url);
    }
  }

  function maybeLoadFromHash() {
    const payload = decodeShareUrl();
    if (payload) {
      try {
        window.Roadbook.state.replaceAll(payload);
        // Clean hash after loading so reload doesn't keep importing
        history.replaceState(null, "", location.pathname);
        window.Roadbook.app.toast(`Loaded from link: ${payload.title || "roadmap"}`);
        return true;
      } catch (_) { return false; }
    }
    return false;
  }

  window.Roadbook = window.Roadbook || {};
  window.Roadbook.share = {
    copyPng,
    downloadSvg,
    exportJson,
    triggerImport,
    handleImport,
    copyShareLink,
    maybeLoadFromHash,
    buildSvg
  };
})();
