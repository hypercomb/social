// src/diamondcoreprocessor.com/presentation/tiles/tile-overlay.drone.ts
import { Drone } from "@hypercomb/core";
import { Container as Container2, Point, Text as Text2, TextStyle as TextStyle2 } from "pixi.js";

// src/diamondcoreprocessor.com/presentation/tiles/hex-icon-button.ts
import { Container, Sprite, Text, TextStyle, Assets } from "pixi.js";
var HexIconButton = class extends Container {
  #display = null;
  #config;
  #hovered = false;
  constructor(config) {
    super();
    this.#config = config;
  }
  async load() {
    try {
      if (this.#config.fontChar) {
        await document.fonts.ready;
        const style = new TextStyle({
          fontFamily: "hypercomb-icons",
          fontSize: this.#config.width,
          fill: this.#config.tint ?? 16777215
        });
        const text = new Text({ text: this.#config.fontChar, style, resolution: window.devicePixelRatio * 4 });
        text.anchor.set(0.5, 0.5);
        text.position.set(this.#config.width / 2, this.#config.height / 2);
        this.#display = text;
        this.addChild(text);
      } else if (this.#config.svgMarkup) {
        const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(this.#config.svgMarkup)}`;
        const loadOpts = { src: dataUri };
        if (this.#config.alias) loadOpts.alias = this.#config.alias;
        const texture = await Assets.load(loadOpts);
        const sprite = new Sprite(texture);
        sprite.width = this.#config.width;
        sprite.height = this.#config.height;
        sprite.tint = this.#config.tint ?? 16777215;
        this.#display = sprite;
        this.addChild(sprite);
      }
    } catch (e) {
      console.warn("[HexIconButton] load failed:", e);
    }
  }
  get hovered() {
    return this.#hovered;
  }
  set hovered(value) {
    if (this.#hovered === value) return;
    this.#hovered = value;
    if (!this.#display) return;
    this.#display.tint = value ? this.#config.hoverTint ?? 13162751 : this.#config.tint ?? 16777215;
  }
  containsPoint(localX, localY) {
    return localX >= 0 && localX <= this.#config.width && localY >= 0 && localY <= this.#config.height;
  }
};

// src/diamondcoreprocessor.com/presentation/tiles/hex-overlay.shader.ts
import { Geometry, Mesh, Shader, Texture } from "pixi.js";
var HexOverlayMesh = class {
  mesh;
  #ug;
  constructor(radiusPx, flat) {
    const pad = radiusPx + 6;
    const pos = new Float32Array([
      -pad,
      -pad,
      pad,
      -pad,
      pad,
      pad,
      -pad,
      pad
    ]);
    const uv = new Float32Array([
      0,
      0,
      1,
      0,
      1,
      1,
      0,
      1
    ]);
    const idx = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const geom = new Geometry();
    geom.addAttribute("aPosition", pos, 2);
    geom.addAttribute("aUV", uv, 2);
    geom.addIndex(idx);
    const uniformDefs = {
      u_quadSize: { value: [pad * 2, pad * 2], type: "vec2<f32>" },
      u_radiusPx: { value: radiusPx, type: "f32" },
      u_flat: { value: flat ? 1 : 0, type: "f32" },
      u_fillColor: { value: [0, 0.118, 0.188], type: "vec3<f32>" },
      // 0x001e30
      u_fillAlpha: { value: 0.65, type: "f32" },
      u_strokeColor: { value: [0.267, 0.533, 0.667], type: "vec3<f32>" },
      // 0x4488aa
      u_strokeAlpha: { value: 0.5, type: "f32" }
    };
    const shader = Shader.from({
      gl: { vertex: VERT, fragment: FRAG },
      resources: { uniforms: uniformDefs }
    });
    this.#ug = shader.resources.uniforms;
    this.mesh = new Mesh({
      geometry: geom,
      shader,
      texture: Texture.WHITE
    });
    this.mesh.blendMode = "pre-multiply";
  }
  update(radiusPx, flat) {
    const pad = radiusPx + 6;
    const u = this.#ug.uniforms;
    u.u_quadSize[0] = pad * 2;
    u.u_quadSize[1] = pad * 2;
    u.u_radiusPx = radiusPx;
    u.u_flat = flat ? 1 : 0;
    this.#ug.update();
    const pos = this.mesh.geometry.getBuffer("aPosition");
    if (pos) {
      const d = pos.data;
      d[0] = -pad;
      d[1] = -pad;
      d[2] = pad;
      d[3] = -pad;
      d[4] = pad;
      d[5] = pad;
      d[6] = -pad;
      d[7] = pad;
      pos.update();
    }
  }
};
var VERT = `
  in vec2 aPosition;
  in vec2 aUV;
  out vec2 vUV;

  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;

  void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
  }
`;
var FRAG = `
  precision highp float;

  in vec2 vUV;

  uniform vec2  u_quadSize;
  uniform float u_radiusPx;
  uniform float u_flat;
  uniform vec3  u_fillColor;
  uniform float u_fillAlpha;
  uniform vec3  u_strokeColor;
  uniform float u_strokeAlpha;

  float sdHex(vec2 p, float r) {
    p = abs(p);
    return max(p.x * 0.8660254 + p.y * 0.5, p.y) - r;
  }

  vec2 rot30(vec2 p) {
    return vec2(
      0.8660254 * p.x - 0.5 * p.y,
      0.5 * p.x + 0.8660254 * p.y
    );
  }

  void main() {
    vec2 local = (vUV - 0.5) * u_quadSize;
    vec2 rotated = u_flat > 0.5 ? local : rot30(local);
    float d = sdHex(rotated, u_radiusPx);

    // manual smoothing width (avoids fwidth which requires OES_standard_derivatives)
    float fw = max(u_radiusPx * 0.04, 1.5);
    float aa = fw * 1.5;
    float hexMask = 1.0 - smoothstep(-aa, aa, d);
    if (hexMask < 0.005) discard;

    // fill
    vec3 col = u_fillColor;
    float alpha = hexMask * u_fillAlpha;

    // stroke \u2014 2 screen-pixel ring centered on the hex edge
    float sw = fw * 2.0;
    float strokeMask = 1.0 - smoothstep(0.0, aa, abs(d) - sw);
    strokeMask *= hexMask;
    float strokeA = strokeMask * u_strokeAlpha;

    // composite stroke over fill
    float outA = alpha + strokeA - alpha * strokeA;
    vec3 outC = (outA > 0.001)
      ? (col * alpha * (1.0 - strokeA) + u_strokeColor * strokeA) / outA
      : col;

    // premultiplied alpha output
    gl_FragColor = vec4(outC * outA, outA);
  }
`;

// src/diamondcoreprocessor.com/presentation/grid/hex-geometry.ts
function createHexGeometry(circumRadiusPx, gapPx, padPx = 10) {
  return { circumRadiusPx, gapPx, padPx, spacing: circumRadiusPx + gapPx };
}
var DEFAULT_HEX_GEOMETRY = createHexGeometry(32, 6);

// src/diamondcoreprocessor.com/presentation/tiles/tile-overlay.drone.ts
var LABEL_X = -24;
var LABEL_Y = -14;
var LABEL_STYLE = new TextStyle2({
  fontFamily: "monospace",
  fontSize: 5,
  fill: 16777215,
  align: "left"
});
var TileOverlayDrone = class _TileOverlayDrone extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "contextual action overlay host \u2014 icons registered externally via effects";
  #app = null;
  #renderContainer = null;
  #canvas = null;
  #renderer = null;
  #overlay = null;
  #hexBg = null;
  #seedLabel = null;
  #actions = [];
  #meshOffset = { x: 0, y: 0 };
  #currentAxial = null;
  #currentIndex = void 0;
  #geo = DEFAULT_HEX_GEOMETRY;
  #cellCount = 0;
  #cellLabels = [];
  #listening = false;
  #hoverLog = 0;
  #flat = false;
  #occupiedByAxial = /* @__PURE__ */ new Map();
  #branchLabels = /* @__PURE__ */ new Set();
  #externalLabels = /* @__PURE__ */ new Set();
  #currentTileExternal = false;
  #activeProfileKey = null;
  #noImageLabels = /* @__PURE__ */ new Set();
  #navigationBlocked = false;
  #navigationGuardTimer = null;
  #meshPublic = false;
  #editing = false;
  #editCooldown = false;
  #hasSelection = false;
  #touchDragging = false;
  /** Registered descriptors from provider bees, keyed by name */
  #registeredDescriptors = /* @__PURE__ */ new Map();
  deps = {
    detector: "@diamondcoreprocessor.com/HexDetector",
    axial: "@diamondcoreprocessor.com/AxialService",
    lineage: "@hypercomb.social/Lineage"
  };
  listens = [
    "render:host-ready",
    "render:mesh-offset",
    "render:cell-count",
    "render:set-orientation",
    "render:geometry-changed",
    "navigation:guard-start",
    "navigation:guard-end",
    "mesh:public-changed",
    "editor:mode",
    "selection:changed",
    "overlay:register-action",
    "overlay:unregister-action"
  ];
  emits = ["tile:hover", "tile:action", "tile:click", "tile:navigate-in", "tile:navigate-back"];
  #effectsRegistered = false;
  heartbeat = async () => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true;
      this.onEffect("overlay:register-action", (payload) => {
        const descs = Array.isArray(payload) ? payload : [payload];
        for (const desc of descs) this.#registeredDescriptors.set(desc.name, desc);
        this.#rebuildActiveProfile();
      });
      this.onEffect("overlay:unregister-action", ({ name }) => {
        this.#registeredDescriptors.delete(name);
        this.#rebuildActiveProfile();
      });
      this.onEffect("render:host-ready", (payload) => {
        this.#app = payload.app;
        this.#renderContainer = payload.container;
        this.#canvas = payload.canvas;
        this.#renderer = payload.renderer;
        this.#initOverlay();
        this.#attachListeners();
      });
      this.onEffect("render:mesh-offset", (offset) => {
        this.#meshOffset = offset;
        if (this.#currentAxial) {
          this.#positionOverlay(this.#currentAxial.q, this.#currentAxial.r);
        }
      });
      this.onEffect("render:cell-count", (payload) => {
        this.#cellCount = payload.count;
        this.#cellLabels = payload.labels;
        this.#branchLabels = new Set(payload.branchLabels ?? []);
        this.#externalLabels = new Set(payload.externalLabels ?? []);
        this.#noImageLabels = new Set(payload.noImageLabels ?? []);
        this.#rebuildOccupiedMap();
        if (this.#overlay && this.#currentAxial) {
          this.#currentIndex = this.#lookupIndex(this.#currentAxial.q, this.#currentAxial.r);
          this.#updatePerTileVisibility();
          this.#updateVisibility();
        }
      });
      this.onEffect("render:set-orientation", (payload) => {
        this.#flat = payload.flat;
        this.#updateHexBg();
        if (this.#currentAxial) this.#positionOverlay(this.#currentAxial.q, this.#currentAxial.r);
      });
      this.onEffect("render:geometry-changed", (geo) => {
        this.#geo = geo;
        const detector = this.resolve("detector");
        if (detector) detector.spacing = geo.spacing;
        this.#updateHexBg();
        if (this.#currentAxial) this.#positionOverlay(this.#currentAxial.q, this.#currentAxial.r);
      });
      this.onEffect("navigation:guard-start", () => {
        this.#navigationBlocked = true;
        this.#currentAxial = null;
        this.#currentIndex = void 0;
        if (this.#overlay) this.#overlay.visible = false;
        if (this.#navigationGuardTimer) clearTimeout(this.#navigationGuardTimer);
        this.#navigationGuardTimer = setTimeout(() => {
          this.#navigationBlocked = false;
        }, 200);
      });
      this.onEffect("navigation:guard-end", () => {
        this.#navigationBlocked = false;
        if (this.#navigationGuardTimer) {
          clearTimeout(this.#navigationGuardTimer);
          this.#navigationGuardTimer = null;
        }
      });
      this.onEffect("touch:dragging", ({ active }) => {
        this.#touchDragging = active;
        if (active && this.#overlay) this.#overlay.visible = false;
      });
      this.onEffect("mesh:public-changed", (payload) => {
        this.#meshPublic = payload.public;
        this.#rebuildActiveProfile();
        this.#updateVisibility();
      });
      this.onEffect("editor:mode", (payload) => {
        this.#editing = payload.active;
        if (payload.active) {
          this.#editCooldown = false;
          this.#updateVisibility();
        } else {
          this.#editCooldown = true;
          this.#updateVisibility();
          setTimeout(() => {
            this.#editCooldown = false;
            this.#updateVisibility();
          }, 300);
        }
      });
      this.onEffect("selection:changed", (payload) => {
        this.#hasSelection = (payload?.selected?.length ?? 0) > 0;
        this.#updateVisibility();
      });
    }
  };
  dispose() {
    if (this.#listening) {
      document.removeEventListener("pointermove", this.#onPointerMove);
      document.removeEventListener("click", this.#onClick);
      document.removeEventListener("contextmenu", this.#onContextMenu);
      this.#listening = false;
    }
    if (this.#overlay) {
      this.#overlay.destroy({ children: true });
      this.#overlay = null;
      this.#hexBg = null;
      this.#seedLabel = null;
      this.#actions = [];
    }
  }
  // ── Overlay setup ──────────────────────────────────────────────────
  #initOverlay() {
    if (!this.#renderContainer || this.#overlay) return;
    this.#overlay = new Container2();
    this.#overlay.visible = false;
    this.#overlay.zIndex = 9999;
    this.#hexBg = new HexOverlayMesh(this.#geo.circumRadiusPx, this.#flat);
    this.#overlay.addChild(this.#hexBg.mesh);
    this.#seedLabel = new Text2({ text: "", style: LABEL_STYLE, resolution: window.devicePixelRatio * 8 });
    this.#seedLabel.position.set(LABEL_X, LABEL_Y);
    this.#overlay.addChild(this.#seedLabel);
    this.#renderContainer.addChild(this.#overlay);
    this.#renderContainer.sortableChildren = true;
    this.#rebuildActiveProfile();
  }
  #updateHexBg() {
    this.#hexBg?.update(this.#geo.circumRadiusPx, this.#flat);
  }
  // ── Profile resolution (now from registered descriptors) ───────────
  #resolveProfileKey() {
    if (!this.#meshPublic) return "private";
    return this.#currentTileExternal ? "public-external" : "public-own";
  }
  #rebuildActiveProfile() {
    if (!this.#overlay) return;
    for (const action of this.#actions) {
      this.#overlay.removeChild(action.button);
      action.button.destroy({ children: true });
    }
    this.#actions = [];
    const key = this.#resolveProfileKey();
    this.#activeProfileKey = key;
    for (const desc of this.#registeredDescriptors.values()) {
      if (desc.profile !== key) continue;
      const btn = new HexIconButton({
        svgMarkup: desc.svgMarkup,
        fontChar: desc.fontChar,
        width: desc.iconSize ?? 8.75,
        height: desc.iconSize ?? 8.75,
        alias: `hc-icon-${desc.name}`,
        hoverTint: desc.hoverTint
      });
      btn.position.set(desc.x, desc.y);
      this.#overlay.addChild(btn);
      void btn.load();
      this.#actions.push({
        name: desc.name,
        button: btn,
        profile: desc.profile,
        visibleWhen: desc.visibleWhen
      });
    }
    this.#updatePerTileVisibility();
  }
  // ── Per-tile icon visibility ───────────────────────────────────────
  #updatePerTileVisibility() {
    if (!this.#currentAxial) return;
    const entry = this.#occupiedByAxial.get(_TileOverlayDrone.axialKey(this.#currentAxial.q, this.#currentAxial.r));
    if (!entry) return;
    const ctx = {
      label: entry.label,
      q: this.#currentAxial.q,
      r: this.#currentAxial.r,
      index: entry.index,
      noImage: this.#noImageLabels.has(entry.label)
    };
    for (const action of this.#actions) {
      if (action.visibleWhen) {
        action.button.visible = action.visibleWhen(ctx);
      }
    }
  }
  // ── Input listeners ────────────────────────────────────────────────
  #attachListeners() {
    if (this.#listening) return;
    this.#listening = true;
    document.addEventListener("pointermove", this.#onPointerMove);
    document.addEventListener("click", this.#onClick);
    document.addEventListener("contextmenu", this.#onContextMenu);
  }
  #onPointerMove = (e) => {
    if (!this.#renderContainer || !this.#overlay || !this.#renderer || !this.#canvas) return;
    const detector = this.resolve("detector");
    if (!detector) return;
    const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY);
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y));
    const meshLocalX = local.x - this.#meshOffset.x;
    const meshLocalY = local.y - this.#meshOffset.y;
    const axial = detector.pixelToAxial(meshLocalX, meshLocalY, this.#flat);
    const hexChanged = !this.#currentAxial || this.#currentAxial.q !== axial.q || this.#currentAxial.r !== axial.r;
    if (hexChanged) {
      this.#currentAxial = axial;
      this.#currentIndex = this.#lookupIndex(axial.q, axial.r);
      const entry = this.#occupiedByAxial.get(_TileOverlayDrone.axialKey(axial.q, axial.r));
      this.#currentTileExternal = !!(entry?.label && this.#externalLabels.has(entry.label));
      if (this.#meshPublic) {
        const newKey = this.#resolveProfileKey();
        if (newKey !== this.#activeProfileKey) this.#rebuildActiveProfile();
      }
      if (this.#hoverLog < 5) {
        console.log("[TileOverlay] hover q:", axial.q, "r:", axial.r, "-> index:", this.#currentIndex);
        this.#hoverLog++;
      }
      if (e.ctrlKey || e.metaKey) {
        this.#overlay.visible = false;
        this.emitEffect("tile:hover", { q: axial.q, r: axial.r });
        return;
      }
      this.#positionOverlay(axial.q, axial.r);
      this.#updateSeedLabel(axial.q, axial.r);
      this.#updatePerTileVisibility();
      this.emitEffect("tile:hover", { q: axial.q, r: axial.r });
    }
    if (e.ctrlKey || e.metaKey) {
      this.#overlay.visible = false;
      return;
    }
    this.#updateIconHover(local);
  };
  #updateIconHover(local) {
    if (!this.#overlay?.visible) {
      for (const a of this.#actions) a.button.hovered = false;
      return;
    }
    const ox = this.#overlay.position.x;
    const oy = this.#overlay.position.y;
    for (const a of this.#actions) {
      const btn = a.button;
      const bx = local.x - ox - btn.position.x;
      const by = local.y - oy - btn.position.y;
      btn.hovered = btn.containsPoint(bx, by);
    }
  }
  #onClick = (e) => {
    if (this.#navigationBlocked) return;
    if (this.#editing || this.#editCooldown) return;
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return;
    if (e.ctrlKey || e.metaKey) {
      const detector = this.resolve("detector");
      if (!detector) return;
      const pixiGlobal2 = this.#clientToPixiGlobal(e.clientX, e.clientY);
      const local2 = this.#renderContainer.toLocal(new Point(pixiGlobal2.x, pixiGlobal2.y));
      const meshLocalX = local2.x - this.#meshOffset.x;
      const meshLocalY = local2.y - this.#meshOffset.y;
      const axial = detector.pixelToAxial(meshLocalX, meshLocalY, this.#flat);
      const entry2 = this.#occupiedByAxial.get(_TileOverlayDrone.axialKey(axial.q, axial.r));
      if (!entry2?.label) return;
      this.emitEffect("tile:click", {
        q: axial.q,
        r: axial.r,
        label: entry2.label,
        index: entry2.index,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey
      });
      return;
    }
    if (this.#currentIndex === void 0 || this.#currentIndex >= this.#cellCount) return;
    const entry = this.#occupiedByAxial.get(
      _TileOverlayDrone.axialKey(this.#currentAxial.q, this.#currentAxial.r)
    );
    if (!entry?.label) return;
    const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY);
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y));
    if (this.#overlay?.visible) {
      const ox = this.#overlay.position.x;
      const oy = this.#overlay.position.y;
      for (const action of this.#actions) {
        if (!action.button.visible) continue;
        const btn = action.button;
        const bx = local.x - ox - btn.position.x;
        const by = local.y - oy - btn.position.y;
        if (btn.containsPoint(bx, by)) {
          this.emitEffect("tile:action", {
            action: action.name,
            q: this.#currentAxial.q,
            r: this.#currentAxial.r,
            index: this.#currentIndex,
            label: entry.label
          });
          return;
        }
      }
    }
    if (this.#hasSelection) {
      this.emitEffect("tile:click", {
        q: this.#currentAxial.q,
        r: this.#currentAxial.r,
        label: entry.label,
        index: this.#currentIndex,
        ctrlKey: false,
        metaKey: false
      });
      return;
    }
    if (this.#branchLabels.has(entry.label)) {
      this.#navigateInto(entry.label);
    }
  };
  #onContextMenu = (e) => {
    if (this.#navigationBlocked) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      return;
    }
    const selection = window.ioc.get("@diamondcoreprocessor.com/SelectionService");
    if (selection && selection.count > 0) {
      e.preventDefault();
      return;
    }
    const gate = window.ioc.get("@diamondcoreprocessor.com/InputGate");
    if (gate?.active) return;
    e.preventDefault();
    this.#navigateBack();
  };
  // ── Navigation ─────────────────────────────────────────────────────
  #navigateInto(label) {
    const lineage = this.resolve("lineage");
    if (!lineage) return;
    this.emitEffect("tile:navigate-in", { label });
    lineage.explorerEnter(label);
  }
  #navigateBack() {
    const lineage = this.resolve("lineage");
    if (!lineage) return;
    this.emitEffect("tile:navigate-back", {});
    lineage.explorerUp();
  }
  // ── Helpers ────────────────────────────────────────────────────────
  #updateSeedLabel(q, r) {
    if (!this.#seedLabel) return;
    const entry = this.#occupiedByAxial.get(_TileOverlayDrone.axialKey(q, r));
    this.#seedLabel.text = entry?.label ?? "";
  }
  #updateVisibility() {
    if (!this.#overlay) return;
    const occupied = this.#currentIndex !== void 0 && this.#currentIndex < this.#cellCount;
    this.#overlay.visible = occupied && !this.#editing && !this.#editCooldown && !this.#hasSelection && !this.#touchDragging;
  }
  #positionOverlay(q, r) {
    if (!this.#overlay) return;
    const px = this.#axialToPixel(q, r);
    this.#overlay.position.set(
      px.x + this.#meshOffset.x,
      px.y + this.#meshOffset.y
    );
    this.#updateVisibility();
  }
  #axialToPixel(q, r) {
    return this.#flat ? { x: 1.5 * this.#geo.spacing * q, y: Math.sqrt(3) * this.#geo.spacing * (r + q / 2) } : { x: Math.sqrt(3) * this.#geo.spacing * (q + r / 2), y: this.#geo.spacing * 1.5 * r };
  }
  static axialKey(q, r) {
    return `${q},${r}`;
  }
  #rebuildOccupiedMap() {
    this.#occupiedByAxial.clear();
    const axial = this.resolve("axial");
    if (!axial?.items) return;
    for (let i = 0; i < this.#cellCount; i++) {
      const coord = axial.items.get(i);
      const label = this.#cellLabels[i];
      if (!coord || !label) break;
      this.#occupiedByAxial.set(_TileOverlayDrone.axialKey(coord.q, coord.r), { index: i, label });
    }
  }
  #lookupIndex(q, r) {
    return this.#occupiedByAxial.get(_TileOverlayDrone.axialKey(q, r))?.index;
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
};
var _tileOverlay = new TileOverlayDrone();
window.ioc.register("@diamondcoreprocessor.com/TileOverlayDrone", _tileOverlay);
export {
  TileOverlayDrone
};
