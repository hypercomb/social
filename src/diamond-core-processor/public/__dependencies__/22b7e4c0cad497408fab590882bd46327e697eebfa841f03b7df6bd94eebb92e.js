// @diamondcoreprocessor.com/presentation/grid
// src/diamondcoreprocessor.com/presentation/grid/axial-coordinate.ts
import { Point } from "pixi.js";
var { get } = window.ioc;
var AxialCoordinate = class _AxialCoordinate {
  constructor(q, r, s, height, width) {
    this.q = q;
    this.r = r;
    this.s = s;
    this.height = height;
    this.width = width;
    this.Location = _AxialCoordinate.getLocation(q, r, s);
  }
  static axialToIndex = /* @__PURE__ */ new Map();
  Location = new Point(0, 0);
  color;
  get index() {
    return Number(_AxialCoordinate.axialToIndex.get(this.hashCode()));
  }
  static add(a, b) {
    return new _AxialCoordinate(a.q + b.q, a.r + b.r, a.s + b.s, a.height, a.width);
  }
  static subtract(a, b) {
    return new _AxialCoordinate(a.q - b.q, a.r - b.r, a.s - b.s, a.height, a.width);
  }
  static equals(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.q === b.q && a.r === b.r && a.s === b.s;
  }
  hashCode() {
    return _AxialCoordinate.cantorPairing(this.q, this.r);
  }
  static cantorPairing(q, r) {
    let a = q >= 0 ? 2 * q : -2 * q - 1;
    let b = r >= 0 ? 2 * r : -2 * r - 1;
    return (a + b) * (a + b + 1) / 2 + b;
  }
  static getLocation = (q, r, s) => {
    const settings = get("@diamondcoreprocessor.com/Settings");
    let xCoord = settings.hexagonSide * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
    let yCoord = settings.hexagonSide * (3 / 2 * r);
    return new Point(xCoord, yCoord);
  };
  static setIndex(coordinate, newIndex) {
    _AxialCoordinate.axialToIndex.set(coordinate.hashCode(), newIndex);
  }
};

// src/diamondcoreprocessor.com/presentation/grid/axial-service.ts
var distance = (a, b) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};
var AxialService = class {
  count = 0;
  items = /* @__PURE__ */ new Map();
  Adjacents = /* @__PURE__ */ new Map();
  settings;
  width = 0;
  height = 0;
  initialized = false;
  initialize = (settings) => {
    if (this.initialized) return;
    this.settings = settings;
    const { width, height } = this.settings.hexagonDimensions;
    this.width = width;
    this.height = height;
    this.createMatrix();
    this.initialized = true;
  };
  createAdjacencyList = () => {
    this.items.forEach((axial, index) => {
      this.Adjacents.set(index, this.getAdjacentCoordinates(axial));
    });
  };
  createMatrix = () => {
    const rings = this.settings.rings;
    let coordinate = this.newCoordinate(0, 0, 0);
    AxialCoordinate.setIndex(coordinate, this.count);
    this.items.set(this.count, coordinate);
    for (let n = 0; n < rings; n++) {
      let axial = this.newCoordinate(this.Start.q, this.Start.r, this.Start.s);
      axial = AxialCoordinate.subtract(axial, this.newCoordinate(n, 0, n));
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < n; j++) {
          switch (i) {
            case 0:
              axial = AxialCoordinate.add(axial, this.newCoordinate(1, -1, 0));
              break;
            case 1:
              axial = AxialCoordinate.add(axial, this.newCoordinate(1, 0, -1));
              break;
            case 2:
              axial = AxialCoordinate.add(axial, this.newCoordinate(0, 1, -1));
              break;
            case 3:
              axial = AxialCoordinate.add(axial, this.newCoordinate(-1, 1, 0));
              break;
            case 4:
              axial = AxialCoordinate.add(axial, this.newCoordinate(-1, 0, 1));
              break;
            default:
              axial = AxialCoordinate.add(axial, this.newCoordinate(0, -1, 1));
              break;
          }
          coordinate = this.newCoordinate(axial.q, axial.r, axial.s);
          AxialCoordinate.setIndex(coordinate, ++this.count);
          this.items.set(coordinate.index, coordinate);
        }
      }
    }
    this.createAdjacencyList();
  };
  get Start() {
    return this.newCoordinate(0, 0, 0);
  }
  getAdjacentCoordinates = (axial) => {
    return [
      this.newCoordinate(axial.q + 1, axial.r - 1, axial.s),
      // northeast
      this.newCoordinate(axial.q + 1, axial.r, axial.s - 1),
      // east
      this.newCoordinate(axial.q, axial.r + 1, axial.s - 1),
      // southeast
      this.newCoordinate(axial.q - 1, axial.r + 1, axial.s),
      // southwest
      this.newCoordinate(axial.q - 1, axial.r, axial.s + 1),
      // west
      this.newCoordinate(axial.q, axial.r - 1, axial.s + 1)
      // northwest
    ];
  };
  closestAxial = (local) => {
    if (!local) return void 0;
    const width = this.settings.hexagonDimensions.width;
    const height = this.settings.hexagonDimensions.height;
    const threshold = Math.min(width / 2, 0.75 * height / 2);
    let closest;
    let minDistance = Infinity;
    for (const item of this.items.values()) {
      const dist = distance(local, item.Location);
      if (dist < minDistance) {
        minDistance = dist;
        closest = item;
      }
    }
    return closest;
  };
  newCoordinate = (q, r, s) => {
    const coordinate = new AxialCoordinate(q, r, s);
    coordinate.width = this.width;
    coordinate.height = this.height;
    return coordinate;
  };
};
window.ioc.register("@diamondcoreprocessor.com/AxialService", new AxialService());

