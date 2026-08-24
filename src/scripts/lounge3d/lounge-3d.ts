// The Cigar Lounge — a three.js room for /revolucion/lounge.
//
// Bundled by intel-build-revolucion-site.ts (esbuild → IIFE) and stored as a
// sig-addressed hive resource; the page loads it with
// `<script src="resource:<sig>/lounge-3d.js">`. Everything it draws is built
// in code: geometry is composed from primitives, every texture is painted on
// a canvas at runtime. No fetching, no stock imagery, no external requests —
// the same rule the rest of the Revolución site follows.
//
// The page hands us a config on `window.REV_LOUNGE`:
//   { mount, fallback, art: { key: url } }   // art = the hive's own tile PNGs
// and drives us through `window.RevLounge3D`:
//   { setSlot(id, on), view(name), ready }
// Slot ids are shared with the SVG fallback scene, so one decorate list drives
// whichever renderer came up.
//
// Passive by doctrine: the room boots on idle (never on the boot path), pauses
// when scrolled out of view or the tab is hidden, and disposes itself the
// moment its canvas leaves the document — SiteViewDrone unmounts a page by
// dropping its nodes, and an orphaned animation loop would otherwise keep a
// WebGL context alive behind the hive's own canvas.

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { Reflector } from 'three/addons/objects/Reflector.js'
import {
  DART_NUMS, DART_RINGS, bedCentre, checkout, parseShot, pickShot, resolveThrow,
  scoreDart, type DartHit,
} from './darts-rules.js'
import {
  CALLS, FANS_BASE, FANS_MAX, MATCH_LEGS, QUIRKS, SIDE_BET_FACTOR,
  // `SMOKE` is taken in here — the room's cigar has a particle count by that
  // name — so the ring geometry comes in under the name the room uses for it.
  SMOKE as SMOKE_RING, SMOKE_CALLS, TALLY_STEP, applyFans, crowdMultiplier,
  dartCall, drawSideBet, legCall, quirkCalls, smokeCall, tallyFans, tallyOf,
  turnCall, type CallSpec,
} from './darts-house.js'
import { SLOT } from './store-items.js'

interface LoungeConfig {
  mount?: string
  fallback?: string
  controls?: string
  art?: Record<string, string | undefined>
}

declare global {
  interface Window {
    REV_LOUNGE?: LoungeConfig
    RevLounge3D?: {
      setSlot: (id: string, on: boolean) => void
      view: (name: string) => void
      /** The board's own state, and a dart put in without aiming — the
       *  harness's way into the game. */
      oche?: { state: () => Record<string, unknown>; throwAt: (x: number, y: number) => boolean }
      /** Force one frame. The animation loop is rAF-driven and rAF starves in
       *  an occluded window, so this is how a still gets taken (and how the
       *  room is verified) without a composited tab. */
      frame: () => void
      /** Current camera + orbit target, for tuning the presets above. */
      pose: () => { pos: number[]; target: number[] }
      ready: Promise<boolean>
    }
  }
}

// ─── palette (the site's chrome.css, in linear-friendly hex) ───────────────

const C = {
  wall: 0x241b2c,
  wallLow: 0x1c1424,
  ceiling: 0x150f1c,
  floor: 0x3a2417,
  wood: 0x3a2417,
  woodDark: 0x241610,
  leather: 0x4a2b21,
  leatherDark: 0x331d17,
  brass: 0xc8975a,
  brassBright: 0xe0b578,
  ember: 0xb3542f,
  cream: 0xf0e6d6,
  ink: 0x171017,
  green: 0x2f4a35,
} as const

const ROOM = { w: 11, h: 3.6, d: 9 } as const
const HALF_W = ROOM.w / 2
const HALF_D = ROOM.d / 2

// ─── canvas texture helpers ───────────────────────────────────────────────

function paint(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')
  if (ctx) draw(ctx, w, h)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

function tiled(t: THREE.CanvasTexture, rx: number, ry: number): THREE.CanvasTexture {
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(rx, ry)
  return t
}

/** Deterministic value noise — the room looks the same on every visit. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, seed = 7): void {
  const r = rng(seed)
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount
    d[i] = Math.max(0, Math.min(255, d[i] + n))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n))
  }
  ctx.putImageData(img, 0, 0)
}

// ─── surface textures ─────────────────────────────────────────────────────

const floorTexture = (): THREE.CanvasTexture =>
  tiled(
    paint(512, 512, (ctx, w, h) => {
      const r = rng(21)
      ctx.fillStyle = '#2a1a12'
      ctx.fillRect(0, 0, w, h)
      const rows = 8
      const rh = h / rows
      for (let y = 0; y < rows; y++) {
        const offset = (y % 2) * (w / 6)
        for (let x = -1; x < 4; x++) {
          const px = x * (w / 3) + offset
          const shade = 26 + Math.floor(r() * 22)
          ctx.fillStyle = `rgb(${shade + 30},${shade + 12},${shade})`
          ctx.fillRect(px + 1, y * rh + 1, w / 3 - 2, rh - 2)
          // grain streaks along the plank
          ctx.strokeStyle = `rgba(20,12,8,${0.18 + r() * 0.2})`
          ctx.lineWidth = 1
          for (let g = 0; g < 6; g++) {
            const gy = y * rh + 3 + r() * (rh - 6)
            ctx.beginPath()
            ctx.moveTo(px + 2, gy)
            ctx.bezierCurveTo(px + w / 9, gy + (r() - 0.5) * 5, px + w / 4.5, gy + (r() - 0.5) * 5, px + w / 3 - 2, gy)
            ctx.stroke()
          }
        }
      }
      grain(ctx, w, h, 14, 3)
    }),
    5,
    4,
  )

const wallTexture = (): THREE.CanvasTexture =>
  tiled(
    paint(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#241b2c'
      ctx.fillRect(0, 0, w, h)
      // a quiet damask: interlocking diamonds, barely-there
      ctx.strokeStyle = 'rgba(200,151,90,.055)'
      ctx.lineWidth = 1.5
      for (let y = 0; y <= h; y += 64) {
        for (let x = 0; x <= w; x += 64) {
          ctx.beginPath()
          ctx.moveTo(x + 32, y)
          ctx.quadraticCurveTo(x + 64, y + 32, x + 32, y + 64)
          ctx.quadraticCurveTo(x, y + 32, x + 32, y)
          ctx.stroke()
        }
      }
      grain(ctx, w, h, 10, 11)
    }),
    4,
    2,
  )

const rugTexture = (): THREE.CanvasTexture =>
  paint(512, 384, (ctx, w, h) => {
    ctx.fillStyle = '#5b1f21'
    ctx.fillRect(0, 0, w, h)
    const band = (inset: number, color: string, lw: number) => {
      ctx.strokeStyle = color
      ctx.lineWidth = lw
      ctx.strokeRect(inset, inset * 0.75, w - inset * 2, h - inset * 1.5)
    }
    band(14, '#2c1420', 10)
    band(30, '#c8975a', 3)
    band(42, '#2c1420', 6)
    // medallion
    ctx.save()
    ctx.translate(w / 2, h / 2)
    ctx.fillStyle = '#2c1420'
    ctx.beginPath()
    ctx.ellipse(0, 0, w * 0.24, h * 0.3, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#c8975a'
    ctx.lineWidth = 3
    ctx.stroke()
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      ctx.save()
      ctx.rotate(a)
      ctx.fillStyle = i % 2 ? '#b3542f' : '#c8975a'
      ctx.beginPath()
      ctx.ellipse(0, -h * 0.19, w * 0.028, h * 0.05, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    ctx.fillStyle = '#c8975a'
    ctx.beginPath()
    ctx.ellipse(0, 0, w * 0.05, h * 0.065, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    // corner sprigs
    const sprig = (x: number, y: number, sx: number, sy: number) => {
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(sx, sy)
      ctx.strokeStyle = 'rgba(200,151,90,.75)'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.quadraticCurveTo(40, 6, 52, 40)
      ctx.moveTo(0, 0)
      ctx.quadraticCurveTo(6, 40, 40, 52)
      ctx.stroke()
      ctx.restore()
    }
    sprig(58, 44, 1, 1)
    sprig(w - 58, 44, -1, 1)
    sprig(58, h - 44, 1, -1)
    sprig(w - 58, h - 44, -1, -1)
    grain(ctx, w, h, 16, 5)
  })

const leatherTexture = (): THREE.CanvasTexture =>
  tiled(
    paint(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#63402e'
      ctx.fillRect(0, 0, w, h)
      const r = rng(31)
      for (let i = 0; i < 900; i++) {
        const x = r() * w
        const y = r() * h
        ctx.fillStyle = `rgba(${r() > 0.5 ? '124,80,56' : '48,26,18'},${0.05 + r() * 0.14})`
        ctx.beginPath()
        ctx.ellipse(x, y, 2 + r() * 7, 2 + r() * 6, r() * 3, 0, Math.PI * 2)
        ctx.fill()
      }
      grain(ctx, w, h, 12, 13)
    }),
    2,
    2,
  )

const skyTexture = (): THREE.CanvasTexture =>
  paint(512, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#0a1024')
    g.addColorStop(0.62, '#16203c')
    g.addColorStop(1, '#2a2038')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    const r = rng(97)
    for (let i = 0; i < 160; i++) {
      const x = r() * w
      const y = r() * h * 0.7
      ctx.fillStyle = `rgba(240,230,214,${0.15 + r() * 0.7})`
      ctx.beginPath()
      ctx.arc(x, y, r() * 1.4 + 0.4, 0, Math.PI * 2)
      ctx.fill()
    }
    // moon
    ctx.fillStyle = 'rgba(232,220,200,.16)'
    ctx.beginPath()
    ctx.arc(w * 0.68, h * 0.24, 66, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#e8dcc8'
    ctx.beginPath()
    ctx.arc(w * 0.68, h * 0.24, 40, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(20,16,26,.12)'
    ctx.beginPath()
    ctx.arc(w * 0.66, h * 0.22, 8, 0, Math.PI * 2)
    ctx.arc(w * 0.71, h * 0.27, 6, 0, Math.PI * 2)
    ctx.fill()
    // city skyline at the bottom, a few lit windows
    ctx.fillStyle = '#0d1322'
    ctx.beginPath()
    ctx.moveTo(0, h)
    const steps = 14
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * w
      const y = h * (0.74 + (i % 3) * 0.035 + r() * 0.05)
      ctx.lineTo(x, y)
      ctx.lineTo(x + w / steps, y)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(224,181,120,${0.35 + r() * 0.5})`
      ctx.fillRect(r() * w, h * (0.78 + r() * 0.18), 3, 4)
    }
  })

const softDot = (): THREE.CanvasTexture =>
  paint(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.45, 'rgba(255,255,255,.35)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  })

const flameTexture = (): THREE.CanvasTexture =>
  paint(128, 256, (ctx, w, h) => {
    // a defined tongue of flame — hot core, thin cool edge, hard falloff at
    // the tip so five of these read as fire and not as one soft blob
    const tongue = (): void => {
      ctx.beginPath()
      ctx.moveTo(w / 2, h * 0.04)
      ctx.bezierCurveTo(w * 0.92, h * 0.46, w * 0.8, h * 0.98, w / 2, h)
      ctx.bezierCurveTo(w * 0.2, h * 0.98, w * 0.08, h * 0.46, w / 2, h * 0.04)
      ctx.closePath()
    }
    const outer = ctx.createLinearGradient(0, h * 0.02, 0, h)
    outer.addColorStop(0, 'rgba(224,120,60,0)')
    outer.addColorStop(0.35, 'rgba(224,120,60,.55)')
    outer.addColorStop(1, 'rgba(179,84,47,.85)')
    ctx.fillStyle = outer
    tongue()
    ctx.fill()
    // inner core
    ctx.save()
    ctx.translate(w / 2, h)
    ctx.scale(0.52, 0.7)
    ctx.translate(-w / 2, -h)
    const core = ctx.createLinearGradient(0, h * 0.02, 0, h)
    core.addColorStop(0, 'rgba(245,190,110,0)')
    core.addColorStop(0.4, 'rgba(250,214,150,.85)')
    core.addColorStop(1, 'rgba(255,246,220,1)')
    ctx.fillStyle = core
    tongue()
    ctx.fill()
    ctx.restore()
  })

// ─── framed artwork (painted, never fetched) ──────────────────────────────

type ArtPainter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void

function artBoard(ctx: CanvasRenderingContext2D, w: number, h: number, bg: string): void {
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
}

const artCigarBand: ArtPainter = (ctx, w, h) => {
  artBoard(ctx, w, h, '#f4ead6')
  ctx.save()
  ctx.translate(w / 2, h / 2)
  ctx.fillStyle = '#5b1f21'
  ctx.beginPath()
  ctx.ellipse(0, 0, w * 0.38, h * 0.26, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#c8975a'
  ctx.lineWidth = 6
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(0, 0, w * 0.33, h * 0.21, 0, 0, Math.PI * 2)
  ctx.lineWidth = 2
  ctx.stroke()
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    ctx.save()
    ctx.rotate(a)
    ctx.fillStyle = i % 2 ? '#c8975a' : '#e0b578'
    ctx.beginPath()
    ctx.ellipse(0, -h * 0.335, w * 0.012, h * 0.026, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  ctx.fillStyle = '#e0b578'
  ctx.textAlign = 'center'
  ctx.font = `600 ${Math.round(h * 0.115)}px Georgia, serif`
  ctx.fillText('REVOLUCIÓN', 0, h * 0.02)
  ctx.font = `italic ${Math.round(h * 0.062)}px Georgia, serif`
  ctx.fillStyle = '#f0e6d6'
  ctx.fillText('hecho a mano', 0, h * 0.12)
  ctx.restore()
}

const artLeaf: ArtPainter = (ctx, w, h) => {
  artBoard(ctx, w, h, '#efe4cd')
  ctx.strokeStyle = '#4a3a22'
  ctx.lineWidth = 3
  ctx.save()
  ctx.translate(w / 2, h * 0.56)
  ctx.beginPath()
  ctx.moveTo(0, h * 0.36)
  ctx.bezierCurveTo(w * 0.34, h * 0.14, w * 0.3, -h * 0.3, 0, -h * 0.42)
  ctx.bezierCurveTo(-w * 0.3, -h * 0.3, -w * 0.34, h * 0.14, 0, h * 0.36)
  ctx.fillStyle = 'rgba(122,101,54,.34)'
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, h * 0.36)
  ctx.lineTo(0, -h * 0.42)
  ctx.stroke()
  ctx.lineWidth = 1.6
  for (let i = -7; i <= 7; i++) {
    const y = i * h * 0.048
    const spread = (1 - Math.abs(i) / 8.5) * w * 0.27
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.quadraticCurveTo(spread * 0.6, y - h * 0.03, spread, y - h * 0.07)
    ctx.moveTo(0, y)
    ctx.quadraticCurveTo(-spread * 0.6, y - h * 0.03, -spread, y - h * 0.07)
    ctx.stroke()
  }
  ctx.restore()
  ctx.fillStyle = '#4a3a22'
  ctx.textAlign = 'center'
  ctx.font = `italic ${Math.round(h * 0.055)}px Georgia, serif`
  ctx.fillText('Nicotiana tabacum', w / 2, h * 0.955)
}

const artWheel: ArtPainter = (ctx, w, h) => {
  artBoard(ctx, w, h, '#181020')
  const cx = w / 2
  const cy = h * 0.47
  const R = Math.min(w, h) * 0.36
  const families = [
    ['#8d5524', 'EARTH'], ['#c0392b', 'SPICE'], ['#d4a017', 'SWEET'], ['#7d6608', 'WOOD'],
    ['#a04000', 'ROAST'], ['#5d4037', 'LEATHER'], ['#27ae60', 'HERB'], ['#8e44ad', 'FRUIT'],
    ['#e0b578', 'CREAM'], ['#2e86c1', 'MINERAL'],
  ] as const
  families.forEach(([color, label], i) => {
    const a0 = (i / families.length) * Math.PI * 2 - Math.PI / 2
    const a1 = ((i + 1) / families.length) * Math.PI * 2 - Math.PI / 2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, R, a0, a1)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = '#181020'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate((a0 + a1) / 2)
    ctx.fillStyle = '#141017'
    ctx.textAlign = 'right'
    ctx.font = `600 ${Math.round(R * 0.11)}px Georgia, serif`
    ctx.fillText(label, R * 0.92, R * 0.04)
    ctx.restore()
  })
  ctx.beginPath()
  ctx.arc(cx, cy, R * 0.3, 0, Math.PI * 2)
  ctx.fillStyle = '#141017'
  ctx.fill()
  ctx.strokeStyle = '#c8975a'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.fillStyle = '#c8975a'
  ctx.textAlign = 'center'
  ctx.font = `${Math.round(R * 0.13)}px Georgia, serif`
  ctx.fillText('63', cx, cy + R * 0.02)
  ctx.font = `${Math.round(R * 0.075)}px Georgia, serif`
  ctx.fillText('FLAVORS', cx, cy + R * 0.17)
  ctx.fillStyle = '#f0e6d6'
  ctx.font = `${Math.round(h * 0.052)}px Georgia, serif`
  ctx.fillText('THE FLAVOR WHEEL', cx, h * 0.94)
}

const artPoster: ArtPainter = (ctx, w, h) => {
  artBoard(ctx, w, h, '#1b1520')
  ctx.strokeStyle = '#c8975a'
  ctx.lineWidth = 4
  ctx.strokeRect(w * 0.07, h * 0.06, w * 0.86, h * 0.88)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#c8975a'
  ctx.font = `${Math.round(h * 0.045)}px Georgia, serif`
  ctx.fillText('E S T ·  T H E  ·  L O U N G E', w / 2, h * 0.19)
  ctx.fillStyle = '#f0e6d6'
  ctx.font = `italic ${Math.round(h * 0.13)}px Georgia, serif`
  ctx.fillText('Pull up', w / 2, h * 0.42)
  ctx.fillText('a chair.', w / 2, h * 0.57)
  // a smoking cigar rule
  ctx.strokeStyle = 'rgba(240,230,214,.35)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(w * 0.28, h * 0.68)
  ctx.lineTo(w * 0.72, h * 0.68)
  ctx.stroke()
  ctx.fillStyle = '#5b3a24'
  ctx.fillRect(w * 0.36, h * 0.74, w * 0.26, h * 0.035)
  ctx.fillStyle = '#c8975a'
  ctx.fillRect(w * 0.36, h * 0.74, w * 0.05, h * 0.035)
  ctx.fillStyle = '#b3542f'
  ctx.fillRect(w * 0.62, h * 0.74, w * 0.014, h * 0.035)
  ctx.fillStyle = '#8d7f6f'
  ctx.font = `${Math.round(h * 0.038)}px Georgia, serif`
  ctx.fillText('one moment, journaled', w / 2, h * 0.87)
}

const artMap: ArtPainter = (ctx, w, h) => {
  artBoard(ctx, w, h, '#e6d8ba')
  ctx.strokeStyle = 'rgba(90,66,40,.5)'
  ctx.lineWidth = 1
  for (let i = 1; i < 8; i++) {
    ctx.beginPath()
    ctx.moveTo(0, (i / 8) * h)
    ctx.lineTo(w, (i / 8) * h)
    ctx.moveTo((i / 8) * w, 0)
    ctx.lineTo((i / 8) * w, h)
    ctx.stroke()
  }
  // loose landmasses — evocative, not cartographic
  const blobs: Array<[number, number, number, number]> = [
    [0.24, 0.42, 0.13, 0.2], [0.36, 0.62, 0.09, 0.13], [0.52, 0.36, 0.1, 0.12],
    [0.66, 0.55, 0.14, 0.17], [0.8, 0.34, 0.08, 0.1],
  ]
  ctx.fillStyle = 'rgba(122,101,54,.5)'
  ctx.strokeStyle = '#5a4228'
  ctx.lineWidth = 2
  for (const [x, y, rx, ry] of blobs) {
    ctx.beginPath()
    ctx.ellipse(x * w, y * h, rx * w, ry * h, x * 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.fillStyle = '#5b1f21'
  ctx.textAlign = 'center'
  const marks: Array<[number, number, string]> = [
    [0.24, 0.42, 'CUBA'], [0.36, 0.63, 'NICARAGUA'], [0.52, 0.36, 'DOM. REP.'],
    [0.66, 0.55, 'CAMEROON'], [0.8, 0.34, 'SUMATRA'],
  ]
  ctx.font = `600 ${Math.round(h * 0.045)}px Georgia, serif`
  for (const [x, y, label] of marks) {
    ctx.beginPath()
    ctx.arc(x * w, y * h, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillText(label, x * w, y * h - 10)
  }
  ctx.fillStyle = '#4a3a22'
  ctx.font = `italic ${Math.round(h * 0.055)}px Georgia, serif`
  ctx.fillText('where the leaf comes from', w / 2, h * 0.94)
}

// artWheel is NOT in the rotation — the wheel hangs exactly once, as the
// pinned clickable picker on the right wall. Duplicates read as a bug.
const ART_PAINTERS: ArtPainter[] = [artCigarBand, artLeaf, artPoster, artMap]

// ─── the dartboard face (painted, true ring geometry) ─────────────────────
// The painter and the SCORER share one set of ring fractions, and they live
// in darts-rules.ts — the rules of the game are testable on their own (see
// darts-rules.spec.ts) and nothing about them needs a scene to be true.

const dartboardFace: ArtPainter = (ctx, w, h) => {
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2
  const seg = (Math.PI * 2) / 20
  const dir = (a: number, r: number): [number, number] =>
    [cx + Math.sin(a) * r * R, cy - Math.cos(a) * r * R]
  ctx.fillStyle = '#141017'
  ctx.fillRect(0, 0, w, h)
  // rim (number ring bed)
  ctx.beginPath()
  ctx.arc(cx, cy, R * 0.985, 0, Math.PI * 2)
  ctx.fillStyle = '#1a1218'
  ctx.fill()
  const ring = (i: number, rIn: number, rOut: number, fill: string): void => {
    const a0 = i * seg - seg / 2, a1 = i * seg + seg / 2
    ctx.beginPath()
    ctx.arc(cx, cy, rOut * R, a0 - Math.PI / 2, a1 - Math.PI / 2)
    ctx.arc(cx, cy, rIn * R, a1 - Math.PI / 2, a0 - Math.PI / 2, true)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
  }
  for (let i = 0; i < 20; i++) {
    const dark = i % 2 === 0
    const bed = dark ? '#241a20' : '#e8dcc4'
    const hot = dark ? '#b3542f' : '#2f4a35'
    ring(i, DART_RINGS.bull, DART_RINGS.trIn, bed)
    ring(i, DART_RINGS.trIn, DART_RINGS.trOut, hot)
    ring(i, DART_RINGS.trOut, DART_RINGS.dblIn, bed)
    ring(i, DART_RINGS.dblIn, DART_RINGS.dblOut, hot)
    // upright numeral in the outer ring
    const [nx, ny] = dir(i * seg, 0.885)
    ctx.fillStyle = '#e0b578'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `600 ${Math.round(R * 0.115)}px Georgia, serif`
    ctx.fillText(String(DART_NUMS[i]), nx, ny)
  }
  // bull — green ring, ember eye
  ctx.beginPath(); ctx.arc(cx, cy, DART_RINGS.bull * R, 0, Math.PI * 2)
  ctx.fillStyle = '#2f4a35'; ctx.fill()
  ctx.beginPath(); ctx.arc(cx, cy, DART_RINGS.dbull * R, 0, Math.PI * 2)
  ctx.fillStyle = '#b3542f'; ctx.fill()
  // wires
  ctx.strokeStyle = 'rgba(200,151,90,.75)'
  ctx.lineWidth = Math.max(1.5, R * 0.008)
  for (const r of [DART_RINGS.dblOut, DART_RINGS.dblIn, DART_RINGS.trOut, DART_RINGS.trIn, DART_RINGS.bull, DART_RINGS.dbull]) {
    ctx.beginPath(); ctx.arc(cx, cy, r * R, 0, Math.PI * 2); ctx.stroke()
  }
  for (let i = 0; i < 20; i++) {
    const a = i * seg - seg / 2
    const [x0, y0] = dir(a, DART_RINGS.bull)
    const [x1, y1] = dir(a, DART_RINGS.dblOut)
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
  }
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.985, 0, Math.PI * 2); ctx.stroke()
}

// ─── small builders ───────────────────────────────────────────────────────

const std = (params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial(params)

function box(
  w: number, h: number, d: number,
  mat: THREE.Material, x = 0, y = 0, z = 0, radius = 0.012,
): THREE.Mesh {
  const g = radius > 0
    ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, Math.min(w, h, d) / 2.05))
    : new THREE.BoxGeometry(w, h, d)
  const m = new THREE.Mesh(g, mat)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

function cyl(
  rt: number, rb: number, h: number, seg: number,
  mat: THREE.Material, x = 0, y = 0, z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

// ─── the room ─────────────────────────────────────────────────────────────

export interface Room {
  scene: THREE.Scene
  slots: Map<string, THREE.Object3D[]>
  /** Meshes that answer a click, each carrying `userData.pick` — the id the
   *  page receives on `lounge3d:pick`. */
  pickables: THREE.Object3D[]
  attachCamera: (c: THREE.Camera) => void
  tick: (t: number, dt: number) => void
  /** THE OCHE. A press on the board face (marked `userData.dart`) starts an
   *  aim, a drag re-points it, and the release throws — see the throw block in
   *  buildRoom for why it is a hold and not a click. `beginAim` returns false
   *  when it is not your throw, and the press falls through to orbiting the
   *  room. */
  darts: {
    beginAim: (worldPoint: THREE.Vector3) => boolean
    moveAim: (worldPoint: THREE.Vector3) => void
    release: () => { label: string; points: number; mult: number } | null
    cancel: () => void
    /** The camera has moved to a preset: at the oche the room dims for the
     *  match, which is how the lounge becomes the game without leaving. */
    view: (name: string) => void
    /** The chalkboard, as data — the crowd, the multiplier, the tally, the
     *  side bet, the live smoke ring. */
    state: () => Record<string, unknown>
    /** Put a dart in at a board-local point with no aim and no skill. The
     *  harness's way in; the skill lives in beginAim/release. */
    throwAt: (x: number, y: number) => boolean
  }
  dispose: () => void
}

