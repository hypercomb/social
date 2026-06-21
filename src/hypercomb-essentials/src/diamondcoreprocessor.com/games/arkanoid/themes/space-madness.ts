// diamondcoreprocessor.com/games/arkanoid/themes/space-madness.ts
//
// A bright rubber-hose cartoon cosmos — the "Space Madness" theme. A drop-in
// ArkanoidTheme: bright space bands + a starfield/planet background and ambient
// saucer, twinkles, and a goofy cartoon horse drifting by. Self-registers into the
// shared registry, so authoring a new theme is: copy this file, swap the paint.

import { type ArkanoidTheme, type ThemeBand, type ThemeEnv, darkenHex, arkanoidThemes } from '../theme.js'

// Twinkle tints for the starfield (the hero ball stays the only PURE white in play).
const STAR_TINTS = ['#ffffff', '#fff3b0', '#bfe3ff', '#ffd0f0', '#d7ffe0']

// Skies stay saturated mid-tones that DEEPEN toward the floor so the white ball pops.
const BANDS: ThemeBand[] = [
  { name: 'COBALT NEBULA',       neon: '#3df0ff', neonRgb: '61,240,255',  accent: '#ff5bd0', accentRgb: '255,91,208', sky: ['#3a78ff', '#244bb8', '#0e1c47'], mist: '61,240,255'  },
  { name: 'BUBBLEGUM VOID',      neon: '#ff7ae0', neonRgb: '255,122,224', accent: '#9bff5b', accentRgb: '155,255,91', sky: ['#ff6fd0', '#9a3fc8', '#2a1452'], mist: '255,122,224' },
  { name: 'SPACE-MADNESS GREEN', neon: '#6dff8f', neonRgb: '109,255,143', accent: '#ff5bd0', accentRgb: '255,91,208', sky: ['#4bf08a', '#1f9e63', '#0a3438'], mist: '109,255,143' },
  { name: 'TANGERINE COSMOS',    neon: '#ffd24a', neonRgb: '255,210,74',  accent: '#3df0ff', accentRgb: '61,240,255', sky: ['#ff9f43', '#d8542a', '#421634'], mist: '255,178,58'  },
]

/** A big bug-eyed cartoon planet with a tilted ring and a comic highlight, in the
 *  band's accent hue so it changes as you sail between palettes. */
function planet(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, band: ThemeBand): void {
  ctx.save()
  ctx.shadowColor = band.accent; ctx.shadowBlur = 22
  const body = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.2, cx, cy, r)
  body.addColorStop(0, '#ffffff'); body.addColorStop(0.4, band.accent); body.addColorStop(1, darkenHex(band.accent))
  ctx.fillStyle = body
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
  ctx.shadowBlur = 0
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip()    // cartoon bands across it
  ctx.globalAlpha = 0.22; ctx.fillStyle = '#06040c'
  ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.25, r * 1.1, r * 0.16, 0, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.ellipse(cx, cy - r * 0.32, r * 1.1, r * 0.11, 0, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
  ctx.translate(cx, cy); ctx.rotate(-0.42)                                        // a tilted ring
  ctx.strokeStyle = `rgba(${band.neonRgb},0.85)`; ctx.lineWidth = 3.2; ctx.shadowColor = band.neon; ctx.shadowBlur = 8
  ctx.beginPath(); ctx.ellipse(0, 0, r * 1.7, r * 0.5, 0, 0, Math.PI * 2); ctx.stroke()
  ctx.restore()
}

/** The planet surface arc bowing up across the bottom: a bright cartoon horizon with
 *  a rim-light and a few craters. */
