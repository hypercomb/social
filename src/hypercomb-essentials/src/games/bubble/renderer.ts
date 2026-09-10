/*! @license
 * Arcade presentation using Julian Rijken's BubbleBobble sprite sheets,
 * revision 6a59ee99e621f4061cab50802155b9c28c51c4f9. See sprite-assets.ts,
 * UPSTREAM.md and COPYING for attribution and provenance.
 */
import { HEIGHT, TILE, WIDTH, type Engine } from './engine.js'
import { SPRITE_ASSETS } from './sprite-assets.js'

// Seven-pixel glyphs in eight-pixel cells keep the arcade HUD sharp without
// depending on installed fonts or canvas text antialiasing.
const FONT: Readonly<Record<string, readonly string[]>> = {
  A: ['0011100','0110110','1100011','1100011','1111111','1100011','1100011'],
  C: ['0011110','0110011','1100000','1100000','1100000','0110011','0011110'],
  D: ['1111100','0110110','0110011','0110011','0110011','0110110','1111100'],
  E: ['1111111','1100000','1100000','1111110','1100000','1100000','1111111'],
  G: ['0011110','0110011','1100000','1101111','1100011','0110011','0011110'],
  H: ['1100011','1100011','1100011','1111111','1100011','1100011','1100011'],
  I: ['0111110','0001100','0001100','0001100','0001100','0001100','0111110'],
  L: ['1100000','1100000','1100000','1100000','1100000','1100000','1111111'],
  N: ['1100011','1110011','1111011','1101111','1100111','1100011','1100011'],
  O: ['0011100','0110110','1100011','1100011','1100011','0110110','0011100'],
  P: ['1111110','1100011','1100011','1111110','1100000','1100000','1100000'],
  R: ['1111110','1100011','1100011','1111110','1101100','1100110','1100011'],
  S: ['0111110','1100011','1100000','0111110','0000011','1100011','0111110'],
  U: ['1100011','1100011','1100011','1100011','1100011','1100011','0111110'],
  Y: ['1100011','1100011','0110110','0011100','0001100','0001100','0001100'],
  '0': ['0011100','0110110','1100011','1100011','1100011','0110110','0011100'],
  '1': ['0001100','0011100','0111100','0001100','0001100','0001100','0111111'],
  '2': ['0111110','1100011','0000011','0001110','0111000','1100000','1111111'],
  '3': ['0111110','1100011','0000011','0011110','0000011','1100011','0111110'],
  '4': ['0001110','0011110','0110110','1100110','1111111','0000110','0000110'],
  '5': ['1111111','1100000','1111110','0000011','0000011','1100011','0111110'],
  '6': ['0011110','0110000','1100000','1111110','1100011','1100011','0111110'],
  '7': ['1111111','1100011','0000110','0001100','0011000','0011000','0011000'],
  '8': ['0111110','1100011','1100011','0111110','1100011','1100011','0111110'],
  '9': ['0111110','1100011','1100011','0111111','0000011','0000110','0111100'],
  '!': ['0001100','0001100','0001100','0001100','0001100','0000000','0001100'],
}
type Sheet = keyof typeof SPRITE_ASSETS
const FOOD_COLUMNS = [13, 14, 15, 17, 19, 1] as const

export class Renderer {
  readonly ready: Promise<void>
  readonly #sheets: Record<Sheet, HTMLImageElement>
  #latest: { engine: Engine; time: number; hiscore: number } | undefined

  constructor(private readonly ctx: CanvasRenderingContext2D) {
    const sheets = {} as Record<Sheet, HTMLImageElement>
    const loads = (Object.keys(SPRITE_ASSETS) as Sheet[]).map(key => {
      const image = new Image()
      sheets[key] = image
      const loaded = new Promise<void>(resolve => {
        image.onload = () => resolve()
        image.onerror = () => resolve()
      })
      image.src = SPRITE_ASSETS[key]
      return loaded
    })
    this.#sheets = sheets
    // Redraw the initial preview even while the Start cover pauses its loop.
    this.ready = Promise.all(loads).then(() => {
      const latest = this.#latest
      if (latest) this.draw(latest.engine, latest.time, latest.hiscore)
    })
  }

