// src/diamondcoreprocessor.com/presentation/grid/show-honeycomb.drone.ts
import { Drone, SignatureService } from "@hypercomb/core";
import { Container as Container3, Geometry, Mesh, Texture as Texture4 } from "pixi.js";

// src/diamondcoreprocessor.com/presentation/grid/hex-label.atlas.ts
import { Container, RenderTexture, Text, TextStyle } from "pixi.js";
var HexLabelAtlas = class {
  constructor(renderer, cellPx = 128, cols = 8, rows = 8) {
    this.renderer = renderer;
    this.cellPx = cellPx;
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    this.atlas = RenderTexture.create({
      width: this.cols * this.cellPx,
      height: this.rows * this.cellPx,
      resolution: 8
    });
    this.renderer.render({ container: new Container(), target: this.atlas, clear: true });
    this.style = new TextStyle({
      fontFamily: "monospace",
      fontSize: 7.5,
      fill: 16777215,
      align: "center"
    });
  }
  atlas;
  map = /* @__PURE__ */ new Map();
  nextIndex = 0;
  #pivot = false;
  cols;
  rows;
  style;
  setPivot = (pivot) => {
    if (this.#pivot === pivot) return;
    this.#pivot = pivot;
    this.map.clear();
    this.nextIndex = 0;
    this.renderer.render({ container: new Container(), target: this.atlas, clear: true });
  };
  getAtlasTexture = () => {
    return this.atlas;
  };
  getLabelUV = (label) => {
    const cached = this.map.get(label);
    if (cached) return cached;
    const slot = this.nextIndex % (this.cols * this.rows);
    this.nextIndex++;
    const col = slot % this.cols;
    const row = Math.floor(slot / this.cols);
    const text = new Text({ text: label, style: this.style });
    text.resolution = 4;
    text.anchor.set(0.5);
    text.position.set(
      col * this.cellPx + this.cellPx * 0.5,
      row * this.cellPx + this.cellPx * 0.5
    );
    if (this.#pivot) {
      text.rotation = Math.PI / 2;
    }
    this.renderer.render({ container: text, target: this.atlas, clear: false });
    text.destroy();
    const u0 = col * this.cellPx / this.atlas.width;
    const v0 = row * this.cellPx / this.atlas.height;
    const u1 = (col + 1) * this.cellPx / this.atlas.width;
    const v1 = (row + 1) * this.cellPx / this.atlas.height;
    const uv = { u0, v0, u1, v1 };
    this.map.set(label, uv);
    return uv;
  };
};
var HexLabelAtlasFactory = class {
  create = (renderer, cellPx = 128, cols = 8, rows = 8) => {
    return new HexLabelAtlas(renderer, cellPx, cols, rows);
  };
};
window.ioc.register("@diamondcoreprocessor.com/HexLabelAtlasFactory", new HexLabelAtlasFactory());

// src/diamondcoreprocessor.com/presentation/grid/hex-image.atlas.ts
import { Container as Container2, RenderTexture as RenderTexture2, Sprite, Texture as Texture2 } from "pixi.js";
var HexImageAtlas = class {
  #atlas;
  #map = /* @__PURE__ */ new Map();
  #nextSlot = 0;
  #cols;
  #rows;
  #cellPx;
  #renderer;
  constructor(renderer, cellPx = 256, cols = 8, rows = 8) {
    this.#renderer = renderer;
    this.#cellPx = Math.max(1, cellPx);
    this.#cols = Math.max(1, cols);
    this.#rows = Math.max(1, rows);
    this.#atlas = RenderTexture2.create({
      width: this.#cols * this.#cellPx,
      height: this.#rows * this.#cellPx,
      resolution: 2,
      scaleMode: "linear",
      antialias: true
    });
    this.#renderer.render({ container: new Container2(), target: this.#atlas, clear: true });
  }
  getAtlasTexture() {
    return this.#atlas;
  }
  hasImage(sig) {
    return this.#map.has(sig);
  }
  getImageUV(sig) {
    return this.#map.get(sig) ?? null;
  }
  async loadImage(sig, blob) {
    const existing = this.#map.get(sig);
    if (existing) return existing;
    const slot = this.#nextSlot % (this.#cols * this.#rows);
    this.#nextSlot++;
    const col = slot % this.#cols;
    const row = Math.floor(slot / this.#cols);
    const bitmap = await createImageBitmap(blob);
    const texture = Texture2.from(bitmap);
    const sprite = new Sprite(texture);
    const scaleX = this.#cellPx / bitmap.width;
    const scaleY = this.#cellPx / bitmap.height;
    const scale = Math.min(scaleX, scaleY);
    sprite.scale.set(scale);
    sprite.anchor.set(0.5);
    sprite.position.set(
      col * this.#cellPx + this.#cellPx * 0.5,
      row * this.#cellPx + this.#cellPx * 0.5
    );
    this.#renderer.render({ container: sprite, target: this.#atlas, clear: false });
    sprite.destroy();
    const imgW = bitmap.width * scale;
    const imgH = bitmap.height * scale;
    const padX = (this.#cellPx - imgW) / 2;
    const padY = (this.#cellPx - imgH) / 2;
    const u0 = (col * this.#cellPx + padX) / this.#atlas.width;
    const v0 = (row * this.#cellPx + padY) / this.#atlas.height;
    const u1 = (col * this.#cellPx + padX + imgW) / this.#atlas.width;
    const v1 = (row * this.#cellPx + padY + imgH) / this.#atlas.height;
    const uv = { u0, v0, u1, v1 };
    this.#map.set(sig, uv);
    return uv;
  }
  /** Remove a specific entry (e.g. after re-save) so next load picks up the new image */
  invalidate(sig) {
    this.#map.delete(sig);
  }
};

// src/diamondcoreprocessor.com/presentation/grid/hex-sdf.shader.ts
import { Shader } from "pixi.js";
var HexSdfTextureShader = class _HexSdfTextureShader {
  shader;
  // Pixi v8 separates uniform structures ({ value, type }) from the flat values
  // it uploads to the GPU. We must update the flat values via the uniform group's
  // .uniforms property, then call .update() to mark dirty for re-upload.
  #ug;
  // UniformGroup — holds .uniforms (flat GPU values)
  constructor(labelAtlas, cellImageAtlas, quadW, quadH, radiusPx) {
    const uniformDefs = {
      u_quadSize: { value: [quadW, quadH], type: "vec2<f32>" },
      u_radiusPx: { value: radiusPx, type: "f32" },
      u_flat: { value: 0, type: "f32" },
      u_pivot: { value: 0, type: "f32" },
      u_hoveredIndex: { value: -1, type: "f32" }
    };
    this.shader = Shader.from({
      gl: { vertex: _HexSdfTextureShader.vertexSource, fragment: _HexSdfTextureShader.fragmentSource },
      resources: {
        uniforms: uniformDefs,
        u_label: this.toSource(labelAtlas),
        u_cellImages: this.toSource(cellImageAtlas)
      }
    });
    this.#ug = this.shader.resources.uniforms;
  }
  setQuadSize = (w, h) => {
    const v = this.#ug.uniforms.u_quadSize;
    v[0] = w;
    v[1] = h;
    this.#ug.update();
  };
  setRadiusPx = (r) => {
    this.#ug.uniforms.u_radiusPx = r;
    this.#ug.update();
  };
  setFlat = (flat) => {
    this.#ug.uniforms.u_flat = flat ? 1 : 0;
    this.#ug.update();
  };
  setPivot = (pivot) => {
    this.#ug.uniforms.u_pivot = pivot ? 1 : 0;
    this.#ug.update();
  };
  setHoveredIndex = (index) => {
    this.#ug.uniforms.u_hoveredIndex = index;
    this.#ug.update();
  };
  setLabelAtlas = (t) => {
    ;
    this.shader.resources.u_label = this.toSource(t);
  };
  setCellImageAtlas = (t) => {
    ;
    this.shader.resources.u_cellImages = this.toSource(t);
  };
  toSource = (t) => {
    return t.source ?? t.baseTexture?.source ?? t.texture?.source;
  };
  // note: use in/out so pixi v8 can compile consistently
  static vertexSource = `
    in vec2 aPosition;
    in vec2 aUV;
    in vec4 aLabelUV;
    in vec4 aImageUV;
    in float aHasImage;
    in float aHeat;
    in vec3 aIdentityColor;
    in float aHasBranch;
    in vec3 aBorderColor;
    in float aCellIndex;

    out vec2 vUV;
    out vec4 vLabelUV;
    out vec4 vImageUV;
    out float vHasImage;
    out float vHeat;
    out vec3 vIdentityColor;
    out float vHasBranch;
    out vec3 vBorderColor;
    out float vCellIndex;

    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    uniform mat3 uTransformMatrix;

    void main() {
      mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
      gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
      vUV = aUV;
      vLabelUV = aLabelUV;
      vImageUV = aImageUV;
      vHasImage = aHasImage;
      vHeat = aHeat;
      vIdentityColor = aIdentityColor;
      vHasBranch = aHasBranch;
      vBorderColor = aBorderColor;
      vCellIndex = aCellIndex;
    }
  `;
  static fragmentSource = `
    precision highp float;

    in vec2 vUV;
    in vec4 vLabelUV;
    in vec4 vImageUV;
    in float vHasImage;
    in float vHeat;
    in vec3 vIdentityColor;
    in float vHasBranch;
    in vec3 vBorderColor;
    in float vCellIndex;

    uniform vec2 u_quadSize;
    uniform float u_radiusPx;
    uniform float u_flat;
    uniform float u_pivot;
    uniform float u_hoveredIndex;

    uniform sampler2D u_label;
    uniform sampler2D u_cellImages;

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
      // point-top: rotate 30\xB0 so sdHex clips correctly; flat-top: no rotation needed
      vec2 rotated = u_flat > 0.5 ? local : rot30(local);
      float d = sdHex(rotated, u_radiusPx);

      // smooth the hex edge \u2014 wider band for clean AA
      float aa = max(u_radiusPx * 0.04, 1.5);
      float hexAlpha = 1.0 - smoothstep(-aa, aa, d);
      if (hexAlpha < 0.005) discard;

      vec4 base;

      if (vHasImage > 0.5) {
        // snapshot cell: fill full hex with the snapshot image
        float hexW = u_flat > 0.5 ? 2.0 * u_radiusPx / 0.8660254 : 2.0 * u_radiusPx;
        float hexH = u_flat > 0.5 ? 2.0 * u_radiusPx : 2.0 * u_radiusPx / 0.8660254;
        vec2 hexScale = vec2(hexW / u_quadSize.x, hexH / u_quadSize.y);
        vec2 hexUV = clamp((vUV - 0.5) / hexScale + 0.5, 0.0, 1.0);
        // pivot mode: rotate snapshot 90\xB0 CW inside the hex
        if (u_pivot > 0.5) {
          hexUV = vec2(hexUV.y, 1.0 - hexUV.x);
        }
        vec2 imgUV = mix(vImageUV.xy, vImageUV.zw, hexUV);
        base = texture2D(u_cellImages, imgUV);

        // border ring on image cells \u2014 flush with hex edge, DPI-aware width
        float imgRing = 1.0 - smoothstep(0.0, aa * 2.0, abs(d));
        base.rgb = mix(base.rgb, vBorderColor, imgRing * 0.4);
      } else {
        // no snapshot: dark fill + border ring (branch-indicator style)
        vec3 bgColor = vec3(0.04, 0.10, 0.16);
        base = vec4(bgColor, 1.0);

        // border ring \u2014 flush with hex edge, DPI-aware width
        float ring = 1.0 - smoothstep(0.0, aa * 2.0, abs(d));
        base.rgb = mix(base.rgb, vBorderColor, ring * 0.5);

        // subtle identity wash on cell interior
        float innerMask = smoothstep(0.0, -2.0, d);
        base.rgb = mix(base.rgb, vIdentityColor, innerMask * 0.05);
      }

      vec4 color = base;

      if (vHasImage < 0.5 && abs(vCellIndex - u_hoveredIndex) > 0.5) {
        // label only for cells without snapshot (suppressed on hovered cell)
        vec2 luv = mix(vLabelUV.xy, vLabelUV.zw, vUV);
        float labelAlpha = texture2D(u_label, luv).a;
        color = mix(color, vec4(1.0, 1.0, 1.0, labelAlpha), labelAlpha);

        // ambient presence \u2014 identity color at rest, shifts to warm amber with heat
        float heatRing = smoothstep(0.0, -1.5, d) - smoothstep(-4.0, -6.0, d);
        vec3 warmColor = vec3(1.0, 0.62, 0.12);
        vec3 heatTint = mix(vIdentityColor, warmColor, vHeat);
        float heatAlpha = mix(0.07, 0.68, vHeat);
        color.rgb = mix(color.rgb, heatTint, heatRing * heatAlpha);
      }

      // branch indicator: hex ring at edge + subtle portal glow
      if (vHasBranch > 0.5) {
        float branchRing = 1.0 - smoothstep(0.0, aa * 3.0, abs(d));
        vec3 ringColor = vec3(0.45, 0.72, 1.0);
        color.rgb = mix(color.rgb, ringColor, branchRing * 0.8);

        float dist = length(local) / u_radiusPx;
        float glow = exp(-dist * dist * 2.2);
        color.rgb += ringColor * glow * 0.18;
      }

      // premultiplied alpha output for correct blending at hex edges
      color.a *= hexAlpha;
      color.rgb *= color.a;
      gl_FragColor = color;
    }
  `;
};
var HexSdfTextureShaderFactory = class {
  create = (labelAtlas, cellImageAtlas, quadW, quadH, radiusPx) => {
    return new HexSdfTextureShader(labelAtlas, cellImageAtlas, quadW, quadH, radiusPx);
  };
};
window.ioc.register("@diamondcoreprocessor.com/HexSdfTextureShaderFactory", new HexSdfTextureShaderFactory());

// src/diamondcoreprocessor.com/presentation/grid/hex-geometry.ts
function createHexGeometry(circumRadiusPx, gapPx, padPx = 10) {
  return { circumRadiusPx, gapPx, padPx, spacing: circumRadiusPx + gapPx };
}
var DEFAULT_HEX_GEOMETRY = createHexGeometry(32, 6);

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

// src/diamondcoreprocessor.com/presentation/grid/show-honeycomb.drone.ts
function labelToRgb(label) {
  let hash = 5381;
  for (let i = 0; i < label.length; i++) hash = (hash << 5) + hash + label.charCodeAt(i) | 0;
  hash = hash >>> 0;
  const hue = hash % 360 / 360;
  const sat = 0.5;
  const lit = 0.6;
  const c = (1 - Math.abs(2 * lit - 1)) * sat;
  const x = c * (1 - Math.abs(hue * 6 % 2 - 1));
  const m = lit - c / 2;
  let r = 0, g = 0, b = 0;
  const sector = hue * 6 | 0;
  if (sector === 0) {
    r = c;
    g = x;
    b = 0;
  } else if (sector === 1) {
    r = x;
    g = c;
    b = 0;
  } else if (sector === 2) {
    r = 0;
    g = c;
    b = x;
  } else if (sector === 3) {
    r = 0;
    g = x;
    b = c;
  } else if (sector === 4) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }
  return [r + m, g + m, b + m];
}
var ShowHoneycombWorker = class _ShowHoneycombWorker extends Drone {
  static STREAM_BATCH_SIZE = 8;
  namespace = "diamondcoreprocessor.com";
  // pixi resources (populated via render:host-ready effect)
  pixiApp = null;
  pixiContainer = null;
  pixiRenderer = null;
  layer = null;
  hexMesh = null;
  deps = {
    lineage: "@hypercomb.social/Lineage",
    axial: "@diamondcoreprocessor.com/AxialService",
    layout: "@diamondcoreprocessor.com/LayoutService"
  };
  listens = ["render:host-ready", "mesh:ready", "mesh:items-updated", "tile:saved", "search:filter", "render:set-orientation", "render:set-pivot", "mesh:room", "mesh:secret", "seed:place-at", "seed:reorder", "render:set-gap", "move:preview", "clipboard:captured", "layout:mode"];
  emits = ["mesh:ensure-started", "mesh:subscribe", "mesh:publish", "render:mesh-offset", "render:cell-count", "render:geometry-changed"];
  geom = null;
  shader = null;
  atlas = null;
  imageAtlas = null;
  atlasRenderer = null;
  // cache: seed label → small image signature (avoids re-reading 0000 on every render)
  seedImageCache = /* @__PURE__ */ new Map();
  // cache: seed label → border color RGB floats
  seedBorderColorCache = /* @__PURE__ */ new Map();
  lastKey = "";
  listening = false;
  rendering = false;
  renderQueued = false;
  renderedCellsKey = "";
  renderedCount = 0;
  lineageChangeListening = false;
  // incremental rendering state — tracks what's currently painted (geometry cache)
  renderedCells = /* @__PURE__ */ new Map();
  // per-layer cache: location key → cells array (for instant back-navigation)
  #layerCellsCache = /* @__PURE__ */ new Map();
  #heatByLabel = /* @__PURE__ */ new Map();
  #flashLabels = /* @__PURE__ */ new Set();
  #flashTimer = null;
  streamActive = false;
  cancelStreamFlag = false;
  renderedLocationKey = "";
  #axialToIndex = /* @__PURE__ */ new Map();
  #heartbeatInitialized = false;
  #lastHeartbeatKey = "";
  // hex geometry (circumradius, gap, pad, spacing) — configurable via render:set-gap effect
  #hexGeo = DEFAULT_HEX_GEOMETRY;
  // hex orientation: 'point-top' (default) or 'flat-top'
  #flat = false;
  #pivot = false;
  #textOnly = false;
  // mesh scoping — space + secret feed into the signature key
  #space = "";
  #secret = "";
  // note: mesh seed state (derived on heartbeat)
  meshSig = "";
  meshSeedsRev = 0;
  meshSeeds = [];
  // clipboard view override — when set, render from this dir instead of explorer
  #clipboardView = null;
  meshSub = null;
  publisherId = (() => {
    const key = "hc:show-honeycomb:publisher-id";
    try {
      const existing = String(localStorage.getItem(key) ?? "").trim();
      if (existing) return existing;
      const next = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `pub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, next);
      return next;
    } catch {
      return `pub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }
  })();
  snapshotPostedBySig = /* @__PURE__ */ new Set();
  lastLocalSeedsBySig = /* @__PURE__ */ new Map();
  lastPublishedGrammarSig = "";
  lastPublishedGrammarSeed = "";
  // lease renewal: periodic refresh to keep tiles alive for late joiners
  #lastRefreshAtMs = /* @__PURE__ */ new Map();
  // sync-request: one-shot per sig arrival
  #syncRequestedBySig = /* @__PURE__ */ new Set();
  // rate-limit triggered republishes from sync-requests
  #lastTriggeredRepublishAtMs = /* @__PURE__ */ new Map();
  filterKeyword = "";
  moveNames = null;
  suppressCellCount = false;
  #layoutMode = "dense";
  // cached render context for fast move:preview path (avoids full OPFS re-read)
  cachedSeedNames = null;
  cachedLocalSeedSet = null;
  cachedBranchSet = null;
  onSynchronize = () => {
    this.requestRender();
  };
  onLineageChange = () => {
    this.requestRender();
  };
  adoptHostPayload = (payload) => {
    this.pixiApp = payload.app;
    this.pixiContainer = payload.container;
    this.pixiRenderer = payload.renderer;
    this.requestRender();
  };
  heartbeat = async (grammar = "") => {
    this.ensureListeners();
    if (!this.#heartbeatInitialized) {
      this.#heartbeatInitialized = true;
      this.emitEffect("render:geometry-changed", this.#hexGeo);
    }
    const lineage = this.resolve("lineage");
    const locationKey = String(lineage?.explorerLabel?.() ?? "/");
    const fsRev = Number(lineage?.changed?.() ?? 0);
    const heartbeatKey = `${locationKey}:${fsRev}:${grammar}`;
    if (heartbeatKey !== this.#lastHeartbeatKey) {
      this.#lastHeartbeatKey = heartbeatKey;
      await this.refreshMeshSeeds(grammar);
      this.requestRender();
    }
  };
  refreshMeshSeeds = async (grammar = "") => {
    const lineage = this.resolve("lineage");
    const mesh = this.tryGetMesh();
    if (!lineage || !mesh) return;
    const signatureLocation = await this.computeSignatureLocation(lineage);
    const sig = signatureLocation.sig;
    if (sig !== this.meshSig) {
      const NOSTR = "wss://relay.snort.social";
      const nakPayload = '{"seeds":["external.alpha","Street Fighter"]}';
      const nakCmd = `nak event ${NOSTR} --kind 29010 --tag "x=${sig}" --content '${nakPayload}'`;
      window.__showHoneycombNakCommand = nakCmd;
      console.log("[show-honeycomb] signature location", signatureLocation.key);
      console.log("[show-honeycomb] nak command (copy from window.__showHoneycombNakCommand):", nakCmd);
    }
    if (!sig) return;
    const sigChanged = sig !== this.meshSig;
    if (sigChanged) {
      if (this.meshSub) {
        try {
          this.meshSub.close();
        } catch {
        }
        this.meshSub = null;
      }
      this.meshSig = sig;
      this.meshSeeds = [];
      this.meshSeedsRev++;
      if (typeof mesh.subscribe === "function") {
        this.meshSub = mesh.subscribe(sig, (evt) => {
          this.#handleIncomingSyncRequest(evt, mesh, sig);
          void (async () => {
            await this.refreshMeshSeeds();
            this.requestRender();
          })();
        });
      }
    }
    mesh.ensureStartedForSig(sig);
    this.emitEffect("mesh:ensure-started", { signature: sig });
    await this.publishLocalSeeds(lineage, mesh, sig, grammar);
    const items = mesh.getNonExpired(sig);
    if (!this.#syncRequestedBySig.has(sig) && this.snapshotPostedBySig.has(sig)) {
      const hasOtherPublishers = items.some((it) => {
        const pubId = this.readPublisherIdFromEvent(it?.event);
        return pubId && pubId !== this.publisherId;
      });
      if (!hasOtherPublishers && typeof mesh.publish === "function") {
        this.#syncRequestedBySig.add(sig);
        void mesh.publish(29010, sig, {
          type: "sync-request",
          publisherId: this.publisherId,
          requestedAtMs: Date.now()
        }, [["publisher", this.publisherId], ["mode", "sync-request"]]);
      }
    }
    if (!items || items.length === 0) {
      if (this.meshSeeds.length !== 0) {
        this.meshSeeds = [];
        this.meshSeedsRev++;
      }
      return;
    }
    const set = /* @__PURE__ */ new Set();
    for (const it of items) {
      const p = it?.payload;
      const tagPublisherId = this.readPublisherIdFromEvent(it?.event);
      const payloadPublisherId = String(p?.publisherId ?? p?.publisher ?? p?.clientId ?? "").trim();
      if (payloadPublisherId && payloadPublisherId === this.publisherId || tagPublisherId && tagPublisherId === this.publisherId) {
        continue;
      }
      const fromContent = this.extractSeedsFromEventContent(it?.event?.content);
      if (fromContent.length > 0) {
        for (const seed of fromContent) set.add(seed);
        continue;
      }
      if (Array.isArray(p)) {
        for (const x of p) {
          const s = String(x ?? "").trim();
          this.addCsvSeeds(set, s);
        }
        continue;
      }
      if (typeof p === "string") {
        const parsed = this.extractSeedsFromEventContent(p);
        if (parsed.length > 0) {
          for (const seed of parsed) set.add(seed);
        } else if (!this.looksStructuredContent(p)) {
          this.addCsvSeeds(set, p);
        }
        continue;
      }
      const seedsArr = p?.seeds;
      if (Array.isArray(seedsArr)) {
        for (const x of seedsArr) {
          const s = String(x ?? "").trim();
          this.addCsvSeeds(set, s);
        }
      }
      const singleSeed = String(p?.seed ?? "").trim();
      this.addCsvSeeds(set, singleSeed);
    }
    const next = Array.from(set);
    next.sort((a, b) => a.localeCompare(b));
    const sameLen = next.length === this.meshSeeds.length;
    let same = sameLen;
    if (same) {
      for (let i = 0; i < next.length; i++) {
        if (next[i] !== this.meshSeeds[i]) {
          same = false;
          break;
        }
      }
    }
    if (!same) {
      this.meshSeeds = next;
      this.meshSeedsRev++;
    }
  };
  publishExplicitSeedList = async (seeds) => {
    const lineage = this.resolve("lineage");
    const mesh = this.tryGetMesh();
    if (!lineage || !mesh || typeof mesh.publish !== "function") return false;
    const signatureLocation = await this.computeSignatureLocation(lineage);
    if (!signatureLocation.sig) return false;
    const normalized = Array.isArray(seeds) ? seeds.map((s) => String(s ?? "").trim()).filter((s) => s.length > 0) : [];
    const payload = normalized.join(",");
    const ok = await mesh.publish(29010, signatureLocation.sig, payload, [["publisher", this.publisherId]]);
    await this.refreshMeshSeeds();
    this.requestRender();
    return !!ok;
  };
  #cachedSigLocationKey = "";
  #cachedSigLocation = { key: "", sig: "" };
  computeSignatureLocation = async (lineage) => {
    const domain = String(lineage?.domain?.() ?? lineage?.domainLabel?.() ?? "hypercomb.io");
    const explorerSegmentsRaw = lineage?.explorerSegments?.();
    const explorerSegments = Array.isArray(explorerSegmentsRaw) ? explorerSegmentsRaw.map((x) => String(x ?? "").trim()).filter((x) => x.length > 0) : [];
    const lineagePath = explorerSegments.join("/");
    const parts = [this.#space, domain, lineagePath, this.#secret, "seed"].filter(Boolean);
    const key = parts.join("/");
    if (key === this.#cachedSigLocationKey) return this.#cachedSigLocation;
    const sigStore = get("@hypercomb/SignatureStore");
    const sig = sigStore ? await sigStore.signText(key) : await SignatureService.sign(new TextEncoder().encode(key).buffer);
    this.#cachedSigLocationKey = key;
    this.#cachedSigLocation = { key, sig };
    return this.#cachedSigLocation;
  };
  // mesh discovery — resolves whichever mesh drone is registered
  // note: data queries (getNonExpired, subscribe) still use the direct API
  // coordination (ensureStartedForSig, publish) also emits effects for observability
  tryGetMesh = () => {
    return get("@diamondcoreprocessor.com/NostrMeshWorker") ?? null;
  };
  publishLocalSeeds = async (lineage, mesh, sig, grammar = "") => {
    if (typeof mesh.publish !== "function") return;
    if (!lineage?.explorerDir) return;
    const dir = await lineage.explorerDir();
    if (!dir) return;
    const localSeeds = await this.listSeedFolders(dir);
    const previousSeeds = this.lastLocalSeedsBySig.get(sig) ?? [];
    if (!this.snapshotPostedBySig.has(sig)) {
      await mesh.publish(29010, sig, {
        seeds: localSeeds,
        publisherId: this.publisherId,
        mode: "snapshot",
        publishedAtMs: Date.now()
      }, [["publisher", this.publisherId], ["mode", "snapshot"]]);
      this.snapshotPostedBySig.add(sig);
      this.#lastRefreshAtMs.set(sig, Date.now());
    }
    const prevSet = new Set(previousSeeds);
    for (const seed of localSeeds) {
      if (prevSet.has(seed)) continue;
      await mesh.publish(29010, sig, seed, [["publisher", this.publisherId], ["mode", "delta"]]);
    }
    this.lastLocalSeedsBySig.set(sig, localSeeds);
    const now = Date.now();
    const lastRefresh = this.#lastRefreshAtMs.get(sig) ?? 0;
    const refreshInterval = this.#computeRefreshInterval(mesh, sig);
    if (lastRefresh > 0 && now - lastRefresh >= refreshInterval) {
      await mesh.publish(29010, sig, {
        seeds: localSeeds,
        publisherId: this.publisherId,
        mode: "refresh",
        publishedAtMs: now
      }, [["publisher", this.publisherId], ["mode", "refresh"]]);
      this.#lastRefreshAtMs.set(sig, now);
    }
    const grammarSeed = this.toGrammarSeed(grammar);
    const grammarIsNew = grammarSeed && (sig !== this.lastPublishedGrammarSig || grammarSeed !== this.lastPublishedGrammarSeed);
    if (grammarIsNew) {
      await mesh.publish(29010, sig, grammarSeed, [["publisher", this.publisherId], ["source", "show-honeycomb:grammar-heartbeat"]]);
      this.lastPublishedGrammarSig = sig;
      this.lastPublishedGrammarSeed = grammarSeed;
    }
  };
  // swarm-adaptive refresh interval: smaller swarms refresh more frequently
  #computeRefreshInterval = (mesh, sig) => {
    const swarmSize = typeof mesh.getSwarmSize === "function" ? mesh.getSwarmSize(sig) : 0;
    const jitter = Math.floor(Math.random() * 5e3);
    if (swarmSize > 20) return 9e4 + jitter;
    if (swarmSize > 5) return 6e4 + jitter;
    return 45e3 + jitter;
  };
  // handle incoming sync-request from another publisher — republish snapshot (rate-limited)
  #handleIncomingSyncRequest = (evt, mesh, sig) => {
    if (typeof mesh.publish !== "function") return;
    const tags = evt?.event?.tags;
    if (!Array.isArray(tags)) return;
    let isSyncRequest = false;
    let requestPublisherId = "";
    for (const t of tags) {
      if (!Array.isArray(t) || t.length < 2) continue;
      if (String(t[0]) === "mode" && String(t[1]) === "sync-request") isSyncRequest = true;
      if (String(t[0]) === "publisher") requestPublisherId = String(t[1] ?? "").trim();
    }
    if (!isSyncRequest) return;
    if (requestPublisherId === this.publisherId) return;
    const now = Date.now();
    const lastTriggered = this.#lastTriggeredRepublishAtMs.get(sig) ?? 0;
    const cooldown = 1e4 + Math.floor(Math.random() * 3e3);
    if (now - lastTriggered < cooldown) return;
    this.#lastTriggeredRepublishAtMs.set(sig, now);
    const localSeeds = this.lastLocalSeedsBySig.get(sig) ?? [];
    if (localSeeds.length === 0) return;
    void mesh.publish(29010, sig, {
      seeds: localSeeds,
      publisherId: this.publisherId,
      mode: "snapshot",
      publishedAtMs: now
    }, [["publisher", this.publisherId], ["mode", "snapshot"]]);
    this.#lastRefreshAtMs.set(sig, now);
  };
  addCsvSeeds = (set, raw) => {
    const text = String(raw ?? "").trim();
    if (!text) return;
    const parts = text.split(",");
    for (const part of parts) {
      const seed = String(part ?? "").trim();
      if (seed) set.add(seed);
    }
  };
  readPublisherIdFromEvent = (evt) => {
    const tags = evt?.tags;
    if (!Array.isArray(tags)) return "";
    for (const t of tags) {
      if (!Array.isArray(t) || t.length < 2) continue;
      const k = String(t[0] ?? "").trim().toLowerCase();
      if (k !== "publisher" && k !== "p") continue;
      const v = String(t[1] ?? "").trim();
      if (v) return v;
    }
    return "";
  };
  extractSeedsFromEventContent = (content) => {
    const raw = String(content ?? "").trim();
    if (!raw) return [];
    if (!raw.startsWith("{") && !raw.startsWith("[") && !raw.startsWith('"')) {
      return this.splitCsv(raw);
    }
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "string") return this.splitCsv(parsed);
      if (Array.isArray(parsed)) {
        const out = [];
        for (const x of parsed) out.push(...this.splitCsv(String(x ?? "")));
        return out;
      }
      if (parsed && typeof parsed === "object") {
        const out = [];
        const seeds = parsed.seeds;
        if (Array.isArray(seeds)) {
          for (const x of seeds) out.push(...this.splitCsv(String(x ?? "")));
        }
        const seed = String(parsed.seed ?? "").trim();
        if (seed) out.push(...this.splitCsv(seed));
        return out;
      }
    } catch {
      const seedsMatch = raw.match(/seeds\s*:\s*\[([^\]]*)\]/i);
      if (seedsMatch && seedsMatch[1]) {
        return this.splitCsv(String(seedsMatch[1] ?? ""));
      }
      if (this.looksStructuredContent(raw)) return [];
      return this.splitCsv(raw);
    }
    return [];
  };
  looksStructuredContent = (raw) => {
    const s = String(raw ?? "").trim();
    if (!s) return false;
    return s.startsWith("{") || s.startsWith("[") || s.startsWith('"');
  };
  splitCsv = (raw) => {
    const out = [];
    const parts = String(raw ?? "").split(",");
    for (const part of parts) {
      let seed = String(part ?? "").trim();
      if (seed.startsWith('"') && seed.endsWith('"') && seed.length >= 2) {
        seed = seed.slice(1, -1).trim();
      }
      if (seed.startsWith("'") && seed.endsWith("'") && seed.length >= 2) {
        seed = seed.slice(1, -1).trim();
      }
      if (seed) out.push(seed);
    }
    return out;
  };
  toGrammarSeed = (grammar) => {
    const raw = String(grammar ?? "").trim();
    if (!raw) return "";
    if (raw.startsWith("show-honeycomb:")) return "";
    return raw;
  };
  #renderScheduled = false;
  requestRender = () => {
    if (this.rendering) {
      this.renderQueued = true;
      return;
    }
    if (this.#renderScheduled) return;
    this.#renderScheduled = true;
    queueMicrotask(() => {
      this.#renderScheduled = false;
      if (this.rendering) {
        this.renderQueued = true;
        return;
      }
      this.rendering = true;
      void (async () => {
        try {
          do {
            this.renderQueued = false;
            await this.renderFromSynchronize();
          } while (this.renderQueued);
        } finally {
          this.rendering = false;
        }
      })();
    });
  };
  /** Fast path for move:preview — skips OPFS/mesh/image loading, only rebuilds geometry with reordered labels */
  renderMovePreview = () => {
    const axial = this.resolve("axial");
    if (!axial?.items || !this.cachedSeedNames || !this.cachedLocalSeedSet) {
      this.requestRender();
      return;
    }
    const seedNames = this.cachedSeedNames;
    const localSeedSet = this.cachedLocalSeedSet;
    const branchSet = this.cachedBranchSet ?? /* @__PURE__ */ new Set();
    const axialMax = typeof axial.items.size === "number" ? axial.items.size : seedNames.length;
    const effectiveLen = this.moveNames ? this.moveNames.length : seedNames.length;
    const maxCells = Math.min(effectiveLen, axialMax);
    if (maxCells <= 0) return;
    const cells = this.buildCellsFromAxial(axial, seedNames, maxCells, localSeedSet, branchSet);
    if (cells.length === 0) return;
    for (const cell of cells) {
      if (this.seedImageCache.has(cell.label)) {
        cell.imageSig = this.seedImageCache.get(cell.label) ?? void 0;
      }
    }
    this.renderedCells.clear();
    for (const cell of cells) this.renderedCells.set(cell.label, cell);
    this.suppressCellCount = true;
    void this.applyGeometry(cells).finally(() => {
      this.suppressCellCount = false;
    });
  };
  renderFromSynchronize = async () => {
    this.shader?.setHoveredIndex(-1);
    if (!this.pixiApp || !this.pixiContainer || !this.pixiRenderer) {
      this.clearMesh();
      return;
    }
    const axial = this.resolve("axial");
    if (!axial?.items) {
      this.clearMesh();
      return;
    }
    const lineage = this.resolve("lineage");
    if (!lineage?.explorerDir || !lineage?.explorerLabel || !lineage?.changed) {
      this.clearMesh();
      return;
    }
    const locationKey = String(lineage.explorerLabel?.() ?? "/");
    if (locationKey === this.renderedLocationKey && this.renderedCellsKey !== "" && !this.#clipboardView) {
      return;
    }
    if (locationKey !== this.renderedLocationKey && this.#layerCellsCache.has(locationKey)) {
      const cached = this.#layerCellsCache.get(locationKey);
      if (!this.layer) {
        this.layer = new Container3();
        this.pixiContainer.addChild(this.layer);
        this.atlas = new HexLabelAtlas(this.pixiRenderer, 128, 8, 8);
        this.atlas.setPivot(this.#pivot);
        this.imageAtlas = new HexImageAtlas(this.pixiRenderer, 256, 8, 8);
        this.seedImageCache.clear();
        this.seedBorderColorCache.clear();
        this.atlasRenderer = this.pixiRenderer;
        this.shader = null;
      }
      this.cancelStreamFlag = true;
      this.renderedLocationKey = locationKey;
      this.renderedCellsKey = "";
      this.renderedCells.clear();
      const cachedDir = await lineage.explorerDir();
      if (cachedDir) {
        await this.#applyViewportForLayer(cachedDir);
        const vp = window.ioc?.get?.("@diamondcoreprocessor.com/ViewportPersistence");
        if (vp) vp.setDirSilent(cachedDir);
      }
      for (const cell of cached.cells) this.renderedCells.set(cell.label, cell);
      this.cachedSeedNames = cached.seedNames;
      this.cachedLocalSeedSet = cached.localSeedSet;
      this.cachedBranchSet = cached.branchSet;
      await this.applyGeometry(cached.cells);
      if (this.layer) this.layer.visible = true;
      return;
    }
    if (!this.layer) {
      this.layer = new Container3();
      this.pixiContainer.addChild(this.layer);
      this.atlas = new HexLabelAtlas(this.pixiRenderer, 128, 8, 8);
      this.atlas.setPivot(this.#pivot);
      this.imageAtlas = new HexImageAtlas(this.pixiRenderer, 256, 8, 8);
      this.seedImageCache.clear();
      this.seedBorderColorCache.clear();
      this.atlasRenderer = this.pixiRenderer;
      this.shader = null;
    } else if (!this.atlas || this.atlasRenderer !== this.pixiRenderer) {
      this.atlas = new HexLabelAtlas(this.pixiRenderer, 128, 8, 8);
      this.atlas.setPivot(this.#pivot);
      this.imageAtlas = new HexImageAtlas(this.pixiRenderer, 256, 8, 8);
      this.seedImageCache.clear();
      this.seedBorderColorCache.clear();
      this.atlasRenderer = this.pixiRenderer;
      this.shader = null;
    }
    const fsRev = Number(lineage.changed?.() ?? 0);
    const meshRev = this.meshSeedsRev;
    const isStale = () => {
      const currentKey = String(lineage.explorerLabel?.() ?? "/");
      const currentRev = Number(lineage.changed?.() ?? 0);
      const currentMeshRev = this.meshSeedsRev;
      return currentKey !== locationKey || currentRev !== fsRev || currentMeshRev !== meshRev;
    };
    let dir;
    if (this.#clipboardView) {
      const store = window.ioc?.get?.("@hypercomb.social/Store");
      dir = store?.hypercombRoot ?? null;
      if (dir) {
        for (const seg of this.#clipboardView.sourceSegments) {
          try {
            dir = await dir.getDirectoryHandle(seg, { create: false });
          } catch {
            dir = null;
            break;
          }
        }
      }
    } else {
      dir = await lineage.explorerDir();
      if (isStale()) {
        this.renderQueued = true;
        return;
      }
    }
    if (!dir) {
      console.warn("[show-honeycomb] BAIL: explorerDir returned null");
      this.clearMesh();
      return;
    }
    const localSeeds = await this.listSeedFolders(dir);
    if (isStale()) {
      this.renderQueued = true;
      return;
    }
    const union = /* @__PURE__ */ new Set();
    for (const s of localSeeds) union.add(s);
    for (const s of this.meshSeeds) union.add(s);
    const localSeedSet = new Set(localSeeds);
    const branchSet = /* @__PURE__ */ new Set();
    await Promise.all(localSeeds.map(async (name) => {
      if (await this.checkHasBranch(dir, name)) branchSet.add(name);
    }));
    const historyService = window.ioc?.get?.("@diamondcoreprocessor.com/HistoryService");
    if (!this.#clipboardView && historyService) {
      const sig = await this.computeSignatureLocation(lineage);
      const ops = await historyService.replay(sig.sig);
      const seedState = /* @__PURE__ */ new Map();
      for (const op of ops) seedState.set(op.seed, op.op);
      for (const [seed, lastOp] of seedState) {
        if (lastOp === "remove") union.delete(seed);
      }
    }
    const blockedSet = new Set(JSON.parse(localStorage.getItem(`hc:blocked-tiles:${locationKey}`) ?? "[]"));
    for (const blocked of blockedSet) {
      if (!localSeedSet.has(blocked)) union.delete(blocked);
    }
    const hiddenSet = new Set(JSON.parse(localStorage.getItem(`hc:hidden-tiles:${locationKey}`) ?? "[]"));
    for (const hidden of hiddenSet) {
      if (localSeedSet.has(hidden)) union.delete(hidden);
    }
    if (this.#clipboardView) {
      const clipLabels = this.#clipboardView.labels;
      for (const seed of union) {
        if (!clipLabels.has(seed)) union.delete(seed);
      }
    }
    this.#layoutMode = this.#readLayoutMode(locationKey);
    let seedNames;
    if (this.#layoutMode === "pinned") {
      seedNames = await this.#orderByIndexPinned(dir, Array.from(union), localSeedSet);
      if (this.filterKeyword) {
        const kw = this.filterKeyword;
        seedNames = seedNames.map((s) => s && s.toLowerCase().includes(kw) ? s : "");
      }
    } else {
      const orderProjection = window.ioc?.get?.("@diamondcoreprocessor.com/OrderProjection");
      if (orderProjection) {
        const locSig = await this.computeSignatureLocation(lineage);
        const order = await orderProjection.hydrate(locSig.sig);
        if (order.length > 0) {
          const unionSet = new Set(union);
          seedNames = order.filter((s) => unionSet.has(s));
          for (const s of union) {
            if (!seedNames.includes(s)) seedNames.push(s);
          }
        } else {
          seedNames = await this.#orderByIndex(dir, Array.from(union), localSeedSet);
        }
      } else {
        seedNames = await this.#orderByIndex(dir, Array.from(union), localSeedSet);
      }
      const layout = this.resolve("layout");
      if (layout) {
        const order = await layout.read(dir);
        if (order) seedNames = layout.merge(order, seedNames);
      }
      if (this.filterKeyword) {
        const kw = this.filterKeyword;
        seedNames = seedNames.filter((s) => s.toLowerCase().includes(kw));
      }
    }
    const previousLocationKey = this.renderedLocationKey;
    const layerChanged = locationKey !== previousLocationKey;
    if (this.streamActive && !layerChanged) return;
    if (layerChanged) {
      this.cancelStreamFlag = true;
      this.renderedLocationKey = locationKey;
      this.renderedCellsKey = "";
      this.renderedCells.clear();
      await this.#applyViewportForLayer(dir);
      const vp = window.ioc?.get?.("@diamondcoreprocessor.com/ViewportPersistence");
      if (vp) vp.setDirSilent(dir);
      if (seedNames.length === 0) {
        if (this.layer) this.layer.visible = true;
        this.clearMesh();
        return;
      }
      if (this.layer) this.layer.visible = false;
      this.emitEffect("navigation:guard-start", { locationKey });
      void this.streamSeeds(dir, seedNames, localSeedSet, axial, branchSet);
      return;
    }
    if (seedNames.length === 0) {
      this.clearMesh();
      return;
    }
    const axialMax = typeof axial.items.size === "number" ? axial.items.size : seedNames.length;
    const maxCells = Math.min(seedNames.length, axialMax);
    if (maxCells <= 0) {
      this.clearMesh();
      return;
    }
    const cells = this.buildCellsFromAxial(axial, seedNames, maxCells, localSeedSet, branchSet);
    if (cells.length === 0) {
      this.clearMesh();
      return;
    }
    await this.loadCellImages(cells, dir);
    if (isStale()) {
      this.renderQueued = true;
      return;
    }
    this.cachedSeedNames = seedNames;
    this.cachedLocalSeedSet = localSeedSet;
    this.cachedBranchSet = branchSet;
    this.renderedCells.clear();
    for (const cell of cells) this.renderedCells.set(cell.label, cell);
    await this.applyGeometry(cells);
    this.#layerCellsCache.set(locationKey, { cells: [...cells], seedNames, localSeedSet, branchSet });
  };
  streamSeeds = async (dir, seedNames, localSeedSet, axial, branchSet) => {
    this.streamActive = true;
    this.cancelStreamFlag = false;
    const cells = [];
    for (let index = 0; index < seedNames.length; index++) {
      if (this.cancelStreamFlag) break;
      const label = seedNames[index];
      const axialCell = axial.items.get(index);
      if (!axialCell || !label) continue;
      const cell = {
        q: axialCell.q,
        r: axialCell.r,
        label,
        external: !localSeedSet.has(label),
        hasBranch: branchSet?.has(label) ?? false
      };
      await this.loadCellImages([cell], dir);
      if (this.cancelStreamFlag) break;
      cells.push(cell);
      this.renderedCells.set(label, cell);
      const isLastSeed = index === seedNames.length - 1;
      if (cells.length % _ShowHoneycombWorker.STREAM_BATCH_SIZE === 0 || isLastSeed) {
        await this.applyGeometry(cells, isLastSeed);
      }
      await this.microDelay();
    }
    if (!this.cancelStreamFlag && this.layer) this.layer.visible = true;
    this.streamActive = false;
    this.emitEffect("navigation:guard-end", {});
    if (!this.cancelStreamFlag && cells.length > 0) {
      const locKey = this.renderedLocationKey;
      this.#layerCellsCache.set(locKey, { cells: [...cells], seedNames, localSeedSet, branchSet: branchSet ?? /* @__PURE__ */ new Set() });
    }
    this.requestRender();
  };
  #applyViewportForLayer = async (dir) => {
    const container = this.pixiContainer;
    const app = this.pixiApp;
    const renderer = this.pixiRenderer;
    if (!container || !app || !renderer) return;
    let snap = {};
    try {
      const fh = await dir.getFileHandle("0000");
      const file = await fh.getFile();
      const props = JSON.parse(await file.text());
      snap = props.viewport ?? {};
    } catch {
    }
    const s = renderer.screen;
    if (snap.zoom) {
      container.scale.set(snap.zoom.scale);
      container.position.set(snap.zoom.cx, snap.zoom.cy);
    } else {
      container.scale.set(1);
      container.position.set(0, 0);
    }
    if (snap.pan) {
      app.stage.position.set(s.width * 0.5 + snap.pan.dx, s.height * 0.5 + snap.pan.dy);
    } else {
      app.stage.position.set(s.width * 0.5, s.height * 0.5);
    }
  };
  applyGeometry = async (cells, final = true) => {
    if (cells.length === 0) {
      this.clearMesh();
      return;
    }
    const { circumRadiusPx, gapPx, padPx } = this.#hexGeo;
    const nextCellsKey = this.buildCellsKey(cells);
    if (nextCellsKey === this.renderedCellsKey && cells.length === this.renderedCount) {
      return;
    }
    const hexHalfW = this.#flat ? circumRadiusPx : Math.sqrt(3) * circumRadiusPx / 2;
    const hexHalfH = this.#flat ? Math.sqrt(3) * circumRadiusPx / 2 : circumRadiusPx;
    const quadHalfW = hexHalfW + padPx;
    const quadHalfH = hexHalfH + padPx;
    const quadW = quadHalfW * 2;
    const quadH = quadHalfH * 2;
    if (!this.atlas || !this.imageAtlas) {
      this.clearMesh();
      return;
    }
    const labelTex = this.atlas.getAtlasTexture();
    const cellImageTex = this.imageAtlas.getAtlasTexture();
    for (const cell of cells) this.atlas.getLabelUV(cell.label);
    const geom = this.buildFillQuadGeometry(cells, circumRadiusPx, gapPx, quadHalfW, quadHalfH);
    if (!this.shader) {
      this.shader = new HexSdfTextureShader(labelTex, cellImageTex, quadW, quadH, circumRadiusPx);
    } else {
      try {
        this.shader.setLabelAtlas(labelTex);
        this.shader.setCellImageAtlas(cellImageTex);
        this.shader.setQuadSize(quadW, quadH);
        this.shader.setRadiusPx(circumRadiusPx);
      } catch {
        this.rebuildRenderResources(this.pixiRenderer);
        this.renderQueued = true;
        return;
      }
    }
    this.shader.setFlat(this.#flat);
    this.shader.setPivot(this.#pivot);
    if (!this.hexMesh) {
      this.hexMesh = new Mesh({ geometry: geom, shader: this.shader.shader, texture: Texture4.WHITE });
      this.hexMesh.blendMode = "pre-multiply";
      this.layer.addChild(this.hexMesh);
    } else {
      if (this.geom) this.geom.destroy(true);
      this.hexMesh.geometry = geom;
      this.hexMesh.shader = this.shader.shader;
    }
    if (this.hexMesh?.getLocalBounds && !this.suppressCellCount) {
      this.hexMesh.position.set(0, 0);
      const bounds = this.hexMesh.getLocalBounds();
      this.hexMesh.position.set(-(bounds.x + bounds.width * 0.5), -(bounds.y + bounds.height * 0.5));
      this.emitEffect("render:mesh-offset", { x: this.hexMesh.position.x, y: this.hexMesh.position.y });
    }
    this.geom = geom;
    this.renderedCellsKey = nextCellsKey;
    this.renderedCount = cells.length;
    this.#axialToIndex.clear();
    for (let i = 0; i < cells.length; i++) {
      this.#axialToIndex.set(`${cells[i].q},${cells[i].r}`, i);
    }
    if (!this.suppressCellCount) {
      this.emitEffect("render:cell-count", {
        count: cells.length,
        labels: cells.map((cell) => cell.label),
        branchLabels: cells.filter((cell) => cell.hasBranch).map((cell) => cell.label),
        externalLabels: cells.filter((cell) => cell.external).map((cell) => cell.label)
      });
    }
  };
  // 1–3ms micro-pause to avoid main-thread blocking (legacy JsonHiveStreamLoader pattern)
  microDelay = () => new Promise((r) => setTimeout(r, 1 + Math.random() * 2));
  ensureListeners = () => {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener("synchronize", this.requestRender);
    window.addEventListener("navigate", this.requestRender);
    this.onEffect("tile:saved", (payload) => {
      if (payload?.seed) {
        const oldSig = this.seedImageCache.get(payload.seed);
        this.seedImageCache.delete(payload.seed);
        this.seedBorderColorCache.delete(payload.seed);
        if (oldSig && this.imageAtlas) {
          this.imageAtlas.invalidate(oldSig);
        }
      }
      this.#layerCellsCache.delete(this.renderedLocationKey);
      this.renderedCellsKey = "";
      this.requestRender();
    });
    this.onEffect("seed:added", () => {
      this.#layerCellsCache.delete(this.renderedLocationKey);
      this.renderedCellsKey = "";
    });
    this.onEffect("seed:removed", () => {
      this.#layerCellsCache.delete(this.renderedLocationKey);
      this.renderedCellsKey = "";
    });
    this.onEffect("search:filter", ({ keyword }) => {
      this.filterKeyword = String(keyword ?? "").trim().toLowerCase();
      this.requestRender();
    });
    this.onEffect("move:preview", (payload) => {
      this.moveNames = payload?.names ?? null;
      this.renderedCellsKey = "";
      if (payload && this.cachedSeedNames) {
        this.renderMovePreview();
      } else {
        this.requestRender();
      }
    });
    this.onEffect("render:host-ready", (payload) => {
      this.pixiApp = payload.app;
      this.pixiContainer = payload.container;
      this.pixiRenderer = payload.renderer;
      this.requestRender();
    });
    this.onEffect("render:set-orientation", (payload) => {
      if (this.#flat !== payload.flat) {
        this.#flat = payload.flat;
        this.seedImageCache.clear();
        this.#layerCellsCache.clear();
        this.renderedCellsKey = "";
        this.requestRender();
      }
    });
    this.onEffect("mesh:room", ({ room }) => {
      if (this.#space !== room) {
        this.#space = room;
        this.renderedLocationKey = "";
        this.requestRender();
      }
    });
    this.onEffect("mesh:secret", ({ secret }) => {
      if (this.#secret !== secret) {
        this.#secret = secret;
        this.renderedLocationKey = "";
        this.requestRender();
      }
    });
    this.onEffect("clipboard:view", (payload) => {
      if (payload?.active && payload.labels) {
        this.#clipboardView = {
          labels: new Set(payload.labels),
          sourceSegments: payload.sourceSegments ?? []
        };
      } else {
        this.#clipboardView = null;
      }
      this.requestRender();
    });
    this.onEffect("clipboard:captured", (payload) => {
      if (!payload?.labels?.length) return;
      if (payload.op === "copy") {
        if (this.#flashTimer) clearTimeout(this.#flashTimer);
        this.#flashLabels = new Set(payload.labels);
        for (const label of payload.labels) this.#heatByLabel.set(label, 1);
        this.renderedCellsKey = "";
        this.requestRender();
        this.#flashTimer = setTimeout(() => {
          for (const label of this.#flashLabels) this.#heatByLabel.delete(label);
          this.#flashLabels.clear();
          this.#flashTimer = null;
          this.renderedCellsKey = "";
          this.requestRender();
        }, 600);
      }
    });
    const roomStore = get("@hypercomb.social/RoomStore");
    const secretStore = get("@hypercomb.social/SecretStore");
    if (roomStore?.value && this.#space !== roomStore.value) {
      this.#space = roomStore.value;
      this.renderedLocationKey = "";
    }
    if (secretStore?.value && this.#secret !== secretStore.value) {
      this.#secret = secretStore.value;
      this.renderedLocationKey = "";
    }
    this.onEffect("mesh:public-changed", ({ public: isPublic }) => {
      if (!isPublic) {
        this.meshSeeds = [];
        this.meshSeedsRev++;
      }
      this.#layerCellsCache.clear();
      this.renderedCellsKey = "";
      this.requestRender();
    });
    this.onEffect("render:set-pivot", (payload) => {
      if (this.#pivot !== payload.pivot) {
        this.#pivot = payload.pivot;
        this.seedImageCache.clear();
        this.#layerCellsCache.clear();
        this.atlas?.setPivot(payload.pivot);
        this.renderedCellsKey = "";
        this.requestRender();
      }
    });
    this.onEffect("render:set-text-only", (payload) => {
      if (this.#textOnly !== payload.textOnly) {
        this.#textOnly = payload.textOnly;
        this.renderedCellsKey = "";
        this.requestRender();
      }
    });
    this.onEffect("seed:place-at", (payload) => {
      void this.#handlePlaceAt(payload.seed, payload.index);
    });
    this.onEffect("seed:reorder", (payload) => {
      void this.#handleReorder(payload.labels);
    });
    this.onEffect("layout:mode", (payload) => {
      if (payload?.mode && payload.mode !== this.#layoutMode) {
        this.#layoutMode = payload.mode;
        this.#persistLayoutMode(payload.mode);
        this.#layerCellsCache.clear();
        this.renderedCellsKey = "";
        this.requestRender();
      }
    });
    this.onEffect("render:set-gap", (payload) => {
      if (this.#hexGeo.gapPx !== payload.gapPx) {
        this.#hexGeo = createHexGeometry(this.#hexGeo.circumRadiusPx, payload.gapPx, this.#hexGeo.padPx);
        this.emitEffect("render:geometry-changed", this.#hexGeo);
        this.renderedCellsKey = "";
        this.requestRender();
      }
    });
    this.onEffect("tile:hover", (payload) => {
      if (!this.shader) return;
      const idx = this.#axialToIndex.get(`${payload.q},${payload.r}`);
      this.shader.setHoveredIndex(idx ?? -1);
    });
    window.showCellsPoc = {
      publishSeeds: async (seeds) => this.publishExplicitSeedList(seeds),
      signature: async () => {
        const lineage = this.resolve("lineage");
        return await this.computeSignatureLocation(lineage);
      }
    };
  };
  dispose = () => {
    window.removeEventListener("synchronize", this.requestRender);
    window.removeEventListener("navigate", this.requestRender);
    if (this.lineageChangeListening) {
      const lineage = this.resolve("lineage");
      lineage?.removeEventListener("change", this.onLineageChange);
      this.lineageChangeListening = false;
    }
  };
  clearMesh = () => {
    if (this.hexMesh && this.layer) {
      try {
        this.layer.removeChild(this.hexMesh);
      } catch {
      }
      try {
        this.hexMesh.destroy?.(true);
      } catch {
      }
    }
    if (this.geom) {
      try {
        this.geom.destroy(true);
      } catch {
      }
    }
    this.hexMesh = null;
    this.geom = null;
    this.renderedCellsKey = "";
    this.renderedCount = 0;
    this.renderedCells.clear();
    this.cachedSeedNames = null;
    this.cachedLocalSeedSet = null;
    this.cachedBranchSet = null;
    this.emitEffect("render:cell-count", { count: 0, labels: [] });
  };
  rebuildRenderResources = (renderer) => {
    this.clearMesh();
    this.shader = null;
    this.atlas = new HexLabelAtlas(renderer, 128, 8, 8);
    this.imageAtlas = new HexImageAtlas(renderer, 256, 8, 8);
    this.seedImageCache.clear();
    this.atlasRenderer = renderer;
  };
  listSeedFolders = async (dir) => {
    const out = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "directory") continue;
      if (!name) continue;
      if (name === "__dependencies__") continue;
      if (name === "__bees__") continue;
      if (name === "__layers__") continue;
      if (name === "__location__") continue;
      if (name.startsWith("__") && name.endsWith("__")) continue;
      out.push(name);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  };
  #layoutModeKey(locationKey) {
    return `hc:layout-mode:${locationKey}`;
  }
  #readLayoutMode(locationKey) {
    const stored = localStorage.getItem(this.#layoutModeKey(locationKey));
    return stored === "pinned" ? "pinned" : "dense";
  }
  #persistLayoutMode(mode) {
    const lineage = this.resolve("lineage");
    const locationKey = String(lineage?.explorerLabel?.() ?? "/");
    localStorage.setItem(this.#layoutModeKey(locationKey), mode);
  }
  async #orderByIndexPinned(dir, names, localSeedSet) {
    const axial = this.resolve("axial");
    const maxSlot = axial?.count ?? 60;
    const sparse = new Array(maxSlot + 1).fill("");
    let nextFree = 0;
    const unindexed = [];
    for (const name of names) {
      if (!localSeedSet.has(name)) {
        unindexed.push(name);
        continue;
      }
      try {
        const seedDir = await dir.getDirectoryHandle(name, { create: false });
        const props = await readSeedProperties(seedDir);
        if (typeof props["index"] === "number") {
          const idx = props["index"];
          if (idx >= 0 && idx <= maxSlot) {
            sparse[idx] = name;
          } else {
            unindexed.push(name);
          }
        } else {
          unindexed.push(name);
        }
      } catch {
        unindexed.push(name);
      }
    }
    for (const name of unindexed) {
      while (nextFree <= maxSlot && sparse[nextFree] !== "") nextFree++;
      if (nextFree <= maxSlot) {
        sparse[nextFree] = name;
        if (localSeedSet.has(name)) {
          try {
            const seedDir = await dir.getDirectoryHandle(name, { create: false });
            await writeSeedProperties(seedDir, { index: nextFree, offset: 0 });
          } catch {
          }
        }
        nextFree++;
      }
    }
    return sparse;
  }
  /**
   * Order seeds by their persisted index in the 0000 properties file.
   * Seeds without an index get the next available index and are written back.
   * External (mesh) seeds are always re-indexed locally.
   */
  async #orderByIndex(dir, names, localSeedSet) {
    const indexed = [];
    const unindexed = [];
    let maxIndex = -1;
    for (const name of names) {
      if (!localSeedSet.has(name)) {
        unindexed.push(name);
        continue;
      }
      try {
        const seedDir = await dir.getDirectoryHandle(name, { create: false });
        const props = await readSeedProperties(seedDir);
        if (typeof props["index"] === "number") {
          const idx = props["index"];
          const off = typeof props["offset"] === "number" ? props["offset"] : 0;
          indexed.push({ name, position: idx + off });
          if (idx > maxIndex) maxIndex = idx;
        } else {
          unindexed.push(name);
        }
      } catch {
        unindexed.push(name);
      }
    }
    indexed.sort((a, b) => a.position - b.position);
    let nextIndex = maxIndex + 1;
    if (indexed.length === 0) {
      unindexed.sort((a, b) => a.localeCompare(b));
    }
    for (const name of unindexed) {
      const assignedIndex = nextIndex++;
      indexed.push({ name, position: assignedIndex });
      if (localSeedSet.has(name)) {
        try {
          const seedDir = await dir.getDirectoryHandle(name, { create: false });
          await writeSeedProperties(seedDir, { index: assignedIndex, offset: 0 });
        } catch {
        }
      }
    }
    indexed.sort((a, b) => a.position - b.position);
    return indexed.map((s) => s.name);
  }
  async #handlePlaceAt(seed, targetIndex) {
    const lineage = this.resolve("lineage");
    if (!lineage) return;
    const dir = await lineage.explorerDir();
    if (!dir) return;
    const localSeeds = await this.listSeedFolders(dir);
    const entries = [];
    for (const name of localSeeds) {
      try {
        const seedDir = await dir.getDirectoryHandle(name, { create: false });
        const props = await readSeedProperties(seedDir);
        entries.push({ name, index: typeof props["index"] === "number" ? props["index"] : entries.length });
      } catch {
        entries.push({ name, index: entries.length });
      }
    }
    entries.sort((a, b) => a.index - b.index);
    const names = entries.map((e) => e.name).filter((n) => n !== seed);
    const clamped = Math.max(0, Math.min(targetIndex, names.length));
    names.splice(clamped, 0, seed);
    await this.#writeIndices(dir, names);
    this.requestRender();
  }
  async #handleReorder(labels) {
    const lineage = this.resolve("lineage");
    if (!lineage) return;
    const dir = await lineage.explorerDir();
    if (!dir) return;
    await this.#writeIndices(dir, labels);
    this.requestRender();
  }
  async #writeIndices(dir, orderedNames) {
    let maxIndex = -1;
    const existingIndices = /* @__PURE__ */ new Map();
    for (const name of orderedNames) {
      try {
        const seedDir = await dir.getDirectoryHandle(name, { create: false });
        const props = await readSeedProperties(seedDir);
        if (typeof props["index"] === "number") {
          existingIndices.set(name, props["index"]);
          if (props["index"] > maxIndex) maxIndex = props["index"];
        }
      } catch {
      }
    }
    for (let i = 0; i < orderedNames.length; i++) {
      const name = orderedNames[i];
      let permanentIndex = existingIndices.get(name);
      if (permanentIndex === void 0) {
        permanentIndex = ++maxIndex;
      }
      const offset = i - permanentIndex;
      try {
        const seedDir = await dir.getDirectoryHandle(name, { create: false });
        await writeSeedProperties(seedDir, { index: permanentIndex, offset });
      } catch {
      }
    }
  }
  checkHasBranch = async (parentDir, seedName) => {
    try {
      const seedDir = await parentDir.getDirectoryHandle(seedName, { create: false });
      for await (const [name, handle] of seedDir.entries()) {
        if (handle.kind === "directory" && !name.startsWith("__")) return true;
      }
    } catch {
    }
    return false;
  };
  buildCellsFromAxial = (axial, names, max, localSeedSet, branchSet) => {
    const out = [];
    const effectiveNames = this.moveNames ?? names;
    for (let i = 0; i < max; i++) {
      const a = axial.items.get(i);
      const label = effectiveNames[i] ?? names[i];
      if (!a) break;
      if (!label) continue;
      out.push({ q: a.q, r: a.r, label, external: !localSeedSet.has(label), heat: this.#heatByLabel.get(label) ?? 0, hasBranch: branchSet?.has(label) ?? false });
    }
    return out;
  };
  /**
   * Load cell properties from the content-addressed tile-props index
   * and resolve the small.image signature from __resources__/ into the image atlas.
   * Standard: any property value matching a 64-char hex signature
   * refers to a blob in __resources__/{signature}.
   */
  loadCellImages = async (cells, _dir) => {
    const store = window.ioc?.get?.("@hypercomb.social/Store");
    if (!store || !this.imageAtlas) return;
    const propsIndex = JSON.parse(localStorage.getItem("hc:tile-props-index") ?? "{}");
    for (const cell of cells) {
      if (cell.external) continue;
      if (this.seedImageCache.has(cell.label)) {
        cell.imageSig = this.seedImageCache.get(cell.label) ?? void 0;
        cell.borderColor = this.seedBorderColorCache.get(cell.label);
        continue;
      }
      try {
        const propsSig = propsIndex[cell.label];
        if (!propsSig) throw new Error("no props");
        const blob = await store.getResource(propsSig);
        if (!blob) throw new Error("no blob");
        const text = await blob.text();
        const props = JSON.parse(text);
        const bc = props?.border?.color;
        if (bc && typeof bc === "string" && /^#?[0-9a-fA-F]{6}$/.test(bc.replace("#", ""))) {
          const hex = bc.startsWith("#") ? bc : `#${bc}`;
          const r = parseInt(hex.slice(1, 3), 16) / 255;
          const g = parseInt(hex.slice(3, 5), 16) / 255;
          const b = parseInt(hex.slice(5, 7), 16) / 255;
          cell.borderColor = [r, g, b];
          this.seedBorderColorCache.set(cell.label, [r, g, b]);
        }
        const effectiveFlat = this.#pivot ? !this.#flat : this.#flat;
        const smallSig = effectiveFlat && props?.flat?.small?.image || props?.small?.image;
        if (smallSig && isSignature(smallSig)) {
          cell.imageSig = smallSig;
          this.seedImageCache.set(cell.label, smallSig);
          if (!this.imageAtlas.hasImage(smallSig)) {
            const blob2 = await store.getResource(smallSig);
            if (blob2) {
              await this.imageAtlas.loadImage(smallSig, blob2);
            }
          }
        } else {
          this.seedImageCache.set(cell.label, null);
        }
      } catch {
        this.seedImageCache.set(cell.label, null);
      }
    }
  };
  buildCellsKey = (cells) => {
    const selectionService = window.ioc?.get?.("@diamondcoreprocessor.com/SelectionService");
    let s = `p${this.#pivot ? 1 : 0}f${this.#flat ? 1 : 0}|`;
    for (const c of cells) s += `${c.q},${c.r}:${c.label}:${c.external ? 1 : 0}:${c.imageSig ?? ""}:${c.hasBranch ? 1 : 0}|`;
    return s;
  };
  axialToPixel = (q, r, s, flat = false) => flat ? { x: 1.5 * s * q, y: Math.sqrt(3) * s * (r + q / 2) } : { x: Math.sqrt(3) * s * (q + r / 2), y: s * 1.5 * r };
  buildFillQuadGeometry(cells, r, gap, hw, hh) {
    const spacing = r + gap;
    const selectionService = window.ioc?.get?.("@diamondcoreprocessor.com/SelectionService");
    const pos = new Float32Array(cells.length * 8);
    const uv = new Float32Array(cells.length * 8);
    const labelUV = new Float32Array(cells.length * 16);
    const imageUV = new Float32Array(cells.length * 16);
    const hasImage = new Float32Array(cells.length * 4);
    const heat = new Float32Array(cells.length * 4);
    const identityColor = new Float32Array(cells.length * 12);
    const branch = new Float32Array(cells.length * 4);
    const borderColor = new Float32Array(cells.length * 12);
    const cellIndex = new Float32Array(cells.length * 4);
    const idx = new Uint32Array(cells.length * 6);
    let pv = 0, uvp = 0, luvp = 0, iuvp = 0, hip = 0, hp = 0, icp = 0, bp = 0, bcp = 0, cip = 0, ii = 0, base = 0;
    let ci = 0;
    for (const c of cells) {
      const { x, y } = this.axialToPixel(c.q, c.r, spacing, this.#flat);
      const x0 = x - hw, x1 = x + hw;
      const y0 = y - hh, y1 = y + hh;
      pos.set([x0, y0, x1, y0, x1, y1, x0, y1], pv);
      pv += 8;
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], uvp);
      uvp += 8;
      const ruv = this.atlas.getLabelUV(c.label);
      for (let i = 0; i < 4; i++) {
        labelUV.set([ruv.u0, ruv.v0, ruv.u1, ruv.v1], luvp);
        luvp += 4;
      }
      const imgUV = !this.#textOnly && c.imageSig ? this.imageAtlas?.getImageUV(c.imageSig) ?? null : null;
      const hi = imgUV ? 1 : 0;
      for (let i = 0; i < 4; i++) {
        imageUV.set(imgUV ? [imgUV.u0, imgUV.v0, imgUV.u1, imgUV.v1] : [0, 0, 0, 0], iuvp);
        iuvp += 4;
      }
      hasImage.set([hi, hi, hi, hi], hip);
      hip += 4;
      const h = c.heat ?? 0;
      heat.set([h, h, h, h], hp);
      hp += 4;
      const [cr, cg, cb] = labelToRgb(c.label);
      identityColor.set([cr, cg, cb, cr, cg, cb, cr, cg, cb, cr, cg, cb], icp);
      icp += 12;
      const b = c.hasBranch ? 1 : 0;
      branch.set([b, b, b, b], bp);
      bp += 4;
      const [bcr, bcg, bcb] = c.borderColor ?? [0.784, 0.592, 0.353];
      borderColor.set([bcr, bcg, bcb, bcr, bcg, bcb, bcr, bcg, bcb, bcr, bcg, bcb], bcp);
      bcp += 12;
      cellIndex.set([ci, ci, ci, ci], cip);
      cip += 4;
      ci++;
      idx.set([base, base + 1, base + 2, base, base + 2, base + 3], ii);
      ii += 6;
      base += 4;
    }
    const g = new Geometry();
    g.addAttribute("aPosition", pos, 2);
    g.addAttribute("aUV", uv, 2);
    g.addAttribute("aLabelUV", labelUV, 4);
    g.addAttribute("aImageUV", imageUV, 4);
    g.addAttribute("aHasImage", hasImage, 1);
    g.addAttribute("aHeat", heat, 1);
    g.addAttribute("aIdentityColor", identityColor, 3);
    g.addAttribute("aHasBranch", branch, 1);
    g.addAttribute("aBorderColor", borderColor, 3);
    g.addAttribute("aCellIndex", cellIndex, 1);
    g.addIndex(idx);
    return g;
  }
};
var _showHoneycomb = new ShowHoneycombWorker();
window.ioc.register("@diamondcoreprocessor.com/ShowHoneycombWorker", _showHoneycomb);
export {
  ShowHoneycombWorker
};
