// @diamondcoreprocessor.com/assistant/strategies
// src/diamondcoreprocessor.com/assistant/strategies/blueprint-mode.strategy.ts
import { EffectBus } from "@hypercomb/core";
var BLUEPRINT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>';
var NEON_COLORS = [
  "rgba(0, 255, 255, 0.8)",
  // cyan — depth 0
  "rgba(255, 0, 200, 0.8)",
  // magenta — depth 1
  "rgba(0, 255, 100, 0.8)",
  // emerald — depth 2
  "rgba(255, 200, 0, 0.8)",
  // gold — depth 3
  "rgba(180, 100, 255, 0.8)"
  // violet — depth 4+
];
var BREATHE_PERIOD = 4e3;
var BlueprintModeStrategy = class {
  name = "blueprint";
  icon = BLUEPRINT_SVG;
  #provider = null;
  #atoms = [];
  #overlayContainer = null;
  #tickerId = 0;
  #startTime = 0;
  #active = false;
  enter(target, atoms) {
    this.#provider = target;
    this.#atoms = atoms;
    this.#active = true;
    this.#startTime = performance.now();
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
  #renderAtoms(atoms) {
    if (!this.#overlayContainer) return;
    for (const atom of atoms) {
      const el = document.createElement("div");
      el.className = "atomizer-blueprint-atom";
      el.dataset["atomName"] = atom.name;
      const color = NEON_COLORS[Math.min(atom.depth, NEON_COLORS.length - 1)];
      el.style.cssText = `
        position: fixed;
        left: ${atom.bounds.x}px;
        top: ${atom.bounds.y}px;
        width: ${atom.bounds.width}px;
        height: ${atom.bounds.height}px;
        border: 1.5px solid ${color};
        border-radius: 3px;
        pointer-events: auto;
        cursor: pointer;
        box-shadow: 0 0 6px ${color}, inset 0 0 4px ${color.replace("0.8", "0.15")};
        transition: box-shadow 0.2s ease;
      `;
      const label = document.createElement("span");
      label.className = "atomizer-blueprint-label";
      label.textContent = atom.name;
      label.style.cssText = `
        position: absolute;
        top: -18px;
        left: 2px;
        font-size: 10px;
        font-family: monospace;
        color: ${color};
        text-shadow: 0 0 4px ${color};
        white-space: nowrap;
        pointer-events: none;
      `;
      el.appendChild(label);
      const badge = document.createElement("span");
      badge.className = "atomizer-blueprint-badge";
      badge.textContent = atom.type;
      badge.style.cssText = `
        position: absolute;
        bottom: -16px;
        right: 2px;
        font-size: 8px;
        font-family: monospace;
        color: ${color.replace("0.8", "0.5")};
        pointer-events: none;
      `;
      el.appendChild(badge);
      el.addEventListener("click", () => this.onAtomSelect(atom));
      el.addEventListener("mouseenter", () => {
        el.style.boxShadow = `0 0 12px ${color}, 0 0 24px ${color.replace("0.8", "0.4")}, inset 0 0 8px ${color.replace("0.8", "0.25")}`;
        EffectBus.emit("atomize:atom-hover", { atom, strategy: "blueprint" });
      });
      el.addEventListener("mouseleave", () => {
        el.style.boxShadow = `0 0 6px ${color}, inset 0 0 4px ${color.replace("0.8", "0.15")}`;
      });
      this.#overlayContainer.appendChild(el);
      if (atom.children?.length) {
        this.#renderAtoms(atom.children);
      }
    }
  }
  #tick = () => {
    if (!this.#active || !this.#overlayContainer) return;
    const elapsed = performance.now() - this.#startTime;
    const breathe = 0.8 + 0.2 * Math.sin(elapsed / BREATHE_PERIOD * Math.PI * 2);
    this.#overlayContainer.style.opacity = String(breathe);
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
