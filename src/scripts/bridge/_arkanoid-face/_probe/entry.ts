// Standalone harness entry: the REAL engine + renderer, drawn to a canvas.
import { Engine, W, H, BRICK_W, BRICK_X0, COLS } from '../../../../hypercomb-essentials/src/games/arkanoid/engine.js'
import { Renderer } from '../../../../hypercomb-essentials/src/games/arkanoid/renderer.js'
import { LEVELS, cloneLevel } from '../../../../hypercomb-essentials/src/games/arkanoid/levels.js'

const w = window as unknown as Record<string, unknown>
w['ARK'] = { W, H, BRICK_W, BRICK_X0, COLS, levels: LEVELS.length }

w['draw'] = (canvasId: string, levelIndex: number): string => {
  const c = document.getElementById(canvasId) as HTMLCanvasElement
  c.width = W * 2; c.height = H * 2
  c.style.width = W + 'px'; c.style.height = H + 'px'
  const ctx = c.getContext('2d')!
  ctx.setTransform(2, 0, 0, 2, 0, 0)
  ctx.fillStyle = '#10204f'; ctx.fillRect(0, 0, W, H)
  const engine = new Engine(cloneLevel(LEVELS[levelIndex]).rows)
  const r = new Renderer(ctx)
  r.draw(engine, 0)
  const alive = engine.bricks.filter(b => b.alive)
  const minX = Math.min(...alive.map(b => b.x)), maxX = Math.max(...alive.map(b => b.x + b.w))
  return JSON.stringify({ level: LEVELS[levelIndex].name, bricks: alive.length, minX, maxX, W })
}