  draw(engine: Engine, time: number, hiscore = 0): void {
    this.#latest = { engine, time, hiscore }
    const ctx = this.ctx
    ctx.save()
    ctx.imageSmoothingEnabled = false
    ctx.globalAlpha = 1
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    this.#terrain(engine)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 16, WIDTH, HEIGHT - 16)
    ctx.clip()
    for (const fruit of engine.fruit) {
      const column = FOOD_COLUMNS[((fruit.kind % FOOD_COLUMNS.length) + FOOD_COLUMNS.length) % FOOD_COLUMNS.length]
      this.#sprite('items', column, 0, fruit.x - 8, fruit.y - 8)
    }
    for (const enemy of engine.enemies) {
      if (enemy.state === 'trapped') continue
      const row = enemy.kind === 'zenchan' ? 0 : 1
      const frame = Math.floor(time * (enemy.angry ? 8 : 4) + enemy.id) % 2
      const column = enemy.state === 'defeated'
        ? 12 + Math.floor(time * 10 + enemy.id) % 4 : (enemy.angry ? 2 : 0) + frame
      this.#sprite('enemies', column, row, enemy.x, enemy.y, enemy.facing < 0)
    }
    for (const bubble of engine.bubbles) {
      const captured = bubble.trappedId === null ? undefined
        : engine.enemies.find(enemy => enemy.id === bubble.trappedId)
      if (captured) {
        const row = captured.kind === 'zenchan' ? 0 : 1
        const column = (bubble.age > 5 ? 10 : 6) + Math.floor(time * 4) % 2
        this.#sprite('enemies', column, row, bubble.x - 8, bubble.y - 8)
      } else {
        const column = bubble.age < 0.25 ? Math.min(2, Math.floor(bubble.age * 12))
          : 3 + Math.floor(time * 8) % 2
        this.#sprite('bubbles', column, 0, bubble.x - 8, bubble.y - 8)
      }
    }
    for (const shot of engine.shots) {
      this.#sprite('enemies', Math.floor(time * 10) % 6, 2, shot.x - 8, shot.y - 8)
    }
    const player = engine.player
    const blink = engine.state === 'playing' && player.invulnerable > 0 && Math.floor(time * 16) % 2 === 0
    if (!blink) {
      const blowing = engine.bubbles.some(b => b.age < 0.12 &&
        Math.abs(b.x - (player.x + player.w / 2)) < 32 &&
        Math.abs(b.y - (player.y + player.h / 2)) < 12)
      const airborne = !player.grounded && engine.state === 'playing'
      const row = player.dead ? 3 : blowing ? 2 : airborne ? 1 : 0
      const column = player.dead ? Math.floor(time * 10) % 4 : blowing ? 0
        : airborne ? 2 + Math.floor(time * 4) % 2
        : Math.abs(player.vx) > 1 ? Math.floor(time * 7) % 4 : Math.floor(time * 7) % 2
      this.#sprite('player', column, row, player.x, player.y, player.facing < 0)
    }
    ctx.restore()
    this.#hud(engine, hiscore)
    this.#state(engine)
    ctx.restore()
  }

