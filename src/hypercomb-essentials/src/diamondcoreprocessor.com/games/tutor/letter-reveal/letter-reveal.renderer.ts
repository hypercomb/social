// diamondcoreprocessor.com/games/tutor/letter-reveal/letter-reveal.renderer.ts
//
// Procedural vector draw for letter-reveal: the cue up top, the answer as
// a row of letter slots (revealed letter locked, typed letters in gold,
// the active slot blinking, the rest blank), and a footer hint. ARCADE
// palette; the shell clears the ink backdrop and folds in screen-shake.

import type { StudyItem } from '../deck.types.js'
import type { LetterRevealEngine } from './letter-reveal.engine.js'
import { ARCADE } from '../../juice.js'

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

export function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  engine: LetterRevealEngine,
  item: StudyItem,
): void {
  const cx = w / 2

  // ── cue ──────────────────────────────────────────────
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(191,233,255,0.6)'
  ctx.font = '600 14px system-ui, sans-serif'
  ctx.fillText('TYPE THE WORD', cx, h * 0.18)

  ctx.fillStyle = '#eaf6ff'
  ctx.font = '600 28px system-ui, sans-serif'
  const lines = wrap(ctx, item.prompt, Math.min(w - 80, 760))
  const top = h * 0.3 - ((lines.length - 1) * 36) / 2
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, top + i * 36)

  // ── letter slots ─────────────────────────────────────
  const target = engine.target
  const n = target.length
  const maxRowW = Math.min(w - 80, 900)
  const slot = Math.max(22, Math.min(56, Math.floor(maxRowW / Math.max(n, 1)) - 8))
  const gap = Math.max(6, Math.floor(slot * 0.18))
  const rowW = n * slot + (n - 1) * gap
  let x = cx - rowW / 2
  const y = h * 0.56
  const blink = Math.sin(time * 6) > 0

  ctx.textBaseline = 'alphabetic'
  ctx.font = `700 ${Math.floor(slot * 0.62)}px ui-monospace, monospace`

  for (let i = 0; i < n; i++) {
    const ch = target[i]
    const isSep = !/[a-z0-9]/i.test(ch)
    const filled = i < engine.pos
    const isCursor = i === engine.pos && engine.phase === 'typing'

    if (!isSep) {
      // baseline underline
      ctx.strokeStyle = isCursor && engine.wrongFlash > 0
        ? ARCADE.magenta
        : isCursor
          ? ARCADE.cyan
          : 'rgba(126,224,255,0.3)'
      ctx.lineWidth = isCursor ? 3 : 2
      ctx.beginPath()
      ctx.moveTo(x + 3, y + 6)
      ctx.lineTo(x + slot - 3, y + 6)
      ctx.stroke()

      if (filled) {
        // first revealed letter is locked/dim; produced letters glow gold
        ctx.fillStyle = i === 0 ? 'rgba(191,233,255,0.85)' : ARCADE.gold
        ctx.fillText(ch.toUpperCase(), x + slot / 2, y)
      } else if (isCursor && blink) {
        ctx.fillStyle = 'rgba(126,224,255,0.5)'
        ctx.fillText('_', x + slot / 2, y)
      }
    }
    x += slot + gap
  }

  // ── footer ───────────────────────────────────────────
  ctx.textBaseline = 'middle'
  if (engine.phase === 'typing') {
    ctx.fillStyle = 'rgba(191,233,255,0.5)'
    ctx.font = '500 15px system-ui, sans-serif'
    ctx.fillText('Enter to reveal', cx, h * 0.74)
    if (item.hint) {
      ctx.fillStyle = 'rgba(191,233,255,0.4)'
      ctx.font = 'italic 500 14px system-ui, sans-serif'
      ctx.fillText(item.hint, cx, h * 0.84)
    }
    if (engine.mistakes > 0) {
      ctx.fillStyle = 'rgba(255,93,143,0.7)'
      ctx.font = '600 13px system-ui, sans-serif'
      ctx.fillText(`${engine.mistakes} miss${engine.mistakes === 1 ? '' : 'es'}`, cx, h * 0.79)
    }
  } else if (engine.gaveUp) {
    ctx.fillStyle = ARCADE.magenta
    ctx.font = '600 18px system-ui, sans-serif'
    ctx.fillText(target.toUpperCase(), cx, h * 0.74)
  }
}