function buildRoom(art: Record<string, string | undefined>): Room {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0d0912)
  scene.fog = new THREE.Fog(0x140f1a, 9, 24)

  const disposables: Array<{ dispose: () => void }> = []
  const track = <T extends { dispose: () => void }>(x: T): T => {
    disposables.push(x)
    return x
  }
  const slots = new Map<string, THREE.Object3D[]>()
  const slot = (id: string, obj: THREE.Object3D): THREE.Object3D => {
    const list = slots.get(id)
    if (list) list.push(obj)
    else slots.set(id, [obj])
    return obj
  }

  const woodMat = std({ map: track(tiled(floorTexture(), 1, 1)), roughness: 0.78, metalness: 0.05 })
  const darkWood = std({ color: C.woodDark, roughness: 0.65, metalness: 0.08 })
  const trimWood = std({ color: C.wood, roughness: 0.55, metalness: 0.12 })
  const leatherMat = std({ map: track(leatherTexture()), roughness: 0.62, metalness: 0.04 })
  const leatherDeep = std({ color: C.leatherDark, roughness: 0.68 })
  const brassMat = std({ color: C.brass, roughness: 0.28, metalness: 0.85 })
  const brassGlow = std({ color: C.brassBright, emissive: C.brassBright, emissiveIntensity: 0.35, roughness: 0.3, metalness: 0.7 })
  const stoneMat = std({ color: 0x2a2230, roughness: 0.92 })
  const glassMat = std({ color: 0xd8e4e8, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.28 })
  const whiskeyMat = std({ color: 0xb3542f, roughness: 0.15, transparent: true, opacity: 0.85, emissive: 0x3a1408, emissiveIntensity: 0.35 })
  const clothMat = std({ color: 0x3a2a3c, roughness: 0.95 })

  // ── shell ──────────────────────────────────────────────────────────────
  const shell = new THREE.Group()
  scene.add(shell)

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), woodMat)
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  shell.add(floor)

  const wallMat = std({ map: track(wallTexture()), roughness: 0.95, side: THREE.FrontSide })
  const mkWall = (w: number, x: number, z: number, ry: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, ROOM.h), wallMat)
    m.position.set(x, ROOM.h / 2, z)
    m.rotation.y = ry
    m.receiveShadow = true
    shell.add(m)
    return m
  }
  mkWall(ROOM.w, 0, -HALF_D, 0)
  mkWall(ROOM.d, -HALF_W, 0, Math.PI / 2)
  mkWall(ROOM.d, HALF_W, 0, -Math.PI / 2)
  // back-of-camera wall, so an orbit past the doorway still reads as a room
  mkWall(ROOM.w, 0, HALF_D, Math.PI)

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), std({ color: C.ceiling, roughness: 1 }))
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.y = ROOM.h
  shell.add(ceiling)

  // beams, baseboard, chair rail
  for (let i = -2; i <= 2; i++) {
    shell.add(box(ROOM.w, 0.16, 0.22, darkWood, 0, ROOM.h - 0.08, i * 1.7))
  }
  const trim = (w: number, d: number, x: number, z: number, ry: number, y: number, h: number) => {
    const m = box(w, h, d, trimWood, x, y, z)
    m.rotation.y = ry
    shell.add(m)
  }
  trim(ROOM.w, 0.08, 0, -HALF_D + 0.04, 0, 0.09, 0.18)
  trim(ROOM.d, 0.08, -HALF_W + 0.04, 0, Math.PI / 2, 0.09, 0.18)
  trim(ROOM.d, 0.08, HALF_W - 0.04, 0, Math.PI / 2, 0.09, 0.18)
  trim(ROOM.w, 0.06, 0, -HALF_D + 0.03, 0, 1.05, 0.07)
  trim(ROOM.d, 0.06, -HALF_W + 0.03, 0, Math.PI / 2, 1.05, 0.07)
  trim(ROOM.d, 0.06, HALF_W - 0.03, 0, Math.PI / 2, 1.05, 0.07)

  // ── lighting ───────────────────────────────────────────────────────────
  // Dusk in a lounge: enough ambient to read the leather and the woodwork,
  // with the fire, the lamp and the picture lights doing the shaping.
  // These three are the room's general light, and the oche dims them: when a
  // match is on, the lounge gives the board its attention the way a room
  // actually does — everything else goes quiet and a little darker.
  const hemi = new THREE.HemisphereLight(0x6a5878, 0x2a1c22, 1.15)
  scene.add(hemi)
  const roomFill = new THREE.PointLight(0xe0b578, 13, 20, 2)
  roomFill.position.set(0, ROOM.h - 0.5, 1.2)
  scene.add(roomFill)

  // brass chandelier over the seating
  const chandelier = new THREE.Group()
  chandelier.position.set(0, ROOM.h - 0.02, 0.9)
  scene.add(chandelier)
  chandelier.add(cyl(0.03, 0.03, 0.45, 8, brassMat, 0, -0.22, 0))
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.022, 8, 28), brassMat)
  ring.rotation.x = Math.PI / 2
  ring.position.y = -0.45
  chandelier.add(ring)
  const bulbMat = std({ color: 0xf6e2b8, emissive: 0xffc98a, emissiveIntensity: 2.2, roughness: 0.6 })
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const arm = cyl(0.012, 0.012, 0.16, 6, brassMat, Math.cos(a) * 0.42, -0.38, Math.sin(a) * 0.42)
    chandelier.add(arm)
    const shade = cyl(0.05, 0.075, 0.11, 12, std({
      color: 0xe8cfa0, emissive: 0xffbe72, emissiveIntensity: 0.7,
      roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 0.92,
    }), Math.cos(a) * 0.42, -0.3, Math.sin(a) * 0.42)
    chandelier.add(shade)
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), bulbMat)
    bulb.position.set(Math.cos(a) * 0.42, -0.36, Math.sin(a) * 0.42)
    chandelier.add(bulb)
  }
  const chandelierLight = new THREE.PointLight(0xffc98a, 16, 12, 2)
  chandelierLight.position.set(0, -0.42, 0)
  chandelier.add(chandelierLight)

  // ── rug ────────────────────────────────────────────────────────────────
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 4), std({ map: track(rugTexture()), roughness: 1 }))
  rug.rotation.x = -Math.PI / 2
  rug.position.set(0, 0.012, 0.6)
  rug.receiveShadow = true
  scene.add(slot('slot-rug', rug))

  // ── fireplace (back wall, centre) ──────────────────────────────────────
  const hearth = new THREE.Group()
  hearth.position.set(0, 0, -HALF_D + 0.02)
  scene.add(hearth)
  // A chimney breast built AROUND a real opening — jambs, lintel, firebox —
  // so the fire sits in a recess instead of glowing on a flat slab.
  const OPEN_W = 1.7
  const OPEN_H = 1.45
  const BREAST_D = 0.34
  const jambW = (3.4 - OPEN_W) / 2
  hearth.add(box(jambW, OPEN_H, BREAST_D, stoneMat, -(OPEN_W + jambW) / 2, OPEN_H / 2, BREAST_D / 2))
  hearth.add(box(jambW, OPEN_H, BREAST_D, stoneMat, (OPEN_W + jambW) / 2, OPEN_H / 2, BREAST_D / 2))
  hearth.add(box(3.4, ROOM.h - OPEN_H, BREAST_D, stoneMat, 0, (OPEN_H + ROOM.h) / 2, BREAST_D / 2))
  const soot = std({ color: 0x0b0710, roughness: 1 })
  hearth.add(box(OPEN_W, OPEN_H, 0.05, soot, 0, OPEN_H / 2, 0.06)) // firebox back
  hearth.add(box(0.06, OPEN_H, BREAST_D, soot, -OPEN_W / 2 + 0.03, OPEN_H / 2, BREAST_D / 2))
  hearth.add(box(0.06, OPEN_H, BREAST_D, soot, OPEN_W / 2 - 0.03, OPEN_H / 2, BREAST_D / 2))
  hearth.add(box(OPEN_W, 0.06, BREAST_D, soot, 0, OPEN_H - 0.03, BREAST_D / 2))
  hearth.add(box(3.9, 0.15, 0.66, trimWood, 0, OPEN_H + 0.14, 0.3)) // mantel shelf
  hearth.add(box(3.5, 0.1, 0.95, stoneMat, 0, 0.05, 0.62)) // hearthstone
  // a fire iron and a log basket on the hearth
  hearth.add(cyl(0.02, 0.02, 0.7, 8, brassMat, -1.4, 0.38, 0.5))
  const basket = cyl(0.26, 0.22, 0.26, 14, std({ color: 0x2a2230, roughness: 0.7, metalness: 0.4 }), 1.42, 0.22, 0.55)
  hearth.add(basket)
  for (let i = 0; i < 3; i++) {
    const l = cyl(0.055, 0.055, 0.44, 8, std({ color: 0x4a3020, roughness: 1 }), 1.42 + (i - 1) * 0.09, 0.36 + (i % 2) * 0.05, 0.55)
    l.rotation.z = Math.PI / 2
    l.rotation.y = i * 0.2
    hearth.add(l)
  }

  // fire: logs, billboard flames, ember points, flicker light
  const fire = new THREE.Group()
  fire.position.set(0, 0.14, -HALF_D + 0.55)
  scene.add(slot('slot-fire', fire))
  const logMat = std({ color: 0x2a1a10, roughness: 1 })
  for (const [x, y, z, rz] of [[-0.28, 0.08, 0, 0.22], [0.24, 0.08, 0.08, -0.3], [0, 0.2, -0.05, 0.08]]) {
    const log = cyl(0.09, 0.09, 0.9, 8, logMat, x, y, z)
    log.rotation.z = Math.PI / 2 + rz
    fire.add(log)
  }
  const flameMap = track(flameTexture())
  // One material per flame — the tick animates opacity individually, and a
  // shared material would let the last write win for all five.
  const flames: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; phase: number }> = []
  for (let i = 0; i < 5; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: flameMap, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 0.9,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.7), mat)
    mesh.position.set((i - 2) * 0.16, 0.34 + (i % 2) * 0.08, ((i % 3) - 1) * 0.05)
    fire.add(mesh)
    flames.push({ mesh, mat, phase: i * 1.31 })
  }
  const fireLight = new THREE.PointLight(0xff9a4a, 22, 11, 2)
  fireLight.position.set(0, 0.7, 0.2)
  fireLight.castShadow = true
  fireLight.shadow.mapSize.set(1024, 1024)
  fireLight.shadow.bias = -0.0015
  fire.add(fireLight)

  const emberGeo = new THREE.BufferGeometry()
  const EMBERS = 40
  const emberPos = new Float32Array(EMBERS * 3)
  const emberVel = new Float32Array(EMBERS)
  const er = rng(404)
  for (let i = 0; i < EMBERS; i++) {
    emberPos[i * 3] = (er() - 0.5) * 0.8
    emberPos[i * 3 + 1] = er() * 1.2
    emberPos[i * 3 + 2] = (er() - 0.5) * 0.2
    emberVel[i] = 0.25 + er() * 0.5
  }
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3))
  const embers = new THREE.Points(
    emberGeo,
    new THREE.PointsMaterial({
      size: 0.05, map: track(softDot()), color: 0xf2c47e,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  )
  fire.add(embers)

  // ── wall art: the hive's own tile imagery, then painted prints ─────────
  const frames = new THREE.Group()
  scene.add(slot('slot-frames', frames))

  const artUrls = ['lounge', 'cigars', 'journal', 'flavor-wheel', 'humidor', 'community']
    .map(k => art[k])
    .filter((u): u is string => typeof u === 'string' && u.length > 0)

  const loader = new THREE.TextureLoader()
  let painterIdx = 0
  const nextPainted = (w: number, h: number): THREE.Texture => {
    const painter = ART_PAINTERS[painterIdx % ART_PAINTERS.length]
    painterIdx++
    return track(paint(Math.round(w * 320), Math.round(h * 320), painter))
  }

  let urlIdx = 0
  const pickables: THREE.Object3D[] = []
  /** A framed picture: gilt frame, cream mat, canvas, and a brass picture light.
   *  `pin` forces a specific painted print (and makes the canvas clickable —
   *  the page opens the matching panel from `lounge3d:pick`). */
  const hangFrame = (
    w: number, h: number, x: number, y: number, z: number, ry: number,
    preferHiveArt: boolean,
    pin?: { painter: ArtPainter; pick: string },
  ): void => {
    const g = new THREE.Group()
    g.position.set(x, y, z)
    g.rotation.y = ry
    frames.add(g)

    const canvasMat = std({ color: 0xf0e6d6, roughness: 0.85 })
    const canvas = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.16, h - 0.16), canvasMat)
    canvas.position.z = 0.031
    g.add(canvas)

    const hiveUrl = pin ? undefined : (preferHiveArt ? artUrls[urlIdx++] : undefined)
    if (pin) {
      canvasMat.map = track(paint(Math.round(w * 320), Math.round(h * 320), pin.painter))
      canvasMat.color.set(0xffffff)
      canvasMat.needsUpdate = true
      canvas.userData.pick = pin.pick
      pickables.push(canvas)
    } else if (hiveUrl) {
      loader.load(
        hiveUrl,
        t => {
          t.colorSpace = THREE.SRGBColorSpace
          canvasMat.map = track(t)
          canvasMat.color.set(0xffffff)
          canvasMat.needsUpdate = true
        },
        undefined,
        () => {
          canvasMat.map = nextPainted(w, h)
          canvasMat.color.set(0xffffff)
          canvasMat.needsUpdate = true
        },
      )
    } else {
      canvasMat.map = nextPainted(w, h)
      canvasMat.color.set(0xffffff)
      canvasMat.needsUpdate = true
    }

    // gilt frame — four moulding bars around the canvas
    const bar = 0.08
    const frameMat = std({ color: C.brass, roughness: 0.42, metalness: 0.6 })
    g.add(box(w, bar, 0.07, frameMat, 0, h / 2 - bar / 2, 0.02))
    g.add(box(w, bar, 0.07, frameMat, 0, -h / 2 + bar / 2, 0.02))
    g.add(box(bar, h - bar * 2, 0.07, frameMat, -w / 2 + bar / 2, 0, 0.02))
    g.add(box(bar, h - bar * 2, 0.07, frameMat, w / 2 - bar / 2, 0, 0.02))
    g.add(box(w - 0.14, h - 0.14, 0.02, std({ color: 0x0e0a12, roughness: 1 }), 0, 0, 0.01))

    // picture light
    const arm = cyl(0.012, 0.012, 0.16, 6, brassMat, 0, h / 2 + 0.06, 0.07)
    arm.rotation.x = Math.PI / 2
    g.add(arm)
    const hood = cyl(0.045, 0.055, 0.22, 10, brassGlow, 0, h / 2 + 0.11, 0.15)
    hood.rotation.z = Math.PI / 2
    g.add(hood)
    const spot = new THREE.PointLight(0xffd9a0, 2.2, 2.4, 2)
    spot.position.set(0, h / 2 - 0.02, 0.28)
    g.add(spot)

    // a clickable print gets a brighter light and a warm halo, so the room
    // says "this one opens" without a label
    if (pin) {
      spot.intensity = 3.6
      const halo = new THREE.Mesh(
        new THREE.PlaneGeometry(w + 0.5, h + 0.5),
        new THREE.MeshBasicMaterial({
          map: track(softDot()), color: 0xe0b578, transparent: true,
          opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      )
      halo.position.z = -0.006
      g.add(halo)
    }
  }

  // gallery wall (left), flanking the fireplace (back), and one over the bar.
  // The old clickable wheel spot (left wall, z 0.85) sat squarely behind the
  // wingback from the room view — the DARTBOARD hangs there now, and the
  // flavor-wheel picker moved to the right-wall print that was already a
  // second picture of it, in clear view beside the humidor.
  hangFrame(1.0, 1.3, -HALF_W + 0.09, 1.85, -1.9, Math.PI / 2, true)
  hangFrame(0.86, 0.86, -HALF_W + 0.09, 1.75, -0.55, Math.PI / 2, true)
  hangFrame(0.72, 0.9, -HALF_W + 0.09, 1.8, 2.2, Math.PI / 2, false)
  hangFrame(1.15, 1.4, -2.55, 1.95, -HALF_D + 0.08, 0, true)
  hangFrame(1.15, 1.4, 2.55, 1.95, -HALF_D + 0.08, 0, true)
  // (the mantel no longer carries a print — the looking glass hangs there,
  // built in the inception section below)
  // the flavor wheel — the one picture of it, and it OPENS when clicked
  hangFrame(0.9, 1.15, HALF_W - 0.09, 1.85, -2.2, -Math.PI / 2, false,
    { painter: artWheel, pick: 'flavor-wheel' })

  // ── dartboard (left wall, past the wingback) — click the board to throw ──
  const dartsGroup = new THREE.Group()
  dartsGroup.position.set(-HALF_W + 0.1, 1.72, 1.0)
  dartsGroup.rotation.y = Math.PI / 2
  scene.add(slot('slot-darts', dartsGroup))

  // cabinet: back panel + two open doors, pub style
  dartsGroup.add(box(0.8, 0.88, 0.035, darkWood, 0, 0, 0))
  dartsGroup.add(box(0.4, 0.86, 0.02, darkWood, -0.6, 0, 0.006))
  dartsGroup.add(box(0.4, 0.86, 0.02, darkWood, 0.6, 0, 0.006))
  // chalk scoreboard on the left door — redrawn per throw
  const chalkCv = document.createElement('canvas')
  chalkCv.width = 260
  chalkCv.height = 520
  const chalkTex = track(new THREE.CanvasTexture(chalkCv))
  chalkTex.colorSpace = THREE.SRGBColorSpace
  /** The two seats at the oche. The Colonel is the house — he has been on that
   *  board every night for thirty years and throws like it. */
  type Seat = { name: string; score: number; legs: number }
  const seats: Seat[] = [
    { name: 'YOU', score: 501, legs: 0 },
    { name: 'COLONEL', score: 501, legs: 0 },
  ]
  let turnSeat = 0
  let turnDarts: DartHit[] = []
  /** Where this turn's darts actually landed, board-local — the Robin Hood and
   *  the smoke rings are facts about the sisal, not about the score. */
  let turnLandings: Array<{ x: number; y: number }> = []
  /** The score to REVERT to on a bust — darts thrown into a bust never
   *  happened, which is the rule that makes the last hundred the hard part. */
  let turnStart = 501
  /** Every dart you have thrown this leg, busts included. Nine of them and the
   *  house has been waiting thirty years for you. */
  let legDarts = 0
  let chalkNote = 'hold the board · release on the tight ring'

  // ── THE HOUSE: the crowd, the alternate score, and the side bet ────────
  //
  // None of this touches 501. You are still throwing five hundred and one down
  // to nothing and you still need the double, and no bonus in the room will
  // put a dart in it for you. What the house pays for is everything ELSE that
  // happened on the way: how full the room got, how thin the rings were, and
  // whether the shape of a turn was worth a laugh at the bar.
  //
  //   FANS       — the crowd at the oche. They arrive for trebles, tons and
  //                legs, and they drift off for busts, wires and cold turns.
  //   ×          — the crowd IS the multiplier: every third pair of eyes
  //                doubles what the house pays, up to four.
  //   THE TALLY  — the alternate score. 501 counts DOWN by numbers; the tally
  //                counts UP by rings (single 1, double 4, treble 9, bull 5,
  //                inner bull 16, off the board −2), and every fifty of it
  //                brings another regular over. It is kept between visits,
  //                because it is the only number here that is a career.
  //   SIDE BET   — one of the house's small numeric bets, drawn fresh each leg
  //                and chalked up. Hit it and it pays double.
  let fans = FANS_BASE
  let tally = 0
  let tallyGiven = 0
  let sideBet = drawSideBet()
  /** The shout, chalked across the board for a couple of seconds. */
  let banner: { shout: string; sub: string; t: number } | null = null

  /** What the board remembers between visits: the match record, the shortest
   *  leg, and the tally. Local, like the ledger — the house keeps its own
   *  book and nobody audits it. */
  type OcheRecord = { won: number; lost: number; best: number; tally: number }
  const RECORD_KEY = 'rev:lounge:oche'
  const loadRecord = (): OcheRecord => {
    try {
      const raw = JSON.parse(localStorage.getItem(RECORD_KEY) ?? '{}') as Partial<OcheRecord>
      return {
        won: Number(raw.won) || 0, lost: Number(raw.lost) || 0,
        best: Number(raw.best) || 0, tally: Number(raw.tally) || 0,
      }
    } catch { return { won: 0, lost: 0, best: 0, tally: 0 } }
  }
  const record = loadRecord()
  const saveRecord = (): void => {
    record.tally = tally
    try { localStorage.setItem(RECORD_KEY, JSON.stringify(record)) } catch { /* private mode */ }
  }
  tally = record.tally
  // The crowd is earned per evening; the tally is what carries over. A player
  // walking back in gets the next fan on the next fifty, not a full house for
  // having been here before.
  tallyGiven = tallyFans(tally)

  const drawChalk = (): void => {
    const ctx = chalkCv.getContext('2d')
    if (!ctx) return
    const w = chalkCv.width, h = chalkCv.height
    ctx.fillStyle = '#20262c'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = 'rgba(217,207,174,.4)'
    ctx.lineWidth = 3
    ctx.strokeRect(10, 10, w - 20, h - 20)
    ctx.fillStyle = '#d9cfae'
    ctx.textAlign = 'center'
    ctx.font = '600 30px Georgia, serif'
    ctx.fillText('5 0 1', w / 2, 46)
    ctx.font = 'italic 14px Georgia, serif'
    ctx.fillStyle = 'rgba(217,207,174,.6)'
    ctx.fillText(`double out · first to ${MATCH_LEGS}`, w / 2, 64)
    const rule = (y: number): void => {
      ctx.strokeStyle = 'rgba(217,207,174,.45)'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(26, y); ctx.lineTo(w - 26, y); ctx.stroke()
    }
    rule(78)

    // THE TWO SCORES — the only numbers that matter, biggest on the board.
    // The seat to throw carries the chalk mark, so whose turn it is is never
    // a question you have to hold in your head.
    seats.forEach((seat, i) => {
      const y = 122 + i * 56
      const live = i === turnSeat
      ctx.textAlign = 'left'
      ctx.font = `${live ? '600 ' : ''}18px Georgia, serif`
      ctx.fillStyle = live ? '#e8dcc4' : 'rgba(217,207,174,.62)'
      ctx.fillText(live ? '▸ ' + seat.name : '  ' + seat.name, 26, y - 22)
      ctx.textAlign = 'right'
      ctx.font = '600 40px Georgia, serif'
      ctx.fillStyle = live ? '#e8dcc4' : 'rgba(217,207,174,.62)'
      ctx.fillText(String(seat.score), w - 26, y)
      // legs as brass strokes: a match is three of them, and a row of marks
      // reads at a glance in a way the word "legs 2" never does
      for (let k = 0; k < MATCH_LEGS; k++) {
        const lx = 28 + k * 13
        ctx.fillStyle = k < seat.legs ? 'rgba(200,151,90,.95)' : 'rgba(217,207,174,.2)'
        ctx.fillRect(lx, y - 12, 4, 13)
      }
    })
    rule(194)

    // THE HOUSE — the crowd, what it multiplies, and tonight's side bet. This
    // block is the whole of the game that is not 501: how full the room is,
    // what that is worth, and the alternate score that fills it.
    const mult = crowdMultiplier(fans)
    ctx.textAlign = 'left'
    ctx.font = '15px Georgia, serif'
    ctx.fillStyle = 'rgba(217,207,174,.72)'
    ctx.fillText('THE HOUSE', 26, 218)
    ctx.textAlign = 'right'
    ctx.font = `600 ${mult > 1 ? 24 : 19}px Georgia, serif`
    ctx.fillStyle = mult > 1 ? '#e0b578' : 'rgba(217,207,174,.5)'
    ctx.fillText('×' + mult, w - 26, 219)
    // one pip per pair of eyes, filled for the ones who are here
    for (let i = 0; i < FANS_MAX; i++) {
      const px = 33 + i * ((w - 66) / (FANS_MAX - 1))
      ctx.beginPath()
      ctx.arc(px, 236, 4.6, 0, Math.PI * 2)
      if (i < fans) {
        ctx.fillStyle = i < 9 ? 'rgba(224,181,120,.92)' : 'rgba(240,230,214,.95)'
        ctx.fill()
      } else {
        ctx.strokeStyle = 'rgba(217,207,174,.28)'
        ctx.lineWidth = 1.4
        ctx.stroke()
      }
    }
    const bet = QUIRKS[sideBet] ?? SMOKE_CALLS[sideBet]
    ctx.textAlign = 'center'
    ctx.font = 'italic 13px Georgia, serif'
    ctx.fillStyle = 'rgba(200,151,90,.9)'
    ctx.fillText(`tonight the house pays double: ${(bet?.shout ?? '').toLowerCase()}`, w / 2, 258)
    ctx.font = '13px Georgia, serif'
    ctx.fillStyle = 'rgba(217,207,174,.55)'
    ctx.fillText(`tally ${tally} · next man at ${(tallyFans(tally) + 1) * TALLY_STEP}`, w / 2, 276)
    rule(290)

    // THIS TURN — three lines, always three, so the empty ones read as darts
    // still in the hand rather than as nothing happening.
    ctx.font = '23px Georgia, serif'
    for (let i = 0; i < 3; i++) {
      const y = 318 + i * 32
      const d = turnDarts[i]
      ctx.textAlign = 'left'
      ctx.fillStyle = d ? '#d9cfae' : 'rgba(217,207,174,.22)'
      ctx.fillText(d ? d.label : '·', 30, y)
      if (d) {
        ctx.textAlign = 'right'
        ctx.fillText(String(d.points), w - 30, y)
        // the ring it landed in, in the alternate score's own currency
        ctx.textAlign = 'center'
        ctx.font = '13px Georgia, serif'
        ctx.fillStyle = 'rgba(200,151,90,.75)'
        ctx.fillText('+' + tallyOf(d), w / 2, y)
        ctx.font = '23px Georgia, serif'
      }
    }
    rule(400)

    // THE WAY OUT. A checkout hint is not a hint about the game, it IS the
    // game — knowing that 96 is T20, D18 is the difference between a player
    // and someone throwing at the big numbers.
    const live = seats[turnSeat]
    const out = checkout(live.score, 3 - turnDarts.length)
    ctx.textAlign = 'center'
    if (out) {
      ctx.font = '600 19px Georgia, serif'
      ctx.fillStyle = '#c8975a'
      ctx.fillText(out.join('  '), w / 2, 424)
    }

    // THE SHOUT. What the room just called, for as long as a room shouts it.
    if (banner) {
      const fade = Math.min(1, banner.t / 0.6)
      ctx.font = `600 ${banner.shout.length > 16 ? 17 : 22}px Georgia, serif`
      ctx.fillStyle = `rgba(240,230,214,${0.96 * fade})`
      ctx.fillText(banner.shout, w / 2, 456)
      if (banner.sub) {
        ctx.font = `15px Georgia, serif`
        ctx.fillStyle = `rgba(224,181,120,${0.95 * fade})`
        ctx.fillText(banner.sub, w / 2, 476)
      }
    }
    ctx.font = 'italic 14px Georgia, serif'
    ctx.fillStyle = 'rgba(217,207,174,.72)'
    ctx.fillText(chalkNote, w / 2, 498)
    ctx.font = '12px Georgia, serif'
    ctx.fillStyle = 'rgba(217,207,174,.45)'
    ctx.fillText(
      `matches ${record.won}–${record.lost}` + (record.best ? ` · best leg ${record.best} darts` : ''),
      w / 2, 512,
    )
    chalkTex.needsUpdate = true
  }
  drawChalk()
  const chalkPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.68),
    std({ map: chalkTex, roughness: 0.95 }),
  )
  chalkPlane.position.set(-0.6, 0, 0.018)
  dartsGroup.add(chalkPlane)
  // spare darts on the right door
  const spareTex = track(paint(220, 440, (ctx, w, h) => {
    ctx.fillStyle = '#2a1d18'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = 'rgba(200,151,90,.35)'
    ctx.lineWidth = 3
    ctx.strokeRect(10, 10, w - 20, h - 20)
    for (let i = 0; i < 3; i++) {
      const x = 60 + i * 50
      ctx.strokeStyle = '#c8975a'
      ctx.lineWidth = 5
      ctx.beginPath(); ctx.moveTo(x, 120); ctx.lineTo(x, 250); ctx.stroke()
      ctx.fillStyle = '#b3542f'
      ctx.fillRect(x - 4, 250, 8, 44)
      ctx.fillStyle = '#e8dcc4'
      ctx.beginPath()
      ctx.moveTo(x, 294); ctx.lineTo(x - 16, 330); ctx.lineTo(x, 322)
      ctx.lineTo(x + 16, 330); ctx.closePath()
      ctx.fill()
    }
  }))
  const sparePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.68),
    std({ map: spareTex, roughness: 0.9 }),
  )
  sparePlane.position.set(0.6, 0, 0.018)
  dartsGroup.add(sparePlane)
  // the board: sisal backing + painted face
  const boardBack = cyl(0.27, 0.27, 0.05, 48, std({ color: 0x1a1218, roughness: 0.95 }), 0, 0, 0.043)
  boardBack.rotation.x = Math.PI / 2
  dartsGroup.add(boardBack)
  const boardFace = new THREE.Mesh(
    new THREE.CircleGeometry(0.27, 64),
    std({ map: track(paint(640, 640, dartboardFace)), roughness: 0.85 }),
  )
  boardFace.position.z = 0.069
  boardFace.userData.dart = true
  pickables.push(boardFace)
  dartsGroup.add(boardFace)
  // warm halo + its own picture light: the room says "this one plays"
  const dartHaloMat = track(new THREE.MeshBasicMaterial({
    map: track(softDot()), color: 0xe0b578, transparent: true,
    opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false,
  }))
  const dartHalo = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), dartHaloMat)
  dartHalo.position.z = -0.02
  dartsGroup.add(dartHalo)
  const dartHood = cyl(0.045, 0.055, 0.22, 10, brassGlow, 0, 0.56, 0.13)
  dartHood.rotation.z = Math.PI / 2
  dartsGroup.add(dartHood)
  const dartSpot = new THREE.PointLight(0xffd9a0, 3.2, 2.6, 2)
  dartSpot.position.set(0, 0.5, 0.3)
  dartsGroup.add(dartSpot)

  // ── THE CROWD ──────────────────────────────────────────────────────────
  //
  // A game needs somebody watching it. The regulars come over from the bar
  // when the darts are worth watching and drift back when they are not, and
  // how many of them are standing at the oche IS the multiplier on everything
  // the house pays. The room's attention is a number, and you can see it.
  //
  // They are silhouettes on purpose — dark cloth, a head, one arm and a glass,
  // lit by the board's own picture light. Faces would make them characters,
  // and they are not characters, they are the ROOM.
  const crowdGroup = new THREE.Group()
  scene.add(slot('slot-darts', crowdGroup))
  /** Where they stand, in the order they arrive.
   *
   *  The first four are up by the board and out to the sides, INSIDE what the
   *  oche camera can see — a crowd you cannot see is not a crowd, and the
   *  multiplier has to be a thing standing there rather than a number on a
   *  board. The rest fill in behind, for the room view. The throwing lane and
   *  the drinks cart are left clear: nobody stands in the flight. */
  const CROWD_SPOTS: Array<[number, number]> = [
    [-4.95, 2.30], [-4.90, -0.30],
    [-5.05, 2.85], [-5.00, -0.85],
    [-4.35, 2.95], [-4.30, -0.95],
    [-3.60, 2.55], [-3.55, -0.55],
    [-2.85, 2.85], [-2.80, -0.85],
    [-3.85, 3.30], [-3.80, -1.30],
  ]
  // Nearly black on purpose. They stand a foot off the wall the board is on,
  // under its picture light, so anything with real colour in it blows out and
  // reads as furniture; dark cloth with a brass rim on it reads as a man.
  const crowdCloth = [0x1a141f, 0x1d1512, 0x141019, 0x211812, 0x181420, 0x1e1a24]
    .map(c => std({ color: c, roughness: 0.97, metalness: 0 }))
  const crowdSkin = std({ color: 0x4a332a, roughness: 0.9, metalness: 0 })
  const crowdGlass = std({
    color: 0xa8845a, roughness: 0.34, metalness: 0.2,
    transparent: true, opacity: 0.55,
  })
  type Regular = {
    g: THREE.Group
    /** The glass hand, on a shoulder pivot, so the room can raise it. */
    arm: THREE.Group
    base: [number, number]
    phase: number
    tall: number
    /** 0 sat down at the bar · 1 standing at the oche. */
    p: number
  }
  const crowd: Regular[] = CROWD_SPOTS.map(([x, z], i) => {
    const g = new THREE.Group()
    g.position.set(x, 0, z)
    // square to the board, whichever side of the lane they are on
    g.rotation.y = Math.atan2(-HALF_W + 0.1 - x, 1.0 - z)
    const cloth = crowdCloth[i % crowdCloth.length]
    const legs = cyl(0.13, 0.17, 0.86, 8, cloth, 0, 0.43, 0)
    g.add(legs)
    const coat = cyl(0.185, 0.15, 0.64, 10, cloth, 0, 1.16, 0)
    g.add(coat)
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), cloth)
    shoulders.scale.set(1, 0.42, 0.78)
    shoulders.position.y = 1.47
    g.add(shoulders)
    // the far arm, hanging. Without it the silhouette is a bollard with a hat.
    const idle = cyl(0.042, 0.036, 0.44, 6, cloth, -0.185, 1.2, 0.02)
    idle.rotation.z = 0.07
    g.add(idle)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), crowdSkin)
    head.position.set(0, 1.62, 0.01)
    g.add(head)
    if (i % 3 === 0) {
      g.add(cyl(0.16, 0.16, 0.012, 12, cloth, 0, 1.7, 0.01))
      g.add(cyl(0.1, 0.11, 0.09, 12, cloth, 0, 1.75, 0.01))
    }
    const arm = new THREE.Group()
    arm.position.set(0.185, 1.42, 0.03)
    arm.rotation.x = -0.12
    arm.add(cyl(0.045, 0.04, 0.42, 6, cloth, 0, -0.21, 0))
    arm.add(cyl(0.038, 0.032, 0.075, 10, crowdGlass, 0, -0.46, 0.02))
    g.add(arm)
    // Only the legs cast: twelve figures' worth of shadow casters on the
    // chandelier is a frame budget spent on shapes nobody looks at.
    g.traverse(o => { if (o !== legs) (o as THREE.Mesh).castShadow = false })
    crowdGroup.add(g)
    return { g, arm, base: [x, z], phase: i * 1.73, tall: 0.94 + ((i * 37) % 13) / 100, p: 0 }
  })

  // ── THE SMOKE RINGS ────────────────────────────────────────────────────
  //
  // Somebody in a wingback blows a ring and it drifts across the board. It
  // hangs over a bed for a few seconds — by preference the bed you are about
  // to need, because the room is reading your checkout too — and a dart put
  // through it pays by how near the middle of it went.
  //
  // It is the only bonus in the house that is about accuracy rather than
  // arithmetic, and it is the one that makes the lounge itself part of the
  // game: the smoke comes from the room, not from the board.
  const smokeMat = track(new THREE.MeshBasicMaterial({
    color: 0xcfc4b4, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }))
  const smokeMesh = new THREE.Mesh(track(new THREE.TorusGeometry(SMOKE_RING.r, 0.0055, 8, 44)), smokeMat)
  smokeMesh.visible = false
  smokeMesh.position.z = 0.098
  dartsGroup.add(smokeMesh)
  /** The live ring: where it started, where it is going, and how old it is. */
  let smokeRing: { x: number; y: number; from: number; t: number } | null = null
  let smokeWait = 7
  /** Where a ring is worth putting: the bed you need if you have a checkout,
   *  otherwise one of the beds anybody would be aiming at anyway. */
  const smokeSpot = (): { x: number; y: number } => {
    const out = checkout(seats[0].score, 3)
    const label = out ? out[out.length - 1] : ['T20', 'T19', 'BULL', 'T18', 'D16'][Math.floor(Math.random() * 5)]
    const shot = parseShot(label)
    const c = bedCentre(shot.n, shot.mult)
    return { x: c.x, y: c.y }
  }

  // ── THE POPS ───────────────────────────────────────────────────────────
  // Brass light off the sisal when the room reacts. Restraint: a soft dot that
  // grows and goes, no sparks, no confetti — this is a lounge.
  const popMat = track(new THREE.MeshBasicMaterial({
    map: track(softDot()), color: 0xffd9a0, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  }))
  const popGeo = track(new THREE.PlaneGeometry(1, 1))
  const pops = Array.from({ length: 5 }, () => {
    const m = new THREE.Mesh(popGeo, popMat.clone())
    m.visible = false
    m.position.z = 0.076
    dartsGroup.add(m)
    return { m, t: 0, size: 0.3 }
  })
  const popAt = (x: number, y: number, size: number): void => {
    const p = pops.find(q => q.t <= 0) ?? pops[0]
    p.m.position.set(x, y, 0.076)
    p.t = 1
    p.size = size
    p.m.visible = true
  }

  /** How loud the room is, right now. The roar drives everything at once — the
   *  shake, the fire, how far the crowd comes out of its seat — because a thing
   *  that is loud in only one register reads as a bug. */
  let shake = 0
  let crowdRise = 0
  let roomFlare = 0
  /** How committed the room is to the board: 0 you are sitting by the fire,
   *  1 you are AT the oche and the lounge has gone quiet for it. */
  let oche = 0
  let sinceThrow = 999
  let viewIsDarts = false
  const roar = (level: number): void => {
    if (level <= 0) return
    shake = Math.max(shake, 0.22 + level * 0.26)
    crowdRise = Math.max(crowdRise, 0.45 + level * 0.18)
    roomFlare = Math.max(roomFlare, level >= 3 ? 1 : level * 0.3)
  }

  // thrown darts — shared geometry, three on the board at most
  const stuck = new THREE.Group()
  dartsGroup.add(stuck)
  const dartNeedleGeo = track(new THREE.CylinderGeometry(0.0022, 0.0022, 0.045, 6))
  const dartBarrelGeo = track(new THREE.CylinderGeometry(0.0055, 0.0045, 0.038, 8))
  const dartShaftGeo = track(new THREE.CylinderGeometry(0.0032, 0.0032, 0.034, 6))
  const dartFlightGeo = track(new THREE.PlaneGeometry(0.026, 0.034))
  const dartShaftMat = std({ color: C.ember, roughness: 0.5 })
  const dartFlightMat = std({ color: C.cream, roughness: 0.8, side: THREE.DoubleSide })
  /** One dart, built where it is told. Shared by the flight and the landing —
   *  the thing you watch fly IS the thing that ends up in the board. */
  const buildDart = (seed: number): THREE.Group => {
    const d = new THREE.Group()
    d.rotation.set(Math.sin(seed * 7) * 0.07, Math.cos(seed * 3) * 0.07, 0)
    const needle = new THREE.Mesh(dartNeedleGeo, brassMat)
    needle.rotation.x = Math.PI / 2
    needle.position.z = 0.012
    d.add(needle)
    const barrel = new THREE.Mesh(dartBarrelGeo, brassMat)
    barrel.rotation.x = Math.PI / 2
    barrel.position.z = 0.052
    d.add(barrel)
    const shaft = new THREE.Mesh(dartShaftGeo, dartShaftMat)
    shaft.rotation.x = Math.PI / 2
    shaft.position.z = 0.088
    d.add(shaft)
    const f1 = new THREE.Mesh(dartFlightGeo, dartFlightMat)
    f1.rotation.x = Math.PI / 2
    f1.position.z = 0.108
    d.add(f1)
    const f2 = new THREE.Mesh(dartFlightGeo, dartFlightMat)
    f2.rotation.x = Math.PI / 2
    f2.rotation.y = Math.PI / 2
    f2.position.z = 0.108
    d.add(f2)
    return d
  }

  // ── THE THROW — where the skill is ─────────────────────────────────────
  //
  // Clicking a spot and having the dart appear there is not a game; it is a
  // scoring calculator with a 3D model attached. The board is not hard to
  // point at. What is hard about darts is holding still and letting go at the
  // right moment, so that is what this asks for and nothing else.
  //
  //   PRESS on the board   — you name your target. A brass bead starts to
  //                          orbit it, and a ring shows how wide it is running.
  //   HOLD                 — the orbit BREATHES: it winds all the way in to a
  //                          point and back out again, about once a second.
  //                          You may re-aim while holding, but the breath does
  //                          not restart for you.
  //   RELEASE              — the bead's offset AT THAT INSTANT is your error,
  //                          near enough exactly. Let go on the tight ring and
  //                          the dart goes where you pointed. Let go anywhere
  //                          else and it goes where the bead was.
  //
  // One input, both axes, no meters to read: the error you are about to make
  // is drawn on the board, at the size you are about to make it. That is a
  // skill you can feel yourself getting better at inside three throws — and it
  // is the same skill real darts asks for, which is the point.
  //
  // DITHERING COSTS. After `AIM_NERVE` seconds the whole orbit starts growing:
  // stand there long enough and even the tight moment is not tight. There is
  // no waiting for a perfect window, only taking the next one.

  /** Seconds per breath — one tight window per pass. */
  const AIM_PERIOD = 1.15
  /** Widest wobble and the eye of the breath, in board-local units (r = 0.27). */
  const AIM_MAX = 0.055
  const AIM_MIN = 0.003
  /** How fast the bead goes round. Fast enough that the tight moment is a
   *  moment, slow enough to be a decision rather than a reflex. */
  const AIM_SPIN = 5.1
  /** Grace before nerves set in. */
  const AIM_NERVE = 3.2

  /** The bead's offset from the aim point after `held` seconds. */
  const beadAt = (held: number): { x: number; y: number; r: number } => {
    const breath = Math.pow(Math.abs(Math.cos((Math.PI * held) / AIM_PERIOD)), 1.5)
    const nerve = 1 + Math.max(0, held - AIM_NERVE) * 0.6
    const r = (AIM_MIN + (AIM_MAX - AIM_MIN) * breath) * nerve
    // The spin drifts, so the tight moment is never in the same direction
    // twice — you cannot learn one release and repeat it forever.
    const a = held * AIM_SPIN + Math.sin(held * 0.7) * 1.2
    return { x: Math.sin(a) * r, y: Math.cos(a) * r, r }
  }

  // The reticle: a ring at the current wobble radius and the bead riding it.
  // Additive and depth-free so they read as light on the board rather than
  // stickers on it.
  const aimGroup = new THREE.Group()
  aimGroup.position.z = 0.0715
  aimGroup.visible = false
  dartsGroup.add(aimGroup)
  const aimRingGeo = track(new THREE.RingGeometry(0.94, 1, 56))
  const aimRingMat = new THREE.MeshBasicMaterial({
    color: 0xe0b578, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  })
  const aimRing = new THREE.Mesh(aimRingGeo, track(aimRingMat))
  aimGroup.add(aimRing)
  const aimCrossMat = track(new THREE.MeshBasicMaterial({
    color: 0xe8dcc4, transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  }))
  const aimCross = new THREE.Mesh(track(new THREE.CircleGeometry(0.0035, 12)), aimCrossMat)
  aimGroup.add(aimCross)
  const beadMat = new THREE.MeshBasicMaterial({
    color: 0xffd9a0, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  })
  const bead = new THREE.Mesh(track(new THREE.CircleGeometry(0.007, 14)), track(beadMat))
  aimGroup.add(bead)

  /** The throw in progress: where you pointed, and how long you have held. */
  let aim: { x: number; y: number; held: number } | null = null
  /** Darts in the air. */
  type Flight = {
    g: THREE.Group; from: THREE.Vector3; to: THREE.Vector3; t: number; hit: DartHit
    /** Where it landed, board-local — the side bets need the sisal, not the score. */
    at: { x: number; y: number }
  }
  const flights: Flight[] = []
  /** Deferred beats — the pause before the Colonel steps up, the pause on a
   *  bust so you can read it. Ticked down with the room, so they stop when the
   *  scene is off-screen instead of firing into a paused room. */
  const beats: Array<{ t: number; fn: () => void }> = []
  const after = (t: number, fn: () => void): void => { beats.push({ t, fn }) }
  /** True while the Colonel has the darts — the board refuses yours. */
  let houseThrowing = false

  const FLIGHT_DUR = 0.26
  /** Where a dart is released from, in board-local space: down and to the
   *  right of the board, out toward the oche. */
  const LAUNCH = new THREE.Vector3(0.22, -0.34, 1.15)

  /** Send a dart to a landing point and score it when it arrives. */
  const launch = (x: number, y: number): void => {
    const hit = scoreDart(x, y)
    const g = buildDart(flights.length + turnDarts.length + x * 31)
    const to = new THREE.Vector3(x, y, 0.069)
    g.position.copy(LAUNCH)
    stuck.add(g)
    flights.push({ g, from: LAUNCH.clone(), to, t: 0, hit, at: { x, y } })
    sinceThrow = 0
  }

  /**
   * WHAT THE ROOM DOES ABOUT IT — every call in the house comes through here.
   *
   * The crowd moves FIRST and the house pays at the new multiplier, which is
   * the right way round: a ton eighty fills the room and then pays for a full
   * one. Nothing in this function knows the score, and nothing downstream of
   * it can change one. That is the whole arrangement.
   */
  const reactTo = (spec: CallSpec, mine: boolean, doubled = false, quiet = false): number => {
    fans = applyFans(fans, spec)
    const mult = crowdMultiplier(fans)
    const paid = mine ? spec.embers * mult * (doubled ? SIDE_BET_FACTOR : 1) : 0
    if (paid > 0) {
      // The ledger lives on the page. The board only ever says what happened.
      window.dispatchEvent(new CustomEvent('lounge3d:call', {
        detail: {
          id: spec.id, shout: spec.shout, label: spec.label ?? spec.shout,
          base: spec.embers, mult, doubled, embers: paid, fans, at: Date.now(),
        },
      }))
    }
    if (spec.shout && !quiet) {
      const sub = paid > 0
        ? '+' + paid + ' embers' +
          (doubled ? ' · tonight’s bet, doubled'
            : mult > 1 ? ' · ' + spec.embers + ' × ' + mult : '')
        : ''
      banner = { shout: spec.shout, sub, t: 2.7 }
    }
    roar(spec.roar)
    return paid
  }

  /** THE ALTERNATE SCORE. Rings counted up, and the regulars they bring over —
   *  the only thing in the room that pays no attention at all to the leg. */
  const addTally = (hit: DartHit): void => {
    tally = Math.max(0, tally + tallyOf(hit))
    const owed = tallyFans(tally) - tallyGiven
    if (owed > 0) {
      tallyGiven += owed
      fans = Math.min(FANS_MAX, fans + owed)
      banner = { shout: 'THE ROOM COUNTS ' + tally, sub: 'another one over from the bar', t: 2.2 }
      roar(1)
    }
    saveRecord()
  }

  /** The turn as the room saw it: its name, and every side bet the SHAPE of it
   *  won. A bust pays nothing at all — nobody scored. The bets are paid poorest
   *  first, so the dearest one is the one left chalked on the board. */
  const endTurn = (busted: boolean): void => {
    const mine = turnSeat === 0
    const tc = turnCall(turnDarts, busted)
    if (!mine) {
      // The room turns to watch HIM, and a crowd facing the other way is worth
      // nothing to you.
      if (!busted && turnDarts.reduce((n, h) => n + h.points, 0) >= 100) reactTo(CALLS.housed, false)
      return
    }
    // The turn's own name goes up FIRST and keeps the chalk: a ton eighty is
    // not upstaged by the fact that it was also three even numbers. The bets
    // pay quietly underneath it, at the fuller room the big call just brought
    // in, and are listed on the second line.
    if (tc) reactTo(tc, true)
    if (!busted) sideBetsRide(!!tc)
  }

  /** The side bets on the turn just thrown, paid quietly and listed under
   *  whatever the room is already shouting. Called from the end of a turn AND
   *  from a leg won mid-turn — three primes that happen to check out are still
   *  three primes, and it would be a mean house that noticed only one of them.
   *
   *  `headlined` says something is already on the chalk to ride under. */
  const sideBetsRide = (headlined: boolean): void => {
    const bets = quirkCalls(turnDarts, turnLandings).sort((a, b) => a.embers - b.embers)
    let extra = 0
    for (const q of bets) extra += reactTo(q, true, q.id === sideBet, true)
    if (!bets.length) return
    const names = bets.map(b => b.shout.toLowerCase()).reverse().join(' · ')
    const paid = extra > 0 ? '+' + extra : ''
    if (headlined && banner) {
      banner.sub = [banner.sub, names, paid].filter(Boolean).join(' · ')
    } else {
      const best = bets[bets.length - 1]
      banner = {
        shout: best.shout,
        sub: [paid ? paid + ' embers' : '', bets.length > 1 ? names : ''].filter(Boolean).join(' · '),
        t: 2.7,
      }
    }
  }

  /** 501, applied. Everything that makes the last hundred hard lives here. */
  const applyHit = (hit: DartHit, at: { x: number; y: number }): void => {
    const seat = seats[turnSeat]
    const mine = turnSeat === 0
    turnDarts.push(hit)
    turnLandings.push(at)

    if (mine) {
      legDarts += 1
      addTally(hit)
      // THROUGH THE SMOKE — the ring is scored where it was when the dart
      // arrived, and a threaded ring is spent: the room does not blow two.
      if (smokeRing && smokeMat.opacity > 0.12) {
        const sc = smokeCall(Math.hypot(at.x - smokeRing.x, at.y - smokeRing.y))
        if (sc) {
          reactTo(sc, true, sideBet === sc.id)
          popAt(smokeRing.x, smokeRing.y, 0.55)
          smokeRing = null
          smokeMesh.visible = false
          smokeWait = SMOKE_RING.gapMin * 0.7
        }
      }
      const dc = dartCall(hit)
      if (dc) reactTo(dc, true)
      if (hit.mult === 3 || hit.label === 'D·BULL') popAt(at.x, at.y, 0.32)
    }

    const res = resolveThrow(seat.score, hit)
    if (res.outcome === 'bust') {
      // A bust gives the WHOLE turn back, not just this dart.
      seat.score = turnStart
      chalkNote = res.reason === 'no-double' ? 'not a double — bust'
        : res.reason === 'left-one' ? 'left on one — bust'
        : 'bust'
      endTurn(true)
      drawChalk()
      after(1.3, () => nextTurn())
      return
    }
    seat.score = res.score
    if (res.outcome === 'leg') {
      seat.legs += 1
      reactTo(mine ? legCall({ darts: legDarts, turnStart, finish: hit }) : CALLS.houseleg, mine)
      if (mine) sideBetsRide(true)
      if (mine && (record.best === 0 || legDarts < record.best)) record.best = legDarts
      saveRecord()
      chalkNote = seat.name.toLowerCase() + ' takes the leg'
      popAt(at.x, at.y, 0.6)
      // The page pays Embers for a leg taken off the house. On `window`, not
      // the host element — buildRoom never sees the mount.
      window.dispatchEvent(new CustomEvent('lounge3d:leg', {
        detail: { who: seat.name, legs: seat.legs, house: seat.name !== 'YOU', darts: legDarts },
      }))
      drawChalk()
      if (seat.legs >= MATCH_LEGS) after(2.4, () => endMatch(mine))
      else after(2.0, () => newLeg())
      return
    }
    if (turnDarts.length >= 3) {
      chalkNote = (turnStart - seat.score) + ' scored'
      endTurn(false)
      drawChalk()
      after(1.3, () => nextTurn())
      return
    }
    chalkNote = hit.points === 0 ? 'off the wire' : (3 - turnDarts.length) + ' in hand'
    drawChalk()
    if (houseThrowing) after(0.75, () => houseDart())
  }

  const clearBoard = (): void => { stuck.clear() }

  const nextTurn = (): void => {
    turnSeat = turnSeat === 0 ? 1 : 0
    turnDarts = []
    turnLandings = []
    turnStart = seats[turnSeat].score
    clearBoard()
    if (turnSeat === 1) {
      houseThrowing = true
      chalkNote = 'the colonel steps up'
      drawChalk()
      after(0.9, () => houseDart())
    } else {
      houseThrowing = false
      chalkNote = 'your throw'
      drawChalk()
    }
  }

  /** Alternate the throw each leg — the loser of a leg starts the next, which
   *  is the only mercy the game offers. A fresh leg draws a fresh side bet, so
   *  the quirk nobody has ever hit gets its evening eventually. */
  let legStarter = 0
  const newLeg = (): void => {
    seats[0].score = 501
    seats[1].score = 501
    legStarter = legStarter === 0 ? 1 : 0
    turnSeat = legStarter
    turnDarts = []
    turnLandings = []
    turnStart = 501
    legDarts = 0
    sideBet = drawSideBet()
    banner = null
    clearBoard()
    houseThrowing = turnSeat === 1
    chalkNote = houseThrowing ? 'the colonel throws first' : 'you throw first'
    drawChalk()
    if (houseThrowing) after(1.0, () => houseDart())
  }

  /** THE MATCH — three legs. The crowd you earned on the way stays where it is:
   *  form is the one thing in this room that carries over. */
  const endMatch = (mine: boolean): void => {
    reactTo(mine ? CALLS.match : CALLS.housematch, mine)
    if (mine) record.won += 1
    else record.lost += 1
    saveRecord()
    chalkNote = mine ? 'the match is yours' : 'the colonel keeps the board'
    window.dispatchEvent(new CustomEvent('lounge3d:match', {
      detail: { won: mine, legs: [seats[0].legs, seats[1].legs], record: { ...record }, at: Date.now() },
    }))
    drawChalk()
    after(3.4, () => {
      seats[0].legs = 0
      seats[1].legs = 0
      newLeg()
    })
  }

  /** The Colonel's hand. Gaussian scatter about the bed he wants — good enough
   *  to punish a loose leg, human enough to miss a double. He is beatable; he
   *  is not a pushover. */
  const houseDart = (): void => {
    if (!houseThrowing) return
    const seat = seats[1]
    const shot = pickShot(seat.score, 3 - turnDarts.length)
    const c = bedCentre(shot.n, shot.mult)
    const g = (): number => {
      // Box–Muller, so the miss is a scatter and not a square.
      const u = Math.max(1e-6, Math.random())
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random())
    }
    const sigma = 0.0145
    launch(c.x + g() * sigma, c.y + g() * sigma)
  }

  /** The board's whole input surface. Returns false when it is not your throw
   *  — the press then falls through to the room's ordinary orbit. */
  const beginAim = (world: THREE.Vector3): boolean => {
    if (houseThrowing || flights.length > 0 || turnSeat !== 0) return false
    const p = dartsGroup.worldToLocal(world.clone())
    aim = { x: p.x, y: p.y, held: 0 }
    aimGroup.visible = true
    return true
  }

  const moveAim = (world: THREE.Vector3): void => {
    if (!aim) return
    const p = dartsGroup.worldToLocal(world.clone())
    // Re-aiming is free; the breath is not. Moving your point does not buy you
    // a fresh window, which is what stops "hold forever, slide onto the bull".
    aim.x = p.x
    aim.y = p.y
  }

  const releaseAim = (): DartHit | null => {
    const a = aim
    if (!a) return null
    aim = null
    aimGroup.visible = false
    const b = beadAt(a.held)
    // A whisper of luck on top of the bead, so an identical release is not an
    // identical dart — enough to keep it alive, far too little to beat a
    // steady hand.
    const jitter = 0.0022
    const x = a.x + b.x + (Math.random() - 0.5) * jitter
    const y = a.y + b.y + (Math.random() - 0.5) * jitter
    launch(x, y)
    return scoreDart(x, y)
  }

  const cancelAim = (): void => { aim = null; aimGroup.visible = false }

  /** Animate the aim bead, the darts in the air, the crowd, the smoke and the
   *  room's own attention. Driven by the room's tick so everything stops
   *  together when the scene leaves the screen. */
  const tickDarts = (t: number, dt: number): void => {
    for (let i = beats.length - 1; i >= 0; i--) {
      const beat = beats[i]
      beat.t -= dt
      if (beat.t <= 0) { beats.splice(i, 1); beat.fn() }
    }

    // The shout fades off the chalk. Redrawn on a twelfth of a second while it
    // goes, not every frame — it is a 260-pixel canvas, not a display.
    if (banner) {
      const was = banner.t
      banner.t -= dt
      if (banner.t <= 0) { banner = null; drawChalk() }
      else if (banner.t < 0.6 && Math.floor(was * 12) !== Math.floor(banner.t * 12)) drawChalk()
    }

    // ── THE ROOM'S ATTENTION ───────────────────────────────────────────
    // You never leave the lounge to play; the lounge comes to the board. At
    // the oche the general light eases down, the board's own picture light
    // comes up, and the halo behind it opens — the room commits to the game
    // and everything else in it goes quiet.
    sinceThrow += dt
    const atOche = viewIsDarts || !!aim || flights.length > 0 || sinceThrow < 22
    oche += ((atOche ? 1 : 0) - oche) * Math.min(1, dt * 2.4)
    chandelierLight.intensity = 16 - oche * 7.5
    hemi.intensity = 1.15 - oche * 0.42
    roomFill.intensity = 13 - oche * 5.5
    dartSpot.intensity = 3.2 + oche * 2.6
    dartHaloMat.opacity = 0.2 + oche * 0.2

    // ── THE ROAR ───────────────────────────────────────────────────────
    // Trauma, spent down. The shake moves the ROOM rather than the camera:
    // the orbit controls own the camera and would fight for it every frame.
    shake = Math.max(0, shake - dt * 2.1)
    crowdRise = Math.max(0, crowdRise - dt * 0.72)
    roomFlare = Math.max(0, roomFlare - dt * 1.35)
    const jolt = shake * shake * 0.045
    scene.position.set(Math.sin(t * 71) * jolt, Math.cos(t * 53) * jolt * 0.6, 0)

    // ── THE CROWD ──────────────────────────────────────────────────────
    // They stand up for the darts and sit back down when the room loses
    // interest. The hush is you on the board about to throw: the sway stops,
    // and they lean in.
    const hush = aim ? 1 : 0
    for (let i = 0; i < crowd.length; i++) {
      const c = crowd[i]
      const here = oche > 0.12 && i < fans
      c.p += ((here ? 1 : 0) - c.p) * Math.min(1, dt * (here ? 2.6 : 1.5))
      const seen = c.p > 0.02
      c.g.visible = seen
      if (!seen) continue
      c.g.rotation.z = Math.sin(t * 1.05 + c.phase) * 0.022 * (1 - hush * 0.85)
      c.g.scale.set(1, c.tall * (0.44 + c.p * 0.56), 1)
      c.g.position.set(
        c.base[0] + (1 - c.p) * 0.34 - hush * 0.035,
        crowdRise * 0.035 * Math.abs(Math.sin(t * 8.6 + c.phase)),
        c.base[1],
      )
      // glasses up when the room goes up
      c.arm.rotation.x = -0.12 - crowdRise * (1.9 + Math.sin(t * 7.4 + c.phase) * 0.25)
    }

    // ── THE SMOKE RINGS ────────────────────────────────────────────────
    if (smokeRing) {
      smokeRing.t += dt
      const age = smokeRing.t / SMOKE_RING.life
      if (age >= 1) {
        smokeRing = null
        smokeMesh.visible = false
        smokeWait = SMOKE_RING.gapMin + Math.random() * (SMOKE_RING.gapMax - SMOKE_RING.gapMin)
      } else {
        smokeRing.x = smokeRing.from + age * SMOKE_RING.drift
        const fade = Math.min(1, smokeRing.t / 0.9) * Math.min(1, (SMOKE_RING.life - smokeRing.t) / 1.3)
        smokeMat.opacity = 0.34 * fade
        smokeMesh.position.set(smokeRing.x, smokeRing.y + Math.sin(smokeRing.t * 0.8) * 0.006, 0.098)
        // smoke widens and thins as it goes, and turns over slowly
        smokeMesh.scale.setScalar(1 + age * 0.3)
        smokeMesh.rotation.z = smokeRing.t * 0.35
      }
    } else if (oche > 0.5 && !houseThrowing && !aim) {
      smokeWait -= dt
      if (smokeWait <= 0) {
        const spot = smokeSpot()
        const from = spot.x - SMOKE_RING.drift / 2
        smokeRing = { x: from, y: spot.y, from, t: 0 }
        smokeMat.opacity = 0
        smokeMesh.visible = true
      }
    }

    // ── THE POPS ───────────────────────────────────────────────────────
    for (const q of pops) {
      if (q.t <= 0) continue
      q.t -= dt * 2.4
      const e = 1 - Math.max(0, q.t)
      const mat = q.m.material as THREE.MeshBasicMaterial
      q.m.scale.setScalar(0.02 + e * q.size)
      mat.opacity = Math.max(0, 1 - e) * 0.8
      if (q.t <= 0) { q.m.visible = false; mat.opacity = 0 }
    }

    if (aim) {
      aim.held += dt
      const b = beadAt(aim.held)
      aimGroup.position.x = aim.x
      aimGroup.position.y = aim.y
      aimRing.scale.setScalar(Math.max(b.r, 0.0001))
      bead.position.set(b.x, b.y, 0)
      // THE TELL: the ring brightens as it closes. The whole skill is reading
      // this one value, so it is the one thing on the board that changes
      // colour — tight is warm and near-white, loose is a dim amber.
      const tight = 1 - Math.min(1, (b.r - AIM_MIN) / (AIM_MAX - AIM_MIN))
      aimRingMat.opacity = 0.32 + tight * 0.6
      aimRingMat.color.setRGB(1, 0.72 + tight * 0.26, 0.42 + tight * 0.5)
      beadMat.opacity = 0.6 + tight * 0.4
    }

    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i]
      f.t += dt / FLIGHT_DUR
      if (f.t >= 1) {
        f.g.position.copy(f.to)
        f.g.rotation.set(Math.sin(f.to.x * 31) * 0.07, Math.cos(f.to.y * 23) * 0.07, 0)
        flights.splice(i, 1)
        applyHit(f.hit, f.at)
        continue
      }
      const e = f.t
      f.g.position.lerpVectors(f.from, f.to, e)
      // A dart is thrown UP and drops in. Without the arc it reads as a laser.
      f.g.position.y += Math.sin(e * Math.PI) * 0.055
      f.g.rotation.z = (1 - e) * 0.5
    }
  }

  /** The page tells the board when the camera has come to the oche — the room
   *  dims for a match, and a match is what the darts view IS. */
  const setView = (name: string): void => { viewIsDarts = name === 'darts' }

  /** What the chalk says, for the page and for a harness. Read-only. */
  const ocheState = (): Record<string, unknown> => ({
    you: seats[0].score, house: seats[1].score,
    legs: [seats[0].legs, seats[1].legs],
    turn: turnSeat === 0 ? 'you' : 'house',
    darts: turnDarts.map(d => d.label),
    fans, mult: crowdMultiplier(fans), tally, sideBet,
    ring: smokeRing
      ? { x: +smokeRing.x.toFixed(4), y: +smokeRing.y.toFixed(4), lit: +smokeMat.opacity.toFixed(3) }
      : null,
    shout: banner?.shout ?? '', note: chalkNote, record: { ...record },
    oche: +oche.toFixed(2), crowdUp: crowd.filter(c => c.g.visible).length,
  })

  /** Put a dart in at a board-local point, no aim and no skill — the Colonel's
   *  own path in. It is here so the game can be driven by a test harness
   *  through `RevLounge3D.oche`; the ledger it feeds is local to this browser,
   *  same as the rest of the purse. */
  const throwAt = (x: number, y: number): boolean => {
    if (houseThrowing || turnSeat !== 0 || flights.length > 0) return false
    launch(x, y)
    return true
  }

  // ── window (right wall) ────────────────────────────────────────────────
  const windowGroup = new THREE.Group()
  windowGroup.position.set(HALF_W - 0.04, 1.85, 1.1)
  windowGroup.rotation.y = -Math.PI / 2
  scene.add(slot('slot-window', windowGroup))
  const night = new THREE.Mesh(
    new THREE.PlaneGeometry(2.1, 1.7),
    new THREE.MeshBasicMaterial({ map: track(skyTexture()) }),
  )
  night.position.z = -0.02
  windowGroup.add(night)
  const mull = std({ color: C.wood, roughness: 0.6 })
  windowGroup.add(box(2.34, 0.12, 0.14, mull, 0, 0.91, 0.02))
  windowGroup.add(box(2.34, 0.12, 0.14, mull, 0, -0.91, 0.02))
  windowGroup.add(box(0.12, 1.94, 0.14, mull, -1.11, 0, 0.02))
  windowGroup.add(box(0.12, 1.94, 0.14, mull, 1.11, 0, 0.02))
  windowGroup.add(box(0.07, 1.7, 0.1, mull, 0, 0, 0.02))
  windowGroup.add(box(2.1, 0.07, 0.1, mull, 0, 0, 0.02))
  const curtain = std({ color: 0x3a1c26, roughness: 1 })
  windowGroup.add(box(0.42, 2.3, 0.1, curtain, -1.42, -0.1, 0.06))
  windowGroup.add(box(0.42, 2.3, 0.1, curtain, 1.42, -0.1, 0.06))
  const moon = new THREE.PointLight(0x8fa8d8, 3.2, 8, 2)
  moon.position.set(0, 0.4, 0.6)
  windowGroup.add(moon)

  // ── seating: two wingbacks + a settee-ish ottoman ──────────────────────
  const chairs = new THREE.Group()
  scene.add(slot('slot-chairs', chairs))

  const wingback = (x: number, z: number, ry: number): THREE.Group => {
    const g = new THREE.Group()
    g.position.set(x, 0, z)
    g.rotation.y = ry
    // frame
    g.add(box(0.86, 0.16, 0.86, leatherMat, 0, 0.44, 0))
    const cushion = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.62, 4, 10), leatherMat)
    cushion.rotation.z = Math.PI / 2
    cushion.position.set(0, 0.56, 0.02)
    cushion.castShadow = true
    g.add(cushion)
    // back + wings
    const back = box(0.86, 1.05, 0.16, leatherMat, 0, 1.0, -0.36, 0.06)
    back.rotation.x = -0.08
    g.add(back)
    for (const s of [-1, 1]) {
      const wing = box(0.16, 0.66, 0.34, leatherMat, s * 0.35, 1.18, -0.2, 0.05)
      wing.rotation.y = s * 0.12
      g.add(wing)
      const arm = box(0.16, 0.5, 0.8, leatherMat, s * 0.35, 0.62, 0.02, 0.06)
      g.add(arm)
      const roll = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.62, 4, 8), leatherDeep)
      roll.rotation.x = Math.PI / 2
      roll.position.set(s * 0.35, 0.88, 0.02)
      roll.castShadow = true
      g.add(roll)
    }
    // brass tacks along the wings
    for (let i = 0; i < 8; i++) {
      for (const s of [-1, 1]) {
        const tack = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), brassMat)
        tack.position.set(s * 0.44, 0.92 + i * 0.075, -0.16)
        g.add(tack)
      }
    }
    // legs
    for (const [lx, lz] of [[-0.34, 0.34], [0.34, 0.34], [-0.34, -0.34], [0.34, -0.34]]) {
      g.add(cyl(0.035, 0.045, 0.36, 8, darkWood, lx, 0.18, lz))
    }
    chairs.add(g)
    return g
  }
  wingback(-1.5, 1.15, 0.42)
  wingback(1.5, 1.15, -0.42)

  // a throw folded over the right chair's arm
  const throwCloth = box(0.22, 0.05, 0.62, std({ color: 0x7a4133, roughness: 1 }), 1.79, 0.92, 1.3, 0.02)
  throwCloth.rotation.set(0, -0.42, 0)
  chairs.add(throwCloth)
  const throwFall = box(0.2, 0.34, 0.1, std({ color: 0x7a4133, roughness: 1 }), 1.9, 0.75, 1.02, 0.02)
  throwFall.rotation.set(0, -0.42, 0)
  chairs.add(throwFall)

  const ottoman = box(0.8, 0.34, 0.6, leatherMat, 0, 0.2, 1.75, 0.07)
  chairs.add(ottoman)
  for (const [lx, lz] of [[-0.3, 1.53], [0.3, 1.53], [-0.3, 1.97], [0.3, 1.97]]) {
    chairs.add(cyl(0.03, 0.03, 0.06, 6, brassMat, lx, 0.03, lz))
  }

  // ── side table + the accessories that live on it ───────────────────────
  const tables = new THREE.Group()
  scene.add(slot('slot-tables', tables))

  const sideTable = (x: number, z: number): THREE.Group => {
    const g = new THREE.Group()
    g.position.set(x, 0, z)
    const top = cyl(0.34, 0.34, 0.05, 24, trimWood, 0, 0.58, 0)
    g.add(top)
    g.add(cyl(0.05, 0.07, 0.53, 10, darkWood, 0, 0.31, 0))
    g.add(cyl(0.2, 0.24, 0.05, 16, darkWood, 0, 0.05, 0))
    g.add(cyl(0.35, 0.35, 0.012, 24, brassMat, 0, 0.607, 0))
    tables.add(g)
    return g
  }
  const tableL = sideTable(-2.35, 1.0)
  const tableR = sideTable(2.35, 1.0)

  // low table in front of the fire
  const lowTable = new THREE.Group()
  lowTable.position.set(0, 0, 0.55)
  tables.add(lowTable)
  lowTable.add(box(1.5, 0.07, 0.8, trimWood, 0, 0.42, 0, 0.02))
  lowTable.add(box(1.36, 0.04, 0.66, std({ color: 0x1a1220, roughness: 0.25, metalness: 0.1 }), 0, 0.455, 0, 0.01))
  for (const [lx, lz] of [[-0.62, 0.3], [0.62, 0.3], [-0.62, -0.3], [0.62, -0.3]]) {
    lowTable.add(cyl(0.03, 0.04, 0.4, 8, darkWood, lx, 0.2, lz))
  }
  lowTable.add(box(1.3, 0.03, 0.6, darkWood, 0, 0.14, 0, 0.01)) // lower shelf
  // books on the shelf
  for (let i = 0; i < 3; i++) {
    lowTable.add(box(0.34, 0.045, 0.24, std({ color: [0x5b1f21, 0x2c3d52, 0x3a2a1c][i], roughness: 0.9 }), -0.3 + i * 0.02, 0.18 + i * 0.05, 0.02 + i * 0.03, 0.006))
  }

  // ── cigar accessories ──────────────────────────────────────────────────
  const accessories = new THREE.Group()
  scene.add(slot('slot-accessories', accessories))

  const cigarBody = std({ color: 0x6b4326, roughness: 0.85 })
  const cigarBand = std({ color: C.brass, roughness: 0.4, metalness: 0.5 })

  /** A cigar: rolled body, gold band, and a lit cap when `lit`. */
  const cigar = (len: number, lit: boolean): THREE.Group => {
    const g = new THREE.Group()
    const body = cyl(0.017, 0.02, len, 12, cigarBody, 0, 0, 0)
    body.rotation.z = Math.PI / 2
    g.add(body)
    const band = cyl(0.0205, 0.0205, 0.035, 12, cigarBand, -len * 0.32, 0, 0)
    band.rotation.z = Math.PI / 2
    g.add(band)
    if (lit) {
      const ash = cyl(0.017, 0.017, 0.06, 10, std({ color: 0xb8b0a4, roughness: 1 }), len * 0.5, 0, 0)
      ash.rotation.z = Math.PI / 2
      g.add(ash)
      const coal = cyl(0.016, 0.016, 0.012, 10, std({ color: C.ember, emissive: 0xff5a1e, emissiveIntensity: 2.4, roughness: 1 }), len * 0.53, 0, 0)
      coal.rotation.z = Math.PI / 2
      g.add(coal)
      g.userData.coal = coal
      const glow = new THREE.PointLight(0xff6a28, 0.9, 0.7, 2)
      glow.position.set(len * 0.55, 0, 0)
      g.add(glow)
      g.userData.glow = glow
    }
    return g
  }

  // ashtray on the low table, with a cigar resting in it
  const ashtray = new THREE.Group()
  ashtray.position.set(0.3, 0.475, 0.55)
  accessories.add(ashtray)
  const ashMat = std({ color: 0x14101a, roughness: 0.2, metalness: 0.1 })
  ashtray.add(cyl(0.15, 0.13, 0.045, 24, ashMat, 0, 0.022, 0))
  const bowl = cyl(0.115, 0.1, 0.03, 24, std({ color: 0x0a0810, roughness: 0.35 }), 0, 0.048, 0)
  ashtray.add(bowl)
  for (let i = 0; i < 4; i++) {
    const notch = box(0.05, 0.02, 0.035, ashMat, Math.cos((i / 4) * Math.PI * 2) * 0.14, 0.05, Math.sin((i / 4) * Math.PI * 2) * 0.14)
    notch.rotation.y = -(i / 4) * Math.PI * 2
    ashtray.add(notch)
  }
  const restingCigar = cigar(0.22, true)
  restingCigar.position.set(0.06, 0.075, 0.09)
  restingCigar.rotation.y = -0.7
  restingCigar.rotation.z = 0.07
  ashtray.add(restingCigar)
  slot('slot-smoke', restingCigar) // the ember + smoke ride with "a cigar going"

  // cutter, lighter, matchbook, and a leather cigar case on the low table
  const cutter = new THREE.Group()
  cutter.position.set(-0.42, 0.49, 0.66)
  cutter.rotation.y = 0.4
  accessories.add(cutter)
  const steel = std({ color: 0xbfc4c8, roughness: 0.24, metalness: 0.92 })
  cutter.add(box(0.13, 0.012, 0.075, steel, 0, 0, 0, 0.006))
  const cutterRing = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.006, 8, 20), steel)
  cutterRing.rotation.x = Math.PI / 2
  cutterRing.position.set(0, 0.007, 0)
  cutter.add(cutterRing)

  const lighter = box(0.05, 0.075, 0.026, std({ color: 0x8a6a3a, roughness: 0.3, metalness: 0.8 }), -0.16, 0.495, 0.72, 0.008)
  lighter.rotation.y = -0.3
  accessories.add(lighter)
  accessories.add(box(0.05, 0.008, 0.032, brassMat, -0.16, 0.535, 0.72, 0.004))

  const matchbook = box(0.07, 0.012, 0.05, std({ color: C.ember, roughness: 0.9 }), 0.56, 0.462, 0.72, 0.004)
  matchbook.rotation.y = 0.9
  accessories.add(matchbook)

  const cigarCase = box(0.2, 0.055, 0.09, std({ color: 0x3b2118, roughness: 0.7 }), -0.55, 0.48, 0.4, 0.014)
  cigarCase.rotation.y = -0.25
  accessories.add(cigarCase)
  accessories.add(box(0.2, 0.008, 0.09, brassMat, -0.55, 0.512, 0.4, 0.004))

  // a fresh cigar + cutter on the right side table
  const readyCigar = cigar(0.2, false)
  readyCigar.position.set(2.3, 0.62, 1.02)
  readyCigar.rotation.y = 0.6
  accessories.add(readyCigar)

  // smoke drifting off the lit cigar
  const SMOKE = 60
  const smokeGeo = new THREE.BufferGeometry()
  const smokePos = new Float32Array(SMOKE * 3)
  const smokeSeed = new Float32Array(SMOKE)
  const sr = rng(88)
  for (let i = 0; i < SMOKE; i++) {
    smokePos[i * 3] = 0
    smokePos[i * 3 + 1] = sr() * 1.6
    smokePos[i * 3 + 2] = 0
    smokeSeed[i] = sr() * 6.28
  }
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3))
  const smoke = new THREE.Points(
    smokeGeo,
    new THREE.PointsMaterial({
      size: 0.08, map: track(softDot()), color: 0xcbbfae,
      transparent: true, opacity: 0.13, depthWrite: false,
    }),
  )
  smoke.position.set(0.5, 0.56, 0.62)
  scene.add(slot('slot-smoke', smoke))

  // ── whiskey: decanter + two glasses ────────────────────────────────────
  const bar = new THREE.Group()
  scene.add(slot('slot-whiskey', bar))
  const decanter = new THREE.Group()
  decanter.position.set(-0.5, 0.46, 0.42)
  bar.add(decanter)
  decanter.add(cyl(0.075, 0.09, 0.17, 16, glassMat, 0, 0.085, 0))
  decanter.add(cyl(0.072, 0.086, 0.1, 16, whiskeyMat, 0, 0.052, 0))
  decanter.add(cyl(0.032, 0.055, 0.06, 12, glassMat, 0, 0.2, 0))
  const stopper = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), glassMat)
  stopper.position.y = 0.255
  decanter.add(stopper)

  const tumbler = (x: number, y: number, z: number): THREE.Group => {
    const g = new THREE.Group()
    g.position.set(x, y, z)
    g.add(cyl(0.048, 0.042, 0.1, 16, glassMat, 0, 0.05, 0))
    g.add(cyl(0.045, 0.04, 0.045, 16, whiskeyMat, 0, 0.025, 0))
    g.add(cyl(0.044, 0.044, 0.012, 16, std({ color: 0x1a1220, roughness: 0.1 }), 0, 0.006, 0))
    bar.add(g)
    return g
  }
  tumbler(-2.3, 0.605, 1.06)
  tumbler(0.66, 0.455, 0.36)

  // ── humidor cabinet (right wall) + an open humidor on the low table ────
  const humidor = new THREE.Group()
  scene.add(slot('slot-humidor', humidor))
  const cab = new THREE.Group()
  cab.position.set(HALF_W - 0.35, 0, -1.6)
  cab.rotation.y = -Math.PI / 2
  humidor.add(cab)
  // carcass as an open case, so the glass doors show the cigars behind them
  cab.add(box(1.5, 0.14, 0.55, darkWood, 0, 0.07, 0, 0.016)) // base
  cab.add(box(1.5, 0.1, 0.55, darkWood, 0, 1.17, 0, 0.016)) // top rail
  cab.add(box(1.58, 0.06, 0.62, trimWood, 0, 1.25, 0, 0.015)) // cornice
  cab.add(box(0.09, 1.15, 0.55, darkWood, -0.7, 0.62, 0, 0.014))
  cab.add(box(0.09, 1.15, 0.55, darkWood, 0.7, 0.62, 0, 0.014))
  cab.add(box(1.5, 1.15, 0.05, std({ color: 0x2a1a12, roughness: 0.8 }), 0, 0.62, -0.26, 0.01))
  cab.add(box(1.44, 0.04, 0.5, trimWood, 0, 0.62, 0, 0.01)) // interior shelf
  // cigars on both interior shelves
  for (const y of [0.28, 0.83]) {
    for (let i = 0; i < 9; i++) {
      const c = cyl(0.016, 0.016, 0.34, 8, cigarBody, -0.6 + i * 0.15, y, -0.02)
      c.rotation.x = Math.PI / 2
      cab.add(c)
    }
  }
  const cabGlow = new THREE.PointLight(0xffc078, 2.6, 2.2, 2)
  cabGlow.position.set(0, 1.05, -0.05)
  cab.add(cabGlow)
  // glass doors: a slim frame around a pane, hung in front of the interior
  for (const s of [-1, 1]) {
    const doorMat = std({ color: 0x2a1a12, roughness: 0.5 })
    const bar = 0.06
    cab.add(box(0.68, bar, 0.05, doorMat, s * 0.35, 1.09, 0.27, 0.008))
    cab.add(box(0.68, bar, 0.05, doorMat, s * 0.35, 0.17, 0.27, 0.008))
    cab.add(box(bar, 0.92, 0.05, doorMat, s * 0.35 - 0.31, 0.63, 0.27, 0.008))
    cab.add(box(bar, 0.92, 0.05, doorMat, s * 0.35 + 0.31, 0.63, 0.27, 0.008))
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.86), glassMat)
    pane.position.set(s * 0.35, 0.63, 0.272)
    cab.add(pane)
    cab.add(cyl(0.011, 0.011, 0.1, 8, brassMat, s * 0.05, 0.63, 0.29))
  }
  // hygrometer, on the interior back panel
  const hygro = cyl(0.055, 0.055, 0.02, 20, brassMat, 0.52, 1.0, -0.22)
  hygro.rotation.x = Math.PI / 2
  cab.add(hygro)

  // open humidor box on the low table
  const openBox = new THREE.Group()
  openBox.position.set(-0.05, 0.455, 0.3)
  openBox.rotation.y = 0.18
  humidor.add(openBox)
  openBox.add(box(0.42, 0.1, 0.26, std({ color: 0x4a2f1c, roughness: 0.45 }), 0, 0.05, 0, 0.012))
  openBox.add(box(0.38, 0.06, 0.22, std({ color: 0x2a1a12, roughness: 0.8 }), 0, 0.075, 0, 0.008))
  const lid = box(0.42, 0.04, 0.26, std({ color: 0x4a2f1c, roughness: 0.45 }), 0, 0.16, -0.16, 0.012)
  lid.rotation.x = -1.15
  openBox.add(lid)
  for (let i = 0; i < 5; i++) {
    const c = cyl(0.017, 0.017, 0.22, 10, cigarBody, -0.14 + i * 0.07, 0.1, 0)
    c.rotation.x = Math.PI / 2
    openBox.add(c)
  }

  // ── bookshelf + keepsakes (left wall, by the fire) ─────────────────────
  const shelf = new THREE.Group()
  shelf.position.set(-HALF_W + 0.3, 0, -3.0)
  shelf.rotation.y = Math.PI / 2
  scene.add(slot('slot-shelf', shelf))
  // An open case: back panel, two sides, top and bottom. A solid carcass
  // would swallow the books that make it worth having.
  shelf.add(box(1.9, 2.3, 0.06, darkWood, 0, 1.15, -0.18, 0.01))
  shelf.add(box(0.08, 2.3, 0.42, darkWood, -0.91, 1.15, 0, 0.012))
  shelf.add(box(0.08, 2.3, 0.42, darkWood, 0.91, 1.15, 0, 0.012))
  shelf.add(box(1.9, 0.1, 0.44, trimWood, 0, 2.3, 0, 0.014))
  shelf.add(box(1.9, 0.12, 0.44, darkWood, 0, 0.06, 0, 0.014))
  const shelfR = rng(55)
  for (let level = 0; level < 4; level++) {
    const y = 0.34 + level * 0.55
    shelf.add(box(1.8, 0.05, 0.38, trimWood, 0, y, 0.02))
    let x = -0.82
    while (x < 0.78) {
      const bw = 0.035 + shelfR() * 0.045
      const bh = 0.2 + shelfR() * 0.11
      const shade = shelfR()
      const color = shade < 0.3 ? 0x5b1f21 : shade < 0.55 ? 0x2c3d52 : shade < 0.78 ? 0x3a2a1c : 0x25402e
      const b = box(bw, bh, 0.26, std({ color, roughness: 0.9 }), x + bw / 2, y + 0.025 + bh / 2, 0.02, 0.004)
      if (shelfR() > 0.86) b.rotation.z = 0.22
      shelf.add(b)
      x += bw + 0.006
    }
  }
  // trophies on the top shelf — what the journal earns you
  const trophy = (x: number, s: number): void => {
    const g = new THREE.Group()
    g.position.set(x, 2.28, 0.02)
    g.scale.setScalar(s)
    g.add(cyl(0.06, 0.075, 0.04, 12, darkWood, 0, 0.02, 0))
    g.add(cyl(0.02, 0.02, 0.07, 10, brassMat, 0, 0.075, 0))
    const cup = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), brassMat)
    cup.rotation.x = Math.PI
    cup.position.y = 0.14
    g.add(cup)
    shelf.add(g)
  }
  trophy(-0.55, 1)
  trophy(-0.2, 0.8)
  trophy(0.62, 0.9)
  // mantel keepsakes: a clock and two candlesticks
  const clock = cyl(0.19, 0.19, 0.07, 20, trimWood, 0, 1.86, -HALF_D + 0.33)
  clock.rotation.x = Math.PI / 2
  slot('slot-shelf', clock)
  scene.add(clock)
  const clockFace = new THREE.Mesh(
    new THREE.CircleGeometry(0.155, 24),
    new THREE.MeshBasicMaterial({
      map: track(paint(128, 128, (ctx, w, h) => {
        ctx.fillStyle = '#f0e6d6'
        ctx.beginPath()
        ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#171017'
        ctx.lineWidth = 3
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2
          ctx.beginPath()
          ctx.moveTo(w / 2 + Math.cos(a) * 48, h / 2 + Math.sin(a) * 48)
          ctx.lineTo(w / 2 + Math.cos(a) * 56, h / 2 + Math.sin(a) * 56)
          ctx.stroke()
        }
        ctx.lineWidth = 5
        ctx.beginPath()
        ctx.moveTo(w / 2, h / 2)
        ctx.lineTo(w / 2 + 26, h / 2 - 16)
        ctx.moveTo(w / 2, h / 2)
        ctx.lineTo(w / 2 - 8, h / 2 - 42)
        ctx.stroke()
      })),
    }),
  )
  clockFace.position.set(0, 1.86, -HALF_D + 0.375)
  scene.add(slot('slot-shelf', clockFace))
  for (const s of [-1, 1]) {
    const stick = new THREE.Group()
    stick.position.set(s * 1.35, 1.7, -HALF_D + 0.35)
    scene.add(slot('slot-shelf', stick))
    stick.add(cyl(0.05, 0.06, 0.03, 12, brassMat, 0, 0.015, 0))
    stick.add(cyl(0.016, 0.016, 0.16, 10, brassMat, 0, 0.11, 0))
    stick.add(cyl(0.024, 0.024, 0.12, 10, std({ color: 0xf0e6d6, roughness: 0.9 }), 0, 0.25, 0))
    const wick = new THREE.Mesh(
      new THREE.SphereGeometry(0.016, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.9 }),
    )
    wick.position.y = 0.325
    wick.scale.y = 1.9
    stick.add(wick)
    const cl = new THREE.PointLight(0xffb060, 0.9, 1.6, 2)
    cl.position.y = 0.34
    stick.add(cl)
  }

  // ── floor lamp ─────────────────────────────────────────────────────────
  const lamp = new THREE.Group()
  lamp.position.set(-2.75, 0, 0.35)
  scene.add(slot('slot-lamp', lamp))
  lamp.add(cyl(0.2, 0.24, 0.04, 20, darkWood, 0, 0.02, 0))
  lamp.add(cyl(0.028, 0.028, 1.55, 12, brassMat, 0, 0.8, 0))
  const shadeMat = std({
    color: 0xe8cfa0, emissive: 0xffbe72, emissiveIntensity: 0.9,
    roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 0.94,
  })
  lamp.add(cyl(0.2, 0.31, 0.34, 24, shadeMat, 0, 1.7, 0))
  const lampLight = new THREE.PointLight(0xffc98a, 14, 7.5, 2)
  lampLight.position.set(0, 1.62, 0)
  lampLight.castShadow = true
  lampLight.shadow.mapSize.set(1024, 1024)
  lampLight.shadow.bias = -0.002
  lamp.add(lampLight)

  // ── record console + spinning record ───────────────────────────────────
  const records = new THREE.Group()
  records.position.set(-HALF_W + 0.32, 0, 2.6)
  records.rotation.y = Math.PI / 2
  scene.add(slot('slot-records', records))
  records.add(box(1.7, 0.62, 0.5, trimWood, 0, 0.62, 0, 0.02))
  for (const [lx, lz] of [[-0.72, 0.18], [0.72, 0.18], [-0.72, -0.18], [0.72, -0.18]]) {
    records.add(cyl(0.025, 0.03, 0.32, 8, darkWood, lx, 0.16, lz))
  }
  records.add(box(1.62, 0.03, 0.44, std({ color: 0x14101a, roughness: 0.3 }), 0, 0.94, 0, 0.008))
  const platter = cyl(0.21, 0.21, 0.02, 32, std({ color: 0x2a2230, roughness: 0.5, metalness: 0.3 }), -0.36, 0.96, 0)
  records.add(platter)
  const disc = cyl(0.2, 0.2, 0.008, 40, std({ color: 0x0a0810, roughness: 0.35 }), -0.36, 0.972, 0)
  records.add(disc)
  const label = cyl(0.07, 0.07, 0.009, 24, std({ color: C.ember, roughness: 0.8 }), -0.36, 0.974, 0)
  records.add(label)
  const tonearm = cyl(0.008, 0.008, 0.3, 8, brassMat, -0.12, 1.0, -0.06)
  tonearm.rotation.set(0, 0.55, Math.PI / 2)
  records.add(tonearm)
  records.add(cyl(0.03, 0.035, 0.03, 12, brassMat, 0.0, 0.99, -0.14))
  // sleeves leaning in the console
  for (let i = 0; i < 6; i++) {
    const sleeve = box(0.02, 0.4, 0.4, std({ color: [0x5b1f21, 0x2c3d52, 0x3a2a1c, 0x25402e, 0x4a2b21, 0x2a2230][i], roughness: 0.9 }), 0.35 + i * 0.03, 0.5, 0, 0.004)
    sleeve.rotation.z = 0.08
    records.add(sleeve)
  }

  // ── plant ──────────────────────────────────────────────────────────────
  const plant = new THREE.Group()
  plant.position.set(HALF_W - 0.75, 0, 3.1)
  scene.add(slot('slot-plant', plant))
  plant.add(cyl(0.22, 0.16, 0.34, 16, std({ color: 0x6b4326, roughness: 0.9 }), 0, 0.17, 0))
  plant.add(cyl(0.235, 0.235, 0.04, 16, std({ color: 0x8a5a34, roughness: 0.9 }), 0, 0.35, 0))
  const leafMat = std({ color: C.green, roughness: 0.85, side: THREE.DoubleSide })
  const pr = rng(19)
  for (let i = 0; i < 14; i++) {
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.52), leafMat)
    const a = (i / 14) * Math.PI * 2
    const lean = 0.4 + pr() * 0.5
    leaf.position.set(Math.cos(a) * 0.18 * lean, 0.62 + pr() * 0.4, Math.sin(a) * 0.18 * lean)
    leaf.rotation.set(lean * 0.7, -a, Math.sin(a) * lean * 0.5)
    leaf.castShadow = true
    plant.add(leaf)
  }

  // ── the lounge cat, asleep on the rug ──────────────────────────────────
  const cat = new THREE.Group()
  cat.position.set(0.55, 0.03, 1.65)
  cat.rotation.y = -0.5
  scene.add(slot('slot-cat', cat))
  const furMat = std({ color: 0x3d3138, roughness: 1 })
  const bodyC = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), furMat)
  bodyC.scale.set(1.5, 0.75, 1)
  bodyC.position.y = 0.12
  bodyC.castShadow = true
  cat.add(bodyC)
  const headC = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 12), furMat)
  headC.position.set(-0.2, 0.15, 0.04)
  headC.castShadow = true
  cat.add(headC)
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 4), furMat)
    ear.position.set(-0.21, 0.23, 0.04 + s * 0.055)
    cat.add(ear)
  }
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.022, 8, 20, Math.PI * 1.4), furMat)
  tail.position.set(0.2, 0.08, 0.06)
  tail.rotation.set(Math.PI / 2, 0, 0.6)
  cat.add(tail)

  // ── EL MERCADO — the props you buy with Embers ─────────────────────────
  // Each one is a slot like any other, so Decorate drives it with the same
  // switch; the only difference is that the page keeps it dark until the
  // ledger says you own it. Ids come from store-items.ts so the catalogue and
  // the room can never drift apart.

  // the drinks cart — brass trolley, bottles, ice bucket
  const cart = new THREE.Group()
  // placed inside the arc the camera presets actually frame — a bought thing
  // you have to go looking for is a bought thing nobody sees
  cart.position.set(-3.3, 0, 0.75)
  cart.rotation.y = 0.42
  scene.add(slot(SLOT.cart, cart))
  const cartMetal = std({ color: C.brass, roughness: 0.34, metalness: 0.8 })
  for (const [cx, cz] of [[-0.3, -0.16], [0.3, -0.16], [-0.3, 0.16], [0.3, 0.16]]) {
    cart.add(cyl(0.02, 0.02, 0.72, 10, cartMetal, cx, 0.36, cz))
    const wheel = cyl(0.045, 0.045, 0.022, 14, std({ color: 0x1a1218, roughness: 0.8 }), cx, 0.045, cz)
    wheel.rotation.z = Math.PI / 2
    cart.add(wheel)
  }
  cart.add(box(0.72, 0.022, 0.42, trimWood, 0, 0.34, 0, 0.006))
  cart.add(box(0.72, 0.022, 0.42, trimWood, 0, 0.72, 0, 0.006))
  for (const s of [-1, 1]) cart.add(cyl(0.014, 0.014, 0.4, 8, cartMetal, s * 0.38, 0.86, 0))
  const pushBar = cyl(0.014, 0.014, 0.79, 8, cartMetal, 0, 1.06, 0)
  pushBar.rotation.z = Math.PI / 2
  cart.add(pushBar)
  const bottle = (x: number, z: number, h: number, tint: number): void => {
    cart.add(cyl(0.038, 0.042, h, 14, glassMat, x, 0.73 + h / 2, z))
    cart.add(cyl(0.036, 0.04, h * 0.62, 14, std({ color: tint, roughness: 0.2, transparent: true, opacity: 0.9 }), x, 0.73 + h * 0.31, z))
    cart.add(cyl(0.014, 0.018, 0.09, 10, glassMat, x, 0.73 + h + 0.045, z))
  }
  bottle(-0.2, -0.06, 0.26, 0x8a4a1e)
  bottle(-0.05, 0.05, 0.3, 0x5c2f14)
  bottle(0.1, -0.04, 0.24, 0xc27a2c)
  const bucket = cyl(0.1, 0.085, 0.13, 18, cartMetal, 0.26, 0.795, 0.06)
  cart.add(bucket)
  for (let i = 0; i < 5; i++) {
    const ice = box(0.035, 0.035, 0.035, glassMat, 0.26 + (i % 3 - 1) * 0.035, 0.855, 0.06 + (i % 2 - 0.5) * 0.045, 0.004)
    ice.rotation.set(i, i * 0.7, i * 0.3)
    cart.add(ice)
  }
  cart.add(cyl(0.045, 0.04, 0.09, 16, glassMat, -0.24, 0.385, 0.1))
  cart.add(cyl(0.045, 0.04, 0.09, 16, glassMat, -0.12, 0.385, 0.14))

  // the chess table — a game left mid-attack
  const chess = new THREE.Group()
  chess.position.set(-2.95, 0, -2.3)
  chess.rotation.y = 0.55
  scene.add(slot(SLOT.chess, chess))
  chess.add(cyl(0.07, 0.11, 0.56, 12, darkWood, 0, 0.28, 0))
  chess.add(cyl(0.28, 0.32, 0.04, 20, darkWood, 0, 0.03, 0))
  chess.add(box(0.62, 0.05, 0.62, trimWood, 0, 0.585, 0, 0.008))
  const lightSq = std({ color: 0xd9c39a, roughness: 0.5 })
  const darkSq = std({ color: 0x2a1a16, roughness: 0.5 })
  const SQ = 0.062
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      chess.add(box(SQ, 0.008, SQ, (r + c) % 2 ? darkSq : lightSq,
        (c - 3.5) * SQ, 0.614, (r - 3.5) * SQ, 0))
    }
  }
  const paleMan = std({ color: 0xe6d8bd, roughness: 0.45 })
  // the dark set is a warm near-black — true black loses the whole side of
  // the board in this light
  const darkMan = std({ color: 0x4a3128, roughness: 0.45 })
  //  (r, c, height, white?) — an unbalanced middlegame, deliberately
  const MEN: Array<[number, number, number, boolean]> = [
    [0, 3, 0.09, true], [1, 2, 0.05, true], [1, 4, 0.05, true], [2, 5, 0.07, true],
    [3, 3, 0.06, true], [4, 4, 0.05, false], [5, 2, 0.07, false], [6, 5, 0.05, false],
    [7, 4, 0.11, false], [6, 1, 0.05, false], [2, 1, 0.05, true],
  ]
  for (const [r, c, h, white] of MEN) {
    const mat = white ? paleMan : darkMan
    const man = new THREE.Group()
    man.position.set((c - 3.5) * SQ, 0.618, (r - 3.5) * SQ)
    chess.add(man)
    man.add(cyl(0.017, 0.022, 0.012, 10, mat, 0, 0.006, 0))
    man.add(cyl(0.009, 0.015, h, 10, mat, 0, 0.012 + h / 2, 0))
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), mat)
    cap.position.y = 0.014 + h
    man.add(cap)
  }
  // two taken men resting on the rail, and the stools
  chess.add(cyl(0.015, 0.02, 0.05, 10, darkMan, 0.26, 0.635, 0.24))
  chess.add(cyl(0.015, 0.02, 0.05, 10, paleMan, 0.26, 0.635, 0.16))
  for (const s of [-1, 1]) {
    const stool = new THREE.Group()
    stool.position.set(s * 0.62, 0, s * 0.12)
    chess.add(stool)
    stool.add(cyl(0.16, 0.16, 0.06, 16, leatherMat, 0, 0.44, 0))
    for (let i = 0; i < 3; i++) {
      const leg = cyl(0.014, 0.018, 0.42, 8, darkWood,
        Math.cos((i / 3) * Math.PI * 2) * 0.1, 0.21, Math.sin((i / 3) * Math.PI * 2) * 0.1)
      leg.rotation.set(Math.sin((i / 3) * Math.PI * 2) * 0.09, 0, -Math.cos((i / 3) * Math.PI * 2) * 0.09)
      stool.add(leg)
    }
  }

  // the globe bar — a meridian sphere that opens at the equator
  const globe = new THREE.Group()
  globe.position.set(3.45, 0, 1.45)
  globe.rotation.y = -0.55
  scene.add(slot(SLOT.globe, globe))
  for (let i = 0; i < 3; i++) {
    const leg = cyl(0.018, 0.026, 0.66, 8, darkWood,
      Math.cos((i / 3) * Math.PI * 2) * 0.16, 0.33, Math.sin((i / 3) * Math.PI * 2) * 0.16)
    leg.rotation.set(Math.sin((i / 3) * Math.PI * 2) * 0.2, 0, -Math.cos((i / 3) * Math.PI * 2) * 0.2)
    globe.add(leg)
  }
  globe.add(cyl(0.19, 0.19, 0.02, 18, darkWood, 0, 0.66, 0))
  const meridian = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.014, 8, 28), brassMat)
  meridian.position.y = 0.94
  meridian.rotation.y = Math.PI / 2
  globe.add(meridian)
  // lower half: the bowl, with bottles standing in it. The continents are
  // PAINTED — patches of sphere geometry floating at the lid's radius read as
  // loose crescents, not as land.
  const globeTex = track(paint(384, 192, (ctx, w, h) => {
    ctx.fillStyle = '#2f4a52'
    ctx.fillRect(0, 0, w, h)
    const gr = rng(77)
    ctx.fillStyle = '#6f5a33'
    for (let i = 0; i < 15; i++) {
      const cx = gr() * w, cy = h * 0.2 + gr() * h * 0.6
      ctx.beginPath()
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2
        const rr = (10 + gr() * 26)
        const px = cx + Math.cos(a) * rr * 1.5, py = cy + Math.sin(a) * rr * 0.8
        k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
      }
      ctx.closePath()
      ctx.fill()
    }
    ctx.strokeStyle = 'rgba(240,230,214,.16)'
    ctx.lineWidth = 1
    for (let i = 1; i < 6; i++) {
      ctx.beginPath(); ctx.moveTo(0, (i / 6) * h); ctx.lineTo(w, (i / 6) * h); ctx.stroke()
    }
    for (let i = 1; i < 12; i++) {
      ctx.beginPath(); ctx.moveTo((i / 12) * w, 0); ctx.lineTo((i / 12) * w, h); ctx.stroke()
    }
    grain(ctx, w, h, 12, 5)
  }))
  const sphereMat = std({ map: globeTex, roughness: 0.72, metalness: 0.06 })
  const bowlG = new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), sphereMat)
  bowlG.position.y = 0.94
  bowlG.castShadow = true
  globe.add(bowlG)
  globe.add(cyl(0.255, 0.255, 0.012, 24, std({ color: C.leatherDark, roughness: 0.9 }), 0, 0.945, 0))
  for (const [bx, bz, bh] of [[-0.09, 0.03, 0.2], [0.02, -0.07, 0.24], [0.09, 0.05, 0.18]] as const) {
    globe.add(cyl(0.032, 0.036, bh, 12, glassMat, bx, 0.95 + bh / 2, bz))
    globe.add(cyl(0.03, 0.034, bh * 0.6, 12, whiskeyMat, bx, 0.95 + bh * 0.3, bz))
  }
  // upper half: the lid, hinged open and tipped back
  // hinged at the BACK OF THE RIM and tipped only a little: swing it wide and
  // the dome reads as a crescent floating free of the globe
  const globeLid = new THREE.Group()
  globeLid.position.set(0, 0.95, -0.26)
  globeLid.rotation.x = -0.62
  globe.add(globeLid)
  const lidG = new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), sphereMat)
  lidG.position.z = 0.26
  lidG.castShadow = true
  globeLid.add(lidG)
  // a brass catch on the rim, so the open lid reads as hinged and not adrift
  const catchPin = cyl(0.012, 0.012, 0.05, 8, brassMat, 0, 0.02, 0.26)
  catchPin.rotation.z = Math.PI / 2
  globeLid.add(catchPin)

  // the victrola — brass horn, wound by hand
  const victrola = new THREE.Group()
  victrola.position.set(2.95, 0, -3.15)
  victrola.rotation.y = -0.5
  scene.add(slot(SLOT.victrola, victrola))
  victrola.add(box(0.52, 0.46, 0.46, trimWood, 0, 0.66, 0, 0.02))
  for (const [lx, lz] of [[-0.2, -0.17], [0.2, -0.17], [-0.2, 0.17], [0.2, 0.17]]) {
    victrola.add(cyl(0.022, 0.028, 0.44, 8, darkWood, lx, 0.22, lz))
  }
  victrola.add(box(0.56, 0.03, 0.5, darkWood, 0, 0.9, 0, 0.008))
  const vplatter = cyl(0.15, 0.15, 0.016, 28, std({ color: 0x1d1620, roughness: 0.45, metalness: 0.25 }), 0, 0.924, 0)
  victrola.add(vplatter)
  victrola.add(cyl(0.145, 0.145, 0.006, 32, std({ color: 0x0a0810, roughness: 0.35 }), 0, 0.935, 0))
  victrola.add(cyl(0.05, 0.05, 0.007, 20, std({ color: C.ember, roughness: 0.8 }), 0, 0.938, 0))
  // the horn — a cone opening away from the wall, on a curved brass neck
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.05, 0.5, 22, 1, true), std({
    color: C.brassBright, roughness: 0.26, metalness: 0.88, side: THREE.DoubleSide,
  }))
  horn.position.set(0, 1.32, 0.14)
  horn.rotation.set(-0.95, 0, 0)
  horn.castShadow = true
  victrola.add(horn)
  const neck = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 18, Math.PI * 0.8), brassMat)
  neck.position.set(0, 1.03, -0.02)
  neck.rotation.set(Math.PI / 2, 0, -0.4)
  victrola.add(neck)
  victrola.add(cyl(0.012, 0.012, 0.16, 8, brassMat, 0.2, 1.0, 0.02))
  // the crank
  const crank = new THREE.Group()
  crank.position.set(0.29, 0.7, 0.1)
  victrola.add(crank)
  const crankArm = cyl(0.01, 0.01, 0.14, 8, brassMat, 0, 0, 0)
  crankArm.rotation.z = Math.PI / 2
  crank.add(crankArm)
  crank.add(cyl(0.012, 0.012, 0.06, 8, darkWood, 0.07, -0.03, 0))
  // a stack of shellac by its feet
  for (let i = 0; i < 4; i++) {
    victrola.add(box(0.3, 0.012, 0.3, std({ color: [0x3a2a1c, 0x25402e, 0x4a2b21, 0x2c3d52][i], roughness: 0.9 }),
      0.42, 0.02 + i * 0.014, 0.28, 0.004))
  }

  // the band wall — every band you kept, pinned behind glass (back wall,
  // right of the chimney breast)
  const bands = new THREE.Group()
  bands.position.set(4.05, 1.78, -HALF_D + 0.07)
  scene.add(slot(SLOT.bands, bands))
  bands.add(box(1.15, 1.45, 0.06, trimWood, 0, 0, -0.02, 0.01))
  bands.add(box(1.0, 1.3, 0.02, std({ color: 0x120d14, roughness: 0.95 }), 0, 0, 0.015, 0))
  const br = rng(731)
  const BAND_COLORS = [0xc8975a, 0xb3542f, 0x8a1f24, 0x2c3d52, 0x25402e, 0xe0b578, 0x6b4326]
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 4; col++) {
      const bandG = new THREE.Group()
      bandG.position.set((col - 1.5) * 0.23, (2 - row) * 0.25 + (br() - 0.5) * 0.02, 0.028)
      bandG.rotation.z = (br() - 0.5) * 0.12
      bands.add(bandG)
      const face = BAND_COLORS[Math.floor(br() * BAND_COLORS.length)]
      bandG.add(box(0.17, 0.075, 0.008, std({ color: face, roughness: 0.55, metalness: 0.25 }), 0, 0, 0, 0.004))
      bandG.add(box(0.17, 0.012, 0.009, std({ color: C.brassBright, roughness: 0.3, metalness: 0.7 }), 0, 0.028, 0.001, 0))
      bandG.add(box(0.17, 0.012, 0.009, std({ color: C.brassBright, roughness: 0.3, metalness: 0.7 }), 0, -0.028, 0.001, 0))
      const seal = cyl(0.018, 0.018, 0.006, 12, std({ color: C.cream, roughness: 0.8 }), 0, 0, 0.006)
      seal.rotation.x = Math.PI / 2
      bandG.add(seal)
    }
  }
  // glass over the whole thing, and a picture light above
  bands.add(box(1.0, 1.3, 0.006, glassMat, 0, 0, 0.045, 0))
  // light + target are CHILDREN of the frame group, so both are in its local
  // space — world coordinates here would throw the beam across the room
  const bandLight = new THREE.SpotLight(0xffd9a0, 6, 3.2, 0.7, 0.6, 2)
  bandLight.position.set(0, 0.94, 0.5)
  bandLight.target.position.set(0, -0.2, 0)
  bands.add(bandLight)
  bands.add(bandLight.target)
  bands.add(cyl(0.035, 0.035, 0.3, 10, brassMat, 0, 0.92, 0.42))

  // ── the doorway back to the hive (front wall) ──────────────────────────
  const doorway = new THREE.Group()
  doorway.position.set(3.1, 0, HALF_D - 0.06)
  doorway.rotation.y = Math.PI
  scene.add(doorway)
  doorway.add(box(1.3, 2.3, 0.1, darkWood, 0, 1.15, 0, 0.02))
  doorway.add(box(1.1, 2.1, 0.06, std({ color: 0x0a0810, roughness: 1 }), 0, 1.06, 0.04, 0.01))
  doorway.add(box(1.44, 0.1, 0.14, trimWood, 0, 2.34, 0.02))

  // ── inception ──────────────────────────────────────────────────────────
  // Two devices, one idea: the room contains itself.
  //
  // 1. THE LOOKING GLASSES — a mirror over the mantel and a mirror on the
  //    wall facing it. Each renders the real scene, and each reflection
  //    contains the other mirror showing LAST frame's reflection — so the
  //    corridor deepens one level per frame until it fades into the fog.
  //    A shared lock keeps the two Reflectors from recursing inside a single
  //    frame (stock three.js Reflectors would re-enter each other forever).
  // 2. THE MINIATURE — a hand-carved model of this room on a pedestal by the
  //    window: fireplace, wingbacks, rug, dartboard chip, mantel glass — and
  //    on its tiny table, the model again, and again, three levels down.
  //    Click it to put your eye at the little doorway. The miniature also
  //    hangs in both mirrors, all the way down the corridor.

  const mirrors = new THREE.Group()
  scene.add(slot('slot-mirrors', mirrors))
  let mirrorLock = false
  const lookingGlass = (w: number, h: number, x: number, y: number, z: number, ry: number): void => {
    const g = new THREE.Group()
    g.position.set(x, y, z)
    g.rotation.y = ry
    mirrors.add(g)
    const m = new Reflector(new THREE.PlaneGeometry(w - 0.16, h - 0.16), {
      clipBias: 0.003,
      textureWidth: 640,
      textureHeight: 448,
      color: 0xa89890, // smoked glass — each level of the corridor dims a little
    })
    m.position.z = 0.031
    const orig = m.onBeforeRender.bind(m)
    m.onBeforeRender = (renderer, sc, cam, geo, mat, grp): void => {
      if (mirrorLock) return // the other mirror keeps last frame's image
      mirrorLock = true
      orig(renderer, sc, cam, geo, mat, grp)
      mirrorLock = false
    }
    track({ dispose: () => m.dispose() })
    g.add(m)
    // the same gilt moulding the framed prints wear
    const bar = 0.08
    const frameMat = std({ color: C.brass, roughness: 0.42, metalness: 0.6 })
    g.add(box(w, bar, 0.07, frameMat, 0, h / 2 - bar / 2, 0.02))
    g.add(box(w, bar, 0.07, frameMat, 0, -h / 2 + bar / 2, 0.02))
    g.add(box(bar, h - bar * 2, 0.07, frameMat, -w / 2 + bar / 2, 0, 0.02))
    g.add(box(bar, h - bar * 2, 0.07, frameMat, w / 2 - bar / 2, 0, 0.02))
    g.add(box(w - 0.14, h - 0.14, 0.02, std({ color: 0x0e0a12, roughness: 1 }), 0, 0, 0.01))
  }
  // over the mantel, on the chimney breast — where the print used to hang
  lookingGlass(1.5, 1.05, 0, 2.42, -HALF_D + 0.42, 0)
  // and its accomplice on the wall it faces
  lookingGlass(1.15, 1.6, 0, 2.0, HALF_D - 0.05, Math.PI)

  // the miniature — self-similar, three levels down
  const miniWall = std({ color: C.wall, roughness: 0.95 })
  const miniFloor = std({ color: C.floor, roughness: 0.8 })
  const miniLeather = std({ color: C.leather, roughness: 0.62 })
  const miniStone = std({ color: 0x2a2230, roughness: 0.92 })
  const miniEmber = std({ color: C.ember, emissive: 0xff8a3c, emissiveIntensity: 1.6, roughness: 0.6 })
  const miniRug = std({ color: 0x4a2330, roughness: 0.95 })
  const miniCream = std({ color: C.cream, roughness: 0.85 })
  const miniGlass = std({ color: 0xc8ccd4, roughness: 0.08, metalness: 0.9 })
  const buildMini = (level: number): THREE.Group => {
    const g = new THREE.Group()
    g.add(box(0.5, 0.02, 0.42, darkWood, 0, 0.01, 0))       // plinth
    g.add(box(0.46, 0.008, 0.38, miniFloor, 0, 0.024, 0))   // floor
    g.add(box(0.46, 0.24, 0.01, miniWall, 0, 0.148, -0.185))// back wall
    g.add(box(0.01, 0.24, 0.38, miniWall, -0.225, 0.148, 0))
    g.add(box(0.01, 0.24, 0.38, miniWall, 0.225, 0.148, 0))
    g.add(box(0.11, 0.13, 0.024, miniStone, 0, 0.093, -0.172)) // chimney breast
    g.add(box(0.055, 0.045, 0.012, miniEmber, 0, 0.05, -0.166)) // the fire
    g.add(box(0.13, 0.012, 0.03, trimWood, 0, 0.128, -0.164))   // mantel shelf
    g.add(box(0.07, 0.05, 0.006, brassMat, 0, 0.185, -0.176))   // tiny looking glass
    g.add(box(0.06, 0.04, 0.004, miniGlass, 0, 0.185, -0.171))
    g.add(box(0.15, 0.004, 0.1, miniRug, 0, 0.028, 0.01))       // rug
    for (const sx of [-1, 1]) {                                  // two wingbacks
      const ch = new THREE.Group()
      ch.position.set(sx * 0.075, 0.026, 0.03)
      ch.rotation.y = -sx * 0.5
      ch.add(box(0.05, 0.022, 0.045, miniLeather, 0, 0.011, 0))
      ch.add(box(0.05, 0.06, 0.012, miniLeather, 0, 0.04, 0.026))
      ch.add(box(0.012, 0.03, 0.04, miniLeather, -0.026, 0.032, 0.004))
      ch.add(box(0.012, 0.03, 0.04, miniLeather, 0.026, 0.032, 0.004))
      g.add(ch)
    }
    const chip = cyl(0.016, 0.016, 0.008, 12, miniCream, -0.217, 0.16, 0.07) // dartboard chip
    chip.rotation.z = Math.PI / 2
    g.add(chip)
    const chipEye = cyl(0.0055, 0.0055, 0.01, 8, miniEmber, -0.216, 0.16, 0.07)
    chipEye.rotation.z = Math.PI / 2
    g.add(chipEye)
    g.add(box(0.09, 0.008, 0.07, trimWood, 0.13, 0.062, 0.1))    // the low table…
    g.add(box(0.01, 0.05, 0.01, darkWood, 0.13, 0.032, 0.1))
    if (level < 3) {                                             // …and on it, the room again
      const child = buildMini(level + 1)
      child.scale.setScalar(0.14)
      child.position.set(0.13, 0.066, 0.1)
      g.add(child)
    }
    return g
  }
  const pedestal = new THREE.Group()
  pedestal.position.set(4.35, 0, 2.15)
  scene.add(slot('slot-miniature', pedestal))
  pedestal.add(cyl(0.1, 0.13, 0.86, 12, darkWood, 0, 0.43, 0))
  pedestal.add(cyl(0.24, 0.24, 0.03, 24, trimWood, 0, 0.875, 0))
  const mini = buildMini(1)
  mini.scale.setScalar(0.75)
  mini.rotation.y = -2.1
  mini.position.y = 0.89
  pedestal.add(mini)
  const miniLight = new THREE.PointLight(0xffd9a0, 1.6, 1.8, 2)
  miniLight.position.set(0, 1.5, 0.3)
  pedestal.add(miniLight)
  // an invisible dome over the model: click it and the camera dives in
  const miniPick = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 12, 8),
    std({ visible: false }),
  )
  miniPick.position.set(0, 1.05, 0)
  miniPick.userData.view = 'miniature'
  pickables.push(miniPick)
  pedestal.add(miniPick)

  // ─── per-frame ─────────────────────────────────────────────────────────
  const smokeAttr = smokeGeo.getAttribute('position') as THREE.BufferAttribute
  const emberAttr = emberGeo.getAttribute('position') as THREE.BufferAttribute
  const camPos = new THREE.Vector3()
  const flamePos = new THREE.Vector3()
  let cameraRef: THREE.Camera | null = null

  const tick = (t: number, dt: number): void => {
    // the oche: the aim bead breathes, darts fly, the Colonel takes his turn
    tickDarts(t, dt)
    // fire: flicker the flames and the light together
    const flick = 0.82 + Math.sin(t * 11.3) * 0.06 + Math.sin(t * 4.1) * 0.07 + Math.sin(t * 23.7) * 0.03
    // the fire jumps when the room does — roomFlare is the roar, spent down
    fireLight.intensity = 22 * flick * (1 + roomFlare * 0.5)
    if (cameraRef) cameraRef.getWorldPosition(camPos)
    for (const { mesh, mat, phase } of flames) {
      mesh.scale.set(0.85 + Math.sin(t * 5.5 + phase) * 0.12, 0.86 + Math.sin(t * 7.1 + phase) * 0.18, 1)
      mat.opacity = 0.72 + Math.sin(t * 9 + phase) * 0.2
      if (cameraRef) {
        // billboard on Y only, so the flame never tips over
        mesh.getWorldPosition(flamePos)
        mesh.lookAt(camPos.x, flamePos.y, camPos.z)
      }
    }
    // embers rise and recycle
    for (let i = 0; i < EMBERS; i++) {
      let y = emberAttr.getY(i) + emberVel[i] * dt
      if (y > 1.4) {
        y = 0
        emberAttr.setX(i, (Math.sin(i * 12.9 + t) * 0.4))
      }
      emberAttr.setY(i, y)
      emberAttr.setZ(i, Math.sin(t * 1.4 + i) * 0.08)
    }
    emberAttr.needsUpdate = true

    // cigar smoke: a slow, widening column
    for (let i = 0; i < SMOKE; i++) {
      let y = smokeAttr.getY(i) + dt * 0.16
      if (y > 1.7) y = 0
      smokeAttr.setY(i, y)
      const s = smokeSeed[i]
      const spread = 0.02 + y * 0.13
      smokeAttr.setX(i, Math.sin(t * 0.5 + s + y * 2.2) * spread)
      smokeAttr.setZ(i, Math.cos(t * 0.42 + s * 1.7 + y * 1.9) * spread)
    }
    smokeAttr.needsUpdate = true

    // the lit coal breathes
    const coal = restingCigar.userData.coal as THREE.Mesh | undefined
    if (coal) {
      const mat = coal.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = 1.8 + Math.sin(t * 1.7) * 0.9
    }
    const glow = restingCigar.userData.glow as THREE.PointLight | undefined
    if (glow) glow.intensity = 0.7 + Math.sin(t * 1.7) * 0.35

    // the record turns
    disc.rotation.y += dt * 3.5
    label.rotation.y = disc.rotation.y
  }

  const dispose = (): void => {
    for (const d of disposables) d.dispose()
    scene.traverse(o => {
      const mesh = o as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const mat = mesh.material
      if (Array.isArray(mat)) mat.forEach(m => m.dispose())
      else if (mat) (mat as THREE.Material).dispose()
    })
  }

  // The camera is attached after construction so the flames can billboard.
  return {
    scene, slots, pickables,
    attachCamera: c => { cameraRef = c },
    tick, dispose,
    darts: {
      beginAim, moveAim, release: releaseAim, cancel: cancelAim,
      view: setView, state: ocheState, throwAt,
    },
  }
}

