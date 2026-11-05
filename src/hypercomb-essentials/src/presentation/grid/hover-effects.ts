// presentation/grid/hover-effects.ts
//
// WHAT A TILE'S BORDER DOES WHILE THE POINTER IS ON IT — an extension point
// (documentation/hover-animation.md, traits.md).
//
// It was one hard-coded branch in the hex fragment shader: a pathway (a tile
// with hexagon children) breathed an accent ring with two glints orbiting the
// rim, a leaf got a still outline. Those two looks are now the trait's OWN
// versions — the code below is that branch moved, not changed — and the trait
// `hover-animation` lets a tile pick another by a filler tile's name:
//
//   trait own hover-animation      the tile has the seat (no tile is made)
//   fill hover-animation /mist     the tile named `mist` is the filler: mist
//   fill ~ hover-animation         back to its own version
//
// WHY THE FILLER IS A NAME AND NOT SHADER CODE. A mark travels with a tile to
// everyone who gets it, and a peer's marks are untrusted: a mark may SELECT a
// renderer, never supply one. So the word picks among looks this file ships,
// and an unknown word falls back to the tile's own version rather than doing
// nothing — the same rule the quick menu's seats follow. A new LOOK is code and
// arrives the way all code does, as an admitted bee; the program is compiled
// once, so it reaches the shader on the next load (see "Not built" in the doc).
//
// The shader cannot import this, so its source is built here and spliced in by
// `hex-sdf.shader.ts`; the ids in the dispatcher and in the table are one list.

import { sameTraitWord } from '@hypercomb/core'

/** The trait word. A tile that wears it may pick its hover animation. */
export const HOVER_ANIMATION_TRAIT = 'hover-animation'

export interface HoverEffect {
  /** The filler tile's name that picks this look. */
  readonly word: string
  /** The shader's `u_hoverFx`. 0 is reserved: "the tile's own version". */
  readonly id: number
  /** The GLSL call, with `color`, `d`, `aa` and `local` in scope. */
  readonly call: string
}

/** Ascending by id — the dispatcher below is an `else if` chain over it. */
export const HOVER_EFFECTS: readonly HoverEffect[] = [
  { word: 'glints', id: 1, call: 'hfxGlints(color, d, aa, local);' },
  { word: 'outline', id: 2, call: 'hfxOutline(color, d, aa);' },
  { word: 'glow', id: 3, call: 'hfxGlow(color, d, aa);' },
  { word: 'mist', id: 4, call: 'hfxMist(color, d, aa, local);' },
  { word: 'smoke', id: 5, call: 'hfxSmoke(color, d, aa, local);' },
  { word: 'celebrate', id: 6, call: 'hfxCelebrate(color, d, aa, local);' },
]

/** What a tile does with no filler: a pathway breathes, a leaf is outlined. */
export const OWN_PATHWAY_EFFECT = 'glints'
export const OWN_LEAF_EFFECT = 'outline'

const idOf = (word: string): number => HOVER_EFFECTS.find(e => e.word === word)?.id ?? 0

/** The effect a filler's name picks; 0 when the name is not a look we ship. */
export function hoverEffectId(word: unknown): number {
  return HOVER_EFFECTS.find(e => sameTraitWord(e.word, word))?.id ?? 0
}

const dispatch = HOVER_EFFECTS
  .map((e, i) => `${i === 0 ? 'if' : 'else if'} (id < ${e.id}.5) { ${e.call} }`)
  .join('\n      ')

/** GLSL ES 3.00, spliced into the hex fragment shader after its uniforms. Every
 *  look stays inside the hexagon (d <= 0): the final alpha trims the rest. */
