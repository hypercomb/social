// diamondcoreprocessor.com/games/arkanoid/themes/haunted-keep.ts
//
// The original dark gothic look — neon cores over a castle keep deep in the night —
// rebuilt as a drop-in ArkanoidTheme. Kept around both because it's a striking
// alternate skin AND as the worked example of a second theme: the registry swaps it
// for Space Madness (or any community theme) with zero gameplay change.

import { type ArkanoidTheme, type ThemeBand, type ThemeEnv, arkanoidThemes } from '../theme.js'

// One floor palette per ascent band; the keep climbs (green crypts → violet halls →
// crimson belfry → gold spire) then cycles.
const BANDS: ThemeBand[] = [
  { name: 'THE GREEN CRYPTS',   neon: '#39FF6A', neonRgb: '57,255,106',  accent: '#B65CFF', accentRgb: '182,92,255', sky: ['#0A0814', '#08110C', '#05070F'], mist: '57,255,106'  },
  { name: 'THE VIOLET HALLS',   neon: '#B65CFF', neonRgb: '182,92,255',  accent: '#39FF6A', accentRgb: '57,255,106', sky: ['#120A22', '#0C0818', '#05060F'], mist: '122,60,255' },
  { name: 'THE CRIMSON BELFRY', neon: '#FF3A6E', neonRgb: '255,58,110',  accent: '#FFB23A', accentRgb: '255,178,58', sky: ['#1A0814', '#12060E', '#08040A'], mist: '255,58,110' },
  { name: 'THE GOLDEN SPIRE',   neon: '#FFB23A', neonRgb: '255,178,58',  accent: '#B65CFF', accentRgb: '182,92,255', sky: ['#170F08', '#100A14', '#06060F'], mist: '255,178,58' },
]

/** The keep's flat castle silhouette across the bottom third: a battlement ridge with
 *  two crenellated towers, near-black with a 1px neon rim + lit windows. */
function keepSilhouette(ctx: CanvasRenderingContext2D, band: ThemeBand, W: number, H: number): void {
  const base = H * 0.86, ridge = H * 0.78
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(0, H); ctx.lineTo(0, ridge)
  const merlon = 18
  for (let x = 0, i = 0; x <= W; x += merlon, i++) {
    const up = i % 2 === 0 ? 0 : 7
    ctx.lineTo(x, ridge - up); ctx.lineTo(x + merlon, ridge - up)
  }
  for (const tx of [W * 0.18, W * 0.74]) {
    const tw = 46, ty = H * 0.58
    ctx.lineTo(tx - tw / 2, ridge); ctx.lineTo(tx - tw / 2, ty)
    for (let x = tx - tw / 2, j = 0; x < tx + tw / 2; x += 11, j++) { const up = j % 2 ? 0 : 6; ctx.lineTo(x, ty - up); ctx.lineTo(x + 11, ty - up) }
    ctx.lineTo(tx + tw / 2, ty); ctx.lineTo(tx + tw / 2, ridge)
  }
  ctx.lineTo(W, ridge); ctx.lineTo(W, H); ctx.closePath()
  ctx.fillStyle = '#05040A'; ctx.fill()
  ctx.lineWidth = 1; ctx.strokeStyle = `rgba(${band.neonRgb},0.30)`; ctx.shadowColor = band.neon; ctx.shadowBlur = 6; ctx.stroke()
  ctx.shadowBlur = 8; ctx.shadowColor = band.accent
  ctx.fillStyle = `rgba(${band.accentRgb},0.8)`
  for (const wx of [W * 0.18, W * 0.74]) { ctx.fillRect(wx - 3, base - 60, 6, 9); ctx.fillRect(wx - 3, base - 40, 6, 9) }
  ctx.restore()
}

/** One bat silhouette: a two-arc winged body; flap (-1..1) raises/drops the tips. */
function bat(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, flap: number, band: ThemeBand): void {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s)
  ctx.fillStyle = '#040308'; ctx.strokeStyle = `rgba(${band.neonRgb},0.22)`; ctx.lineWidth = 0.6
  const lift = flap * 6
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.quadraticCurveTo(-7, -4 - lift, -16, -1 - lift * 0.4)
  ctx.quadraticCurveTo(-10, 1, -5, 3)
  ctx.lineTo(0, 1)
  ctx.lineTo(5, 3)
  ctx.quadraticCurveTo(10, 1, 16, -1 - lift * 0.4)
  ctx.quadraticCurveTo(7, -4 - lift, 0, 0)
  ctx.closePath(); ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#040308'; ctx.beginPath(); ctx.ellipse(0, 0, 2, 3, 0, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