// ─── camera presets ───────────────────────────────────────────────────────

const VIEWS: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  room: { pos: [0.4, 1.75, 4.35], target: [0, 1.15, -1.6] },
  fire: { pos: [0.1, 1.4, 2.3], target: [0, 0.95, -4.2] },
  gallery: { pos: [1.35, 1.7, -0.3], target: [-5.4, 1.75, -0.7] },
  humidor: { pos: [1.1, 1.5, -0.9], target: [5.4, 0.9, -1.6] },
  // seated, just in front of the left wingback, facing the hearth
  chair: { pos: [-0.72, 1.24, 2.75], target: [0.05, 0.85, -4.0] },
  // AT THE OCHE — square to the board, close enough to aim at a treble and far
  // enough back that the regulars who came over to watch are in the shot with
  // it. A crowd you cannot see is not a crowd, and the crowd is the multiplier.
  // (stood a foot to the near side of the floor lamp at z 0.35 — from directly
  // behind it the shade fills a third of the frame at eye level)
  darts: { pos: [-2.05, 1.74, 1.35], target: [-5.5, 1.66, 1.05] },
  // eye to the little doorway of the model on the pedestal
  miniature: { pos: [3.45, 1.22, 1.5], target: [4.35, 0.97, 2.15] },
  // El Mercado — one per purchasable prop, so a thing you just bought can
  // introduce itself instead of waiting to be found
  cart: { pos: [-1.75, 1.3, 1.5], target: [-3.3, 0.85, 0.75] },
  chess: { pos: [-1.5, 1.25, -1.1], target: [-2.95, 0.68, -2.3] },
  globe: { pos: [1.9, 1.3, 1.9], target: [3.45, 0.95, 1.45] },
  victrola: { pos: [1.5, 1.45, -1.5], target: [2.95, 1.1, -3.15] },
  bands: { pos: [3.5, 1.85, -1.9], target: [4.05, 1.78, -4.4] },
}

