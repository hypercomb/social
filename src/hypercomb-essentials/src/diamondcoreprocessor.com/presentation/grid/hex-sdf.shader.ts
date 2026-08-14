// diamondcoreprocessor.com/pixi/hex-sdf.shader.ts
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
      u_imageMix: { value: 1.0, type: 'f32' },
      u_accentColor: { value: [0.4, 0.85, 1.0], type: 'vec3<f32>' },
      // Launcher motion (vertex stage). u_driftAmp = 0 disables it entirely
      // (the common case); > 0 lets the game tiles march to u_time. See
      // vertexSource.
      u_time: { value: 0, type: 'f32' },
      u_driftAmp: { value: 0, type: 'f32' },
      // Tile silhouette is PER-TILE — the `aShapeMode` vertex attribute (0 =
      // hexagon · 2 = Space Invader; 1 retired), so a mixed
      // launch-group page renders each group's OWN shape and groups never share a
      // visual type. There is no global u_shapeMode uniform; see both shaders.
    }

    // v8 shaded mesh requires uniforms nested under a group and shader inputs using in/out
    this.shader = Shader.from({
      gl: { vertex: HexSdfTextureShader.vertexSource, fragment: HexSdfTextureShader.fragmentSource },
      resources: {
        uniforms: uniformDefs,
        u_label: this.toSource(labelAtlas),
        u_cellImages: this.toSource(cellImageAtlas),
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


  public setLabelAtlas = (t: Texture): void => {
    ;(this.shader.resources as any).u_label = this.toSource(t)
  }

  public setCellImageAtlas = (t: Texture): void => {
    ;(this.shader.resources as any).u_cellImages = this.toSource(t)
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
    in float aIsPortal;

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
    out float vIsPortal;

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
      if (u_driftAmp > 0.0 && aShapeMode > 1.5) {
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
      vIsPortal = aIsPortal;
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
    in float vIsPortal;

    uniform vec2 u_quadSize;
    uniform float u_radiusPx;
    uniform float u_flat;
    uniform float u_pivot;
    uniform float u_hoveredIndex;
    uniform float u_bandRows;
    uniform float u_labelMix;
    uniform float u_imageMix;
    uniform vec3 u_accentColor;
    uniform float u_time;

    uniform sampler2D u_label;
    uniform sampler2D u_cellImages;

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
    float labelFill(vec2 uv) {
      float sd = texture(u_label, uv).r;
      float aa = clamp(fwidth(sd), 1e-4, 0.3);
      return smoothstep(0.5 - aa, 0.5 + aa, sd);
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
      if (vShapeMode > 1.5) {
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
        fragColor = vec4(col * alpha, alpha);
        return;
      }

      // Every normal hive page: the hexagon, into the distance-driven pipeline.
      float d = sdHex(rotated, u_radiusPx);

      // smooth the hex edge — wider band for clean AA
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

      // bevel highlight (top-left light) and shadow (bottom-right)
      float highlightStrength = max(bevelDot, 0.0) * edgeProximity * 0.06;
      float shadowStrength = max(-bevelDot, 0.0) * edgeProximity * 0.08;
      base.rgb += vec3(1.0) * highlightStrength;
      base.rgb -= vec3(1.0) * shadowStrength;

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
      float la = labelFill(luv);   // plain white fill, nothing else

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
      float bandMask = (1.0 - smoothstep(0.0, bandAA, bandD)) * max(labelPresent, hovered);
      // Hover sits DARKER than the resting pill — the icons ride this, so it
      // has to hold them against any picture. At rest the pill is untouched.
      color.rgb = mix(color.rgb, vec3(0.0), bandMask * mix(imgBlend * 0.55, 0.72, hovered) * u_labelMix);

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
        // no image: bright white label
        color = mix(color, vec4(1.0, 1.0, 1.0, 1.0), la * u_labelMix);

        // ambient presence — identity color at rest, shifts to warm amber with heat
        float heatRing = smoothstep(0.0, -1.5, d) - smoothstep(-4.0, -6.0, d);
        vec3 warmColor = vec3(1.0, 0.62, 0.12);
        vec3 heatTint = mix(vIdentityColor, warmColor, vHeat);
        float heatAlpha = mix(0.07, 0.68, vHeat);
        color.rgb = mix(color.rgb, heatTint, heatRing * heatAlpha);
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

      // divergence overlay: 1 = future-add (ghost), 2 = future-remove (marked)
      if (vDivergence > 0.5) {
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

      // hover accent: TWO distinct border highlights so a pathway tile (has
      // children — a click navigates IN) never reads the same on hover as a
      // leaf (a click acts in place). vHasBranch is the SAME per-tile pathway
      // signal the branch indicator above uses, so the hover state reinforces
      // the persistent chevron rather than washing it out. The two differ in
      // hue, ring weight, and bloom, so which kind of tile is under the cursor
      // is unmistakable at a glance:
      //   • PATHWAY → the energetic accent colour, a bold ring + outward bloom
      //     — an "enter / go deeper" cue that lights up with the chevron.
      //   • LEAF    → a tight, cool-neutral outline with no bloom — a quiet
      //     "focused, stops here" highlight that never masquerades as the
      //     accent-coloured pathway glow.
      if (u_hoveredIndex >= 0.0 && abs(vCellIndex - u_hoveredIndex) < 0.5) {
        if (vIsPortal > 0.5) {
          // PORTAL: a reference tile is a doorway to another lineage — the one
          // place a little enchantment is earned. Kept TASTEFUL, not confetti:
          // a breathing accent ring, a pair of near-white glints that slowly
          // orbit the rim (a charged-gateway shimmer), and a soft pulsing bloom
          // into the gap. The motion is the whole trick, so it stays gentle —
          // anything faster or brighter tips into cheesy. u_time only advances
          // while a portal is hovered (see #setPortalShimmer), so tiles are
          // perfectly still until you land on a portal.
          float ring = 1.0 - smoothstep(0.0, aa * 1.8, abs(d));

          // slow breathe (~0.58..1.0) — life, never a strobe
          float breathe = 0.79 + 0.21 * sin(u_time * 2.1);
          color.rgb = mix(color.rgb, u_accentColor, ring * 0.80 * breathe);

          // two opposed glints sweeping around the frame — the magical signature
          float ang = atan(local.y, local.x);
          float glint = smoothstep(0.90, 1.0, cos(2.0 * (ang - u_time * 1.3))) * ring;
          color.rgb += mix(u_accentColor, vec3(1.0), 0.7) * glint * 0.45;

          // soft breathing bloom just outside the edge — the portal glows out
          float bloom = 1.0 - smoothstep(0.0, aa * 4.5, abs(d + aa * 1.6));
          color.rgb += u_accentColor * bloom * (0.10 + 0.07 * breathe);
        } else if (vHasBranch > 0.5) {
          // PATHWAY: crisp accent ring — heavier than a leaf's so a tile with
          // children reads as actionable navigation
          float hoverRing = 1.0 - smoothstep(0.0, aa * 1.8, abs(d));
          color.rgb = mix(color.rgb, u_accentColor, hoverRing * 0.85);

          // outward accent bloom — the radiating "come in" halo, leaf-absent
          float hoverBloom = 1.0 - smoothstep(0.0, aa * 4.0, abs(d + aa * 1.5));
          color.rgb += u_accentColor * hoverBloom * 0.16;
        } else {
          // LEAF: tight cool-neutral outline — clearly a highlight, but flatter
          // and uncoloured so it can't be mistaken for the pathway accent glow
          vec3 leafHover = vec3(0.74, 0.82, 0.94);
          float leafRing = 1.0 - smoothstep(0.0, aa * 1.15, abs(d));
          color.rgb = mix(color.rgb, leafHover, leafRing * 0.6);
        }
      }

      // Let the surface behind the hive breathe through the tiles. Apply the
      // translucency at the final composite so pictures, labels, borders, and
      // hover treatments keep their relative contrast as one coherent tile.
      const float HIVE_ALPHA = 0.88;
      color.a *= hexAlpha * HIVE_ALPHA;
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

window.ioc.register('@diamondcoreprocessor.com/HexSdfTextureShaderFactory', new HexSdfTextureShaderFactory())