export const hauntedKeep: ArkanoidTheme = {
  id: 'haunted-keep',
  name: 'Haunted Keep',
  bands: BANDS,

  background(ctx: CanvasRenderingContext2D, env: ThemeEnv): void {
    const { W, H, time, pulse, band } = env
    const g = ctx.createLinearGradient(0, 0, 0, H)            // 1 ── deep-night gradient
    g.addColorStop(0, band.sky[0]); g.addColorStop(0.55, band.sky[1]); g.addColorStop(1, band.sky[2])
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    const mx = W * 0.78, my = H * 0.12, mr = 26                // 2 ── bone-white moon, top-right
    const moon = ctx.createRadialGradient(mx, my, 2, mx, my, mr * 3.2)
    moon.addColorStop(0, 'rgba(232,224,255,0.30)'); moon.addColorStop(0.18, 'rgba(232,224,255,0.10)'); moon.addColorStop(1, 'rgba(232,224,255,0)')
    ctx.fillStyle = moon; ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(232,224,255,0.92)'; ctx.shadowColor = 'rgba(232,224,255,0.6)'; ctx.shadowBlur = 22
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
    const lit = 0.10 + 0.07 * pulse                           // 3 ── candle stage-light in the band hue
    const glow = ctx.createRadialGradient(W / 2, -40, 20, W / 2, -40, H)
    glow.addColorStop(0, `rgba(${band.mist},${lit})`); glow.addColorStop(1, `rgba(${band.mist},0)`)
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H)
    keepSilhouette(ctx, band, W, H)                           // 4 ── the keep
    ctx.fillStyle = `rgba(${band.neonRgb},0.05)`              // 5 ── faint neon dust motes drifting up
    let row = 0
    for (let yy = 26; yy < H; yy += 38, row++) {
      const drift = Math.sin(time * 0.2 + row) * 6
      for (let xx = (row % 2 ? 38 : 19); xx < W; xx += 38) {
        ctx.beginPath(); ctx.arc(xx + drift, yy - (time * 4 % 38), 0.9, 0, Math.PI * 2); ctx.fill()
      }
    }
    const vg = ctx.createRadialGradient(W / 2, H * 0.46, H * 0.30, W / 2, H * 0.5, H * 0.82)   // 6 ── deep-night vignette
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.58)')
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H)
  },

  atmosphere(ctx: CanvasRenderingContext2D, env: ThemeEnv): void {
    const { W, H, time, pulse, band } = env
    ctx.save()
    const cyc = (time % 14) / 14                              // 1 ── rare double-strike lightning
    const strike = cyc < 0.022 ? 1 : (cyc > 0.030 && cyc < 0.045) ? 0.7 : 0
    if (strike > 0) {
      ctx.fillStyle = `rgba(232,224,255,${0.22 * strike})`; ctx.fillRect(0, 0, W, H)
      const lx = W * (0.3 + 0.4 * ((Math.floor(time / 14) * 0.61803) % 1))
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = `rgba(255,255,255,${0.9 * strike})`; ctx.lineWidth = 2; ctx.shadowColor = '#E8E0FF'; ctx.shadowBlur = 16
      ctx.beginPath(); ctx.moveTo(lx, 0)
      for (let y = 0; y <= H * 0.5; y += 26) ctx.lineTo(lx + Math.sin(y * 0.13 + time) * 18, y)
      ctx.stroke(); ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0
    }
    const flap = Math.sin(time * 9)                           // 2 ── bats flapping across lanes
    for (let i = 0; i < 4; i++) {
      const lane = H * (0.14 + 0.13 * i)
      const bx = ((time * (38 + i * 9) + i * 260) % (W + 120)) - 60
      const by = lane + Math.sin(time * 1.4 + i) * 16
      bat(ctx, bx, by, 0.7 + 0.18 * i, flap * (i % 2 ? -1 : 1), band)
    }
    ctx.globalCompositeOperation = 'lighter'                  // 3 ── floating will-o-wisps
    for (let i = 0; i < 6; i++) {
      const wx = W * (0.08 + 0.16 * i) + Math.sin(time * 0.5 + i * 1.7) * 26
      const wy = H - ((time * (14 + i * 3) + i * 130) % (H + 60))
      const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * 3 + i + pulse))
      const hue = i % 3 === 0 ? band.accentRgb : band.neonRgb
      const r = 2.4 + 1.6 * tw
      const wg = ctx.createRadialGradient(wx, wy, 0, wx, wy, r * 3.2)
      wg.addColorStop(0, `rgba(${hue},${0.55 * tw})`); wg.addColorStop(0.4, `rgba(${hue},${0.22 * tw})`); wg.addColorStop(1, `rgba(${hue},0)`)
      ctx.fillStyle = wg; ctx.beginPath(); ctx.arc(wx, wy, r * 3.2, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = `rgba(232,224,255,${0.5 * tw})`; ctx.beginPath(); ctx.arc(wx, wy, 1, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
    const cand = 0.04 + 0.05 * pulse                          // 4 ── warm candle vignette
    const cg = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.2, W / 2, H * 0.55, H * 0.75)
    cg.addColorStop(0, `rgba(255,178,58,${cand})`); cg.addColorStop(1, 'rgba(255,178,58,0)')
    ctx.fillStyle = cg; ctx.fillRect(0, 0, W, H)
    ctx.restore()
  },
}

arkanoidThemes.register(hauntedKeep)
