// pixi/hex-sdf.shader.ts
import { Shader, Texture } from 'pixi.js'

type Vec2 = [number, number]

export class HexSdfTextureShader {
  public shader: Shader

  // Pixi v8 separates uniform structures ({ value, type }) from the flat values
  // it uploads to the GPU. We must update the flat values via the uniform group's
  // .uniforms property, then call .update() to mark dirty for re-upload.
  #ug: any // UniformGroup — holds .uniforms (flat GPU values)

  constructor(labelAtlas: Texture, cellImageAtlas: Texture, quadW: number, quadH: number, radiusPx: number) {
    const uniformDefs = {
      u_quadSize: { value: [quadW, quadH], type: 'vec2<f32>' },
      u_radiusPx: { value: radiusPx, type: 'f32' },
      u_flat: { value: 0, type: 'f32' },
      u_pivot: { value: 0, type: 'f32' },
      u_hoveredIndex: { value: -1, type: 'f32' },
      // Rows the HOVERED tile's label band must hold — the NAME's row plus one
      // per icon row (2 while the icons fit one row, 3 once they wrap). The
      // band grows only when it has to, so a tile with no icons keeps the
      // text's own height. Owned by the overlay (it does the wrapping) and
      // pushed through `overlay:band-rows`.
      u_bandRows: { value: 1, type: 'f32' },
      u_labelMix: { value: 1.0, type: 'f32' },
      // 1 = this shader draws the name glyphs from the SDF atlas; 0 = the DOM
      // name layer (tile-name.drone.ts) draws them as real vector text and the
      // shader keeps only the band behind them. Launcher shapes (games) keep
      // their own strip either way — the DOM layer stands aside for those.
      u_glyphs: { value: 1.0, type: 'f32' },
      u_imageMix: { value: 1.0, type: 'f32' },
      u_accentColor: { value: [0.4, 0.85, 1.0], type: 'vec3<f32>' },
      // Launcher motion (vertex stage). u_driftAmp = 0 disables it entirely
      // (the common case); > 0 lets the game tiles march to u_time. See
      // vertexSource.
      u_time: { value: 0, type: 'f32' },
      u_driftAmp: { value: 0, type: 'f32' },
      // Pheromone preview (fragment stage). While a mark is under the cursor
      // ANYWHERE in the chrome — a panel row, a bouquet, a bottom crumb — every
      // tile carrying it lights in u_markColor and the rest of the page recedes.
      // u_markPreview is the 0..1 strength of the whole treatment, so it fades
      // in and out instead of snapping; 0 (nothing hovered) is the common case
      // and costs one branch. The carrier flag is per-tile: aDivergence == 3.
      u_markColor: { value: [0.55, 0.85, 1.0], type: 'vec3<f32>' },
      u_markPreview: { value: 0, type: 'f32' },
      // THE SWAP (fragment stage). While the clipboard window is open a click
      // on a tile MOVES it — so the hovered tile cannot go on reading like the
      // navigation ring, which promises the opposite (you go in, the tile
      // stays). 0 = not in swap mode (the common case, one branch); 1 = the
      // click TAKES this tile; 2 = it COPIES it. u_swapColor is the verb's own
      // colour, and it is the SAME value the cue pill above the hex is drawn
      // in (TileOverlayDrone) — one verb, one colour, two marks.
      u_swapMode: { value: 0, type: 'f32' },
      u_swapColor: { value: [1.0, 0.77, 0.5], type: 'vec3<f32>' },
      // Tile silhouette is PER-TILE — the `aShapeMode` vertex attribute (0 =
      // hexagon · 2 = Space Invader; 1 retired), so a mixed
      // launch-group page renders each group's OWN shape and groups never share a
      // visual type. There is no global u_shapeMode uniform; see both shaders.
      // 3..7 are not shapes but the quick menu's HONEY material, worn only by the
      // flower's option tiles (show-cell #paintFlower): 3 rest · 4 back · 5 lit ·
      // 6 back lit · 7 lit with its one slow drip. All hexagons.
      // The quick menu's CRAFTED BACKGROUNDS (quickmenu/quick-menu.honey-art.ts):
      // u_honeyArt is one atlas, a column per variation, rest on the top row and
      // pre-lit below; u_honeyArtGrid is (columns, pad px), columns 0 until the
      // pictures are drawn. A honey cell names its variation in aHeat as index + 1
      // (0 = none: the procedural honey) — honey never wears the heat ring, so the
      // channel is free there, and every other tile's heat is untouched.
      u_honeyArtGrid: { value: [0, 0], type: 'vec2<f32>' },
    }

    // v8 shaded mesh requires uniforms nested under a group and shader inputs using in/out
    this.shader = Shader.from({
      gl: { vertex: HexSdfTextureShader.vertexSource, fragment: HexSdfTextureShader.fragmentSource },
      resources: {
        uniforms: uniformDefs,
        u_label: this.toSource(labelAtlas),
        u_cellImages: this.toSource(cellImageAtlas),
        u_honeyArt: this.toSource(Texture.WHITE),
      },
    })

    // cache the uniform group so setters can update GPU-side flat values
    this.#ug = (this.shader.resources as any).uniforms
  }

  public setQuadSize = (w: number, h: number): void => {
    const v = this.#ug.uniforms.u_quadSize
    v[0] = w; v[1] = h
    this.#ug.update()
  }

  public setRadiusPx = (r: number): void => {
    this.#ug.uniforms.u_radiusPx = r
    this.#ug.update()
  }

  public setFlat = (flat: boolean): void => {
    this.#ug.uniforms.u_flat = flat ? 1.0 : 0.0
    this.#ug.update()
  }

  public setPivot = (pivot: boolean): void => {
    this.#ug.uniforms.u_pivot = pivot ? 1.0 : 0.0
    this.#ug.update()
  }

  public setHoveredIndex = (index: number): void => {
    this.#ug.uniforms.u_hoveredIndex = index
    this.#ug.update()
  }

  /** Rows the hovered tile's label band must hold (name row + icon rows). */
  public setBandRows = (rows: number): void => {
    this.#ug.uniforms.u_bandRows = rows
    this.#ug.update()
  }

  public setLabelMix = (mix: number): void => {
    this.#ug.uniforms.u_labelMix = mix
    this.#ug.update()
  }

  /** 0 hands the name glyphs to the DOM name layer; 1 draws them here. */
  setGlyphs(on: number): void {
    this.#ug.uniforms.u_glyphs = on
  }

  public setImageMix = (mix: number): void => {
    this.#ug.uniforms.u_imageMix = mix
    this.#ug.update()
  }

  public setAccentColor = (r: number, g: number, b: number): void => {
    const v = this.#ug.uniforms.u_accentColor
    v[0] = r; v[1] = g; v[2] = b
    this.#ug.update()
  }

  /** Advance the drift clock (seconds). Only has a visible effect while
   *  u_driftAmp > 0; cheap to call every frame. */
  public setTime = (t: number): void => {
    this.#ug.uniforms.u_time = t
    this.#ug.update()
  }

  /** Per-tile drift amplitude in world (mesh-local) units. 0 = no drift. Kept a
   *  small fraction of the hex radius by the caller so a drifting tile never
   *  leaves its pointer→axial click catchment. */
  public setDriftAmp = (amp: number): void => {
    this.#ug.uniforms.u_driftAmp = amp
    this.#ug.update()
  }

  /** The hovered pheromone's own colour — what its carriers light up in. */
  public setMarkColor = (r: number, g: number, b: number): void => {
    const v = this.#ug.uniforms.u_markColor
    v[0] = r; v[1] = g; v[2] = b
    this.#ug.update()
  }

  /** Strength of the pheromone preview, 0..1. 0 disables it entirely (no tile
   *  is lit, nothing is dimmed); the caller ramps it so the hive breathes into
   *  the answer rather than flashing it. */
  public setMarkPreview = (k: number): void => {
    this.#ug.uniforms.u_markPreview = k
    this.#ug.update()
  }

  /** THE SWAP HOVER. 0 = off · 1 = the click takes this tile · 2 = it copies
   *  it · 3 = the hexagon walk (enter, landing on the grid). Anything but 0 replaces the navigation ring on the hovered tile with
   *  the cut rim — see the fragment source. */
  public setSwapMode = (mode: number): void => {
    this.#ug.uniforms.u_swapMode = mode
    this.#ug.update()
  }

