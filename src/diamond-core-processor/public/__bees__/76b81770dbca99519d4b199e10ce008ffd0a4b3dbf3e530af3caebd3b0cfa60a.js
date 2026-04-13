// src/diamondcoreprocessor.com/format/format-painter.drone.ts
import { EffectBus } from "@hypercomb/core";
var borderColorProvider = {
  key: "border.color",
  extract(props) {
    const color = props.border?.color;
    if (!color || typeof color !== "string") return null;
    return { key: "border.color", label: "Border", value: color, preview: color };
  },
  apply(props, value) {
    const next = { ...props };
    if (!next.border) next.border = {};
    next.border = { ...next.border, color: value };
    return next;
  }
};
var backgroundColorProvider = {
  key: "background.color",
  extract(props) {
    const color = props.background?.color;
    if (!color || typeof color !== "string") return null;
    return { key: "background.color", label: "Background", value: color, preview: color };
  },
  apply(props, value) {
    const next = { ...props };
    if (!next.background) next.background = {};
    next.background = { ...next.background, color: value };
    return next;
  }
};
var FormatPainterDrone = class extends EventTarget {
  #open = false;
  #sourceCell = null;
  #entries = [];
  #providers = [borderColorProvider, backgroundColorProvider];
  get state() {
    return {
      open: this.#open,
      sourceCell: this.#sourceCell,
      entries: this.#entries.map((e) => ({ ...e }))
    };
  }
  // ── load source tile's properties ──────────────────────
  async #loadSource(cell) {
    const store = window.ioc.get("@hypercomb.social/Store");
    if (!store) return;
    let properties = {};
    try {
      const indexKey = "hc:tile-props-index";
      const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
      const propsSig = index[cell];
      if (!propsSig) throw new Error("no index entry");
      const propsBlob = await store.getResource(propsSig);
      if (!propsBlob) throw new Error("props blob missing");
      properties = JSON.parse(await propsBlob.text());
    } catch {
    }
    this.#openPainter(cell, properties);
  }
  constructor() {
    super();
    EffectBus.on("format:open", (payload) => {
      this.#openPainter(payload.cell, payload.properties);
    });
    EffectBus.on("format:close", () => {
      this.#close();
    });
    EffectBus.on("format:toggle-entry", (payload) => {
      this.#toggleEntry(payload.key);
    });
    EffectBus.on("format:apply", () => {
      void this.#applyFormat();
    });
    EffectBus.on("selection:changed", (payload) => {
      if (!this.#open || !payload?.active) return;
      if (payload.active === this.#sourceCell) return;
      void this.#loadSource(payload.active);
    });
  }
  addProvider(provider) {
    this.#providers.push(provider);
  }
  // ── open ────────────────────────────────────────────────
  #openPainter(cell, props) {
    this.#sourceCell = cell;
    this.#entries = [];
    for (const provider of this.#providers) {
      const entry = provider.extract(props);
      if (entry) {
        this.#entries.push({ ...entry, enabled: true });
      }
    }
    this.#open = true;
    this.#emit();
  }
  // ── close ───────────────────────────────────────────────
  #close() {
    this.#open = false;
    this.#sourceCell = null;
    this.#entries = [];
    this.#emit();
  }
  // ── toggle checkbox ─────────────────────────────────────
  #toggleEntry(key) {
    const entry = this.#entries.find((e) => e.key === key);
    if (entry) {
      entry.enabled = !entry.enabled;
      this.#emit();
    }
  }
  // ── apply to selection ──────────────────────────────────
  async #applyFormat() {
    const selection = window.ioc.get("@diamondcoreprocessor.com/SelectionService");
    const store = window.ioc.get("@hypercomb.social/Store");
    if (!selection || !store) return;
    const enabled = this.#entries.filter((e) => e.enabled);
    if (enabled.length === 0) return;
    const indexKey = "hc:tile-props-index";
    const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
    for (const cell of selection.selected) {
      if (cell === this.#sourceCell) continue;
      let props = {};
      try {
        const propsSig2 = index[cell];
        if (!propsSig2) throw new Error("no index entry");
        const propsBlob = await store.getResource(propsSig2);
        if (!propsBlob) throw new Error("props blob missing");
        props = JSON.parse(await propsBlob.text());
      } catch {
      }
      for (const entry of enabled) {
        const provider = this.#providers.find((p) => p.key === entry.key);
        if (provider) {
          props = provider.apply(props, entry.value);
        }
      }
      const json = JSON.stringify(props, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const propsSig = await store.putResource(blob);
      index[cell] = propsSig;
      EffectBus.emit("tile:saved", { cell });
    }
    localStorage.setItem(indexKey, JSON.stringify(index));
  }
  // ── emit state ──────────────────────────────────────────
  #emit() {
    this.dispatchEvent(new CustomEvent("change"));
    EffectBus.emit("format:state", this.state);
  }
};
window.ioc.register(
  "@diamondcoreprocessor.com/FormatPainterDrone",
  new FormatPainterDrone()
);
export {
  FormatPainterDrone
};
