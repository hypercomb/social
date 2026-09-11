// Walking figures for the island, drawn in three-quarter view: you see a
// person's face as they come toward you, their side as they walk past, and
// their back as they walk away — never just the top of their head. Canvas
// shapes only, on a 16 × 24 unit grid scaled to whatever canvas they get.
//
// Same cartoon language as Dana in the rooms below (renderer.ts): every part
// inside a fat ink outline, flat colour with one shade wedge on the right, a
// big round head with two large eyes, rosy cheeks, and for Dana the floppy
// purple hat whose tip curls behind him with a gold star on the end.

export type WalkerFacing = 'up' | 'down' | 'left' | 'right'
export interface WalkerLook { skin: string; hair: string; robe: string; trim: string; hat?: string }

/** Dana: the blue robe and floppy purple hat from the rooms below. */
export const PLAYER_LOOK: WalkerLook = { skin: '#f8d2aa', hair: '#7a4a26', robe: '#3f7df0', trim: '#ffd24d', hat: '#8e55ea' }

const INK = '#1c1230'
const SHADE = 'rgba(20,16,70,0.30)'
const BOOT = '#1f3d8c'
const SOLE = '#e9d8b6'

const SKINS = ['#f8d2aa', '#e0b084', '#c68d5f', '#8d5a3b', '#f1c9a5'] as const
const HAIRS = ['#2f231c', '#7a4a26', '#a8743f', '#d9c27a', '#8a8a8a', '#3a2a4a'] as const

/** A stable look for someone, from their id; the robe is their own colour. */
export function lookFor(id: string, robe: string): WalkerLook {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return { skin: SKINS[Math.abs(hash) % SKINS.length]!, hair: HAIRS[Math.abs(hash >> 3) % HAIRS.length]!, robe, trim: '#eadbb8' }
}

