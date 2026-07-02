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
      u_labelMix: { value: 1.0, type: 'f32' },
      u_imageMix: { value: 1.0, type: 'f32' },
      u_neon: { value: 0, type: 'f32' },
      u_accentColor: { value: [0.4, 0.85, 1.0], type: 'vec3<f32>' },
      // Launcher "cloud" drift (vertex stage). u_driftAmp = 0 disables it
      // entirely (the common case); > 0 makes each tile wander on a very slow
      // per-tile Lissajous orbit driven by u_time. See vertexSource.
      u_time: { value: 0, type: 'f32' },
      u_driftAmp: { value: 0, type: 'f32' },
      // Tile silhouette is PER-TILE — the `aShapeMode` vertex attribute (0 =
      // hexagon · 1 = websites silhouette · 2 = Space Invader), so a mixed
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

  public setNeon = (on: boolean): void => {
    this.#ug.uniforms.u_neon = on ? 1.0 : 0.0
    this.#ug.update()
  }

  public setHoveredIndex = (index: number): void => {
    this.#ug.uniforms.u_hoveredIndex = index
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
    in float aShapeMode;

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
    out float vShapeMode;

    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    uniform mat3 uTransformMatrix;
    uniform float u_time;
    uniform float u_driftAmp;

    void main() {
      mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;

      // Launcher motion, per group. Websites' CLOUDS drift gently on their own
      // slow Lissajous orbit (golden-angle phase decorrelates them); GAMES do a
      // Space-Invaders FORMATION march (shared phase → step together, small hop).
      // Every normal hive page has u_driftAmp = 0 and is skipped. Offsets are
      // identical across a quad's 4 vertices, so the tile translates rigidly and
      // its centre stays inside its pointer→axial click catchment (TileOverlay).
      vec2 p = aPosition;
      if (u_driftAmp > 0.0) {
        if (aShapeMode > 1.5) {
          float stepX = floor(sin(u_time * 0.55) * 4.0) / 4.0;   // quantized → stepped sway
          float bob   = sin(u_time * 2.0) * 0.06;
          p += vec2(stepX * u_driftAmp * 1.6, bob * u_driftAmp);
        } else if (aShapeMode > 0.5) {
          float phase = aCellIndex * 2.39996323;                 // golden angle (rad)
          p += vec2(sin(u_time * 0.16 + phase),
                    sin(u_time * 0.13 + phase * 1.7 + 1.5707963)) * u_driftAmp;
        }
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
      vShapeMode = aShapeMode;
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
    in float vShapeMode;

    uniform vec2 u_quadSize;
    uniform float u_radiusPx;
    uniform float u_flat;
    uniform float u_pivot;
    uniform float u_hoveredIndex;
    uniform float u_labelMix;
    uniform float u_imageMix;
    uniform float u_neon;
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

    float sdCircle(vec2 p, vec2 c, float r) {
      return length(p - c) - r;
    }

    // Polynomial smooth-min — rounds the seam where two circles meet so the
    // cloud reads as one puffy mass, not overlapping discs.
    float smin(float a, float b, float k) {
      float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
      return mix(b, a, h) - k * h * (1.0 - h);
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
      // Websites: a fluffy cartoon CLOUD — a website lives IN the cloud, so the
      // site's snapshot is clipped to a big, round, cumulus silhouette with a
      // bold drawn outline and the name across the bottom. Drifts gently (vertex
      // shader). Drawn and returned here (skips the hex/image/label pipeline
      // below). r = hex radius.
      if (vShapeMode > 0.5 && vShapeMode < 1.5) {
        float r = u_radiusPx;
        float aa = max(r * 0.04, 1.5);

        // round overlapping puffs → a fat, fluffy cumulus. Small smooth-min keeps
        // the bumps defined (fluffy), not melted into one blob; a flat-ish bottom
        // sells the cloud. Extents stay within ±0.85r so it never clips the quad.
        float k = r * 0.13;
        float d =      sdCircle(local, vec2( 0.00 * r,  0.04 * r), 0.44 * r);   // body
        d = smin(d,    sdCircle(local, vec2(-0.42 * r,  0.10 * r), 0.30 * r), k); // left
        d = smin(d,    sdCircle(local, vec2( 0.44 * r,  0.08 * r), 0.30 * r), k); // right
        d = smin(d,    sdCircle(local, vec2(-0.20 * r, -0.22 * r), 0.31 * r), k); // upper-left puff
        d = smin(d,    sdCircle(local, vec2( 0.18 * r, -0.26 * r), 0.30 * r), k); // upper-right puff
        d = smin(d,    sdCircle(local, vec2(-0.64 * r,  0.18 * r), 0.22 * r), k); // far-left shoulder
        d = smin(d,    sdCircle(local, vec2( 0.66 * r,  0.18 * r), 0.20 * r), k); // far-right shoulder
        d = max(d, local.y - 0.42 * r);   // flat bottom

        float alpha = 1.0 - smoothstep(-aa, aa, d);
        if (alpha < 0.005) discard;

        // the website lives in the cloud: snapshot clipped to the silhouette; a
        // soft top-lit white puff when imageless.
        vec2 cMin = vec2(-0.84 * r, -0.58 * r);
        vec2 cMax = vec2( 0.84 * r,  0.42 * r);
        vec2 cuv = clamp((local - cMin) / (cMax - cMin), 0.0, 1.0);
        vec3 col = (vHasImage > 0.5 && u_imageMix > 0.001)
          ? texture(u_cellImages, mix(vImageUV.xy, vImageUV.zw, cuv)).rgb
          : mix(vec3(0.97, 0.99, 1.0), vec3(0.76, 0.85, 0.95), clamp(local.y / r * 0.7 + 0.5, 0.0, 1.0));

        // name across the bottom of the cloud — a soft dark band so it stays
        // legible over the snapshot, with the BIG name on it. The atlas glyph is
        // baked large (see LABEL_BAND), so the sample window is divided by it to
        // keep the displayed name the same size, just crisp; text lands centre-band.
        float inBar = smoothstep(0.14 * r - aa, 0.14 * r + aa, local.y);
        col = mix(col, vec3(0.05, 0.08, 0.11), inBar * 0.52);

        // bold rounded cartoon outline tracing the puffy silhouette — drawn
        // BEFORE the name so the dark band can never paint over the letters.
        // (It used to composite after the label; near the cloud's flat bottom
        // the band crossed the glyph descenders and read as a stroke on the
        // text. Text must always be the last thing composited.)
        float lineW = aa * 1.9;
        col = mix(col, vec3(0.16, 0.24, 0.36), (1.0 - smoothstep(lineW, lineW + aa * 1.6, abs(d))) * 0.9);

        vec2 labC = vec2(0.0, 0.28 * r);
        vec2 labHalf = vec2(0.78 * r / LABEL_BAND);   // LABEL_BAND unchanged → same on-screen size
        vec2 labUV = (local - (labC - labHalf)) / (2.0 * labHalf);
        float textA = (labUV.x >= 0.0 && labUV.x <= 1.0 && labUV.y >= 0.0 && labUV.y <= 1.0)
          ? labelFill(mix(vLabelUV.xy, vLabelUV.zw, labUV)) * u_labelMix
          : 0.0;
        col = mix(col, vec3(1.0), textA);

        fragColor = vec4(col * alpha, alpha);
        return;
      }

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
          ? texture(u_cellImages, mix(vImageUV.xy, vImageUV.zw, iuv)).rgb
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
        // pivot mode: rotate snapshot 90° CW inside the hex
        if (u_pivot > 0.5) {
          hexUV = vec2(hexUV.y, 1.0 - hexUV.x);
        }
        vec2 imgUV = mix(vImageUV.xy, vImageUV.zw, hexUV);
        vec4 imgBase = texture(u_cellImages, imgUV);

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

      // label text — always rendered. Sample the central 1/LABEL_BAND of the
      // cell (glyphs are baked large; see LABEL_BAND) so the on-screen size
      // matches the old 9px bake but with 3× the texels → crisp. Clamp keeps
      // out-of-band UVs on this cell's transparent border, never a neighbour.
      vec2 luv = mix(vLabelUV.xy, vLabelUV.zw, clamp((vUV - 0.5) * LABEL_BAND + 0.5, 0.0, 1.0));
      float la = labelFill(luv);   // vector-sharp glyph fill — plain white, nothing else

      if (imgBlend < 0.001) {
        // no image: bright white label
        color = mix(color, vec4(1.0, 1.0, 1.0, 1.0), la * 0.92 * u_labelMix);

        // ambient presence — identity color at rest, shifts to warm amber with heat
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

      // neon mode (control-bar toggle): every tile's border lights up with an
      // additive glow — a wide soft bloom, a mid bloom, and a crisp core rim —
      // mirroring the screensaver's neon edge. The hue leans from the active
      // accent colour toward each tile's own border colour, so peer groups glow
      // their own hue. The shape is untouched; only the rim lights up. Bloom is
      // clipped to the hex by hexAlpha below, so it reads as an inner-edge neon.
      if (u_neon > 0.5) {
        float edge = abs(d);
        float rim  = 1.0 - smoothstep(0.0, aa * 1.6,  edge);
        float midB = 1.0 - smoothstep(0.0, aa * 4.5,  edge);
        float wide = 1.0 - smoothstep(0.0, aa * 10.0, edge);
        vec3 neon = mix(u_accentColor, vBorderColor, 0.45);
        color.rgb += neon * wide * 0.10;
        color.rgb += neon * midB * 0.22;
        color.rgb = mix(color.rgb, neon, rim * 0.92);
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
