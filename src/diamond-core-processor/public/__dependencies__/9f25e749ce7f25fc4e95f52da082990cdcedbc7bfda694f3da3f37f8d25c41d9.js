// @diamondcoreprocessor.com/move
// src/diamondcoreprocessor.com/move/desktop-move.input.ts
import { Point } from "pixi.js";
var DesktopMoveInput = class {
  #enabled = false;
  #canvas = null;
  #container = null;
  #renderer = null;
  #getMeshOffset = null;
  #drone = null;
  #source = "desktop-move";
  #threshold = 6;
  #downPos = null;
  #downAxial = null;
  #dragging = false;
  #spaceHeld = false;
  #ctrlHeld = false;
  #lastDwellLabel = null;
  attach = (drone, refs) => {
    if (this.#enabled) return;
    this.#drone = drone;
    this.#canvas = refs.canvas;
    this.#container = refs.container;
    this.#renderer = refs.renderer;
    this.#getMeshOffset = refs.getMeshOffset;
    document.addEventListener("pointerdown", this.#onPointerDown);
    document.addEventListener("pointermove", this.#onPointerMove);
    document.addEventListener("pointerup", this.#onPointerUp);
    document.addEventListener("pointercancel", this.#onPointerUp);
    document.addEventListener("keydown", this.#onKeyDown);
    document.addEventListener("keyup", this.#onKeyUp);
    window.addEventListener("blur", this.#onBlur);
    this.#enabled = true;
  };
  detach = () => {
    if (!this.#enabled) return;
    document.removeEventListener("pointerdown", this.#onPointerDown);
    document.removeEventListener("pointermove", this.#onPointerMove);
    document.removeEventListener("pointerup", this.#onPointerUp);
    document.removeEventListener("pointercancel", this.#onPointerUp);
    document.removeEventListener("keydown", this.#onKeyDown);
    document.removeEventListener("keyup", this.#onKeyUp);
    window.removeEventListener("blur", this.#onBlur);
    this.#cancel();
    this.#drone = null;
    this.#canvas = null;
    this.#container = null;
    this.#renderer = null;
    this.#getMeshOffset = null;
    this.#enabled = false;
  };
  // ── pointer events ────────────────────────────────────────
  #onPointerDown = (e) => {
    if (e.pointerType === "touch") return;
    if (e.button !== 0) return;
    if (e.shiftKey || e.altKey) return;
    if (this.#spaceHeld) return;
    if (!this.#canvas) return;
    if (this.#isInteractiveTarget(e.target)) return;
    const rect = this.#canvas.getBoundingClientRect();
    if (!this.#isInsideRect(e.clientX, e.clientY, rect)) return;
    const axial = this.#clientToAxial(e.clientX, e.clientY);
    if (!axial) return;
    if (e.ctrlKey || e.metaKey) return;
    const label = this.#drone?.labelAtAxial(axial) ?? null;
    if (!label) return;
    const selection = window.ioc.get("@diamondcoreprocessor.com/SelectionService");
    if (!selection?.selected.has(label)) return;
    this.#downPos = { x: e.clientX, y: e.clientY };
    this.#downAxial = axial;
    this.#dragging = false;
  };
  #onPointerMove = (e) => {
    if (!this.#downPos || !this.#downAxial || !this.#drone) return;
    if (e.pointerType === "touch") return;
    const dx = e.clientX - this.#downPos.x;
    const dy = e.clientY - this.#downPos.y;
    if (!this.#dragging) {
      if (Math.abs(dx) < this.#threshold && Math.abs(dy) < this.#threshold) return;
      const ok = this.#drone.beginMove(this.#downAxial, this.#source);
      if (!ok) {
        this.#downPos = null;
        this.#downAxial = null;
        return;
      }
      this.#dragging = true;
      this.#setCursor("grabbing");
    }
    const axial = this.#clientToAxial(e.clientX, e.clientY);
    if (axial) {
      this.#drone.updateMove(axial, this.#source);
      this.#updateDwell(axial);
    }
  };
  #onPointerUp = (e) => {
    if (!this.#downPos) return;
    if (e.pointerType === "touch") return;
    if (this.#dragging && this.#drone) {
      const axial = this.#clientToAxial(e.clientX, e.clientY);
      if (axial) {
        void this.#drone.commitMoveAt(axial, this.#source);
      } else {
        this.#drone.cancelMove(this.#source);
      }
    }
    this.#resetDrag();
  };
  #onKeyDown = (e) => {
    if (e.key === " ") this.#spaceHeld = true;
    if (e.key === "Control") {
      this.#ctrlHeld = true;
    }
    if (e.key === "Escape" && this.#dragging) {
      this.#drone?.cancelMove(this.#source);
      this.#resetDrag();
    }
  };
  #onKeyUp = (e) => {
    if (e.key === " ") this.#spaceHeld = false;
    if (e.key === "Control") {
      this.#ctrlHeld = false;
      if (this.#drone?.isDwelling) {
        this.#drone.cancelDwell();
        this.#lastDwellLabel = null;
      }
    }
  };
  #onBlur = () => {
    if (this.#dragging) {
      this.#drone?.cancelMove(this.#source);
    }
    this.#resetDrag();
    this.#spaceHeld = false;
    this.#ctrlHeld = false;
    this.#lastDwellLabel = null;
  };
  // ── helpers ───────────────────────────────────────────────
  #cancel() {
    if (this.#dragging) this.#drone?.cancelMove(this.#source);
    this.#resetDrag();
  }
  #resetDrag() {
    this.#downPos = null;
    this.#downAxial = null;
    this.#dragging = false;
    this.#lastDwellLabel = null;
    this.#setCursor("");
  }
  #updateDwell(axial) {
    if (!this.#drone || !this.#dragging) return;
    if (!this.#ctrlHeld) {
      if (this.#lastDwellLabel) {
        this.#drone.cancelDwell();
        this.#lastDwellLabel = null;
      }
      return;
    }
    const hoverLabel = this.#drone.labelAtAxial(axial);
    if (!hoverLabel || !this.#drone.branchLabels.has(hoverLabel)) {
      if (this.#lastDwellLabel) {
        this.#drone.cancelDwell();
        this.#lastDwellLabel = null;
      }
      return;
    }
    if (this.#lastDwellLabel !== hoverLabel) {
      this.#lastDwellLabel = hoverLabel;
      this.#drone.startDwell(hoverLabel);
    }
  }
  #clientToAxial(cx, cy) {
    if (!this.#container || !this.#renderer || !this.#getMeshOffset) return null;
    const detector = window.ioc.get(
      "@diamondcoreprocessor.com/HexDetector"
    );
    if (!detector) return null;
    const pixiGlobal = this.#clientToPixiGlobal(cx, cy);
    const local = this.#container.toLocal(pixiGlobal);
    const offset = this.#getMeshOffset();
    return detector.pixelToAxial(local.x - offset.x, local.y - offset.y);
  }
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
  #setCursor(cursor) {
    if (this.#canvas) this.#canvas.style.cursor = cursor;
  }
  #isInsideRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }
  #isInteractiveTarget(target) {
    if (!target || !(target instanceof HTMLElement)) return false;
    return !!target.closest('input, textarea, button, select, option, a, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
  }
};
window.ioc.register("@diamondcoreprocessor.com/DesktopMoveInput", new DesktopMoveInput());

// src/diamondcoreprocessor.com/move/layer-transfer.service.ts
var LayerTransferService = class {
  /**
   * Transfer a cell directory from sourceDir into targetLayerDir.
   * Creates `targetLayerDir/{cellLabel}/` as a deep copy of `sourceDir/{cellLabel}/`,
   * then removes the original.
   */
  transfer = async (sourceDir, targetLayerDir, cellLabel) => {
    const srcCell = await sourceDir.getDirectoryHandle(cellLabel, { create: false });
    const destCell = await targetLayerDir.getDirectoryHandle(cellLabel, { create: true });
    await this.#copyRecursive(srcCell, destCell);
    await sourceDir.removeEntry(cellLabel, { recursive: true });
  };
  async #copyRecursive(src, dest) {
    for await (const [name, handle] of src.entries()) {
      if (handle.kind === "file") {
        const srcFile = handle;
        const file = await srcFile.getFile();
        const destFile = await dest.getFileHandle(name, { create: true });
        const writable = await destFile.createWritable();
        await writable.write(await file.arrayBuffer());
        await writable.close();
      } else {
        const srcSub = handle;
        const destSub = await dest.getDirectoryHandle(name, { create: true });
        await this.#copyRecursive(srcSub, destSub);
      }
    }
  }
};
window.ioc.register(
  "@diamondcoreprocessor.com/LayerTransferService",
  new LayerTransferService()
);

// src/diamondcoreprocessor.com/move/layout.queen.ts
import { QueenBee, EffectBus, hypercomb } from "@hypercomb/core";
var LAYOUTS_DIR = "__layouts__";
var LayoutQueenBee = class extends QueenBee {
  namespace = "diamondcoreprocessor.com";
  genotype = "movement";
  command = "layout";
  aliases = [];
  description = "Save, apply, list, or remove layout templates";
  async execute(args) {
    const parsed = parseLayoutArgs(args);
    switch (parsed.action) {
      case "save":
        return this.#save(parsed.name);
      case "apply":
        return this.#apply(parsed.name);
      case "list":
        return this.#list();
      case "remove":
        return this.#remove(parsed.name);
    }
  }
  // ── save ────────────────────────────────────────────────
  async #save(name) {
    if (!name) return;
    const dir = await this.#explorerDir();
    if (!dir) return;
    const layout = get("@diamondcoreprocessor.com/LayoutService");
    if (!layout) return;
    const order = await layout.read(dir);
    if (!order || order.length === 0) return;
    const commands = order.map((label, i) => `/select[${label}]/move(${i})`);
    const template = { name, order, commands };
    const layoutsDir = await dir.getDirectoryHandle(LAYOUTS_DIR, { create: true });
    const handle = await layoutsDir.getFileHandle(`${name}.json`, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(template));
    await writable.close();
    EffectBus.emit("layout:saved", { name, count: order.length });
  }
  // ── apply ───────────────────────────────────────────────
  async #apply(name) {
    if (!name) return;
    const dir = await this.#explorerDir();
    if (!dir) return;
    const layout = get("@diamondcoreprocessor.com/LayoutService");
    if (!layout) return;
    let template;
    try {
      const layoutsDir = await dir.getDirectoryHandle(LAYOUTS_DIR, { create: false });
      const handle = await layoutsDir.getFileHandle(`${name}.json`, { create: false });
      const file = await handle.getFile();
      template = JSON.parse(await file.text());
      if (!Array.isArray(template.order)) return;
    } catch {
      return;
    }
    const currentCells = await this.#currentCells(dir);
    const merged = layout.merge(template.order, currentCells);
    await layout.write(dir, merged);
    EffectBus.emit("cell:reorder", { labels: merged });
    EffectBus.emit("layout:applied", { name, count: merged.length });
    void new hypercomb().act();
  }
  // ── list ────────────────────────────────────────────────
  async #list() {
    const dir = await this.#explorerDir();
    if (!dir) return;
    const names = [];
    try {
      const layoutsDir = await dir.getDirectoryHandle(LAYOUTS_DIR, { create: false });
      for await (const [key, handle] of layoutsDir.entries()) {
        if (handle.kind === "file" && key.endsWith(".json")) {
          names.push(key.replace(/\.json$/, ""));
        }
      }
    } catch {
    }
    EffectBus.emit("layout:list", { layouts: names });
  }
  // ── remove ──────────────────────────────────────────────
  async #remove(name) {
    if (!name) return;
    const dir = await this.#explorerDir();
    if (!dir) return;
    try {
      const layoutsDir = await dir.getDirectoryHandle(LAYOUTS_DIR, { create: false });
      await layoutsDir.removeEntry(`${name}.json`);
      EffectBus.emit("layout:removed", { name });
    } catch {
    }
  }
  // ── helpers ─────────────────────────────────────────────
  async #explorerDir() {
    const lineage = get("@hypercomb.social/Lineage");
    return lineage ? await lineage.explorerDir() : null;
  }
  async #currentCells(dir) {
    const cells = [];
    for await (const [key, handle] of dir.entries()) {
      if (handle.kind === "directory" && !key.startsWith("__")) {
        cells.push(key);
      }
    }
    return cells;
  }
};
function parseLayoutArgs(args) {
  const trimmed = args.trim();
  if (!trimmed || trimmed === "list") return { action: "list", name: "" };
  const parts = trimmed.split(/\s+/);
  const verb = parts[0].toLowerCase();
  const name = normalizeName(parts.slice(1).join(" "));
  if (verb === "save" && name) return { action: "save", name };
  if (verb === "remove" || verb === "rm") return { action: "remove", name };
  if (verb === "apply" && name) return { action: "apply", name };
  if (verb === "list") return { action: "list", name: "" };
  return { action: "apply", name: normalizeName(trimmed) };
}
function normalizeName(s) {
  return s.trim().toLocaleLowerCase().replace(/[._\s]+/g, "-").replace(/[^\p{L}\p{N}\-]/gu, "").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-$/, "");
}
var _layout = new LayoutQueenBee();
window.ioc.register("@diamondcoreprocessor.com/LayoutQueenBee", _layout);

// src/diamondcoreprocessor.com/move/layout.service.ts
var LAYOUT_FILE = "__layout__";
var LayoutService = class {
  /**
   * Read the ordered cell list from __layout__ in the given directory.
   * Returns null if no layout file exists (fall back to alphabetical).
   */
  async read(dir) {
    try {
      const handle = await dir.getFileHandle(LAYOUT_FILE, { create: false });
      const file = await handle.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return null;
      return parsed.filter((x) => typeof x === "string" && x.length > 0);
    } catch {
      return null;
    }
  }
  /**
   * Write the ordered cell list to __layout__.
   */
  async write(dir, order) {
    const handle = await dir.getFileHandle(LAYOUT_FILE, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(order));
    await writable.close();
  }
  /**
   * Merge a saved layout order with current filesystem cells.
   * Keeps layout order, removes deleted cells, appends new cells alphabetically.
   */
  merge(layoutOrder, fsCells) {
    const fsSet = new Set(fsCells);
    const result = [];
    const seen = /* @__PURE__ */ new Set();
    for (const label of layoutOrder) {
      if (fsSet.has(label) && !seen.has(label)) {
        result.push(label);
        seen.add(label);
      }
    }
    const newCells = fsCells.filter((s) => !seen.has(s));
    newCells.sort((a, b) => a.localeCompare(b));
    for (const s of newCells) result.push(s);
    return result;
  }
};
window.ioc.register("@diamondcoreprocessor.com/LayoutService", new LayoutService());

// src/diamondcoreprocessor.com/move/touch-move.input.ts
import { Point as Point2 } from "pixi.js";
var TouchMoveInput = class {
  #enabled = false;
  #canvas = null;
  #container = null;
  #renderer = null;
  #getMeshOffset = null;
  #drone = null;
  #gate = null;
  #source = "touch-move";
  #holdMs = 300;
  #jitterPx = 10;
  #holdTimer = null;
  #downPos = null;
  #downAxial = null;
  #activePointerId = null;
  #pointerCount = 0;
  #dragging = false;
  attach = (drone, refs) => {
    if (this.#enabled) return;
    this.#drone = drone;
    this.#gate = window.ioc.get("@diamondcoreprocessor.com/InputGate") ?? null;
    this.#canvas = refs.canvas;
    this.#container = refs.container;
    this.#renderer = refs.renderer;
    this.#getMeshOffset = refs.getMeshOffset;
    window.addEventListener("pointerdown", this.#onPointerDown, { passive: false });
    window.addEventListener("pointermove", this.#onPointerMove, { passive: false });
    window.addEventListener("pointerup", this.#onPointerUp, { passive: false });
    window.addEventListener("pointercancel", this.#onPointerUp, { passive: false });
    this.#enabled = true;
  };
  detach = () => {
    if (!this.#enabled) return;
    window.removeEventListener("pointerdown", this.#onPointerDown);
    window.removeEventListener("pointermove", this.#onPointerMove);
    window.removeEventListener("pointerup", this.#onPointerUp);
    window.removeEventListener("pointercancel", this.#onPointerUp);
    this.#cancel();
    this.#drone = null;
    this.#gate = null;
    this.#canvas = null;
    this.#container = null;
    this.#renderer = null;
    this.#getMeshOffset = null;
    this.#enabled = false;
  };
  // ── pointer events ────────────────────────────────────────
  #onPointerDown = (e) => {
    if (e.pointerType !== "touch") return;
    if (!this.#canvas) return;
    this.#pointerCount++;
    if (this.#pointerCount > 1) {
      this.#cancel();
      return;
    }
    const rect = this.#canvas.getBoundingClientRect();
    if (!this.#isInsideRect(e.clientX, e.clientY, rect)) return;
    const axial = this.#clientToAxial(e.clientX, e.clientY);
    if (!axial) return;
    this.#activePointerId = e.pointerId;
    this.#downPos = { x: e.clientX, y: e.clientY };
    this.#downAxial = axial;
    this.#holdTimer = setTimeout(() => {
      this.#holdTimer = null;
      if (!this.#downAxial || !this.#drone) return;
      if (this.#gate?.active) {
        this.#resetDrag();
        return;
      }
      const ok = this.#drone.beginMove(this.#downAxial, this.#source);
      if (!ok) {
        this.#resetDrag();
        return;
      }
      this.#dragging = true;
      try {
        navigator.vibrate?.(50);
      } catch {
      }
      e.preventDefault();
      e.stopPropagation();
    }, this.#holdMs);
  };
  #onPointerMove = (e) => {
    if (e.pointerType !== "touch") return;
    if (e.pointerId !== this.#activePointerId) return;
    if (this.#holdTimer && this.#downPos) {
      const dx = e.clientX - this.#downPos.x;
      const dy = e.clientY - this.#downPos.y;
      if (Math.abs(dx) > this.#jitterPx || Math.abs(dy) > this.#jitterPx) {
        this.#clearTimer();
        this.#resetDrag();
        return;
      }
    }
    if (!this.#dragging || !this.#drone) return;
    const axial = this.#clientToAxial(e.clientX, e.clientY);
    if (axial) this.#drone.updateMove(axial, this.#source);
    e.preventDefault();
    e.stopPropagation();
  };
  #onPointerUp = (e) => {
    if (e.pointerType !== "touch") return;
    this.#pointerCount = Math.max(0, this.#pointerCount - 1);
    if (e.pointerId !== this.#activePointerId) return;
    this.#clearTimer();
    if (this.#dragging && this.#drone) {
      const axial = this.#clientToAxial(e.clientX, e.clientY);
      if (axial) {
        void this.#drone.commitMoveAt(axial, this.#source);
      } else {
        this.#drone.cancelMove(this.#source);
      }
    }
    this.#resetDrag();
  };
  // ── helpers ───────────────────────────────────────────────
  #cancel() {
    this.#clearTimer();
    if (this.#dragging) this.#drone?.cancelMove(this.#source);
    this.#resetDrag();
  }
  #clearTimer() {
    if (this.#holdTimer) {
      clearTimeout(this.#holdTimer);
      this.#holdTimer = null;
    }
  }
  #resetDrag() {
    this.#downPos = null;
    this.#downAxial = null;
    this.#activePointerId = null;
    this.#dragging = false;
  }
  #clientToAxial(cx, cy) {
    if (!this.#container || !this.#renderer || !this.#getMeshOffset) return null;
    const detector = window.ioc.get(
      "@diamondcoreprocessor.com/HexDetector"
    );
    if (!detector) return null;
    const pixiGlobal = this.#clientToPixiGlobal(cx, cy);
    const local = this.#container.toLocal(new Point2(pixiGlobal.x, pixiGlobal.y));
    const offset = this.#getMeshOffset();
    return detector.pixelToAxial(local.x - offset.x, local.y - offset.y);
  }
  #clientToPixiGlobal(cx, cy) {
    const events = this.#renderer?.events;
    if (events?.mapPositionToPoint) {
      const out = new Point2();
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
  #isInsideRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }
};
window.ioc.register("@diamondcoreprocessor.com/TouchMoveInput", new TouchMoveInput());
export {
  DesktopMoveInput,
  LayerTransferService,
  LayoutQueenBee,
  LayoutService,
  TouchMoveInput
};
