// defaults.js — generic blank-state lanes used on fresh load (year-agnostic)
(function () {
  const BLANK_LANES = {
    lanes: [
      { id: "now",   name: "Now",   description: "Shipping this quarter.",  color: "sage" },
      { id: "next",  name: "Next",  description: "Up next, scoped.",         color: "sky" },
      { id: "later", name: "Later", description: "On the radar, not scoped.", color: "blush" }
    ],
    items: []
  };

  window.Roadbook = window.Roadbook || {};
  window.Roadbook.defaults = {
    BLANK_LANES,
    BLANK_EMPTY: { lanes: [], items: [] }
  };
})();