// ─── boot ─────────────────────────────────────────────────────────────────

function boot(): boolean {
  const cfg: LoungeConfig = window.REV_LOUNGE ?? {}
  const host = document.querySelector<HTMLElement>(cfg.mount ?? '#lounge3d')
  if (!host) return false

  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default' })
  } catch {
    return false
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.22
  const canvas = renderer.domElement
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab'
  host.appendChild(canvas)

  const room = buildRoom(cfg.art ?? {})
  const camera = new THREE.PerspectiveCamera(52, 16 / 10, 0.1, 60)
  room.attachCamera(camera)
  camera.position.set(...VIEWS.room.pos)

  const controls = new OrbitControls(camera, canvas)
  controls.target.set(...VIEWS.room.target)
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controls.enablePan = false
  // Wheel zoom would eat the page's scroll — the site host IS the scroll
  // surface. Dolly stays on pinch and the in-page view buttons.
  controls.enableZoom = false
  controls.minDistance = 1.2
  controls.maxDistance = 9
  controls.minPolarAngle = 0.55
  controls.maxPolarAngle = Math.PI / 2 - 0.02
  controls.rotateSpeed = 0.55
  controls.update()
  // ── picking: a click (never a drag) on a marked print opens its panel ──
  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const hitAt = (e: PointerEvent): THREE.Intersection | null => {
    const r = canvas.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ndc, camera)
    const hits = ray.intersectObjects(room.pickables, false)
    return hits[0] ?? null
  }
  let press: { x: number; y: number; t: number } | null = null
  let hovering = false
  /** True while a throw is being aimed. The orbit is OFF for the duration —
   *  a press on the board IS a throw, and a drag during it is re-aiming, not
   *  turning the room around. Nothing else on the canvas changes. */
  let aiming = false
  canvas.addEventListener('pointerdown', e => {
    const hit = hitAt(e)
    if (hit?.object.userData.dart && room.darts.beginAim(hit.point)) {
      aiming = true
      controls.enabled = false
      canvas.style.cursor = 'crosshair'
      canvas.setPointerCapture?.(e.pointerId)
      return
    }
    canvas.style.cursor = 'grabbing'
    press = { x: e.clientX, y: e.clientY, t: Date.now() }
  })
  canvas.addEventListener('pointermove', e => {
    if (aiming) {
      // Re-point mid-throw. Off the board face the aim simply HOLDS where it
      // was — sliding onto the cabinet must not fling the dart at the ceiling.
      const hit = hitAt(e)
      if (hit?.object.userData.dart) room.darts.moveAim(hit.point)
      return
    }
    if (press) return
    const over = !!hitAt(e)
    if (over !== hovering) {
      hovering = over
      canvas.style.cursor = over ? 'pointer' : 'grab'
    }
  })
  window.addEventListener('pointerup', e => {
    if (aiming) {
      aiming = false
      controls.enabled = true
      canvas.style.cursor = hovering ? 'pointer' : 'grab'
      const scored = room.darts.release()
      if (scored) host.dispatchEvent(new CustomEvent('lounge3d:dart', { detail: scored, bubbles: true }))
      return
    }
    canvas.style.cursor = hovering ? 'pointer' : 'grab'
    if (!press) return
    const moved = Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y)
    const quick = Date.now() - press.t < 400
    press = null
    if (moved > 6 || !quick || e.target !== canvas) return
    const hit = hitAt(e as PointerEvent)
    if (!hit) return
    const pick = hit.object.userData.pick
    if (typeof pick === 'string') {
      host.dispatchEvent(new CustomEvent('lounge3d:pick', { detail: { id: pick }, bubbles: true }))
    } else if (typeof hit.object.userData.view === 'string') {
      view(hit.object.userData.view) // the miniature: click it and dive in
    }
  })
  // A throw the browser takes away (a tab switch, a gesture claimed by the OS)
  // is no throw at all — it must not fire a dart on the way out.
  window.addEventListener('pointercancel', () => {
    if (!aiming) return
    aiming = false
    controls.enabled = true
    room.darts.cancel()
  })

  // Vertical FOV, clamped so a very wide stage (the walk-in fills the screen)
  // can't blow the horizontal FOV out to a fisheye.
  const FOV_V = 52
  const HFOV_MAX = (80 * Math.PI) / 180
  const resize = (): void => {
    const w = host.clientWidth || 960
    const h = host.clientHeight || Math.round(w * 0.58)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    const capped = (2 * Math.atan(Math.tan(HFOV_MAX / 2) / camera.aspect) * 180) / Math.PI
    camera.fov = Math.min(FOV_V, capped)
    camera.updateProjectionMatrix()
  }
  resize()
  const ro = new ResizeObserver(resize)
  ro.observe(host)

  // camera tween for the preset views
  let tween: { from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t: number } | null = null
  const view = (name: string): void => {
    const v = VIEWS[name]
    if (!v) return
    room.darts.view(name)
    tween = {
      from: camera.position.clone(),
      to: new THREE.Vector3(...v.pos),
      fromT: controls.target.clone(),
      toT: new THREE.Vector3(...v.target),
      t: 0,
    }
  }

  const clock = new THREE.Clock()
  let onScreen = true
  const io = new IntersectionObserver(entries => { onScreen = entries[0]?.isIntersecting ?? true }, { threshold: 0.02 })
  io.observe(host)
  // Swallow the elapsed gap so the room doesn't lurch when the tab comes back.
  const onVisibility = (): void => { clock.getDelta() }
  document.addEventListener('visibilitychange', onVisibility)

  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    renderer.setAnimationLoop(null)
    ro.disconnect()
    io.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
    controls.dispose()
    room.dispose()
    renderer.dispose()
    canvas.remove()
    if (window.RevLounge3D) delete window.RevLounge3D
  }

  const frame = (dt: number): void => {
    const t = clock.elapsedTime
    if (tween) {
      tween.t = Math.min(1, tween.t + dt * 1.5)
      const e = 1 - Math.pow(1 - tween.t, 3)
      camera.position.lerpVectors(tween.from, tween.to, e)
      controls.target.lerpVectors(tween.fromT, tween.toT, e)
      if (tween.t >= 1) tween = null
    }
    room.tick(t, dt)
    controls.update()
    renderer.render(room.scene, camera)
  }

  renderer.setAnimationLoop(() => {
    // SiteViewDrone unmounts by dropping the page's nodes; without this the
    // loop would outlive the page and hold a live GL context.
    if (!canvas.isConnected) { dispose(); return }
    const dt = Math.min(clock.getDelta(), 0.05)
    if (!onScreen || document.hidden) return
    frame(dt)
  })

  window.RevLounge3D = {
    setSlot: (id, on) => {
      const objs = room.slots.get(id)
      if (objs) for (const o of objs) o.visible = on
    },
    view,
    frame: () => frame(1 / 60),
    oche: { state: room.darts.state, throwAt: room.darts.throwAt },
    pose: () => ({
      pos: camera.position.toArray().map(n => +n.toFixed(2)),
      target: controls.target.toArray().map(n => +n.toFixed(2)),
    }),
    ready: Promise.resolve(true),
  }
  host.dataset.ready = '1'
  host.dispatchEvent(new CustomEvent('lounge3d:ready', { bubbles: true }))
  return true
}

// Passive start: never on the critical path. If WebGL is unavailable or the
// room throws, reveal the page's SVG fallback instead.
function start(): void {
  let ok = false
  try {
    ok = boot()
  } catch (err) {
    console.warn('[lounge3d] scene failed, falling back to the drawn room', err)
  }
  if (!ok) revealFallback()
}

function revealFallback(): void {
  const cfg: LoungeConfig = window.REV_LOUNGE ?? {}
  const stage = document.querySelector<HTMLElement>(cfg.mount ?? '#lounge3d')
  const bar = cfg.controls ? document.querySelector<HTMLElement>(cfg.controls) : null
  const fb = document.querySelector<HTMLElement>(cfg.fallback ?? '#loungeFallback')
  if (stage) stage.hidden = true
  if (bar) bar.hidden = true
  if (fb) fb.hidden = false
}

const idle = (fn: () => void): void => {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (ric) ric(fn, { timeout: 1200 })
  else setTimeout(fn, 260)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => idle(start), { once: true })
else idle(start)
