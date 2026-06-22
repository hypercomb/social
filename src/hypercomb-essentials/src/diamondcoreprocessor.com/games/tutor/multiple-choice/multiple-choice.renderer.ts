// diamondcoreprocessor.com/games/tutor/multiple-choice/multiple-choice.renderer.ts
//
// Vector draw for multiple choice: the cue up top, then a stack of option
// rows numbered 1..N. After a choice, the correct row glows cyan and a
// wrong pick flushes magenta. ARCADE palette; shell clears the backdrop.

import type { StudyItem } from '../deck.types.js'
import type { MultipleChoiceEngine } from './multiple-choice.engine.js'
import { ARCADE } from '../../juice.js'

export interface Rect { x: number; y: number; w: number; h: number }

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

const ROW_H = 56
const ROW_GAP = 14
const ROWS_TOP_FRAC = 0.42

/** Option-row hit rects, one per option, vertically stacked and centred. */
export function optionRects(w: number, h: number, count: number): Rect[] {
  const rowW = Math.min(w * 0.72, 640)
  const x = (w - rowW) / 2
  const top = h * ROWS_TOP_FRAC
  const rects: Rect[] = []
  for (let i = 0; i < count; i++) rects.push({ x, y: top + i * (ROW_H + ROW_GAP), w: rowW, h: ROW_H })
  return rects
}

export function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  _time: number,
  engine: MultipleChoiceEngine,
  item: StudyItem,
): void {
  const cx = w / 2
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  ctx.fillStyle = 'rgba(191,233,255,0.6)'
  ctx.font = '600 14px system-ui, sans-serif'
  ctx.fillText('CHOOSE THE ANSWER', cx, h * 0.16)

  ctx.fillStyle = '#eaf6ff'
  ctx.font = '600 27px system-ui, sans-serif'
  const lines = wrap(ctx, item.prompt, Math.min(w - 80, 760))
  const ptop = h * 0.28 - ((lines.length - 1) * 34) / 2
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, ptop + i * 34)

  const rects = optionRects(w, h, engine.options.length)
  const done = engine.phase === 'done'
  for (let i = 0; i < engine.options.length; i++) {
    const r = rects[i]
    const opt = engine.options[i]
    let border = 'rgba(126,182,214,0.3)'
    let fill = 'rgba(255,255,255,0.03)'
    if (done && opt.correct) { border = ARCADE.cyan; fill = 'rgba(126,224,255,0.16)' }
    else if (done && i === engine.chosen && !opt.correct) { border = ARCADE.magenta; fill = 'rgba(255,93,143,0.16)' }
    roundRect(ctx, r.x, r.y, r.w, r.h, 12)
    ctx.fillStyle = fill; ctx.fill()
    ctx.lineWidth = 1.6; ctx.strokeStyle = border; ctx.stroke()

    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(191,233,255,0.5)'
    ctx.font = '700 15px ui-monospace, monospace'
    ctx.fillText(String(i + 1), r.x + 16, r.y + r.h / 2)
    ctx.fillStyle = '#eaf6ff'
    ctx.font = '600 18px system-ui, sans-serif'
    ctx.fillText(opt.text, r.x + 42, r.y + r.h / 2)
    ctx.textAlign = 'center'
  }

  if (!done) {
    const lastRow = rects[rects.length - 1]
    ctx.fillStyle = 'rgba(191,233,255,0.45)'
    ctx.font = '500 14px system-ui, sans-serif'
    ctx.fillText(`press 1–${engine.options.length} or click`, cx, lastRow.y + lastRow.h + 28)
  }
}
