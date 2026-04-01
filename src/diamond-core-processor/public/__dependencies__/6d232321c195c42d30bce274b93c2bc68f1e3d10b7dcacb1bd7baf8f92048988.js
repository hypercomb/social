// @diamondcoreprocessor.com/assistant/strategies
// src/diamondcoreprocessor.com/assistant/strategies/blueprint-mode.strategy.ts
import { EffectBus } from "@hypercomb/core";
var BLUEPRINT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>';
var NEON_THEMES = [
  {
    // cyan — depth 0
    stroke: "#00e5ff",
    glow: "rgba(0, 229, 255, 0.25)",
    core: "rgba(180, 255, 255, 0.9)",
    fill: "rgba(0, 229, 255, 0.03)",
    text: "#00e5ff"
  },
  {
    // magenta — depth 1
    stroke: "#ff00c8",
    glow: "rgba(255, 0, 200, 0.25)",
    core: "rgba(255, 180, 240, 0.9)",
    fill: "rgba(255, 0, 200, 0.03)",
    text: "#ff00c8"
  },
  {
    // emerald — depth 2
    stroke: "#00ff64",
    glow: "rgba(0, 255, 100, 0.25)",
    core: "rgba(180, 255, 210, 0.9)",
    fill: "rgba(0, 255, 100, 0.03)",
    text: "#00ff64"
  },
  {
    // gold — depth 3
    stroke: "#ffc800",
    glow: "rgba(255, 200, 0, 0.25)",
    core: "rgba(255, 240, 180, 0.9)",
    fill: "rgba(255, 200, 0, 0.03)",
    text: "#ffc800"
  },
  {
    // violet — depth 4+
    stroke: "#b464ff",
    glow: "rgba(180, 100, 255, 0.25)",
    core: "rgba(220, 190, 255, 0.9)",
    fill: "rgba(180, 100, 255, 0.03)",
    text: "#b464ff"
  }
];
var BREATHE_PERIOD = 4e3;
var SCAN_PERIOD = 3e3;
var CORNER_DOT_R = 2.5;
var TAPER_LENGTH = 8;
var BlueprintModeStrategy = class {
  name = "blueprint";
  icon = BLUEPRINT_SVG;
  #provider = null;
  #atoms = [];
  #overlayContainer = null;
  #svgNS = "http://www.w3.org/2000/svg";
  #tickerId = 0;
  #startTime = 0;
  #active = false;
  #scanElements = [];
  enter(target, atoms) {
    this.#provider = target;
    this.#atoms = atoms;
    this.#active = true;
    this.#startTime = performance.now();
    this.#scanElements = [];
    this.#overlayContainer = document.createElement("div");
    this.#overlayContainer.className = "atomizer-blueprint-overlay";
    this.#overlayContainer.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 50000;
    `;
    document.body.appendChild(this.#overlayContainer);
    this.#renderAtoms(atoms);
    this.#tick();
    console.log(`[blueprint] Overlaying ${atoms.length} atom wireframes`);
  }
  exit() {
    this.#active = false;
    if (this.#tickerId) {
      cancelAnimationFrame(this.#tickerId);
      this.#tickerId = 0;
    }
    if (this.#overlayContainer) {
      this.#overlayContainer.remove();
      this.#overlayContainer = null;
    }
    this.#scanElements = [];
    this.#provider = null;
    this.#atoms = [];
  }
  switchTo(atoms) {
    const provider = this.#provider;
    this.exit();
    if (provider) {
      this.enter(provider, atoms);
    }
  }
  onAtomSelect(atom) {
    EffectBus.emit("atomize:atom-selected", { atom, strategy: "blueprint" });
  }
  // ---------------------------------------------------------------------------
  // Rendering — SVG-based for sub-pixel precision
  // ---------------------------------------------------------------------------
  #renderAtoms(atoms) {
    if (!this.#overlayContainer) return;
    for (const atom of atoms) {
      const theme = NEON_THEMES[Math.min(atom.depth, NEON_THEMES.length - 1)];
      const b = atom.bounds;
      const w = b.width;
      const h = b.height;
      const pad = 4;
      const wrapper = document.createElement("div");
      wrapper.className = "atomizer-blueprint-atom";
      wrapper.dataset["atomName"] = atom.name;
      wrapper.style.cssText = `
        position: fixed;
        left: ${b.x - pad}px;
        top: ${b.y - pad}px;
        width: ${w + pad * 2}px;
        height: ${h + pad * 2}px;
        pointer-events: auto;
        cursor: pointer;
      `;
      const svg = document.createElementNS(this.#svgNS, "svg");
      svg.setAttribute("width", String(w + pad * 2));
      svg.setAttribute("height", String(h + pad * 2));
      svg.setAttribute("viewBox", `0 0 ${w + pad * 2} ${h + pad * 2}`);
      svg.style.cssText = `position: absolute; inset: 0; overflow: visible;`;
      const defs = document.createElementNS(this.#svgNS, "defs");
      const filterId = `bp-glow-${atom.name}-${atom.depth}`;
      const filter = document.createElementNS(this.#svgNS, "filter");
      filter.setAttribute("id", filterId);
      filter.setAttribute("x", "-50%");
      filter.setAttribute("y", "-50%");
      filter.setAttribute("width", "200%");
      filter.setAttribute("height", "200%");
      const feBlur = document.createElementNS(this.#svgNS, "feGaussianBlur");
      feBlur.setAttribute("in", "SourceGraphic");
      feBlur.setAttribute("stdDeviation", "3");
      feBlur.setAttribute("result", "blur");
      filter.appendChild(feBlur);
      const feMerge = document.createElementNS(this.#svgNS, "feMerge");
      const mn1 = document.createElementNS(this.#svgNS, "feMergeNode");
      mn1.setAttribute("in", "blur");
      feMerge.appendChild(mn1);
      const mn2 = document.createElementNS(this.#svgNS, "feMergeNode");
      mn2.setAttribute("in", "SourceGraphic");
      feMerge.appendChild(mn2);
      filter.appendChild(feMerge);
      defs.appendChild(filter);
      svg.appendChild(defs);
      const fill = document.createElementNS(this.#svgNS, "rect");
      fill.setAttribute("x", String(pad));
      fill.setAttribute("y", String(pad));
      fill.setAttribute("width", String(w));
      fill.setAttribute("height", String(h));
      fill.setAttribute("rx", "2");
      fill.setAttribute("fill", theme.fill);
      svg.appendChild(fill);
      const cx = pad;
      const cy = pad;
      const lineW = 1.2;
      const taperW = 0.15;
      const tl = Math.min(TAPER_LENGTH, w / 4, h / 4);
      const edges = [
        // top edge: left→right
        { x1: cx, y1: cy, x2: cx + w, y2: cy, nx: 0, ny: -1 },
        // right edge: top→bottom
        { x1: cx + w, y1: cy, x2: cx + w, y2: cy + h, nx: 1, ny: 0 },
        // bottom edge: right→left
        { x1: cx + w, y1: cy + h, x2: cx, y2: cy + h, nx: 0, ny: 1 },
        // left edge: bottom→top
        { x1: cx, y1: cy + h, x2: cx, y2: cy, nx: -1, ny: 0 }
      ];
      const glowGroup = document.createElementNS(this.#svgNS, "g");
      glowGroup.setAttribute("filter", `url(#${filterId})`);
      for (const edge of edges) {
        const poly = this.#createTaperedLine(edge, lineW * 2.5, taperW * 2, tl, theme.glow);
        glowGroup.appendChild(poly);
      }
      svg.appendChild(glowGroup);
      for (const edge of edges) {
        const poly = this.#createTaperedLine(edge, lineW, taperW, tl, theme.stroke);
        svg.appendChild(poly);
      }
      for (const edge of edges) {
        const poly = this.#createTaperedLine(edge, lineW * 0.4, taperW * 0.3, tl, theme.core);
        svg.appendChild(poly);
      }
      const corners = [
        [cx, cy],
        [cx + w, cy],
        [cx + w, cy + h],
        [cx, cy + h]
      ];
      for (const [cornerX, cornerY] of corners) {
        const outerDot = document.createElementNS(this.#svgNS, "circle");
        outerDot.setAttribute("cx", String(cornerX));
        outerDot.setAttribute("cy", String(cornerY));
        outerDot.setAttribute("r", String(CORNER_DOT_R * 2.5));
        outerDot.setAttribute("fill", theme.glow);
        outerDot.setAttribute("filter", `url(#${filterId})`);
        svg.appendChild(outerDot);
        const coreDot = document.createElementNS(this.#svgNS, "circle");
        coreDot.setAttribute("cx", String(cornerX));
        coreDot.setAttribute("cy", String(cornerY));
        coreDot.setAttribute("r", String(CORNER_DOT_R));
        coreDot.setAttribute("fill", theme.core);
        svg.appendChild(coreDot);
      }
      const scanDot = document.createElementNS(this.#svgNS, "circle");
      scanDot.setAttribute("r", "3");
      scanDot.setAttribute("fill", theme.core);
      scanDot.setAttribute("filter", `url(#${filterId})`);
      svg.appendChild(scanDot);
      const segments = edges.map((e) => ({
        x1: e.x1,
        y1: e.y1,
        x2: e.x2,
        y2: e.y2,
        len: Math.sqrt((e.x2 - e.x1) ** 2 + (e.y2 - e.y1) ** 2)
      }));
      const perimeter = segments.reduce((s, seg) => s + seg.len, 0);
      this.#scanElements.push({ el: scanDot, perimeter, segments });
      wrapper.appendChild(svg);
      const label = document.createElement("span");
      label.textContent = atom.name;
      label.style.cssText = `
        position: absolute;
        top: -2px;
        left: ${pad + 3}px;
        font-size: 9px;
        font-weight: 600;
        font-family: monospace;
        letter-spacing: 0.5px;
        color: ${theme.text};
        text-shadow: 0 0 6px ${theme.glow}, 0 0 2px ${theme.stroke};
        white-space: nowrap;
        pointer-events: none;
        transform: translateY(-100%);
      `;
      wrapper.appendChild(label);
      const badge = document.createElement("span");
      badge.textContent = atom.type;
      badge.style.cssText = `
        position: absolute;
        bottom: -2px;
        right: ${pad + 3}px;
        font-size: 7px;
        font-family: monospace;
        letter-spacing: 0.3px;
        color: ${theme.text};
        opacity: 0.4;
        pointer-events: none;
        transform: translateY(100%);
      `;
      wrapper.appendChild(badge);
      wrapper.addEventListener("click", () => this.onAtomSelect(atom));
      wrapper.addEventListener("mouseenter", () => {
        fill.setAttribute("fill", theme.fill.replace("0.03", "0.08"));
        EffectBus.emit("atomize:atom-hover", { atom, strategy: "blueprint" });
      });
      wrapper.addEventListener("mouseleave", () => {
        fill.setAttribute("fill", theme.fill);
      });
      this.#overlayContainer.appendChild(wrapper);
      if (atom.children?.length) {
        this.#renderAtoms(atom.children);
      }
    }
  }
  // ---------------------------------------------------------------------------
  // Tapered line — a polygon that narrows from center thickness to fine points
  // ---------------------------------------------------------------------------
  #createTaperedLine(edge, centerHalfW, tipHalfW, taperLen, color) {
    const { x1, y1, x2, y2, nx, ny } = edge;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) {
      const poly2 = document.createElementNS(this.#svgNS, "polygon");
      poly2.setAttribute("points", `${x1},${y1}`);
      return poly2;
    }
    const ux = dx / len;
    const uy = dy / len;
    const px = ny !== 0 ? 0 : nx > 0 ? -1 : 1;
    const py = nx !== 0 ? 0 : ny > 0 ? -1 : 1;
    const perpX = -uy;
    const perpY = ux;
    const tl = Math.min(taperLen, len / 2);
    const points = [];
    points.push(`${x1 + perpX * tipHalfW},${y1 + perpY * tipHalfW}`);
    const taperStartX = x1 + ux * tl;
    const taperStartY = y1 + uy * tl;
    points.push(`${taperStartX + perpX * centerHalfW},${taperStartY + perpY * centerHalfW}`);
    const taperEndX = x2 - ux * tl;
    const taperEndY = y2 - uy * tl;
    points.push(`${taperEndX + perpX * centerHalfW},${taperEndY + perpY * centerHalfW}`);
    points.push(`${x2 + perpX * tipHalfW},${y2 + perpY * tipHalfW}`);
    points.push(`${x2 - perpX * tipHalfW},${y2 - perpY * tipHalfW}`);
    points.push(`${taperEndX - perpX * centerHalfW},${taperEndY - perpY * centerHalfW}`);
    points.push(`${taperStartX - perpX * centerHalfW},${taperStartY - perpY * centerHalfW}`);
    points.push(`${x1 - perpX * tipHalfW},${y1 - perpY * tipHalfW}`);
    const poly = document.createElementNS(this.#svgNS, "polygon");
    poly.setAttribute("points", points.join(" "));
    poly.setAttribute("fill", color);
    return poly;
  }
  // ---------------------------------------------------------------------------
  // Animation tick — breathe + scan highlight
  // ---------------------------------------------------------------------------
  #tick = () => {
    if (!this.#active || !this.#overlayContainer) return;
    const elapsed = performance.now() - this.#startTime;
    const breathe = 0.85 + 0.15 * Math.sin(elapsed / BREATHE_PERIOD * Math.PI * 2);
    this.#overlayContainer.style.opacity = String(breathe);
    for (const scan of this.#scanElements) {
      const t = elapsed % SCAN_PERIOD / SCAN_PERIOD;
      let distAlong = t * scan.perimeter;
      let placed = false;
      for (const seg of scan.segments) {
        if (distAlong <= seg.len) {
          const segT = distAlong / seg.len;
          const sx = seg.x1 + (seg.x2 - seg.x1) * segT;
          const sy = seg.y1 + (seg.y2 - seg.y1) * segT;
          scan.el.setAttribute("cx", String(sx));
          scan.el.setAttribute("cy", String(sy));
          placed = true;
          break;
        }
        distAlong -= seg.len;
      }
      if (!placed) {
        scan.el.setAttribute("cx", String(scan.segments[0].x1));
        scan.el.setAttribute("cy", String(scan.segments[0].y1));
      }
    }
    this.#tickerId = requestAnimationFrame(this.#tick);
  };
};
var strategy = new BlueprintModeStrategy();
var ioc = globalThis.ioc;
ioc?.whenReady?.("@diamondcoreprocessor.com/AtomizeDrone", (drone) => {
  drone.registerStrategy(strategy);
});
console.log("[BlueprintModeStrategy] Loaded");

// src/diamondcoreprocessor.com/assistant/strategies/cascade-waterfall.strategy.ts
import { EffectBus as EffectBus2 } from "@hypercomb/core";
var CASCADE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="6" rx="1"/><rect x="4" y="10" width="16" height="6" rx="1"/><rect x="4" y="18" width="16" height="4" rx="1"/></svg>';
var CARD_STAGGER_MS = 80;
var SLIDE_DURATION_MS = 300;
var CascadeWaterfallStrategy = class {
  name = "cascade";
  icon = CASCADE_SVG;
  #provider = null;
  #atoms = [];
  #panelContainer = null;
  #animationFrames = [];
  enter(target, atoms) {
    this.#provider = target;
    this.#atoms = atoms;
    this.#panelContainer = document.createElement("div");
    this.#panelContainer.className = "atomizer-cascade-panel";
    this.#panelContainer.style.cssText = `
      position: fixed;
      right: 0;
      top: 0;
      bottom: 0;
      width: 280px;
      background: rgba(10, 10, 18, 0.95);
      border-left: 1px solid rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(12px);
      overflow-y: auto;
      overflow-x: hidden;
      z-index: 50000;
      padding: 12px;
      transform: translateX(280px);
      transition: transform ${SLIDE_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
    `;
    document.body.appendChild(this.#panelContainer);
    const header = document.createElement("div");
    header.style.cssText = `
      font-size: 11px;
      font-family: monospace;
      color: rgba(255, 255, 255, 0.5);
      padding: 4px 0 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      margin-bottom: 8px;
    `;
    header.textContent = `${atoms.length} atoms`;
    this.#panelContainer.appendChild(header);
    requestAnimationFrame(() => {
      if (this.#panelContainer) {
        this.#panelContainer.style.transform = "translateX(0)";
      }
    });
    this.#renderCards(atoms);
    console.log(`[cascade] Panel with ${atoms.length} atom cards`);
  }
  exit() {
    for (const frame of this.#animationFrames) {
      window.clearTimeout(frame);
    }
    this.#animationFrames = [];
    if (this.#panelContainer) {
      this.#panelContainer.style.transform = "translateX(280px)";
      const panel = this.#panelContainer;
      window.setTimeout(() => panel.remove(), SLIDE_DURATION_MS);
      this.#panelContainer = null;
    }
    this.#provider = null;
    this.#atoms = [];
  }
  switchTo(atoms) {
    const provider = this.#provider;
    this.exit();
    if (provider) {
      this.enter(provider, atoms);
    }
  }
  onAtomSelect(atom) {
    EffectBus2.emit("atomize:atom-selected", { atom, strategy: "cascade" });
  }
  #renderCards(atoms, indent = 0) {
    for (let i = 0; i < atoms.length; i++) {
      const atom = atoms[i];
      const delay = i * CARD_STAGGER_MS;
      const frame = window.setTimeout(() => {
        this.#createCard(atom, indent);
      }, delay + SLIDE_DURATION_MS);
      this.#animationFrames.push(frame);
      if (atom.children?.length) {
        this.#renderCards(atom.children, indent + 1);
      }
    }
  }
  #createCard(atom, indent) {
    if (!this.#panelContainer) return;
    const card = document.createElement("div");
    card.className = "atomizer-cascade-card";
    card.style.cssText = `
      margin: 4px 0 4px ${indent * 12}px;
      padding: 8px 10px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 6px;
      cursor: pointer;
      opacity: 0;
      transform: translateX(20px);
      transition: opacity 0.2s ease, transform 0.2s ease, background 0.15s ease;
    `;
    const name = document.createElement("div");
    name.style.cssText = `
      font-size: 11px;
      font-family: monospace;
      color: rgba(255, 255, 255, 0.85);
      margin-bottom: 2px;
    `;
    name.textContent = atom.name;
    card.appendChild(name);
    const meta = document.createElement("div");
    meta.style.cssText = `
      font-size: 9px;
      font-family: monospace;
      color: rgba(255, 255, 255, 0.35);
    `;
    meta.textContent = `${atom.type} \xB7 depth ${atom.depth}`;
    card.appendChild(meta);
    const styleKeys = Object.keys(atom.styles);
    if (styleKeys.length > 0) {
      const stylePreview = document.createElement("div");
      stylePreview.style.cssText = `
        margin-top: 6px;
        font-size: 9px;
        font-family: monospace;
        color: rgba(0, 255, 200, 0.5);
        max-height: 48px;
        overflow: hidden;
      `;
      stylePreview.textContent = styleKeys.slice(0, 3).map((k) => `${k}: ${atom.styles[k]}`).join("\n");
      card.appendChild(stylePreview);
    }
    card.addEventListener("mouseenter", () => {
      card.style.background = "rgba(255, 255, 255, 0.06)";
      EffectBus2.emit("atomize:atom-hover", { atom, strategy: "cascade" });
    });
    card.addEventListener("mouseleave", () => {
      card.style.background = "rgba(255, 255, 255, 0.03)";
    });
    card.addEventListener("click", () => this.onAtomSelect(atom));
    this.#panelContainer.appendChild(card);
    requestAnimationFrame(() => {
      card.style.opacity = "1";
      card.style.transform = "translateX(0)";
    });
  }
};
var strategy2 = new CascadeWaterfallStrategy();
var ioc2 = globalThis.ioc;
ioc2?.whenReady?.("@diamondcoreprocessor.com/AtomizeDrone", (drone) => {
  drone.registerStrategy(strategy2);
});
console.log("[CascadeWaterfallStrategy] Loaded");

// src/diamondcoreprocessor.com/assistant/strategies/orbital-inspector.strategy.ts
import { EffectBus as EffectBus3 } from "@hypercomb/core";
var ORBITAL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-30 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(30 12 12)"/></svg>';
var OrbitalInspectorStrategy = class {
  name = "orbital";
  icon = ORBITAL_SVG;
  #provider = null;
  #atoms = [];
  #rings = [];
  #tickerId = 0;
  #startTime = 0;
  #active = false;
  enter(target, atoms) {
    this.#provider = target;
    this.#atoms = atoms;
    this.#active = true;
    this.#startTime = performance.now();
    const depthGroups = /* @__PURE__ */ new Map();
    for (const atom of atoms) {
      const group = depthGroups.get(atom.depth) ?? [];
      group.push(atom);
      depthGroups.set(atom.depth, group);
    }
    this.#rings = [];
    const baseRadius = 80;
    let ringIndex = 0;
    for (const [, group] of [...depthGroups.entries()].sort((a, b) => a[0] - b[0])) {
      this.#rings.push({
        atoms: group,
        radiusX: baseRadius + ringIndex * 60,
        radiusY: (baseRadius + ringIndex * 60) * 0.6,
        period: 8 + ringIndex * 2,
        phaseOffset: Math.PI * 2 / group.length
      });
      ringIndex++;
    }
    this.#tick();
    EffectBus3.emit("atomize:orbital-entered", {
      ringCount: this.#rings.length,
      atomCount: atoms.length
    });
    console.log(`[orbital] ${atoms.length} atoms in ${this.#rings.length} rings`);
  }
  exit() {
    this.#active = false;
    if (this.#tickerId) {
      cancelAnimationFrame(this.#tickerId);
      this.#tickerId = 0;
    }
    this.#rings = [];
    this.#provider = null;
    this.#atoms = [];
    EffectBus3.emit("atomize:orbital-exited", {});
  }
  switchTo(atoms) {
    const provider = this.#provider;
    this.exit();
    if (provider) {
      this.enter(provider, atoms);
    }
  }
  onAtomSelect(atom) {
    EffectBus3.emit("atomize:atom-selected", { atom, strategy: "orbital" });
  }
  #tick = () => {
    if (!this.#active) return;
    const elapsed = (performance.now() - this.#startTime) / 1e3;
    for (const ring of this.#rings) {
      for (let i = 0; i < ring.atoms.length; i++) {
        const atom = ring.atoms[i];
        const phase = elapsed / ring.period * Math.PI * 2 + i * ring.phaseOffset;
        const x = ring.radiusX * Math.cos(phase);
        const y = ring.radiusY * Math.sin(phase * 1.5);
        EffectBus3.emit("atomize:orbital-position", {
          atomName: atom.name,
          x,
          y,
          phase: phase % (Math.PI * 2)
        });
      }
    }
    this.#tickerId = requestAnimationFrame(this.#tick);
  };
};
var strategy3 = new OrbitalInspectorStrategy();
var ioc3 = globalThis.ioc;
ioc3?.whenReady?.("@diamondcoreprocessor.com/AtomizeDrone", (drone) => {
  drone.registerStrategy(strategy3);
});
console.log("[OrbitalInspectorStrategy] Loaded");

// src/diamondcoreprocessor.com/assistant/strategies/particle-disassembly.strategy.ts
import { EffectBus as EffectBus4 } from "@hypercomb/core";
var PARTICLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="1.5"/><circle cx="18" cy="6" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="6" cy="18" r="1.5"/><circle cx="18" cy="18" r="1.5"/><circle cx="3" cy="12" r="1"/><circle cx="21" cy="12" r="1"/><circle cx="12" cy="3" r="1"/><circle cx="12" cy="21" r="1"/></svg>';
var PHASE_DISSOLVE = 800;
var PHASE_CONVERGE = 500;
var PARTICLES_PER_ATOM = 24;
var hash = (x, y) => {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ h >> 13) * 1274126177;
  return ((h ^ h >> 16) & 2147483647) / 2147483647;
};
var ParticleDisassemblyStrategy = class {
  name = "particle";
  icon = PARTICLE_SVG;
  #provider = null;
  #atoms = [];
  #canvas = null;
  #ctx = null;
  #particles = [];
  #tickerId = 0;
  #startTime = 0;
  #active = false;
  #phase = "dissolve";
  enter(target, atoms) {
    this.#provider = target;
    this.#atoms = atoms;
    this.#active = true;
    this.#startTime = performance.now();
    this.#phase = "dissolve";
    this.#canvas = document.createElement("canvas");
    this.#canvas.className = "atomizer-particle-canvas";
    this.#canvas.width = window.innerWidth;
    this.#canvas.height = window.innerHeight;
    this.#canvas.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 50000;
    `;
    document.body.appendChild(this.#canvas);
    this.#ctx = this.#canvas.getContext("2d");
    this.#generateParticles(atoms);
    this.#tick();
    console.log(`[particle] ${this.#particles.length} particles from ${atoms.length} atoms`);
  }
  exit() {
    this.#active = false;
    if (this.#tickerId) {
      cancelAnimationFrame(this.#tickerId);
      this.#tickerId = 0;
    }
    if (this.#canvas) {
      this.#canvas.remove();
      this.#canvas = null;
      this.#ctx = null;
    }
    this.#particles = [];
    this.#provider = null;
    this.#atoms = [];
  }
  switchTo(atoms) {
    const provider = this.#provider;
    this.exit();
    if (provider) {
      this.enter(provider, atoms);
    }
  }
  onAtomSelect(atom) {
    EffectBus4.emit("atomize:atom-selected", { atom, strategy: "particle" });
  }
  #generateParticles(atoms) {
    this.#particles = [];
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const colors = [
      "#00ffff",
      "#ff00c8",
      "#00ff64",
      "#ffc800",
      "#b464ff"
    ];
    for (let ai = 0; ai < atoms.length; ai++) {
      const atom = atoms[ai];
      const color = colors[ai % colors.length];
      const angle = ai / atoms.length * Math.PI * 2;
      const ringRadius = 120 + atom.depth * 50;
      const tx = centerX + Math.cos(angle) * ringRadius;
      const ty = centerY + Math.sin(angle) * ringRadius;
      for (let p = 0; p < PARTICLES_PER_ATOM; p++) {
        const sx = atom.bounds.x + hash(ai * 100 + p, 0) * atom.bounds.width;
        const sy = atom.bounds.y + hash(ai * 100 + p, 1) * atom.bounds.height;
        this.#particles.push({
          sx,
          sy,
          tx: tx + (hash(ai * 100 + p, 2) - 0.5) * 30,
          ty: ty + (hash(ai * 100 + p, 3) - 0.5) * 30,
          x: sx,
          y: sy,
          color,
          phase: hash(ai * 100 + p, 4) * Math.PI * 2,
          atomIndex: ai
        });
      }
    }
  }
  #tick = () => {
    if (!this.#active || !this.#ctx || !this.#canvas) return;
    const elapsed = performance.now() - this.#startTime;
    const ctx = this.#ctx;
    if (this.#phase === "dissolve" && elapsed > PHASE_DISSOLVE) {
      this.#phase = "converge";
    }
    if (this.#phase === "converge" && elapsed > PHASE_DISSOLVE + PHASE_CONVERGE) {
      this.#phase = "settled";
    }
    ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    for (const p of this.#particles) {
      let t;
      if (this.#phase === "dissolve") {
        t = Math.min(elapsed / PHASE_DISSOLVE, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        const midX = (p.sx + p.tx) / 2 + Math.sin(p.phase + elapsed * 3e-3) * 60;
        const midY = (p.sy + p.ty) / 2 + Math.cos(p.phase * 1.3 + elapsed * 2e-3) * 60;
        p.x = p.sx + (midX - p.sx) * ease;
        p.y = p.sy + (midY - p.sy) * ease;
      } else if (this.#phase === "converge") {
        const convergeElapsed = elapsed - PHASE_DISSOLVE;
        t = Math.min(convergeElapsed / PHASE_CONVERGE, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        const midX = (p.sx + p.tx) / 2 + Math.sin(p.phase) * 60 * (1 - ease);
        const midY = (p.sy + p.ty) / 2 + Math.cos(p.phase * 1.3) * 60 * (1 - ease);
        p.x = midX + (p.tx - midX) * ease;
        p.y = midY + (p.ty - midY) * ease;
      } else {
        const drift = Math.sin(elapsed * 1e-3 + p.phase) * 3;
        p.x = p.tx + drift;
        p.y = p.ty + Math.cos(elapsed * 12e-4 + p.phase) * 3;
      }
      const alpha = this.#phase === "dissolve" ? 0.5 + 0.5 * Math.sin(elapsed * 5e-3 + p.phase) : this.#phase === "converge" ? 0.7 : 0.85;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.globalAlpha = alpha * 0.25;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (this.#phase === "settled") {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      for (let ai = 0; ai < this.#atoms.length; ai++) {
        const atom = this.#atoms[ai];
        const angle = ai / this.#atoms.length * Math.PI * 2;
        const ringRadius = 120 + atom.depth * 50;
        const x = centerX + Math.cos(angle) * ringRadius;
        const y = centerY + Math.sin(angle) * ringRadius;
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.fillText(atom.name, x, y + 22);
      }
    }
    this.#tickerId = requestAnimationFrame(this.#tick);
  };
};
var strategy4 = new ParticleDisassemblyStrategy();
var ioc4 = globalThis.ioc;
ioc4?.whenReady?.("@diamondcoreprocessor.com/AtomizeDrone", (drone) => {
  drone.registerStrategy(strategy4);
});
console.log("[ParticleDisassemblyStrategy] Loaded");

// src/diamondcoreprocessor.com/assistant/strategies/shatter-to-hex.strategy.ts
import { EffectBus as EffectBus5 } from "@hypercomb/core";
var SHATTER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
var STAGGER_MS = 180;
var ShatterToHexStrategy = class {
  name = "shatter";
  icon = SHATTER_SVG;
  #provider = null;
  #atoms = [];
  #addedSeeds = [];
  #animationFrames = [];
  enter(target, atoms) {
    this.#provider = target;
    this.#atoms = atoms;
    this.#addedSeeds = [];
    for (let i = 0; i < atoms.length; i++) {
      const atom = atoms[i];
      const seed = `atom:${atom.name}`;
      this.#addedSeeds.push(seed);
      const frame = window.setTimeout(() => {
        EffectBus5.emit("seed:added", { seed });
        EffectBus5.emit("atomize:atom-placed", {
          atom,
          index: i,
          total: atoms.length,
          seed
        });
      }, i * STAGGER_MS);
      this.#animationFrames.push(frame);
    }
    console.log(`[shatter] Shattering ${atoms.length} atoms onto grid`);
  }
  exit() {
    for (const frame of this.#animationFrames) {
      window.clearTimeout(frame);
    }
    this.#animationFrames = [];
    for (const seed of this.#addedSeeds) {
      EffectBus5.emit("seed:removed", { seed });
    }
    this.#addedSeeds = [];
    this.#provider = null;
    this.#atoms = [];
  }
  switchTo(atoms) {
    this.exit();
    if (this.#provider) {
      this.enter(this.#provider, atoms);
    }
  }
  onAtomSelect(atom) {
    EffectBus5.emit("atomize:atom-selected", { atom, strategy: "shatter" });
  }
};
var strategy5 = new ShatterToHexStrategy();
var ioc5 = globalThis.ioc;
ioc5?.whenReady?.("@diamondcoreprocessor.com/AtomizeDrone", (drone) => {
  drone.registerStrategy(strategy5);
});
console.log("[ShatterToHexStrategy] Loaded");
export {
  BlueprintModeStrategy,
  CascadeWaterfallStrategy,
  OrbitalInspectorStrategy,
  ParticleDisassemblyStrategy,
  ShatterToHexStrategy
};