  /** The swap verb's colour — the same one the cue pill is drawn in. */
  public setSwapColor = (r: number, g: number, b: number): void => {
    const v = this.#ug.uniforms.u_swapColor
    v[0] = r; v[1] = g; v[2] = b
    this.#ug.update()
  }


  public setLabelAtlas = (t: Texture): void => {
    ;(this.shader.resources as any).u_label = this.toSource(t)
  }

  public setCellImageAtlas = (t: Texture): void => {
    ;(this.shader.resources as any).u_cellImages = this.toSource(t)
  }

  /** The quick menu's crafted backgrounds: the atlas, its column count and the
   *  pad round each cell in px. Null (or 0 columns) puts every honey cell back on
   *  the procedural honey. */
  public setHoneyArt = (t: Texture | null, columns: number, pad: number): void => {
    ;(this.shader.resources as any).u_honeyArt = this.toSource(t ?? Texture.WHITE)
    const v = this.#ug.uniforms.u_honeyArtGrid
    v[0] = t ? columns : 0; v[1] = pad
    this.#ug.update()
  }

  private toSource = (t: Texture): any => {
    return (t as any).source ?? (t as any).baseTexture?.source ?? (t as any).texture?.source
  }

  // note: use in/out so pixi v8 can compile consistently
  private static vertexSource = `
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
    in float aUnshared;
    in float aShaded;
    in float aShapeMode;
    in vec2 aPresence;

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
    out float vUnshared;
    out float vShaded;
    out float vShapeMode;
    out vec2 vPresence;

    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    uniform mat3 uTransformMatrix;
    uniform float u_time;
    uniform float u_driftAmp;

    void main() {
      mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;

      // Launcher motion, per group. GAMES do a Space-Invaders FORMATION march
      // (shared phase → step together, small hop). Every other shape — including
      // every normal hive page (u_driftAmp = 0) — is still. Offsets are
      // identical across a quad's 4 vertices, so the tile translates rigidly and
      // its centre stays inside its pointer→axial click catchment (TileOverlay).
      vec2 p = aPosition;
      if (u_driftAmp > 0.0 && aShapeMode > 1.5 && aShapeMode < 2.5) {
        float stepX = floor(sin(u_time * 0.55) * 4.0) / 4.0;   // quantized → stepped sway
        float bob   = sin(u_time * 2.0) * 0.06;
        p += vec2(stepX * u_driftAmp * 1.6, bob * u_driftAmp);
      }
      gl_Position = vec4((mvp * vec3(p, 1.0)).xy, 0.0, 1.0);
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
      vUnshared = aUnshared;
      vShaded = aShaded;
      vShapeMode = aShapeMode;
      vPresence = aPresence;
    }
  `

