# Authoring an Arkanoid scene theme

The Arkanoid game's whole **scene** (sky, scenery, atmosphere) is a pluggable slot.
A theme is a small module that supplies a palette and two painters; the renderer
delegates the entire backdrop to whichever theme is active and knows nothing else
about it. Swapping a theme never touches gameplay — it's a pure view change.

This is the project's plug-and-replace pattern: a **contract** + an **IoC-held
registry** + **self-registering modules**. The community authors a theme exactly the
way the built-ins do, and it appears in the in-game picker with zero edits to the game.

## The contract

```ts
interface ThemeBand {
  name: string
  neon: string;  neonRgb: string     // primary hue (hex) + the same as "r,g,b" for rgba() glows
  accent: string; accentRgb: string  // secondary hue
  sky: [string, string, string]      // gradient stops: [top, mid, bottom]
  mist: string                       // "r,g,b" used for soft hued washes
}

interface ThemeEnv {
  W: number; H: number               // canvas size in world units (554.4 × 600)
  time: number; pulse: number        // seconds clock + the shared 0..1 "breath" pulse
  band: ThemeBand; levelIndex: number
}

interface ArkanoidTheme {
  id: string                         // stable, unique (also the localStorage value)
  name: string                       // shown in the picker
  bands: ThemeBand[]                 // one band per 4 levels; the set cycles
  background(ctx: CanvasRenderingContext2D, env: ThemeEnv): void  // sky + scenery, drawn first
  atmosphere(ctx: CanvasRenderingContext2D, env: ThemeEnv): void  // ambient drifters/glows, over the field
}
```

Rules that keep a theme portable:

- **Paint only from `ctx` + `env`.** No renderer state, no globals beyond the canvas
  context. That's what lets any module supply a theme.
- **`background` runs before the bricks; `atmosphere` runs after the background** (and
  before the play field draws on top). Keep bright stuff out of the brick band (roughly
  `y` 56–248) and let the floor deepen so the **white hero ball stays readable**.
- **Save/restore your context.** If you change `globalCompositeOperation`,
  `shadowBlur`, `globalAlpha`, etc., wrap in `ctx.save()` / `ctx.restore()`.
- **Deterministic off `time`** — no per-frame `Math.random()`, so the scene is stable.
- A shared helper `darkenHex(hex, k=0.45)` is exported from `theme.ts` for gradient edges.

## Registering

The registry lives in IoC under the key `@diamondcoreprocessor.com/ArkanoidThemes`.

**Built-in (same bundle as the game)** — import the singleton directly:

```ts
import { arkanoidThemes } from '../theme.js'
arkanoidThemes.register(myTheme)
```

**Decoupled / external module (recommended for community themes)** — import only the
*type* and resolve the registry through IoC, so the module depends on nothing but the
public key. `whenReady` handles load order (the registry may load before or after you):

```ts
import type { ArkanoidTheme, ThemeRegistry } from '<path>/theme.js'   // erased at runtime

const myTheme: ArkanoidTheme = { id: 'my-theme', name: 'My Theme', bands: [...],
  background(ctx, env) { /* ... */ },
  atmosphere(ctx, env) { /* ... */ } }

window.ioc.whenReady<ThemeRegistry>('@diamondcoreprocessor.com/ArkanoidThemes',
  reg => reg.register(myTheme))
```

The registry fires a `change` event on every registration, so the picker repopulates
automatically when your module loads. The active pick is **participant-local**
(`localStorage['ark:theme']`) — never written to the layer, so it can't skew a
content signature.

See `themes/neon-grid.ts` for the decoupled pattern end-to-end, and
`themes/space-madness.ts` / `themes/haunted-keep.ts` for the built-in form.

## Shipping a theme as its own module

Because a theme needs nothing from the game at runtime but the registry key, it ships
as a normal self-registering module — the same delivery path as any drone/bee:

1. Author the module using the **decoupled** form above (`import type` + `whenReady`).
2. Build it into the signed module set (`npm run build:essentials` bundles
   self-registering modules into `dist/__bees__/` with a `manifest.json`).
3. At runtime the web shell installs it into OPFS and the `ScriptPreloader` imports it;
   the module's top-level `whenReady(...).register(...)` runs and the theme appears in
   the picker. **No edits to the Arkanoid game are required.**

## Originality note

Themes should be **original work**. Draw inspiration from a style or era, but do not
reproduce copyrighted characters, logos, or assets. (The built-in "Space Madness" skin
is an original cartoon — its horse is our own character, not any existing one.)

## The same pattern elsewhere

`contract + IoC registry + self-registering modules + participant-local active pick`
is the reusable shape. The other arcade games (Bubble, Solomon) can expose their scenes
the same way, and the contract here can grow optional hooks (bricks, paddle, ball) so a
theme can restyle the play pieces too — without changing the registry or the renderer
wiring.
