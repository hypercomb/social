// diamondcoreprocessor.com/games/arkanoid/themes/neon-grid.ts
//
// "Neon Grid" — an 80s synthwave skin, AND the worked example of a FULLY DECOUPLED
// community theme. Unlike the built-ins (which import the registry singleton because
// they're in the same bundle), this module resolves the registry purely through IoC
// at runtime and imports ONLY the contract TYPE from the game — `import type` is
// erased, so at runtime it depends on nothing but the public registry key. That's
// exactly how a theme shipped as its own signed module/bee registers: drop it in, it
// finds the registry and appears in the picker, with zero edits to the game.

import type { ArkanoidTheme, ThemeBand, ThemeEnv, ThemeRegistry } from '../theme.js'

const THEMES_KEY = '@diamondcoreprocessor.com/ArkanoidThemes'

// Synthwave palettes. `neon` paints the perspective grid + glow; `accent` is the
// retro sun; skies run deep-purple → hot horizon (bright enough to read the bricks,
// dark grid floor below so the white ball still pops).
const BANDS: ThemeBand[] = [
  { name: 'MIAMI SUNSET',  neon: '#ff2fb9', neonRgb: '255,47,185',  accent: '#ffcf3a', accentRgb: '255,207,58', sky: ['#241068', '#7a1f8f', '#ff5b6e'], mist: '255,47,185'  },
  { name: 'ELECTRIC TEAL', neon: '#2ff0ff', neonRgb: '47,240,255',  accent: '#ff2fb9', accentRgb: '255,47,185', sky: ['#08203f', '#15618f', '#2ff0d0'], mist: '47,240,255'  },
  { name: 'VIOLET DRIVE',  neon: '#b96fff', neonRgb: '185,111,255', accent: '#ffcf3a', accentRgb: '255,207,58', sky: ['#160a36', '#52268a', '#ff8fdf'], mist: '185,111,255' },
]

const HORIZON = 0.52   // fraction of H where the grid floor meets the sky

/** The retro sun: a glowing accent disc with horizontal cut slits in its lower half,
 *  centred on the horizon (it sits BEHIND the bricks, peeking around the field). */
function retroSun(ctx: CanvasRenderingContext2D, band: ThemeBand, W: number, H: number, pulse: number): void {
  const cx = W / 2, cy = H * HORIZON - 6, r = 56 + 3 * pulse
  ctx.save()
  ctx.shadowColor = band.accent; ctx.shadowBlur = 26
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r)
  g.addColorStop(0, '#fff7c8'); g.addColorStop(0.45, band.accent); g.addColorStop(1, band.neon)
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
  ctx.shadowBlur = 0
  // horizontal slits across the lower half (classic synthwave sun)
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip()
  ctx.fillStyle = band.sky[1]
  for (let i = 1; i <= 6; i++) { const y = cy + (i / 7) * r; ctx.fillRect(cx - r, y, r * 2, (i / 7) * 3 + 1) }
  ctx.restore()
  ctx.restore()
}

/** The neon perspective grid floor: verticals fanning from the vanishing point + a
 *  set of horizontal rows that bunch toward the horizon and scroll toward the viewer. */
function perspectiveGrid(ctx: CanvasRenderingContext2D, band: ThemeBand, W: number, H: number, time: number): void {
  const hy = H * HORIZON
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = `rgba(${band.neonRgb},0.55)`; ctx.lineWidth = 1.4
  ctx.shadowColor = band.neon; ctx.shadowBlur = 6
  // verticals: from the vanishing point (centre of the horizon) down to the bottom edge
  for (let i = -7; i <= 7; i++) {
    ctx.beginPath(); ctx.moveTo(W / 2, hy); ctx.lineTo(W / 2 + i * (W / 7), H); ctx.stroke()
  }
  // horizontals: rows receding into the distance, scrolling forward on time
  const N = 12, scroll = (time * 0.35) % 1
  for (let k = 0; k <= N; k++) {
    const d = (k + scroll) / N                  // 0 at horizon → 1 at the viewer
    const y = hy + (H - hy) * d * d              // squared → bunch near the horizon
    ctx.globalAlpha = 0.25 + 0.6 * d
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
  }
  ctx.restore()
}

export const neonGrid: ArkanoidTheme = {
  id: 'neon-grid',
  name: 'Neon Grid',
  bands: BANDS,

  background(ctx: CanvasRenderingContext2D, env: ThemeEnv): void {
    const { W, H, time, pulse, band } = env
    const sky = ctx.createLinearGradient(0, 0, 0, H * HORIZON)     // deep-purple → hot horizon
    sky.addColorStop(0, band.sky[0]); sky.addColorStop(0.7, band.sky[1]); sky.addColorStop(1, band.sky[2])
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H * HORIZON)
    ctx.fillStyle = '#0a0618'; ctx.fillRect(0, H * HORIZON, W, H * (1 - HORIZON))   // dark grid-floor base
    retroSun(ctx, band, W, H, pulse)
    perspectiveGrid(ctx, band, W, H, time)
    const hl = ctx.createLinearGradient(0, H * HORIZON - 24, 0, H * HORIZON + 8)    // bright horizon haze
    hl.addColorStop(0, `rgba(${band.mist},0)`); hl.addColorStop(1, `rgba(${band.mist},0.5)`)
    ctx.fillStyle = hl; ctx.fillRect(0, H * HORIZON - 24, W, 32)
  },

  atmosphere(ctx: CanvasRenderingContext2D, env: ThemeEnv): void {
    const { W, H, time, band } = env
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'                       // a few drifting neon embers
    for (let i = 0; i < 7; i++) {
      const x = (i * 83.3 + Math.sin(time * 0.6 + i) * 30) % W
      const y = H - ((time * (18 + i * 4) + i * 90) % (H + 40))
      const a = 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(time * 2 + i))
      ctx.fillStyle = `rgba(${i % 2 ? band.neonRgb : band.accentRgb},${a})`
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = 'rgba(0,0,0,0.06)'                             // faint CRT scanlines
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1)
    ctx.restore()
  },
}

// Decoupled registration: wait for the registry to exist in IoC (it may load before
// OR after this module), then register. No import of the game's singleton — this is
// the pattern an externally-shipped theme module/bee uses verbatim.
window.ioc.whenReady<ThemeRegistry>(THEMES_KEY, reg => reg.register(neonGrid))