  private static fragmentSource = `#version 300 es
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
    in float vUnshared;
    in float vShaded;
    in float vShapeMode;
    in vec2 vPresence;

    uniform vec2 u_quadSize;
    uniform float u_radiusPx;
    uniform float u_flat;
    uniform float u_pivot;
    uniform float u_hoveredIndex;
    uniform float u_bandRows;
    uniform float u_labelMix;
    uniform float u_glyphs;
    uniform float u_imageMix;
    uniform vec3 u_accentColor;
    uniform float u_time;
    uniform vec3 u_markColor;
    uniform float u_markPreview;
    uniform float u_swapMode;
    uniform vec3 u_swapColor;
    uniform vec2 u_honeyArtGrid;

    uniform sampler2D u_label;
    uniform sampler2D u_cellImages;
    uniform sampler2D u_honeyArt;

    out vec4 fragColor;

    // ── light direction (top-left, 10 o'clock) ──────────────
    const vec2 LIGHT_DIR = normalize(vec2(-0.5, -0.866));

    // ── label bake/sample coupling ──────────────────────────
    // Labels are baked at 2× into the atlas (hex-label.atlas.ts TextStyle
    // fontSize = 18) so each glyph carries more texels and stays crisp when
    // magnified onto big hexes. To keep the ON-SCREEN size unchanged we sample a
    // proportionally smaller window of the cell: normal tiles zoom the quad→cell
    // map in by LABEL_BAND; the games/website paths divide their label window by
    // it. LABEL_BAND MUST equal bakeFontSize / 9 (the 9px bake this geometry was
    // originally tuned for). Keep in lockstep with the atlas fontSize.
    const float LABEL_BAND = 2.0;

    // ── image fit: COVER the target shape, never stretch ─────────
    // The atlas issues each image's UV rect at the IMAGE's own aspect
    // (hex-image.atlas.ts contain-fits into a square cell, then bounds the
    // content). Sampling that rect straight across a differently-shaped box
    // squashes the picture: only images pre-baked to the exact hex box came
    // out right (tile-editor save, substrate pool), so an attached file, an
    // adopted tile, a thumbnail, or a point-top bake shown in flat-top
    // rendered distorted until the user re-saved it through the editor.
    // Scale the sampling window to the image's aspect and centre it — the
    // picture fills the shape and the overflow is cropped, the same rule as
    // the CSS object-fit cover mode. A no-op (crop == 1) when the aspects
    // match, so hex-baked images sample exactly as before.
    vec2 coverUV(vec2 boxUV, vec4 imgRect, float boxAspect) {
      vec2 span = abs(imgRect.zw - imgRect.xy) * vec2(textureSize(u_cellImages, 0));
      float imgAspect = span.x / max(span.y, 1e-6);
      vec2 crop = imgAspect > boxAspect
        ? vec2(boxAspect / imgAspect, 1.0)
        : vec2(1.0, imgAspect / boxAspect);
      return mix(imgRect.xy, imgRect.zw, (boxUV - 0.5) * crop + 0.5);
    }

    // ── label decode: SDF fill ONLY ─────────────────────────────
    // The atlas stores a signed distance field in .r (0.5 == the glyph edge,
    // >0.5 inside, 0 far outside; see sdf-glyph.ts). Screen-space derivatives
    // keep the reconstructed edge ~1px wide at ANY magnification — true
    // vector-sharp text. aa is clamped: the 1e-4 floor avoids a hard-step on
    // flat field regions; the 0.3 ceiling stops the LABEL_BAND clamp seam (a
    // uv discontinuity where fwidth spikes) from leaking a faint ring.
    // FILL ONLY — hard user rule: no halo, no outline, no shadow, no second
    // threshold. Nothing may darken or decorate the outside of a glyph;
    // legibility over images comes from the pill/banner drawn BEHIND text.
    // ONE-FRAGMENT RAMP, FATTER FILL (2026-09-09). The ramp used to span
    // ±fwidth — two fragments — so a Light stem a pixel or so wide never
    // reached full white at its centre and every letter read grey and weak
    // (Jaime: "the opacity is affecting the text"). ±half a fwidth is the
    // standard one-fragment antialias: stems hit 100% ink, edges stay smooth.
    // LABEL_EDGE below 0.5 moves the ink boundary OUTWARD by a constant
    // fraction of the SDF spread (0.015 × 16 cell px ≈ a quarter cell px per
    // side — 0.47 read a touch heavy), the approved way to strengthen the
    // glyph: it is the FILL that
    // grows, in cell space, at every zoom alike. Still no stroke, halo, rim
    // or shadow — nothing is drawn outside the fill.
    const float LABEL_EDGE = 0.485;
    float labelFill(vec2 uv) {
      float sd = texture(u_label, uv).r;
      float aa = clamp(fwidth(sd) * 0.5, 1e-4, 0.3);
      return smoothstep(LABEL_EDGE - aa, LABEL_EDGE + aa, sd);
    }

    float sdHex(vec2 p, float r) {
      p = abs(p);
      return max(p.x * 0.8660254 + p.y * 0.5, p.y) - r;
    }

    float sdRoundedBox(vec2 p, vec2 b, float r) {
      vec2 q = abs(p) - b + r;
      return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
    }

    // ── Space Invader (the classic 11×8 "crab"), two march frames ───────────
    // Each row is a bitmask of its 11 columns (bit c = column c, 0 = leftmost).
    // GLSL ES 1.00 has no integer bit ops, so we test bits with float math:
    // mod(floor(val / 2^c), 2). Kept float-only (no int) to dodge the fragment
    // shader's default int-precision quirks.
    float invaderRow(float row, float frame) {
      if (frame < 0.5) {
        if (row < 0.5) return 260.0;   if (row < 1.5) return 136.0;
        if (row < 2.5) return 508.0;   if (row < 3.5) return 886.0;
        if (row < 4.5) return 2047.0;  if (row < 5.5) return 1533.0;
        if (row < 6.5) return 1285.0;  return 216.0;
      }
      if (row < 0.5) return 260.0;   if (row < 1.5) return 1161.0;
      if (row < 2.5) return 1533.0;  if (row < 3.5) return 1911.0;
      if (row < 4.5) return 2047.0;  if (row < 5.5) return 1022.0;
      if (row < 6.5) return 260.0;   return 514.0;
    }

    // 1.0 where the invader sprite is lit, 0.0 elsewhere. p is tile-local; the
    // sprite spans ~±0.72r × ±0.52r, centred, with a tiny inter-pixel gap so the
    // blocky pixel-art reads.
    float invaderMask(vec2 p, float r, float frame) {
      float halfW = 0.72 * r, halfH = 0.52 * r;
      vec2 g = vec2((p.x + halfW) / (2.0 * halfW) * 11.0,
                    (p.y + halfH) / (2.0 * halfH) * 8.0);
      if (g.x < 0.0 || g.x >= 11.0 || g.y < 0.0 || g.y >= 8.0) return 0.0;
      vec2 cell = fract(g);
      if (cell.x < 0.08 || cell.x > 0.92 || cell.y < 0.08 || cell.y > 0.92) return 0.0; // pixel gap
      float col = floor(g.x);
      float row = floor(g.y);
      return mod(floor(invaderRow(row, frame) / exp2(col)), 2.0);
    }

    vec2 rot30(vec2 p) {
      return vec2(
        0.8660254 * p.x - 0.5 * p.y,
        0.5 * p.x + 0.8660254 * p.y
      );
    }

    // ── HONEY: the quick menu's option tiles ────────────────────────────────
    // Each option on the flower is a slab of dark buckwheat honey set into the
    // cold chrome (aShapeMode 3 rest · 4 back · 5 lit · 6 back lit · 7 lit with
    // its one slow drip; show-cell #paintFlower picks it, nothing else does).
    // The SVG ring (quickmenu/quick-menu.overlay.ts) wears the SAME numbers, so
    // the two renderers read as one object: the palette below IS the one in
    // quickmenu/quick-menu.honey.ts — change them together.
    //
    // Lengths are fractions of R, the tile's circumradius. u_radiusPx is the
    // APOTHEM (centre to flat), so R = u_radiusPx / 0.866; 1 px at the ring's
    // R = 46 is 0.0217 R. y is down, so the top of the tile is negative. Light
    // comes from the top-left, the normal of the top-left edge. Everything is
    // a closed form of position, seed and (lit tile only) u_time, periodic in
    // it, so a stopped clock shows a finished picture.
    #define HEX(r, g, b) (vec3(float(r), float(g), float(b)) / 255.0)
    const vec2 HONEY_LIGHT = vec2(-0.5, -0.8660254);

    // piecewise linear in sRGB over dd = 1 - |p|, so the SVG gradients match
    vec3 honeyRamp(float dd, vec3 a, vec3 b, vec3 c, vec3 d, vec3 e, vec3 f) {
      vec3 col = mix(a, b, clamp((dd - 0.134) / 0.052, 0.0, 1.0));
      col = mix(col, c, clamp((dd - 0.186) / 0.104, 0.0, 1.0));
      col = mix(col, d, clamp((dd - 0.290) / 0.234, 0.0, 1.0));
      col = mix(col, e, clamp((dd - 0.524) / 0.259, 0.0, 1.0));
      return mix(col, f, clamp((dd - 0.783) / 0.217, 0.0, 1.0));
    }

    float honeySmin(float a, float b, float k) {
      // k is a blend WIDTH: never let a caller hand it 0 (0/0 is NaN on the GPU)
      k = max(k, 1e-4);
      float h = max(k - abs(a - b), 0.0) / k;
      return min(a, b) - h * h * k * 0.25;
    }

    // the pour lip's lower edge: a slow wave, its phase the tile's seed
    float honeyLip(float x, float seed) {
      return -0.50 + 0.03 * sin(2.1 * x + 6.2831853 * seed);
    }

    // uneven vertical capsule from (0,0), radius r1, to (0,h), radius r2
    float honeyCone(vec2 q, float r1, float r2, float h) {
      q.x = abs(q.x);
      float b = (r1 - r2) / h;
      float a = sqrt(1.0 - b * b);
      float k = dot(q, vec2(-b, a));
      if (k < 0.0) return length(q) - r1;
      if (k > a * h) return length(q - vec2(0.0, h)) - r2;
      return dot(q, vec2(a, b)) - r1;
    }

    // One drip hung from the lip line at (x, y): the neck and the bead in ONE
    // fill, len from the lip to the bead's bottom, ws narrowing the neck.
    float honeyDrip(vec2 p, float x, float y, float len, float rad, float ws, float k, out float bead) {
      float top = y - 0.06;
      vec2 c = vec2(x, y + len - rad);
      bead = length(p - c) - rad;
      float neck = honeyCone(p - vec2(x, top), 0.030 * ws, 0.024 * ws, c.y - top);
      return honeySmin(neck, bead, k);
    }

    // A bead's own light: honey darker toward its foot, a dark line on the
    // shadow side, a glint high on the lit side. sd is the bead's distance.
    vec3 honeyBead(vec3 col, vec2 p, vec2 c, float rad, float sd, float w, float vis) {
      float m = (1.0 - smoothstep(-w, w, sd)) * vis;
      col = mix(col, mix(HEX(0xc2, 0x84, 0x18), HEX(0xa8, 0x70, 0x0f), clamp((p.y - c.y + rad) / (2.0 * rad), 0.0, 1.0)), m);
      vec2 o = p - c;
      float shade = smoothstep(0.0, 0.6, dot(o, -HONEY_LIGHT) / max(length(o), 1e-5));
      col = mix(col, HEX(0x4a, 0x2d, 0x08), m * smoothstep(-0.016 - w, -0.016 + w, sd) * shade * 0.8);
      vec2 g = (o - vec2(-0.30, -0.38) * rad) / (vec2(0.30, 0.20) * rad);
      float gw = w / (0.2 * rad);
      return mix(col, HEX(0xff, 0xf3, 0xc9), (1.0 - smoothstep(-gw, gw, length(g) - 1.0)) * 0.6 * vis);
    }

    // The pour lip and its two drips, as one pose. a and b are where each hangs
    // from the lip; aSize and bSize are (length, bead radius); b is the one that
    // moves, so it also carries its neck width, its two fillets, the scale it
    // regrows at and the opacity of the whole group.
    struct HoneyDrips {
      float seed;
      vec2 a;
      vec2 aSize;
      vec2 b;
      vec2 bSize;
      float ws;
      float neckBead;
      float fillet;
      float gs;
      float vis;
    };

    // The lip and both drips as ONE distance, in R. beadA and beadB are the beads'
    // own (B's in its regrowing frame, pB).
    float honeyField(vec2 p, HoneyDrips h, out float beadA, out float beadB, out vec2 pB) {
      pB = h.b + (p - h.b) / h.gs;
      float dripA = honeyDrip(p, h.a.x, h.a.y, h.aSize.x, h.aSize.y, 1.0, 0.035, beadA);
      float dripB = honeyDrip(pB, h.b.x, h.b.y, h.bSize.x, h.bSize.y, h.ws, h.neckBead, beadB) * h.gs;
      float lip = honeySmin(p.y - honeyLip(p.x, h.seed), dripA, 0.05);
      return mix(lip, honeySmin(lip, dripB, h.fillet * h.gs), h.vis);
    }

    // a line centred c inside the edge, and a band laid against it (e = inward, in R)
    float honeyLine(float e, float c, float width, float w) {
      return 1.0 - smoothstep(0.5 * width - w, 0.5 * width + w, abs(e - c));
    }
    float honeyBand(float e, float width, float w) {
      return 1.0 - smoothstep(width - w, width + w, e);
    }

    // outward normal of the nearest edge, in the tile's own frame, either way up
    vec2 honeyEdge(vec2 p) {
      vec2 a = u_flat > 0.5 ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
      vec2 b = vec2(a.x * 0.5 - a.y * 0.8660254, a.x * 0.8660254 + a.y * 0.5);
      vec2 c = vec2(b.x * 0.5 - b.y * 0.8660254, b.x * 0.8660254 + b.y * 0.5);
      float da = dot(p, a), db = dot(p, b), dc = dot(p, c);
      vec2 n = a * sign(da);
      float m = abs(da);
      if (abs(db) > m) { n = b * sign(db); m = abs(db); }
      if (abs(dc) > m) { n = c * sign(dc); }
      return n;
    }

    // The ink the tile's name is set in when this shader draws it. The DOM name
    // layer (tile-name.drone.ts) wears the same three.
    vec3 honeyInk(float mode) {
      if (abs(mode - 4.0) < 0.5 || abs(mode - 6.0) < 0.5) return HEX(0xe6, 0xd4, 0xa8);   // back, lit or not
      if (mode > 4.5) return HEX(0x1a, 0x10, 0x03);                                      // lit
      return HEX(0xff, 0xf1, 0xcf);
    }

    // ── the crafted backgrounds (quickmenu/quick-menu.honey-art.ts) ──────────
    // Variation art's picture at p (in R, y down), at rest or pre-lit. Each
    // picture is a point-top tile in a -40 -46 80 92 box at R = 46, inside a
    // padded atlas cell; a flat-top tile reads it turned 30°. Laid over the
    // darkest honey wherever the picture is not opaque.
    vec3 honeyArt(vec2 p, float art, bool lit) {
      vec2 q = u_flat > 0.5 ? rot30(p) : p;
      vec2 box = clamp(vec2((q.x * 46.0 + 40.0) / 80.0, (q.y * 46.0 + 46.0) / 92.0), 0.0, 1.0);
      vec2 size = vec2(textureSize(u_honeyArt, 0));
      vec2 cell = vec2(size.x / u_honeyArtGrid.x, size.y * 0.5);
      vec2 at = vec2(art * cell.x, lit ? cell.y : 0.0) + u_honeyArtGrid.y + box * (cell - 2.0 * u_honeyArtGrid.y);
      vec4 s = texture(u_honeyArt, at / size);
      return s.rgb + HEX(0x1d, 0x12, 0x04) * (1.0 - s.a);
    }

    // The top wall at x: with no pour lip, the lit tile's drip hangs from it.
    float honeyWall(float x) {
      return u_flat > 0.5 ? -0.8660254 + 1.7320508 * max(abs(x) - 0.5, 0.0) : -1.0 + 0.57735027 * abs(x);
    }

    // The whole tile, in the order the SVG ring lays it: body, bloom, halo, the
    // pour lip and its drips, the meniscus, the sliver, the rim. d is the hex
    // distance in px (negative inside), aa the page's own edge band, which the
    // rim is set inside of so it never sits in the part that fades out. art is
    // the crafted background (-1 = none): it replaces the body, bloom, lip,
    // meniscus and sliver; the halo, the rim and the lit tile's drip stay.
    vec3 honeyTile(vec2 local, float d, float aa, float mode, vec3 accent, float seed, float art) {
      float R = u_radiusPx / 0.8660254;
      vec2 p = local / R;
      float dd = clamp(1.0 - length(p), 0.0, 1.0);
      float px = max(fwidth(p.y), 1e-5);
      float w = px * 0.75;
      float e = -d / R;
      float rim = 0.5 * aa / R;
      bool back = abs(mode - 4.0) < 0.5 || abs(mode - 6.0) < 0.5;
      bool lit = mode > 4.5;
      bool animated = mode > 6.5;
      bool crafted = !back && art > -0.5 && art < u_honeyArtGrid.x - 0.5;

      vec3 c;
      if (crafted) {
        c = honeyArt(p, art, lit);
      } else if (back) {
        float t = clamp((dd - 0.134) / 0.866, 0.0, 1.0);
        c = lit ? mix(HEX(0x2f, 0x20, 0x0a), HEX(0x4d, 0x35, 0x10), t)
                : mix(HEX(0x2a, 0x1c, 0x06), HEX(0x3b, 0x28, 0x09), t);
      } else if (lit) {
        c = honeyRamp(dd, HEX(0x3a, 0x24, 0x06), HEX(0x6b, 0x43, 0x09), HEX(0xa8, 0x70, 0x0f),
                      HEX(0xcf, 0x93, 0x22), HEX(0xe0, 0xa6, 0x2f), HEX(0xe3, 0xa4, 0x2e));
      } else {
        c = honeyRamp(dd, HEX(0x1d, 0x12, 0x04), HEX(0x2b, 0x1a, 0x05), HEX(0x4a, 0x2d, 0x08),
                      HEX(0x7d, 0x4d, 0x0c), HEX(0x86, 0x52, 0x0e), HEX(0x8c, 0x58, 0x10));
      }
      // no two tiles quite alike: the body breathes a few percent with the seed
      if (!crafted) c *= 1.0 + 0.03 * (2.0 * fract(seed * 2.3 + 0.1) - 1.0);

      if (!back && !crafted) {
        // one small warm bloom, low and right, away from the name
        vec2 q = p - vec2(0.30, 0.72);
        c = mix(c, HEX(0xf0, 0xb4, 0x45), 0.16 * exp(-dot(q, q) / 0.10));
        // and nothing under the glyphs is brighter than the cream ink can hold
        if (!lit) c = min(c, HEX(0x8f, 0x5c, 0x12));
      }
      // the lit halo, three px inside the wall
      if (lit && !back) c = mix(c, HEX(0xff, 0xd9, 0x8a), 0.22 * honeyBand(e, 0.065, w));

      if (!back && p.y < 0.12 && (!crafted || lit)) {
        // THE POUR LIP, with two teardrops hanging either side of the icon. The
        // second (B) is the one that moves on the lit tile, 11 s round. A crafted
        // background has no lip: only the lit tile's B, hung from the top wall.
        float flip = seed > 0.5 ? -1.0 : 1.0;
        float hA = fract(seed * 3.7 + 0.13);
        float hB = fract(seed * 6.0 + 0.57);
        float xA = flip * (-0.50 + 0.05 * (2.0 * hA - 1.0));
        float xB = flip * (0.50 + 0.05 * (2.0 * hB - 1.0));
        float yA = honeyLip(xA, seed);
        float yB = crafted ? honeyWall(xB) : honeyLip(xB, seed);
        float lenA = 0.12 + 0.10 * hA;
        float radA = 0.056 + 0.020 * hA;
        float lenB = 0.12 + 0.10 * hB;
        float radB = 0.056 + 0.020 * hB;

        // rest · swell · neck · pinch (to 0.58), then it falls and regrows
        float u = animated ? fract(u_time / 11.0) : 0.0;
        bool fell = u >= 0.58;
        float swell = 0.5 - 0.5 * cos(3.14159265 * clamp((u - 0.10) / 0.28, 0.0, 1.0));
        float neck = clamp((u - 0.38) / 0.14, 0.0, 1.0);
        neck = neck * neck * neck;
        float pinch = clamp((u - 0.52) / 0.06, 0.0, 1.0);
        float born = 1.0 - pow(1.0 - clamp((u - 0.58) / 0.42, 0.0, 1.0), 3.0);
        float extra = fell ? 0.0 : 0.10 * swell + 0.04 * neck;
        float radNow = radB + (fell ? 0.0 : 0.024 * swell);
        float ws = fell ? 1.0 : mix(mix(1.0, 0.4, neck), 0.15, pinch);
        float fillet = fell ? 0.05 : 0.05 * (1.0 - pinch);
        float gs = fell ? mix(0.35, 1.0, born) : 1.0;
        float visB = fell ? born : 1.0;
        // the neck/bead blend sharpens toward the pinch, but never to 0 (a zero
        // width divides by zero in honeySmin); once the bead has fallen the neck
        // is rebuilt at full width, so the blend is full width again
        float neckBead = fell ? 0.035 : max(0.035 * (1.0 - pinch), 0.004);

        HoneyDrips h = HoneyDrips(seed, vec2(xA, yA), vec2(lenA, radA), vec2(xB, yB), vec2(lenB + extra, radNow),
                                  ws, neckBead, fillet, gs, visB);
        float beadA, beadB, castA, castB;
        vec2 pB, castP;
        float dAll, dCast;
        if (crafted) {
          // B alone, its root in the wall, regrowing about that root
          vec2 root = vec2(xB, yB);
          pB = root + (p - root) / gs;
          dAll = honeyDrip(pB, xB, yB, lenB + extra, radNow, ws, neckBead, beadB) * gs;
          castP = root + (p - vec2(0.0, 0.0326) - root) / gs;
          dCast = honeyDrip(castP, xB, yB, lenB + extra, radNow, ws, neckBead, castB) * gs;
        } else {
          dAll = honeyField(p, h, beadA, beadB, pB);
          // the lip's shadow on the body: the same shape cast 1.5 px down, so it
          // falls under the lip and its beads, never round their sides
          dCast = p.y < -0.05 ? honeyField(p - vec2(0.0, 0.0326), h, castA, castB, castP) : 1.0;
        }
        // with no lip to grow out of, the crafted tile's drip fades in as it regrows
        float cover = crafted ? visB : 1.0;
        c = mix(c, HEX(0x14, 0x0c, 0x02), 0.35 * cover * (1.0 - smoothstep(-w, w, dCast)));
        // then the lip: dark at the rim, clear below
        vec3 lipCol = mix(HEX(0x5a, 0x38, 0x09), HEX(0xa8, 0x70, 0x0f), clamp((p.y + 1.0) / 0.225, 0.0, 1.0));
        lipCol = mix(lipCol, HEX(0xc2, 0x84, 0x18), clamp((p.y + 0.775) / 0.275, 0.0, 1.0));
        c = mix(c, lipCol, 0.92 * cover * (1.0 - smoothstep(-w, w, dAll)));

        if (!crafted) c = honeyBead(c, p, vec2(xA, yA + lenA - radA), radA, beadA, w, 1.0);
        c = honeyBead(c, pB, vec2(xB, yB + lenB + extra - radNow), radNow, beadB, w / gs, visB);
        if (animated && fell && u < 0.85) {
          // the bead let go: it falls, narrows, stretches a little, and is gone
          // before it reaches the name
          float tau = (u - 0.58) / 0.27;
          float radP = radB + 0.024;
          vec2 bc = vec2(xB, yB + lenB + 0.14 - radP + 0.30 * pow(tau, 1.6));
          float br = radP * mix(1.0, 0.7, tau);
          float sy = 1.0 + 0.25 * sin(3.14159265 * tau);
          c = honeyBead(c, p, bc, br, length((p - bc) / vec2(1.0, sy)) - br, w, 1.0 - smoothstep(0.45, 0.85, tau));
        }
      }

      if (!back && !crafted) {
        // the meniscus: a pale line just inside the wall, brightest top-left,
        // and a warm one bottom-right where the light comes through
        float men = honeyLine(e, 0.0326, max(0.0217, px), w);
        c = mix(c, HEX(0xff, 0xe2, 0xa0), men * (0.10 + 0.45 * clamp(dot(p, HONEY_LIGHT) / 0.8660254, 0.0, 1.0)));
        float trn = honeyLine(e, 0.054, max(0.026, px), w);
        c = mix(c, HEX(0xe8, 0xa2, 0x2c), trn * 0.25 * clamp((dot(p, -HONEY_LIGHT) / 0.8660254 - 0.35) / 0.65, 0.0, 1.0));

        // one tapered sliver of specular and one glint, both on the lip
        vec2 sa = vec2(-0.138, -0.839);
        vec2 sv = vec2(-0.658, -0.539) - sa;
        float st = clamp(dot(p - sa, sv) / dot(sv, sv), 0.0, 1.0);
        float sliver = (1.0 - smoothstep(-w, w, length(p - sa - sv * st) - 0.024))
                     * (1.0 - abs(2.0 * st - 1.0)) * (lit ? 0.75 : 0.55) * mix(0.85, 1.0, fract(seed * 9.7));
        c = mix(c, HEX(0xff, 0xf3, 0xc9), sliver);
        float glint = 1.0 - smoothstep(-w, w, length(p - vec2(-0.398, -0.689)) - (lit ? 0.035 : 0.028));
        c = mix(c, HEX(0xff, 0xfa, 0xf0), glint * 0.80);
      }

      if (back) {
        // crystallised honey keeps a dashed rim, 4 px on, 4 px off round the wall
        vec2 n = honeyEdge(p);
        float s = floor(mod(atan(n.y, n.x) / 1.0471976 + 6.25, 6.0)) + dot(p, vec2(-n.y, n.x)) + 0.5;
        float dash = step(0.5, fract(s * 5.6666667));
        c = mix(c, HEX(0xff, 0xd9, 0x8a), honeyBand(e - rim, max(0.027, px), w) * dash * (lit ? 0.85 : 0.45));
      } else if (lit) {
        c = mix(c, HEX(0xff, 0xd9, 0x8a), honeyBand(e - rim, max(0.035, px), w) * 0.95);
      } else {
        c = mix(c, HEX(0xc9, 0x95, 0x3a), honeyBand(e - rim, max(0.0217, px), w) * 0.55);
      }
      return c;
    }

    void main() {
      vec2 local = (vUV - 0.5) * u_quadSize;
      // point-top: rotate 30° so sdHex clips correctly; flat-top: no rotation needed
      vec2 rotated = u_flat > 0.5 ? local : rot30(local);
      // Silhouette 1 (websites' cartoon CLOUD) is RETIRED — websites launcher
      // tiles render as ordinary picture hexagons like the rest of the hive.
      // The per-tile aShapeMode attribute stays: other groups own their own
      // shapes, and a stale flower-pot decoration simply resolves to 0 now
      // (launchShapeToMode in show-cell), so nothing needs migrating.

      // Games: the Space Invader IS the tile — its lit pixel-squares each show a
      // piece of the game's snapshot (one continuous image sampled across the
      // sprite), so the picture reads through the alien's grid as a sparkling
      // mosaic. The gaps between squares + a per-square twinkle are the sparkle.
      // The name is labelled on a strip on top. Marches via the vertex shader.
      // Drawn and returned here (skips the hex/image/label pipeline below).
      if (vShapeMode > 1.5 && vShapeMode < 2.5) {
        float r = u_radiusPx;
        float aa = max(r * 0.04, 1.5);
        float frame = mod(floor(u_time * 1.8), 2.0);

        float im = invaderMask(local, r, frame);   // 1 on a lit pixel-square, 0 in the gaps

        // one continuous image mapped across the sprite's bounding box, so the
        // lit squares read as a (pixelated) picture, not random tiles.
        vec2 invMin = vec2(-0.72 * r, -0.52 * r);
        vec2 invMax = vec2( 0.72 * r,  0.52 * r);
        vec2 iuv = clamp((local - invMin) / (invMax - invMin), 0.0, 1.0);
        vec3 img = (vHasImage > 0.5 && u_imageMix > 0.001)
          ? texture(u_cellImages, coverUV(iuv, vImageUV, (0.72 / 0.52))).rgb
          : mix(vec3(0.30, 1.0, 0.42), u_accentColor, 0.25);   // green when imageless

        // per-square twinkle — gentle brightness wobble keyed on square id + time
        float halfW = 0.72 * r, halfH = 0.52 * r;
        vec2 gg = vec2((local.x + halfW) / (2.0 * halfW) * 11.0,
                       (local.y + halfH) / (2.0 * halfH) * 8.0);
        float sqId = floor(gg.x) + floor(gg.y) * 11.0;
        img *= 0.82 + 0.18 * sin(u_time * 4.0 + sqId * 2.39996);

        // BIG name banner so the game is readable at a glance. The atlas glyph is
        // baked large (see LABEL_BAND), so the sample window is divided by it to
        // keep the displayed name the same size, just crisp. The visible text
        // lands in the region's centre band, where the dark banner backs it.
        // Square region → no aspect distortion.
        vec2 labC = vec2(0.0, 0.30 * r);
        vec2 labHalf = vec2(0.85 * r / LABEL_BAND);   // LABEL_BAND unchanged → same on-screen size
        vec2 labUV = (local - (labC - labHalf)) / (2.0 * labHalf);
        float textA = (labUV.x >= 0.0 && labUV.x <= 1.0 && labUV.y >= 0.0 && labUV.y <= 1.0)
          ? labelFill(mix(vLabelUV.xy, vLabelUV.zw, labUV)) * u_labelMix
          : 0.0;
        float dPill = sdRoundedBox(local - labC, vec2(0.84 * r, 0.17 * r), 0.08 * r);
        float pillMask = 1.0 - smoothstep(-aa, aa, dPill);

        float alpha = max(im, pillMask);   // sprite squares ∪ name banner
        if (alpha < 0.005) discard;

        vec3 col = img;
        col = mix(col, vec3(0.03, 0.04, 0.07), pillMask * 0.92);   // dark banner behind the name
        col = mix(col, vec3(1.0), textA);                          // big white name
        // The dim below (world mode / a switched-off game) never reaches this
        // early return, so the silhouette takes it here: a dormant game still
        // stands on its page, visibly out — hidden, never gone.
        if (vUnshared > 0.5) {
          col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), 0.75);
          col *= 0.45;
          alpha *= 0.6;
        }
        fragColor = vec4(col * alpha, alpha);
        return;
      }

      // Every normal hive page: the hexagon, into the distance-driven pipeline.
      float d = sdHex(rotated, u_radiusPx);

      // smooth the hex edge — wider band for clean AA
      float aa = max(u_radiusPx * 0.04, 1.5);
      float hexAlpha = 1.0 - smoothstep(-aa, aa, d);
      if (hexAlpha < 0.005) discard;

      // The quick menu's option tiles (aShapeMode 3..7) are honey, not the page's
      // dark ground: nothing else on the hive ever carries these values, so every
      // ordinary tile pays this one comparison and renders exactly as before.
      bool honey = vShapeMode > 2.5;

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
        // Aspect the image must cover. The pivot rotates the sampling frame
        // 90°, so the shape the image fills is the hex box on its side.
        float boxAspect = hexW / hexH;
        // pivot mode: rotate snapshot 90° CW inside the hex
        if (u_pivot > 0.5) {
          hexUV = vec2(hexUV.y, 1.0 - hexUV.x);
          boxAspect = hexH / hexW;
        }
        vec4 imgBase = texture(u_cellImages, coverUV(hexUV, vImageUV, boxAspect));

        // vignette: darken image edges so snapshots blend into border
        float vignette = smoothstep(0.5, 1.0, dist);
        imgBase.rgb *= 1.0 - vignette * 0.45;

        // outer border ring — crisp bright line
        float outerRing = 1.0 - smoothstep(0.0, aa * 1.2, abs(d));
        imgBase.rgb = mix(imgBase.rgb, vBorderColor, outerRing * 0.6);

        // inner glow border — wider, softer
        float innerGlow = 1.0 - smoothstep(0.0, aa * 3.5, abs(d + aa * 1.5));
        imgBase.rgb = mix(imgBase.rgb, vBorderColor, innerGlow * 0.12);

        // blend between empty and image based on imageMix
        base = mix(emptyBase, imgBase, imgBlend);
      } else {
        base = emptyBase;
      }

      // Honey lays its own whole look (its meniscus is the bevel), seeded by the
      // flower cell's ordinal. Fully opaque: an ordinary tile under an option must not show through the honey.
      if (honey) {
        float honeySeed = fract(mod(floor(vCellIndex + 0.5), 1024.0) * 0.6180339 + 0.37);
        // which crafted background, if any: honey carries it in aHeat as index + 1
        float honeyArtIndex = floor(vHeat + 0.5) - 1.0;
        base = vec4(honeyTile(local, d, aa, vShapeMode, vBorderColor, honeySeed, honeyArtIndex), 1.0);
      } else {
        // bevel highlight (top-left light) and shadow (bottom-right)
        float highlightStrength = max(bevelDot, 0.0) * edgeProximity * 0.06;
        float shadowStrength = max(-bevelDot, 0.0) * edgeProximity * 0.08;
        base.rgb += vec3(1.0) * highlightStrength;
        base.rgb -= vec3(1.0) * shadowStrength;
      }

      // WAX, NOT COLOURS (jwize, 2026-10-15: "we can create a kind of waxy
      // graphic perhaps as there is more presence on a tile"). vPresence.x is
      // how many people in the room hold this tile, you among them. Past one,
      // wax builds up inside the walls the way a cell fills: a soft lining
      // whose inner edge is a rounded hexagon, so it pools in the corners
      // first, and thickens with each holder, easing out (two make a film,
      // six a full lining). One beeswax tone for everyone, and a faint lip
      // that catches the light. Static, and drawn under the name.
      if (vPresence.x > 1.5) {
        float wax = 1.0 - exp(-(vPresence.x - 1.0) * 0.55);
        float waxW = u_radiusPx * mix(0.07, 0.24, wax);
        float waxRound = waxW * 0.9;
        float dWax = sdHex(rotated, u_radiusPx - waxW - waxRound) - waxRound;
        float waxZone = smoothstep(-aa, aa, dWax) * hexAlpha;
        float waxDepth = clamp(dWax / max(waxW, 1.0), 0.0, 1.0);
        vec3 waxColor = vec3(0.98, 0.83, 0.46);
        // The body: thin and see-through at the lip, near opaque at the wall.
        base.rgb = mix(base.rgb, waxColor, waxZone * mix(0.30, 0.78, sqrt(waxDepth)) * mix(0.65, 1.0, wax));
        // Wax is translucent: a little of its light spills past the lip.
        float waxSpill = (1.0 - smoothstep(0.0, waxW * 0.9, -dWax)) * (1.0 - waxZone);
        base.rgb = mix(base.rgb, waxColor, waxSpill * 0.16 * wax);
        // The lip catches the light on the side facing it.
        float waxLip = (1.0 - smoothstep(0.0, aa * 1.6, abs(dWax))) * (0.35 + 0.65 * max(-bevelDot, 0.0));
        base.rgb = mix(base.rgb, vec3(1.0, 0.97, 0.88), waxLip * 0.55 * wax);
      }

      vec4 color = base;

      // ── label band: the name and the icons, sized to what it holds ──────
      // The band is the label's BACKGROUND. At rest it is the single-row strip
      // behind the name on an imaged tile. On HOVER it takes the height of the
      // rows it must hold — the NAME keeps the top row and the icons take the
      // row(s) under it, so u_bandRows is 2 while the icons fit one row and 3
      // once they wrap. It grows CENTRED — the added height balanced equally
      // above and below — so the rows straddle the hex centre. That band IS the
      // icons' backing; the overlay draws no tray of its own. Row count comes
      // from the overlay, which does the wrapping (tile-overlay.drone.ts,
      // overlay:band-rows).
      float hovered = (u_hoveredIndex >= 0.0 && abs(vCellIndex - u_hoveredIndex) < 0.5) ? 1.0 : 0.0;
      float rowH = u_radiusPx * 0.15;   // half-height of ONE row

      // label text. Sample the central 1/LABEL_BAND of the cell (glyphs are
      // baked large; see LABEL_BAND) so the on-screen size matches the old 9px
      // bake but with 3× the texels → crisp. Clamp keeps out-of-band UVs on
      // this cell's transparent border, never a neighbour.
      //
      // HOVER KEEPS THE NAME — it moves up into the band's TOP row and the
      // icons take the row(s) below it, so the tile says what it is called AND
      // what you can do to it at the same time. The band grows centred, so the
      // top row's centre sits (u_bandRows - 1) * rowH above the hex centre:
      // sample the label that far DOWN the quad and the glyphs land there.
      // Nothing shifts at rest (u_bandRows is 1 unhovered) or on a tile with
      // no icons.
      float nameShift = (u_bandRows - 1.0) * rowH * hovered;
      vec2 nameUV = vec2(vUV.x, vUV.y + nameShift / max(u_quadSize.y, 1.0));
      vec2 luv = mix(vLabelUV.xy, vLabelUV.zw, clamp((nameUV - 0.5) * LABEL_BAND + 0.5, 0.0, 1.0));
      float la = labelFill(luv) * u_glyphs;   // plain white fill, nothing else

      // Is there a label at all? Hidden text collapses aLabelUV to the
      // degenerate rect [0,0,0,0] (show-cell's hideText path / hover
      // re-hide), so the glyphs sample a transparent corner. The band is
      // the label's BACKGROUND — with no text it is a bare dark bar, so
      // gate it on the same signal. A real atlas rect always has a
      // non-zero far corner, so this only ever fires on the hidden state.
      // HOVER overrides the gate: the icons need their backing even on a
      // nameless tile.
      float labelPresent = step(0.0001, max(vLabelUV.z, vLabelUV.w));

      // Drawn BEFORE the glyphs so the band can never paint over the letters.
      // At rest it only shows over an image (imgBlend) — exactly the pill it
      // has always been; on hover it shows on every tile.
      //
      // FLUSH TO THE BORDER. There is NO horizontal bound: the band is a plain
      // strip and the hexagon itself trims it (color.a *= hexAlpha at the
      // end of main), so it meets the tile border exactly, at any radius and
      // in either orientation. The old fixed half-width (0.88 × radius) was
      // measured 4px short of the edge on each side and read as a floating
      // pill rather than a band.
      //
      // The band edge is a RULE, not a gradient: feather it by well under a
      // pixel. The hex's own aa is ~1.5px, which read as a blurry smudge on a
      // ~19px band — bandAA lands the top and bottom as defined lines.
      float bandH = rowH * mix(1.0, u_bandRows, hovered);
      float bandAA = max(u_radiusPx * 0.02, 0.6);
      float bandD = abs(local.y) - bandH;
      // THE HOVER BAND IS GONE (2026-10-26): each icon now rests on its own plate
      // and the hovered tile's name is carried by the caption at the top of the
      // screen, so nothing needs a strip behind it. The band is only ever the
      // resting pill behind a name that is drawn.
      float bandMask = (1.0 - smoothstep(0.0, bandAA, bandD)) * labelPresent * (1.0 - hovered);
      // NEAR-OPAQUE (2026-09-09). The resting band darkened the picture by
      // only 55%, so whatever sat behind the name bled through the band and
      // around every letter, and the white ink had nothing solid to stand on.
      // 0.85 at rest / 0.90 on hover keeps a trace of the picture for
      // continuity while giving the text and the icons a solid ground.
      color.rgb = mix(color.rgb, vec3(0.0), bandMask * imgBlend * 0.85 * u_labelMix);

      // Hairline ruler on the seam UNDER THE NAME — it divides what the tile is
      // called from what you can do to it, so it sits at the bottom of the top
      // row wherever that lands: (2 - u_bandRows) * rowH. Only when the band
      // actually holds more than the name; a single-row band has nothing to
      // divide. A wrapped icon block gets no second rule — the icons are one
      // block, and only the name/actions seam is a boundary.
      // Inset from both ends and faded out there, so it reads as a rule
      // sitting inside the band rather than a full-width divider cutting it in
      // half. A sub-pixel core with a sub-pixel feather: it must read as a
      // drawn LINE, not a soft gradient. Local units are px, so the core holds
      // at any hex radius. Keeps its own inset now that the band runs edge to
      // edge — the rule is not meant to reach the border.
      float rulerHalfW = u_radiusPx * 0.70;
      float seamY = (2.0 - u_bandRows) * rowH;
      float rulerCore = 1.0 - smoothstep(0.27, 0.54, abs(local.y - seamY));
      float rulerSpan = 1.0 - smoothstep(rulerHalfW - 4.0, rulerHalfW, abs(local.x));
      float rulerOn = hovered * step(1.5, u_bandRows);
      color.rgb = mix(color.rgb, vec3(1.0), rulerCore * rulerSpan * bandMask * rulerOn * 0.30 * u_labelMix);

      // The glyph body is now FULLY opaque white (was 0.92 / 0.88). At 0.88 a
      // letter was 12% transparent, so the noise of whatever sat behind it —
      // usually a generated substrate — showed THROUGH the ink. On a Light
      // weight, stems are only a couple of px wide, so that leak was a large
      // fraction of the visible letter and read as GRAIN. Opaque confines the
      // picture's influence to the antialiased edge, where it belongs. This is
      // the glyph FILL only: no stroke, no halo, no rim, no shadow.
      if (imgBlend < 0.001) {
        // no image: bright white label (honey sets it in its own ink)
        color = mix(color, honey ? vec4(honeyInk(vShapeMode), 1.0) : vec4(1.0, 1.0, 1.0, 1.0), la * u_labelMix);

        // ambient presence — identity color at rest, shifts to warm amber with heat
        // (honey keeps to its palette: no identity ring)
        float heatRing = smoothstep(0.0, -1.5, d) - smoothstep(-4.0, -6.0, d);
        vec3 warmColor = vec3(1.0, 0.62, 0.12);
        vec3 heatTint = mix(vIdentityColor, warmColor, vHeat);
        float heatAlpha = mix(0.07, 0.68, vHeat);
        color.rgb = mix(color.rgb, heatTint, heatRing * heatAlpha * (honey ? 0.0 : 1.0));
      } else if (imgBlend > 0.999) {
        color = mix(color, vec4(1.0, 1.0, 1.0, 1.0), la * u_labelMix);
      } else {
        // fading in: crossfade label styles
        // empty-style label
        vec4 emptyLabel = mix(color, vec4(1.0, 1.0, 1.0, 1.0), la * u_labelMix);
        float heatRing = smoothstep(0.0, -1.5, d) - smoothstep(-4.0, -6.0, d);
        vec3 warmColor = vec3(1.0, 0.62, 0.12);
        vec3 heatTint = mix(vIdentityColor, warmColor, vHeat);
        float heatAlpha = mix(0.07, 0.68, vHeat);
        emptyLabel.rgb = mix(emptyLabel.rgb, heatTint, heatRing * heatAlpha);

        // image-style label
        vec4 imgLabel = mix(color, vec4(1.0, 1.0, 1.0, 1.0), la * u_labelMix);

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

      // A reference used to wear two interlocked links on a dark disc at the
      // top of the tile, always. That mark read as an infinity badge sitting
      // on the picture, so it is gone (jwize, 2026-10-28). A reference paints
      // like any other tile: the moving border is a pathway, on hover.

      // divergence overlay: 1 = future-add (ghost), 2 = future-remove (marked).
      // 3 is NOT a divergence — it is the transient pheromone-preview carrier
      // flag, painted at the very end of this shader, so it is excluded here.
      if (vDivergence > 0.5 && vDivergence < 2.5) {
        if (vDivergence < 1.5) {
          // future-add: translucent cyan ghost
          color.rgb = mix(color.rgb, vec3(0.15, 0.35, 0.45), 0.5);
          color.a *= 0.35;
          // dashed border hint — stripe pattern along hex edge
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

      // world mode: tiles not (yet) public are dimmed — desaturated + darkened
      // + lower alpha — so the shared ones read brightly against them.
      if (vUnshared > 0.5) {
        float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        color.rgb = mix(color.rgb, vec3(gray), 0.55);
        color.rgb *= 0.5;
        color.a *= 0.7;
      }

      // LAYERS (jwize, 2026-10-15: "it needs to be layers you can switch the
      // top layer by clicking the member"). One layer is on top: yours, until
      // you click a member and theirs comes up. A tile the top layer does not
      // hold sits below it, quieter, never gone, and still there to click.
      if (vPresence.y > 0.5) {
        float lgray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        color.rgb = mix(color.rgb, vec3(lgray), 0.45);
        color.rgb *= 0.62;
      }

      // readiness shade: this tile's content is still arriving (image/props
      // fetch in flight) — desaturated + faded so a warming tile reads as "not
      // ready yet" while still plainly showing WHAT it is. Static by design (no
      // pulse). aShaded is CONTINUOUS: 1 while preloading, then ramped to 0 by
      // the release fade (show-cell #pumpShadeFade), so a tile fades IN when its
      // bytes land — an attribute ramp, never a geometry change. The shade is
      // informational only; a faded tile is still hoverable and clickable.
      if (vShaded > 0.004) {
        float k = clamp(vShaded, 0.0, 1.0);
        float sgray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        color.rgb = mix(color.rgb, vec3(sgray), 0.6 * k);
        color.rgb *= mix(1.0, 0.55, k);
        color.a *= mix(1.0, 0.5, k);
      }

      // hover accent: a pathway (this tile has hexagon children — a click
      // walks in) gets the moving border, and only while the pointer is on
      // it. A leaf gets a still outline, so a picture that goes nowhere does
      // not breathe. vHasBranch is the same per-tile signal the resting
      // chevron uses. A reference is not a pathway by itself.
      //   • PATHWAY → a breathing accent ring and two glints that orbit the
      //     rim. u_time advances only while a pathway is hovered.
      //   • LEAF    → a tight, cool-neutral outline, no motion.
      if (u_hoveredIndex >= 0.0 && abs(vCellIndex - u_hoveredIndex) < 0.5) {
        if (u_swapMode > 2.5) {
          // ── THE HEXAGON WALK ────────────────────────────────────────
          // the h key is armed: the click still enters, but lands on the grid
          // whatever view the place would open as. Said in the grid's own
          // shape — a solid rim and two hexagons stepping inward, a corridor
          // of hexagons you are about to walk down. Solid (never the cut
          // rim's dashes) because nothing leaves the page.
          color.rgb *= 1.05;
          float walkRim = 1.0 - smoothstep(0.0, aa * 2.2, abs(d + aa * 1.3));
          float walkMid = 1.0 - smoothstep(0.0, aa * 1.5, abs(d + u_radiusPx * 0.24));
          float walkIn = 1.0 - smoothstep(0.0, aa * 1.3, abs(d + u_radiusPx * 0.46));
          color.rgb = mix(color.rgb, u_swapColor, walkRim * 0.95);
          color.rgb = mix(color.rgb, u_swapColor, walkMid * 0.6);
          color.rgb = mix(color.rgb, u_swapColor, walkIn * 0.35);
        } else if (u_swapMode > 0.5) {
          // ── THE SWAP HOVER ──────────────────────────────────────────
          // The clipboard window is open, so this click does not navigate —
          // it MOVES the tile. Every other hover on this hive promises the
          // page will still be here afterwards; this one does not, and it has
          // to say so before the finger commits.
          //
          // So it is drawn in the one visual language that has always meant
          // exactly this: the CUT RIM — a dashed band around the tile, the
          // marching-ants outline every clipboard since the first one has
          // used. Static, never marching: the meaning is in the dashes, and
          // an animated rim on a page of forty tiles is noise. It cannot be
          // mistaken for the pathway ring (solid, accent, bloomed) or the
          // leaf outline (solid, tight, cool) because it is BROKEN, and a
          // broken line is not a shape this renderer draws anywhere else.
          //
          // The two verbs then part company on the inside of the tile, which
          // is the half that says what happens to it:
          //   TAKE → the tile RECEDES. Greyed and dimmed under the rim: it is
          //          leaving this page, and it already looks half gone.
          //   COPY → a SECOND rim, offset inward. Two outlines where there
          //          was one is the duplicate about to be made, said without
          //          a word.
          float swapAng = atan(local.y, local.x);
          // ~26 dashes around the rim: coarse enough to read as a cut line at
          // a glance, fine enough that a small tile still shows several.
          float swapDash = smoothstep(0.12, 0.62, sin(swapAng * 26.0) * 0.5 + 0.5);

          // The interior first, so the rims ride ON TOP of it rather than
          // being washed out by it.
          if (u_swapMode < 1.5) {
            float swapGray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
            color.rgb = mix(color.rgb, vec3(swapGray), 0.34);
            color.rgb *= 0.86;
          } else {
            color.rgb *= 1.06;
          }

          // The cut rim itself — pulled just inside the edge so the dashes sit
          // ON the tile and read against its own picture, not against the gap.
          float swapRim = 1.0 - smoothstep(0.0, aa * 2.4, abs(d + aa * 1.3));
          color.rgb = mix(color.rgb, u_swapColor, swapRim * swapDash * 0.95);

          if (u_swapMode > 1.5) {
            // COPY's second outline. Solid, thinner, and set a fixed FRACTION
            // of the tile in (not an antialias width) so the pair still reads
            // as two rims when the page is zoomed out.
            float swapGhost = 1.0 - smoothstep(0.0, aa * 1.4, abs(d + u_radiusPx * 0.085));
            color.rgb = mix(color.rgb, u_swapColor, swapGhost * 0.6);
          }
        } else if (vHasBranch > 0.5) {
          // PATHWAY, on hover only. A tile with hexagon children breathes:
          // an accent ring, two glints orbiting the rim, a soft bloom. Gentle
          // on purpose. u_time advances only while such a tile is hovered
          // (#setPathwayHover), so a page of leaves stays still.
          float ring = 1.0 - smoothstep(0.0, aa * 1.8, abs(d));
          float breathe = 0.79 + 0.21 * sin(u_time * 2.1);
          color.rgb = mix(color.rgb, u_accentColor, ring * 0.80 * breathe);
          float ang = atan(local.y, local.x);
          float glint = smoothstep(0.90, 1.0, cos(2.0 * (ang - u_time * 1.3))) * ring;
          color.rgb += mix(u_accentColor, vec3(1.0), 0.7) * glint * 0.45;
          float bloom = 1.0 - smoothstep(0.0, aa * 4.5, abs(d + aa * 1.6));
          color.rgb += u_accentColor * bloom * (0.10 + 0.07 * breathe);
        } else {
          // LEAF: tight cool-neutral outline — clearly a highlight, but flatter
          // and uncoloured so it can't be mistaken for the pathway accent glow
          vec3 leafHover = vec3(0.74, 0.82, 0.94);
          float leafRing = 1.0 - smoothstep(0.0, aa * 1.15, abs(d));
          color.rgb = mix(color.rgb, leafHover, leafRing * 0.6);
        }
      }

      // ── Pheromone preview: which tiles carry the mark under the cursor ───
      // A hovered mark asks exactly one question, and the hive is the only
      // surface that can answer it. So it answers on the hive: the carriers
      // take the mark's OWN colour, hold a slow breath, and everything else
      // recedes to a grey backdrop, which is what makes them findable at a
      // glance across a full page. Drawn last, after the hover accent, so the
      // answer is never washed out by whatever the cursor is also sitting on.
      if (u_markPreview > 0.002) {
        float mk = clamp(u_markPreview, 0.0, 1.0);
        if (vDivergence > 2.5) {
          float breathe = 0.84 + 0.16 * sin(u_time * 2.4);
          vec3 bright = mix(u_markColor, vec3(1.0), 0.35);
          // A carrier gets BRIGHTER. Dimming its neighbours alone reads as "the
          // page broke", not as "these ones" — the answer has to come forward.
          color.rgb = mix(color.rgb, u_markColor, 0.12 * mk);
          color.rgb *= 1.0 + 0.12 * mk;
          // The prominent part: a rim band painted in the mark's own colour,
          // sized as a FRACTION OF THE TILE (u_radiusPx) rather than in
          // antialias widths — an aa-wide hairline disappears the moment the
          // page is zoomed out, which is exactly when you most need to find
          // the marked tiles.
          float markBand = 1.0 - smoothstep(u_radiusPx * 0.06, u_radiusPx * 0.16, abs(d));
          color.rgb = mix(color.rgb, u_markColor, markBand * 0.62 * mk * breathe);
          // a crisp lit edge riding on top of the band
          float markEdge = 1.0 - smoothstep(0.0, aa * 2.0, abs(d));
          color.rgb = mix(color.rgb, bright, markEdge * 0.95 * mk);
          // and the band bleeding inward — the scent coming off the tile
          float markBloom = 1.0 - smoothstep(0.0, u_radiusPx * 0.30, abs(d));
          color.rgb += u_markColor * markBloom * 0.07 * mk * breathe;
        } else {
          // Everything unmarked recedes. Enough to leave the carriers alone on
          // the page, not so much that the hive looks switched off — the page
          // is still there, and the cursor is still travelling a list.
          float markGray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
          color.rgb = mix(color.rgb, vec3(markGray), 0.72 * mk);
          color.rgb *= mix(1.0, 0.50, mk);
          color.a *= mix(1.0, 0.62, mk);
        }
      }

      // Let the surface behind the hive breathe through the tiles. Apply the
      // translucency at the final composite so pictures, labels, borders, and
      // hover treatments keep their relative contrast as one coherent tile.
      const float HIVE_ALPHA = 0.88;
      color.a *= hexAlpha * (honey ? 1.0 : HIVE_ALPHA);
      color.rgb *= color.a;
      fragColor = color;
    }
  `
}

export class HexSdfTextureShaderFactory {
  create = (labelAtlas: Texture, cellImageAtlas: Texture, quadW: number, quadH: number, radiusPx: number): HexSdfTextureShader => {
    return new HexSdfTextureShader(labelAtlas, cellImageAtlas, quadW, quadH, radiusPx)
  }
}

// presentation/tiles/show-cell.drone.ts — the first paint reads it registers this (atomic-modules-plan.md): a dependency registers nothing.