  #terrain(engine: Engine): void {
    const ctx = this.ctx
    const textureRow = engine.levelIndex % 3
    const visible = (row: number, col: number): boolean =>
      '#=+'.includes(engine.level.tiles[row]?.[col] ?? '.')
    // Collision colors never determine the visible palette. All round-one
    // surfaces use the upstream pink diagonal tile, with narrow arcade shadows.
    ctx.fillStyle = ['#600040', '#602000', '#600040'][textureRow]
    for (let row = 2; row < engine.level.tiles.length; row++) {
      for (let col = 0; col < engine.level.tiles[row].length; col++) {
        if (!visible(row, col)) continue
        if (!visible(row + 1, col)) ctx.fillRect(col * TILE + 2, (row + 1) * TILE, TILE, 3)
        if (!visible(row, col + 1)) ctx.fillRect((col + 1) * TILE, row * TILE + 2, 2, TILE)
      }
    }
    for (let row = 2; row < engine.level.tiles.length; row++) {
      for (let col = 0; col < engine.level.tiles[row].length; col++) {
        if (visible(row, col)) this.#sprite('tiles', 0, textureRow, col * TILE, row * TILE, false, TILE, TILE)
      }
    }
  }

  #hud(engine: Engine, hiscore: number): void {
    const ctx = this.ctx
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, WIDTH, 16)
    const score = (value: number): string => String(Math.max(0, Math.floor(value))).padStart(2, '0').slice(-7)
    const current = score(engine.score), best = score(Math.max(hiscore, engine.score))
    this.#text('1UP', 32, 0, '#00ff00')
    this.#text(current, 64 - current.length * 8, 8, '#ffffff')
    this.#text('HIGH SCORE', 88, 0, '#ff0000')
    this.#text(best, 160 - best.length * 8, 8, '#ffffff')
    this.#text('ROUND', 208, 0, '#ffff00')
    this.#text(String(engine.levelIndex + 1).padStart(2, '0'), 224, 8, '#ffffff')
    const round = String(engine.levelIndex + 1)
    ctx.fillStyle = '#000000'
    ctx.fillRect(8, 24, round.length * 8, 8)
    this.#text(round, 8, 24, '#ffffff')
    // Reserve Bub icons sit on the floor, as on the original cabinet.
    for (let life = 0; life < Math.min(8, Math.max(0, engine.lives - 1)); life++) {
      this.#sprite('player', 0, 0, life * 8, HEIGHT - 8, false, 8)
    }
  }

  #state(engine: Engine): void {
    // The accessible DOM shell supplies Start and terminal-state actions.
    if (engine.state !== 'ready' && engine.state !== 'clear') return
    const title = engine.state === 'clear' ? 'ROUND CLEAR' : 'ROUND ' + (engine.levelIndex + 1)
    const detail = engine.state === 'clear' ? '' : 'READY!'
    const width = title.length * 8 + 16
    this.ctx.fillStyle = '#000000'
    this.ctx.fillRect((WIDTH - width) / 2, 104, width, detail ? 32 : 16)
    this.#text(title, (WIDTH - title.length * 8) / 2, 108, '#ffffff')
    if (detail) this.#text(detail, (WIDTH - detail.length * 8) / 2, 124, '#00ff00')
  }

  #sprite(sheet: Sheet, column: number, row: number, x: number, y: number,
    mirror = false, size = 16, sourceSize = 16): void {
    const image = this.#sheets[sheet]
    if (!image.complete || image.naturalWidth === 0) return
    const ctx = this.ctx, left = Math.round(x), top = Math.round(y)
    if (mirror) {
      ctx.save()
      ctx.translate(left + size, top)
      ctx.scale(-1, 1)
      ctx.drawImage(image, column * sourceSize, row * sourceSize, sourceSize, sourceSize, 0, 0, size, size)
      ctx.restore()
    } else {
      ctx.drawImage(image, column * sourceSize, row * sourceSize, sourceSize, sourceSize, left, top, size, size)
    }
  }

  #text(text: string, x: number, y: number, color: string): void {
    this.ctx.fillStyle = color
    let left = Math.round(x)
    const top = Math.round(y)
    for (const letter of text) {
      const glyph = FONT[letter]
      if (glyph) for (let row = 0; row < glyph.length; row++) {
        for (let col = 0; col < glyph[row].length; col++) {
          if (glyph[row][col] === '1') this.ctx.fillRect(left + col, top + row, 1, 1)
        }
      }
      left += 8
    }
  }
}
