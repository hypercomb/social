# DIAMOND CORE PROCESSOR — VISUAL OVERHAUL
## "CALIPER" · The Binding Specification

**Status:** Normative. This document is the single source of truth. Where it conflicts with either survey or either judge, **this document wins**. Implementers must not make taste decisions; if something here is genuinely undefined, stop and ask rather than inventing.

**Direction:** CALIPER (spine) with seven grafts from Cold Press and three from Living Lattice, plus three explicit cuts. All conflicts between the judges are resolved below and marked **[RESOLVED]** where the two judges disagreed.

**One-line thesis for everyone touching this:** *a machinist's bench instrument — cold slate body, hairline engraving, one champagne-brass indicator lamp, mechanisms that seat and latch under your hand.* Cool = structure. Warm = **live**. Nothing glows. Nothing loops. Nothing breathes on hover. Motion happens only when the machine commits, and it is over in under 500 ms.

---

# 0. THE THREE CUTS, RESTATED FIRST SO THEY ARE NOT LOST

These are removals. Do not implement them, do not "try them and see".

**CUT 1 — No specular sheen on the brand mark.** Do **not** implement `@keyframes dcp-crown-sweep`, the `.sheen` rect, the `#dcpSheen` gradient, `dcp-glint`, or any white-gradient wipe across the logo. The gold signature axis (spine) and its `dcp-spine-run` state binding survive intact and carry the entire "instrument that breathes" idea. A white band sweeping the mark is the bloom/glint category that has been repeatedly torn out of this codebase.

