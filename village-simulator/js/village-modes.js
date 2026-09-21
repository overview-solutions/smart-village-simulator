/**
 * App modes: operations · build · maintenance.
 * Each mode shows a slim control strip + matching legend defaults.
 */

export const MODES = ["build", "operations", "maintenance"];

/** Default layer visibility (state.hide keys) per mode. true = hidden. */
export const MODE_HIDE = {
  operations: {
    reading: true,
    pay: false,
    disconnect: false,
    sms: true,
    sync: true,
    mesh: true,
    worldline: true,
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
    opts.setMode(m);
    paint();
  });

  paint();
  return { paint };
}