function planetSurface(ctx: CanvasRenderingContext2D, band: ThemeBand, W: number, H: number): void {
  ctx.save()
  const cx = W / 2, top = H * 0.86, cR = W * 1.15
  const cy = top + cR - (H - top)                            // centre below screen so only the cap shows
  ctx.beginPath(); ctx.arc(cx, cy, cR, Math.PI * 1.0, Math.PI * 2.0); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath()
  const g = ctx.createLinearGradient(0, top - 20, 0, H)
  g.addColorStop(0, band.accent); g.addColorStop(1, darkenHex(band.accent))
  ctx.fillStyle = g; ctx.fill()
  ctx.beginPath(); ctx.arc(cx, cy, cR, Math.PI * 1.0, Math.PI * 2.0)              // bright rim-light
  ctx.strokeStyle = `rgba(${band.neonRgb},0.9)`; ctx.lineWidth = 2.5; ctx.shadowColor = band.neon; ctx.shadowBlur = 10; ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fillStyle = 'rgba(6,4,12,0.22)'                                            // a few craters
  for (const [fx, fr] of [[0.22, 9], [0.5, 6], [0.72, 11], [0.88, 7]] as [number, number][]) {
    const px = W * fx, py = top + 10 + Math.sin(fx * 9) * 4
    ctx.beginPath(); ctx.ellipse(px, py, fr, fr * 0.5, 0, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

/** A small twinkle: a soft hued glow with a crisp white four-point sparkle cross. */
function starSpark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, hue: string, tw: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.6)
  g.addColorStop(0, `rgba(${hue},${0.6 * tw})`); g.addColorStop(0.4, `rgba(${hue},${0.22 * tw})`); g.addColorStop(1, `rgba(${hue},0)`)
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = `rgba(255,255,255,${0.6 * tw})`; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke()
}

/** A classic cartoon flying saucer: glass dome + chrome disc + blinking belly lights
 *  and a faint tractor-glow, tinted to the band's neon hue. */
function saucer(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, time: number, band: ThemeBand): void {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s)
  ctx.globalCompositeOperation = 'lighter'                   // tractor-beam underglow
  const beam = ctx.createRadialGradient(0, 6, 1, 0, 6, 22)
  beam.addColorStop(0, `rgba(${band.neonRgb},0.32)`); beam.addColorStop(1, `rgba(${band.neonRgb},0)`)
  ctx.fillStyle = beam; ctx.beginPath(); ctx.arc(0, 6, 22, 0, Math.PI * 2); ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
  const disc = ctx.createLinearGradient(0, -4, 0, 8)         // chrome disc body
  disc.addColorStop(0, '#e8eefc'); disc.addColorStop(1, '#8c9bbf')
  ctx.fillStyle = disc; ctx.strokeStyle = '#3a4768'; ctx.lineWidth = 1.4
  ctx.beginPath(); ctx.ellipse(0, 3, 20, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  const dome = ctx.createLinearGradient(0, -12, 0, 2)        // glass dome
  dome.addColorStop(0, '#bff0ff'); dome.addColorStop(1, '#5fb0d8')
  ctx.fillStyle = dome; ctx.beginPath(); ctx.ellipse(0, 0, 10, 11, 0, Math.PI, Math.PI * 2); ctx.fill(); ctx.stroke()
  for (let i = -2; i <= 2; i++) {                            // blinking belly lights
    const on = (Math.floor(time * 3) + i) % 2 === 0
    ctx.fillStyle = on ? band.neon : 'rgba(255,255,255,0.25)'
    ctx.beginPath(); ctx.arc(i * 7, 6, 1.5, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

/** An original goofy bug-eyed cartoon horse tumbling weightlessly through space —
 *  drawn at (x,y), scaled by s, slowly rotating. */
function spaceHorse(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number, time: number): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s)
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  const sway = Math.sin(time * 2) * 1.5
  const TAN = '#d8b074', EDGE = '#a07a44', HAIR = '#7a5230'
  ctx.strokeStyle = HAIR; ctx.lineWidth = 5                  // tail
  ctx.beginPath(); ctx.moveTo(-16, 0)
  ctx.quadraticCurveTo(-27, -2 + sway, -25, 10 - sway)
  ctx.quadraticCurveTo(-24, 16, -29, 18 + sway); ctx.stroke()
  ctx.strokeStyle = TAN; ctx.lineWidth = 6                   // four stubby legs + hooves
  const legs: [number, number][] = [[-10, sway], [-3, -sway], [6, sway * 0.6], [12, -sway * 0.6]]
  for (const [lx, sw] of legs) {
    ctx.beginPath(); ctx.moveTo(lx, 9); ctx.lineTo(lx + sw, 20); ctx.stroke()
    ctx.fillStyle = '#4a3520'; ctx.beginPath(); ctx.ellipse(lx + sw, 21, 2.6, 2, 0, 0, Math.PI * 2); ctx.fill()
  }
  ctx.fillStyle = TAN; ctx.strokeStyle = EDGE; ctx.lineWidth = 1.5    // body + belly
  ctx.beginPath(); ctx.ellipse(0, 2, 18, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.fillStyle = 'rgba(255,244,220,0.5)'; ctx.beginPath(); ctx.ellipse(-3, 6, 11, 6, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = TAN; ctx.strokeStyle = EDGE; ctx.lineWidth = 1.5    // neck + head + muzzle
  ctx.beginPath(); ctx.moveTo(10, -6); ctx.quadraticCurveTo(20, -14, 24, -16); ctx.lineTo(28, -8); ctx.quadraticCurveTo(20, -2, 14, 4); ctx.closePath(); ctx.fill(); ctx.stroke()
  ctx.beginPath(); ctx.ellipse(28, -14, 11, 8, -0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.beginPath(); ctx.ellipse(35, -8, 7, 5, -0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.fillStyle = HAIR                                                 // mane tufts
  for (const [mx, my] of [[24, -18], [19, -12], [13, -7], [6, -4]] as [number, number][]) {
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx - 6, my - 4); ctx.lineTo(mx - 4, my + 3); ctx.closePath(); ctx.fill()
  }
  ctx.fillStyle = TAN; ctx.strokeStyle = EDGE                          // ears
  for (const ex of [22, 27]) { ctx.beginPath(); ctx.moveTo(ex, -22); ctx.lineTo(ex + 2, -30); ctx.lineTo(ex + 5, -22); ctx.closePath(); ctx.fill(); ctx.stroke() }
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(28, -16, 5, 0, Math.PI * 2); ctx.fill()   // big googly eye
  ctx.strokeStyle = '#4a3520'; ctx.lineWidth = 1; ctx.stroke()
  const look = Math.sin(time * 1.3) * 1.5
  ctx.fillStyle = '#1a1208'; ctx.beginPath(); ctx.arc(29 + look, -15, 2.2, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#b5687e'; ctx.beginPath(); ctx.ellipse(39, -9, 1.4, 2, 0, 0, Math.PI * 2); ctx.fill()    // nostril + grin
  ctx.strokeStyle = '#5a3a22'; ctx.lineWidth = 1.4
  ctx.beginPath(); ctx.moveTo(33, -3); ctx.quadraticCurveTo(37, 0, 40, -4); ctx.stroke()
  ctx.restore()
}

export const spaceMadness: ArkanoidTheme = {
  id: 'space-madness',
  name: 'Space Madness',
  bands: BANDS,

  background(ctx: CanvasRenderingContext2D, env: ThemeEnv): void {
    const { W, H, time, pulse, band } = env
    const g = ctx.createLinearGradient(0, 0, 0, H)            // 1 ── bright cosmic gradient
    g.addColorStop(0, band.sky[0]); g.addColorStop(0.55, band.sky[1]); g.addColorStop(1, band.sky[2])
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    const lit = 0.18 + 0.10 * pulse                          // 2 ── warm sun-glow from the top-left
    const sun = ctx.createRadialGradient(W * 0.16, -30, 10, W * 0.16, -30, H * 0.9)
    sun.addColorStop(0, `rgba(255,244,200,${lit})`); sun.addColorStop(0.5, `rgba(${band.mist},${lit * 0.5})`); sun.addColorStop(1, `rgba(${band.mist},0)`)
    ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H)
    for (let i = 0; i < 70; i++) {                            // 3 ── twinkling starfield
      const sx = ((i * 139.7) % W), sy = ((i * 71.3) % (H * 0.82))
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 2.4 + i * 1.7))
      const r = (i % 7 === 0 ? 1.7 : 1.0) * (0.7 + 0.6 * tw)
      ctx.globalAlpha = 0.5 + 0.5 * tw
      ctx.fillStyle = STAR_TINTS[i % STAR_TINTS.length]
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
    planet(ctx, W * 0.80, H * 0.16, 30, band)                // 4 ── goofy ringed planet
    planetSurface(ctx, band, W, H)                           // 5 ── cartoon planet horizon
    const vg = ctx.createRadialGradient(W / 2, H * 0.46, H * 0.34, W / 2, H * 0.5, H * 0.9)   // 6 ── soft vignette
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(8,6,24,0.34)')
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H)
  },

  atmosphere(ctx: CanvasRenderingContext2D, env: ThemeEnv): void {
    const { W, H, time, pulse, band } = env
    ctx.save()
    const cyc = (time % 9) / 9                                // 1 ── shooting star (~9s cycle)
    if (cyc < 0.06) {
      const p = cyc / 0.06
      const sx = W * 0.12 + p * W * 0.78, sy = H * 0.1 + p * H * 0.16
      ctx.globalCompositeOperation = 'lighter'
      const tg = ctx.createLinearGradient(sx - 64, sy - 24, sx, sy)
      tg.addColorStop(0, 'rgba(255,255,255,0)'); tg.addColorStop(1, 'rgba(255,255,255,0.9)')
      ctx.strokeStyle = tg; ctx.lineWidth = 2.4; ctx.shadowColor = '#fff'; ctx.shadowBlur = 10
      ctx.beginPath(); ctx.moveTo(sx - 64, sy - 24); ctx.lineTo(sx, sy); ctx.stroke()
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, sy, 2.4, 0, Math.PI * 2); ctx.fill()
      ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0
    }
    const ux = ((time * 30) % (W + 160)) - 80                 // 2 ── puttering flying saucer
    saucer(ctx, ux, H * 0.2 + Math.sin(time * 1.1) * 10, 0.9, time, band)
    ctx.globalCompositeOperation = 'lighter'                  // 3 ── floating star-sparkles
    for (let i = 0; i < 6; i++) {
      const wx = W * (0.08 + 0.16 * i) + Math.sin(time * 0.5 + i * 1.7) * 26
      const wy = H - ((time * (14 + i * 3) + i * 130) % (H + 60))
      const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * 3 + i + pulse))
      starSpark(ctx, wx, wy, 2.2 + 1.8 * tw, i % 3 === 0 ? band.accentRgb : band.neonRgb, tw)
    }
    ctx.globalCompositeOperation = 'source-over'
    const hcyc = (time % 17) / 17                             // 4 ── the goofy cartoon horse tumbling by
    spaceHorse(ctx, -90 + hcyc * (W + 180), H * 0.34 + Math.sin(time * 0.8) * 22, 0.92, time * 0.5, time)
    const cand = 0.05 + 0.05 * pulse                          // 5 ── soft warm sun wash
    const cg = ctx.createRadialGradient(W * 0.16, -30, H * 0.1, W * 0.16, -30, H * 0.8)
    cg.addColorStop(0, `rgba(255,244,200,${cand})`); cg.addColorStop(1, 'rgba(255,244,200,0)')
    ctx.fillStyle = cg; ctx.fillRect(0, 0, W, H)
    ctx.restore()
  },
}

arkanoidThemes.register(spaceMadness)