**CUT 2 — No ambient hexagonal lattice backdrop.** Do **not** implement a three-depth hex field, a repeating SVG data-URI wallpaper, or any tiled pattern behind the page. It moirés at 125 %/150 % Windows scaling (the target's default), it is one ancestor `transform` away from vanishing, and its own success condition is that you cannot see it. The page floor is provided instead by §4.1 (a single static radial wash) and by the widened surface ladder.

**CUT 3 — Do NOT rename `.just-adopted` and do NOT retime `setTimeout(2200)`.** **[RESOLVED — Judge 2's ruling wins over Judge 1's.]** `home.component.ts` line ~1610/1611 adds the class imperatively and removes it 2200 ms later. The hard constraint in the brief is that **only the `@Component` decorator of `home.component.ts` may be edited**. An expired class sitting on a finished `animation:` is inert, so the CSS animation is shortened to 480 ms and the class simply lingers, doing nothing, for the remaining ~1.7 s. Keep the class name `just-adopted`. Keep the timeout. The only cost is that a second adopt inside 2.2 s will not re-trigger the gesture; that is acceptable and reversible later.

---

# 1. THE COMPLETE TOKEN LAYER — `src/styles.scss`

`src/styles.scss` is a **global** stylesheet. It is budgeted under Angular's `initial` budget (1 MB warn), **not** under `anyComponentStyle` (32 kB warn / 48 kB error per sheet). Therefore: **every design token, every `@keyframes`, every shared primitive class, and the reduced-motion block lives here and costs zero component budget.** Angular's emulated view encapsulation attribute-scopes *rules* but does **not** rename `@keyframes` declared in a different sheet — a keyframe declared here is callable **by name** from every component sheet and every inline `styles:` array. This is verified against `@angular/compiler` (`_scopeAnimationKeyframe` only renames names present in the same sheet's `unscopedKeyframesSet`).

## 1.0 Rules for this file

- **Every token name that exists today survives.** You may add; you may change a value; you may **not** delete or rename a token. Unswept call sites must never render unstyled.
- `--dcp-gold`, `--dcp-gold-strong`, `--dcp-gold-dim`, `--dcp-gold-ink` and `--dcp-ice` currently live in the shared `:root`. They **move into both theme mixins** (gold must be pale on dark and deep on light). The names are unchanged, so no call site breaks. **These four gold names are the leak vector for gold's reserved meaning — audit them at the end of the pass (§9.3).**
- `--dcp-ui` stays in `:root` (typeface is theme-independent).
- Delete `@import 'highlight.js/styles/github-dark.css'` from this file and replace it with the `--dcp-code-*` override block (§1.5).
- Delete `font-feature-settings: "tnum" 1` from `body` (§2.4).

## 1.1 Complete file skeleton

Write the file in exactly this order:

```scss
@use '../../hypercomb-shared/fonts/fonts';

html { height: 100%; }

/* ═══════════════════════════════════════════════════════════════════════
   DCP DESIGN TOKENS — "CALIPER"
   Dark is the DEFAULT and the priority. Light is a real theme at a second
   lightness, not an inversion: the same steel identity and the same brass
   identity, re-lightened. Opt in with data-dcp-theme="light" on <html>.
   ═══════════════════════════════════════════════════════════════════════ */

@mixin dcp-dark { /* §1.2 */ }
@mixin dcp-light { /* §1.3 */ }

:root {
  @include dcp-dark;
  color-scheme: dark;
  /* §1.4 — geometry, type, motion, spacing (theme-independent) */
}
:root[data-dcp-theme='light'] { @include dcp-light; color-scheme: light; }

/* §2.4 — body + tabular figures */
/* §1.5 — code surface overrides (replaces the github-dark @import) */
/* §3.2 — the keyframe library */
/* §3.5 — the reduced-motion collapse */
/* §7 — the five shared primitives */
/* §4.1 — the page wash */

@media (max-width: 600px) {
  input, textarea, select { font-size: 16px !important; }
}
```

## 1.2 `@mixin dcp-dark` — the complete dark palette (DEFAULT)

```scss
@mixin dcp-dark {
  /* ── GROUND. Cool slate cast (hue ~222), WIDE steps.
     WAS: #0c0c0e / #141417 / #17181c / #1e1f24 — four hue-less neutrals in
     18 L, with a 3-point surface→surface-2 step that made every :hover
     imperceptible. surface→surface-2 is now ~7 L. ── */
  --dcp-sunken:           #06080d;   /* NEW — inset wells: inputs, off toggle track */
  --dcp-bg:               #0a0c11;   /* was #0c0c0e */
  --dcp-surface:          #11141b;   /* was #141417 */
  --dcp-surface-2:        #171b24;   /* was #17181c */
  --dcp-raise:            #1e2430;   /* was #1e1f24 */
  --dcp-surface-inactive: #0e1117;   /* NEW — "off by design", replaces opacity states */

  /* frosted plates — popovers ONLY. NEVER on .domain-header (see §6.9). */
  --dcp-glass:        rgba(23, 27, 36, 0.72);   /* NEW */
  --dcp-glass-strong: rgba(17, 20, 27, 0.90);   /* NEW */
  --dcp-glass-blur:   blur(18px) saturate(1.15);/* NEW */
  --dcp-glass-hi:     rgba(226, 236, 255, 0.055); /* NEW — 1px top highlight */

  /* ── INK. ink-3 rises from ~3:1 to ~5.2:1. ink-4 is REDECLARED NON-TEXT.
     WAS: #f2f1ec / #a6a59c / #6d6c64 / #4c4b45 (ink-4 ≈ 2.5:1 — a hard fail
     used for the install placeholder, the specbar and the row crumb). ── */
  --dcp-ink:          #e8ecf4;   /* ~14.5:1 on --dcp-surface */
  --dcp-ink-2:        #a8b2c4;   /* ~8.7:1 */
  --dcp-ink-3:        #7d879b;   /* ~5.2:1 — THE FLOOR FOR ANY TEXT */
  --dcp-ink-4:        #5c6678;   /* ~3.2:1 — SVG strokes, borders, rails. NEVER text. */
  --dcp-ink-muted:    #5c6578;   /* NEW — resting ink for "inactive by design" */
  --dcp-ink-disabled: #57606f;   /* NEW — disabled control ink (replaces opacity:.35) */
  --dcp-ink-ghost:    #6d7789;   /* NEW — command-line completion, at FULL opacity */

  /* ── HAIRLINES. Cool-tinted so they actually draw on slate. ── */
  --dcp-line:          rgba(190, 205, 230, 0.10);   /* was rgba(255,255,255,0.08) */
  --dcp-line-2:        rgba(190, 205, 230, 0.18);   /* was rgba(255,255,255,0.15) */
  --dcp-line-3:        rgba(190, 205, 230, 0.30);   /* NEW — the editorial rule */
  --dcp-line-inactive: rgba(190, 205, 230, 0.06);   /* NEW */
  --dcp-border:        rgba(190, 205, 230, 0.18);   /* NEW — BUGFIX, see §6.6 */

  /* ── PRIMARY ACCENT = PALE STEEL ICE.
     Every interactive and selection job: focus rings, hover rings, selected
     segment indicators, active list rows, primary buttons, links, chevrons.
     ~8.8:1 on surface, so it is legible AS TEXT.
     WAS: #f5a623 (a fully saturated traffic-cone amber doing every emphasis
     job in the app) with --dcp-accent-tint: #3a2c12, a brown-black stain
     that was the app's "selected" state in five places. ── */
  --dcp-accent:        #8fb4e8;
  --dcp-accent-strong: #b0cbf5;
  --dcp-accent-deep:   #4d76b4;                        /* NEW */
  --dcp-accent-tint:   rgba(143, 180, 232, 0.14);      /* was #3a2c12 */
  --dcp-accent-tint-2: rgba(143, 180, 232, 0.24);      /* NEW */
  --dcp-accent-ring:   rgba(143, 180, 232, 0.42);      /* NEW — the focus ring */
  --dcp-on-accent:     #0a1220;                        /* was #160e00 */

  /* ── GOLD = CHAMPAGNE / BRASS. ONE RESERVED MEANING: THIS IS LIVE.
     Permitted call sites, and no others (§9.3): the brand spine, the adopt
     control's sliding indicator, the toggle ON track, the version generation
     pill, the `logical` (Running) zone rail, the toast's left rail, the
     "waiting" chip dot. Gold is NEVER a large fill — only a 1px ring, a 4px
     rail, a text ink, a ≤24px pill, or a ≤1.75px SVG stroke.
     MOVED here from :root — it must invert for light. ── */
  --dcp-gold:        #e8c98a;                       /* was #f5a623 */
  --dcp-gold-strong: #f5dcab;                       /* was #ffb838 */
  --dcp-gold-deep:   #b08d45;                       /* NEW */
  --dcp-gold-ink:    #f0d7a2;                       /* was #ffcf7a */
  --dcp-gold-dim:    rgba(232, 201, 138, 0.16);     /* was #3a2c12 (opaque brown) */
  --dcp-gold-tint:   rgba(232, 201, 138, 0.13);     /* NEW */
  --dcp-gold-tint-2: rgba(232, 201, 138, 0.24);     /* NEW */
  --dcp-gold-ring:   rgba(232, 201, 138, 0.40);     /* NEW */
  --dcp-on-gold:     #17110a;                       /* NEW */
  --dcp-ice:         #cfe0fb;                       /* was #bcd4ff — MOVED here */

  /* ── ELEVATION. A black shadow on a black page is invisible. A plate floats
     by a 1px TOP INNER HIGHLIGHT plus a large-radius low-alpha ambient.
     WAS: --dcp-shadow-1: 0 1px 2px rgba(0,0,0,0.5) — a complete no-op. ── */
  --dcp-shadow-1: inset 0 1px 0 rgba(255,255,255,0.045),
                  0 1px 2px rgba(0,0,0,0.55),
                  0 10px 22px -14px rgba(0,0,0,0.80);
  --dcp-shadow-2: inset 0 1px 0 rgba(255,255,255,0.065),
                  0 2px 6px rgba(0,0,0,0.50),
                  0 24px 52px -20px rgba(0,0,0,0.88);
  --dcp-shadow-inset: inset 0 1px 2px rgba(0,0,0,0.60),
                      inset 0 0 0 1px rgba(0,0,0,0.28);      /* NEW */
  --dcp-hover: rgba(190, 205, 230, 0.055);
  --dcp-press: rgba(0, 0, 0, 0.22);                          /* NEW */

  --dcp-active-elsewhere:      #8794a8;
  --dcp-active-elsewhere-soft: rgba(190, 205, 230, 0.055);

  /* ── PROVENANCE ZONES. `logical` is the LIVE zone, so it carries the gold.
     `default` is graphite — it is the base, it should recede. No zone tint is
     ever washed across a card body again (§6.9); the tint is confined to the
     rail and the header. ── */
  --dcp-z-logical-rail: #d4ab63; --dcp-z-logical-tint: rgba(212,171,99,0.11); --dcp-z-logical-head: rgba(212,171,99,0.17); --dcp-z-logical-ink: #f0d7a2;
  --dcp-z-default-rail: #7e8da6; --dcp-z-default-tint: rgba(126,141,166,0.10); --dcp-z-default-head: rgba(126,141,166,0.16); --dcp-z-default-ink: #b6c2d6;
  --dcp-z-current-rail: #8a79d2; --dcp-z-current-tint: rgba(138,121,210,0.13); --dcp-z-current-head: rgba(138,121,210,0.20); --dcp-z-current-ink: #c3b6f2;
  --dcp-z-host-rail:    #cf8a70; --dcp-z-host-tint:    rgba(207,138,112,0.12); --dcp-z-host-head:    rgba(207,138,112,0.19); --dcp-z-host-ink:    #f0b39c;
  --dcp-z-package-rail: #6e97cf; --dcp-z-package-tint: rgba(110,151,207,0.12); --dcp-z-package-head: rgba(110,151,207,0.19); --dcp-z-package-ink: #a9c8ef;

  /* ── KIND INKS — ONE family: equal lightness, evenly spaced hue, all ≥8:1.
     They are MARK ink only. `.name.bee/.worker/.drone/.dependency` are DELETED
     (§6.13), so these no longer have to be legible as 14.5px text — only
     distinguishable as 18px glyphs. worker moved OFF salmon (it read as an
     error); drone moved OFF khaki (it was 15° from bee and read identical).
     WAS: #e6b968 / #e08a86 / #cfc86a / #66c8b0 / #b79ae6. ── */
  --dcp-k-layer:      #93b0d6;   /* NEW  — steel  (215°) */
  --dcp-k-bee:        #e3c07a;   /* brass/comb (40°) */
  --dcp-k-worker:     #d59bc4;   /* orchid (320°) */
  --dcp-k-drone:      #a8c98a;   /* sage (95°) */
  --dcp-k-dependency: #6fc9c0;   /* aqua (175°) */
  --dcp-k-queen:      #b3a4ea;   /* violet (255°) */
  --dcp-k-domain:     #bcd4ff;   /* NEW  — the brand crystal at glyph scale */

  /* ── SEMANTICS. RED MEANS FAILURE AND NOTHING ELSE, ANYWHERE. ── */
  --dcp-danger:      #ec7365;                        /* was #e2564b */
  --dcp-danger-ink:  #ffa79c;                        /* NEW */
  --dcp-danger-tint: rgba(236,115,101,0.14);         /* NEW */
  --dcp-ok:          #5fc98f;                        /* NEW */
  --dcp-ok-tint:     rgba(95,201,143,0.14);          /* NEW */
  --dcp-warn:        #e0b45f;                        /* NEW */
  --dcp-warn-tint:   rgba(224,180,95,0.14);          /* NEW */

  /* ── DOMAIN IDENTITY — 8 curated stops. Replaces hsl(hash, 45%, 55%),
     the one place the design handed colour selection to a hash function and
     got arbitrary pinks and limes back. Used ONLY by the 2px `.tint` rail
     (§6.13). NOT used by the signature fingerprint — that is monochrome. ── */
  --dcp-dh-0:#8fb4e8; --dcp-dh-1:#6fc9c0; --dcp-dh-2:#e3c07a; --dcp-dh-3:#b3a4ea;
  --dcp-dh-4:#a8c98a; --dcp-dh-5:#d59bc4; --dcp-dh-6:#7fc5da; --dcp-dh-7:#d9a67e;

  /* ── CODE — ONE syntax map for highlight.js AND CodeMirror, so viewing a
     file and editing the same file are literally the same surface. ── */
  --dcp-code-bg:      #0d1016;
  --dcp-code-gutter:  #6b7488;
  --dcp-code-sel:     rgba(143,180,232,0.20);
  --dcp-code-line:    rgba(190,205,230,0.045);
  --dcp-code-plain:   #d3dce8;
  --dcp-code-kw:      #b3a4ea;
  --dcp-code-str:     #a8c98a;
  --dcp-code-num:     #e3c07a;
  --dcp-code-fn:      #8fb4e8;
  --dcp-code-type:    #6fc9c0;
  --dcp-code-comment: #6b7488;
  --dcp-code-punc:    #a8b2c4;
  --dcp-code-del:     #ec7365;

  /* ── PAGE WASH (§4.1) — a single static radial, no tiling, no pattern. ── */
  --dcp-wash: radial-gradient(120% 78% at 50% -12%,
                rgba(143, 180, 232, 0.055) 0%,
                rgba(143, 180, 232, 0.018) 38%,
                rgba(0, 0, 0, 0) 72%);
}
```

## 1.3 `@mixin dcp-light` — the complete light palette (OPT-IN)

Light is the **same two identities at a second lightness**. Today light's accent is navy while dark's is gold, so every `.on` state, focus ring and primary button changes hue on flip — two products sharing a DOM. That ends here.

```scss
@mixin dcp-light {
  --dcp-sunken:           #e6eaf1;
  --dcp-bg:               #f4f6f9;   /* was #fdfdfd */
  --dcp-surface:          #ffffff;
  --dcp-surface-2:        #eef1f6;   /* was #f4f5f6 */
  --dcp-raise:            #e3e8f0;   /* was #eceef0 */
  --dcp-surface-inactive: #f0f2f5;

  --dcp-glass:        rgba(255, 255, 255, 0.78);
  --dcp-glass-strong: rgba(255, 255, 255, 0.93);
  --dcp-glass-blur:   blur(18px) saturate(1.05);
  --dcp-glass-hi:     rgba(255, 255, 255, 0.92);

  --dcp-ink:          #12161d;   /* ~17.8:1 on white */
  --dcp-ink-2:        #4a5468;   /* ~7.6:1 */
  --dcp-ink-3:        #6b7688;   /* ~4.6:1 — the floor */
  --dcp-ink-4:        #98a2b3;   /* ~2.9:1 — NON-TEXT ONLY */
  --dcp-ink-muted:    #98a2b3;
  --dcp-ink-disabled: #a4adba;
  --dcp-ink-ghost:    #8b95a6;

  --dcp-line:          rgba(20, 30, 50, 0.10);
  --dcp-line-2:        rgba(20, 30, 50, 0.16);
  --dcp-line-3:        rgba(20, 30, 50, 0.28);
  --dcp-line-inactive: rgba(20, 30, 50, 0.06);
  --dcp-border:        rgba(20, 30, 50, 0.16);

  --dcp-accent:        #2f5c96;   /* ~6.8:1 — the SAME steel identity, darker */
  --dcp-accent-strong: #24487a;
  --dcp-accent-deep:   #1b3861;
  --dcp-accent-tint:   rgba(47, 92, 150, 0.10);
  --dcp-accent-tint-2: rgba(47, 92, 150, 0.18);
  --dcp-accent-ring:   rgba(47, 92, 150, 0.35);
  --dcp-on-accent:     #ffffff;

  --dcp-gold:        #8a6218;   /* ~5.5:1 as ink on white */
  --dcp-gold-strong: #6d4c10;
  --dcp-gold-deep:   #573c0c;
  --dcp-gold-ink:    #6d4c10;
  --dcp-gold-dim:    rgba(138, 98, 24, 0.14);
  --dcp-gold-tint:   rgba(138, 98, 24, 0.10);
  --dcp-gold-tint-2: rgba(138, 98, 24, 0.20);
  --dcp-gold-ring:   rgba(138, 98, 24, 0.34);
  --dcp-on-gold:     #ffffff;
  --dcp-ice:         #3f6ea8;

  --dcp-shadow-1: inset 0 1px 0 rgba(255,255,255,0.92),
                  0 1px 2px rgba(18,28,48,0.07),
                  0 6px 16px -10px rgba(18,28,48,0.28);
  --dcp-shadow-2: inset 0 1px 0 rgba(255,255,255,0.92),
                  0 2px 6px rgba(18,28,48,0.08),
                  0 22px 46px -18px rgba(18,28,48,0.32);
  --dcp-shadow-inset: inset 0 1px 2px rgba(18,28,48,0.10),
                      inset 0 0 0 1px rgba(18,28,48,0.05);
  --dcp-hover: rgba(20, 30, 50, 0.045);
  --dcp-press: rgba(20, 30, 50, 0.08);

  --dcp-active-elsewhere:      #78839a;
  --dcp-active-elsewhere-soft: rgba(20, 30, 50, 0.045);

  /* Zone tints stay rgba on light too (they were opaque hex), so the rail
     textures in §4.4 composite identically in both themes. */
  --dcp-z-logical-rail: #a9791f; --dcp-z-logical-tint: rgba(169,121,31,0.09); --dcp-z-logical-head: rgba(169,121,31,0.15); --dcp-z-logical-ink: #6f4f10;
  --dcp-z-default-rail: #6b7a94; --dcp-z-default-tint: rgba(107,122,148,0.09); --dcp-z-default-head: rgba(107,122,148,0.15); --dcp-z-default-ink: #414c60;
  --dcp-z-current-rail: #6b57bd; --dcp-z-current-tint: rgba(107,87,189,0.09);  --dcp-z-current-head: rgba(107,87,189,0.15);  --dcp-z-current-ink: #493588;
  --dcp-z-host-rail:    #b8623f; --dcp-z-host-tint:    rgba(184,98,63,0.09);   --dcp-z-host-head:    rgba(184,98,63,0.15);   --dcp-z-host-ink:    #8a3f22;
  --dcp-z-package-rail: #3a6bab; --dcp-z-package-tint: rgba(58,107,171,0.09);  --dcp-z-package-head: rgba(58,107,171,0.15);  --dcp-z-package-ink: #26497e;

  --dcp-k-layer:      #3a5f8c;
  --dcp-k-bee:        #8a6218;
  --dcp-k-worker:     #9c4a78;
  --dcp-k-drone:      #4f7333;
  --dcp-k-dependency: #1e7a70;
  --dcp-k-queen:      #5b46a8;
  --dcp-k-domain:     #2c5580;

  --dcp-danger:      #b83a2c;
  --dcp-danger-ink:  #96291d;
  --dcp-danger-tint: rgba(184, 58, 44, 0.10);
  --dcp-ok:          #1d7a4e;
  --dcp-ok-tint:     rgba(29, 122, 78, 0.10);
  --dcp-warn:        #8a6218;
  --dcp-warn-tint:   rgba(138, 98, 24, 0.10);

  --dcp-dh-0:#2f5c96; --dcp-dh-1:#1e7a70; --dcp-dh-2:#8a6218; --dcp-dh-3:#5b46a8;
  --dcp-dh-4:#4f7333; --dcp-dh-5:#9c4a78; --dcp-dh-6:#26657f; --dcp-dh-7:#9c5a2a;

  --dcp-code-bg:      #fbfcfe;
  --dcp-code-gutter:  #8b95a6;
  --dcp-code-sel:     rgba(47, 92, 150, 0.16);
  --dcp-code-line:    rgba(20, 30, 50, 0.035);
  --dcp-code-plain:   #1b232e;
  --dcp-code-kw:      #5b46a8;
  --dcp-code-str:     #4f7333;
  --dcp-code-num:     #8a6218;
  --dcp-code-fn:      #2f5c96;
  --dcp-code-type:    #1e7a70;
  --dcp-code-comment: #7b8698;
  --dcp-code-punc:    #4a5468;
  --dcp-code-del:     #b83a2c;

  --dcp-wash: radial-gradient(120% 78% at 50% -12%,
                rgba(47, 92, 150, 0.055) 0%,
                rgba(47, 92, 150, 0.020) 38%,
                rgba(0, 0, 0, 0) 72%);
}
```

## 1.4 Shared `:root` — geometry, hit targets, spacing

```scss
:root {
  @include dcp-dark;
  color-scheme: dark;

  /* ═══ THE SINGLE HIGHEST-LEVERAGE LINE IN THIS SPEC ═══
     All four were literally `0px`. ~40 correct `border-radius:
     var(--dcp-radius-*)` call sites across every component have been
     rendering knife-edged rectangles. This one edit reshapes the app. */
  --dcp-radius-sm:   3px;   /* was 0px */
  --dcp-radius-md:   6px;   /* was 0px */
  --dcp-radius-lg:  10px;   /* was 0px */
  --dcp-radius-xl:  16px;   /* was 0px */
  --dcp-radius-pill: 999px; /* NEW */

  --dcp-hit:       28px;    /* NEW — minimum pointer target for an icon button */
  --dcp-hit-touch: 44px;    /* NEW */

  /* ═══ SPACING SCALE (graft from Cold Press). Rhythm is the literal
     content of "dry"; the app has none today. ═══ */
  --sp-1:  4px;
  --sp-2:  8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 24px;
  --sp-6: 32px;
  --sp-7: 48px;

  /* §2 type tokens go here */
  /* §3.1 motion tokens go here */
}
```

### 1.4.1 THE RADIUS TIERING LAW (normative — this is how the design does not become generic SaaS)

The current design is zero-radius as a deliberate statement. Swinging to 10–16 px everywhere reads as a 2020 dashboard, which is the exact opposite of a precision instrument. Therefore:

| Tier | Value | Permitted on |
|---|---|---|
| `--dcp-radius-sm` | 3px | **The default for all chrome**: buttons, inputs, chips-that-are-not-pills, icon buttons, action buttons, focus-ring targets, segment indicators, code blocks |
| `--dcp-radius-md` | 6px | Plates and popovers: the install bar plate, `.dcp-pop`, panels, the orientation panel, file panels |
| `--dcp-radius-lg` | 10px | **Only** the two full-screen takeovers and the domain card (`.domain-section`) |
| `--dcp-radius-xl` | 16px | **Only** the top corners of the mobile bottom-sheet. Nothing else. |
| `--dcp-radius-pill` | 999px | **Only** the toggle track, the `.dcp-chip` primitive, and the revision count badge |

**Tie-breaker: if a surface cannot say which tier it is, it is `sm`.**

**Rows stay square-cornered.** `.row` in tree-row gets **no** radius — it is a list line, not a card, and `.tint` at `position:absolute; left:0` would poke outside a rounded corner.

**Sweep these hardcoded values onto the ladder in the same pass:**
- `patch-list` `.patch-item` `3px` → `var(--dcp-radius-sm)`
- `home` `.revision-count` `8px` → `var(--dcp-radius-pill)`
- `layer-editor` `.back-btn`, `.commit-btn`, `.ai-input`, `.lock-input`, `.file-panel`, `.editor-host` `4px` → `var(--dcp-radius-md)`
- `layer-editor` `.file-modified` `2px` → `var(--dcp-radius-sm)`
- `code-editor` `.editor-host` `4px` → `var(--dcp-radius-md)`

**`overflow: hidden` collision check:** `.domain-section` and `.adopt-control` both clip children. With a real radius the zone rail's outer corners will now be clipped to the card's curve — that is correct and desired. Verify the rail's **inner** (right) edge stays square.

## 1.5 Code surface — replaces the `github-dark` import

Delete `@import 'highlight.js/styles/github-dark.css';`. Replace with:

```scss
/* highlight.js token structure, DCP colours. The app currently ships three
   colour systems — its own, GitHub Dark in the viewer, One Dark in the
   editor — so switching from viewing a file to editing it visibly changes
   the background AND the palette. One map now serves both. */
.hljs { background: var(--dcp-code-bg); color: var(--dcp-code-plain); }
.hljs-comment, .hljs-quote                                   { color: var(--dcp-code-comment); font-style: normal; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal,
.hljs-section, .hljs-doctag, .hljs-type                      { color: var(--dcp-code-kw); }
.hljs-string, .hljs-regexp, .hljs-addition                   { color: var(--dcp-code-str); }
.hljs-number, .hljs-symbol, .hljs-bullet                     { color: var(--dcp-code-num); }
.hljs-title, .hljs-name, .hljs-selector-id, .hljs-function   { color: var(--dcp-code-fn); }
.hljs-attr, .hljs-attribute, .hljs-variable, .hljs-template-variable,
.hljs-class .hljs-title, .hljs-built_in                      { color: var(--dcp-code-type); }
.hljs-punctuation, .hljs-operator, .hljs-meta                { color: var(--dcp-code-punc); }
.hljs-deletion                                               { color: var(--dcp-code-del); }
.hljs-emphasis { font-style: italic; }
.hljs-strong   { font-weight: 600; }
```

---

# 2. THE TYPE SCALE

## 2.0 Two facts that must be fixed before anything else

**(a) There are two competing `body { font-family }` declarations.** `src/styles.scss` sets `var(--dcp-ui)`; `src/app/app.scss` sets `var(--hc-font)`. Same element, two sheets — the app's base typeface is currently decided by **build order**. `--hc-font` resolves to Source Sans Pro **Light (300 only)**; when it wins, every 500/600/700 in the app is a browser-synthesized fake bold with smeared stems. **Delete the `body { font-family: var(--hc-font) }` rule from `app/app.scss`** (§6.3).

**(b) "Inter" is not installed.** It is not a Windows or macOS system font, so today everything already falls through to Segoe UI while the sheets ask for 650 and 800 — synthesized. Windows 11 (the target, build 26200) ships **Segoe UI Variable**, a genuine variable family with an optical-size axis. Commit to it explicitly and use all three optical cuts. Zero downloads, zero dependencies.

## 2.1 Type tokens (add to `:root` in `styles.scss`)

```scss
:root {
  /* families */
  --dcp-display: "Segoe UI Variable Display", "Segoe UI", system-ui,
                 -apple-system, "Helvetica Neue", Arial, sans-serif;
  --dcp-ui:      "Segoe UI Variable Text", "Segoe UI", system-ui,
                 -apple-system, "Helvetica Neue", Arial, sans-serif;
  --dcp-micro:   "Segoe UI Variable Small", "Segoe UI", system-ui,
                 -apple-system, Arial, sans-serif;
  --dcp-mono:    var(--hc-mono);

  /* ═══ THE SCALE — EIGHT steps replace the SEVENTEEN in use today
     (8, 8.5, 9, 10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 15, 16, 18, 24, 25).
     FLOOR: nothing structural below 11.5px. ═══ */
  --fs-micro:   10.5px;  /* UPPERCASE + tracking. TWO ROLES ONLY. */
  --fs-meta:    11.5px;  /* mono data: sigs, timestamps, crumbs, versions, chips */
  --fs-label:   12.5px;  /* control labels, buttons, legend, prop labels */
  --fs-body:    13.5px;  /* prose, descriptions, orientation lines */
  --fs-name:    14.5px;  /* THE ENTRY LINE — tree-row titles, domain URL */
  --fs-title:     17px;  /* panel headings, inspector name, section titles */
  --fs-lede:      20px;  /* orientation lead, empty-state headline */
  --fs-display:   30px;  /* the wordmark. exactly ONE element. */

  --lh-tight: 1.15;
  --lh-snug:  1.35;
  --lh-body:  1.55;
  --lh-loose: 1.70;

  --fw-regular:  400;
  --fw-medium:   500;
  --fw-semibold: 600;
  --fw-bold:     700;   /* HARD CEILING. 650 and 800 are BANNED everywhere. */

  --tr-display: -0.015em;
  --tr-title:   -0.008em;
  --tr-none:     0;
  --tr-caps:     0.09em;   /* the ONLY tracking above 0.02em in the app */
}
```

## 2.2 Surface → step table (normative)

| Surface / selector | Family | Size | Weight | Tracking | Case | Ink |
|---|---|---|---|---|---|---|
| `.word` (wordmark) | `--dcp-display` | `--fs-display` | 600 | `--tr-display` | Sentence | `--dcp-ink` |
| `.kicker` | `--dcp-ui` | `--fs-body` | 400 | 0 | Sentence | `--dcp-ink-2` |
| `.specbar` | `--dcp-micro` | `--fs-micro` | 600 | `--tr-caps` | **UPPER** | `--dcp-ink-2` |
| `.zone-name` | `--dcp-micro` | `--fs-micro` | 600 | `--tr-caps` | **UPPER** | `--zc-ink`, opacity 1 |
| `.zone-idx` | `--dcp-mono` | `--fs-meta` | 600 | 0 | — | `--dcp-ink-2` |
| `.domain-url` | `--dcp-ui` | `--fs-name` | 600 | `--tr-title` | Sentence | `--dcp-ink` |
| `.header-sig` | `--dcp-mono` | `--fs-meta` | 400 | 0 | — | `--dcp-ink-2`, opacity 1 |
| `.name` (tree-row) | `--dcp-ui` | `--fs-name` | 600 | **0** | Sentence | `--dcp-ink` (no kind colour) |
| `.crumb` | `--dcp-mono` | `--fs-meta` | 400 | 0 | — | `--dcp-ink-3`; last segment `--dcp-ink-2` |
| `.desc` | `--dcp-ui` | `--fs-label` | 400 | 0 | Sentence | `--dcp-ink-2` |
| `.sig` | `--dcp-mono` | `--fs-meta` | 400 | 0.02em | — | `--dcp-ink-2` |
| `.chip` (all variants) | `--dcp-ui` | `--fs-meta` | 600 | 0 | **Sentence** | `--dcp-ink-2` (dot carries colour) |
| `.btn`, `.dcp-btn` | `--dcp-ui` | `--fs-label` | 600 | 0.01em | Sentence | per variant |
| `.scope-seg`, `.adopt-seg` | `--dcp-ui` | `--fs-label` | 500 | 0 | Sentence | `--dcp-ink-2`; `.on` → `--dcp-ink` |
| `.adopt-state-note` | `--dcp-ui` | `--fs-meta` | 400 | 0 | Sentence | `--dcp-ink-3` |
| `.adopt-restore-point label` | `--dcp-ui` | `--fs-meta` | 500 | 0 | Sentence | `--dcp-ink-2` |
| `.adopt-error` | `--dcp-ui` | `--fs-meta` | 500 | 0 | Sentence | `--dcp-danger-ink` |
| `.version-name` | `--dcp-ui` | `--fs-body` | 500 | 0 | Sentence | `--dcp-ink` |
| `.version-generation` | `--dcp-mono` | `--fs-meta` | 700 | 0 | — | `--dcp-on-gold` on gold pill |
| `.version-time` | `--dcp-mono` | `--fs-meta` | 400 | 0 | — | `--dcp-ink-3` |
| `.version-overwrite` | `--dcp-ui` | `--fs-meta` | 500 | 0 | Sentence | `--dcp-ink-3` |
| `.orientation-lead` | `--dcp-ui` | `--fs-lede` | 500 | `--tr-title` | Sentence | `--dcp-ink` |
| `.orientation-line` | `--dcp-ui` | `--fs-body` | 400 | 0 | Sentence | `--dcp-ink-2` |
| `.orientation-legend li` | `--dcp-ui` | `--fs-label` | 400 | 0 | Sentence | `--dcp-ink-2` |
| `.orientation-dismiss` | `--dcp-ui` | `--fs-label` | 500 | 0 | Sentence | `--dcp-ink-2` |
| `.empty h2` | `--dcp-ui` | `--fs-lede` | 600 | `--tr-title` | Sentence | `--dcp-ink` |
| `.empty p` | `--dcp-ui` | `--fs-body` | 400 | 0 | Sentence | `--dcp-ink-3` |
| `.home-revisions-toggle` | `--dcp-ui` | `--fs-label` | 500 | 0 | Sentence | `--dcp-ink-2` |
| `.revision-state` | `--dcp-ui` | `--fs-label` | 500 | 0 | Sentence | per state (§3.3) |
| `.revision-count` | `--dcp-mono` | `--fs-meta` | 600 | 0 | — | `--dcp-ink-2` |
| `.home-clients-title` | `--dcp-ui` | `--fs-meta` | 500 | 0 | Sentence | `--dcp-ink-3` |
| `.home-client` name | `--dcp-ui` | `--fs-label` | 500 | 0 | Sentence | `--dcp-ink` |
| `.home-client-platform` | `--dcp-ui` | `--fs-meta` | 400 | 0 | Sentence | `--dcp-ink-3` |
| `.home-client-version` | `--dcp-mono` | `--fs-meta` | 600 | 0 | — | `--dcp-on-gold` on gold pill |
| `.allow` (tree-row) | `--dcp-ui` | `--fs-label` | 600 | 0 | Sentence | per state |
| `.prop-label` (inspector) | `--dcp-ui` | `--fs-label` | 400 | 0 | Sentence | `--dcp-ink-3` |
| `.props code` (values) | `--dcp-mono` | `--fs-label` | 400 | 0 | — | `--dcp-ink-2` |
| `.pill.*` (inspector) | `--dcp-ui` | `--fs-meta` | 500 | 0 | Sentence | `--dcp-ink-2` |
| `.hdr-name` (inspector) | `--dcp-ui` | `--fs-title` | 600 | `--tr-title` | Sentence | `--dcp-ink` |
| `.hdr-meta`, `.hdr-sig` | `--dcp-mono` | `--fs-meta` | 400 | 0 | — | `--dcp-ink-3` |
| `.panel-header h3`, `.panel-title` | `--dcp-ui` | `--fs-title` | 600 | `--tr-title` | Sentence | `--dcp-ink` |
| `.badge` (relay) | `--dcp-ui` | `--fs-meta` | 600 | 0 | Sentence | `--dcp-ink-2` |
| `.revision-flag` | `--dcp-ui` | `--fs-meta` | 600 | 0 | Sentence | `--dcp-ink-2` |
| `.patch-sig`, `.patch-time`, `.revision-version` | `--dcp-mono` | `--fs-meta` | 400 | 0 | — | `--dcp-ink-2` / `--dcp-ink-3` |
| `.code`, `.pre` | `--dcp-mono` | `--fs-label` | 400 | 0 | — | `--dcp-code-plain` |
| `.command-shell input` | `--dcp-mono` | `--fs-body` | 400 | 0 | — | `--dcp-ink` |
| `.ghost` (command-line) | `--dcp-mono` | `--fs-body` | 400 | 0 | — | `--dcp-ink-ghost`, **opacity 1** |
| `.editor-*` message content | `--dcp-ui` | `--fs-body` | 400 | 0 | Sentence | `--dcp-ink-2` |

## 2.3 THE UPPERCASE BUDGET — from ~30 elements to exactly TWO

`text-transform: uppercase` survives **only** where a label functions as *texture* — you recognise the shape, you do not read the string:

1. **`.specbar`** — the trust strip across the top of the page.
2. **`.zone-name`** — the word running up the provenance spine.

**Nothing else in the application is uppercase.** Not chips, not badges, not buttons, not segment labels, not the revision flag, not prop labels, not the code-viewer label (which is deleted entirely). Both survivors use `--dcp-micro` (Segoe UI Variable Small, drawn with a larger x-height specifically for tiny sizes) at `--fs-micro` / 600 / `--tr-caps` / full opacity.

**Every one of the following LOSES `text-transform` and drops to sentence case at the size in §2.2:** `.word`, `.kicker`, `.btn`, `.install-cancel`, `.scope-seg`, `.adopt-seg`, `.adopt-confirm`, `.adopt-cancel`, `.adopt-restore-point label`, `.home-revisions-toggle`, `.home-clients-title`, `.home-client-platform`, `.orientation-dismiss`, `.version-overwrite`, all six `.chip` variants in tree-row, `.allow`, `.revision-flag`, `.prop-label`, `.panel-title`, `.badge`, `.file-modified`, `.patch-list .toggle`, `.revision-list .toggle`, `.code-viewer .label` (deleted), `.hdr-kind`, `.hdr-copy`, `.hdr-edit`, `.message-role`, `.zone`-adjacent labels not listed above.

**ITALICS: the app has two, and both are deleted.** `.group-note`'s `font-style: italic` and `.row.pending`'s `font-style: italic`. Status is never italic; status is a chip.

## 2.4 `body` and tabular figures

```scss
body {
  background-color: var(--dcp-bg);
  background-image: var(--dcp-wash);
  background-repeat: no-repeat;
  background-attachment: fixed;
  color: var(--dcp-ink);
  font-family: var(--dcp-ui);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  font-weight: var(--fw-regular);
  margin: 0;
  height: 100%;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  /* Fail loudly rather than smear a fake bold. This is the whole point of
     the typeface commitment. */
  font-synthesis-weight: none;
  /* REMOVED: font-feature-settings: "tnum" 1 — it forced tabular figures
     onto ALL proportional prose. Tabular is a DATA property: */
}

/* Tabular figures + slashed zero — these surfaces are hashes and columns. */
.sig, .header-sig, .hdr-sig, .hdr-meta, .crumb, .zone-idx,
.version-time, .version-generation, .revision-count, .revision-version,
.home-client-version, .chip.audit, .patch-sig, .patch-time,
.install-confirm-scope, .props code, code, pre, .code, .pre {
  font-family: var(--dcp-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1, "zero" 1;
  letter-spacing: 0;
}
```

---

# 3. THE MOTION SYSTEM — "SEAT"

Things **seat**, **latch** and **settle**. Everything is user-triggered, one-shot, and over in under 500 ms. Two indeterminate indicators are permitted to loop (the resolve caret and the brand spine) — both are `linear`, both are compositor-only `transform`, and both stop the instant the operation does.

**The net motion budget is NEGATIVE in ambient motion and strongly POSITIVE in event motion.** If a reviewer can see motion on a screen where nothing is loading and they are not doing anything, that is a bug.

## 3.0 What is DELETED

| Deleted | Where | Replaced by |
|---|---|---|
| `@keyframes row-pending-pulse` + `.row.pending`'s infinite 1.6 s opacity breath **and its `font-style: italic`** | `tree-row.component.ts` | A static `--dcp-surface-inactive` / `--dcp-ink-muted` rest state, plus `dcp-seat` on the row when `pending` **clears** — animate the arrival, not the wait |
| `@keyframes pulse` (the 6 px dot blinking 0.3↔1 forever) | `bee-inspector.component.ts` | The shared `.dcp-resolving` idiom (§4.7) |
| `resolve-sweep`'s `ease-in-out` on an infinite loop, animating `left` | `home.component.scss` | `dcp-travel` on `transform`, `linear` (§4.7) |
| `@keyframes panelIn`, declared byte-identically twice | `relay-panel.component.ts:153`, `auditor-settings.component.ts:134` | The global `dcp-pop-in` / `.dcp-pop` primitive |
| `@keyframes section-just-adopted` (2.2 s box-shadow decay in a brown-black tint) | `home.component.scss` | The `.just-adopted` composite gesture (§3.3 row 8) |
| `@keyframes install-toast-in` | `home.component.scss` | `dcp-seat` + a real exit + `dcp-drain` |
| Every `transition: … 0.12s ease` (~30 declarations) | home, tree-row | `var(--dcp-t-state) var(--dcp-e-state)` |

## 3.1 Motion tokens (add to `:root` in `styles.scss`)

```scss
:root {
  /* ── EASINGS ── */
  --dcp-e-seat:  cubic-bezier(0.16, 0.84, 0.24, 1);    /* arrivals: fast out, long calm tail, NO overshoot */
  --dcp-e-latch: cubic-bezier(0.34, 1.32, 0.48, 1);    /* mechanisms: ONE crisp overshoot — switches, indicators */
  --dcp-e-state: cubic-bezier(0.40, 0.00, 0.20, 1);    /* reversible: hover, on/off, focus, chevrons */
  --dcp-e-exit:  cubic-bezier(0.50, 0.00, 0.90, 0.35); /* leaving: accelerate away, never linger */
  --dcp-e-track: linear;                               /* travel only: progress, drains */

  /* ── DURATIONS. 0.12s (today's universal value) is BELOW the threshold at
     which a human reads a transition as movement — it is a smeared cut,
     which is worse than either a clean cut or a real gesture. ── */
  --dcp-t-tap:     90ms;   /* :active depress ONLY */
  --dcp-t-state:  180ms;   /* hover, on/off, focus, chevrons */
  --dcp-t-latch:  240ms;   /* switch thumb, segmented indicator */
  --dcp-t-arrive: 320ms;   /* one element entering or leaving the page */
  --dcp-t-settle: 480ms;   /* a whole card arriving; the adopt payoff */
  --dcp-t-sweep:  900ms;   /* HARD CAP on any cascade TOTAL, any tree size */
  --dcp-t-caret: 1100ms;   /* indeterminate progress cycle */

  --dcp-stagger:   26ms;   /* per-item offset in ANY staggered set */
}
```

### 3.1.1 THE UNIVERSAL STAGGER LAW (normative)

Every stagger in this application is written as:

```scss
animation-delay:  calc(min(var(--i, 0), 8) * var(--dcp-stagger));
/* or, for transition-driven staggers: */
transition-delay: calc(min(var(--i, 0), 8) * var(--dcp-stagger));
```

- The cap is **8 items**; items 9..n all release together.
- **No cascade total may exceed `--dcp-t-sweep` (900 ms)** regardless of subtree size.
- The group accordion is capped harder, at **260 ms** — with hundreds of rows a long collapse is nausea, not elegance.
- `--i` is set from the template (`[style.--i]="$index"`). Where no index is available, omit the stagger; do not invent one.

## 3.2 THE COMPLETE KEYFRAME LIBRARY (literal — goes in `styles.scss`)

```scss
/* ── ARRIVAL / DEPARTURE — one gesture, used by sections, chips, clients,
   the toast, and the pending-clear on a row. ── */
@keyframes dcp-seat      { from { opacity: 0; transform: translateY(6px) scale(0.994); }
                           to   { opacity: 1; transform: none; } }
@keyframes dcp-seat-out  { from { opacity: 1; transform: none; }
                           to   { opacity: 0; transform: translateY(-6px) scale(0.994); } }

/* ── POPOVERS — grows out of its toggle. transform-origin per call site. ── */
@keyframes dcp-pop-in    { from { opacity: 0; transform: translateY(-6px) scale(0.98); }
                           to   { opacity: 1; transform: none; } }
@keyframes dcp-pop-out   { from { opacity: 1; transform: none; }
                           to   { opacity: 0; transform: translateY(-4px) scale(0.985); } }

/* ── FULL-SCREEN TAKEOVER — ONE "go deeper" gesture for both drawers. ── */
@keyframes dcp-takeover-in  { from { opacity: 0; transform: scale(0.985) translateY(10px); }
                              to   { opacity: 1; transform: none; } }
@keyframes dcp-takeover-out { from { opacity: 1; transform: none; }
                              to   { opacity: 0; transform: scale(0.985) translateY(10px); } }

/* ── MOBILE SHEET — replaces `animation: none` on the two full-screen panels ── */
@keyframes dcp-sheet-up  { from { transform: translateY(100%); }
                           to   { transform: none; } }

/* ── THE LATCH — ONE clean ring, once, when a control lands in its committed
   state. Replaces every glow in the app. --dcp-latch-ink is set by the call
   site: steel for selection, gold for "now live". The ring ENDS transparent
   with no blur radius — no colour bleed. ── */
@keyframes dcp-latch-ring{ 0%   { box-shadow: 0 0 0 0  var(--dcp-latch-ink, var(--dcp-accent-ring)); }
                           72%  { box-shadow: 0 0 0 5px rgba(0,0,0,0); }
                           100% { box-shadow: 0 0 0 0  rgba(0,0,0,0); } }

/* ── THE RAIL FILLING LIKE A SPIRIT LEVEL — a section's arrival ── */
@keyframes dcp-rail-fill { from { transform: scaleY(0); }
                           to   { transform: scaleY(1); } }

/* ── AN EDITORIAL RULE DRAWING ACROSS ── */
@keyframes dcp-rule-draw { from { transform: scaleX(0); }
                           to   { transform: scaleX(1); } }

/* ── HAIRLINE SCHEMATICS DRAWING THEMSELVES. Every path sets pathLength="1"
   so --dash is always 1 — no per-path length measurement, no JS. ── */
@keyframes dcp-draw      { from { stroke-dashoffset: 1; }
                           to   { stroke-dashoffset: 0; } }

/* ── INDETERMINATE PROGRESS THAT TRAVELS. transform, not `left` (which laid
   out every frame). LINEAR — ease-in-out on a loop makes it appear to stall
   at both ends, which reads as STUCK. ── */
@keyframes dcp-travel    { from { transform: translateX(-110%); }
                           to   { transform: translateX(360%); } }

/* ── A COUNTDOWN THE USER CAN SEE COMING — the toast's auto-dismiss edge ── */
@keyframes dcp-drain     { from { transform: scaleX(1); }
                           to   { transform: scaleX(0); } }

/* ── COMPLETION. One tick, then still. ── */
@keyframes dcp-tick      { 0%   { opacity: 0; transform: scale(0.72); }
                           55%  { opacity: 1; transform: scale(1.06); }
                           100% { opacity: 1; transform: scale(1); } }

/* ── THE BRAND MARK'S GOLD SIGNATURE AXIS running while the machine works.
   Applied to the spine path's dash, not to the mark. ── */
@keyframes dcp-spine-run { from { stroke-dashoffset: 1; }
                           to   { stroke-dashoffset: -1; } }

/* ── RESTORING is the reverse of saving — the gesture literally rewinds ── */
@keyframes dcp-rewind    { from { transform: rotate(0deg); }
                           to   { transform: rotate(-360deg); } }

/* ── ERROR is a FIRM STOP. NO SHAKE — a shake reads as panic, and this app's
   failures are safe failures ("Stopped — nothing changed"). ── */
@keyframes dcp-hold      { 0%   { box-shadow: inset 0 0 0 0    var(--dcp-danger); }
                           16%  { box-shadow: inset 0 0 0 1.5px var(--dcp-danger); }
                           100% { box-shadow: inset 0 0 0 1.5px rgba(0,0,0,0); } }

/* ── THE EGG HATCHING — blocked → running (graft from Living Lattice) ── */
@keyframes dcp-hatch     { 0%   { transform: scale(0.90); opacity: 0.55; }
                           55%  { transform: scale(1.06); opacity: 1; }
                           100% { transform: none;        opacity: 1; } }
@keyframes dcp-shell-open{ from { stroke-dashoffset: 0; opacity: 0.75; }
                           to   { stroke-dashoffset: 14; opacity: 0; } }
```

## 3.3 STATE → HOOK → ANIMATION (the binding table)

Every hook below is a state the app **already computes** and currently renders as a hard cut. No new methods may be added to `home.component.ts`. Where a class binding is needed, write the expression **inline in the template** using existing accessors.

| # | State change | Exact Angular hook | What plays |
|---|---|---|---|
| 1 | Restore point saving | `revisionStatus() === 'saving'` (`home.component.ts:201`, template 82–88) | `.revision-state.is-saving`: colour → `--dcp-accent`, `dcp-seat` 320 ms on the text; the brand mark's gold spine runs `dcp-spine-run 1100ms linear infinite` (bound via `[class.is-working]` on `.mark`) |
| 2 | Restoring | `revisionStatus() === 'restoring'` | `.revision-state.is-restoring`: colour → `--dcp-accent`; a 12 px inline arc glyph beside the word runs `dcp-rewind 900ms linear infinite`; spine also runs |
| 3 | Saved | `revisionStatus() === 'saved'` (auto-clears after 4 s at `ts:1920/1971`) | `.revision-state.is-saved`: colour → `--dcp-ok`; a check glyph fires `dcp-tick 260ms var(--dcp-e-latch)`; the whole line then runs `dcp-seat-out 400ms var(--dcp-e-exit) 3.55s both` so it settles out inside the 4 s the code already grants it |
| 4 | Error | `revisionStatus() === 'error'` | `.revision-state.is-error`: colour → `--dcp-danger-ink`; `.home-revisions` runs `dcp-hold 520ms`; the mark's spine strokes `--dcp-danger` for 900 ms via `[class.is-error]`. **No shake.** |
| 5 | Toggle flips ON | `dcp-toggle` click handler adds `.just-landed`, removes it on `animationend` (§6.14) | `.thumb` `transform: translateX(16px)` over `--dcp-t-latch` / `--dcp-e-latch`; `.toggle.on.just-landed` runs `dcp-latch-ring 420ms var(--dcp-e-seat)` with `--dcp-latch-ink: var(--dcp-gold-ring)` |
| 6 | Subtree cascade | `onToggleAll` (Ctrl/Cmd+click, `tree-row.component.ts:33`) | Descendant toggles get `transition-delay: calc(min(var(--depth,0),8) * 20ms)`. `--depth` is set from the row's existing depth/indent value; **if the node model has no depth field, omit this — it is optional** |
| 7 | Scope / adopt segment changes | `filterScope()` and `packageState(section)` → `[style.--seg-i]` and `[style.--seg-n]` written inline in the template | One `.seg-ind` element travels: `transform: translateX(calc(var(--seg-i) * 100%))` over `--dcp-t-latch` / `--dcp-e-latch` |
| 8 | Section freshly adopted | `.just-adopted` added by `el.classList` at `home.component.ts:~1610` (**class name and 2200 ms timeout unchanged — CUT 3**) | Composite, **480 ms total then completely still**: `.domain-section.just-adopted { animation: dcp-seat var(--dcp-t-settle) var(--dcp-e-seat), dcp-latch-ring 420ms 300ms var(--dcp-e-seat) both; --dcp-latch-ink: var(--dcp-gold-ring); }` plus `.just-adopted .zone-rail::after { animation: dcp-rail-fill var(--dcp-t-settle) var(--dcp-e-seat) both; transform-origin: top; }` |
| 9 | Install gate opens | `pendingInstallScope()` (`ts:1711`, template 172–180) | `.domain-input.gated input` → held border (`--dcp-accent-ring` inset, `--dcp-sunken` ground) over `--dcp-t-state`; `.install-confirm-scope` slides out from behind the button via `clip-path: inset(0 100% 0 0) → inset(0)` over `--dcp-t-arrive` / `--dcp-e-seat`; `.btn.install-allow` runs `dcp-seat` with `animation-delay: 90ms` (arrives last); `.btn.install-cancel` delay 45 ms |
| 10 | Install gate cancelled | same signal going falsy, or `(keydown.escape)` | Reverse: `dcp-seat-out` with `--dcp-e-exit`, same path, so the gesture reads as undoable |
| 11 | Broker walk in flight | `section.loading` (template 325) | `.resolve-fill` runs `dcp-travel var(--dcp-t-caret) linear infinite` |
| 12 | Walk resolves | `section.loading` false | `.resolve-track` fades over `--dcp-t-arrive` with `--dcp-e-exit`; one `dcp-tick` on the completion glyph |
| 13 | Adopt form opens | `adoptingPackageSig() === section.rootSig` (`ts:204`, template 290–322) | `.adopt-control` fades its segments while `.adopt-restore-point` expands (`max-width` 0 → 320px + opacity) over `--dcp-t-arrive` / `--dcp-e-seat`; the prefilled minted name fires one `dcp-seat` so the user notices the app named it |
| 14 | Adopt error | `.adopt-error` present | `dcp-seat` 180 ms + an inline 12 px warning glyph. No shake |
| 15 | Upgrade banner arrives | `upgradeCount(section) > 0` | `.upgrade-banner { animation: dcp-seat var(--dcp-t-arrive) var(--dcp-e-seat) both; }` |
| 16 | Update accepted | `optInAllUpgrades(section)` (`ts:1420`) clears `node().freshlyUpgraded` on N rows | **Pure-CSS staggered drain, no TS:** `.row.freshly-upgraded { background-color: var(--dcp-z-host-tint); transition: background-color var(--dcp-t-arrive) var(--dcp-e-seat); transition-delay: calc(min(var(--i,0),8) * var(--dcp-stagger)); }` — when the class is removed the transition reverses and staggers by index automatically. The banner leaves with `dcp-seat-out` and **leads** it |
| 17 | Row content arrives | `node().pending` clears | `.row { animation: dcp-seat var(--dcp-t-arrive) var(--dcp-e-seat); }` applied via a `.resolved` class the row already gains, **only when `pending` goes false — never on mount** (§3.4) |
| 18 | Egg hatches | `node().hatchBlocker` clears (`onHatchEgg()`, `ts:2544`) | `.row.hatching .kmark svg { animation: dcp-hatch var(--dcp-t-settle) var(--dcp-e-latch) both; }`; the dashed shell runs `dcp-shell-open` over the same window; the toggle arrives with `dcp-seat` at `animation-delay: 160ms` instead of popping |
| 19 | Chip appears/disappears elsewhere | `activeElsewhere()` (driven by `activeSigSet()`, `ts:398`) | `.chip { animation: dcp-seat var(--dcp-t-state) var(--dcp-e-seat); }` — toggling one switch visibly marks the rows it affected |
| 20 | Group accordion | `isGroupOpen(group.domainName)` (template 233) | **See §3.6 — the `@if` stays.** The opening body runs `dcp-seat var(--dcp-t-arrive) var(--dcp-e-seat)`, capped at 260 ms. All four chevrons in the app unify on `transition: transform var(--dcp-t-state) var(--dcp-e-state)` |
| 21 | Row expand | `node().expanded` | Chevron rotates over `--dcp-t-state`; children run `dcp-seat` with the §3.1.1 stagger, `--i` from the `@for` index |
| 22 | Collapse all / expand all | `layersCollapsed()` (`ts:245`) | The wave is expressed only through the per-group `dcp-seat` stagger; **no additional whole-tree animation**. Total capped at `--dcp-t-sweep` |
| 23 | Toast appears | `installToastVisible()` (`ts:214`) | `dcp-seat var(--dcp-t-arrive) var(--dcp-e-seat)`; a 2 px hairline across the bottom runs `dcp-drain 8000ms linear forwards` (matching the 8 s timer at `ts:1624`) |
| 24 | Toast leaves | same signal false | `dcp-seat-out var(--dcp-t-arrive) var(--dcp-e-exit)` via Angular's `animate.leave` |
| 25 | Popover opens | `revisionsExpanded()`, relay `open()`, trust `open()`, command-line results | `.dcp-pop { animation: dcp-pop-in var(--dcp-t-state) var(--dcp-e-seat); }` with `transform-origin` at its toggle; children stagger `dcp-seat` per §3.1.1 |
| 26 | Popover closes | same signals | `.dcp-pop.is-leaving { animation: dcp-pop-out 150ms var(--dcp-e-exit) both; }` |
| 27 | Full-screen drawer opens | `visible()` on `bee-inspector`; the layer-editor's own visibility | `.dcp-takeover { animation: dcp-takeover-in var(--dcp-t-arrive) var(--dcp-e-seat); transform-origin: var(--from-x, 50%) var(--from-y, 40%); }` |
| 28 | Full-screen drawer closes | `onCloseInspector()` / `onLayerEditorClose()` | `dcp-takeover-out 180ms var(--dcp-e-exit)` via `animate.leave` |
| 29 | Hover-revealed controls | `.row:hover`, `.domain-header:hover`, `.package-row:hover` | **Transition-based, never `animation`** (§3.4). See the literal block below |
| 30 | Any button pressed | `:active` | `transform: translateY(1px)` over `--dcp-t-tap` — the global press (§7.1) |
| 31 | Copy confirmation | `copied()` (`relay-panel:392`), `sigCopied()` (`bee-inspector:31`) | A fixed-width slot cross-fades the label and swaps to a check glyph running `dcp-tick 260ms`. **The button must not resize.** 2 s timers unchanged |
| 32 | Relay status flips | `relay-panel` 10 s poll → `.toggle.connected` | The state **dot** fires `dcp-latch-ring 420ms` **once**, only when the status value actually changes. Never on poll, never on mount |
| 33 | Client arrives / forgotten | `clients()` (`ts:307`), `forgetClient()` (`ts:1268`) | Arrive: `dcp-seat`. Leave: `dcp-seat-out` + a width collapse so neighbours visibly close the gap |
| 34 | Orientation dismissed | `orientationDismissed()` (`ts:269`) | The panel **collapses**: `grid-template-rows: 1fr → 0fr` + opacity over `--dcp-t-arrive` / `--dcp-e-exit`. It must not vanish mid-glance |
| 35 | Domain hidden/shown | `isDomainVisible(group.domain)` (`ts:2190`) | `filter: saturate(0.15)` + opacity cross-fade over `--dcp-t-state`. **The barber-pole hatch is deleted** (§6.9) |
| 36 | AI is thinking | `layer-editor` working state | A 2 px indeterminate line along the AI bar's bottom edge running `dcp-travel var(--dcp-t-caret) linear infinite`. The word "Working…" is replaced by this |

### The literal hover-reveal block (graft: Cold Press's transition form replaces Caliper's `animation`)

`animation … both` replays on every hover-in and has no exit. Transitions reverse cleanly. Put this in the relevant component sheets:

```scss
.ract, .view-logical-toggle, .download-toggle, .backup-toggle {
  opacity: 0;
  transform: translateX(3px);
  transition: opacity   var(--dcp-t-state) var(--dcp-e-seat),
              transform var(--dcp-t-state) var(--dcp-e-seat),
              color     var(--dcp-t-state) var(--dcp-e-state);
}
.row:hover .ract,
.domain-header:hover .view-logical-toggle,
.domain-header:hover .download-toggle,
.package-row:hover .backup-toggle { opacity: 1; transform: none; }

.acts .ract:nth-child(2) { transition-delay: 30ms; }
.acts .ract:nth-child(3) { transition-delay: 60ms; }

/* BOTH existing escape hatches MUST survive, and every NEW hover-reveal
   needs one: home.component.scss:881 and tree-row.component.ts:181. */
@media (hover: none) {
  .ract, .view-logical-toggle, .download-toggle, .backup-toggle {
    opacity: 1; transform: none; transition-delay: 0s;
  }
}
```

## 3.4 THE MOUNT LAW (this is the durability rule — read it twice)

`tree-row.component.ts:~297` runs an `IntersectionObserver` that flips a `visible()` signal, swapping the whole `.row` for a `.row-placeholder`. **Every row and its `dcp-toggle` is destroyed and recreated as you scroll.** Therefore:

1. **No animation may be derived from mount.** Not `ngAfterViewInit`, not a rAF-gated `.ready` class, not `:first-child`, not `@starting-style` on a row. Anything mount-derived fires on every scroll-in and turns scrolling into a parade.
2. The toggle's landing ring is added by the **click handler** as `.just-landed` and removed on `animationend`. It is never derived from `enabled()`.
3. The virtualised `.row` must appear with **zero** animation. `dcp-seat` on a row fires only when `pending` clears (hook 17) or when the row is `.hatching` (hook 18) — both are genuine state resolutions, both are guarded by a class that is only present during the transition.
4. `dcp-seat` must never fire on the initial render of an existing tree, never on scroll into view, never on the observer boundary.

## 3.5 THE REDUCED-MOTION COLLAPSE (literal — `styles.scss`, ships in the first commit)

A repo-wide grep for `prefers-reduced-motion` currently returns **zero** hits across all 21 styled files, while two animations run forever. This is hard constraint #4 and it is currently 100 % unmet.

```scss
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    transition-delay: 0ms !important;
    scroll-behavior: auto !important;
  }

  /* Effects whose END state is not the resting state, or which must be
     ABSENT rather than instant (a 1ms travel is a flash). */
  .resolve-fill        { animation: none !important; transform: none !important;
                         width: 100% !important; opacity: 0.45; }
  .mark .spine-run,
  .mark.is-working .s  { animation: none !important; transform: none !important;
                         stroke-dashoffset: 0 !important; }
  .dcp-resolving::after { animation: none !important; }
  [class*="dcp-draw"],
  .schematic path,
  .empty-lattice path  { stroke-dashoffset: 0 !important; }

  /* Do NOT strip .toggle.on's resting box-shadow here — that would remove
     the ON state's definition. Only the RING animation is suppressed, and
     the blanket rule above already collapses it. */
}
```

## 3.6 THE ACCORDION RULING (a blind spot in all three directions) — **[RESOLVED]**

`home.component.html:233` gates the group body behind `@if (isGroupOpen(group.domainName))`, so the content is **not in the DOM** when closed. A `grid-template-rows: 0fr → 1fr` accordion requires converting that `@if` to a class binding, which keeps every closed group's `dcp-tree-row` instances **and their IntersectionObservers** mounted — at ~283 modules across several domains that is a real, unbudgeted cost.

**Ruling: keep the `@if`. Do not convert it.** Animate only the *entry* of the opening group: `.section-body { animation: dcp-seat var(--dcp-t-arrive) var(--dcp-e-seat); }`. Because `openGroup` is single-valued, the outgoing group vanishes instantly and the incoming one seats in — accept that asymmetry. Cap at 260 ms. Do not attempt the "outgoing leads by 60 ms" handoff; it requires the mount cost.

---

# 4. THE ILLUSTRATION INVENTORY

Language: **technical draughting.** Hairline strokes, round caps and joins, monochrome plus at most **one** accent stroke per plate, on a 24-unit or 48-unit grid. Everything is inline SVG in an existing template, or a CSS gradient. No assets, no fonts, no network, no dependencies.

**Every animated SVG path carries `pathLength="1"`,** so `stroke-dasharray: 1; stroke-dashoffset: 1;` works with no per-path length measurement and no JavaScript.

## 4.1 THE PAGE WASH (the ambient backdrop) — `styles.scss`

**What it is:** a single static radial gradient painted on `body`, giving the page a top-lit floor so plates have something to float on. It is *not* a pattern, *not* tiled, *not* animated, and cannot moiré.

**Where:** `body { background-image: var(--dcp-wash); background-attachment: fixed; background-repeat: no-repeat; }` (already in §2.4). The token is defined per theme in §1.2/§1.3.

**Geometry:** `radial-gradient(120% 78% at 50% -12%, …)` — origin above the viewport's top edge, three stops, strongest alpha 0.055, fully transparent by 72 %. Nothing in the reading column ever sits on a visible edge.

**Animation:** none, ever.

**Acceptance test:** screenshot the tree at 100 %. You should read the page as *lit from above*, and you should not be able to point at a boundary.

## 4.2 THE BRAND MARK — `home.component.html:19–24` + `.mark` rules

**What it is:** the app's identity and its state instrument. Today it is four inert strokes at 32 px that never acknowledge anything the machine does.

**Where:** replace the SVG inside `.brand` in `home.component.html`. **Keep the existing class names `.e`, `.f`, `.s`** so nothing breaks. Render at **40 px** (32 px was timid for the only illustration on the page).

**Markup (literal):**

```html
<svg class="mark" viewBox="0 0 48 48" fill="none" aria-hidden="true"
     [class.is-working]="revisionStatus() === 'saving' || revisionStatus() === 'restoring'"
     [class.is-error]="revisionStatus() === 'error'"
     [class.is-live]="!!pendingInstallScope() === false && revisionStatus() === 'saved'">
  <defs>
    <linearGradient id="dcpSpine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="var(--dcp-gold)" stop-opacity="0"/>
      <stop offset="45%"  stop-color="var(--dcp-gold)" stop-opacity="1"/>
      <stop offset="100%" stop-color="var(--dcp-gold)" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- FACETS: filled, no stroke. Depth without borders. -->
  <path class="fg" d="M24 3 L24 24 L15.5 24 Z"   fill="var(--dcp-accent)" opacity="0.10"/>
  <path class="fg" d="M24 3 L32.5 24 L24 24 Z"   fill="var(--dcp-accent)" opacity="0.05"/>
  <path class="fg" d="M15.5 24 L32.5 24 L24 45 Z" fill="var(--dcp-accent)" opacity="0.06"/>

  <!-- OUTLINE -->
  <path class="e" d="M24 3 L41 24 L24 45 L7 24 Z" stroke-width="1.25" pathLength="1"/>

  <!-- FACET LINES: girdle, crown, pavilion, table -->
  <path class="e f" d="M7 24 L41 24"                       stroke-width="0.9" pathLength="1"/>
  <path class="e f" d="M24 3 L15.5 24 M24 3 L32.5 24"      stroke-width="0.9" pathLength="1"/>
  <path class="e f" d="M15.5 24 L24 45 M32.5 24 L24 45"    stroke-width="0.9" pathLength="1"/>
  <path class="e f" d="M17.6 12.6 L30.4 12.6"              stroke-width="0.9" pathLength="1"/>

  <!-- THE SIGNATURE AXIS — the machine's state light -->
  <path class="s" d="M24 3 L24 45" stroke="url(#dcpSpine)" stroke-width="1.6" pathLength="1"/>
</svg>
```

**CSS:**

```scss
.mark { width: 40px; height: 40px; flex: none; }
.mark path { fill: none; stroke-linejoin: round; stroke-linecap: round; }
.mark .e  { stroke: var(--dcp-ice); }
.mark .f  { stroke: var(--dcp-ice); opacity: 0.62; }  /* was 0.55 and fainter still */
.mark .s  { opacity: 0.38; transition: opacity var(--dcp-t-arrive) var(--dcp-e-state),
                                       stroke  var(--dcp-t-state)  var(--dcp-e-state); }

/* boot: the outline draws once, the facets seat in behind it. Fires ONCE on
   app load. .mark is not virtualised, so this is safe. */
.mark .e         { stroke-dasharray: 1; animation: dcp-draw 620ms var(--dcp-e-seat) both; }
.mark .e.f       { animation-delay: 180ms; }
.mark .fg        { animation: dcp-seat var(--dcp-t-arrive) var(--dcp-e-seat) 300ms both; }

/* state binding — this is the whole identity idea */
.mark.is-working .s { opacity: 1;
                      stroke-dasharray: 0.34 0.66;
                      animation: dcp-spine-run var(--dcp-t-caret) linear infinite; }
.mark.is-error   .s { opacity: 1; stroke: var(--dcp-danger); }
.mark.is-live    .s { opacity: 1; }
```

**Animation:** the outline draws once on load; the spine runs only while the machine is working; the spine strokes danger on error. **There is no specular sweep (CUT 1).**

## 4.3 THE KIND GLYPHS, REDRAWN FOR 18 px — `diamond-icon.component.ts`

**What it is:** the product's alphabet. Three of the current five silhouettes are near-identical at 18 px and the worker packs an 8-spoke gear plus an inner circle into 18 px, which turns to mush. `.kmark` is also a real `<button>` emitting `clicked` with **no hover, focus or active state at all**.

**Rules:** at most **four features** per glyph. `stroke-width: 1.8`. Every glyph gains a **filled ground** behind the stroke at `color-mix(in srgb, currentColor 12%, transparent)` so it reads as a mark, not a hairline sketch. Aspect ratios are made deliberately unequal.

Replace the `@switch` bodies. Keep the selector, the `kind` input and the `clicked` output.

| Kind | Paths (viewBox `0 0 24 24`) |
|---|---|
| `layer` | Three bars, the last half-width so it reads as a **stack**: `rect 4,3.5,16,4.6 rx1` · `rect 4,10.2,16,4.6 rx1` · `rect 4,16.9,9,3.6 rx1` |
| `bee` | Flat-top hexagon (**widest** glyph, width 14.8) + one comb chord: `M12 3.2 L19.4 7.6 V16.4 L12 20.8 L4.6 16.4 V7.6 Z` · `M7.6 12 H16.4` |
| `worker` | **FOUR** spokes, larger hub: `circle cx=12 cy=12 r=3.6` · `M12 4.2 V7.4 M12 16.6 V19.8 M4.2 12 H7.4 M16.6 12 H19.8` |
| `drone` | A **narrow, tall** kite — width 10.8 against the bee's 14.8, so the two can never be confused: `M12 2.6 L17.4 12 L12 21.4 L6.6 12 Z` · `M6.6 12 H17.4` |
| `dependency` | Two overlapping rounded links, no interlace at this size: `rect 3,8.5,10,7 rx3.5` · `rect 11,8.5,10,7 rx3.5` (second drawn after) |
| `domain` | The brand crystal at glyph scale: `M12 2.5 L20 12 L12 21.5 L4 12 Z` · `M12 2.5 V21.5` at opacity 0.5 |
| `default` | `M12 2.8 L20.2 12 L12 21.2 L3.8 12 Z` · `M3.8 12 H20.2` |

**The missing affordance:**

```scss
.kmark {
  position: relative;
  border-radius: var(--dcp-radius-sm);
  transition: transform var(--dcp-t-state) var(--dcp-e-latch),
              background var(--dcp-t-state) var(--dcp-e-state),
              color var(--dcp-t-state) var(--dcp-e-state);
}
.kmark:hover { transform: scale(1.08); background: var(--dcp-hover); }
.kmark:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dcp-accent-ring); }
.kmark:active { transform: scale(0.98); transition-duration: var(--dcp-t-tap); }
```

## 4.4 THE EGG — `diamond-icon.component.ts` (graft from Living Lattice)

**What it is:** the app built a **hatching** metaphor in code and drew none of it. When `hatchBlocker` clears today, the row instantly grows a switch and two buttons that were not there a frame earlier — it reads as a layout glitch.

**Where:** an **overlay on whatever kind the node already is**, not a seventh kind. Rendered when `node().hatchBlocker` is set.

**Geometry:** `<ellipse cx="12" cy="12" rx="8.4" ry="10.2" stroke-dasharray="3 3.4" stroke-width="1.3" opacity="0.75"/>` drawn over the kind glyph; the inner kind glyph drops to `opacity: 0.55`. If `hatchBlocker === 'untrusted'`, add a crack: `M7.6 13.4 l3 -1.6 l2.6 2 l3 -1.6` stroked `--dcp-danger` at 1.2.

**Animation:** on hatch, `.row.hatching .kmark svg { animation: dcp-hatch var(--dcp-t-settle) var(--dcp-e-latch) both; }` while the shell runs `dcp-shell-open` over the same window; the toggle arrives with `dcp-seat` at 160 ms delay. See hook 18.

## 4.5 THE PROVENANCE RAIL — `home.component.scss` (`.zone-rail`)

**What it is:** the biggest unclaimed canvas in the app — 30 px × full section height, five semantic variants, colour already tokenised, and 100 % static, with its label set at 8.5 px / 0.24em / 0.72 opacity rotated, i.e. deliberately illegible.

**Geometry:** widen to **36 px**. Replace `border-left: 2px` with a layered background so the zone edge has a falloff. Add a `::after` overlay for the arrival fill.

```scss
.zone-rail {
  position: relative;
  width: 36px;
  flex: none;
  background-color: var(--zc-head);
  background-image:
    linear-gradient(90deg,
      var(--zc-rail) 0 4px,
      color-mix(in srgb, var(--zc-rail) 32%, transparent) 4px 6px,
      transparent 6px),
    var(--zc-tex, none);
}
/* the arrival fill — scaleY(0) at rest, runs dcp-rail-fill on .just-adopted */
.zone-rail::after {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  background: var(--zc-rail); transform-origin: top; transform: scaleY(1);
}
```

**The five textures — the PATTERN LAW: every texture is a 1 px feature at ≥ 6 px pitch, alpha 0.15–0.22 against the rail colour, confined to the 36 px column, never behind text, and `default` gets NO texture at all** (if all five zones have a pattern, none of them mean anything).

```scss
[data-zone="logical"]  { --zc-tex: repeating-linear-gradient(0deg,
    color-mix(in srgb, var(--zc-rail) 22%, transparent) 0 1px, transparent 1px 7px); }   /* a measured ruler */
[data-zone="default"]  { --zc-tex: none; }                                               /* the base recedes */
[data-zone="current"]  { --zc-tex: radial-gradient(
    color-mix(in srgb, var(--zc-rail) 20%, transparent) 0.8px, transparent 0.9px);
    background-size: auto, 6px 6px; }                                                     /* dot lattice */
[data-zone="host"]     { --zc-tex: repeating-linear-gradient(135deg,
    color-mix(in srgb, var(--zc-rail) 16%, transparent) 0 1px, transparent 1px 8px); }   /* fine engraving —
    the ONLY diagonal in the app, a 1px hairline at 8px pitch */
[data-zone="package"]  { --zc-tex: repeating-linear-gradient(0deg, transparent 0 11px,
    color-mix(in srgb, var(--zc-rail) 20%, transparent) 11px 12px); }                    /* stepped ticks */
```

`.zone-idx`: `--fs-meta`, mono, tabular, `--dcp-ink-2`, full opacity. `.zone-name`: per §2.2, `--fs-micro` / `--tr-caps` / **opacity 1** (was 0.72).

**Verification: check the rails at 100 %, 125 % and 150 % browser zoom.** If any one shimmers or moirés, drop that zone to a flat `--zc-head` and keep the other three. Four textured zones and one plain is fine; a moiré pattern is not.

## 4.6 THE SIGNATURE FINGERPRINT — `tree-row.component.ts` **[RESOLVED — judges disagreed]**

Judge 1 wanted Cold Press's monochrome 8-bar colophon; Judge 2 wanted Living Lattice's single-element gradient (1 node vs 8 per row). **Both are right about different axes.** The binding resolution takes Living Lattice's **one-element implementation** and Cold Press's **monochrome ink** — one node per row, no colour confetti one column over from the row titles we just de-coloured.

**What it is:** free illustration generated from data the row already holds. Signatures become mutually distinguishable at a glance without reading a hex digit.

**Where:** one `<i class="fp">` immediately left of the truncated `.sig`, in `tree-row.component.ts`. Reuse verbatim on `.header-sig` (`home.component.html`) and the inspector's `.hdr-sig`.

**Computed (in `tree-row.component.ts`):**

```ts
readonly fingerprint = computed(() => {
  const s = this.node().signature ?? ''
  if (s.length < 16) return ''
  const stop = (i: number) => {
    const n = parseInt(s.slice(i * 2, i * 2 + 2), 16) & 0xf   // 0..15
    return `color-mix(in srgb, var(--dcp-ink-2) ${20 + n * 5}%, transparent)`
  }
  return `linear-gradient(90deg,${[0,1,2,3,4,5,6,7]
    .map(i => `${stop(i)} ${i * 12.5}% ${(i + 1) * 12.5}%`).join(',')})`
})
```

**Markup:** `<i class="fp" aria-hidden="true" [style.background-image]="fingerprint()"></i>`

**Geometry / CSS:** `width: 22px; height: 9px; border-radius: 1px; flex: none;` — an eight-band monochrome barcode at alphas 20 %…95 %.

**Animation:** none. It is data made visible, not a gesture.

**The eight `--dcp-dh-*` stops are NOT used here.** They are used only by the 2 px `.tint` rail (§6.13).

## 4.7 THE RESOLVING IDIOM — one language app-wide

**What it is:** the app currently has **three** unrelated "loading" idioms — `resolve-sweep` (home), `row-pending-pulse` (tree-row), `pulse` (inspector) — with no shared token. Collapse to one, defined in `styles.scss`, and tie it to the identity.

**The bar** (`home` `.resolve-track` / `.resolve-fill`), used while a broker walk is in flight:

```scss
.resolve-track {
  position: relative; height: 2px; overflow: hidden;
  background: var(--dcp-line-2); border-radius: var(--dcp-radius-pill);
  /* full card width, flush under the header — DELETE .section-status's
     11px/14px padding box, which still pads as though it holds text. */
}
.resolve-fill {
  position: absolute; inset: 0 auto 0 0; width: 30%;
  will-change: transform;
  background: linear-gradient(90deg, transparent,
              var(--zc-rail, var(--dcp-accent)) 55%, transparent);
  animation: dcp-travel var(--dcp-t-caret) var(--dcp-e-track) infinite;
}
```

**The inline dot** (`.dcp-resolving`, used by the inspector and anywhere else that needs a small "working" mark) — a 10 px diamond echoing the brand mark whose gold spine runs:

```scss
.dcp-resolving {
  position: relative; display: inline-block; width: 12px; height: 12px;
  flex: none; vertical-align: -1px;
}
.dcp-resolving::before {
  content: ''; position: absolute; inset: 1px;
  border: 1px solid var(--dcp-ink-4);
  transform: rotate(45deg); border-radius: 1px;
}
.dcp-resolving::after {
  content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 1.5px;
  margin-left: -0.75px; background: var(--dcp-gold);
  animation: dcp-drain var(--dcp-t-caret) var(--dcp-e-track) infinite alternate;
  transform-origin: top;
}
```

Both stop the instant the operation stops. Both are suppressed under reduced motion.

## 4.8 THE ORIENTATION SCHEMATICS — `home.component.html:137–152`

**What it is:** the panel whose own source comment says *"A quiet bordered panel, no motion"*, holding three near-identical 12.5 px grey paragraphs. It is the only place a new person is told what the app IS, and it renders **once per participant**, so it can carry more visual investment per byte than anything else in the app.

**Where:** three numbered steps laid out horizontally inside `.orientation`, each with a **72 × 48** hairline schematic, `class="schematic"`, `stroke: var(--dcp-ink-3)`, `stroke-width: 1.25`, `fill: none`, `stroke-linecap: round`, every path `pathLength="1"`.

**Plate A — a domain arrives**
- hive: `rect x=44 y=10 w=24 h=28 rx=3`
- inbound: `M4 24 H30` with `stroke-dasharray="5 4"` (static dash, not animated)
- arrowhead: `M26 20 L30 24 L26 28`
- payload (the one accent stroke): 7 px diamond `M37 20 L41 24 L37 28 L33 24 Z`, `stroke: var(--dcp-accent)`, width 1.4

**Plate B — it is checked**
- shield: `M24 5 L40 10 v13 c0 8 -8 13 -16 17 c-8 -4 -16 -9 -16 -17 V10 Z`
- check (the accent, drawn **second**, `animation-delay: 300ms` — the verification lands *after* the shield exists, which is the whole point of the step): `M17 25 l5 5 l11 -13`, `stroke: var(--dcp-gold)`, width 1.8

**Plate C — you switch it on**
- track: `rect x=16 y=17 w=40 h=16 rx=8`
- thumb (accent, filled): `circle cx=25 cy=25 r=5.5 fill="var(--dcp-accent)" stroke="none"`
- ghost target: `circle cx=47 cy=25 r=5.5` with `stroke-dasharray="2 3"`
- travel: `M31 25 H41` + arrowhead `M38 22 L41 25 L38 28`

**Animation:**

```scss
.schematic path { stroke-dasharray: 1; stroke-dashoffset: 1;
                  animation: dcp-draw 520ms var(--dcp-e-seat) var(--d, 0ms) forwards; }
.orientation-step:nth-child(1) .schematic { --d: 0ms; }
.orientation-step:nth-child(2) .schematic { --d: 90ms; }
.orientation-step:nth-child(3) .schematic { --d: 180ms; }
```

Fires once on mount. `.orientation` is rendered once per participant and is not virtualised, so this is safe under §3.4.

## 4.9 THE LEGEND IS THE MARK — `home.component.html:144–147`

**What it is:** a correctness fix that *is* illustration. `.legend-swatch` renders four flat 9 × 9 px **squares** while the source comment claims they use the "same shape/gradients as dcp-diamond" — they never did. So the one artifact whose entire job is mark → meaning teaches a vocabulary the tree does not use.

**Change:** render the real `<dcp-diamond [kind]="'layer'">` / `'bee'` / `'worker'` / `'dependency'` at **16 px** inside the existing `<i class="legend-swatch">` wrapper. `HomeComponent` already imports `DiamondIconComponent`; the `clicked` output can be ignored. `.legend-swatch` becomes a 16 px flex sizing rule and nothing else.

## 4.10 THE EMPTY STATE — `home.component.scss` `.empty`

**What it is:** the very first screen a new user sees, currently one 13 px grey sentence centred in a void.

**Geometry:** a hex lattice that assembles once. `viewBox="0 0 220 150"`. Seven flat-top hexagons, circumradius **26**: one centre at (110, 75) and six at 60° intervals — offsets (±39, ±45), (±78, 0). Path for a hex centred (cx, cy):

```
M{cx-13} {cy-22.5} L{cx+13} {cy-22.5} L{cx+26} {cy}
L{cx+13} {cy+22.5} L{cx-13} {cy+22.5} L{cx-26} {cy} Z
```

Ring hexes: `stroke: var(--dcp-line-3)`, width 1.1. Centre hex: `stroke: var(--dcp-accent)`, width 1.4, `fill: rgba(143,180,232,0.06)`.

**Animation:** each path `pathLength="1"`, `dcp-draw 480ms`, stagger **70 ms**, **ring first and the CENTRE LAST** — the lattice assembles *around* the thing you are about to install. Then completely still. **No mascot. No bee settling into the centre.** Monochrome plus one accent.

**Beneath it:** an `--fs-lede` headline, an `--fs-body` `--dcp-ink-3` supporting line, and the sample domain as a real chip (§6.11) with an arrow that nudges 3 px right on hover — replacing `.sample-link`, currently a 12 px gold string with `margin: -10px 0 16px 2px` that bleeds out of the field above it.

## 4.11 THE SPECBAR CHECKS — `home.component.scss` `.specbar`

**What it is:** the app's first pixel row, and the one line whose whole job is to build confidence, currently rendered as 10 px uppercase letterspaced mono at `--dcp-ink-4` (~2.5:1) — illegible grey noise at the topmost position on screen.

**Change:** split the middot list into three `<span>`s, each preceded by a 10 × 10 inline check: `<polyline points="2,5.6 4.3,8.1 9,2.4" stroke="var(--dcp-ok)" stroke-width="1.6" stroke-linecap="round" fill="none" pathLength="1"/>`. Each runs `dcp-draw 300ms` once on load with a 120 ms stagger. Ink → `--dcp-ink-2`, size `--fs-micro`, family `--dcp-micro`, keep the caps (one of the two surviving roles). The counts on the right are mono tabular, not caps.

## 4.12 THE CLIENT PLATFORM GLYPHS — `home.component.html:118–131`

14 px, `stroke-width: 1.6`, `viewBox="0 0 24 24"`:

- **monitor / native:** `rect x=2 y=4 w=20 h=13 rx=1.5` · `M8 21 H16` · `M12 17 V21`
- **globe / web:** `circle cx=12 cy=12 r=9` · `M3 12 H21` · `M12 3 a15 15 0 0 1 0 18 a15 15 0 0 1 0 -18`
- **phone:** `rect x=7 y=2 w=10 h=20 rx=2` · `M10.5 18.5 H13.5`

## 4.13 THE RELAY DIAGRAM — `relay-panel.component.ts` `.install-block`

**What it is:** the user is asked to download and run a script on their machine on the strength of two sentences of 11 px grey text, with nothing showing what a relay *is*. Forty lines of SVG turns a paragraph into an explanation.

**Geometry:** `viewBox="0 0 200 64"`
- peer A: `circle cx=24 cy=32 r=7`, `stroke: var(--dcp-ink-3)`, width 1.4
- peer B: `circle cx=176 cy=32 r=7`, same
- relay: `rect x=82 y=22 w=36 h=20 rx=4`, `stroke: var(--dcp-accent)`, width 1.5, `fill: var(--dcp-accent-tint)`
- links: `M31 32 H82` and `M118 32 H169`, `stroke-dasharray="3 4"`, `stroke: var(--dcp-ink-4)`, width 1.2

**Animation:** on reveal both links draw **outward from the relay** (`dcp-draw`, 60 ms apart) — the picture states the claim.

## 4.14 THE TRUST SHIELD, THREE STATES — `auditor-settings.component.ts` `.toggle`

**What it is:** the app's security posture is currently completely invisible from the chrome — the shield button has no configured state at all.

Same shield path as orientation Plate B, at 16 px:
- **no sources:** outline only, `stroke: var(--dcp-ink-3)`
- **configured:** outline + `fill: color-mix(in srgb, currentColor 12%, transparent)`, `stroke: var(--dcp-accent)`
- **threshold met:** the above + the check path, `stroke: var(--dcp-ok)`, which draws once with `dcp-draw` when the threshold is first met

## 4.15 THE THRESHOLD PIPS — `auditor-settings.component.ts` `.threshold`

Keep the `<input type="number">` for accessibility but hide the OS spinner (`appearance: textfield; &::-webkit-outer-spin-button, &::-webkit-inner-spin-button { appearance: none; margin: 0; }` — the one place the app visibly borrows another design system). Beside it render **M pips**: 8 px squares rotated 45° (diamonds, echoing the mark), filled `var(--dcp-accent)` up to the threshold and stroked `var(--dcp-line-3)` beyond. "N of M" expressed as shapes.

## 4.16 THE EDITORIAL RULE — `.dcp-rule` (graft from Cold Press)

The fifth global primitive. One declaration of pure craft: a rule that starts heavy for 28 px and then thins is the single most "well-set document" mark available.

```scss
.dcp-rule {
  height: 1px; border: 0; margin: var(--sp-3) 0;
  background: linear-gradient(90deg, var(--dcp-line-3) 0 28px, var(--dcp-line) 28px);
  transform-origin: left;
}
.domain-section.just-adopted .dcp-rule { animation: dcp-rule-draw var(--dcp-t-settle) var(--dcp-e-seat) both; }
```

Use it under every panel heading and above the domain list.

---

# 5. THE HOME STYLESHEET SPLIT (do this SECOND, before writing any new CSS)

`home.component.scss` is **25,362 bytes** against `anyComponentStyle` **32 kB warn / 48 kB error, measured per compiled sheet** (`angular.json` lines 45–49). Headroom: 7,406 bytes. That is not enough for this job, and `@use` partials do **not** lower the number — the budget measures the emitted sheet.

**Array order IS cascade order. Split at contiguous line ranges and preserve the current rule sequence exactly.** The `@media (max-width: 600px)` block must remain **last**.

## 5.1 The literal `styleUrls` (the ONLY edit permitted in `home.component.ts`)

```ts
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [TreeViewComponent, AuditorSettingsComponent, RelayPanelComponent, BeeInspectorComponent, DiamondIconComponent, PatchListComponent, RevisionListComponent, DcpCommandLineComponent, LayerEditorComponent, DcpTranslatePipe],
  templateUrl: './home.component.html',
  styleUrls: [
    './home.shell.scss',
    './home.masthead.scss',
    './home.revisions.scss',
    './home.orientation.scss',
    './home.install.scss',
    './home.sections.scss',
    './home.package.scss',
    './home.empty.scss',
    './home.responsive.scss'
  ]
})
```

Nothing else in this 3,339-line file may be touched. `home.component.scss` is deleted after the split.

## 5.2 What goes in each sheet (source line ranges from the current file)

| Sheet | Source lines | Contents |
|---|---|---|
| `home.shell.scss` | 1–72 | `.tree-home` + the three `min-width` container queries; `.install-toast`, `.install-toast-body`, `.install-toast-close`. **`@keyframes install-toast-in` is DELETED** (replaced by `dcp-seat` + `dcp-seat-out` + the `dcp-drain` hairline) |
| `home.masthead.scss` | 73–180 | `.specbar`, `.mast`, `.brand`, `.mark` (+ `.e`/`.f`/`.s`/`.fg`), `.word`, `.kicker`, `.top-bar-right`, `.home-clients`, `.home-clients-title`, `.home-client`, `.home-client-platform`, `.home-client-version`, `.home-client-forget` |
| `home.revisions.scss` | 181–261 | `.home-revisions`, `.home-revisions-toggle`, `.revision-count`, `.revision-state` (+ the five state classes), `.home-revision-items`, `.home-revision-item` |
| `home.orientation.scss` | 262–337 | `.orientation`, `.orientation-line`, `.orientation-lead`, `.orientation-step`, `.schematic`, `.orientation-footer`, `.orientation-legend`, `.legend-swatch`, `.orientation-dismiss` |
| `home.install.scss` | 338–485 | `.domain-input` (+ input, placeholder, focus, `.gated`), `.install-confirm-scope`, `.btn`, `.btn.install-cancel`, `.btn.install-allow`, `.sample-link` → the new chip, `dcp-command-line`, `.scope-control`, `.scope-seg`, `.seg-ind`, `.tbtn` (+ `.on`, `.dim`), `.vsep` |
| `home.sections.scss` | 486–658 | `.domain-section` (+ `[data-zone]` mapping + `.just-adopted`), `.zone-rail`, `.zone-idx`, `.zone-name`, `.section-body`, `.domain-header` (+ `.domain-hidden`), `.visibility-toggle`, `.domain-url`, `.group-chevron`, `.group-note`, `.header-sig`, `.fp`, `.backup-toggle` |
| `home.package.scss` | 659–1018 | `.version-bar`, `.version-name`, `.version-name-edit`, `.version-overwrite`, `.version-time`, `.version-generation`, `.adopt-state-note`, `.adopt-control`, `.adopt-seg`, `.adopt-discard` (extracted), `.adopt-restore-point`, `.adopt-confirm`, `.adopt-cancel`, `.adopt-error`, `.domain-action`, `.action-icon`, `.view-logical-toggle`, `.download-toggle`, its `@media (hover: none)` block, `.remove`, `.section-status`, `.upgrade-banner`, `.upgrade-banner-text`, `.upgrade-optin-all`, `.resolve-track`, `.resolve-fill` |
| `home.empty.scss` | 1019–1026 | `.empty`, `.empty-lattice`, `.empty h2`, `.empty p`, `.sample-chip` |
| `home.responsive.scss` | 1027–end | The **entire** `@media (max-width: 600px)` block, minus the dead selectors below |

Each sheet lands around 3–5 kB with ~27 kB of room. **Operating rule (graft from Living Lattice): if any single sheet passes 24 kB, split it again — never compress.** Splitting is free; compression makes the CSS unmaintainable. `home.sections.scss` will run hottest (zone textures + section arrival + sticky header) — watch it.

## 5.3 Delete these dead selectors during the split (~1.1 kB, free)

No template in the app renders any of them. Verified: zero hits in templates and TS.

- `.status-line`
- `.resolve-count` (leftover from the removed count display — the template comment at `home.component.html:326` explicitly says "Progress bar ONLY — no count")
- `.versions-toggle`
- `.package-toggle` and `.package-toggle.off`
- `.toggle-indicator`
- `.title` (inside the 600 px media query)
- `.kind-toggle` (inside the 600 px media query)

Also delete `@keyframes install-toast-in`, `@keyframes section-just-adopted` and `@keyframes resolve-sweep` — all three are superseded by the global library.

---

# 6. PER-FILE INSTRUCTIONS

## 6.1 `src/styles.scss`
Land §1 (all tokens, both mixins, `:root` geometry + spacing), §2.1 + §2.4 (type tokens, `body`), §1.5 (code overrides, replacing the `github-dark` import), §3.1 (motion tokens), §3.2 (the complete keyframe library), §3.5 (reduced motion), §7 (the five primitives), §4.16 (`.dcp-rule`). This file lands **first**, in one edit, before any component is opened. Roughly half of both surveys resolves here without touching a component.

## 6.2 `src/index.html`
- `<title>` → `Diamond Core Processor`.
- Add `<meta name="theme-color" content="#0a0c11">`.
- Add an inline `<style>` in `<head>`: `html,body{background:#0a0c11;margin:0}` so first paint is already the product's colour instead of a white flash on every load.
- Nothing else.

## 6.3 `src/app/app.scss`
- **Delete the `body { font-family: var(--hc-font) }` rule.** It competes with `styles.scss` on the same element and, when it wins, resolves to Source Sans Pro Light (300 only), turning every 500/600/700 in the app into a synthesized fake bold. The typeface is declared once, in `styles.scss`.
- Leave the rest of the file alone.

## 6.4 `app/home/home.component.ts`
**Only the `@Component` decorator.** Replace `styleUrls` with the nine-sheet array in §5.1. **No other line of this 3,339-line file may change** — no methods added, no `setTimeout` retimed, no class renamed (CUT 3).

## 6.5 `app/home/home.component.html`
Editable. Changes:
1. **Masthead** — replace the `.mark` SVG with §4.2, including the three `[class.*]` bindings written inline off `revisionStatus()` and `pendingInstallScope()`. **Do not call any method that does not already exist.**
2. **Specbar** — split the middot string into three `<span class="spec-item">` with inline check polylines (§4.11).
3. **Segmented controls** — add `<span class="seg-ind" aria-hidden="true"></span>` as the first child of `.scope-control` and `.adopt-control`, and set the index inline:
   `[style.--seg-n]="2"` `[style.--seg-i]="isScopeActive('features') ? 1 : 0"` on `.scope-control`;
   `[style.--seg-n]="2"` `[style.--seg-i]="packageState(section) === 'adopted' ? 0 : 1"` on `.adopt-control` (Discard has left the group — see §6.10).
4. **Orientation** — restructure into three `.orientation-step` blocks each carrying its schematic SVG (§4.8); replace the four `.legend-swatch` squares with `<dcp-diamond [kind]="…">` (§4.9).
5. **Empty state** — add the hex-lattice SVG (§4.10), an `<h2>`, a `<p>`, and turn `.sample-link` into `<button class="sample-chip">`.
6. **Client chips** — add the platform glyph SVGs (§4.12).
7. **Header sig** — add `<i class="fp" [style.background-image]="…">` beside `.header-sig`. If no fingerprint computed exists on `HomeComponent` (it cannot be added — see §6.4), **omit the fingerprint here and keep it in tree-row only.** Do not add TS to `home.component.ts` to enable it.
8. **Toast** — add `<i class="toast-drain" aria-hidden="true"></i>` as the last child of `.install-toast`.
9. **i18n** — replace every hardcoded literal listed in §8.2 with `| t` calls.
10. **Do not** convert the `@if (isGroupOpen(...))` at line 233 (§3.6).

## 6.6 `home.shell.scss`
- `.tree-home`: unchanged geometry.
- `.install-toast`: **stop being a full-bleed saturated gold slab.** It becomes a frosted dark plate — `background: var(--dcp-glass-strong)`, `border-radius: var(--dcp-radius-md)`, `box-shadow: var(--dcp-shadow-2)`, `border-left: 3px solid var(--dcp-gold)`, ink `--dcp-ink`. A purely informational message must not be the loudest object in the product.
- `animation: dcp-seat var(--dcp-t-arrive) var(--dcp-e-seat)`; leave via `animate.leave` with `dcp-seat-out`.
- `.toast-drain`: `position:absolute; left:0; right:0; bottom:0; height:2px; background: var(--dcp-gold-tint-2); transform-origin:left; animation: dcp-drain 8000ms linear forwards;` — matches the 8 s timer at `home.component.ts:1624`, which is **not** changed.
- `.install-toast-close`: 28 px hit target, `.dcp-btn.ghost`.

## 6.7 `home.masthead.scss`
- `.specbar`: height 30 px, `--dcp-micro` / `--fs-micro` / 600 / `--tr-caps`, ink `--dcp-ink-2` (was `--dcp-ink-4` at ~2.5:1). Drop `font-family: var(--hc-mono)` on the caps half; keep mono+tabular on the counts.
- `.mark`: 40 px, per §4.2.
- `.word`: `--dcp-display`, `--fs-display`, 600, `--tr-display`, **sentence case** (was 25px/800/0.15em UPPER).
- `.kicker`: `--fs-body`, 400, ink-2, sentence case, `margin-top: var(--sp-2)` (was 10px/600/0.22em UPPER at ink-3).
- `.brand`: the mark + word + kicker become one lockup; `gap: var(--sp-3)`.
- **`.home-client` BUG FIX:** `border: 1px solid var(--dcp-border)` — `--dcp-border` was defined **nowhere in the project**, so the shorthand was invalid-at-computed-value-time and `border-style` fell back to `none`; these chips have silently had no border. `--dcp-border` is now defined in both mixins (§1.2/§1.3). Additionally: `border-radius: var(--dcp-radius-pill)`, `padding: 3px 4px 3px 8px`, the platform glyph at 14 px in `--dcp-ink-3`, the name at `--fs-label`/`--dcp-ink`, the version as a right-aligned gold pill (`background: var(--dcp-gold)`, ink `--dcp-on-gold`, `--fs-meta`, `--dcp-radius-pill`), and `.home-client-forget` revealed on hover only, 24 px target.
- `.home-client` arrival/departure per hook 33.

## 6.8 `home.revisions.scss`
- `.home-revisions-toggle`: `--fs-label`/500 sentence case, ink-2, plus a chevron that rotates on open (`[attr.aria-expanded]` already exists and has no visual counterpart today).
- `.revision-count`: `--dcp-radius-pill`, `--fs-meta` mono tabular, `--dcp-ink-2` on `--dcp-raise`.
- `.revision-state`: `--fs-label`, plus the five state classes and their gestures (hooks 1–4). Bind `[class]` off `revisionStatus()` in the template.
- Promote the strip into a **history rail**: a row of small tick marks, one per revision, the current one filled `--dcp-accent`. Ticks are 2 × 8 px `--dcp-line-2` divs, 3 px gap.
- `.home-revision-items`: route through `.dcp-pop` (§7.3). `transform-origin: top left`. Items stagger `dcp-seat` per §3.1.1 with `[style.--i]="$index"`.
- `.home-revision-item.current`: **accent left rail + raised ground**, not a tinted fill. `box-shadow: inset 2px 0 0 var(--dcp-accent); background: var(--dcp-raise);`
- Sigs to `--fs-meta` mono at ink-2.

## 6.9 `home.sections.scss`
- `.domain-section`: `border-radius: var(--dcp-radius-lg)`, `box-shadow: var(--dcp-shadow-1)` (the new recipe — the old `0 1px 2px rgba(0,0,0,0.5)` was a black shadow on a black page), `border: 1px solid var(--dcp-line-2)`, `background: var(--dcp-surface)`.
- **`background: var(--zc-tint)` is REMOVED from the card body.** It washed the zone colour across the whole section, turning every row under an amber "Swarm" card brown. The zone colour is now confined to the rail (§4.5) and the header.
- `.zone-rail` / `.zone-idx` / `.zone-name`: §4.5.
- `.domain-section.just-adopted`: the composite gesture in hook 8. **Class name unchanged.** Animation total 480 ms.
- `.domain-header`: `background: var(--zc-head)`. **NEVER apply `backdrop-filter` to this element** — it is `position: sticky`, and `backdrop-filter` creates a fixed containing block that will capture absolutely-positioned descendants and mis-position them. If a frost is wanted when it sticks, put it on a `::before` pseudo-element covering the header, never on the header itself. This codebase has a documented incident on exactly this.
- **`.domain-header.domain-hidden`: DELETE the `repeating-linear-gradient(45deg, …)` barber-pole hatch entirely.** Replace with `filter: saturate(0.15); opacity: 0.72;` transitioned over `--dcp-t-state`, plus a `.dcp-chip` reading "Hidden" in the header and an eye-off glyph at full opacity in the rail.
- `.domain-url`: `--dcp-ink` at `--fs-name`/600 (it was `--dcp-ink-2` — **dimmer than the rows it contains**). The `/` separator stays ink-3.
- `.group-chevron`: `transition: transform var(--dcp-t-state) var(--dcp-e-state)`.
- `.group-note`: **drop `font-style: italic`**; becomes a `.dcp-chip`.
- `.header-sig`: `--fs-meta` mono at ink-2, **opacity 1** (was 9px ink-3 at 0.8). Add a copy affordance on hover with a `dcp-tick` "copied" flash.
- `.backup-toggle`: **drop `float: right`** (an anachronism fighting the row's own layout) — move it into the header action cluster with flex. Rest at `--dcp-ink-3` (not `opacity: 0.4`), hover `--dcp-accent`. **The OFF state stops being `--dcp-danger`** — "I chose not to back this up" is a preference, not an error. Use a struck-archive glyph at `--dcp-warn`.

## 6.10 `home.package.scss`
- `.version-bar`: real hierarchy. `.version-generation` becomes a small filled gold pill (`--dcp-radius-pill`, `background: var(--dcp-gold)`, `color: var(--dcp-on-gold)`, `--fs-meta`, padding `1px 7px`); `.version-name` at `--fs-body`/`--dcp-ink` with a pencil glyph fading in on hover; `.version-time` right-aligned `--fs-meta` ink-3. Fix the `2px` bottom padding to `var(--sp-2)`.
- `.adopt-control`: `position: relative; overflow: hidden; border-radius: var(--dcp-radius-md);` with the travelling indicator:

```scss
.scope-control::before, .adopt-control::before { content: none; }  /* if any legacy fill exists */
.seg-ind {
  position: absolute; top: 2px; bottom: 2px; left: 2px;
  width: calc((100% - 4px) / var(--seg-n, 2));
  border-radius: calc(var(--dcp-radius-md) - 1px);
  transform: translateX(calc(var(--seg-i, 0) * 100%));
  transition: transform var(--dcp-t-latch) var(--dcp-e-latch),
              width     var(--dcp-t-latch) var(--dcp-e-latch);
  background: var(--dcp-accent-tint-2);
  box-shadow: inset 0 0 0 1px var(--dcp-accent-ring);
  pointer-events: none;
}
/* the ADOPT indicator is GOLD — this control's ON state is the one thing in
   the app that means LIVE. */
.adopt-control .seg-ind { background: var(--dcp-gold-tint-2);
                          box-shadow: inset 0 0 0 1px var(--dcp-gold-ring); }
.adopt-seg, .scope-seg  { position: relative; z-index: 1; background: none; }
.adopt-seg.on, .scope-seg.on { color: var(--dcp-ink); }   /* the INDICATOR carries the accent */
```

- **DISCARD LEAVES THE GROUP.** It becomes a separate quiet icon button (`.adopt-discard`, `.dcp-btn.ghost`, 28 px) separated by `var(--sp-3)` of gap, with a click-then-confirm: first click widens it to read the localized "Remove?" for 3 s before it commits. A destructive uninstall must not sit one pixel from two benign verbs distinguished only by a hover colour.
- `.adopt-restore-point`: 32 px controls, input at `--fs-label`, real `--dcp-accent-ring` focus, `.adopt-error` at `--fs-meta` with an inline warning glyph. Expands per hook 13.
- `.domain-action`, `.action-icon`, `.remove`, `.view-logical-toggle`, `.download-toggle`: **28 px hit targets, 16 px icons at a uniform `stroke-width: 1.6`** (they currently run 1.7 / 1.9 / 2.0 at the same 14 px, so some read heavier). Hover-reveal per the §3.3 literal block. `.remove` becomes a two-step that widens to "Remove?" for ~3 s.
- `.section-status`: **drop the `padding: 11px 14px; font-size: 13px`** box — it pads as though it holds text it no longer holds. The track is flush, full card width, under the header.
- `.resolve-track` / `.resolve-fill`: §4.7.
- `.upgrade-banner`: keeps the amber wash. `.upgrade-optin-all` becomes a **solid** `--dcp-z-host-rail` fill with `--dcp-on-gold`-class dark ink plus a count badge — today it is styled identically to the banner containing it (same border, same background, same colour) and `:hover` and `:active` are the **same value**, so the button that accepts an entire software update has no press feedback at all. Give it a real `:active` via `.dcp-btn`.
- Banner arrival/departure and the row drain per hook 16.

## 6.11 `home.install.scss`
- `.domain-input`: a raised plate — `background: var(--dcp-surface-2)`, `border-radius: var(--dcp-radius-md)`, `box-shadow: var(--dcp-shadow-1)`, `padding: 3px`, with the `<input>` sitting in an inset well (`background: var(--dcp-sunken)`, `box-shadow: var(--dcp-shadow-inset)`, `border-radius: var(--dcp-radius-sm)`).
- `.domain-input input::placeholder`: **`--dcp-ink-3`** (was `--dcp-ink-4` at ~2.5:1 — a hard accessibility fail on the app's primary invitation).
- `.domain-input input:focus`: `box-shadow: var(--dcp-shadow-inset), 0 0 0 2px var(--dcp-accent-ring)` transitioned over 160 ms.
- `.btn`: the `.dcp-btn.primary` primitive — `--fs-label`/600 **sentence case** (was 11px/800/0.16em UPPER), the global press-depress, and on submit it morphs **in place** into an indeterminate progress state (a `dcp-travel` sweep living inside the button).
- **`.btn.install-cancel` BUG FIX:** it currently only overrides `color`, so it inherits the full gold `.btn` fill and renders as a **gold-filled button with grey text** next to Allow. It becomes `.dcp-btn.ghost` — transparent, `1px solid var(--dcp-line-2)`, ink-2.
- `.install-confirm-scope`: `--fs-meta` mono on `--dcp-surface-2`, `--dcp-radius-sm`, slides out from behind the button per hook 9.
- `.sample-link` → `.sample-chip`: `.dcp-chip` geometry, `--dcp-radius-pill`, hairline, an inline `→` that translates 3 px right on hover, real spacing (delete the `margin: -10px 0 16px 2px`).
- `.scope-control` / `.scope-seg` / `.seg-ind` per §6.10.
- `.tbtn`: give it a **real plate at rest** — `background: var(--dcp-surface-2)`, `border: 1px solid var(--dcp-line-2)`, `border-radius: var(--dcp-radius-sm)`, 30 × 30. `.tbtn.on`: `box-shadow: inset 0 0 0 1px var(--dcp-accent-ring)`, `background: var(--dcp-accent-tint)`, ink `--dcp-ink` (was `--dcp-gold-dim`, a brown-black smudge). `.tbtn.dim`: replace `opacity: 0.35` with `color: var(--dcp-ink-disabled); background: var(--dcp-surface-inactive); border-color: var(--dcp-line-inactive);` transitioned over `--dcp-t-state`.
- `.vsep`: `--dcp-line-2`, height 14 px (was 20 px at `--dcp-line`, invisible).

## 6.12 `home.orientation.scss` / `home.empty.scss` / `home.responsive.scss`
- Orientation per §4.8 + §4.9 + type table. `.orientation-dismiss` → `.dcp-btn.ghost` at `--fs-label` sentence case (it is currently 9 px, the smallest text in the app, and it is the only way out of the panel). Dismiss **collapses** the panel per hook 34.
- Empty state per §4.10, routed through `.dcp-empty`.
- Responsive: keep the block last. Delete `.title` and `.kind-toggle`. If any row geometry changed, mirror it here (§9.2).

## 6.13 `app/tree-view/tree-row.component.ts`
This is the app's densest and most-repeated surface. Changes:

1. **DELETE `.name.bee`, `.name.worker`, `.name.drone`, `.name.dependency`.** Every row title becomes `--dcp-ink` at `--fs-name`/600 with `letter-spacing: 0` (the `-0.01em` muddied Segoe's letterfit). This is the single largest removal of gross colour in the app.
2. `.row`: **no border-radius.** Real hover: `background: var(--dcp-surface-2)` (now a perceptible ~7 L step) **plus** a 2 px accent left edge growing in from zero:
   ```scss
   .row::before { content:''; position:absolute; left:0; top:0; bottom:0; width:2px;
                  background: var(--dcp-accent); transform: scaleX(0); transform-origin:left;
                  transition: transform var(--dcp-t-state) var(--dcp-e-state); }
   .row:hover::before { transform: scaleX(1); }
   ```
3. `.crumb`: `--fs-meta`, `--dcp-ink-3`; wrap the final path segment in `<b class="leaf">` at `--dcp-ink-2` so the crumb gains direction.
4. `.desc`: `--fs-label`, `--dcp-ink-2` (it currently shares ink-3 with `.crumb` at a smaller size, so name/crumb/desc are three near-identical greys at one volume).
5. **Chips:** collapse all six variants onto `.dcp-chip` (§7.2). Three semantic families: informational (`--dcp-accent` dot) for new / active / in-install; waiting (`--dcp-gold` dot) for waiting-for-bytes / waiting-for-trust; verified (`--dcp-ok` dot) / failed (`--dcp-danger` dot) for audit. Sentence case, `--fs-meta`, pill radius.
6. `.sig`: `--fs-meta`, `--dcp-ink-2`, tabular. Add `<i class="fp">` per §4.6.
7. **`grid-template-columns`:** widen the sig column from `74px` to **`96px`** to fit eight mono chars at 11.5 px (~55 px) plus the 22 px fingerprint plus a gap. New value: `16px 34px 18px minmax(0,1fr) 96px 66px`.
8. `.tint`: **quantise `domainHue()`** — replace `hsl(var(--domain-hue), 45%, 55%)` with a computed index into the eight `--dcp-dh-*` stops: `background: var(--dcp-dh-N)` where `N = domainHue % 8`. Set it via `[style.--dh]` and `background: var(--dcp-dh-0)` … resolved with a small `@for`-free CSS map, or simplest: bind the resolved var name in TS and use `[style.background]="'var(--dcp-dh-' + (hue % 8) + ')'"`.
9. **`.row.pending`: DELETE `@keyframes row-pending-pulse` AND `font-style: italic`.** Rest state becomes `background: var(--dcp-surface-inactive); color: var(--dcp-ink-muted);` with no animation. When `pending` clears, the row runs `dcp-seat` per hook 17.
10. **All six bare-opacity states get real tokens** (graft from Cold Press): `.row.visual-context` (0.7), `.row.egg` (0.85), `.tbtn.dim` (0.35), `.backup-toggle` (0.4), `.toggle.dimmed` (0.4), `.row.pending` (0.55) → `--dcp-surface-inactive` / `--dcp-ink-muted` / `--dcp-line-inactive`. These currently **compound multiplicatively**, so a pending row inside a dimmed context is near-invisible and "inactive by design" is indistinguishable from "failed to load". **Opacity is reserved for transitions only.**
11. `.allow`: a real filled treatment in its state colour at `--fs-label`/600 sentence case, 28 px tall, with a click-then-confirm micro-interaction (it grants a trust override; the friction should be visible).
12. `.ract`: 28 px targets, 16 px icons at `stroke-width: 1.6`, revealed per the §3.3 literal block.
13. `[style.--i]="$index"` must be set on each row by `tree-view.component.ts` (§6.15) for the drain stagger.
14. Add the reduced-motion note: the global block covers this file; do **not** add a local one.
15. `.row.freshly-upgraded` per hook 16 (transition-based drain, not animation).
16. `.row.hatching` + the egg overlay per §4.4 / hook 18.

## 6.14 `app/tree-view/toggle.component.ts`
The most-clicked control in the app — one per row, potentially hundreds on screen. Today it is a 34 × 19 hard-cornered rectangle with a grey square on `#1e1f24` behind a 15 %-white border; you cannot tell on from off scanning down a long tree, which is the entire point of the control.

```scss
.toggle {
  position: relative; width: 36px; height: 20px; flex: none;
  border-radius: var(--dcp-radius-pill);
  background: var(--dcp-sunken);
  box-shadow: var(--dcp-shadow-inset), inset 0 0 0 1px var(--dcp-line-2);
  transition: background var(--dcp-t-state) var(--dcp-e-state),
              box-shadow var(--dcp-t-state) var(--dcp-e-state);
}
.thumb {
  position: absolute; top: 3px; left: 3px; width: 14px; height: 14px;
  border-radius: 50%; background: var(--dcp-ink-3);
  transform: translateX(0);
  transition: transform var(--dcp-t-latch) var(--dcp-e-latch),
              background var(--dcp-t-state) var(--dcp-e-state);
}
.toggle.on            { background: var(--dcp-gold-tint-2);
                        box-shadow: inset 0 0 0 1px var(--dcp-gold-ring); }
.toggle.on .thumb     { transform: translateX(16px); background: var(--dcp-gold); }

/* THE LANDING RING — added by the CLICK HANDLER, removed on animationend.
   NEVER derived from mount or from enabled(); tree-row remounts every row
   on scroll (§3.4). */
.toggle.on.just-landed { animation: dcp-latch-ring 420ms var(--dcp-e-seat);
                         --dcp-latch-ink: var(--dcp-gold-ring); }

/* THE TRI-STATE — "on, but an ancestor is off". This is a real, important
   third meaning and it is currently opacity:0.4, visually identical to
   disabled. Three states become three SHAPES. */
.toggle.dimmed        { background: var(--dcp-sunken);
                        box-shadow: var(--dcp-shadow-inset),
                                    inset 0 0 0 1px var(--dcp-gold-ring); }
.toggle.dimmed .thumb { background: transparent;
                        box-shadow: inset 0 0 0 1.5px var(--dcp-gold); }

.toggle:focus-visible { outline: none; box-shadow: var(--dcp-shadow-inset),
                        0 0 0 2px var(--dcp-accent-ring); }
```

TS: in the existing click handler, set a `#justLanded` signal / class true, and clear it in an `(animationend)` binding on the host. **Never** set it from an effect on `enabled()`.

Optional cascade (hook 6): `transition-delay: calc(min(var(--depth,0),8) * 20ms)` where `--depth` comes from the row's existing depth value. **If the node model has no depth field, skip it.**

## 6.15 `app/tree-view/tree-view.component.ts`
Add `[style.--i]="$index"` to each rendered `dcp-tree-row` in the `@for`. That is the only change. It enables the staggered drain (hook 16) and the child-expand stagger (hook 21) with zero further TS.

## 6.16 `app/tree-view/diamond-icon.component.ts`
Redraw all glyphs per §4.3, add the egg overlay per §4.4, add the `.kmark` hover/focus/active states per §4.3. Keep the selector, the `kind` input, and the `clicked` output. Add the filled ground pass behind each stroke.

## 6.17 `app/tree-view/bee-inspector.component.ts`
- `.page` → also carries `.dcp-takeover`: `animation: dcp-takeover-in var(--dcp-t-arrive) var(--dcp-e-seat); transform-origin: var(--from-x, 50%) var(--from-y, 40%);` with `--from-x/--from-y` set from the invoking row's bounding rect if available, otherwise the defaults. Exit via `animate.leave` with `dcp-takeover-out`. Keep the underlying page visible-but-dimmed behind so the user never loses their place.
- **Header split into two rows:** name at `--fs-title`/600 + a kind `.dcp-chip` on top; meta as one quiet `--fs-meta` mono line beneath, with copy and edit as proper 28 px `.dcp-btn.ghost` buttons. Seven elements at five sizes in a 44 px bar reads as a debugger's status line.
- `.prop-label`: `--fs-label`/400 sentence case ink-3. `.props code`: `--fs-label` ink-2. Row rhythm `padding: var(--sp-2) 0`.
- `.pill.*`: real geometry — `--dcp-radius-pill`, `padding: 2px 8px`, `--fs-meta`. **`.pill.emit` STOPS being `--dcp-danger`** — every event a module *emits* currently looks like an error condition. Move it to `--dcp-accent`.
- **DELETE `@keyframes pulse` and `.loading-dot`.** Replace with `.dcp-resolving` (§4.7).
- `.source-btn` / `.patch-btn` / `.cancel-btn` → `.dcp-btn.secondary` / `.dcp-btn.primary` / `.dcp-btn.ghost`. Three button languages in one screen become one.
- `sigCopied()` → the fixed-width crossfade + check per hook 31. 2 s timer unchanged.
- No local `prefers-reduced-motion` block; the global one covers it.

## 6.18 `app/command-line/dcp-command-line.component.scss`
- `.command-shell`: raised inset ground (`--dcp-sunken` + `--dcp-shadow-inset`), `--dcp-radius-md`.
- `.command-row::before`: replace the literal `'>'` character with a small drawn chevron/filter glyph (a 10 px inline SVG in the template) that animates to `--dcp-accent` on focus.
- `.command-shell:focus-within`: `box-shadow: var(--dcp-shadow-inset), 0 0 0 2px var(--dcp-accent-ring)` growing in over 160 ms (was `0 0 0 3px var(--dcp-accent-tint)`, a brown ring on a dark box).
- `.ghost`: `color: var(--dcp-ink-ghost); opacity: 1;` (was ink-3 × 0.7 ≈ 2:1 — the smartest thing the command line does never showed itself).
- `.command-results`: route through `.dcp-pop`. `li.active`: neutral `--dcp-raise` ground **plus** a 2 px inset accent bar, not the brown tint. **One shared indicator bar travels vertically** between items as you arrow through (`transform: translateY(calc(var(--active-i) * 100%))`), rather than teleporting.
- `.typed` / `.rest`: express the match with **weight**, not hue — `.typed` at `--dcp-ink` / 600, `.rest` at `--dcp-ink-3` / 400. Drop the gold.

## 6.19 `app/relay/relay-panel.component.ts`
- **Delete the local `@keyframes panelIn`** (line ~153). `.panel` → `.dcp-pop`, `transform-origin: top right`, with a real exit.
- `.toggle`: the bolt glyph plus a small state dot. The dot fires `dcp-latch-ring` **once** when the polled status actually changes value (hook 32) — never on poll, never on mount. Track the previous value in a `#field`.
- `.panel-header h3`: `--fs-title`/600 (it was 13 px — smaller than the app's body text).
- `.badge`: `.dcp-chip` with three explicit states — checking (`--dcp-warn` dot), connected (`--dcp-ok` dot), offline (`--dcp-danger` dot). Offline must not be grey-on-grey, which reads as "no data".
- `.btn-probe` / `.btn-install` / `.btn-copy` → `.dcp-btn.primary` / `.dcp-btn.secondary` / `.dcp-btn.ghost`. Their only hover today is `filter: brightness(1.06)`, an imperceptible ~6 % change on the panel's primary actions.
- `.field:focus`: `--dcp-accent-ring`, not the tint.
- Add the relay diagram (§4.13) to `.install-block`.
- **Mobile:** replace `@media (max-width: 600px) { .panel { position: fixed; inset: 0; animation: none } }` with a bottom sheet — `inset: auto 0 0 0`, `max-height: 88vh`, `border-radius: var(--dcp-radius-xl) var(--dcp-radius-xl) 0 0`, a drag handle, **a visible close button inside the sheet header**, and `animation: dcp-sheet-up 220ms var(--dcp-e-seat)`. Today there is no visible way out: the close affordance is the toggle button, which sits underneath the fixed `z-index: 1000` panel.
- `copied()` per hook 31.

## 6.20 `app/settings/auditor-settings.component.ts`
- **Delete the local `@keyframes panelIn`** (line ~134). `.panel` → `.dcp-pop`. Same mobile bottom-sheet treatment as §6.19.
- `.toggle` (shield): three states per §4.14.
- `.add-row`: real `--fs-meta` ink-3 **labels** above each field (placeholders are currently the only labelling, so once you type the URL and Label fields are indistinguishable). URL field wide, label field narrow. `.btn-add:disabled` uses `--dcp-ink-disabled` / `--dcp-surface-inactive`, **not** `opacity: 0.35`.
- `.source-item`: add a live status dot and a last-checked time; `.btn-remove` becomes a hover-revealed 28 px `.dcp-btn.ghost`; each source gets the monochrome fingerprint (§4.6) derived from its URL so the list is scannable by shape.
- `.empty-state` → `.dcp-empty` with a direct action ("Add your first source").
- `.threshold` per §4.15.

## 6.21 `app/patch-list/patch-list.component.ts` and `app/revision-list/revision-list.component.ts`
These are the same control twice, with independently written styles. Unify:
- Both `.toggle`s: `--fs-label`/500 sentence case, in a shared container with a `--dcp-rule` above, indented into the section body. They currently render as two identical borderless grey uppercase strings stacked on top of each other, reading as console output appended to the card.
- Both chevrons: `transition: transform var(--dcp-t-state) var(--dcp-e-state)`.
- `.patch-item`: `border-radius: var(--dcp-radius-sm)` (was a hardcoded `3px`, different from its sibling's token).
- `.patch-item.active` / `.revision-item.active`: **accent left rail + `--dcp-raise` ground**, not the brown `--dcp-accent-tint` fill. The active marker **travels** between rows (one shared indicator, `transform: translateY()`, `--dcp-t-latch`), and switching hands off to the section arrival gesture.
- `.revision-flag`: `--fs-meta`/600 **sentence case** (was **8 px**, the smallest text in the entire application, and it is the word telling you which deployed version is running).
- `.revision-version`: a small gold pill at `--fs-meta`.
- Sigs `--fs-meta` mono ink-2; times right-aligned `--fs-meta` ink-3.

## 6.22 `app/layer-editor/layer-editor.component.ts`
- `.layer-editor` → `.dcp-takeover`, sharing the inspector's gesture exactly (hooks 27–28).
- `.back-btn` / `.discard-btn` / `.commit-btn` → `.dcp-btn.ghost` / `.dcp-btn.ghost` (danger hover) / `.dcp-btn.primary`. **`.discard-btn` stops being `var(--dcp-k-bee)`** — a kind ink used as a UI state colour is a category error.
- `.lock-input`: a lock glyph, a visible label, and a real `--dcp-accent-ring` focus. It is the security gate on committing code changes and currently has none of the three.
- `.commit-btn`: shows the staged-change count and animates through committing → committed rather than swapping text. **Drop the 🔒 from the label** (§8.1) and render a stroked padlock SVG instead.
- `.ai-bar`: visually distinct ground (`--dcp-surface-2`) with an accent glyph at the leading edge. **`.ai-spinner`'s literal word "Working…" is replaced** by a 2 px indeterminate `dcp-travel` line along the bar's bottom edge (hook 36).
- `.messages`: proper message rows at `--fs-body`, role colour from **UI tokens** not kind inks (`--dcp-k-queen` was being used for the assistant role — another category error). New messages arrive with `dcp-seat`.
- `.file-panel`: `--dcp-radius-md`, `--dcp-shadow-1`. **A modified file tints its panel's LEFT RAIL** rather than adding a `.file-modified` tag — the state becomes structural and scannable down the list. `.file-discard` becomes a 28 px `.dcp-btn.ghost`.
- `.loading` / `.empty` → `.dcp-empty`.
- Sweep the five hardcoded `4px` and one `2px` radii onto the ladder.

## 6.23 `app/code-viewer/*` and `app/code-editor/code-editor.component.ts`
- `.toolbar .label` (the redundant "CODE" string): **delete**. Replace with real metadata — a language `.dcp-chip` and a tabular line count.
- `.btn` → `.dcp-btn.ghost`, 28 px. Its `translateY(1px)` press is now the global default and can be removed locally.
- `.code`, `.pre`: `--fs-label` (was **10 px**, source code at the app's smallest size), `line-height: 1.55`, **`white-space: pre` with `overflow-x: auto`**. Delete `word-break: break-all`, which chops long identifiers and URLs at arbitrary character positions mid-token — it mangles exactly what you opened the viewer to read.
- `code-editor`: replace the `oneDark` extension with a small `EditorView.theme()` built from the `--dcp-code-*` tokens (background, gutter, selection, cursor, active line, matching bracket) plus a `HighlightStyle` mapping the same hues as §1.5. `.editor-host` `4px` → `var(--dcp-radius-md)`.

## 6.24 `app/intent-inspector/intent-inspector-pro.*`
This screen already has the best proportions in the codebase (48 px buttons, 24 px titles, hover lift, press depress, 1 rem panel padding). Those proportions have been **harvested into `.dcp-btn`** (§7.1). Now bring the screen itself back onto the shared tokens:
- `.button` / `.button.primary` → `.dcp-btn.primary` / `.dcp-btn.secondary`, `size: lg` (48 px).
- `.panel-title`: `--fs-label`/600 **sentence case** at ink-2 with a `.dcp-rule` beneath (it was 13px/800/UPPERCASE at ink-3 — maximum weight at minimum contrast, the app's signature typographic mistake in one rule).
- `.intent-title`: `--fs-lede`. Panel radius `--dcp-radius-md`.

## 6.25 `app/sentinel/sentinel.component.ts`
No structural change. Verify no hardcoded radius, no `opacity`-as-state, and that any status text sits on the type scale. If it renders a bare-text loading state, route it through `.dcp-empty`.

---

# 7. THE FIVE SHARED PRIMITIVES (`styles.scss`)

There are roughly **25 distinct button styles**, **6 chip variants in tree-row plus 4 in the inspector**, **4 popover treatments** and **5 bare-text empty/loading states** in the app today. That is precisely why every panel looks like it came from a different product. These primitives live in `styles.scss` (zero component budget), and re-pointing every component at them **reduces** total CSS.

## 7.1 `.dcp-btn`

```scss
.dcp-btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: var(--sp-2);
  height: 32px; padding: 0 var(--sp-3);
  border: 1px solid transparent;
  border-radius: var(--dcp-radius-sm);
  font: var(--fw-semibold) var(--fs-label)/1 var(--dcp-ui);
  letter-spacing: 0.01em;
  cursor: pointer; user-select: none;
  background: var(--dcp-surface-2); color: var(--dcp-ink-2);
  border-color: var(--dcp-line-2);
  transition: background var(--dcp-t-state) var(--dcp-e-state),
              border-color var(--dcp-t-state) var(--dcp-e-state),
              color var(--dcp-t-state) var(--dcp-e-state),
              box-shadow var(--dcp-t-state) var(--dcp-e-state),
              transform var(--dcp-t-tap) var(--dcp-e-state);
}
.dcp-btn.sm { height: 28px; padding: 0 var(--sp-2); }
.dcp-btn.lg { height: 44px; padding: 0 var(--sp-5); font-size: var(--fs-name); }

.dcp-btn:hover  { background: var(--dcp-raise); color: var(--dcp-ink);
                  border-color: var(--dcp-line-3); }
/* THE PRESS — code-viewer had the app's ONLY press feedback. It is now global. */
.dcp-btn:active:not(:disabled) { transform: translateY(1px); }
.dcp-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dcp-accent-ring); }
.dcp-btn:disabled { color: var(--dcp-ink-disabled); background: var(--dcp-surface-inactive);
                    border-color: var(--dcp-line-inactive); cursor: default; }

.dcp-btn.primary { background: var(--dcp-accent); color: var(--dcp-on-accent);
                   border-color: transparent; }
.dcp-btn.primary:hover { background: var(--dcp-accent-strong); }

.dcp-btn.ghost   { background: transparent; border-color: var(--dcp-line-2);
                   color: var(--dcp-ink-2); }
.dcp-btn.ghost:hover { background: var(--dcp-hover); }

.dcp-btn.danger  { background: transparent; border-color: var(--dcp-line-2);
                   color: var(--dcp-ink-2); }
.dcp-btn.danger:hover { background: var(--dcp-danger-tint);
                        border-color: var(--dcp-danger); color: var(--dcp-danger-ink); }

/* icon-only */
.dcp-btn.icon { width: var(--dcp-hit); height: var(--dcp-hit); padding: 0; }
.dcp-btn.icon svg { width: 16px; height: 16px; stroke-width: 1.6; }
@media (hover: none) { .dcp-btn.icon { width: 36px; height: 36px; } }
```

## 7.2 `.dcp-chip`

The dot carries the colour; the label is always legible ink. This is what lets the palette shrink without losing the signal, and it is why a row with two chips stops reading as confetti.

```scss
.dcp-chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 20px; padding: 0 9px 0 7px;
  border-radius: var(--dcp-radius-pill);
  background: var(--dcp-raise);
  box-shadow: inset 0 0 0 1px var(--dcp-line);
  color: var(--dcp-ink-2);
  font: var(--fw-semibold) var(--fs-meta)/1 var(--dcp-ui);
  letter-spacing: 0; text-transform: none;
  white-space: nowrap;
}
.dcp-chip::before { content: ''; width: 5px; height: 5px; border-radius: 50%;
                    flex: none; background: var(--chip-dot, var(--dcp-ink-3)); }
.dcp-chip.info     { --chip-dot: var(--dcp-accent); }
.dcp-chip.waiting  { --chip-dot: var(--dcp-gold); }
.dcp-chip.verified { --chip-dot: var(--dcp-ok); }
.dcp-chip.failed   { --chip-dot: var(--dcp-danger); }
.dcp-chip.neutral  { --chip-dot: var(--dcp-ink-4); }
```

**Danger rule:** `.failed` must always be accompanied by shape — a warning glyph or a struck outline — never by colour alone. The copper host zone (`#cf8a70`) sits close enough to danger red (`#ec7365`) that on a dim monitor a chip could be misread.

## 7.3 `.dcp-pop`

```scss
.dcp-pop {
  position: absolute; z-index: 50;
  border-radius: var(--dcp-radius-md);
  background: var(--dcp-glass);
  box-shadow: var(--dcp-shadow-2), inset 0 1px 0 var(--dcp-glass-hi);
  border: 1px solid var(--dcp-line-2);
  transform-origin: top center;
  animation: dcp-pop-in var(--dcp-t-state) var(--dcp-e-seat);
  overflow: hidden;
}
/* backdrop-filter goes on a ::before, NEVER on the element — it creates a
   fixed containing block that captures absolutely-positioned descendants.
   This codebase has a documented incident on exactly this. */
.dcp-pop::before {
  content: ''; position: absolute; inset: 0; z-index: -1;
  backdrop-filter: var(--dcp-glass-blur);
  -webkit-backdrop-filter: var(--dcp-glass-blur);
}
.dcp-pop.is-leaving { animation: dcp-pop-out 150ms var(--dcp-e-exit) both; }
.dcp-pop > * { animation: dcp-seat var(--dcp-t-state) var(--dcp-e-seat) both;
               animation-delay: calc(min(var(--i, 0), 8) * 24ms); }

@media (max-width: 600px) {
  .dcp-pop {
    position: fixed; inset: auto 0 0 0; max-height: 88vh; overflow: auto;
    border-radius: var(--dcp-radius-xl) var(--dcp-radius-xl) 0 0;
    animation: dcp-sheet-up 220ms var(--dcp-e-seat);
  }
  .dcp-pop .sheet-handle { display: block; width: 36px; height: 4px; margin: 10px auto;
                           border-radius: 999px; background: var(--dcp-line-3); }
}
```

## 7.4 `.dcp-empty`

```scss
.dcp-empty {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  gap: var(--sp-3); padding: var(--sp-7) var(--sp-4);
  color: var(--dcp-ink-3);
}
.dcp-empty__art  { width: 220px; max-width: 100%; height: auto; }
.dcp-empty__art path { fill: none; stroke-linejoin: round; stroke-linecap: round; }
.dcp-empty h2    { margin: 0; font: var(--fw-semibold) var(--fs-lede)/var(--lh-snug) var(--dcp-ui);
                   letter-spacing: var(--tr-title); color: var(--dcp-ink); }
.dcp-empty p     { margin: 0; font-size: var(--fs-body); color: var(--dcp-ink-3);
                   max-width: 44ch; }
```

## 7.5 `.dcp-rule`
See §4.16.

---

# 8. THE COPY REVISIONS

**CORRECTION TO THE BRIEF:** the UI copy does **not** live in `app/core/dcp-i18n.ts` — that file is the bootstrap service and contains no user-visible strings. The `dcp.*` catalog lives in **`hypercomb-shared/i18n/en.json`** (and the thirteen sibling locale files). `dcp-i18n.ts` requires **no changes**.

## 8.0 THE NOUN SPINE (do this before any individual line rewrite)

The same object is currently called **package / module / branch / feature / revision / patch** within one screen. No amount of visual polish lets a user build a mental model from that. One spine, applied everywhere:

- What you install is a **PACKAGE**.
- What a package contains are **FEATURES**.
- A named point you can return to is a **RESTORE POINT**.
- A deploy is a **VERSION**.
- Retire **branch**, **module**, **revision** and **patch** from user-facing strings entirely. They stay in code, comments and IoC keys.

Plus, mechanically, across all 125 `dcp.*` keys:
- **Sentence case** for every button, label and tooltip. (`"Apply Patch"` is the only Title Case string in the catalog; `"copy sig"`, `"edit"`, `"code"`, `"safety"`, `"done"` are the lowercase ones. Pick one — sentence case.)
- **One real ellipsis character** (`…`) everywhere. Three keys use ASCII `...`.
- **Real `.one`/`.other` plurals**, never `(s)`. The catalog already implements plural resolution (`dcp-i18n.ts:77–81`) and uses it correctly for `dcp.upgrade-new`.
- **At most ONE middot list on the first screen.** There are currently four stacked in the first 80 px; it reads as a compliance badge strip.
- **No colour emoji.**

## 8.1 `hypercomb-shared/i18n/en.json` — exact old → new

| Key | OLD | NEW |
|---|---|---|
| `dcp.title` | `"Installer"` | `"Diamond Core Processor"` |
| `dcp.tagline` | `"Review · trust · install"` | `"Everything your hive runs, and nothing you have not allowed."` |
| `dcp.spec-verified` | `"Signed · sandboxed · verified"` | `"Signed · Sandboxed · Verified"` *(keep the middots — this is the ONE surviving list, and it is the specbar, where micro-caps are legitimate texture)* |
| `dcp.spec-count` | `"{domains} domains · {modules} modules"` | **DELETE this key.** Add `dcp.spec-domains.one` = `"1 domain"`, `dcp.spec-domains.other` = `"{count} domains"`, `dcp.spec-features.one` = `"1 feature"`, `dcp.spec-features.other` = `"{count} features"` |
| `dcp.install-placeholder` | `"Install a domain…"` | `"jwize.com"` *(a hint of FORMAT, not an order — the code prepends the scheme itself at `#prependScheme`)* |
| `dcp.add-domain-prompt` | `"Add a trusted domain to get started."` | `"Nothing installed yet. Type a domain above and we will fetch what it offers — nothing runs until you say so."` |
| `dcp.add-domain-title` | *(new key)* | `"Your hive is empty"` |
| `dcp.sample-try` | *(new key)* | `"Try diamondcoreprocessor.com"` |
| `dcp.zone-logical` | `"Live"` | `"Running"` |
| `dcp.zone-host` | `"Swarm"` | `"From the swarm"` |
| `dcp.zone-current` | `"Pushed"` | `"From your hive"` |
| `dcp.zone-default` | `"Base"` | `"Built in"` |
| `dcp.zone-package` | `"Added"` | `"You added"` |
| `dcp.toast-pushed-body` | `"Switch back to your Hypercomb tab — it will reload with the new modules."` | `"Switch back to your Hypercomb tab — it will reload with the new features."` |
| `dcp.backup-on` | `"Included in backups — click to leave this branch out"` | `"Included in backups — click to leave this out"` |
| `dcp.backup-off` | `"Left out of backups — click to include this branch"` | `"Left out of backups — click to include it"` |
| `dcp.overwrite-hint` | `"Reuse this name as-is instead of auto-incrementing if it is already taken"` | `"Keep this exact name, even if it is already taken."` |
| `dcp.revisions` | `"revisions"` | `"Versions"` |
| `dcp.revision-active` | `"active"` | `"Running"` |
| `dcp.adopt-hint` | `"Install and enable this package — live in your view now"` | `"Turn this on — it starts running in your hive."` |
| `dcp.save-hint` | `"Keep installed but off — a saved revision you can enable later"` | `"Keep it installed but switched off — turn it on whenever you like."` |
| `dcp.discard-hint` | `"Uninstall this package"` | `"Remove this package from your hive."` |
| `dcp.state-adopted` | `"on — live in your view"` | `"On — running in your hive"` |
| `dcp.state-saved` | `"installed, off"` | `"Off — installed, not running"` |
| `dcp.loading` | `"Loading..."` | `"Loading…"` |
| `dcp.resolved-count` | `"{count} files resolved"` | *(unchanged)* |
| `dcp.orientation-what` | `"Review, trust, and install the code your hive runs — nothing is live until you turn it on."` | *(unchanged — this is the one genuinely warm line)* |
| `dcp.orientation-install` | `"Type a domain and press Install to fetch its signed packages."` | `"A domain arrives — type one and we fetch its signed packages."` |
| `dcp.orientation-verbs` | `"Adopt turns a package on · Save keeps it installed but off · Discard removes it."` | **DELETE.** Replace with three keys: `dcp.orientation-step-1` = `"A domain arrives"`, `dcp.orientation-step-2` = `"Its signature is checked"`, `dcp.orientation-step-3` = `"You switch it on"` |
| `dcp.legend-layer` | `"layers — containers that group content"` | `"Layers — the folders your content sits in"` |
| `dcp.legend-bee` | `"bees — behaviors you can turn on"` | `"Bees — things the hive can do, each one you switch on"` |
| `dcp.legend-worker` | `"workers — background scripts"` | `"Workers — helpers that run quietly in the background"` |
| `dcp.legend-dependency` | `"dependencies — libraries bees rely on"` | `"Dependencies — shared code the rest relies on"` |
| `dcp.code` | `"code"` | `"Code"` |
| `dcp.code-payload` | `"code payload"` | `"Code payload"` |
| `dcp.copy` | `"copy"` | `"Copy"` |
| `dcp.copied` | `"copied"` | `"Copied"` |
| `dcp.expand` | `"expand"` | `"Expand"` |
| `dcp.exit` | `"exit"` | `"Exit"` |
| `dcp.safety` | `"safety"` | `"Safety"` |
| `dcp.allow-script` | `"allow script"` | `"Allow this script"` |
| `dcp.done` | `"done"` | `"Done"` |
| `dcp.review-untrusted` | `"review this code like it is untrusted input"` | `"Read this like you did not write it."` |
| `dcp.focus-network` | `"focus on network calls, data exfiltration, and token/resource access"` | `"Watch what it sends, and where."` |
| `dcp.verify-before-confirm` | `"verify before confirming"` | `"Be sure before you allow it."` |
| `dcp.relay-description` | `"The relay handles mesh communication between peers. Install it locally or point to a remote relay."` | `"The relay is how your hive talks to other people's. Run one locally, or point at someone else's."` |
| `dcp.relay-polled` | `"Relay is polled every 10 s"` | `"We check every 10 seconds."` |
| `dcp.relay-connected` | `"connected"` | `"Connected"` |
| `dcp.relay-checking` | `"checking"` | `"Checking"` |
| `dcp.relay-offline` | `"offline"` | `"Offline"` |
| `dcp.relay-install-description` | `"Download the installer, then double-click it to start the relay. Requires Node.js 20+."` | `"Download the installer, then double-click it to start the relay. Needs Node.js 20 or newer."` |
| `dcp.trust-sources` | `"source(s)"` | **DELETE.** Add `dcp.trust-sources.one` = `"source"`, `dcp.trust-sources.other` = `"sources"` |
| `dcp.trust-description` | `"Add trusted auditor endpoints that vouch for code signatures. Content must meet the approval threshold before it is marked as trusted."` | `"Auditors are people you trust to vouch for code. Set how many have to agree before something counts as trusted."` |
| `dcp.trust-empty` | `"No trusted sources configured"` | `"No one is vouching for your code yet"` |
| `dcp.trust-empty-action` | *(new key)* | `"Add your first source"` |
| `dcp.inspector-copy-sig` | `"copy sig"` | `"Copy signature"` |
| `dcp.inspector-edit` | `"edit"` | `"Edit"` |
| `dcp.inspector-view-source` | `"View Source"` | `"View source"` |
| `dcp.inspector-apply-patch` | `"Apply Patch"` | `"Apply changes"` |
| `dcp.inspector-resolving` | `"Resolving..."` | `"Fetching…"` |
| `dcp.inspector-compiling` | `"Compiling..."` | `"Building…"` |
| `dcp.inspector-location` | `"location"` | `"Location"` |
| `dcp.inspector-command` | `"command"` | `"Command"` |
| `dcp.inspector-listens` | `"listens"` | `"Listens for"` |
| `dcp.inspector-emits` | `"emits"` | `"Emits"` |
| `dcp.inspector-effects` | `"effects"` | `"Effects"` |
| `dcp.inspector-deps` | `"deps"` | `"Depends on"` |
| `dcp.inspector-links` | `"links"` | `"Links"` |
| `dcp.editor-commit-locked` | `"Commit 🔒"` | `"Commit"` — **the emoji is dropped entirely.** The lock state is already available as `lockConfigured()`; render a stroked padlock SVG beside the label (§6.22). This is the one colour emoji that survived the purge, in a design system whose own source comment says it removed OS colour emoji for clashing with the cold chrome. |
| `dcp.editor-ai-placeholder` | `"Ask AI to make changes..."` | `"Ask AI to make changes…"` |
| `dcp.editor-working` | `"working..."` | **DELETE the string's use as a spinner.** Keep the key, value `"Working…"`, for screen readers only; the visible indicator is the `dcp-travel` line (hook 36). |
| `dcp.editor-modified` | `"modified"` | `"Modified"` |
| `dcp.editor-loading-files` | `"Loading files..."` | `"Loading files…"` |
| `dcp.editor-empty` | `"No bees or dependencies in this layer."` | `"Nothing to edit in this layer yet."` |
| `dcp.editor-files-changed.one` | *(new key)* | `"1 file changed"` |
| `dcp.editor-files-changed.other` | *(new key)* | `"{count} files changed"` |
| `dcp.filter-placeholder` | `"Filter or [select]..."` | `"Filter, or [select]…"` |

Unchanged keys (no edit needed): `dcp.install`, `dcp.scope`, `dcp.scope-tiles`, `dcp.scope-features`, `dcp.scope-tiles-hint`, `dcp.scope-features-hint`, `dcp.toast-pushed-title`, `dcp.toast-dismiss`, `dcp.download-package`, `dcp.allow`, `dcp.cancel`, `dcp.version-name`, `dcp.overwrite`, `dcp.adopt`, `dcp.save`, `dcp.discard`, `dcp.adopt-state`, `dcp.orientation-dismiss`, `dcp.collapse-layers`, `dcp.expand-layers`, `dcp.filter-bee`, `dcp.filter-worker`, `dcp.filter-dependency`, `dcp.domain-hide`, `dcp.domain-show`, `dcp.logical-show`, `dcp.logical-hide`, `dcp.relay-title`, `dcp.relay-check`, `dcp.relay-download`, `dcp.relay-copy-command`, `dcp.relay-copied`, `dcp.relay-placeholder`, `dcp.relay-install-locally`, `dcp.relay-name`, `dcp.relay-version`, `dcp.relay-nips`, `dcp.relay-auth`, `dcp.trust-title`, `dcp.trust-url-placeholder`, `dcp.trust-label-placeholder`, `dcp.trust-add`, `dcp.trust-remove`, `dcp.trust-threshold`, `dcp.inspector-back`, `dcp.inspector-cancel`, `dcp.editor-back`, `dcp.editor-discard`, `dcp.editor-commit`, `dcp.editor-committing`, `dcp.upgrade-new.one`, `dcp.upgrade-new.other`, `dcp.upgrade-optin-all`.

## 8.2 NEW KEYS for the ~20 hardcoded English literals

These three whole features are currently hardcoded English inside a template where everything else routes through `| t`, against a catalog that loads **fourteen** locales. **Move the strings before restyling the surfaces that carry them** — otherwise the newly redesigned revision rail, client strip and state chips become the only untranslated parts of the app, which is a visible regression that looks worse than what was replaced.

### 8.2.1 `home.component.html` — the revision history block (lines ~74–110)

| Location | Hardcoded literal | New key | English value |
|---|---|---|---|
| line 76 | `Revision history` | `dcp.version-history` | `"Version history"` |
| line 74 (aria-label) | `Revision history` | `dcp.version-history` | *(same key)* |
| line 83 | `Saving restore point…` | `dcp.restore-saving` | `"Saving restore point…"` |
| line 84 | `Restoring…` | `dcp.restore-restoring` | `"Restoring…"` |
| line 85 | `Updated` | `dcp.restore-saved` | `"Saved"` — **"Updated" did not answer the sentence it replaced** |
| line 86 | `Stopped safely` | `dcp.restore-error` | `"Stopped — nothing changed"` |
| line 94 | `current baseline` | `dcp.version-baseline` | `"Current baseline"` |
| line 106 | `current` | `dcp.version-current` | `"Current"` |

### 8.2.2 `home.component.html` — the client strip (lines ~118–131)

| Location | Hardcoded literal | New key | English value |
|---|---|---|---|
| line 119 | `Clients` | `dcp.clients` | `"Where this is installed"` |
| line 118 (aria-label) | `Clients` | `dcp.clients` | *(same key)* |
| line 128 | `Forget this client` | `dcp.client-forget` | `"Forget this install"` |

### 8.2.3 `home.component.html` — the adopt restore-point form (lines ~290–310)

| Location | Hardcoded literal | New key | English value |
|---|---|---|---|
| line 292 | `Restore point` | `dcp.restore-point` | `"Restore point"` |
| line 302 | `Saving…` | `dcp.saving` | `"Saving…"` |
| line 305 | `Cancel` | `dcp.cancel` | *(reuse the existing key)* |
| line 230 (aria-label) | *(hardcoded)* | `dcp.group-toggle` | `"Open this domain"` |

### 8.2.4 `tree-row.component.ts` — chips, buttons and tooltips (lines ~45–77)

| Hardcoded literal | New key | English value |
|---|---|---|
| `new` | `dcp.chip-new` | `"New"` |
| `active` | `dcp.chip-active` | `"Already on"` |
| `in install` | `dcp.chip-in-install` | `"Installed"` |
| `waiting for bytes` | `dcp.chip-undelivered` | `"Not downloaded"` |
| `waiting for trust` | `dcp.chip-untrusted` | `"Needs your OK"` |
| `Allow` | `dcp.allow` | *(reuse existing)* |
| `Retry` | `dcp.retry` | `"Retry"` |
| tooltip (undelivered) — `"Waiting for bytes — no endpoint has delivered this yet. Hatches when one serves it."` | `dcp.hatch-undelivered-hint` | `"Nobody has sent this yet. It will start working as soon as someone does."` |
| tooltip (untrusted) | `dcp.hatch-untrusted-hint` | `"Held back until it meets your safety bar — or you allow it here."` |

`"waiting for bytes"` exposes the storage layer to the end user; `"in install"` is not grammatical; the old tooltips packed three internal nouns (endpoint, delivered, serves) plus the unexplained hatch metaphor into one hover, and said something different from the chip beside them. The chip and its tooltip now agree.

### 8.2.5 The other thirteen locale files

For every key added or renamed above, add the key to `ja.json` **and** the twelve other locale files with the **English value as a placeholder**. A missing key falls back to the key string itself (`dcp-i18n.ts:83` returns `key` when unresolved), which would render `dcp.chip-new` on screen. An English placeholder is a translation debt; a raw key is a bug. Deleted keys (`dcp.spec-count`, `dcp.orientation-verbs`, `dcp.trust-sources`) must be removed from all fourteen files.

---

# 9. VERIFICATION, ORDER OF WORK, AND THE THINGS THAT WILL BITE

## 9.1 Order of work (six implementers in parallel)

The first two moves are **serialised** — nothing else may start until both land, because everything downstream assumes them.

| Wave | Who | What |
|---|---|---|
| **1 (blocking, one person)** | — | `src/styles.scss` in full: §1 tokens, §2.1/§2.4 type, §3.1 motion tokens, §3.2 keyframes, §3.5 reduced motion, §7 primitives, §1.5 code map, §4.16 rule. Plus `app/app.scss` (§6.3) and `src/index.html` (§6.2). |
| **2 (blocking, one person)** | — | The nine-sheet split (§5), the `@Component` edit (§5.1), and the dead-selector deletion (§5.3). **No new CSS is written in this wave** — it is a pure carve, byte-for-byte, preserving rule order. Verify the build is green before wave 3. |
| **3 (parallel)** | A | `home.masthead.scss` + `home.shell.scss` + the mark/specbar/client markup in `home.component.html` (§6.5.1, .2, .6, .8; §6.6; §6.7) |
| | B | `home.install.scss` + `home.orientation.scss` + `home.empty.scss` + the orientation/empty/segment markup (§6.5.3, .4, .5; §6.11; §6.12) |
| | C | `home.sections.scss` + `home.package.scss` + `home.revisions.scss` + `home.responsive.scss` (§6.8, §6.9, §6.10) |
| | D | `tree-row.component.ts`, `tree-view.component.ts`, `toggle.component.ts`, `diamond-icon.component.ts` (§6.13–§6.16) |
| | E | `bee-inspector`, `layer-editor`, `code-viewer`, `code-editor`, `patch-list`, `revision-list`, `sentinel` (§6.17, §6.21, §6.22, §6.23, §6.25) |
| | F | `relay-panel`, `auditor-settings`, `dcp-command-line`, `intent-inspector-pro` (§6.18, §6.19, §6.20, §6.24) |
| **4 (one person, after 3)** | — | The i18n pass (§8) across all fourteen locale files, plus the `| t` substitutions in `home.component.html` and `tree-row.component.ts`. Then the four audits in §9.3. |

**Cross-wave rule:** anyone in wave 3 who needs a new token, a new keyframe, or a new primitive **adds it to `styles.scss`**, never to their own sheet. A keyframe copy-pasted into a component sheet is component budget spent for nothing, because Angular does not rename keyframes and the global one was already callable by name.

## 9.2 Geometry mirrors that must not be missed

- **`.row-placeholder` height.** `tree-row.component.ts:~102` (base) and `:~226` (the 600 px block) each set a fixed placeholder height matching the row. If row height changes **at all**, mirror it in **both**, or the `IntersectionObserver` virtualisation jitters on scroll. The type scale in this spec was chosen to absorb into ink level and gap rather than height — the row should stay at 44 px. If it must grow, it goes to 46 px and both numbers change.
- **The sig column.** `74px → 96px` in the base `grid-template-columns` (§6.13.7). In the 600 px block the sig column is narrowed to 60 px and `.crumb`/`.desc`/`.chip.audit` are hidden — there, `display: none` the `.fp` fingerprint rather than widening.
- **`overflow: hidden` + radius** on `.domain-section` and `.adopt-control` (§1.4.1).

## 9.3 The four end-of-pass audits (mandatory, run them and report)

1. **`--dcp-ink-4` audit.** `grep -rn "\-\-dcp-ink-4" diamond-core-processor/src`. Every remaining hit must be an SVG stroke, a border, or a rail. **Zero text uses.** Its three current text uses (the install placeholder, the specbar, the tree-row crumb) all move to `--dcp-ink-3`. If the sweep misses one, an accessibility failure survives the overhaul with a new hex.
2. **Gold reserved-meaning audit.** `grep -rn "\-\-dcp-gold\|\-\-dcp-live" diamond-core-processor/src`. Expect **fewer than about ten** call sites: the brand spine, the adopt segment indicator, the toggle ON track + thumb, the version generation pill, the client version pill, the `logical` zone rail, the toast left rail, the waiting chip dot, the orientation Plate B check, the orientation Plate C thumb. **Anything else is a regression.** The `--dcp-gold-*` names are kept as a non-breaking bridge, and that convenience is exactly the leak vector — audit them by name.
3. **Uppercase audit.** `grep -rn "text-transform: *uppercase" diamond-core-processor/src`. Expect **exactly two** hits: `.specbar` and `.zone-name`. Anything else is a regression against §2.3.
4. **Ambient-motion audit.** `grep -rn "infinite" diamond-core-processor/src`. Expect **exactly three** hits: `.resolve-fill` (`dcp-travel`), `.mark.is-working .s` (`dcp-spine-run`), and the layer-editor AI bar's `dcp-travel`. Plus `.revision-state.is-restoring`'s `dcp-rewind`, which is bounded by a state that clears. **Nothing else may loop.** Then do the eyeball test: open a screen where nothing is loading and you are not doing anything. If you can see motion, that is a bug.

## 9.4 Hand-synced timers — the named-constant rule

Four CSS durations are hand-synced to TypeScript constants. **Every duration used in both places must be named in the commit message.** Retiming a keyframe without retiming its constant leaves a class hanging on a finished animation, or an element removed mid-animation.

| TS location | Constant | This spec's CSS | Action |
|---|---|---|---|
| `home.component.ts:~1611` | `setTimeout(…, 2200)` for `.just-adopted` | 480 ms composite | **DO NOT CHANGE THE TS** (CUT 3). The class lingers inert for ~1.7 s. Accept that a second adopt inside 2.2 s will not re-trigger. |
| `home.component.ts:1624` | toast 8 s | `dcp-drain 8000ms` | Keep both at 8000. The drain hairline **must** match, or the toast clears before its countdown finishes. |
| `home.component.ts:1920, 1971` | `revisionStatus` 4 s auto-clear | `dcp-seat-out 400ms … 3.55s` | Keep the 4 s. The settle-out fits inside it with 50 ms of margin. |
| `relay-panel.component.ts:443`, `bee-inspector` `sigCopied` | 2 s `copied()` | fixed-width crossfade + `dcp-tick 260ms` | Keep both at 2 s. The button must not resize (§3.3 hook 31). |

## 9.5 The five ways this fails, and the guardrail for each

1. **Over-radiusing.** The current design is zero-radius as a deliberate statement; swinging to 10–16 px everywhere reads as a generic 2020 SaaS dashboard, the exact opposite of a precision instrument. **Guardrail: §1.4.1's tiering table, with the tie-breaker — if a surface cannot say which tier it is, it is `sm`. Rows stay square.**
2. **Gold becoming a beige plastic slab.** Champagne is a warm colour on a cold ground; at large fill areas it reads cheap. **Guardrail: gold is never a large fill. It appears as a 1 px ring, a 4 px rail, a text ink, a ≤24 px pill, or a ≤1.75 px SVG stroke. The one gold slab in the app today (the install toast) becomes a frosted dark plate with a gold left rail.**
3. **The rail textures becoming wallpaper or moiré.** Five gradient patterns at 36 px will alias at 125 %/150 % Windows scaling, which is this target's default. **Guardrail: §4.5's pattern law — 1 px features at ≥6 px pitch, alpha 0.15–0.22, `default` gets no texture at all. Verify at 100 %, 125 % and 150 %. If one shimmers, flatten that zone and keep the rest.**
4. **The steel accent going cold and dead.** `#8fb4e8` is deliberately desaturated and can drift toward reading as disabled grey, particularly on the sliding segment indicator, which is a soft fill. **Guardrail: the indicator always carries BOTH a soft fill AND a 1 px `--dcp-accent-ring` inset, never fill alone; and the selected label stays at `--dcp-ink`, not ink-2.**
5. **The light theme silently rotting.** Light is opt-in and nobody will look at it. **Guardrail: flip `data-dcp-theme="light"` on `<html>` once per surface as you build it, not at the end.** Every token in §1.2 has a light counterpart in §1.3, and light's zone tints were converted from opaque hex to rgba specifically so the rail textures composite identically.

## 9.6 The fences (restated — violating any of these fails the work)

- **No new npm dependencies. No CDN fonts, no external stylesheets, no animation libraries.** Everything is self-contained CSS + inline SVG.
- **`app/core/` is off limits** except `dcp-i18n.ts`, which needs **no changes** (the copy lives in `hypercomb-shared/i18n/*.json`).
- **`home.component.ts`: only the `@Component` decorator.** No methods, no signals, no timers, no class renames.
- **Every selector referenced from a template survives.** Every i18n key survives or is explicitly listed in §8. Every `@Input`/`@Output`/selector name survives. Every `aria-*` attribute survives.
- **Both existing `@media (hover: none)` escape hatches survive** (`home.component.scss:881`, `tree-row.component.ts:181`), and every **new** hover-reveal gets one. The hover-reveal gesture now appears on four surfaces — that is four chances to strand a control on touch.
- **Private class fields use `#field`, never the `private` keyword.** ESM only. Standalone components. Angular signals.
- **Dark is the default and the priority.** Light must remain coherent, not an inversion.
- **Every non-essential animation collapses under `prefers-reduced-motion: reduce`** (§3.5), and the three that must be *absent* rather than instant are named there.

---

# 10. HIVE MIRROR OBLIGATION

Per project doctrine this creation owes a mirror pass — tiles per surface, a collection gathering them, pheromones marking what each is, and notes. The natural shape:

- **Collection:** `dcp-caliper` gathering one tile per surface in §6 (one tile per file, 1:1 with source resources).
- **Pheromones:** mark each tile for what it is — `visual:token-layer`, `visual:motion-system`, `visual:illustration`, `visual:primitive`, `visual:copy` — so render and behaviour resolve from the mark, not from code. Use the declared vocabulary; do not mint keywords on the fly.
- **Notes:** the explanation lives on the tile — each surface's *why*, not just its *what*.

**If no live bridge is available during the work, this must be queued in the same change** (`npm run mirror:queue -- add …`) naming what is owed and how to run it, and **the commit message must say so.** The mirror pass is additive (`note-add`), so it may be queued normally — but if any step is not safely re-runnable, queue it `--manual` or the 10-minute idle drain will land the same note twice. Shipping this with no mirror *and* no queue entry is the one thing that must not happen.

---

# 11. ONE-PAGE SUMMARY FOR THE IMPLEMENTER WHO READS NOTHING ELSE

1. **`styles.scss` first, alone.** Radius `0px → 3/6/10/16 + pill`. Surfaces re-cast cool with a ~7 L hover step. Accent **splits**: steel `#8fb4e8` for everything you can touch, champagne `#e8c98a` for **live only**. `--dcp-accent-tint` stops being `#3a2c12` brown. `--dcp-border` gets defined (it was referenced and did not exist). `--dcp-ink-4` is redeclared non-text. Elevation becomes inset-highlight + wide ambient. All keyframes, all motion tokens, all five primitives, and the reduced-motion block live here at zero component budget.
2. **Split `home.component.scss` into nine sheets second**, byte-for-byte, before writing one line of new CSS. Delete the eight dead selectors.
3. **Delete `.name.bee/.worker/.drone/.dependency`.** That one deletion removes the largest area of gross colour in the app.
4. **Replace every `0.12s ease`** with `var(--dcp-t-state) var(--dcp-e-state)`. That alone makes the chrome feel like a different application.
5. **Delete `row-pending-pulse`, `pulse`, `resolve-sweep`'s ease-in-out, both `panelIn` copies, `section-just-adopted`, `install-toast-in`, and both italics.** Spend that budget on the toggle latch, the two sliding segment indicators, the section arrival, the install gate, the upgrade drain, the egg hatch, and the two takeovers.
6. **Nothing derives from mount** — rows are destroyed and recreated on scroll.
7. **Two uppercase roles survive. Nothing else is uppercase.**
8. **No sheen on the mark. No hex wallpaper. No TS retiming.**