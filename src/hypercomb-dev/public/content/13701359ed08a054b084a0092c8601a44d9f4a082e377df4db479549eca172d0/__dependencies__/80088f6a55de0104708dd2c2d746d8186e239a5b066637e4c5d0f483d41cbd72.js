// @diamondcoreprocessor.com/editor
// src/diamondcoreprocessor.com/editor/image-editor.service.ts
import { Application, Container, Graphics, Sprite, Texture, RenderTexture, Rectangle } from "pixi.js";
var ImageEditorService = class extends EventTarget {
  #app = null;
  #container = null;
  #sprite = null;
  #hexFrame = null;
  #hostElement = null;
  #initialized = false;
  #isDragging = false;
  #dragStart = { x: 0, y: 0 };
  #size = 0;
  // always square: editorSize × editorSize
  #borderColor = "#c8975a";
  #backgroundColor = 1973790;
  #orientation = "point-top";
  #linked = true;
  // ── public state ───────────────────────────────────────────────
  get hasImage() {
    return this.#sprite !== null;
  }
  get orientation() {
    return this.#orientation;
  }
  get linked() {
    return this.#linked;
  }
  set linked(value) {
    this.#linked = value;
  }
  // ── lifecycle ──────────────────────────────────────────────────
  initialize = async (hostElement, size, orientation = "point-top") => {
    if (this.#initialized) return;
    this.#hostElement = hostElement;
    this.#orientation = orientation;
    this.#size = size;
    this.#app = new Application();
    await this.#app.init({
      width: size,
      height: size,
      backgroundColor: 1973790,
      antialias: true,
      autoDensity: true
    });
    this.#app.stage.eventMode = "static";
    this.#app.canvas.style.display = "block";
    this.#app.canvas.style.width = "100%";
    this.#app.canvas.style.height = "100%";
    this.#app.canvas.style.cursor = "auto";
    hostElement.appendChild(this.#app.canvas);
    this.#container = new Container();
    this.#container.eventMode = "dynamic";
    this.#container.cursor = "move";
    this.#container.hitArea = new Rectangle(0, 0, size, size);
    this.#container.on("pointerdown", this.#onPointerDown);
    this.#app.stage.addChild(this.#container);
    this.#app.canvas.addEventListener("wheel", this.#onWheel, { passive: false });
    this.#drawHexFrame();
    this.#initialized = true;
    this.#emit();
  };
  destroy = () => {
    if (!this.#initialized) return;
    const canvas = this.#app?.canvas ?? null;
    canvas?.removeEventListener("wheel", this.#onWheel);
    this.#container?.removeAllListeners();
    this.#app?.stage.removeChildren();
    this.#app?.stop();
    this.#app?.destroy();
    if (this.#hostElement && canvas) {
      try {
        this.#hostElement.removeChild(canvas);
      } catch {
      }
    }
    this.#app = null;
    this.#container = null;
    this.#sprite = null;
    this.#hexFrame = null;
    this.#hostElement = null;
    this.#initialized = false;
    this.#isDragging = false;
    this.#orientation = "point-top";
    this.#linked = true;
    this.#emit();
  };
  // ── orientation switching ────────────────────────────────────────
  // Canvas stays the same size. Only the hex frame changes.
  setOrientation = async (orientation, transform) => {
    if (!this.#app || !this.#container || !this.#initialized) return;
    if (orientation === this.#orientation) return;
    this.#orientation = orientation;
    if (this.#sprite && transform) {
      const half = this.#size / 2;
      this.#sprite.x = transform.x + half;
      this.#sprite.y = transform.y + half;
      this.#sprite.scale.set(transform.scale);
    }
    this.#drawHexFrame();
    this.#emit();
  };
  // ── image loading ──────────────────────────────────────────────
  loadImage = async (blob, transform) => {
    if (!this.#container || !this.#app) return;
    if (this.#sprite) {
      this.#container.removeChild(this.#sprite);
      this.#sprite.destroy();
      this.#sprite = null;
    }
    const bitmap = await createImageBitmap(blob);
    const texture = Texture.from(bitmap);
    const half = this.#size / 2;
    this.#sprite = new Sprite(texture);
    this.#sprite.anchor.set(0.5);
    if (transform) {
      this.#sprite.x = transform.x + half;
      this.#sprite.y = transform.y + half;
      this.#sprite.scale.set(transform.scale);
    } else {
      this.#sprite.x = half;
      this.#sprite.y = half;
      const scaleX = this.#size / bitmap.width;
      const scaleY = this.#size / bitmap.height;
      this.#sprite.scale.set(Math.max(scaleX, scaleY));
    }
    this.#container.addChildAt(this.#sprite, 0);
    this.#emit();
  };
  // ── capture ────────────────────────────────────────────────────
  // Renders the hex region (not the full square) to a WebP blob.
  // The hex is centered in the square canvas, so we offset the
  // container to crop to the hex bounding box.
  captureSmall = async (hexWidth, hexHeight) => {
    if (!this.#app || !this.#container) {
      throw new Error("ImageEditorService not initialized");
    }
    const renderer = this.#app.renderer;
    const renderTexture = RenderTexture.create({
      width: hexWidth,
      height: hexHeight,
      resolution: 1,
      scaleMode: "nearest",
      antialias: false
    });
    const offsetX = hexWidth / 2 - this.#size / 2;
    const offsetY = hexHeight / 2 - this.#size / 2;
    this.#container.x = offsetX;
    this.#container.y = offsetY;
    renderer.render({
      container: this.#container,
      target: renderTexture,
      clear: true,
      clearColor: this.#backgroundColor
    });
    this.#container.x = 0;
    this.#container.y = 0;
    const canvas = renderer.extract.canvas(renderTexture);
    renderTexture.destroy(true);
    return await this.#canvasToBlob(canvas);
  };
  // ── transform state ────────────────────────────────────────────
  getTransform = () => {
    if (!this.#sprite) return { x: 0, y: 0, scale: 1 };
    const half = this.#size / 2;
    return {
      x: this.#sprite.x - half,
      y: this.#sprite.y - half,
      scale: this.#sprite.scale.x
    };
  };
  // ── hex frame border ───────────────────────────────────────────
  // Programmatic hex polygon outline centered within the square canvas.
  // Matches the branch indicator / border ring style (full hexagon stroke).
  setBackgroundColor = (color) => {
    if (!this.#app) return;
    const parsed = color ? parseInt(color.replace("#", ""), 16) || 1973790 : 1973790;
    this.#backgroundColor = parsed;
    this.#app.renderer.background.color = parsed;
  };
  setBorderColor = (color) => {
    this.#borderColor = color && /^#?[0-9a-fA-F]{6}$/.test(color.replace("#", "")) ? color.startsWith("#") ? color : `#${color}` : "#c8975a";
    this.#drawHexFrame();
  };
  #drawHexFrame() {
    if (!this.#container) return;
    if (this.#hexFrame) {
      this.#container.removeChild(this.#hexFrame);
      this.#hexFrame.destroy();
      this.#hexFrame = null;
    }
    const isFlat = this.#orientation === "flat-top";
    const hexW = isFlat ? 400 : 346;
    const hexH = isFlat ? 346 : 400;
    const cx = this.#size / 2;
    const cy = this.#size / 2;
    const strokeWidth = 14.44;
    const inset = strokeWidth / 2;
    const hw = hexW / 2 - inset;
    const hh = hexH / 2 - inset;
    const verts = [];
    if (isFlat) {
      verts.push(cx + hw, cy);
      verts.push(cx + hw / 2, cy + hh);
      verts.push(cx - hw / 2, cy + hh);
      verts.push(cx - hw, cy);
      verts.push(cx - hw / 2, cy - hh);
      verts.push(cx + hw / 2, cy - hh);
    } else {
      verts.push(cx, cy - hh);
      verts.push(cx + hw, cy - hh / 2);
      verts.push(cx + hw, cy + hh / 2);
      verts.push(cx, cy + hh);
      verts.push(cx - hw, cy + hh / 2);
      verts.push(cx - hw, cy - hh / 2);
    }
    const color = parseInt(this.#borderColor.replace("#", ""), 16) || 13145946;
    this.#hexFrame = new Graphics();
    this.#hexFrame.eventMode = "none";
    this.#hexFrame.poly(verts, true);
    this.#hexFrame.stroke({ color, alpha: 0.7, width: strokeWidth });
    this.#container.addChild(this.#hexFrame);
  }
  // ── drag handling ──────────────────────────────────────────────
  #onPointerDown = (e) => {
    if (!this.#sprite || !this.#container) return;
    const start = this.#container.toLocal(e.global);
    this.#dragStart.x = start.x - this.#sprite.x;
    this.#dragStart.y = start.y - this.#sprite.y;
    this.#app.stage.on("pointermove", this.#onPointerMove);
    this.#app.stage.on("pointerup", this.#onPointerUp);
    this.#app.stage.on("pointerupoutside", this.#onPointerUp);
    this.#isDragging = true;
    this.#app.canvas.style.cursor = "grabbing";
  };
  #onPointerMove = (e) => {
    if (!this.#isDragging || !this.#sprite || !this.#container) return;
    const pos = this.#container.toLocal(e.global);
    this.#sprite.position.set(
      pos.x - this.#dragStart.x,
      pos.y - this.#dragStart.y
    );
  };
  #onPointerUp = () => {
    this.#isDragging = false;
    this.#app?.stage.off("pointermove", this.#onPointerMove);
    this.#app?.stage.off("pointerup", this.#onPointerUp);
    this.#app?.stage.off("pointerupoutside", this.#onPointerUp);
    if (this.#app) this.#app.canvas.style.cursor = "auto";
    this.#syncTransform();
  };
  // ── zoom handling ──────────────────────────────────────────────
  #onWheel = (event) => {
    if (!this.#sprite || !this.#app) return;
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.95 : 1.05;
    let newScale = this.#sprite.scale.x * factor;
    newScale = Math.max(0.05, Math.min(10, newScale));
    this.#sprite.scale.set(newScale);
    this.#syncTransform();
  };
  // ── internal helpers ───────────────────────────────────────────
  #syncTransform() {
    const service = window.ioc?.get?.("@diamondcoreprocessor.com/TileEditorService");
    if (service?.updateTransform) {
      const t = this.getTransform();
      service.updateTransform(t.x, t.y, t.scale, this.#orientation);
      if (this.#linked) {
        const other = this.#orientation === "point-top" ? "flat-top" : "point-top";
        service.updateTransform(t.x, t.y, t.scale, other);
      }
    }
  }
  #canvasToBlob = async (canvas) => new Promise(
    (resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("toBlob failed")),
      "image/webp"
    )
  );
  #emit() {
    this.dispatchEvent(new CustomEvent("change"));
  }
};
window.ioc.register(
  "@diamondcoreprocessor.com/ImageEditorService",
  new ImageEditorService()
);

// src/diamondcoreprocessor.com/editor/tile-editor.service.ts
import { EffectBus } from "@hypercomb/core";
var TileEditorService = class extends EventTarget {
  #mode = "idle";
  #seed = "";
  #properties = {};
  #largeBlob = null;
  // ── getters ────────────────────────────────────────────────────
  get mode() {
    return this.#mode;
  }
  get seed() {
    return this.#seed;
  }
  get properties() {
    return this.#properties;
  }
  get largeBlob() {
    return this.#largeBlob;
  }
  // ── specific property accessors (object notation) ──────────────
  get link() {
    return String(this.#properties.link ?? "");
  }
  get borderColor() {
    return String(this.#properties.border?.color ?? "");
  }
  get backgroundColor() {
    return String(this.#properties.background?.color ?? "");
  }
  // ── state mutations ────────────────────────────────────────────
  open = (seed, properties, largeBlob) => {
    this.#seed = seed;
    this.#properties = { ...properties };
    this.#largeBlob = largeBlob;
    this.#mode = "editing";
    this.#emit();
    EffectBus.emit("editor:mode", { active: true });
  };
  close = () => {
    this.#mode = "idle";
    this.#seed = "";
    this.#properties = {};
    this.#largeBlob = null;
    this.#emit();
    EffectBus.emit("editor:mode", { active: false });
  };
  setLink = (value) => {
    if (value) {
      this.#properties.link = value;
    } else {
      delete this.#properties.link;
    }
    this.#emit();
  };
  setBorderColor = (value) => {
    if (value) {
      if (!this.#properties.border) {
        this.#properties.border = {};
      }
      this.#properties.border.color = value;
    } else {
      if (this.#properties.border) {
        delete this.#properties.border.color;
        if (Object.keys(this.#properties.border).length === 0) {
          delete this.#properties.border;
        }
      }
    }
    this.#emit();
  };
  setBackgroundColor = (value) => {
    if (value) {
      if (!this.#properties.background) {
        this.#properties.background = {};
      }
      this.#properties.background.color = value;
    } else {
      if (this.#properties.background) {
        delete this.#properties.background.color;
        if (Object.keys(this.#properties.background).length === 0) {
          delete this.#properties.background;
        }
      }
    }
    this.#emit();
  };
  setLargeBlob = (blob) => {
    this.#largeBlob = blob;
    this.#emit();
  };
  updateTransform = (x, y, scale, orientation = "point-top") => {
    if (orientation === "flat-top") {
      if (!this.#properties.flat) {
        this.#properties.flat = {};
      }
      if (!this.#properties.flat.large) {
        this.#properties.flat.large = {};
      }
      const flatLarge = this.#properties.flat.large;
      flatLarge.x = x;
      flatLarge.y = y;
      flatLarge.scale = scale;
    } else {
      if (!this.#properties.large) {
        this.#properties.large = {};
      }
      const large = this.#properties.large;
      large.x = x;
      large.y = y;
      large.scale = scale;
    }
  };
  // ── internal ───────────────────────────────────────────────────
  #emit() {
    this.dispatchEvent(new CustomEvent("change"));
  }
};
window.ioc.register(
  "@diamondcoreprocessor.com/TileEditorService",
  new TileEditorService()
);

// src/diamondcoreprocessor.com/editor/tile-properties.ts
var TILE_PROPERTIES_FILE = "0000";
var isSignature = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
var readSeedProperties = async (seedDir) => {
  try {
    const fileHandle = await seedDir.getFileHandle(TILE_PROPERTIES_FILE);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return {};
  }
};
var writeSeedProperties = async (seedDir, updates) => {
  const existing = await readSeedProperties(seedDir);
  const merged = { ...existing, ...updates };
  const fileHandle = await seedDir.getFileHandle(TILE_PROPERTIES_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(merged));
  await writable.close();
};
var resolveResourceSignatures = async (properties, getResource) => {
  const resolved = /* @__PURE__ */ new Map();
  const walk = async (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const value of Object.values(obj)) {
      if (isSignature(value)) {
        const sig = value;
        if (!resolved.has(sig)) {
          const blob = await getResource(sig);
          if (blob) resolved.set(sig, blob);
        }
      } else if (typeof value === "object" && value !== null) {
        await walk(value);
      }
    }
  };
  await walk(properties);
  return resolved;
};
export {
  ImageEditorService,
  TILE_PROPERTIES_FILE,
  TileEditorService,
  isSignature,
  readSeedProperties,
  resolveResourceSignatures,
  writeSeedProperties
};