// src/diamondcoreprocessor.com/presentation/grid/hex-geometry.ts
function createHexGeometry(circumRadiusPx, gapPx, padPx = 10) {
  return { circumRadiusPx, gapPx, padPx, spacing: circumRadiusPx + gapPx };
}
var DEFAULT_HEX_GEOMETRY = createHexGeometry(32, 6);

// src/diamondcoreprocessor.com/presentation/grid/hex-image.atlas.ts
import { Container, RenderTexture, Sprite, Texture } from "pixi.js";
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
    this.#atlas = RenderTexture.create({
      width: this.#cols * this.#cellPx,
      height: this.#rows * this.#cellPx,
      resolution: 2,
      scaleMode: "linear",
      antialias: true
    });
    this.#renderer.render({ container: new Container(), target: this.#atlas, clear: true });
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
    const texture = Texture.from(bitmap);
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

// src/diamondcoreprocessor.com/presentation/grid/hex-label.atlas.ts
import { Container as Container2, RenderTexture as RenderTexture2, Text, TextStyle } from "pixi.js";
var HexLabelAtlas = class {
  constructor(renderer, cellPx = 128, cols = 8, rows = 8) {
    this.renderer = renderer;
    this.cellPx = cellPx;
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    this.atlas = RenderTexture2.create({
      width: this.cols * this.cellPx,
      height: this.rows * this.cellPx,
      resolution: 8
    });
    this.renderer.render({ container: new Container2(), target: this.atlas, clear: true });
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
    this.renderer.render({ container: new Container2(), target: this.atlas, clear: true });
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

        // vignette: darken image edges so snapshots blend into border
        float vignette = smoothstep(0.5, 1.0, dist);
        base.rgb *= 1.0 - vignette * 0.45;

        // outer border ring \u2014 crisp bright line
        float outerRing = 1.0 - smoothstep(0.0, aa * 1.2, abs(d));
        base.rgb = mix(base.rgb, vBorderColor, outerRing * 0.6);

        // inner glow border \u2014 wider, softer
        float innerGlow = 1.0 - smoothstep(0.0, aa * 3.5, abs(d + aa * 1.5));
        base.rgb = mix(base.rgb, vBorderColor, innerGlow * 0.12);
      } else {
        // radial gradient fill: lighter center \u2192 darker edges (depth illusion)
        vec3 bgCenter = vec3(0.06, 0.14, 0.22);
        vec3 bgEdge   = vec3(0.03, 0.08, 0.13);
        vec3 bgColor  = mix(bgCenter, bgEdge, smoothstep(0.0, 1.0, dist));
        base = vec4(bgColor, 1.0);

        // outer border ring \u2014 crisp bright line
        float outerRing = 1.0 - smoothstep(0.0, aa * 1.2, abs(d));
        base.rgb = mix(base.rgb, vBorderColor, outerRing * 0.6);

        // inner glow border \u2014 wider, softer, identity-tinted
        float innerGlow = 1.0 - smoothstep(0.0, aa * 3.5, abs(d + aa * 1.5));
        base.rgb = mix(base.rgb, vBorderColor, innerGlow * 0.15);

        // subtle identity wash on cell interior
        float innerMask = smoothstep(0.0, -2.0, d);
        base.rgb = mix(base.rgb, vIdentityColor, innerMask * 0.06);
      }

      // bevel highlight (top-left light) and shadow (bottom-right)
      float highlightStrength = max(bevelDot, 0.0) * edgeProximity * 0.06;
      float shadowStrength = max(-bevelDot, 0.0) * edgeProximity * 0.08;
      base.rgb += vec3(1.0) * highlightStrength;
      base.rgb -= vec3(1.0) * shadowStrength;

      vec4 color = base;

      if (vHasImage < 0.5) {
        // label for cells without snapshot
        vec2 luv = mix(vLabelUV.xy, vLabelUV.zw, vUV);
        float labelAlpha = texture2D(u_label, luv).a;
        float la = smoothstep(0.02, 0.5, labelAlpha);
        color = mix(color, vec4(1.0, 1.0, 1.0, 1.0), la * 0.92 * u_labelMix);

        // ambient presence \u2014 identity color at rest, shifts to warm amber with heat
        float heatRing = smoothstep(0.0, -1.5, d) - smoothstep(-4.0, -6.0, d);
        vec3 warmColor = vec3(1.0, 0.62, 0.12);
        vec3 heatTint = mix(vIdentityColor, warmColor, vHeat);
        float heatAlpha = mix(0.07, 0.68, vHeat);
        color.rgb = mix(color.rgb, heatTint, heatRing * heatAlpha);
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

// src/diamondcoreprocessor.com/presentation/grid/simplex-noise.ts
var F2 = 0.5 * (Math.sqrt(3) - 1);
var G2 = (3 - Math.sqrt(3)) / 6;
var grad2 = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1]
];
var perm = new Uint8Array(512);
var grad = new Uint8Array(512);
(() => {
  let s = 0;
  for (let i = 0; i < 256; i++) {
    s = s * 1664525 + 1013904223 + i >>> 0;
    perm[i] = perm[i + 256] = s >>> 16 & 255;
    grad[i] = grad[i + 256] = perm[i] % 12;
  }
})();
function dot2(gi, x, y) {
  const g = grad2[gi];
  return g[0] * x + g[1] * y;
}
function noise2D(xin, yin) {
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  const ii = i & 255;
  const jj = j & 255;
  let n0 = 0, n1 = 0, n2 = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    t0 *= t0;
    n0 = t0 * t0 * dot2(grad[ii + perm[jj]], x0, y0);
  }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    t1 *= t1;
    n1 = t1 * t1 * dot2(grad[ii + i1 + perm[jj + j1]], x1, y1);
  }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    t2 *= t2;
    n2 = t2 * t2 * dot2(grad[ii + 1 + perm[jj + 1]], x2, y2);
  }
  return 70 * (n0 + n1 + n2);
}
export {
  AxialCoordinate,
  AxialService,
  DEFAULT_HEX_GEOMETRY,
  HexImageAtlas,
  HexLabelAtlas,
  HexLabelAtlasFactory,
  HexSdfTextureShader,
  HexSdfTextureShaderFactory,
  createHexGeometry,
  distance,
  noise2D
};
