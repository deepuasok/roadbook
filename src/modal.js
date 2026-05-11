// modal.js — edit-item modal with focus trap
(function () {
  let editingId = null;
  let prevFocus = null;

  function open(itemId) {
    const item = window.Roadbook.state.findItem(itemId);
    if (!item) return;
    editingId = itemId;
    prevFocus = document.activeElement;

    document.getElementById("fTitle").value = item.title;
    document.getElementById("fDue").value = item.due || "";
    document.getElementById("fStatus").value = item.status || "planned";
    document.getElementById("fType").value = item.type || "other";
    const complete = item.complete || 0;
    document.getElementById("fComplete").value = complete;
    document.getElementById("fCompleteVal").textContent = complete + "%";
    document.getElementById("modalTitle").textContent = `Edit · ${item.title}`;
    document.getElementById("modalOverlay").classList.add("show");
    setTimeout(() => document.getElementById("fTitle").focus(), 40);
  }

  function close() {
    editingId = null;
    document.getElementById("modalOverlay").classList.remove("show");
    if (prevFocus && typeof prevFocus.focus === "function") {
      try { prevFocus.focus(); } catch (_) {}
    }
    prevFocus = null;
  }

  function save() {
    if (!editingId) return;
    const item = window.Roadbook.state.findItem(editingId);
    if (!item) return;
    const next = {
      title: document.getElementById("fTitle").value.trim() || item.title,
      due: document.getElementById("fDue").value,
      status: document.getElementById("fStatus").value,
      type: document.getElementById("fType").value,
      complete: parseInt(document.getElementById("fComplete").value, 10) || 0
    };
    const changed = Object.keys(next).some((k) => next[k] !== item[k]);
    if (changed) {
      window.Roadbook.state.commit(() => Object.assign(item, next));
      window.Roadbook.app.updateCardDom(item);
    }
    close();
    if (changed) window.Roadbook.app.toast(`Saved "${item.title}"`);
  }

  function remove() {
    if (!editingId) return;
    const item = window.Roadbook.state.findItem(editingId);
    if (!item) return;
    if (!confirm(`Delete "${item.title}"?`)) return;
    const laneId = item.laneId;
    const itemId = editingId;
    window.Roadbook.state.commit(() => {
      const y = window.Roadbook.state.currentYear();
      y.items = y.items.filter((i) => i.id !== itemId);
    });
    const card = document.querySelector(`.card[data-id="${itemId}"]`);
    if (card) card.remove();
    window.Roadbook.app.resizeLaneBody(laneId);
    close();
    window.Roadbook.app.toast("Deleted");
  }

  function isOpen() {
    return document.getElementById("modalOverlay").classList.contains("show");
  }

  // Focus trap when modal is open
  function trapFocus(e) {
    const overlay = document.getElementById("modalOverlay");
    if (!overlay.classList.contains("show")) return;
    if (e.key !== "Tab") return;
    const focusable = overlay.querySelectorAll(
      'input, select, textarea, button, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  function wire() {
    document.getElementById("mCancel").addEventListener("click", close);
    document.getElementById("mSave").addEventListener("click", save);
    document.getElementById("mDelete").addEventListener("click", remove);
    document.getElementById("modalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "modalOverlay") close();
    });
    document.getElementById("fComplete").addEventListener("input", (e) => {
      document.getElementById("fCompleteVal").textContent = e.target.value + "%";
    });
    document.getElementById("fTitle").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); save(); }
    });
    document.addEventListener("keydown", trapFocus);
  }

  window.Roadbook = window.Roadbook || {};
  window.Roadbook.modal = { open, close, save, remove, wire, isOpen };
})();