export const HOVER_FX_GLSL = /* glsl */ `
    // ── HOVER ANIMATION ─ presentation/grid/hover-effects.ts ───────────────
    float hfxHash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float hfxNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hfxHash(i);
      float b = hfxHash(i + vec2(1.0, 0.0));
      float c = hfxHash(i + vec2(0.0, 1.0));
      float e = hfxHash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
    }
    float hfxFbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * hfxNoise(p);
        p = p * 2.03 + vec2(17.0, 9.0);
        a *= 0.5;
      }
      return v;
    }

    // PATHWAY'S OWN: a breathing accent ring and two glints orbiting the rim, a
    // soft bloom. Gentle on purpose. u_time advances only while a hovered tile
    // wants it (show-cell #setPathwayHover), so a page of leaves stays still.
    void hfxGlints(inout vec4 color, float d, float aa, vec2 local) {
      float ring = 1.0 - smoothstep(0.0, aa * 1.8, abs(d));
      float breathe = 0.79 + 0.21 * sin(u_time * 2.1);
      color.rgb = mix(color.rgb, u_accentColor, ring * 0.80 * breathe);
      float ang = atan(local.y, local.x);
      float glint = smoothstep(0.90, 1.0, cos(2.0 * (ang - u_time * 1.3))) * ring;
      color.rgb += mix(u_accentColor, vec3(1.0), 0.7) * glint * 0.45;
      float bloom = 1.0 - smoothstep(0.0, aa * 4.5, abs(d + aa * 1.6));
      color.rgb += u_accentColor * bloom * (0.10 + 0.07 * breathe);
    }

    // LEAF'S OWN: a tight cool-neutral outline, no motion — clearly a highlight,
    // but flatter and uncoloured so it cannot be mistaken for the pathway glow.
    void hfxOutline(inout vec4 color, float d, float aa) {
      vec3 leafHover = vec3(0.74, 0.82, 0.94);
      float leafRing = 1.0 - smoothstep(0.0, aa * 1.15, abs(d));
      color.rgb = mix(color.rgb, leafHover, leafRing * 0.6);
    }

    // GLOW: the rim lit from inside, breathing slowly.
    void hfxGlow(inout vec4 color, float d, float aa) {
      float breathe = 0.5 + 0.5 * sin(u_time * 1.8);
      float depth = max(-d, 0.0);
      float halo = exp(-depth / (u_radiusPx * 0.20));
      float ring = 1.0 - smoothstep(0.0, aa * 1.8, abs(d));
      vec3 hot = mix(u_accentColor, vec3(1.0), 0.35);
      color.rgb = mix(color.rgb, hot, ring * 0.9);
      color.rgb += u_accentColor * halo * (0.22 + 0.22 * breathe);
    }

    // MIST: pale fog drifting in along the rim, thickest at the edge.
    void hfxMist(inout vec4 color, float d, float aa, vec2 local) {
      float depth = max(-d, 0.0);
      float band = exp(-depth / (u_radiusPx * 0.34));
      vec2 p = local / u_radiusPx;
      float n1 = hfxFbm(p * 1.4 + vec2(u_time * 0.18, -u_time * 0.12));
      float n2 = hfxFbm(p * 2.2 - vec2(u_time * 0.10, u_time * 0.16) + 7.3);
      float fog = smoothstep(0.30, 0.82, n1 * 0.6 + n2 * 0.55) * band;
      vec3 pale = mix(u_accentColor, vec3(0.93, 0.96, 1.0), 0.75);
      color.rgb = mix(color.rgb, pale, fog * 0.66);
      float ring = 1.0 - smoothstep(0.0, aa * 1.6, abs(d));
      color.rgb = mix(color.rgb, pale, ring * 0.40);
    }

    // SMOKE: dark wisps climbing the tile, deeper into it than mist reaches.
    void hfxSmoke(inout vec4 color, float d, float aa, vec2 local) {
      float depth = max(-d, 0.0);
      float band = exp(-depth / (u_radiusPx * 0.46));
      vec2 p = local / u_radiusPx;
      float n = hfxFbm(vec2(p.x * 2.0, p.y * 1.7 + u_time * 0.5) + 3.1);
      float wisp = smoothstep(0.40, 0.80, n) * band;
      vec3 soot = mix(vec3(0.18, 0.20, 0.25), u_accentColor, 0.22);
      color.rgb = mix(color.rgb, soot, wisp * 0.72);
      float ring = 1.0 - smoothstep(0.0, aa * 1.5, abs(d));
      color.rgb = mix(color.rgb, mix(soot, u_accentColor, 0.5), ring * 0.45);
    }

    // CELEBRATE: a gold rim that flashes and confetti sparks twinkling round it.
    void hfxCelebrate(inout vec4 color, float d, float aa, vec2 local) {
      float ring = 1.0 - smoothstep(0.0, aa * 1.8, abs(d));
      float flash = 0.65 + 0.35 * sin(u_time * 5.0);
      color.rgb = mix(color.rgb, vec3(1.0, 0.83, 0.38), ring * 0.75 * flash);
      float cell = atan(local.y, local.x) * 18.0 / 6.2831853;
      float idx = floor(cell);
      float fa = fract(cell) - 0.5;
      float h = hfxHash(vec2(idx, 3.7));
      float h2 = hfxHash(vec2(idx, 9.1));
      float at = u_radiusPx * (0.07 + 0.30 * h);
      float rr = length(vec2(fa * 1.5, (d + at) / (u_radiusPx * 0.22)));
      float twinkle = pow(0.5 + 0.5 * sin(u_time * (2.0 + 3.0 * h2) + h * 40.0), 6.0);
      float spark = (1.0 - smoothstep(0.0, 0.55, rr)) * twinkle;
      vec3 confetti = 0.55 + 0.45 * cos(6.2831853 * (h2 + vec3(0.0, 0.33, 0.67)));
      color.rgb += confetti * spark * 1.1;
    }

    // fx 0 is the tile's own version; anything else is the trait's pick.
    void hfxApply(float fx, bool pathway, inout vec4 color, float d, float aa, vec2 local) {
      float id = fx > 0.5 ? fx : (pathway ? ${idOf(OWN_PATHWAY_EFFECT)}.0 : ${idOf(OWN_LEAF_EFFECT)}.0);
      ${dispatch}
    }
`
