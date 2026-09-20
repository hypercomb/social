/*! @license
 * Arcade presentation using Julian Rijken's BubbleBobble sprite sheets,
 * revision 6a59ee99e621f4061cab50802155b9c28c51c4f9. See sprite-assets.ts,
 * UPSTREAM.md and COPYING for attribution and provenance.
 */
import { CAVE_LEFT, HEIGHT, TILE, WIDTH, type EnemyKind, type Engine } from './engine.js'
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
const ENEMY_ROWS: Readonly<Record<EnemyKind, number>> = {
  zenchan: 0,
  mighta: 1,
  monsta: 2,
  pulpul: 3,
  hidegons: 4,
  drunk: 5,
  banebou: 6,
  invader: 7,
}
// A glyph's index in FONT is its column in the baked atlas. Glyphs are
// constant; only their colour varies, so atlases are cached per colour.
const GLYPH_ORDER = Object.keys(FONT) as readonly string[]
const GLYPH_COLUMN: Readonly<Record<string, number>> =
  Object.fromEntries(GLYPH_ORDER.map((letter, index) => [letter, index]))
const GLYPH_CELL = 8

export class Renderer {
  readonly ready: Promise<void>
  readonly #sheets: Record<Sheet, HTMLImageElement>
  readonly #terrainCache = new Map<number, { level: Engine['level']; canvas: HTMLCanvasElement }>()
  readonly #font = new Map<string, HTMLCanvasElement>()
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
    // Decoding the embedded bytes is the only async step in the game — the
    // sheets are carried by the signed package, not fetched. Bake every static
    // surface here, behind the Start cover, then redraw the initial preview
    // that a paused loop would otherwise leave blank.
    this.ready = Promise.all(loads).then(() => {
      const latest = this.#latest
      if (!latest) return
      this.prewarm(latest.engine)
      this.draw(latest.engine, latest.time, latest.hiscore)
    })
  }

  /** Bake the current and next terrain behind the cover. With the complete
   *  100-round DOS campaign, eagerly retaining every canvas wastes memory. */
  prewarm(engine: Engine): void {
    this.#terrainSheet(engine, engine.levelIndex)
    this.#terrainSheet(engine, engine.levelIndex + 1)
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
    for (const fruit of engine.fruit) {
      if (fruit.phase === 'score') {
        // BE21 keeps a rising score-display actor. Use the existing bitmap
        // HUD glyphs until the original DOS score sprites are reconstructed.
        this.#text(String(fruit.points), fruit.x - 8, fruit.y - 8, '#ffff00')
        continue
      }
      const column = FOOD_COLUMNS[((fruit.kind % FOOD_COLUMNS.length) + FOOD_COLUMNS.length) % FOOD_COLUMNS.length]
      this.#sprite('items', column, 0, fruit.x - 8, fruit.y - 8)
    }
    for (const enemy of engine.enemies) {
      if (enemy.state === 'trapped') continue
      const row = ENEMY_ROWS[enemy.kind]
      const frame = Math.floor(time * (enemy.angry ? 8 : 4) + enemy.id) % 2
      const column = enemy.state === 'defeated'
        ? 12 + Math.floor(time * 10 + enemy.id) % 4 : (enemy.angry ? 2 : 0) + frame
      this.#sprite('enemies', column, row, enemy.x, enemy.y, enemy.facing < 0)
    }
    for (const bubble of engine.bubbles) {
      const captured = bubble.trappedId === null ? undefined
        : engine.enemies.find(enemy => enemy.id === bubble.trappedId)
      if (captured) {
        const row = ENEMY_ROWS[captured.kind]
        const column = (bubble.ticksRemaining <= 0x3c ? 10 : 6) + Math.floor(time * 4) % 2
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
    this.#hud(engine, hiscore)
    this.#state(engine)
    ctx.restore()
  }

  #terrain(engine: Engine): void {
    const baked = this.#terrainSheet(engine, engine.levelIndex)
    if (baked) this.ctx.drawImage(baked, 0, 0)
  }

  /** Static per level: walls, ledges and their shadows never change mid-round,
   *  so they are rasterized once and blitted as a single bitmap per frame. */
  #terrainSheet(engine: Engine, index: number): HTMLCanvasElement | undefined {
    const level = engine.levels[index]
    const baked = this.#terrainCache.get(index)
    // installLevel replaces the object when a bundled preview is hydrated from
    // living child heads. Never let the old seed canvas conceal authored cells.
    if (baked?.level === level) return baked.canvas
    const tiles = this.#sheets.tiles
    // Never bake against undecoded bytes: a blank sheet would cache as truth.
    if (!level || !tiles.complete || tiles.naturalWidth === 0) return undefined
    const canvas = document.createElement('canvas')
    canvas.width = WIDTH
    canvas.height = HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    const textureRow = index % 3
    const visible = (row: number, col: number): boolean =>
      '#=+'.includes(level.tiles[row]?.[col] ?? '.')
    // Collision colors never determine the visible palette. All round-one
    // surfaces use the upstream pink diagonal tile, with narrow arcade shadows.
    ctx.fillStyle = ['#600040', '#602000', '#600040'][textureRow]
    for (let row = 0; row < level.tiles.length; row++) {
      for (let col = 0; col < level.tiles[row].length; col++) {
        if (!visible(row, col)) continue
        if (!visible(row + 1, col)) ctx.fillRect(CAVE_LEFT + col * TILE + 2, (row + 1) * TILE, TILE, 3)
        if (!visible(row, col + 1)) ctx.fillRect(CAVE_LEFT + (col + 1) * TILE, row * TILE + 2, 2, TILE)
      }
    }
    for (let row = 0; row < level.tiles.length; row++) {
      for (let col = 0; col < level.tiles[row].length; col++) {
        if (visible(row, col)) this.#blit(ctx, 'tiles', 0, textureRow,
          CAVE_LEFT + col * TILE, row * TILE, false, TILE, TILE)
      }
    }
    this.#terrainCache.set(index, { level, canvas })
    return canvas
  }

  #hud(engine: Engine, hiscore: number): void {
    const score = (value: number): string => String(Math.max(0, Math.floor(value))).padStart(2, '0').slice(-7)
    const current = score(engine.score), best = score(Math.max(hiscore, engine.score))
    // Transitional status text lives in the DOS side gutters so no native
    // terrain row is hidden or displaced.
    this.#text('1UP', 0, 0, '#00ff00')
    this.#text(current.slice(-4), 0, 8, '#ffffff')
    this.#text('HI', 304, 0, '#ff0000')
    this.#text(best.slice(-2), 304, 8, '#ffffff')
    this.#text(String(engine.levelIndex + 1).padStart(2, '0'), 304, 24, '#ffff00')
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
    this.#blit(this.ctx, sheet, column, row, x, y, mirror, size, sourceSize)
  }

  /** The same blit, aimed at any surface — terrain bakes into its own canvas. */
  #blit(ctx: CanvasRenderingContext2D, sheet: Sheet, column: number, row: number,
    x: number, y: number, mirror: boolean, size: number, sourceSize: number): void {
    const image = this.#sheets[sheet]
    if (!image.complete || image.naturalWidth === 0) return
    const left = Math.round(x), top = Math.round(y)
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

  /** Glyphs are constant and few, so each colour is rasterized once into a
   *  strip and then blitted a cell at a time. */
  #fontAtlas(color: string): HTMLCanvasElement | undefined {
    const baked = this.#font.get(color)
    if (baked) return baked
    const canvas = document.createElement('canvas')
    canvas.width = GLYPH_ORDER.length * GLYPH_CELL
    canvas.height = GLYPH_CELL
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.fillStyle = color
    for (let index = 0; index < GLYPH_ORDER.length; index++) {
      const glyph = FONT[GLYPH_ORDER[index]]
      const left = index * GLYPH_CELL
      for (let row = 0; row < glyph.length; row++) {
        for (let col = 0; col < glyph[row].length; col++) {
          if (glyph[row][col] === '1') ctx.fillRect(left + col, row, 1, 1)
        }
      }
    }
    this.#font.set(color, canvas)
    return canvas
  }

  #text(text: string, x: number, y: number, color: string): void {
    const atlas = this.#fontAtlas(color)
    if (!atlas) return
    const ctx = this.ctx
    let left = Math.round(x)
    const top = Math.round(y)
    for (const letter of text) {
      const column = GLYPH_COLUMN[letter]
      if (column !== undefined) {
        ctx.drawImage(atlas, column * GLYPH_CELL, 0, GLYPH_CELL, GLYPH_CELL,
          left, top, GLYPH_CELL, GLYPH_CELL)
      }
      left += 8
    }
  }
}
