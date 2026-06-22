// diamondcoreprocessor.com/games/tutor/hangman/hangman.renderer.ts
//
// Vector draw for hangman: the cue, the answer blanks (revealed letters in
// gold), a misses meter, and an A–Z on-screen keyboard (clickable; used
// keys gray out, hits glow cyan, misses flush magenta). ARCADE palette.

import type { StudyItem } from '../deck.types.js'
import type { HangmanEngine } from './hangman.engine.js'
import { ARCADE } from '../../juice.js'

export interface Rect { x: number; y: number; w: number; h: number }
export interface KeyRect { letter: string; rect: Rect }

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('')
const COLS = 9
const KEY = 42
const KGAP = 8

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/); const lines: string[] = []; let line = ''
  for (const w of words) { const n = line ? `${line} ${w}` : w; if (ctx.measureText(n).width > maxWidth && line) { lines.push(line); line = w } else line = n }
  if (line) lines.push(line); return lines
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath(); ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath()
}

/** Hit rects for the A–Z keyboard, centred near the foot of the stage. */
export function keyRects(w: number, h: number): KeyRect[] {
  const gridW = COLS * KEY + (COLS - 1) * KGAP
  const x0 = (w - gridW) / 2
  const y0 = h * 0.6
  return LETTERS.map((letter, i) => {
    const col = i % COLS, row = Math.floor(i / COLS)
    return { letter, rect: { x: x0 + col * (KEY + KGAP), y: y0 + row * (KEY + KGAP), w: KEY, h: KEY } }
  })
}

export function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  _time: number,
  engine: HangmanEngine,
  item: StudyItem,
): void {
  const cx = w / 2
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  ctx.fillStyle = 'rgba(191,233,255,0.6)'
  ctx.font = '600 14px system-ui, sans-serif'
  ctx.fillText('GUESS THE WORD', cx, h * 0.13)

  ctx.fillStyle = '#eaf6ff'
  ctx.font = '600 25px system-ui, sans-serif'
  const lines = wrap(ctx, item.prompt, Math.min(w - 80, 760))
  const ptop = h * 0.22 - ((lines.length - 1) * 30) / 2
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, ptop + i * 30)

  // Answer blanks
  const target = engine.target
  const n = target.length
  const slot = Math.max(22, Math.min(50, Math.floor(Math.min(w - 80, 820) / Math.max(n, 1)) - 8))
  const gap = Math.max(5, Math.floor(slot * 0.2))
  const rowW = n * slot + (n - 1) * gap
  let x = cx - rowW / 2
  const by = h * 0.4
  ctx.font = `700 ${Math.floor(slot * 0.6)}px ui-monospace, monospace`
  for (let i = 0; i < n; i++) {
    const ch = target[i]
    const isLetter = /[a-z0-9]/i.test(ch)
    if (isLetter) {
      ctx.strokeStyle = 'rgba(126,224,255,0.35)'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x + 3, by + 6); ctx.lineTo(x + slot - 3, by + 6); ctx.stroke()
      if (engine.isGuessed(ch) || engine.phase === 'done') {
        ctx.fillStyle = engine.isGuessed(ch) ? ARCADE.gold : ARCADE.magenta
        ctx.fillText(ch.toUpperCase(), x + slot / 2, by)
      }
    } else {
      ctx.fillStyle = 'rgba(191,233,255,0.6)'
      ctx.fillText(ch, x + slot / 2, by)
    }
    x += slot + gap
  }

  // Misses meter
  ctx.textBaseline = 'middle'
  ctx.fillStyle = engine.misses > 0 ? ARCADE.magenta : 'rgba(191,233,255,0.6)'
  ctx.font = '600 14px system-ui, sans-serif'
  ctx.fillText(`misses ${engine.misses}/${engine.maxMisses}`, cx, h * 0.5)

  // Keyboard
  const keys = keyRects(w, h)
  ctx.font = '700 17px ui-monospace, monospace'
  for (const { letter, rect: r } of keys) {
    const guessed = engine.isGuessed(letter)
    const hit = guessed && target.toLowerCase().includes(letter)
    let border = 'rgba(126,182,214,0.3)', fill = 'rgba(255,255,255,0.03)', text = '#cfe6f5'
    if (guessed && hit) { border = ARCADE.cyan; fill = 'rgba(126,224,255,0.16)'; text = ARCADE.cyan }
    else if (guessed) { border = 'rgba(255,93,143,0.4)'; fill = 'rgba(255,93,143,0.08)'; text = 'rgba(255,93,143,0.6)' }
    roundRect(ctx, r.x, r.y, r.w, r.h, 8)
    ctx.fillStyle = fill; ctx.fill()
    ctx.lineWidth = 1.4; ctx.strokeStyle = border; ctx.stroke()
    ctx.fillStyle = text; ctx.textBaseline = 'middle'
    ctx.fillText(letter.toUpperCase(), r.x + r.w / 2, r.y + r.h / 2)
  }

  if (engine.lost) {
    ctx.fillStyle = ARCADE.magenta
    ctx.font = '600 18px system-ui, sans-serif'
    ctx.fillText(target.toUpperCase(), cx, h * 0.55)
  }
}
