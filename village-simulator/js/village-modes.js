/**
 * App modes: operations · build · maintenance · productive · energy.
 * Each mode shows a slim control strip + matching legend defaults.
 */

export const MODES = ["build", "operations", "productive", "energy", "maintenance"];

/** Default layer visibility (state.hide keys) per mode. true = hidden. */
export const MODE_HIDE = {
  operations: {
    reading: true,
    pay: true,
    disconnect: false,
    sms: true,
    sync: true,
    mesh: true,
    worldline: false,
    rf: true,
    phase_xfer: true,
    leak: false,
  },
  build: {
    reading: true,
    pay: true,
    disconnect: true,
    sms: true,
    sync: true,
    mesh: true,
    worldline: true,
    rf: true,
    phase_xfer: true,
    leak: true,
    outage: true,
    lastbreath: true,
    repair: true,
  },
  productive: {
    reading: true,
    pay: true,
    disconnect: true,
    sms: true,
    sync: true,
    mesh: true,
    worldline: true,
    rf: true,
    phase_xfer: true,
    leak: true,
  },
  energy: {
    reading: true,
    pay: true,
    disconnect: true,
    sms: true,
    sync: true,
    mesh: true,
    worldline: true,
    rf: true,
    phase_xfer: true,
    leak: true,
  },
  maintenance: {
    reading: true,
    pay: true,
    disconnect: false,
    sms: true,
    sync: true,
    mesh: false,
    worldline: true,
    rf: false,
    phase_xfer: false,
    leak: false,
  },
};

/** Seeded empty-canvas pack vs leftover demo HOUSES reference. */
export function opsHasLiveHouses(emptyCanvas, liveHouses, demoHouses) {
  return !!(liveHouses?.length) && !(emptyCanvas && liveHouses === demoHouses);
}

/** BUILD / Loads / Energy / Maintenance: no playhead stack. */
export function opsWorldlinesBlocked(appMode) {
  return appMode === "build" || appMode === "maintenance" || appMode === "productive" || appMode === "energy";
}

/**
 * Separate All-customers control — not Anomalies OFF.
 * ON unhides pay / SMS / reading crumbs. OFF puts them back.
 * Leak / cutoff / worldline stay on their own toggles.
 */
export function opsSetAllCustomers(hide, allOn) {
  const next = hide || {};
  next.reading = !allOn;
  next.pay = !allOn;
  next.sms = !allOn;
  return next;
}

/**
 * Customer time-stacks over the grid.
 * Anomalies ON + All customers OFF → critical only.
 * Anomalies OFF + All customers OFF → hide stacks (grid / assets stay).
 * All customers ON → every seeded meter (Anomalies may stay ON).
 */
export function opsCustomerStackMode(anomalyOnly, showAllCustomers) {
  if (showAllCustomers) return "all";
  if (anomalyOnly) return "critical";
  return "hidden";
}

export const MODE_META = {
  operations: {
    label: "Operations",
    hint: "Run the day — feeders, prepaid, anomalies, EMS.",
    role: "ops",
    scheme: "messages",
    lineGrad: "capacity",
    anomalyOnly: true,
  },
  build: {
    label: "Build",
    hint: "Place assets · red grid = unmapped · green = API configured. No worldlines / playhead.",
    role: "ops",
    scheme: "asset",
    lineGrad: "capacity",
    anomalyOnly: false,
  },
  productive: {
    label: "Loads",
    hint: "Critical vs non-critical loads — All critical / All non-critical, or pick one class.",
    role: "ops",
    scheme: "useclass",
    lineGrad: "capacity",
    anomalyOnly: false,
  },
  energy: {
    label: "Energy Assets",
    hint: "Generation + storage — diesel, solar, wind, battery. Click a class to soft-focus.",
    role: "ops",
    scheme: "asset",
    lineGrad: "capacity",
    anomalyOnly: false,
  },
  maintenance: {
    label: "Maintenance",
    hint: "Asset health · faults, leaks, mesh — no playhead / time feeds.",
    role: "tech",
    scheme: "capacity",
    lineGrad: "pf",
    anomalyOnly: true,
  },
};

/**
 * @param {{
 *   getMode: () => string,
 *   setMode: (m: string) => void,
 *   root?: ParentNode,
 * }} opts
 */
export function bindModeSwitcher(opts) {
  const root = opts.root || document;
  const switcher = root.querySelector("#wl-mode-switch");
  if (!switcher) return;

  function paint() {
    const mode = opts.getMode();
    document.documentElement.dataset.mode = mode;
    switcher.querySelectorAll("[data-mode-btn]").forEach((btn) => {
      const m = btn.getAttribute("data-mode-btn");
      const on = m === mode;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    root.querySelectorAll("[data-modes]").forEach((el) => {
      const list = (el.getAttribute("data-modes") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const show = list.length === 0 || list.includes(mode);
      el.hidden = !show;
      el.setAttribute("aria-hidden", show ? "false" : "true");
    });
    const hint = root.querySelector("#wl-mode-hint");
    if (hint) hint.textContent = MODE_META[mode]?.hint || "";
  }

  switcher.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mode-btn]");
    if (!btn) return;
    const m = btn.getAttribute("data-mode-btn");
    if (!MODES.includes(m) || m === opts.getMode()) return;
    try {
      opts.setMode(m);
    } finally {
      paint();
    }
  });

  paint();
  return { paint };
}