/** `step` 0–3: 0 and 2 plant both feet, 1 and 3 are the two strides. */
export function drawWalker(ctx: CanvasRenderingContext2D, look: WalkerLook, facing: WalkerFacing, step: number): void {
  const { width, height } = ctx.canvas
  ctx.setTransform(width / 16, 0, 0, height / 24, 0, 0)
  ctx.clearRect(0, 0, 16, 24)
  if (facing === 'left') { ctx.translate(16, 0); ctx.scale(-1, 1) }
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  const ink = (lw = 0.55): void => { ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.stroke() }
  const rrect = (x: number, y: number, w: number, h: number, r: number): void => {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }
  const disc = (color: string, x: number, y: number, r: number, outline = true): void => {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    if (outline) ink()
  }
  const star = (x: number, y: number, r: number): void => {
    ctx.beginPath()
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 - Math.PI / 2
      const rad = (i & 1) === 0 ? r : r * 0.42
      const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ink(0.5)
    ctx.fillStyle = look.trim
    ctx.fill()
  }
  const boot = (x: number, y: number, w: number): void => {
    rrect(x, y, w, 2.3, 0.8)
    ctx.fillStyle = BOOT
    ctx.fill()
    ctx.save()
    ctx.clip()
    ctx.fillStyle = SOLE
    ctx.fillRect(x - 1, y + 1.5, w + 2, 1)
    ctx.restore()
    rrect(x, y, w, 2.3, 0.8)
    ink()
  }
  /** Bell robe from the shoulder line to a curved hem, cel-shaded + outlined. */
  const robe = (l: number, r: number, hl: number, hr: number): void => {
    const path = (): void => {
      ctx.beginPath()
      ctx.moveTo(l, 11.4)
      ctx.lineTo(r, 11.4)
      ctx.quadraticCurveTo(hr + 0.4, 17, hr, 20.8)
      ctx.quadraticCurveTo((hl + hr) / 2, 22.2, hl, 20.8)
      ctx.quadraticCurveTo(hl - 0.4, 17, l, 11.4)
      ctx.closePath()
    }
    path()
    ctx.fillStyle = look.robe
    ctx.fill()
    ctx.save()
    path()
    ctx.clip()
    ctx.fillStyle = SHADE
    ctx.beginPath()
    ctx.ellipse(hr + 1, 16.5, (hr - hl) * 0.55, 6.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.45)'                     // pale hem trim
    ctx.beginPath()
    ctx.moveTo(hl - 1, 21.2)
    ctx.quadraticCurveTo((hl + hr) / 2, 22.6, hr + 1, 21.2)
    ctx.lineTo(hr + 1, 19.9)
    ctx.quadraticCurveTo((hl + hr) / 2, 21.3, hl - 1, 19.9)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    path()
    ink()
    // belt + round buckle
    const bl = l + (hl - l) * 0.4, br = r + (hr - r) * 0.4
    rrect(bl - 0.2, 15.0, br - bl + 0.4, 1.3, 0.4)
    ctx.fillStyle = INK
    ctx.fill()
  }
  const buckle = (x: number): void => {
    disc(INK, x, 15.65, 1.05, false)
    disc(look.trim, x, 15.65, 0.7, false)
  }
  const sleeve = (x: number, y: number, w: number, h: number): void => {
    rrect(x, y, w, h, 0.9)
    ctx.fillStyle = look.robe
    ctx.fill()
    ctx.save()
    ctx.clip()
    ctx.fillStyle = 'rgba(255,255,255,0.4)'                      // cuff
    ctx.fillRect(x - 0.5, y + h - 1.3, w + 1, 1.3)
    ctx.restore()
    rrect(x, y, w, h, 0.9)
    ink()
  }
  const head = (x: number, y: number): void => {
    ctx.beginPath()
    ctx.arc(x, y, 3.7, 0, Math.PI * 2)
    ctx.fillStyle = look.skin
    ctx.fill()
    ctx.save()
    ctx.clip()
    ctx.fillStyle = 'rgba(150,70,60,0.22)'
    ctx.beginPath()
    ctx.arc(x + 2, y + 1.8, 3.7, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    ctx.beginPath()
    ctx.arc(x, y, 3.7, 0, Math.PI * 2)
    ink()
  }
  const eye = (x: number, y: number, rx: number, ry: number, lookX: number): void => {
    ctx.beginPath()
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ink(0.4)
    ctx.save()
    ctx.clip()
    const ix = x + lookX * rx * 0.4
    disc('#3a70e0', ix, y + 0.1, rx * 0.66, false)
    disc(INK, ix + lookX * 0.1, y + 0.1, rx * 0.38, false)
    disc('#ffffff', ix - rx * 0.28, y - ry * 0.3, rx * 0.24, false)
    ctx.restore()
  }
  const cheek = (x: number, y: number): void => disc('rgba(240,120,110,0.45)', x, y, 0.7, false)
  const hat = (tipX: number, tipY: number, cx: number): void => {
    // cone rises in front and the tip curls over and hangs behind
    const cone = (): void => {
      ctx.beginPath()
      ctx.moveTo(cx - 3.4, 5.9)
      ctx.quadraticCurveTo(cx - 1.2, 3.2, tipX, tipY)
      ctx.quadraticCurveTo(cx + 3.6, -1.4, cx + 3.4, 5.9)
      ctx.closePath()
    }
    cone()
    ctx.fillStyle = look.hat!
    ctx.fill()
    ctx.save()
    cone()
    ctx.clip()
    ctx.fillStyle = SHADE
    ctx.beginPath()
    ctx.ellipse(cx + 3.2, 3.4, 3, 4.6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.beginPath()
    ctx.ellipse(cx - 0.6, 3.6, 0.55, 1.6, 0.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    cone()
    ink()
    rrect(cx - 3.4, 4.5, 6.8, 1.3, 0.4)                          // band + buckle
    ctx.fillStyle = INK
    ctx.fill()
    ctx.fillStyle = look.trim
    ctx.fillRect(cx + 1.3, 4.6, 1.1, 1.1)
    ctx.beginPath()                                              // brim
    ctx.ellipse(cx, 5.9, 5.8, 1.35, 0, 0, Math.PI * 2)
    ctx.fillStyle = look.hat!
    ctx.fill()
    ctx.save()
    ctx.clip()
    ctx.fillStyle = 'rgba(20,10,60,0.42)'
    ctx.fillRect(cx - 7, 6.1, 14, 2)
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    ctx.beginPath()
    ctx.ellipse(cx - 2, 5.3, 2.2, 0.4, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    ctx.beginPath()
    ctx.ellipse(cx, 5.9, 5.8, 1.35, 0, 0, Math.PI * 2)
    ink()
    star(tipX, tipY - 0.2, 1.15)
  }
  const hairCap = (x: number, y: number, back: boolean): void => {
    ctx.beginPath()
    if (back) ctx.arc(x, y, 3.7, 0, Math.PI * 2)
    else ctx.arc(x, y, 3.7, Math.PI * 1.02, Math.PI * 1.98)
    ctx.closePath()
    ctx.fillStyle = look.hair
    ctx.fill()
    ink()
  }

  const stride = ((step % 4) + 4) % 4
  const swing = stride === 1 ? 1 : stride === 3 ? -1 : 0
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)'
  ctx.beginPath()
  ctx.ellipse(8, 22.8, 5, 1.3, 0, 0, Math.PI * 2)
  ctx.fill()

  if (facing === 'up' || facing === 'down') {
    boot(4.6, 20.4 - (swing === 1 ? 0.8 : 0), 3)
    boot(8.4, 20.4 - (swing === -1 ? 0.8 : 0), 3)
    robe(4.4, 11.6, 2.6, 13.4)
    buckle(8)
    sleeve(2.3, 12.2 + swing * 0.6, 2.2, 5.2)
    sleeve(11.5, 12.2 - swing * 0.6, 2.2, 5.2)
    disc(look.skin, 3.4, 17.9 + swing * 0.6, 1.0)
    disc(look.skin, 12.6, 17.9 - swing * 0.6, 1.0)
    head(8, 8.4)
    if (facing === 'down') {
      eye(6.5, 8.6, 1.0, 1.2, 0)
      eye(9.5, 8.6, 1.0, 1.2, 0)
      cheek(5.4, 10.1)
      cheek(10.6, 10.1)
      ctx.beginPath()                                            // smile
      ctx.moveTo(6.9, 10.8)
      ctx.quadraticCurveTo(8, 11.9, 9.1, 10.8)
      ink(0.45)
    } else {
      hairCap(8, 8.4, true)
    }
    if (look.hat) hat(3.2, 0.6, 8)
    else hairCap(8, 8.4, false)
  } else {
    // In profile, facing right; facing left is the same figure mirrored.
    const reach = stride === 1 ? 2.2 : stride === 3 ? -2.2 : 0
    boot(6.2 - reach, 20.4, 3.2)
    boot(6.8 + reach, 20.4, 3.4)
    robe(5.2, 11, 3.6, 12.8)
    buckle(9)
    sleeve(7.4 + reach * 0.4, 12.4, 2.3, 5.2)
    disc(look.skin, 8.55 + reach * 0.4, 18.1, 1.0)
    head(8.2, 8.4)
    ctx.beginPath()                                              // hair at the back
    ctx.arc(8.2, 8.4, 3.7, Math.PI * 0.75, Math.PI * 1.25)
    ctx.quadraticCurveTo(6.2, 8.4, 5.6, 5.8)
    ctx.closePath()
    ctx.fillStyle = look.hair
    ctx.fill()
    ink()
    eye(9.9, 8.6, 1.05, 1.25, 0.4)
    cheek(9.2, 10.2)
    ctx.beginPath()                                              // nose bump
    ctx.moveTo(11.6, 8.8)
    ctx.quadraticCurveTo(12.5, 9.2, 11.9, 9.9)
    ink(0.4)
    ctx.beginPath()                                              // smile
    ctx.moveTo(9.4, 10.7)
    ctx.quadraticCurveTo(10.6, 11.7, 11.5, 10.6)
    ink(0.45)
    if (look.hat) hat(2.4, 1.4, 8.2)
    else hairCap(8.2, 8.4, false)
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}
