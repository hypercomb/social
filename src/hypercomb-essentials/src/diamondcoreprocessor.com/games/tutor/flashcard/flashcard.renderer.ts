// diamondcoreprocessor.com/games/tutor/flashcard/flashcard.renderer.ts
//
// Procedural vector draw for the flashcard game — a flipping card with the
// prompt on the front and the answer + hint + self-grade buttons on the
// back. No assets; ARCADE palette so it reads as part of the suite. The
// shell clears the ink backdrop; this draws the card on top.

import type { StudyItem, Grade } from '../deck.types.js'
import type { FlashcardEngine } from './flashcard.engine.js'
import { ARCADE } from '../../juice.js'

export interface Rect { x: number; y: number; w: number; h: number }

/** The card's bounds, centred and clamped so it stays readable at any size. */
export function cardRect(w: number, h: number): Rect {
  const cw = Math.min(w * 0.82, 720)
  const ch = Math.min(h * 0.6, 420)
  return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch }
}

/** Grade-button hit rects along the card's foot (back side only). */
export function gradeButtonRects(w: number, h: number): Record<Grade, Rect> {
  const card = cardRect(w, h)
  const pad = 18
  const bw = (card.w - pad * 4) / 3
  const bh = 52
  const y = card.y + card.h - bh - pad
  return {
    again: { x: card.x + pad, y, w: bw, h: bh },
    good: { x: card.x + pad * 2 + bw, y, w: bw, h: bh },
    easy: { x: card.x + pad * 3 + bw * 2, y, w: bw, h: bh },
  }
}

const GRADE_COLOR: Record<Grade, string> = {
  again: ARCADE.magenta,
  good: ARCADE.cyan,
  easy: ARCADE.gold,
}
const GRADE_LABEL: Record<Grade, string> = {
  again: 'Again',
  good: 'Good',
  easy: 'Easy',
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** Wrap `text` to `maxWidth`, return lines. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word }
    else line = next
  }
  if (line) lines.push(line)
  return lines
}

function drawWrapped(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, maxWidth: number, lineH: number): void {
  const lines = wrap(ctx, text, maxWidth)
  const top = cy - ((lines.length - 1) * lineH) / 2
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, top + i * lineH)
}

export function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  _time: number,
  engine: FlashcardEngine,
  item: StudyItem,
): void {
  const card = cardRect(w, h)
  const cx = card.x + card.w / 2
  const cy = card.y + card.h / 2

  // Flip: angle 0→π over the flip progress. cos sign decides which face.
  const angle = engine.flip * Math.PI
  const sx = Math.max(0.02, Math.abs(Math.cos(angle)))
  const back = Math.cos(angle) < 0

  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(sx, 1)
  ctx.translate(-cx, -cy)

  // Card body
  ctx.fillStyle = back ? 'rgba(20,26,48,0.96)' : 'rgba(14,18,38,0.96)'
  roundRect(ctx, card.x, card.y, card.w, card.h, 22)
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = back ? ARCADE.cyanSoft : 'rgba(126,224,255,0.35)'
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (!back) {
    // FRONT — the cue.
    ctx.fillStyle = 'rgba(191,233,255,0.6)'
    ctx.font = '600 14px system-ui, sans-serif'
    ctx.fillText('RECALL', cx, card.y + 34)
    ctx.fillStyle = '#eaf6ff'
    ctx.font = '600 30px system-ui, sans-serif'
    drawWrapped(ctx, item.prompt, cx, cy - 10, card.w - 80, 38)
    ctx.fillStyle = 'rgba(191,233,255,0.5)'
    ctx.font = '500 15px system-ui, sans-serif'
    ctx.fillText('space / click to flip', cx, card.y + card.h - 30)
  } else {
    // BACK — answer + hint + grade buttons. Un-mirror so text reads correctly.
    ctx.save()
    ctx.translate(cx, 0)
    ctx.scale(-1, 1)
    ctx.translate(-cx, 0)

    ctx.fillStyle = ARCADE.gold
    ctx.font = '700 34px system-ui, sans-serif'
    drawWrapped(ctx, item.answer, cx, card.y + card.h * 0.34, card.w - 80, 42)

    if (item.hint) {
      ctx.fillStyle = 'rgba(191,233,255,0.7)'
      ctx.font = 'italic 500 17px system-ui, sans-serif'
      drawWrapped(ctx, item.hint, cx, card.y + card.h * 0.56, card.w - 100, 24)
    }

    // Grade buttons
    const rects = gradeButtonRects(w, h)
    for (const g of ['again', 'good', 'easy'] as Grade[]) {
      const r = rects[g]
      const col = GRADE_COLOR[g]
      roundRect(ctx, r.x, r.y, r.w, r.h, 12)
      ctx.fillStyle = 'rgba(255,255,255,0.04)'
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = col
      ctx.stroke()
      ctx.fillStyle = col
      ctx.font = '700 17px system-ui, sans-serif'
      ctx.fillText(GRADE_LABEL[g], r.x + r.w / 2, r.y + r.h / 2 - 8)
      ctx.fillStyle = 'rgba(255,255,255,0.45)'
      ctx.font = '600 12px system-ui, sans-serif'
      ctx.fillText(g === 'again' ? '1' : g === 'good' ? '2' : '3', r.x + r.w / 2, r.y + r.h / 2 + 12)
    }
    ctx.restore()
  }

  ctx.restore()
}
