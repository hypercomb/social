// diamondcoreprocessor.com/games/tutor/scramble/scramble.renderer.ts
//
// Vector draw for scramble: the cue, the jumbled letters as a tile "bank",
// and the answer slots filling in as the learner types. ARCADE palette.

import type { StudyItem } from '../deck.types.js'
import type { ScrambleEngine } from './scramble.engine.js'
import { ARCADE } from '../../juice.js'

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

function tileRow(ctx: CanvasRenderingContext2D, chars: string[], cx: number, y: number, slot: number, gap: number, render: (ch: string, x: number, i: number) => void): void {
  const n = chars.length
  const rowW = n * slot + (n - 1) * gap
  let x = cx - rowW / 2
  for (let i = 0; i < n; i++) { render(chars[i], x, i); x += slot + gap }
}

export function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  engine: ScrambleEngine,
  item: StudyItem,
): void {
  const cx = w / 2
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  ctx.fillStyle = 'rgba(191,233,255,0.6)'
  ctx.font = '600 14px system-ui, sans-serif'
  ctx.fillText('UNSCRAMBLE', cx, h * 0.16)

  ctx.fillStyle = '#eaf6ff'
  ctx.font = '600 26px system-ui, sans-serif'
  const lines = wrap(ctx, item.prompt, Math.min(w - 80, 760))
  const ptop = h * 0.27 - ((lines.length - 1) * 32) / 2
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, ptop + i * 32)

  const n = engine.target.length
  const slot = Math.max(26, Math.min(58, Math.floor(Math.min(w - 80, 820) / Math.max(n, 1)) - 8))
  const gap = Math.max(6, Math.floor(slot * 0.2))

  // Jumbled letter bank
  const bankY = h * 0.47
  ctx.font = `700 ${Math.floor(slot * 0.5)}px ui-monospace, monospace`
  tileRow(ctx, engine.scrambled.split(''), cx, bankY, slot, gap, (ch, x) => {
    ctx.fillStyle = 'rgba(126,224,255,0.1)'
    ctx.strokeStyle = 'rgba(126,182,214,0.4)'
    ctx.lineWidth = 1.5
    roundRect(ctx, x, bankY - slot * 0.42, slot, slot * 0.84, 8)
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = ARCADE.cyanSoft
    ctx.textBaseline = 'middle'
    ctx.fillText(ch.toUpperCase(), x + slot / 2, bankY)
  })

  // Answer slots
  const ansY = h * 0.66
  const blink = Math.sin(time * 6) > 0
  ctx.textBaseline = 'alphabetic'
  ctx.font = `700 ${Math.floor(slot * 0.56)}px ui-monospace, monospace`
  tileRow(ctx, engine.target.split(''), cx, ansY, slot, gap, (ch, x, i) => {
    const filled = i < engine.pos
    const isCursor = i === engine.pos && engine.phase === 'typing'
    ctx.strokeStyle = isCursor && engine.wrongFlash > 0 ? ARCADE.magenta : isCursor ? ARCADE.cyan : 'rgba(126,224,255,0.3)'
    ctx.lineWidth = isCursor ? 3 : 2
    ctx.beginPath(); ctx.moveTo(x + 3, ansY + 6); ctx.lineTo(x + slot - 3, ansY + 6); ctx.stroke()
    if (filled) { ctx.fillStyle = ARCADE.gold; ctx.fillText(ch.toUpperCase(), x + slot / 2, ansY) }
    else if (isCursor && blink) { ctx.fillStyle = 'rgba(126,224,255,0.5)'; ctx.fillText('_', x + slot / 2, ansY) }
  })

  ctx.textBaseline = 'middle'
  if (engine.phase === 'typing') {
    ctx.fillStyle = 'rgba(191,233,255,0.5)'
    ctx.font = '500 15px system-ui, sans-serif'
    ctx.fillText('type the word · Backspace to undo · Enter to reveal', cx, h * 0.8)
  } else if (engine.gaveUp) {
    ctx.fillStyle = ARCADE.magenta
    ctx.font = '600 18px system-ui, sans-serif'
    ctx.fillText(engine.target.toUpperCase(), cx, h * 0.8)
  }
}
