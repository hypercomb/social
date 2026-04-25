// src/diamondcoreprocessor.com/presentation/tiles/show-cell.drone.ts
import { Drone, SignatureService, I18N_IOC_KEY } from "@hypercomb/core";
import { Container as Container3, Geometry, Mesh, Texture as Texture4 } from "pixi.js";

// src/diamondcoreprocessor.com/presentation/grid/hex-label.atlas.ts
import { Container, RenderTexture, Text, TextStyle } from "pixi.js";
var HexLabelAtlas = class {
  constructor(renderer, cellPx = 128, cols = 8, rows = 8) {
    this.renderer = renderer;
    this.cellPx = cellPx;
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    this.slotToLabel = new Array(this.cols * this.rows).fill(null);
    this.atlas = RenderTexture.create({
      width: this.cols * this.cellPx,
      height: this.rows * this.cellPx,
      resolution: 8
    });
    this.renderer.render({ container: new Container(), target: this.atlas, clear: true });
    const hcFont = getComputedStyle(document.documentElement).getPropertyValue("--hc-font").trim();
    this.style = new TextStyle({
      fontFamily: hcFont || "'Source Sans Pro Light', system-ui, sans-serif",
      fontSize: 9,
      fill: 16777215,
      align: "center",
      letterSpacing: 0.5,
      dropShadow: {
        alpha: 0.35,
        angle: Math.PI / 2,
        blur: 1,
        color: 0,
        distance: 1
      }
    });
  }
  atlas;
  map = /* @__PURE__ */ new Map();
  // Parallel array tracking which label currently owns each slot.
  // Same invariant as HexImageAtlas: when the allocator wraps, the
  // slot's pixels are overwritten, so the previous label's UV entry
  // must be evicted in the same step or `getLabelUV(oldLabel)` will
  // return pixels belonging to a different label.
  slotToLabel;
  nextIndex = 0;
  #pivot = false;
  #labelResolver = null;
  cols;
  rows;
  style;
  setPivot = (pivot) => {
    if (this.#pivot === pivot) return;
    this.#pivot = pivot;
    this.map.clear();
    this.slotToLabel.fill(null);
    this.nextIndex = 0;
    this.renderer.render({ container: new Container(), target: this.atlas, clear: true });
  };
  /**
   * Set a function that resolves directory names to display labels.
   * When set, getLabelUV will render the resolved text instead of the raw directory name.
   */
  setLabelResolver = (resolver) => {
    this.#labelResolver = resolver;
  };
  /**
   * Flush the entire label cache — all labels will re-render on next getLabelUV call.
   * Call this when the locale changes so labels re-resolve through the label resolver.
   */
  invalidateLabels = () => {
    this.map.clear();
    this.slotToLabel.fill(null);
    this.nextIndex = 0;
    this.renderer.render({ container: new Container(), target: this.atlas, clear: true });
  };
  getAtlasTexture = () => {
    return this.atlas;
  };
  /**
   * Pre-rasterize a batch of labels into the atlas in a single render pass.
   * Idempotent — labels already in the cache are skipped. Call after
   * construction with the set of labels you know will appear on first paint,
   * so `getLabelUV()` never rasterizes on the render-hot path.
   */
  seed = (labels) => {
    if (!labels.length) return;
    const batch = new Container();
    const created = [];
    for (const label of labels) {
      if (!label || this.map.has(label)) continue;
      const slot = this.nextIndex % (this.cols * this.rows);
      this.nextIndex++;
      const previous = this.slotToLabel[slot];
      if (previous !== null && previous !== label) this.map.delete(previous);
      this.slotToLabel[slot] = label;
      const col = slot % this.cols;
      const row = Math.floor(slot / this.cols);
      const displayText = this.#labelResolver ? this.#labelResolver(label) : label;
      const text = new Text({ text: displayText, style: this.style });
      text.resolution = 8;
      text.anchor.set(0.5);
      text.position.set(
        col * this.cellPx + this.cellPx * 0.5,
        row * this.cellPx + this.cellPx * 0.5
      );
      if (this.#pivot) text.rotation = Math.PI / 2;
      batch.addChild(text);
      created.push(text);
      const u0 = col * this.cellPx / this.atlas.width;
      const v0 = row * this.cellPx / this.atlas.height;
      const u1 = (col + 1) * this.cellPx / this.atlas.width;
      const v1 = (row + 1) * this.cellPx / this.atlas.height;
      this.map.set(label, { u0, v0, u1, v1 });
    }
    if (!created.length) return;
    this.renderer.render({ container: batch, target: this.atlas, clear: false });
    for (const text of created) text.destroy();
  };
  getLabelUV = (label) => {
    const cached = this.map.get(label);
    if (cached) return cached;
    const slot = this.nextIndex % (this.cols * this.rows);
    this.nextIndex++;
    const previous = this.slotToLabel[slot];
    if (previous !== null && previous !== label) this.map.delete(previous);
    this.slotToLabel[slot] = label;
    const col = slot % this.cols;
    const row = Math.floor(slot / this.cols);
    const displayText = this.#labelResolver ? this.#labelResolver(label) : label;
    const text = new Text({ text: displayText, style: this.style });
    text.resolution = 8;
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
var HexImageAtlas = class _HexImageAtlas {
  #atlas;
  #map = /* @__PURE__ */ new Map();
  #failures = /* @__PURE__ */ new Map();
  // Parallel array tracking which signature currently occupies each
  // slot. When the monotonic allocator wraps, the slot's pixels are
  // overwritten by a new image — we must evict the old signature's
  // `#map` entry at the same moment, or `getImageUV(oldSig)` will
  // return a UV pointing at the new content and the shader will
  // render garbage. Keeping #map and #slotToSig in lockstep is the
  // load-bearing invariant of this atlas.
  #slotToSig;
  #nextSlot = 0;
  // Monotonic counter incremented every time a slot is reused — that is,
  // every time an existing sig's map entry is evicted because its slot
  // is being overwritten with different content. Callers (the geometry
  // builder) fold this into their cache key so they know to rebuild
  // attribute buffers whose baked UVs might point at a slot that now
  // holds a different image. New loads into fresh slots do NOT bump
  // this — they can't invalidate any previously-issued UV.
  #evictionGeneration = 0;
  #cols;
  #rows;
  #cellPx;
  #renderer;
  static MAX_RETRIES = 3;
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
    this.#slotToSig = new Array(this.#cols * this.#rows).fill(null);
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
  /**
   * Monotonic counter of eviction events — how many times a slot has
   * been reused with different content, invalidating previously-issued
   * UVs for the displaced signature. Consumers that bake UVs into
   * buffers should include this in their buffer-cache key so a
   * generation change forces a rebuild.
   */
  get evictionGeneration() {
    return this.#evictionGeneration;
  }
  /** Returns true if the signature has permanently failed loading (exceeded max retries). */
  hasFailed(sig) {
    return (this.#failures.get(sig) ?? 0) >= _HexImageAtlas.MAX_RETRIES;
  }
  /** Clear failure count for a signature so it can be retried (e.g. after re-save). */
  clearFailure(sig) {
    this.#failures.delete(sig);
  }
  async loadImage(sig, blob) {
    const existing = this.#map.get(sig);
    if (existing) return existing;
    if (this.hasFailed(sig)) return null;
    const slot = this.#nextSlot % (this.#cols * this.#rows);
    this.#nextSlot++;
    const previous = this.#slotToSig[slot];
    if (previous !== null && previous !== sig) {
      this.#map.delete(previous);
      this.#evictionGeneration++;
    }
    const col = slot % this.#cols;
    const row = Math.floor(slot / this.#cols);
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      this.#failures.set(sig, (this.#failures.get(sig) ?? 0) + 1);
      console.warn(`[HexImageAtlas] createImageBitmap failed for ${sig.slice(0, 12)}\u2026 (attempt ${this.#failures.get(sig)}/${_HexImageAtlas.MAX_RETRIES})`);
      return null;
    }
    let texture;
    try {
      texture = Texture2.from(bitmap);
    } catch {
      bitmap.close();
      this.#failures.set(sig, (this.#failures.get(sig) ?? 0) + 1);
      console.warn(`[HexImageAtlas] Texture.from failed for ${sig.slice(0, 12)}\u2026 (attempt ${this.#failures.get(sig)}/${_HexImageAtlas.MAX_RETRIES})`);
      return null;
    }
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
    this.#slotToSig[slot] = sig;
    return uv;
  }
  /** Remove a specific entry (e.g. after re-save) so next load picks up the new image */
  invalidate(sig) {
    this.#map.delete(sig);
    this.#failures.delete(sig);
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
      u_hoveredIndex: { value: -1, type: "f32" },
      u_labelMix: { value: 1, type: "f32" },
      u_imageMix: { value: 1, type: "f32" },
      u_accentColor: { value: [0.4, 0.85, 1], type: "vec3<f32>" }
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
  setLabelMix = (mix) => {
    this.#ug.uniforms.u_labelMix = mix;
    this.#ug.update();
  };
  setImageMix = (mix) => {
    this.#ug.uniforms.u_imageMix = mix;
    this.#ug.update();
  };
  setAccentColor = (r, g, b) => {
    const v = this.#ug.uniforms.u_accentColor;
    v[0] = r;
    v[1] = g;
    v[2] = b;
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
    in float aDivergence;

    out vec2 vUV;
    out vec4 vLabelUV;
    out vec4 vImageUV;
    out float vHasImage;
    out float vHeat;
    out vec3 vIdentityColor;
    out float vHasBranch;
    out vec3 vBorderColor;
    out float vCellIndex;
    out float vDivergence;

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
      vDivergence = aDivergence;
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
    in float vDivergence;

    uniform vec2 u_quadSize;
    uniform float u_radiusPx;
    uniform float u_flat;
    uniform float u_pivot;
    uniform float u_hoveredIndex;
    uniform float u_labelMix;
    uniform float u_imageMix;
    uniform vec3 u_accentColor;

    uniform sampler2D u_label;
    uniform sampler2D u_cellImages;

    // \u2500\u2500 light direction (top-left, 10 o'clock) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const vec2 LIGHT_DIR = normalize(vec2(-0.5, -0.866));

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

      // normalized distance from center (0 at center, 1 at edge)
      float dist = length(local) / u_radiusPx;

      // bevel: directional lighting based on surface normal at edge
      vec2 edgeNormal = normalize(rotated);
      float bevelDot = dot(edgeNormal, LIGHT_DIR);
      float edgeProximity = 1.0 - smoothstep(0.0, -aa * 4.0, d);

      vec4 base;

      // effective image blend factor: 0 = empty tile look, 1 = full image
      float imgBlend = vHasImage > 0.5 ? u_imageMix : 0.0;

      // empty-tile base (always computed for blending during fade)
      vec3 bgCenter = vec3(0.06, 0.14, 0.22);
      vec3 bgEdge   = vec3(0.03, 0.08, 0.13);
      vec3 bgColor  = mix(bgCenter, bgEdge, smoothstep(0.0, 1.0, dist));
      vec4 emptyBase = vec4(bgColor, 1.0);
      float outerRingE = 1.0 - smoothstep(0.0, aa * 1.2, abs(d));
      emptyBase.rgb = mix(emptyBase.rgb, vBorderColor, outerRingE * 0.6);
      float innerGlowE = 1.0 - smoothstep(0.0, aa * 3.5, abs(d + aa * 1.5));
      emptyBase.rgb = mix(emptyBase.rgb, vBorderColor, innerGlowE * 0.15);
      float innerMask = smoothstep(0.0, -2.0, d);
      emptyBase.rgb = mix(emptyBase.rgb, vIdentityColor, innerMask * 0.06);

      if (imgBlend > 0.001) {
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
        vec4 imgBase = texture2D(u_cellImages, imgUV);

        // vignette: darken image edges so snapshots blend into border
        float vignette = smoothstep(0.5, 1.0, dist);
        imgBase.rgb *= 1.0 - vignette * 0.45;

        // outer border ring \u2014 crisp bright line
        float outerRing = 1.0 - smoothstep(0.0, aa * 1.2, abs(d));
        imgBase.rgb = mix(imgBase.rgb, vBorderColor, outerRing * 0.6);

        // inner glow border \u2014 wider, softer
        float innerGlow = 1.0 - smoothstep(0.0, aa * 3.5, abs(d + aa * 1.5));
        imgBase.rgb = mix(imgBase.rgb, vBorderColor, innerGlow * 0.12);

        // blend between empty and image based on imageMix
        base = mix(emptyBase, imgBase, imgBlend);
      } else {
        base = emptyBase;
      }

      // bevel highlight (top-left light) and shadow (bottom-right)
      float highlightStrength = max(bevelDot, 0.0) * edgeProximity * 0.06;
      float shadowStrength = max(-bevelDot, 0.0) * edgeProximity * 0.08;
      base.rgb += vec3(1.0) * highlightStrength;
      base.rgb -= vec3(1.0) * shadowStrength;

      vec4 color = base;

      // label text \u2014 always rendered
      vec2 luv = mix(vLabelUV.xy, vLabelUV.zw, vUV);
      float labelAlpha = texture2D(u_label, luv).a;
      float la = smoothstep(0.02, 0.5, labelAlpha);

      if (imgBlend < 0.001) {
        // no image: bright white label
        color = mix(color, vec4(1.0, 1.0, 1.0, 1.0), la * 0.92 * u_labelMix);

        // ambient presence \u2014 identity color at rest, shifts to warm amber with heat
        float heatRing = smoothstep(0.0, -1.5, d) - smoothstep(-4.0, -6.0, d);
        vec3 warmColor = vec3(1.0, 0.62, 0.12);
        vec3 heatTint = mix(vIdentityColor, warmColor, vHeat);
        float heatAlpha = mix(0.07, 0.68, vHeat);
        color.rgb = mix(color.rgb, heatTint, heatRing * heatAlpha);
      } else if (imgBlend > 0.999) {
        // fully visible image: translucent rounded-rect pill behind label text
        float pillW = u_radiusPx * 0.88;
        float pillH = u_radiusPx * 0.15;
        float pillR = 0.0;
        vec2 pillP = abs(local) - vec2(pillW - pillR, pillH - pillR);
        float pillD = length(max(pillP, 0.0)) + min(max(pillP.x, pillP.y), 0.0) - pillR;
        float pillMask = 1.0 - smoothstep(0.0, aa * 1.5, pillD);
        color.rgb = mix(color.rgb, vec3(0.0), pillMask * 0.55 * u_labelMix);

        color = mix(color, vec4(1.0, 1.0, 1.0, 1.0), la * 0.88 * u_labelMix);
      } else {
        // fading in: crossfade label styles
        // empty-style label
        vec4 emptyLabel = mix(color, vec4(1.0, 1.0, 1.0, 1.0), la * 0.92 * u_labelMix);
        float heatRing = smoothstep(0.0, -1.5, d) - smoothstep(-4.0, -6.0, d);
        vec3 warmColor = vec3(1.0, 0.62, 0.12);
        vec3 heatTint = mix(vIdentityColor, warmColor, vHeat);
        float heatAlpha = mix(0.07, 0.68, vHeat);
        emptyLabel.rgb = mix(emptyLabel.rgb, heatTint, heatRing * heatAlpha);

        // image-style label
        vec4 imgLabel = color;
        float pillW = u_radiusPx * 0.88;
        float pillH = u_radiusPx * 0.15;
        float pillR = 0.0;
        vec2 pillP = abs(local) - vec2(pillW - pillR, pillH - pillR);
        float pillD = length(max(pillP, 0.0)) + min(max(pillP.x, pillP.y), 0.0) - pillR;
        float pillMask = 1.0 - smoothstep(0.0, aa * 1.5, pillD);
        imgLabel.rgb = mix(imgLabel.rgb, vec3(0.0), pillMask * 0.55 * u_labelMix);
        imgLabel = mix(imgLabel, vec4(1.0, 1.0, 1.0, 1.0), la * 0.88 * u_labelMix);

        color = mix(emptyLabel, imgLabel, imgBlend);
      }

      // branch indicator: accent-style inlay for tiles with children
      if (vHasBranch > 0.5) {
        vec3 branchColor = mix(vec3(0.55), vIdentityColor, 0.35);

        // crisp bright edge ring
        float branchRing = 1.0 - smoothstep(0.0, aa * 1.8, abs(d));
        color.rgb = mix(color.rgb, branchColor, branchRing * 0.8);

        // soft inner bloom
        float branchBloom = 1.0 - smoothstep(0.0, aa * 6.0, abs(d + aa * 2.0));
        color.rgb += branchColor * branchBloom * 0.18;

        // gentle center wash
        float branchWash = exp(-dist * dist * 3.0);
        color.rgb += branchColor * branchWash * 0.08;

        // chevron hint at bottom of hex: small downward arrow
        float chevronY = local.y / u_radiusPx - 0.55;
        float chevronX = abs(local.x / u_radiusPx);
        float chevronLine = abs(chevronY + chevronX * 0.6 - 0.12);
        float chevronMask = smoothstep(0.02, 0.007, chevronLine)
                          * step(chevronX, 0.22)
                          * step(0.0, chevronY + 0.08);
        color.rgb = mix(color.rgb, branchColor, chevronMask * 0.125);
      }

      // divergence overlay: 1 = future-add (ghost), 2 = future-remove (marked)
      if (vDivergence > 0.5) {
        if (vDivergence < 1.5) {
          // future-add: translucent cyan ghost
          color.rgb = mix(color.rgb, vec3(0.15, 0.35, 0.45), 0.5);
          color.a *= 0.35;
          // dashed border hint \u2014 stripe pattern along hex edge
          float edgeDist = abs(d);
          float stripe = step(0.5, fract(edgeDist * 0.3));
          float edgeMask = 1.0 - smoothstep(0.0, aa * 3.0, edgeDist);
          color.rgb = mix(color.rgb, vec3(0.3, 0.7, 0.9), edgeMask * stripe * 0.6);
        } else {
          // future-remove: warm amber tint + strikethrough diagonal
          color.rgb = mix(color.rgb, vec3(0.6, 0.3, 0.1), 0.25);
          vec2 local2 = (vUV - 0.5) * u_quadSize;
          float diag = abs(local2.x + local2.y);
          float strikeMask = 1.0 - smoothstep(0.0, 2.0, abs(diag - u_radiusPx * 0.3));
          color.rgb = mix(color.rgb, vec3(1.0, 0.5, 0.15), strikeMask * 0.4);
        }
      }

      // hover accent: simple border glow using the active accent color
      if (u_hoveredIndex >= 0.0 && abs(vCellIndex - u_hoveredIndex) < 0.5) {
        // crisp border ring
        float hoverRing = 1.0 - smoothstep(0.0, aa * 1.8, abs(d));
        color.rgb = mix(color.rgb, u_accentColor, hoverRing * 0.75);

        // softer outer bloom that stays near the edge
        float hoverBloom = 1.0 - smoothstep(0.0, aa * 3.5, abs(d + aa * 1.5));
        color.rgb += u_accentColor * hoverBloom * 0.12;
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
var readCellProperties = async (cellDir) => {
  try {
    const fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return {};
  }
};
var writeCellProperties = async (cellDir, updates) => {
  const existing = await readCellProperties(cellDir);
  const merged = { ...existing, ...updates };
  const fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(merged));
  await writable.close();
};

// src/diamondcoreprocessor.com/presentation/tiles/show-cell.drone.ts
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
var CellSlots = class {
  #names = [];
  #local = /* @__PURE__ */ new Set();
  #branches = /* @__PURE__ */ new Set();
  #mode = "dense";
  #seeded = false;
  get seeded() {
    return this.#seeded;
  }
  get mode() {
    return this.#mode;
  }
  seed(snap) {
    this.#names = [...snap.names];
    this.#local = new Set(snap.localCells);
    this.#branches = new Set(snap.branches);
    this.#mode = snap.mode;
    this.#seeded = true;
  }
  clear() {
    this.#seeded = false;
    this.#names = [];
    this.#local.clear();
    this.#branches.clear();
  }
  snapshot() {
    return {
      names: [...this.#names],
      localCells: new Set(this.#local),
      branches: new Set(this.#branches),
      mode: this.#mode
    };
  }
  remove(label) {
    for (let i = 0; i < this.#names.length; i++) {
      if (this.#names[i] === label) this.#names[i] = "";
    }
    this.#local.delete(label);
    this.#branches.delete(label);
  }
  /**
   * Fill the first gap (''), or append at the end. Gaps exist because remove()
   * preserves slot positions — reusing them keeps neighbours still.
   * Pinned mode returns false so LayoutService owns slot assignment.
   */
  add(label, hasBranch) {
    if (this.#mode === "pinned") return false;
    if (!this.#names.includes(label)) {
      const gapIndex = this.#names.indexOf("");
      if (gapIndex >= 0) this.#names[gapIndex] = label;
      else this.#names.push(label);
    }
    this.#local.add(label);
    if (hasBranch) this.#branches.add(label);
    return true;
  }
};
var ShowCellDrone = class _ShowCellDrone extends Drone {
  static STREAM_BATCH_SIZE = 8;
  namespace = "diamondcoreprocessor.com";
  description = "Renders the hex grid \u2014 maps cells to coordinates, manages geometry, and syncs with the Nostr mesh.";
  effects = ["render", "network"];
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
  listens = ["render:host-ready", "mesh:ready", "mesh:items-updated", "tile:saved", "search:filter", "render:set-orientation", "render:set-pivot", "mesh:room", "mesh:secret", "cell:place-at", "cell:reorder", "render:set-gap", "move:preview", "clipboard:captured", "layout:mode", "tags:changed", "tags:filter", "history:cursor-changed", "tile:toggle-text", "visibility:show-hidden", "overlay:neon-color", "translation:tile-start", "translation:tile-done", "locale:changed", "substrate:changed", "substrate:ready", "substrate:applied", "substrate:rerolled", "cell:added", "cell:removed"];
  emits = ["mesh:ensure-started", "mesh:subscribe", "mesh:publish", "render:mesh-offset", "render:cell-count", "render:geometry-changed", "render:tags", "tile:hover-tags"];
  geom = null;
  shader = null;
  atlas = null;
  imageAtlas = null;
  atlasRenderer = null;
  // cache: cell label → small image signature (avoids re-reading 0000 on every render)
  cellImageCache = /* @__PURE__ */ new Map();
  // cache: cell label → tag names (avoids re-reading 0000 on every render)
  cellTagsCache = /* @__PURE__ */ new Map();
  // cache: cell label → border color RGB floats
  cellBorderColorCache = /* @__PURE__ */ new Map();
  // cache: cell label → has link property
  cellLinkCache = /* @__PURE__ */ new Map();
  // cache: cell label → is substrate-assigned image
  cellSubstrateCache = /* @__PURE__ */ new Map();
  // cache: cell label → hideText property (hide label when image shown)
  cellHideTextCache = /* @__PURE__ */ new Map();
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
  // per-layer viewport snapshot cache — skips OPFS read of `0000` on back-nav fast path.
  // Safe to keep across cell-content changes; only the persisted viewport of another
  // layer can write here, and the SPA can't reach that layer without revisiting.
  #layerViewportCache = /* @__PURE__ */ new Map();
  // per-layer explorerDir cache — skips OPFS directory resolution on back-nav fast path.
  // Entries are keyed by locationKey, so path renames produce a different key and the
  // stale handle simply goes unreferenced.
  #layerDirCache = /* @__PURE__ */ new Map();
  #heatByLabel = /* @__PURE__ */ new Map();
  #flashLabels = /* @__PURE__ */ new Set();
  #flashTimer = null;
  // newly created tiles glow briefly so the user can spot them, then fade
  #newCellFadeStart = /* @__PURE__ */ new Map();
  #newCellFadeRaf = 0;
  static #NEW_CELL_FADE_MS = 2500;
  #translatingLabels = /* @__PURE__ */ new Set();
  #translationPulseTimer = null;
  streamActive = false;
  // Monotonic stream token. Every call to streamCells captures the current
  // value; if the renderer starts a new stream (layer switch) it increments
  // the token, so any batch still awaiting in the old stream sees a
  // mismatch on its next iteration and bails out. Using a number here
  // instead of a boolean "cancel" flag is load-bearing: the old flag was
  // reset to false by the incoming stream's synchronous prelude before
  // the outgoing stream's next iteration ever observed it, so the
  // outgoing stream kept running — wrote its (stale) cells into the
  // shared mesh, and poisoned #layerCellsCache under the new layer's
  // key. The counter cannot be clobbered: once bumped, it never goes
  // back.
  #streamToken = 0;
  renderedLocationKey = "";
  #axialToIndex = /* @__PURE__ */ new Map();
  #heartbeatInitialized = false;
  #lastHeartbeatKey = "";
  #accentColor = [0.4, 0.85, 1];
  // hex geometry (circumradius, gap, pad, spacing) — configurable via render:set-gap effect
  #hexGeo = DEFAULT_HEX_GEOMETRY;
  // hex orientation: 'point-top' (default) or 'flat-top'
  #flat = false;
  #pivot = false;
  #textOnly = false;
  #labelsVisible = true;
  #substrateFadeStart = null;
  #substrateFadeRaf = 0;
  #showHiddenItems = false;
  #currentHiddenSet = /* @__PURE__ */ new Set();
  // mesh scoping — space + secret feed into the signature key
  #space = "";
  #secret = "";
  // note: mesh cell state (derived on heartbeat)
  meshSig = "";
  meshCellsRev = 0;
  meshCells = [];
  // clipboard view override — when set, render from this dir instead of explorer
  #clipboardView = null;
  #lastCursorPosition = -1;
  #lastCursorRewound = false;
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
  lastLocalCellsBySig = /* @__PURE__ */ new Map();
  lastPublishedGrammarSig = "";
  lastPublishedGrammarCell = "";
  // lease renewal: periodic refresh to keep tiles alive for late joiners
  #lastRefreshAtMs = /* @__PURE__ */ new Map();
  // sync-request: one-shot per sig arrival
  #syncRequestedBySig = /* @__PURE__ */ new Set();
  // rate-limit triggered republishes from sync-requests
  #lastTriggeredRepublishAtMs = /* @__PURE__ */ new Map();
  filterKeyword = "";
  filterTags = /* @__PURE__ */ new Set();
  /** Flat list of {label, dir} from cross-page tag scan. null = normal mode. */
  #tagFlattenResults = null;
  /** Saved lineage segments before entering tag filter — restored when filter clears. */
  #preFilterSegments = null;
  moveNames = null;
  #divergenceFutureAdds = /* @__PURE__ */ new Set();
  #divergenceFutureRemoves = /* @__PURE__ */ new Set();
  #pendingRemoves = /* @__PURE__ */ new Set();
  /** When cursor is rewound, holds cell→propertiesSig overrides from content-state ops. */
  #cursorPropsOverride = null;
  /** Cache key for cursor-time reconstruction: `{locationSig}:{position}` — avoids redundant OPFS reads */
  #cursorReconstructionKey = "";
  suppressMeshRecenter = false;
  #layoutMode = "dense";
  // First-visit fit: when navigating to a layer that has no saved viewport
  // snapshot, defer layer reveal until all cells have streamed in, then run
  // zoom-to-fit so the page opens sized to its content. The fitted viewport
  // is persisted, so subsequent visits restore it (or the user's later
  // pan/zoom edits) instead of fitting again.
  // cached render context for fast move:preview path (avoids full OPFS re-read)
  cachedCellNames = null;
  cachedLocalCellSet = null;
  cachedBranchSet = null;
  // State machine for slot ordering — the authoritative source of cellNames
  // during incremental updates. Seeded after every full render; mutated via
  // add()/remove() by incremental paths. Encapsulates dense vs pinned logic.
  #slots = new CellSlots();
  // Coalesce rapid cell:added / cell:removed events fired in the same JS turn.
  // The handlers mutate #slots synchronously; a single microtask runs one
  // applyGeometry at the end of the turn. Zero awaits in the click path.
  #pendingAdds = [];
  #pendingRemovals = [];
  #incrementalScheduled = false;
  // Phase 2: buffer references + label→index map for in-place cell attribute updates
  // (used by tile:saved fast path — mutate slices and push to GPU without rebuilding geometry)
  #buf = {};
  #labelToIndex = /* @__PURE__ */ new Map();
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
  /** Pre-warm: preheat every known tile-props blob and its `small.image`
   *  resource so first paint finds them hot in the Store cache. Runs once
   *  after registration, before the first pulse. Best-effort. */
  async warmup() {
    try {
      const raw = localStorage.getItem("hc:tile-props-index");
      if (!raw) return;
      const propsIndex = JSON.parse(raw);
      const propsSigs = Object.values(propsIndex).filter((v) => typeof v === "string" && /^[a-f0-9]{64}$/i.test(v));
      if (!propsSigs.length) return;
      const store = window.ioc?.get?.("@hypercomb.social/Store");
      if (!store?.preheatResource) return;
      const propsBlobs = await Promise.all(
        propsSigs.map((sig) => store.preheatResource(sig).catch(() => null))
      );
      const imageSigs = /* @__PURE__ */ new Set();
      for (const blob of propsBlobs) {
        if (!blob) continue;
        try {
          const props = JSON.parse(await blob.text());
          const sig = props?.small?.image;
          if (typeof sig === "string" && /^[a-f0-9]{64}$/i.test(sig)) imageSigs.add(sig);
        } catch {
        }
      }
      if (imageSigs.size) {
        await Promise.allSettled(
          [...imageSigs].map((sig) => store.preheatResource(sig).catch(() => null))
        );
      }
      this.#warmLabels = Object.keys(propsIndex);
    } catch {
    }
  }
  #warmLabels = [];
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
      await this.refreshMeshCells(grammar);
      this.requestRender();
    }
  };
  refreshMeshCells = async (grammar = "") => {
    const lineage = this.resolve("lineage");
    const mesh = this.tryGetMesh();
    if (!lineage || !mesh) return;
    const signatureLocation = await this.computeSignatureLocation(lineage);
    const sig = signatureLocation.sig;
    if (sig !== this.meshSig) {
      const NOSTR = "wss://relay.snort.social";
      const nakPayload = '{"cells":["external.alpha","Street Fighter"]}';
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
      this.meshCells = [];
      this.meshCellsRev++;
      if (typeof mesh.subscribe === "function") {
        this.meshSub = mesh.subscribe(sig, (evt) => {
          this.#handleIncomingSyncRequest(evt, mesh, sig);
          void (async () => {
            await this.refreshMeshCells();
            this.requestRender();
          })();
        });
      }
    }
    mesh.ensureStartedForSig(sig);
    this.emitEffect("mesh:ensure-started", { signature: sig });
    await this.publishLocalCells(lineage, mesh, sig, grammar);
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
      if (this.meshCells.length !== 0) {
        this.meshCells = [];
        this.meshCellsRev++;
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
      const fromContent = this.extractCellsFromEventContent(it?.event?.content);
      if (fromContent.length > 0) {
        for (const cell of fromContent) set.add(cell);
        continue;
      }
      if (Array.isArray(p)) {
        for (const x of p) {
          const s = String(x ?? "").trim();
          this.addCsvCells(set, s);
        }
        continue;
      }
      if (typeof p === "string") {
        const parsed = this.extractCellsFromEventContent(p);
        if (parsed.length > 0) {
          for (const cell of parsed) set.add(cell);
        } else if (!this.looksStructuredContent(p)) {
          this.addCsvCells(set, p);
        }
        continue;
      }
      const cellsArr = p?.cells ?? p?.seeds;
      if (Array.isArray(cellsArr)) {
        for (const x of cellsArr) {
          const s = String(x ?? "").trim();
          this.addCsvCells(set, s);
        }
      }
      const singleCell = String(p?.cell ?? p?.seed ?? "").trim();
      this.addCsvCells(set, singleCell);
    }
    const next = Array.from(set);
    next.sort((a, b) => a.localeCompare(b));
    const sameLen = next.length === this.meshCells.length;
    let same = sameLen;
    if (same) {
      for (let i = 0; i < next.length; i++) {
        if (next[i] !== this.meshCells[i]) {
          same = false;
          break;
        }
      }
    }
    if (!same) {
      this.meshCells = next;
      this.meshCellsRev++;
    }
  };
  publishExplicitCellList = async (cells) => {
    const lineage = this.resolve("lineage");
    const mesh = this.tryGetMesh();
    if (!lineage || !mesh || typeof mesh.publish !== "function") return false;
    const signatureLocation = await this.computeSignatureLocation(lineage);
    if (!signatureLocation.sig) return false;
    const normalized = Array.isArray(cells) ? cells.map((s) => String(s ?? "").trim()).filter((s) => s.length > 0) : [];
    const payload = normalized.join(",");
    const ok = await mesh.publish(29010, signatureLocation.sig, payload, [["publisher", this.publisherId]]);
    await this.refreshMeshCells();
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
    const parts = [this.#space, domain, lineagePath, this.#secret, "cell"].filter(Boolean);
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
    return get("@diamondcoreprocessor.com/NostrMeshDrone") ?? null;
  };
  publishLocalCells = async (lineage, mesh, sig, grammar = "") => {
    if (typeof mesh.publish !== "function") return;
    if (!lineage?.explorerDir) return;
    const dir = await lineage.explorerDir();
    if (!dir) return;
    const localCells = await this.listCellFolders(dir);
    const previousCells = this.lastLocalCellsBySig.get(sig) ?? [];
    if (!this.snapshotPostedBySig.has(sig)) {
      await mesh.publish(29010, sig, {
        cells: localCells,
        publisherId: this.publisherId,
        mode: "snapshot",
        publishedAtMs: Date.now()
      }, [["publisher", this.publisherId], ["mode", "snapshot"]]);
      this.snapshotPostedBySig.add(sig);
      this.#lastRefreshAtMs.set(sig, Date.now());
    }
    const prevSet = new Set(previousCells);
    for (const cell of localCells) {
      if (prevSet.has(cell)) continue;
      await mesh.publish(29010, sig, cell, [["publisher", this.publisherId], ["mode", "delta"]]);
    }
    this.lastLocalCellsBySig.set(sig, localCells);
    const now = Date.now();
    const lastRefresh = this.#lastRefreshAtMs.get(sig) ?? 0;
    const refreshInterval = this.#computeRefreshInterval(mesh, sig);
    if (lastRefresh > 0 && now - lastRefresh >= refreshInterval) {
      await mesh.publish(29010, sig, {
        cells: localCells,
        publisherId: this.publisherId,
        mode: "refresh",
        publishedAtMs: now
      }, [["publisher", this.publisherId], ["mode", "refresh"]]);
      this.#lastRefreshAtMs.set(sig, now);
    }
    const grammarCell = this.toGrammarCell(grammar);
    const grammarIsNew = grammarCell && (sig !== this.lastPublishedGrammarSig || grammarCell !== this.lastPublishedGrammarCell);
    if (grammarIsNew) {
      await mesh.publish(29010, sig, grammarCell, [["publisher", this.publisherId], ["source", "show-honeycomb:grammar-heartbeat"]]);
      this.lastPublishedGrammarSig = sig;
      this.lastPublishedGrammarCell = grammarCell;
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
    const localCells = this.lastLocalCellsBySig.get(sig) ?? [];
    if (localCells.length === 0) return;
    void mesh.publish(29010, sig, {
      cells: localCells,
      publisherId: this.publisherId,
      mode: "snapshot",
      publishedAtMs: now
    }, [["publisher", this.publisherId], ["mode", "snapshot"]]);
    this.#lastRefreshAtMs.set(sig, now);
  };
  addCsvCells = (set, raw) => {
    const text = String(raw ?? "").trim();
    if (!text) return;
    const parts = text.split(",");
    for (const part of parts) {
      const cell = String(part ?? "").trim();
      if (cell) set.add(cell);
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
  extractCellsFromEventContent = (content) => {
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
        const cells = parsed.cells ?? parsed.seeds;
        if (Array.isArray(cells)) {
          for (const x of cells) out.push(...this.splitCsv(String(x ?? "")));
        }
        const cell = String(parsed.cell ?? parsed.seed ?? "").trim();
        if (cell) out.push(...this.splitCsv(cell));
        return out;
      }
    } catch {
      const cellsMatch = raw.match(/(?:cells|seeds)\s*:\s*\[([^\]]*)\]/i);
      if (cellsMatch && cellsMatch[1]) {
        return this.splitCsv(String(cellsMatch[1] ?? ""));
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
      let cell = String(part ?? "").trim();
      if (cell.startsWith('"') && cell.endsWith('"') && cell.length >= 2) {
        cell = cell.slice(1, -1).trim();
      }
      if (cell.startsWith("'") && cell.endsWith("'") && cell.length >= 2) {
        cell = cell.slice(1, -1).trim();
      }
      if (cell) out.push(cell);
    }
    return out;
  };
  toGrammarCell = (grammar) => {
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
    if (!axial?.items || !this.cachedCellNames || !this.cachedLocalCellSet) {
      this.requestRender();
      return;
    }
    const cellNames = this.cachedCellNames;
    const localCellSet = this.cachedLocalCellSet;
    const branchSet = this.cachedBranchSet ?? /* @__PURE__ */ new Set();
    const axialMax = typeof axial.items.size === "number" ? axial.items.size : cellNames.length;
    const effectiveLen = this.moveNames ? this.moveNames.length : cellNames.length;
    const maxCells = Math.min(effectiveLen, axialMax);
    if (maxCells <= 0) return;
    const cells = this.buildCellsFromAxial(axial, cellNames, maxCells, localCellSet, branchSet);
    if (cells.length === 0) return;
    const atlas = this.imageAtlas;
    const needReload = [];
    for (const cell of cells) {
      if (this.cellImageCache.has(cell.label)) {
        const cachedSig = this.cellImageCache.get(cell.label) ?? void 0;
        cell.imageSig = cachedSig;
        if (cachedSig && atlas && !atlas.hasImage(cachedSig) && !atlas.hasFailed(cachedSig)) {
          needReload.push(cell);
        }
      }
    }
    if (needReload.length > 0) {
      void (async () => {
        const lineage = this.resolve("lineage");
        const dir = await lineage?.explorerDir?.();
        if (!dir) return;
        await this.loadCellImages(needReload, dir);
        this.requestRender();
      })();
    }
    this.renderedCells.clear();
    for (const cell of cells) this.renderedCells.set(cell.label, cell);
    this.suppressMeshRecenter = true;
    void this.applyGeometry(cells).finally(() => {
      this.suppressMeshRecenter = false;
    });
  };
  /**
   * Incremental render — same-layer tile changes without the full synchronize path.
   * Follows renderMovePreview's pattern: reuse cached context, update only the
   * affected tiles, rebuild geometry without hiding the layer.
   *
   * No OPFS directory scan, no history replay, no fit-to-content, no layer hide.
   */
  /**
   * Queue a cell diff from a synchronous event handler. All mutations happen
   * in one microtask per JS turn — rapid clicks in the same turn coalesce.
   * Zero awaits; the click path is never blocked on OPFS.
   */
  #queueIncremental = (change) => {
    if (change.added) for (const n of change.added) this.#pendingAdds.push(n);
    if (change.removed) for (const n of change.removed) this.#pendingRemovals.push(n);
    if (this.#incrementalScheduled) return;
    this.#incrementalScheduled = true;
    queueMicrotask(() => {
      this.#incrementalScheduled = false;
      const added = this.#pendingAdds;
      const removed = this.#pendingRemovals;
      this.#pendingAdds = [];
      this.#pendingRemovals = [];
      this.#runIncrementalSync({ added, removed });
    });
  };
  /**
   * Synchronous incremental render — uses only the slot state machine and
   * cached image/tag data; no OPFS access. Images for newly-added cells
   * are fetched fire-and-forget and pushed via in-place buffer update when
   * ready.
   */
  #runIncrementalSync = (change) => {
    const axial = this.resolve("axial");
    if (!axial?.items || !this.#slots.seeded) {
      this.#layerCellsCache.delete(this.renderedLocationKey);
      this.renderedCellsKey = "";
      this.requestRender();
      return;
    }
    for (const name of change.removed) {
      this.#slots.remove(name);
      this.renderedCells.delete(name);
    }
    for (const name of change.added) {
      if (!this.#slots.add(name, false)) {
        this.#layerCellsCache.delete(this.renderedLocationKey);
        this.renderedCellsKey = "";
        this.requestRender();
        return;
      }
    }
    const snap = this.#slots.snapshot();
    const cellNames = snap.names;
    const localCellSet = snap.localCells;
    const branchSet = snap.branches;
    this.cachedCellNames = cellNames;
    this.cachedLocalCellSet = localCellSet;
    this.cachedBranchSet = branchSet;
    const axialMax = typeof axial.items.size === "number" ? axial.items.size : cellNames.length;
    const maxCells = Math.min(cellNames.length, axialMax);
    if (maxCells <= 0) {
      this.clearMesh();
      return;
    }
    const cells = this.buildCellsFromAxial(axial, cellNames, maxCells, localCellSet, branchSet);
    if (cells.length === 0) {
      this.clearMesh();
      return;
    }
    const atlas = this.imageAtlas;
    const needReload = [];
    for (const cell of cells) {
      if (cell.external) continue;
      if (this.cellImageCache.has(cell.label)) {
        const cachedSig = this.cellImageCache.get(cell.label) ?? void 0;
        cell.imageSig = cachedSig;
        if (cachedSig && atlas && !atlas.hasImage(cachedSig) && !atlas.hasFailed(cachedSig)) {
          needReload.push(cell);
        }
      }
      const bc = this.cellBorderColorCache.get(cell.label);
      if (bc) cell.borderColor = bc;
      cell.hasLink = this.cellLinkCache.get(cell.label) ?? false;
      cell.hasSubstrate = this.cellSubstrateCache.get(cell.label) ?? false;
      cell.hideText = this.cellHideTextCache.get(cell.label) ?? false;
    }
    if (needReload.length > 0) {
      void (async () => {
        const lineage = this.resolve("lineage");
        const dir = await lineage?.explorerDir?.();
        if (!dir) return;
        await this.loadCellImages(needReload, dir);
        this.requestRender();
      })();
    }
    this.renderedCells.clear();
    for (const cell of cells) this.renderedCells.set(cell.label, cell);
    this.#layerCellsCache.set(this.renderedLocationKey, {
      cells: [...cells],
      cellNames,
      localCellSet,
      branchSet
    });
    this.suppressMeshRecenter = true;
    void this.applyGeometry(cells);
    if (change.added.length > 0) {
      const added = change.added;
      const lineage = this.resolve("lineage");
      void Promise.resolve(lineage?.explorerDir?.()).then(async (dir) => {
        if (!dir) return;
        await Promise.all(added.map(async (name) => {
          const hasBranch = await this.checkCellHasBranch(dir, name);
          if (hasBranch) this.#slots.add(name, true);
        }));
        for (const name of added) {
          await this.#tryInPlaceCellUpdate(name, { dir });
        }
      }).catch(() => {
      });
    }
    this.emitEffect("render:cell-count", {
      count: cells.length,
      labels: cells.map((cell) => cell.label),
      coords: cells.map((cell) => ({ q: cell.q, r: cell.r })),
      branchLabels: cells.filter((cell) => cell.hasBranch).map((cell) => cell.label),
      externalLabels: cells.filter((cell) => cell.external).map((cell) => cell.label),
      noImageLabels: cells.filter((cell) => !cell.imageSig).map((cell) => cell.label),
      substrateLabels: cells.filter((cell) => cell.hasSubstrate).map((cell) => cell.label),
      linkLabels: cells.filter((cell) => cell.hasLink).map((cell) => cell.label),
      hiddenLabels: this.#showHiddenItems ? [...this.#currentHiddenSet] : []
    });
    this.#emitRenderTags(cells);
  };
  /**
   * Async incremental render — kept for callers that legitimately need to
   * update cached content (tile:saved fallback, tags:changed, substrate
   * fallback). Never invoked for cell:added/removed.
   */
  renderIncremental = async (change) => {
    const axial = this.resolve("axial");
    const lineage = this.resolve("lineage");
    if (!axial?.items || !lineage || !this.#slots.seeded) {
      this.requestRender();
      return;
    }
    const dir = await lineage.explorerDir?.();
    if (!dir) {
      this.requestRender();
      return;
    }
    if (change.removed?.length) {
      for (const name of change.removed) {
        this.#slots.remove(name);
        this.renderedCells.delete(name);
      }
    }
    if (change.added?.length) {
      for (const name of change.added) {
        const hasBranch = await this.checkCellHasBranch(dir, name);
        if (!this.#slots.add(name, hasBranch)) {
          this.#layerCellsCache.delete(this.renderedLocationKey);
          this.renderedCellsKey = "";
          this.requestRender();
          return;
        }
      }
    }
    const snap = this.#slots.snapshot();
    const cellNames = snap.names;
    const localCellSet = snap.localCells;
    const branchSet = snap.branches;
    this.cachedCellNames = cellNames;
    this.cachedLocalCellSet = localCellSet;
    this.cachedBranchSet = branchSet;
    const axialMax = typeof axial.items.size === "number" ? axial.items.size : cellNames.length;
    const maxCells = Math.min(cellNames.length, axialMax);
    if (maxCells <= 0) {
      this.clearMesh();
      return;
    }
    const cells = this.buildCellsFromAxial(axial, cellNames, maxCells, localCellSet, branchSet);
    if (cells.length === 0) {
      this.clearMesh();
      return;
    }
    const touched = /* @__PURE__ */ new Set([...change.added ?? [], ...change.changedContent ?? []]);
    const atlas = this.imageAtlas;
    const needLoad = cells.filter((c) => {
      if (touched.has(c.label)) return true;
      if (!this.cellImageCache.has(c.label)) return true;
      const cachedSig = this.cellImageCache.get(c.label);
      if (cachedSig && atlas && !atlas.hasImage(cachedSig) && !atlas.hasFailed(cachedSig)) return true;
      return false;
    });
    if (needLoad.length > 0) await this.loadCellImages(needLoad, dir);
    for (const cell of cells) {
      if (cell.external) continue;
      if (this.cellImageCache.has(cell.label)) cell.imageSig = this.cellImageCache.get(cell.label) ?? void 0;
      const bc = this.cellBorderColorCache.get(cell.label);
      if (bc) cell.borderColor = bc;
      cell.hasLink = this.cellLinkCache.get(cell.label) ?? false;
      cell.hasSubstrate = this.cellSubstrateCache.get(cell.label) ?? false;
      cell.hideText = this.cellHideTextCache.get(cell.label) ?? false;
    }
    this.renderedCells.clear();
    for (const cell of cells) this.renderedCells.set(cell.label, cell);
    this.#layerCellsCache.set(this.renderedLocationKey, {
      cells: [...cells],
      cellNames,
      localCellSet,
      branchSet
    });
    this.suppressMeshRecenter = true;
    await this.applyGeometry(cells);
    this.emitEffect("render:cell-count", {
      count: cells.length,
      labels: cells.map((cell) => cell.label),
      coords: cells.map((cell) => ({ q: cell.q, r: cell.r })),
      branchLabels: cells.filter((cell) => cell.hasBranch).map((cell) => cell.label),
      externalLabels: cells.filter((cell) => cell.external).map((cell) => cell.label),
      noImageLabels: cells.filter((cell) => !cell.imageSig).map((cell) => cell.label),
      substrateLabels: cells.filter((cell) => cell.hasSubstrate).map((cell) => cell.label),
      linkLabels: cells.filter((cell) => cell.hasLink).map((cell) => cell.label),
      hiddenLabels: this.#showHiddenItems ? [...this.#currentHiddenSet] : []
    });
    this.#emitRenderTags(cells);
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
    if (!this.layer) {
      this.layer = new Container3();
      this.pixiContainer.addChild(this.layer);
      this.atlas = new HexLabelAtlas(this.pixiRenderer, 128, 8, 8);
      this.attachLabelResolver(this.atlas);
      this.atlas.setPivot(this.#pivot);
      if (this.#warmLabels.length) this.atlas.seed(this.#warmLabels);
      this.imageAtlas = new HexImageAtlas(this.pixiRenderer, 256, 16, 16);
      this.#invalidateAllLabelDerivedState();
      this.atlasRenderer = this.pixiRenderer;
      this.shader = null;
    } else if (!this.atlas || this.atlasRenderer !== this.pixiRenderer) {
      this.atlas = new HexLabelAtlas(this.pixiRenderer, 128, 8, 8);
      this.attachLabelResolver(this.atlas);
      this.atlas.setPivot(this.#pivot);
      if (this.#warmLabels.length) this.atlas.seed(this.#warmLabels);
      this.imageAtlas = new HexImageAtlas(this.pixiRenderer, 256, 16, 16);
      this.#invalidateAllLabelDerivedState();
      this.atlasRenderer = this.pixiRenderer;
      this.shader = null;
    }
    const fsRev = Number(lineage.changed?.() ?? 0);
    const meshRev = this.meshCellsRev;
    const isStale = () => {
      const currentKey = String(lineage.explorerLabel?.() ?? "/");
      const currentRev = Number(lineage.changed?.() ?? 0);
      const currentMeshRev = this.meshCellsRev;
      return currentKey !== locationKey || currentRev !== fsRev || currentMeshRev !== meshRev;
    };
    let dir;
    if (this.#clipboardView) {
      const store = window.ioc?.get?.("@hypercomb.social/Store");
      if (this.#clipboardView.op === "cut" && store?.clipboard) {
        dir = store.clipboard;
      } else if (store?.hypercombRoot && lineage.tryResolve) {
        dir = await lineage.tryResolve(this.#clipboardView.sourceSegments, store.hypercombRoot);
        if (!dir) dir = await lineage.explorerDir();
      } else {
        dir = await lineage.explorerDir();
      }
    } else {
      dir = await lineage.explorerDir();
    }
    if (!this.#clipboardView && isStale()) {
      this.renderQueued = true;
      return;
    }
    if (!dir) {
      console.warn("[show-honeycomb] BAIL: explorerDir returned null");
      this.clearMesh();
      return;
    }
    this.#layerDirCache.set(locationKey, dir);
    if (this.#tagFlattenResults && this.#tagFlattenResults.length > 0) {
      const flatResults = this.#tagFlattenResults;
      const cellNames2 = flatResults.map((r) => r.label);
      const flatSeedSet = new Set(cellNames2);
      const axial2 = this.resolve("axial");
      if (!axial2) {
        this.rendering = false;
        return;
      }
      const maxCells2 = Math.min(cellNames2.length, typeof axial2.items.size === "number" ? axial2.items.size : cellNames2.length);
      const cells2 = this.buildCellsFromAxial(axial2, cellNames2, maxCells2, flatSeedSet);
      if (cells2.length === 0) {
        this.clearMesh();
        this.rendering = false;
        return;
      }
      await this.loadCellImages(cells2, dir);
      this.cachedCellNames = cellNames2;
      this.cachedLocalCellSet = flatSeedSet;
      this.cachedBranchSet = /* @__PURE__ */ new Set();
      this.renderedCellsKey = "tag-flatten:" + [...this.filterTags].sort().join(",");
      this.renderedLocationKey = locationKey;
      this.renderedCells.clear();
      for (const cell of cells2) this.renderedCells.set(cell.label, cell);
      await this.applyGeometry(cells2);
      this.#emitRenderTags(cells2);
      this.emitEffect("render:cell-count", { count: cells2.length, labels: cellNames2 });
      this.rendering = false;
      return;
    }
    const localCells = await this.listCellFolders(dir);
    if (!this.#clipboardView && isStale()) {
      this.renderQueued = true;
      return;
    }
    const union = /* @__PURE__ */ new Set();
    for (const s of localCells) union.add(s);
    for (const s of this.meshCells) union.add(s);
    const localCellSet = new Set(localCells);
    const branchSet = /* @__PURE__ */ new Set();
    await Promise.all(localCells.map(async (name) => {
      if (await this.checkCellHasBranch(dir, name)) branchSet.add(name);
    }));
    const historyService = window.ioc?.get?.("@diamondcoreprocessor.com/HistoryService");
    const cursorService = window.ioc?.get?.("@diamondcoreprocessor.com/HistoryCursorService");
    this.#divergenceFutureAdds = /* @__PURE__ */ new Set();
    this.#divergenceFutureRemoves = /* @__PURE__ */ new Set();
    this.#cursorPropsOverride = null;
    this.#cursorReconstructionKey = "";
    if (!this.#clipboardView && historyService) {
      const sig = await this.computeSignatureLocation(lineage);
      if (cursorService) await cursorService.load(sig.sig);
      if (cursorService) {
        const content = await cursorService.layerContentAtCursor();
        if (content) {
          const allowed = new Set(content.cells);
          for (const cell of [...union]) {
            if (!allowed.has(cell)) union.delete(cell);
          }
          for (const cell of content.cells) {
            union.add(cell);
            localCellSet.add(cell);
          }
        }
      }
    }
    if (!this.#clipboardView) {
      const clipSvc = get("@diamondcoreprocessor.com/ClipboardService");
      const cutLabels = clipSvc?.operation === "cut" ? new Set(clipSvc.items.map((i) => i.label)) : /* @__PURE__ */ new Set();
      const reconciled = [];
      for (const cell of this.#pendingRemoves) {
        if (cutLabels.has(cell) || !localCellSet.has(cell)) {
          union.delete(cell);
        } else {
          reconciled.push(cell);
        }
      }
      for (const cell of reconciled) this.#pendingRemoves.delete(cell);
    }
    const blockedSet = new Set(JSON.parse(localStorage.getItem(`hc:blocked-tiles:${locationKey}`) ?? "[]"));
    for (const blocked of blockedSet) {
      if (!localCellSet.has(blocked)) union.delete(blocked);
    }
    const cursorState = cursorService?.state;
    const rewoundContent = cursorState?.rewound && cursorService ? cursorService.peekContent() : null;
    const hiddenSet = rewoundContent ? new Set(rewoundContent.hidden) : new Set(JSON.parse(localStorage.getItem(`hc:hidden-tiles:${locationKey}`) ?? "[]"));
    this.#currentHiddenSet = hiddenSet;
    if (!this.#showHiddenItems) {
      for (const hidden of hiddenSet) {
        if (localCellSet.has(hidden)) union.delete(hidden);
      }
    }
    if (this.#clipboardView) {
      const clipLabels = this.#clipboardView.labels;
      for (const cell of union) {
        if (!clipLabels.has(cell)) union.delete(cell);
      }
      const missing = [];
      for (const label of clipLabels) {
        if (!union.has(label)) missing.push(label);
      }
      if (missing.length > 0) {
        this.emitEffect("clipboard:ghost-detected", { labels: missing });
      }
    }
    this.#layoutMode = this.#readLayoutMode(locationKey);
    const cellNames = await this.#resolveCellOrder(this.#layoutMode, dir, union, localCellSet, lineage);
    const previousLocationKey = this.renderedLocationKey;
    const layerChanged = locationKey !== previousLocationKey;
    if (this.streamActive && !layerChanged) return;
    if (layerChanged) {
      const myToken = ++this.#streamToken;
      this.renderedLocationKey = locationKey;
      this.renderedCellsKey = "";
      this.renderedCells.clear();
      this.#pendingRemoves.clear();
      this.#slots.clear();
      this.suppressMeshRecenter = false;
      await this.#applyViewportForLayer(dir);
      if (myToken !== this.#streamToken) return;
      const vp = window.ioc?.get?.("@diamondcoreprocessor.com/ViewportPersistence");
      if (vp) vp.setDirSilent(dir);
      if (cellNames.length === 0) {
        if (this.layer) this.layer.visible = true;
        this.clearMesh();
        return;
      }
      if (this.layer) this.layer.visible = false;
      this.emitEffect("navigation:guard-start", { locationKey });
      void this.streamCells(dir, cellNames, localCellSet, axial, branchSet, myToken, locationKey);
      return;
    }
    if (cellNames.length === 0) {
      this.clearMesh();
      return;
    }
    const wasEmpty = this.renderedCount === 0;
    const axialMax = typeof axial.items.size === "number" ? axial.items.size : cellNames.length;
    const maxCells = Math.min(cellNames.length, axialMax);
    if (maxCells <= 0) {
      this.clearMesh();
      return;
    }
    const cells = this.buildCellsFromAxial(axial, cellNames, maxCells, localCellSet, branchSet);
    if (cells.length === 0) {
      this.clearMesh();
      return;
    }
    await this.loadCellImages(cells, dir);
    if (!this.#clipboardView && isStale()) {
      this.renderQueued = true;
      return;
    }
    this.cachedCellNames = cellNames;
    this.cachedLocalCellSet = localCellSet;
    this.cachedBranchSet = branchSet;
    this.renderedCells.clear();
    for (const cell of cells) this.renderedCells.set(cell.label, cell);
    await this.applyGeometry(cells);
    if (wasEmpty && cells.length > 0 && this.pixiApp && this.pixiContainer && this.pixiRenderer) {
      const s = this.pixiRenderer.screen;
      this.pixiApp.stage.position.set(s.width * 0.5, s.height * 0.5);
      this.pixiContainer.scale.set(2);
      this.pixiContainer.position.set(0, 0);
      const vp = window.ioc?.get?.("@diamondcoreprocessor.com/ViewportPersistence");
      if (vp) {
        vp.setZoom(2, 0, 0);
        vp.setPan(0, 0);
      }
    }
    this.#layerCellsCache.set(locationKey, { cells: [...cells], cellNames, localCellSet, branchSet });
    this.#slots.seed({ names: cellNames, localCells: localCellSet, branches: branchSet, mode: this.#layoutMode });
  };
  streamCells = async (dir, cellNames, localCellSet, axial, branchSet, myToken, myLocationKey) => {
    this.streamActive = true;
    const superseded = () => myToken !== this.#streamToken;
    const axialMax = typeof axial.items.size === "number" ? axial.items.size : cellNames.length;
    const maxCells = Math.min(cellNames.length, axialMax);
    const allCells = this.buildCellsFromAxial(axial, cellNames, maxCells, localCellSet, branchSet);
    const cells = [];
    const BATCH = _ShowCellDrone.STREAM_BATCH_SIZE;
    for (let start = 0; start < allCells.length; start += BATCH) {
      if (superseded()) return;
      const batch = allCells.slice(start, start + BATCH);
      await this.loadCellImages(batch, dir);
      if (superseded()) return;
      for (const cell of batch) {
        cells.push(cell);
        this.renderedCells.set(cell.label, cell);
      }
      const isLast = start + BATCH >= allCells.length;
      await this.applyGeometry(cells, isLast);
      if (superseded()) return;
      if (this.layer && !this.layer.visible) {
        this.layer.visible = true;
      }
      if (!isLast) await this.microDelay();
    }
    if (superseded()) return;
    if (this.layer) this.layer.visible = true;
    this.streamActive = false;
    this.emitEffect("navigation:guard-end", {});
    if (cells.length > 0) {
      const bset = branchSet ?? /* @__PURE__ */ new Set();
      this.#layerCellsCache.set(myLocationKey, { cells: [...cells], cellNames, localCellSet, branchSet: bset });
      this.#slots.seed({ names: cellNames, localCells: localCellSet, branches: bset, mode: this.#layoutMode });
    }
    this.requestRender();
  };
  #applyViewportForLayer = async (dir) => {
    let snap = {};
    try {
      const fh = await dir.getFileHandle("0000");
      const file = await fh.getFile();
      const props = JSON.parse(await file.text());
      snap = props.viewport ?? {};
    } catch {
    }
    const locationKey = this.renderedLocationKey;
    if (locationKey) this.#layerViewportCache.set(locationKey, snap);
    return this.#applyViewportFromSnapshot(snap);
  };
  #applyViewportFromSnapshot = (snap) => {
    const container = this.pixiContainer;
    const app = this.pixiApp;
    const renderer = this.pixiRenderer;
    if (!container || !app || !renderer) return false;
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
    return !!(snap.zoom || snap.pan);
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
      const [ar, ag, ab] = this.#accentColor;
      this.shader.setAccentColor(ar, ag, ab);
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
    this.shader.setLabelMix(this.#labelsVisible ? 1 : 0);
    this.shader.setImageMix(this.#textOnly ? 0 : this.#substrateFadeMix());
    if (!this.hexMesh) {
      this.hexMesh = new Mesh({ geometry: geom, shader: this.shader.shader, texture: Texture4.WHITE });
      this.hexMesh.blendMode = "pre-multiply";
      this.layer.addChild(this.hexMesh);
    } else {
      if (this.geom) this.geom.destroy(true);
      this.hexMesh.geometry = geom;
      this.hexMesh.shader = this.shader.shader;
    }
    if (this.hexMesh?.getLocalBounds && !this.suppressMeshRecenter) {
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
    this.emitEffect("render:cell-count", {
      count: cells.length,
      labels: cells.map((cell) => cell.label),
      coords: cells.map((cell) => ({ q: cell.q, r: cell.r })),
      branchLabels: cells.filter((cell) => cell.hasBranch).map((cell) => cell.label),
      externalLabels: cells.filter((cell) => cell.external).map((cell) => cell.label),
      noImageLabels: cells.filter((cell) => !cell.imageSig).map((cell) => cell.label),
      substrateLabels: cells.filter((cell) => cell.hasSubstrate).map((cell) => cell.label),
      linkLabels: cells.filter((cell) => cell.hasLink).map((cell) => cell.label),
      hiddenLabels: this.#showHiddenItems ? [...this.#currentHiddenSet] : []
    });
    this.#emitRenderTags(cells);
  };
  /** Emit render:tags with unique tag names + counts from all currently visible cells. */
  #emitRenderTags(cells) {
    const counts = /* @__PURE__ */ new Map();
    for (const cell of cells) {
      const tags2 = this.cellTagsCache.get(cell.label);
      if (tags2) {
        for (const tag of tags2) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }
    }
    const tags = [...counts.entries()].map(([name, count]) => ({ name, count }));
    this.emitEffect("render:tags", { tags });
  }
  /** Tag scanning across directory tree removed — no-op. */
  async #scanTagsAcrossPages() {
  }
  // 1–3ms micro-pause to avoid main-thread blocking (legacy JsonHiveStreamLoader pattern)
  microDelay = () => new Promise((r) => setTimeout(r, 1 + Math.random() * 2));
  /** Returns the current imageMix value, accounting for substrate fade-in animation. */
  #substrateFadeMix() {
    if (this.#substrateFadeStart === null) return 1;
    const elapsed = performance.now() - this.#substrateFadeStart;
    if (elapsed >= 1e3) {
      this.#substrateFadeStart = null;
      return 1;
    }
    const t = elapsed / 1e3;
    if (t < 0.5) {
      const p = t / 0.5;
      return 0.5 * p * p;
    }
    return 0.5 + 0.5 * ((t - 0.5) / 0.5);
  }
  /** Kick off the substrate fade-in animation loop. */
  #startSubstrateFade() {
    if (this.#textOnly) return;
    this.#substrateFadeStart = performance.now();
    cancelAnimationFrame(this.#substrateFadeRaf);
    const tick = () => {
      if (this.#substrateFadeStart === null) return;
      const mix = this.#substrateFadeMix();
      this.shader?.setImageMix(mix);
      if (mix < 1) {
        this.#substrateFadeRaf = requestAnimationFrame(tick);
      } else {
        this.#substrateFadeStart = null;
      }
    };
    this.#substrateFadeRaf = requestAnimationFrame(tick);
  }
  ensureListeners = () => {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener("synchronize", this.requestRender);
    window.addEventListener("navigate", this.requestRender);
    this.onEffect("tile:saved", (payload) => {
      if (payload?.cell) {
        const oldSig = this.cellImageCache.get(payload.cell);
        this.cellImageCache.delete(payload.cell);
        this.cellBorderColorCache.delete(payload.cell);
        this.cellTagsCache.delete(payload.cell);
        this.cellLinkCache.delete(payload.cell);
        this.cellSubstrateCache.delete(payload.cell);
        this.cellHideTextCache.delete(payload.cell);
        if (oldSig && this.imageAtlas) {
          this.imageAtlas.invalidate(oldSig);
        }
      }
      this.#layerCellsCache.delete(this.renderedLocationKey);
      this.renderedCellsKey = "";
      this.requestRender();
    });
    this.onEffect("tags:changed", (payload) => {
      if (!payload?.updates) return;
      const changedCells = [];
      for (const { cell } of payload.updates) {
        this.cellTagsCache.delete(cell);
        changedCells.push(cell);
      }
      if (this.cachedCellNames && changedCells.length > 0) {
        void this.renderIncremental({ changedTags: changedCells });
      } else {
        this.#layerCellsCache.delete(this.renderedLocationKey);
        this.renderedCellsKey = "";
        this.requestRender();
      }
    });
    this.onEffect("cell:added", (payload) => {
      this.suppressMeshRecenter = true;
      if (!payload?.cell) return;
      this.#pendingRemoves.delete(payload.cell);
      this.#startNewCellFade(payload.cell);
      if (this.#slots.seeded) {
        this.#queueIncremental({ added: [payload.cell] });
      } else {
        this.#layerCellsCache.delete(this.renderedLocationKey);
        this.renderedCellsKey = "";
        this.requestRender();
      }
    });
    this.onEffect("cell:removed", (payload) => {
      this.suppressMeshRecenter = true;
      if (!payload?.cell) return;
      this.#pendingRemoves.add(payload.cell);
      this.cellImageCache.delete(payload.cell);
      this.cellTagsCache.delete(payload.cell);
      this.cellLinkCache.delete(payload.cell);
      this.cellBorderColorCache.delete(payload.cell);
      this.cellSubstrateCache.delete(payload.cell);
      this.cellHideTextCache.delete(payload.cell);
      if (this.#slots.seeded) {
        this.#queueIncremental({ removed: [payload.cell] });
      } else {
        this.#layerCellsCache.delete(this.renderedLocationKey);
        this.renderedCellsKey = "";
        this.requestRender();
      }
    });
    this.onEffect("history:cursor-changed", (state) => {
      const nowRewound = state?.rewound ?? false;
      const nowPosition = state?.position ?? -1;
      if (nowPosition === this.#lastCursorPosition && nowRewound === this.#lastCursorRewound) return;
      this.#lastCursorPosition = nowPosition;
      this.#lastCursorRewound = nowRewound;
      this.#layerCellsCache.clear();
      this.#invalidateAllLabelDerivedState();
      this.renderedCellsKey = "";
      this.#streamToken++;
      void this.#applyCursorLayout();
      this.suppressMeshRecenter = true;
      const app = this.pixiApp;
      const cont = this.pixiContainer;
      const snap = app && cont ? {
        stagePos: { x: app.stage.position.x, y: app.stage.position.y },
        contPos: { x: cont.position.x, y: cont.position.y },
        contScale: { x: cont.scale.x, y: cont.scale.y }
      } : null;
      this.requestRender();
      if (snap && app && cont) {
        queueMicrotask(() => {
          app.stage.position.set(snap.stagePos.x, snap.stagePos.y);
          cont.position.set(snap.contPos.x, snap.contPos.y);
          cont.scale.set(snap.contScale.x, snap.contScale.y);
        });
      }
    });
    this.onEffect("search:filter", ({ keyword }) => {
      this.filterKeyword = String(keyword ?? "").trim().toLowerCase();
      this.requestRender();
    });
    this.onEffect("tags:filter", ({ active }) => {
      const wasFiltering = this.filterTags.size > 0;
      this.filterTags = new Set(active);
      if (this.filterTags.size > 0) {
        if (!wasFiltering) {
          const lineage = this.resolve("lineage");
          this.#preFilterSegments = lineage?.explorerSegments?.() ? [...lineage.explorerSegments()] : [];
        }
        void this.#scanTagsAcrossPages();
      } else {
        this.#tagFlattenResults = null;
        this.renderedCellsKey = "";
        if (this.#preFilterSegments !== null) {
          const nav = get("@hypercomb.social/Navigation");
          nav?.goRaw?.(this.#preFilterSegments);
          this.#preFilterSegments = null;
        }
        this.requestRender();
      }
    });
    this.onEffect("move:preview", (payload) => {
      this.moveNames = payload?.names ?? null;
      this.renderedCellsKey = "";
      if (payload && this.cachedCellNames) {
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
        this.cellImageCache.clear();
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
      const wasActive = this.#clipboardView;
      if (payload?.active && payload.labels) {
        this.#clipboardView = {
          labels: new Set(payload.labels),
          sourceSegments: payload.sourceSegments ?? [],
          op: payload.op ?? "copy"
        };
        if (this.layer) this.layer.visible = true;
      } else {
        this.#clipboardView = null;
      }
      this.renderedCellsKey = "";
      if (wasActive && !payload?.active) {
        for (const label of wasActive.labels) {
          this.cellImageCache.delete(label);
          this.cellBorderColorCache.delete(label);
          this.cellTagsCache.delete(label);
          this.cellLinkCache.delete(label);
          this.cellSubstrateCache.delete(label);
          this.cellHideTextCache.delete(label);
        }
        this.#slots.clear();
        this.#pendingRemoves.clear();
        if (this.layer) this.layer.visible = true;
      }
      this.requestRender();
    });
    this.onEffect("clipboard:captured", (payload) => {
      if (!payload?.labels?.length) return;
      if (payload.op === "copy") {
        if (this.#flashTimer) clearTimeout(this.#flashTimer);
        this.#flashLabels = new Set(payload.labels);
        for (const label of payload.labels) {
          this.#heatByLabel.set(label, 1);
          this.#updateCellHeat(label, 1);
        }
        this.#flashTimer = setTimeout(() => {
          for (const label of this.#flashLabels) {
            this.#heatByLabel.delete(label);
            this.#updateCellHeat(label, 0);
          }
          this.#flashLabels.clear();
          this.#flashTimer = null;
        }, 600);
      }
    });
    this.onEffect("translation:tile-start", (payload) => {
      if (!payload?.labels?.length) return;
      for (const label of payload.labels) {
        this.#translatingLabels.add(label);
        this.#heatByLabel.set(label, 0.5);
        this.#updateCellHeat(label, 0.5);
      }
      if (!this.#translationPulseTimer) {
        this.#translationPulseTimer = setInterval(() => {
          if (!this.#translatingLabels.size) {
            clearInterval(this.#translationPulseTimer);
            this.#translationPulseTimer = null;
            return;
          }
          const t = Date.now() / 1e3;
          const pulse = 0.3 + 0.2 * Math.sin(t * 3);
          for (const label of this.#translatingLabels) {
            this.#heatByLabel.set(label, pulse);
            this.#updateCellHeat(label, pulse);
          }
        }, 100);
      }
    });
    this.onEffect("translation:tile-done", (payload) => {
      if (!payload?.label) return;
      this.#translatingLabels.delete(payload.label);
      this.#heatByLabel.delete(payload.label);
      this.#updateCellHeat(payload.label, 0);
    });
    this.onEffect("locale:changed", () => {
      if (this.atlas) {
        this.atlas.invalidateLabels();
      }
      this.renderedCellsKey = "";
      this.requestRender();
    });
    this.onEffect("labels:invalidated", () => {
      if (this.atlas) {
        this.atlas.invalidateLabels();
      }
      this.renderedCellsKey = "";
      this.requestRender();
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
        this.meshCells = [];
        this.meshCellsRev++;
      }
      this.#layerCellsCache.clear();
      this.renderedCellsKey = "";
      this.requestRender();
    });
    this.onEffect("render:set-pivot", (payload) => {
      if (this.#pivot !== payload.pivot) {
        this.#pivot = payload.pivot;
        this.atlas?.setPivot(payload.pivot);
        this.renderedCellsKey = "";
        this.requestRender();
      }
    });
    this.onEffect("render:set-text-only", (payload) => {
      if (this.#textOnly !== payload.textOnly) {
        this.#textOnly = payload.textOnly;
        this.shader?.setImageMix(payload.textOnly ? 0 : 1);
        cancelAnimationFrame(this.#substrateFadeRaf);
        this.#substrateFadeStart = null;
        this.requestRender();
      }
    });
    this.onEffect("substrate:changed", () => {
      this.#startSubstrateFade();
    });
    this.onEffect("substrate:ready", () => {
      this.renderedCellsKey = "";
      this.requestRender();
    });
    this.onEffect("substrate:applied", (payload) => {
      if (!payload?.cell) return;
      void this.#tryInPlaceCellUpdate(payload.cell, { dir: null }).then((done) => {
        this.cellSubstrateCache.delete(payload.cell);
        if (!done && this.#slots.seeded) {
          this.cellImageCache.delete(payload.cell);
          void this.renderIncremental({ changedContent: [payload.cell] });
        }
      });
    });
    this.onEffect("substrate:rerolled", (payload) => {
      if (!payload?.cell) return;
      void this.#tryInPlaceCellUpdate(payload.cell, { dir: null }).then((done) => {
        this.cellSubstrateCache.delete(payload.cell);
        if (!done && this.#slots.seeded) {
          this.cellImageCache.delete(payload.cell);
          void this.renderIncremental({ changedContent: [payload.cell] });
        }
      });
    });
    this.onEffect("tile:toggle-text", () => {
      this.#labelsVisible = !this.#labelsVisible;
      this.shader?.setLabelMix(this.#labelsVisible ? 1 : 0);
    });
    this.onEffect("visibility:show-hidden", ({ active }) => {
      this.#showHiddenItems = active;
      this.#layerCellsCache.clear();
      this.renderedCellsKey = "";
      this.requestRender();
    });
    this.onEffect("cell:place-at", (payload) => {
      void this.#handlePlaceAt(payload.cell, payload.index);
    });
    this.onEffect("cell:reorder", (payload) => {
      void this.#handleReorder(payload.labels);
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
      let hoverTags = [];
      for (const [label, cell] of this.renderedCells) {
        if (cell.q === payload.q && cell.r === payload.r) {
          hoverTags = this.cellTagsCache.get(label) ?? [];
          break;
        }
      }
      this.emitEffect("tile:hover-tags", { tags: hoverTags });
    });
    const ACCENT_COLORS = [
      [0.4, 0.85, 1],
      // glacier — cyan
      [1, 0.4, 0.7],
      // bloom — magenta-pink
      [0.2, 1, 0.6],
      // aurora — green
      [1, 0.6, 0.15],
      // ember — warm amber
      [0.65, 0.35, 1]
      // nebula — violet
    ];
    const stored = parseInt(localStorage.getItem("hc:neon-color") ?? "0", 10);
    if (stored >= 0 && stored < ACCENT_COLORS.length) {
      this.#accentColor = ACCENT_COLORS[stored];
    }
    if (this.shader) {
      const [r, g, b] = this.#accentColor;
      this.shader.setAccentColor(r, g, b);
    }
    this.onEffect("overlay:neon-color", ({ index }) => {
      this.#accentColor = ACCENT_COLORS[index] ?? ACCENT_COLORS[0];
      if (!this.shader) return;
      const [r, g, b] = this.#accentColor;
      this.shader.setAccentColor(r, g, b);
    });
    window.showCellsPoc = {
      publishCells: async (cells) => this.publishExplicitCellList(cells),
      signature: async () => {
        const lineage = this.resolve("lineage");
        return await this.computeSignatureLocation(lineage);
      }
    };
  };
  /**
   * Apply the layer's layout state to the live renderer. Called on every
   * cursor move (undo/redo/seek) so the visible configuration always
   * matches the layer at the current cursor position. At head this is a
   * no-op because every user intent commits and the live state already
   * matches — we still run it for symmetry so returning to head after a
   * rewound view restores whatever the layout was at head.
   *
   * Emits absolute-value events so the rest of the system (LayerCommitter,
   * atlases, shader subscribers) stays in lock-step. commitLayer dedupes
   * identical layouts, so redundant emits do not grow history.
   *
   * Fields with default-equivalent values in older layers (empty string,
   * zero gap) are skipped so legacy entries do not regress the live view
   * — the "crunched tiles" regression happened when historical layers
   * without populated layout were applied verbatim.
   */
  /**
   * Drop every label-keyed derived-state cache in one call. These six
   * maps are views of the same identity (facts derived from a
   * propsSig), so invalidation always happens together. Centralising
   * the clear keeps the cursor-change and explorer-ready paths from
   * having to list each map individually.
   */
  #invalidateAllLabelDerivedState = () => {
    this.cellImageCache.clear();
    this.cellBorderColorCache.clear();
    this.cellTagsCache.clear();
    this.cellLinkCache.clear();
    this.cellSubstrateCache.clear();
    this.cellHideTextCache.clear();
  };
  // Layout reconstruction was layer-driven via `content.layoutSig`.
  // The slim layer doesn't carry that field — layout is the live
  // bee's own state, owned by the layout drone, not embedded in
  // the lineage's history snapshot. If past-layout playback is
  // wanted, the layout bee should commit its own per-state
  // primitive (its own array of properties) and a reader should
  // ask THAT primitive at the cursor's position.
  #applyCursorLayout = async () => {
  };
  dispose = () => {
    window.removeEventListener("synchronize", this.requestRender);
    window.removeEventListener("navigate", this.requestRender);
    if (this.#newCellFadeRaf) {
      cancelAnimationFrame(this.#newCellFadeRaf);
      this.#newCellFadeRaf = 0;
    }
    this.#newCellFadeStart.clear();
    if (this.lineageChangeListening) {
      const lineage = this.resolve("lineage");
      lineage?.removeEventListener("change", this.onLineageChange);
      this.lineageChangeListening = false;
    }
  };
  // Briefly glow a newly created tile so the user can spot it, then ease out
  // to normal. Reuses the existing #heatByLabel pathway consumed by the SDF
  // shader's heat ring.
  #startNewCellFade = (label) => {
    this.#newCellFadeStart.set(label, performance.now());
    this.#heatByLabel.set(label, 1);
    this.#updateCellHeat(label, 1);
    if (this.#newCellFadeRaf) return;
    const tick = () => {
      const now = performance.now();
      let alive = false;
      for (const [cell, start] of this.#newCellFadeStart) {
        const elapsed = now - start;
        if (elapsed >= _ShowCellDrone.#NEW_CELL_FADE_MS) {
          this.#newCellFadeStart.delete(cell);
          this.#heatByLabel.delete(cell);
          this.#updateCellHeat(cell, 0);
          continue;
        }
        const t = 1 - elapsed / _ShowCellDrone.#NEW_CELL_FADE_MS;
        const eased = t * t * t;
        this.#heatByLabel.set(cell, eased);
        this.#updateCellHeat(cell, eased);
        alive = true;
      }
      this.#newCellFadeRaf = alive ? requestAnimationFrame(tick) : 0;
    };
    this.#newCellFadeRaf = requestAnimationFrame(tick);
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
    this.cachedCellNames = null;
    this.cachedLocalCellSet = null;
    this.cachedBranchSet = null;
    this.emitEffect("render:cell-count", { count: 0, labels: [] });
  };
  /**
   * Attach the i18n label resolver to the label atlas so cell directory names
   * are rendered as localized display text when a translation is registered.
   */
  attachLabelResolver = (atlas) => {
    const i18n = get(I18N_IOC_KEY);
    if (i18n) {
      atlas.setLabelResolver((directoryName) => i18n.resolveCell(directoryName));
    }
  };
  rebuildRenderResources = (renderer) => {
    this.clearMesh();
    this.shader = null;
    this.atlas = new HexLabelAtlas(renderer, 128, 8, 8);
    this.attachLabelResolver(this.atlas);
    this.imageAtlas = new HexImageAtlas(renderer, 256, 16, 16);
    this.cellImageCache.clear();
    this.atlasRenderer = renderer;
  };
  listCellFolders = async (dir) => {
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
  #readLayoutMode(_locationKey) {
    return "pinned";
  }
  #persistLayoutMode(mode) {
    const lineage = this.resolve("lineage");
    const locationKey = String(lineage?.explorerLabel?.() ?? "/");
    localStorage.setItem(this.#layoutModeKey(locationKey), mode);
  }
  async #orderByIndexPinned(dir, names, localCellSet) {
    const axial = this.resolve("axial");
    const maxSlot = axial?.count ?? 60;
    const sparse = new Array(maxSlot + 1).fill("");
    let nextFree = 0;
    const unindexed = [];
    for (const name of names) {
      if (!localCellSet.has(name)) {
        unindexed.push(name);
        continue;
      }
      try {
        const cellDir = await dir.getDirectoryHandle(name, { create: false });
        const props = await readCellProperties(cellDir);
        if (typeof props["index"] === "number") {
          const idx = props["index"];
          if (idx >= 0 && idx <= maxSlot) {
            if (sparse[idx] !== "") {
              unindexed.push(name);
            } else {
              sparse[idx] = name;
            }
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
        if (localCellSet.has(name)) {
          try {
            const cellDir = await dir.getDirectoryHandle(name, { create: false });
            await writeCellProperties(cellDir, { index: nextFree });
          } catch {
          }
        }
        nextFree++;
      }
    }
    return sparse;
  }
  /**
   * Central ordering strategy — all render paths route through here.
   * Pinned is the only mode: each cell sits at its persisted `index`
   * slot, gaps are preserved, and collision is resolved by moving the
   * loser to the next free slot (persisted on write). Returns a sparse
   * array where cellNames[i] → axial position i, with empty-string
   * entries marking unoccupied slots.
   */
  async #resolveCellOrder(_mode, dir, union, localCellSet, _lineage) {
    if (this.#clipboardView) {
      return [...union].sort((a, b) => a.localeCompare(b));
    }
    const cursor = window.ioc?.get?.("@diamondcoreprocessor.com/HistoryCursorService");
    const isRewound = cursor?.state?.rewound ?? false;
    let cellNames;
    if (isRewound && cursor) {
      const content = await cursor.layerContentAtCursor();
      const order = content?.cells ?? [];
      if (order.length > 0) {
        const unionSet = new Set(union);
        const filtered = order.filter((s) => unionSet.has(s));
        for (const s of union) {
          if (!filtered.includes(s)) filtered.push(s);
        }
        const axial = this.resolve("axial");
        const maxSlot = axial?.count ?? 60;
        const sparse = new Array(maxSlot + 1).fill("");
        for (let i = 0; i < filtered.length && i <= maxSlot; i++) {
          sparse[i] = filtered[i];
        }
        cellNames = sparse;
      } else {
        cellNames = await this.#orderByIndexPinned(dir, Array.from(union), localCellSet);
      }
    } else {
      cellNames = await this.#orderByIndexPinned(dir, Array.from(union), localCellSet);
    }
    if (this.filterKeyword) {
      const kw = this.filterKeyword;
      cellNames = cellNames.map((s) => s && s.toLowerCase().includes(kw) ? s : "");
    }
    return cellNames;
  }
  // #orderByIndex (dense-packed) removed — pinned is the only layout
  // mode. #orderByIndexPinned handles index assignment, collision
  // detection, and next-available-slot fallback in one pass.
  async #handlePlaceAt(cell, targetIndex) {
    const lineage = this.resolve("lineage");
    if (!lineage) return;
    const dir = await lineage.explorerDir();
    if (!dir) return;
    const localSeeds = await this.listCellFolders(dir);
    const entries = [];
    for (const name of localSeeds) {
      try {
        const cellDir = await dir.getDirectoryHandle(name, { create: false });
        const props = await readCellProperties(cellDir);
        entries.push({ name, index: typeof props["index"] === "number" ? props["index"] : entries.length });
      } catch {
        entries.push({ name, index: entries.length });
      }
    }
    entries.sort((a, b) => a.index - b.index);
    const names = entries.map((e) => e.name).filter((n) => n !== cell);
    const clamped = Math.max(0, Math.min(targetIndex, names.length));
    names.splice(clamped, 0, cell);
    await this.#writeIndices(dir, names);
    this.requestRender();
  }
  async #handleReorder(labels) {
    const lineage = this.resolve("lineage");
    if (!lineage) return;
    const dir = await lineage.explorerDir();
    if (!dir) return;
    await this.#writeIndices(dir, labels);
    this.renderedCellsKey = "";
    this.#layerCellsCache.clear();
    this.requestRender();
  }
  async #writeIndices(dir, orderedNames) {
    for (let i = 0; i < orderedNames.length; i++) {
      const name = orderedNames[i];
      try {
        const cellDir = await dir.getDirectoryHandle(name, { create: false });
        await writeCellProperties(cellDir, { index: i });
      } catch {
      }
    }
  }
  checkCellHasBranch = async (parentDir, cellName) => {
    try {
      const cellDir = await parentDir.getDirectoryHandle(cellName, { create: false });
      for await (const [name, handle] of cellDir.entries()) {
        if (handle.kind === "directory" && !name.startsWith("__")) return true;
      }
    } catch {
    }
    return false;
  };
  buildCellsFromAxial = (axial, names, max, localCellSet, branchSet) => {
    const out = [];
    const effectiveNames = this.moveNames ?? names;
    for (let i = 0; i < max; i++) {
      const a = axial.items.get(i);
      const label = effectiveNames[i] ?? names[i];
      if (!a) break;
      if (!label) continue;
      const div = this.#divergenceFutureAdds.has(label) ? 1 : this.#divergenceFutureRemoves.has(label) ? 2 : 0;
      out.push({ q: a.q, r: a.r, label, external: !localCellSet.has(label), heat: this.#heatByLabel.get(label) ?? 0, hasBranch: branchSet?.has(label) ?? false, divergence: div });
    }
    return out;
  };
  /**
   * Load cell properties from the content-addressed tile-props index
   * and resolve the small.image signature from __resources__/ into the image atlas.
   * Standard: any property value matching a 64-char hex signature
   * refers to a blob in __resources__/{signature}.
   */
  loadCellImages = async (cells, _dir, forceReload) => {
    const store = window.ioc?.get?.("@hypercomb.social/Store");
    if (!store || !this.imageAtlas) return;
    const imageAtlas = this.imageAtlas;
    const livePropsIndex = JSON.parse(localStorage.getItem("hc:tile-props-index") ?? "{}");
    const propsIndex = this.#cursorPropsOverride ? Object.fromEntries([...Object.entries(livePropsIndex), ...this.#cursorPropsOverride]) : livePropsIndex;
    const inFlightImages = /* @__PURE__ */ new Map();
    const loadImageOnce = (sig) => {
      if (imageAtlas.hasImage(sig) || imageAtlas.hasFailed(sig)) return Promise.resolve();
      const existing = inFlightImages.get(sig);
      if (existing) return existing;
      const promise = (async () => {
        try {
          const blob = await store.getResource(sig);
          if (!blob) {
            console.warn(`[ShowCell] loadImageOnce: blob missing for ${sig.slice(0, 12)}\u2026`);
            return;
          }
          await imageAtlas.loadImage(sig, blob);
          if (!imageAtlas.hasImage(sig)) {
            console.warn(`[ShowCell] loadImageOnce: atlas.loadImage completed but hasImage=false for ${sig.slice(0, 12)}\u2026`);
          }
        } catch (err) {
          console.warn(`[ShowCell] loadImageOnce: threw for ${sig.slice(0, 12)}\u2026`, err);
        }
      })();
      inFlightImages.set(sig, promise);
      return promise;
    };
    const loadOne = async (cell) => {
      if (cell.external) return;
      if (!this.cellTagsCache.has(cell.label)) {
        try {
          const cellDir = await _dir.getDirectoryHandle(cell.label);
          const tagProps = await readCellProperties(cellDir);
          const rawTags = tagProps?.["tags"];
          this.cellTagsCache.set(cell.label, Array.isArray(rawTags) ? rawTags.filter((t) => typeof t === "string") : []);
          if (!this.cellLinkCache.has(cell.label)) {
            this.cellLinkCache.set(cell.label, typeof tagProps?.["link"] === "string" && tagProps["link"].length > 0);
          }
        } catch {
          this.cellTagsCache.set(cell.label, []);
        }
      }
      if (!forceReload?.has(cell.label) && this.cellImageCache.has(cell.label)) {
        const cachedSig = this.cellImageCache.get(cell.label) ?? void 0;
        cell.imageSig = cachedSig;
        cell.borderColor = this.cellBorderColorCache.get(cell.label);
        cell.hasLink = this.cellLinkCache.get(cell.label) ?? false;
        cell.hasSubstrate = this.cellSubstrateCache.get(cell.label) ?? false;
        cell.hideText = this.cellHideTextCache.get(cell.label) ?? false;
        if (cachedSig) {
          if (!imageAtlas.hasImage(cachedSig) && !imageAtlas.hasFailed(cachedSig)) {
            console.log(`[ShowCell] fast-path reload ${cell.label} sig=${cachedSig.slice(0, 12)}\u2026`);
            await loadImageOnce(cachedSig);
            if (!imageAtlas.hasImage(cachedSig)) {
              console.warn(`[ShowCell] fast-path reload FAILED for ${cell.label} sig=${cachedSig.slice(0, 12)}\u2026`);
            }
          }
        } else {
          this.cellImageCache.delete(cell.label);
          console.log(`[ShowCell] clearing stale null cache for ${cell.label}, retrying`);
        }
        if (this.cellImageCache.has(cell.label)) return;
      }
      try {
        const propsSig = propsIndex[cell.label];
        if (!propsSig) {
          console.log(`[ShowCell] slow-path: no propsSig for ${cell.label} (propsIndex has ${Object.keys(propsIndex).length} entries, override=${this.#cursorPropsOverride?.size ?? 0})`);
          throw new Error("no props");
        }
        const blob = await store.getResource(propsSig);
        if (!blob) {
          console.warn(`[ShowCell] slow-path: propsSig ${propsSig.slice(0, 12)}\u2026 resolved to null blob for ${cell.label}`);
          throw new Error("no blob");
        }
        const text = await blob.text();
        const props = JSON.parse(text);
        const bc = props?.border?.color;
        if (bc && typeof bc === "string" && /^#?[0-9a-fA-F]{6}$/.test(bc.replace("#", ""))) {
          const hex = bc.startsWith("#") ? bc : `#${bc}`;
          const r = parseInt(hex.slice(1, 3), 16) / 255;
          const g = parseInt(hex.slice(3, 5), 16) / 255;
          const b = parseInt(hex.slice(5, 7), 16) / 255;
          cell.borderColor = [r, g, b];
          this.cellBorderColorCache.set(cell.label, [r, g, b]);
        }
        const cellTags = props?.["tags"];
        if (Array.isArray(cellTags)) {
          this.cellTagsCache.set(cell.label, cellTags.filter((t) => typeof t === "string"));
        } else {
          this.cellTagsCache.set(cell.label, []);
        }
        const hasLink = typeof props?.link === "string" && props.link.length > 0;
        this.cellLinkCache.set(cell.label, hasLink);
        cell.hasLink = hasLink;
        const isSubstrate = props?.substrate === true;
        this.cellSubstrateCache.set(cell.label, isSubstrate);
        cell.hasSubstrate = isSubstrate;
        const hideText = props?.hideText === true;
        this.cellHideTextCache.set(cell.label, hideText);
        cell.hideText = hideText;
        const smallSig = this.#flat && props?.flat?.small?.image || props?.small?.image;
        if (smallSig && isSignature(smallSig)) {
          await loadImageOnce(smallSig);
          cell.imageSig = smallSig;
          this.cellImageCache.set(cell.label, smallSig);
          if (!imageAtlas.hasImage(smallSig)) {
            console.warn(`[ShowCell] slow-path loaded props for ${cell.label} but atlas has no image. propsSig=${propsSig.slice(0, 12)}\u2026 smallSig=${smallSig.slice(0, 12)}\u2026 flat=${this.#flat}`);
          }
        } else {
          console.log(`[ShowCell] slow-path: no image in props for ${cell.label} propsSig=${propsSig.slice(0, 12)}\u2026 flat=${this.#flat} props.small=${JSON.stringify(props?.small)} props.flat=${JSON.stringify(props?.flat)}`);
          this.cellImageCache.set(cell.label, null);
        }
      } catch {
        this.cellImageCache.set(cell.label, null);
      }
    };
    await Promise.all(cells.map(loadOne));
  };
  buildCellsKey = (cells) => {
    const selectionService = window.ioc?.get?.("@diamondcoreprocessor.com/SelectionService");
    const atlasGen = this.imageAtlas?.evictionGeneration ?? 0;
    let s = `p${this.#pivot ? 1 : 0}f${this.#flat ? 1 : 0}g${atlasGen}|`;
    for (const c of cells) s += `${c.q},${c.r}:${c.label}:${c.external ? 1 : 0}:${c.imageSig ?? ""}:${c.hasBranch ? 1 : 0}:${c.divergence ?? 0}:${c.hideText ? 1 : 0}|`;
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
    const divergence = new Float32Array(cells.length * 4);
    const idx = new Uint32Array(cells.length * 6);
    let pv = 0, uvp = 0, luvp = 0, iuvp = 0, hip = 0, hp = 0, icp = 0, bp = 0, bcp = 0, cip = 0, dp = 0, ii = 0, base = 0;
    let ci = 0;
    for (const c of cells) {
      const { x, y } = this.axialToPixel(c.q, c.r, spacing, this.#flat);
      const x0 = x - hw, x1 = x + hw;
      const y0 = y - hh, y1 = y + hh;
      pos.set([x0, y0, x1, y0, x1, y1, x0, y1], pv);
      pv += 8;
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], uvp);
      uvp += 8;
      const imgUV = c.imageSig ? this.imageAtlas?.getImageUV(c.imageSig) ?? null : null;
      const ruv = c.hideText && imgUV ? { u0: 0, v0: 0, u1: 0, v1: 0 } : this.atlas.getLabelUV(c.label);
      for (let i = 0; i < 4; i++) {
        labelUV.set([ruv.u0, ruv.v0, ruv.u1, ruv.v1], luvp);
        luvp += 4;
      }
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
      let [cr, cg, cb] = labelToRgb(c.label);
      const isHiddenItem = this.#showHiddenItems && this.#currentHiddenSet.has(c.label);
      if (isHiddenItem) {
        const gray = cr * 0.3 + cg * 0.3 + cb * 0.3;
        cr = gray * 0.5;
        cg = gray * 0.5;
        cb = gray * 0.5;
      }
      identityColor.set([cr, cg, cb, cr, cg, cb, cr, cg, cb, cr, cg, cb], icp);
      icp += 12;
      const b = c.hasBranch ? 1 : 0;
      branch.set([b, b, b, b], bp);
      bp += 4;
      let [bcr, bcg, bcb] = c.borderColor ?? [0.784, 0.592, 0.353];
      if (isHiddenItem) {
        const bgray = bcr * 0.3 + bcg * 0.3 + bcb * 0.3;
        bcr = bgray * 0.5;
        bcg = bgray * 0.5;
        bcb = bgray * 0.5;
      }
      borderColor.set([bcr, bcg, bcb, bcr, bcg, bcb, bcr, bcg, bcb, bcr, bcg, bcb], bcp);
      bcp += 12;
      cellIndex.set([ci, ci, ci, ci], cip);
      cip += 4;
      ci++;
      const dv = c.divergence ?? 0;
      divergence.set([dv, dv, dv, dv], dp);
      dp += 4;
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
    g.addAttribute("aDivergence", divergence, 1);
    g.addIndex(idx);
    this.#buf = { pos, labelUV, imageUV, hasImage, heat, identityColor, branch, borderColor, divergence };
    this.#labelToIndex.clear();
    for (let i = 0; i < cells.length; i++) this.#labelToIndex.set(cells[i].label, i);
    return g;
  }
  // ─────────────────────────────────────────────────────────────────────
  // Per-cell buffer slice accessors — the standard way to write cell data
  // into a geometry attribute buffer. All per-cell writes go through these
  // helpers; the strides are not repeated anywhere else in this file.
  //
  // Each hex is a quad with 4 vertices. Attributes come in three shapes:
  //   - scalar (1 float/vertex) → 4 floats per cell
  //   - rgb    (3 floats/vertex) → 12 floats per cell
  //   - vec4   (4 floats/vertex) → 16 floats per cell
  // ─────────────────────────────────────────────────────────────────────
  #writeCellScalar(buf, i, value) {
    if (!buf) return;
    const b = i * 4;
    buf[b] = value;
    buf[b + 1] = value;
    buf[b + 2] = value;
    buf[b + 3] = value;
  }
  #writeCellRgb(buf, i, r, g, bl) {
    if (!buf) return;
    const b = i * 12;
    for (let v = 0; v < 4; v++) {
      buf[b + v * 3] = r;
      buf[b + v * 3 + 1] = g;
      buf[b + v * 3 + 2] = bl;
    }
  }
  #writeCellVec4(buf, i, a, b, c, d) {
    if (!buf) return;
    const base = i * 16;
    for (let v = 0; v < 4; v++) {
      buf[base + v * 4] = a;
      buf[base + v * 4 + 1] = b;
      buf[base + v * 4 + 2] = c;
      buf[base + v * 4 + 3] = d;
    }
  }
  /** Push a named attribute's CPU-side buffer to the GPU. Returns false if not available. */
  #pushBuffer(attrName) {
    const g = this.geom;
    try {
      g?.getAttribute?.(attrName)?.buffer?.update?.();
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Phase 2 fast path for tile:saved — mutate the single cell's attribute
   * slices directly and push to GPU. Skips geometry rebuild entirely.
   * Returns true on success; false if the caller should fall back to the
   * incremental render path.
   */
  #tryInPlaceCellUpdate = async (label, _ctx) => {
    const i = this.#labelToIndex.get(label);
    if (i === void 0) return false;
    const { imageUV, hasImage, borderColor, labelUV } = this.#buf;
    if (!imageUV || !hasImage || !borderColor || !labelUV) return false;
    if (!this.geom || !this.imageAtlas || !this.atlas) return false;
    const lineage = this.resolve("lineage");
    const dir = _ctx.dir ?? await lineage?.explorerDir?.();
    if (!dir) return false;
    const probe = { q: 0, r: 0, label, external: false };
    try {
      await this.loadCellImages([probe], dir, /* @__PURE__ */ new Set([label]));
    } catch {
      return false;
    }
    const sig = this.cellImageCache.get(label) ?? null;
    const imgUV = sig ? this.imageAtlas.getImageUV(sig) ?? null : null;
    if (imgUV) {
      this.#writeCellVec4(imageUV, i, imgUV.u0, imgUV.v0, imgUV.u1, imgUV.v1);
    } else {
      this.#writeCellVec4(imageUV, i, 0, 0, 0, 0);
    }
    this.#writeCellScalar(hasImage, i, imgUV ? 1 : 0);
    const [bcr, bcg, bcb] = this.cellBorderColorCache.get(label) ?? [0.784, 0.592, 0.353];
    this.#writeCellRgb(borderColor, i, bcr, bcg, bcb);
    const ht = this.cellHideTextCache.get(label) ?? false;
    if (ht && imgUV) {
      this.#writeCellVec4(labelUV, i, 0, 0, 0, 0);
    } else {
      const ruv = this.atlas.getLabelUV(label);
      this.#writeCellVec4(labelUV, i, ruv.u0, ruv.v0, ruv.u1, ruv.v1);
    }
    if (!this.#pushBuffer("aImageUV") || !this.#pushBuffer("aHasImage") || !this.#pushBuffer("aBorderColor") || !this.#pushBuffer("aLabelUV")) {
      return false;
    }
    const rec = this.renderedCells.get(label);
    if (rec) {
      rec.imageSig = sig ?? void 0;
      rec.borderColor = [bcr, bcg, bcb];
      rec.hasLink = this.cellLinkCache.get(label) ?? false;
      rec.hasSubstrate = this.cellSubstrateCache.get(label) ?? false;
      rec.hideText = ht;
      const cellsSnapshot = [...this.renderedCells.values()];
      this.renderedCellsKey = this.buildCellsKey(cellsSnapshot);
    }
    this.#emitRenderTags([...this.renderedCells.values()]);
    return true;
  };
  /**
   * Phase 2 fast path for heat — mutate just the heat slice for one cell
   * and push the aHeat buffer. Used by the new-cell fade RAF loop so it
   * never triggers a full render per frame.
   * Returns true on success; false if the label isn't currently indexed
   * (in which case the caller may skip or fall back to requestRender).
   */
  #updateCellHeat(label, heatValue) {
    const i = this.#labelToIndex.get(label);
    if (i === void 0) return false;
    if (!this.#buf.heat || !this.geom) return false;
    this.#writeCellScalar(this.#buf.heat, i, heatValue);
    return this.#pushBuffer("aHeat");
  }
};
var showCell = new ShowCellDrone();
window.ioc.register("@diamondcoreprocessor.com/ShowCellDrone", showCell);
export {
  ShowCellDrone
};
