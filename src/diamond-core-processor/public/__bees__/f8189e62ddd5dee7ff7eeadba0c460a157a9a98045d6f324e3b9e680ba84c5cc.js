// hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/pixi-debug.drone.ts
import { Drone } from "@hypercomb/core";
import { Container, Mesh, Text, Graphics, Sprite, Point } from "pixi.js";
function hitCollect(root, globalPt, out) {
  if (!root.visible || root.alpha <= 0) return;
  for (let i = root.children.length - 1; i >= 0; i--) {
    const child = root.children[i];
    hitCollect(child, globalPt, out);
  }
  try {
    const bounds = root.getBounds();
    if (globalPt.x >= bounds.x && globalPt.x <= bounds.x + bounds.width && globalPt.y >= bounds.y && globalPt.y <= bounds.y + bounds.height) {
      out.push(root);
    }
  } catch {
  }
}
function walkTree(node, depth, lines) {
  const tag = describeObject(node);
  const vis = node.visible ? "" : " [hidden]";
  const prefix = "  ".repeat(depth);
  lines.push(`${prefix}${tag}${vis}  pos(${node.position.x.toFixed(1)}, ${node.position.y.toFixed(1)})  z:${node.zIndex ?? "-"}`);
  for (const child of node.children) {
    walkTree(child, depth + 1, lines);
  }
}
function describeObject(obj) {
  if (obj instanceof Mesh) return `Mesh`;
  if (obj instanceof Text) return `Text("${(obj.text ?? "").slice(0, 24)}")`;
  if (obj instanceof Sprite) return `Sprite`;
  if (obj instanceof Graphics) return `Graphics`;
  if (obj instanceof Container && obj.children.length > 0) return `Container(${obj.children.length})`;
  if (obj instanceof Container) return `Container`;
  return obj.constructor?.name ?? "DisplayObject";
}
function formatObjectInfo(obj) {
  const lines = [];
  const type = describeObject(obj);
  lines.push(`type: ${type}`);
  lines.push(`pos: (${obj.position.x.toFixed(1)}, ${obj.position.y.toFixed(1)})`);
  lines.push(`scale: (${obj.scale.x.toFixed(2)}, ${obj.scale.y.toFixed(2)})`);
  lines.push(`visible: ${obj.visible}  alpha: ${obj.alpha.toFixed(2)}`);
  lines.push(`children: ${obj.children.length}`);
  if (obj.zIndex !== void 0) lines.push(`zIndex: ${obj.zIndex}`);
  try {
    const b = obj.getBounds();
    lines.push(`bounds: ${b.width.toFixed(0)}\xD7${b.height.toFixed(0)} @ (${b.x.toFixed(0)},${b.y.toFixed(0)})`);
  } catch {
  }
  if (obj instanceof Text) lines.push(`text: "${(obj.text ?? "").slice(0, 60)}"`);
  if (obj instanceof Mesh) {
    const geo = obj.geometry;
    if (geo) lines.push(`geometry buffers: ${geo.buffers?.length ?? "?"}`);
  }
  const iocLabel = findIocLabel(obj);
  if (iocLabel) lines.push(`ioc: ${iocLabel}`);
  return lines.join("\n");
}
function findIocLabel(obj) {
  const ioc = window.ioc;
  if (!ioc?.list) return null;
  let current = obj;
  while (current) {
    const all = ioc.list();
    const entries = all instanceof Map ? [...all.entries()] : Object.entries(all);
    for (const [key, val] of entries) {
      if (!val || typeof val !== "object") continue;
      for (const prop of ["layer", "overlay", "container", "mesh"]) {
        if (val[prop] === current) return `${key}.${prop}`;
      }
      if (val === current) return key;
    }
    current = current.parent;
  }
  return null;
}
function createPanel() {
  const el = document.createElement("div");
  el.id = "pixi-debug-panel";
  el.style.cssText = `
    position: fixed; bottom: 8px; left: 8px; z-index: 999999;
    background: rgba(0,0,0,0.88); color: #0f0; font: 11px/1.4 monospace;
    padding: 8px 10px; border-radius: 1px; pointer-events: none;
    max-width: 420px; white-space: pre-wrap; word-break: break-all;
    border: 1px solid rgba(0,255,0,0.3);
    transition: opacity 0.15s;
  `;
  document.body.appendChild(el);
  return el;
}
function createHitListPanel() {
  const el = document.createElement("div");
  el.id = "pixi-debug-hitlist";
  el.style.cssText = `
    position: fixed; top: 8px; right: 8px; z-index: 999999;
    background: rgba(0,0,0,0.88); color: #0f0; font: 11px/1.4 monospace;
    padding: 8px 10px; border-radius: 1px; pointer-events: auto;
    max-width: 360px; max-height: 60vh; overflow-y: auto;
    white-space: pre-wrap; word-break: break-all;
    border: 1px solid rgba(0,255,0,0.3);
  `;
  document.body.appendChild(el);
  return el;
}
var PixiDebugDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "dev-only Pixi display-tree inspector \u2014 hover to identify objects";
  #app = null;
  #renderContainer = null;
  #renderer = null;
  #canvas = null;
  #panel = null;
  #hitListPanel = null;
  #listening = false;
  #active = false;
  #pinnedObj = null;
  listens = ["render:host-ready"];
  heartbeat = async () => {
    this.onEffect("render:host-ready", (payload) => {
      this.#app = payload.app;
      this.#renderContainer = payload.container;
      this.#canvas = payload.canvas;
      this.#renderer = payload.renderer;
      this.#attach();
    });
  };
  dispose() {
    this.#detach();
  }
  // ── Setup ─────────────────────────────────────────────────────────────
  #attach() {
    if (this.#listening) return;
    this.#listening = true;
    this.#panel = createPanel();
    this.#hitListPanel = createHitListPanel();
    this.#panel.style.display = "none";
    this.#hitListPanel.style.display = "none";
    document.addEventListener("pointermove", this.#onMove);
    document.addEventListener("keydown", this.#onKey);
    this.#hitListPanel.addEventListener("click", this.#onHitListClick);
    const dbg = window.__pixiDebug = {
      active: this.#active,
      hovered: null,
      hits: [],
      pinned: null,
      tree: () => this.#printTree(),
      find: (pred) => this.#findInTree(pred),
      app: this.#app,
      container: this.#renderContainer,
      toggle: () => {
        this.#active = !this.#active;
        dbg.active = this.#active;
        this.#updatePanelVisibility();
      }
    };
    console.log(
      "%c[PixiDebug] %cAttached \u2014 hover to inspect, press D to toggle, click hit-list to pin\n  window.__pixiDebug.hovered  \u2192 current hover target\n  window.__pixiDebug.hits     \u2192 all objects under cursor\n  window.__pixiDebug.pinned   \u2192 click-pinned object\n  window.__pixiDebug.tree()   \u2192 print display tree\n  window.__pixiDebug.find(fn) \u2192 search display tree",
      "color: #0f0; font-weight: bold",
      "color: #0f0"
    );
  }
  #detach() {
    if (!this.#listening) return;
    document.removeEventListener("pointermove", this.#onMove);
    document.removeEventListener("keydown", this.#onKey);
    this.#panel?.remove();
    this.#hitListPanel?.remove();
    this.#panel = null;
    this.#hitListPanel = null;
    this.#listening = false;
    delete window.__pixiDebug;
  }
  #updatePanelVisibility() {
    if (this.#panel) this.#panel.style.display = this.#active ? "" : "none";
    if (this.#hitListPanel) this.#hitListPanel.style.display = this.#active ? "" : "none";
  }
  // ── Input ─────────────────────────────────────────────────────────────
  #onKey = (e) => {
    if (e.key === "d" || e.key === "D") {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      this.#active = !this.#active;
      window.__pixiDebug.active = this.#active;
      this.#updatePanelVisibility();
    }
  };
  #onMove = (e) => {
    if (!this.#active || !this.#app || !this.#renderer || !this.#canvas || !this.#renderContainer) return;
    const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY);
    const pt = new Point(pixiGlobal.x, pixiGlobal.y);
    const hits = [];
    hitCollect(this.#app.stage, pt, hits);
    hits.sort((a, b) => treeDepth(b) - treeDepth(a));
    const top = hits[0] ?? null;
    const dbg = window.__pixiDebug;
    if (dbg) {
      dbg.hovered = top;
      dbg.hits = hits;
    }
    if (this.#panel) {
      if (top) {
        this.#panel.textContent = formatObjectInfo(top);
        this.#panel.style.opacity = "1";
      } else {
        this.#panel.style.opacity = "0.4";
        this.#panel.textContent = "(no hit)";
      }
    }
    if (this.#hitListPanel && !this.#pinnedObj) {
      this.#renderHitList(hits);
    }
  };
  #onHitListClick = (e) => {
    const target = e.target;
    const idx = target.dataset["hitIdx"];
    if (idx === void 0) return;
    const dbg = window.__pixiDebug;
    const hits = dbg?.hits;
    if (!hits) return;
    const obj = hits[parseInt(idx, 10)];
    if (!obj) return;
    if (this.#pinnedObj === obj) {
      this.#pinnedObj = null;
      if (dbg) dbg.pinned = null;
      return;
    }
    this.#pinnedObj = obj;
    if (dbg) dbg.pinned = obj;
    if (this.#panel) {
      this.#panel.textContent = "\u{1F4CC} PINNED\n" + formatObjectInfo(obj);
      this.#panel.style.opacity = "1";
    }
    console.log("%c[PixiDebug] Pinned:", "color:#0f0;font-weight:bold", obj);
  };
  // ── Rendering ─────────────────────────────────────────────────────────
  #renderHitList(hits) {
    if (!this.#hitListPanel) return;
    if (hits.length === 0) {
      this.#hitListPanel.textContent = "Hit list: (empty)";
      return;
    }
    this.#hitListPanel.innerHTML = "";
    const title = document.createElement("div");
    title.textContent = `Hit list (${hits.length}):`;
    title.style.cssText = "color: #0f0; margin-bottom: 4px; font-weight: bold;";
    this.#hitListPanel.appendChild(title);
    for (let i = 0; i < Math.min(hits.length, 30); i++) {
      const obj = hits[i];
      const row = document.createElement("div");
      row.dataset["hitIdx"] = String(i);
      row.style.cssText = `
        cursor: pointer; padding: 2px 4px; border-radius: 1px;
        color: ${this.#pinnedObj === obj ? "#ff0" : "#0f0"};
      `;
      row.textContent = `${i}: ${describeObject(obj)}  z:${obj.zIndex ?? "-"}  d:${treeDepth(obj)}`;
      row.addEventListener("mouseenter", () => {
        row.style.background = "rgba(0,255,0,0.15)";
      });
      row.addEventListener("mouseleave", () => {
        row.style.background = "";
      });
      this.#hitListPanel.appendChild(row);
    }
  }
  // ── Coordinate mapping ────────────────────────────────────────────────
  #clientToPixiGlobal(cx, cy) {
    const events = this.#renderer?.events;
    if (events?.mapPositionToPoint) {
      const out = new Point();
      events.mapPositionToPoint(out, cx, cy);
      return { x: out.x, y: out.y };
    }
    const rect = this.#canvas.getBoundingClientRect();
    const screen = this.#renderer.screen;
    return {
      x: (cx - rect.left) * (screen.width / rect.width),
      y: (cy - rect.top) * (screen.height / rect.height)
    };
  }
  // ── Console helpers ───────────────────────────────────────────────────
  #printTree() {
    if (!this.#app) {
      console.log("[PixiDebug] No app");
      return;
    }
    const lines = [];
    walkTree(this.#app.stage, 0, lines);
    console.log("%c[PixiDebug] Display tree:\n" + lines.join("\n"), "color: #0f0");
  }
  #findInTree(pred) {
    if (!this.#app) return [];
    const results = [];
    const recurse = (node) => {
      if (pred(node)) results.push(node);
      for (const child of node.children) recurse(child);
    };
    recurse(this.#app.stage);
    console.log(`%c[PixiDebug] Found ${results.length} match(es)`, "color: #0f0", results);
    return results;
  }
};
function treeDepth(obj) {
  let d = 0;
  let current = obj;
  while (current?.parent) {
    d++;
    current = current.parent;
  }
  return d;
}
var _pixiDebug = new PixiDebugDrone();
window.ioc.register("@diamondcoreprocessor.com/PixiDebugDrone", _pixiDebug);
export {
  PixiDebugDrone
};
