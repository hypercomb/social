// diamondcoreprocessor.com/games/arkanoid/overlay.ts
//
// The full-screen Arkanoid shell. Owns the DOM (backdrop, toolbar, canvas,
// banners), the requestAnimationFrame loop, and input (keyboard + pointer for
// play, pointer painting for the level designer). Self-contained mini-app: it
// never touches the hex grid or Pixi — it mounts above everything as a fixed
// overlay and tears itself fully down on close. ArkanoidDrone owns its
// lifecycle. The canvas is drawn at device-pixel resolution (DPR transform) so
// the art stays crisp. Keyboard input is FULLY isolated while mounted so no
// keystroke leaks to the shell.
//
// Pointer note: the bat follows the mouse via a WINDOW-level pointermove (not a
// canvas-level one) so sliding the cursor past the canvas edge — or anywhere
// over the chrome — still drives the bat to the wall instead of freezing it.
// Clicking the play field also engages Pointer Lock: the cursor is hidden and
// captured, and the bat then tracks RELATIVE motion (movementX) so it never
// freezes even when the mouse would leave the browser window entirely. Esc
// releases the lock; ending the game or opening the designer releases it too.

import { Engine, W, H, BRICK_W, BRICK_H, BRICK_TOP, BRICK_X0, POWER_META, POWER_ORDER, DIFFICULTY, type Brick } from './engine.js'
import { Renderer, brickColor } from './renderer.js'
import { LEVELS, cloneLevel, loadCustomLevels, upsertCustomLevel, deleteCustomLevel, type ArkanoidLevel } from './levels.js'
import { Designer, TOOLS, type Tool } from './designer.js'
import { Shaker, ParticleField, easeOutBack, ARCADE } from '../juice.js'
import { arkanoidThemes } from './theme.js'
import './themes/index.js'   // side-effect: load + register the built-in scene themes

const STYLE_ID = 'ark-overlay-styles'
const Z = 2147483000

const GAME_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D', ' ', 'ArrowUp', 'r', 'R',
])

type Mode = 'play' | 'design'

// Difficulty is a participant-local UI preference (like clipboard/selection), so it
// lives in localStorage — never in the layer/lineage, so it can't skew a signature.
const DIFFICULTY_KEY = 'ark:difficulty'
function loadDifficulty(): number {
  try { const n = parseInt(localStorage.getItem(DIFFICULTY_KEY) ?? '', 10); return n >= 0 && n < DIFFICULTY.length ? n : 0 } catch { return 0 }
}
function saveDifficulty(i: number): void {
  try { localStorage.setItem(DIFFICULTY_KEY, String(i)) } catch { /* private mode / quota — non-fatal */ }
}

// Level-clear flow (continuous play — identical to the Bubble/Solomon overlays
// so every game advances the same way): on clearing a screen we tally the
// level's score (+ any perfect bonus) counting up, then scroll the next level UP
// from the bottom — no button press, you just keep playing. Score + lives carry
// across levels; the toolbar still has prev / next / restart for jumping around.
const TALLY_MS = 1.7          // how long the score add-up reads
const PAN_MS = 0.85           // how long the next level takes to slide in
const PERFECT_BONUS = 1000    // awarded when a level is cleared without dying

/** One in-flight level-clear transition: first 'tally' (count the score up),
 *  then 'pan' (slide the cleared level off the top while the next rises from
 *  below). `prev` is the cleared engine, kept so it can be drawn scrolling out. */
interface Transition {
  phase: 'tally' | 'pan'
  t: number               // seconds into the current phase
  levelScore: number      // points earned on the just-cleared level
  bonus: number           // perfect-clear bonus (0 if a life was lost)
  baseScore: number       // running total at the start of the cleared level
  nextLevel: ArkanoidLevel // the level rising in
  nextIndex: number       // its index in LEVELS (for the toolbar label)
  testing: boolean        // cleared a designer test (re-pans the same level)
  prev: Engine            // the cleared engine — drawn scrolling out during 'pan'
}

/** easeInOut cubic — slow start, slow settle; reads as the screen easing up. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export class ArkanoidOverlay {
  #root: HTMLDivElement | null = null
  #canvas: HTMLCanvasElement | null = null
  #ctx: CanvasRenderingContext2D | null = null
  #renderer: Renderer | null = null
  #stage: HTMLDivElement | null = null
  #banner: HTMLDivElement | null = null
  #flyout: HTMLDivElement | null = null
  #flyoutOpen = false
  #status: HTMLSpanElement | null = null
  #levelLabel: HTMLSpanElement | null = null
  #playBar: HTMLDivElement | null = null
  #designBar: HTMLDivElement | null = null
  #nameInput: HTMLInputElement | null = null
  #loadSelect: HTMLSelectElement | null = null
  #toolButtons = new Map<Tool, HTMLButtonElement>()

  #mode: Mode = 'play'
  #engine: Engine | null = null
  #designer = new Designer()
  #levelIndex = 0
  #launchOffset: number | null = null   // the ball's on-paddle position set once (first start), reused all game
  #fireHeld = false                     // latch so keydown auto-repeat doesn't restart the fireball charge
  #difficulty = loadDifficulty()        // 0..4 (Rookie..Gangster), persisted in localStorage
  #modeBtn: HTMLButtonElement | null = null
  #themeSel: HTMLSelectElement | null = null

  // designer pointer paint state
  #painting = false
  #lastCell = { col: -1, row: -1 }
  #hover: { col: number; row: number } | null = null

  #raf = 0
  #lastTs = 0
  #time = 0
  #scaleBack = 1
  #overShown = false
  #ro: ResizeObserver | null = null

  // Continuous-play state (see the Transition note above). The engine's score is
  // the RUNNING total carried across levels; the snapshots below record where the
  // current level began so a clear can show its own gain + award a perfect bonus.
  #transition: Transition | null = null
  #levelStartScore = 0
  #levelStartLives = 3
  #testing = false                       // playing a designer test (not in LEVELS)
  #testLevel: ArkanoidLevel | null = null // the level being playtested, if any

  // juice: trauma screen-shake, a spark particle field, and a level-intro title
  // card. Shake + bursts are driven by score/lives deltas and a per-frame brick
  // snapshot diff read AFTER each engine.update() so the engine stays pure (no
  // particle/event system of its own). #intro pops in like the Bubble overlay.
  #shaker = new Shaker()
  #wasFrantic = false                 // rising-edge detector for the frenzy-start shake
  #field = new ParticleField()
  #prevScore = 0
  #prevLives = 3
  #brickAlive: boolean[] = []            // snapshot of which bricks were alive last frame
  #intro: { t: number; title: string; sub: string } | null = null

  // Pointer Lock: while locked the cursor is hidden + captured by the canvas and
  // the bat tracks RELATIVE movement (movementX), so it never freezes when the
  // mouse would leave the canvas/window. #paddleTargetX accumulates that motion
  // in world units (the engine's movePaddleTo takes an absolute X).
  #locked = false
  #paddleTargetX = W / 2

  #onClose: () => void
  constructor(onClose: () => void) { this.#onClose = onClose }

  isMounted(): boolean { return !!this.#root }

  /** Jump straight to the level designer (used by `/arkanoid design`). */
  showDesigner(): void { this.#setMode('design') }

  // ── lifecycle ────────────────────────────────────────────
  mount(): void {
    if (this.#root) return
    this.#injectStyles()
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    this.#build()
    this.#startPlay(this.#randomLevelIndex())   // random level from the very start
    window.addEventListener('keydown', this.#onKeyDown, true)
    window.addEventListener('keyup', this.#onKeyUp, true)
    window.addEventListener('resize', this.#fit)
    window.addEventListener('pointermove', this.#onPointerMove)
    window.addEventListener('pointerup', this.#onPointerUp)
    document.addEventListener('pointerlockchange', this.#onLockChange)
    arkanoidThemes.addEventListener('change', this.#syncThemeSelect)   // a later-loaded theme appears in the picker
    this.#ro = new ResizeObserver(() => this.#fit())
    if (this.#stage) this.#ro.observe(this.#stage)
    this.#lastTs = 0
    this.#raf = requestAnimationFrame(this.#loop)
  }

  unmount(): void {
    if (this.#raf) cancelAnimationFrame(this.#raf)
    this.#raf = 0
    window.removeEventListener('keydown', this.#onKeyDown, true)
    window.removeEventListener('keyup', this.#onKeyUp, true)
    window.removeEventListener('resize', this.#fit)
    window.removeEventListener('pointermove', this.#onPointerMove)
    window.removeEventListener('pointerup', this.#onPointerUp)
    document.removeEventListener('pointerlockchange', this.#onLockChange)
    arkanoidThemes.removeEventListener('change', this.#syncThemeSelect)
    this.#exitLock()
    this.#ro?.disconnect()
    this.#ro = null
    this.#root?.remove()
    this.#root = null
    this.#canvas = null
    this.#ctx = null
    this.#renderer = null
    this.#engine = null
    this.#flyout = null
    this.#flyoutOpen = false
  }

  // ── DOM ──────────────────────────────────────────────────
  #build(): void {
    const root = el('div', { class: 'ark-overlay' }) as HTMLDivElement
    root.style.zIndex = String(Z)

    const bar = el('div', { class: 'ark-bar' })
    bar.appendChild(el('span', { class: 'ark-logo', text: '◗ Arkanoid' }))

    const tabs = el('div', { class: 'ark-tabs' })
    const playTab = el('button', { class: 'ark-tab on', text: 'Play' }) as HTMLButtonElement
    const designTab = el('button', { class: 'ark-tab', text: 'Design' }) as HTMLButtonElement
    playTab.onclick = () => this.#setMode('play')
    designTab.onclick = () => this.#setMode('design')
    tabs.append(playTab, designTab)
    bar.appendChild(tabs)

    // play controls
    const playBar = el('div', { class: 'ark-ctl' }) as HTMLDivElement
    const modeBtn = el('button', { class: 'ark-btn ark-mode-btn' }) as HTMLButtonElement   // difficulty: Rookie → Gangster
    const prev = el('button', { class: 'ark-btn', text: '‹' }) as HTMLButtonElement
    const next = el('button', { class: 'ark-btn', text: '›' }) as HTMLButtonElement
    const label = el('span', { class: 'ark-level-label' }) as HTMLSpanElement
    const restart = el('button', { class: 'ark-btn', text: '↻ Restart' }) as HTMLButtonElement
    modeBtn.onclick = () => this.#cycleMode()
    prev.onclick = () => this.#cycleLevel(-1)
    next.onclick = () => this.#cycleLevel(1)
    restart.onclick = () => this.#startPlay(this.#levelIndex)
    const themeSel = el('select', { class: 'ark-select ark-theme-sel', title: 'Scene theme — community-swappable' }) as HTMLSelectElement
    themeSel.onchange = () => arkanoidThemes.setActive(themeSel.value)   // renderer reads the active theme each frame → swaps live
    playBar.append(modeBtn, prev, label, next, restart, themeSel)
    bar.appendChild(playBar)
    this.#playBar = playBar
    this.#levelLabel = label
    this.#modeBtn = modeBtn
    this.#themeSel = themeSel
    this.#syncModeBtn()
    this.#syncThemeSelect()

    // design controls
    const designBar = el('div', { class: 'ark-ctl ark-hidden' }) as HTMLDivElement
    const palette = el('div', { class: 'ark-palette' })
    for (const t of TOOLS) {
      const b = el('button', { class: 'ark-tool', title: t.label, text: t.label }) as HTMLButtonElement
      b.style.setProperty('--tool-color', t.color)
      b.onclick = () => this.#setTool(t.tool)
      this.#toolButtons.set(t.tool, b)
      palette.appendChild(b)
    }
    designBar.appendChild(palette)
    const nameInput = el('input', { class: 'ark-name', placeholder: 'level name' }) as HTMLInputElement
    nameInput.value = this.#designer.name
    designBar.appendChild(nameInput)
    this.#nameInput = nameInput
    const mkBtn = (txt: string, fn: () => void) => { const b = el('button', { class: 'ark-btn', text: txt }) as HTMLButtonElement; b.onclick = fn; return b }
    designBar.appendChild(mkBtn('New', () => this.#designerNew()))
    designBar.appendChild(mkBtn('Save', () => this.#designerSave()))
    designBar.appendChild(mkBtn('▶ Test', () => this.#designerTest()))
    const loadSel = el('select', { class: 'ark-select' }) as HTMLSelectElement
    loadSel.onchange = () => this.#designerLoad(loadSel.value)
    designBar.appendChild(loadSel)
    this.#loadSelect = loadSel
    designBar.appendChild(mkBtn('Delete', () => this.#designerDelete()))
    designBar.appendChild(mkBtn('Export', () => this.#designerExport()))
    designBar.appendChild(mkBtn('Import', () => this.#designerImport()))
    bar.appendChild(designBar)
    this.#designBar = designBar

    const status = el('span', { class: 'ark-status' }) as HTMLSpanElement
    bar.appendChild(status)
    this.#status = status

    const close = el('button', { class: 'ark-close', text: '✕', title: 'Close (Esc)' }) as HTMLButtonElement
    close.onclick = () => this.#onClose()
    bar.appendChild(close)
    root.appendChild(bar)

    const stage = el('div', { class: 'ark-stage' }) as HTMLDivElement
    const canvas = el('canvas', { class: 'ark-canvas' }) as HTMLCanvasElement
    canvas.addEventListener('pointerdown', this.#onPointerDown)
    canvas.addEventListener('contextmenu', e => e.preventDefault())   // right-click fires the missile, not a menu
    stage.appendChild(canvas)
    const banner = el('div', { class: 'ark-banner ark-hidden' }) as HTMLDivElement
    stage.appendChild(banner)
    const flyout = this.#buildFlyout()
    stage.appendChild(flyout)
    root.appendChild(stage)
    this.#stage = stage
    this.#banner = banner
    this.#flyout = flyout

    const help = el('div', { class: 'ark-help' })
    help.innerHTML = '<b>← →</b> / <b>mouse</b> move the bat &nbsp;·&nbsp; <b>Space</b> / left-click: launch — or <b>HOLD</b> to charge a <b>Laser</b> fireball, release to fire &nbsp;·&nbsp; <b>right-click</b>: missile &nbsp;·&nbsp; pills: <b>O</b>scillate <b>B</b>reak <b>L</b>aser <b>E</b>xpand <b>G</b>un <b>M</b>agnet <b>↑</b>Rocket <b>×</b>Multiplier <b>∗</b>Burst <b>P</b>inball <b>I</b>Beam &nbsp;·&nbsp; <b>R</b> restart &nbsp;·&nbsp; <b>Esc</b> release / close'
    root.appendChild(help)

    document.body.appendChild(root)
    this.#root = root
    this.#canvas = canvas
    this.#ctx = canvas.getContext('2d')
    if (this.#ctx) this.#renderer = new Renderer(this.#ctx)
    this.#refreshLoadSelect()
    this.#updateToolButtons()
  }

  // ── power-up flyout (left rail) ──────────────────────────
  // A slide-out reference for every pill, built once from POWER_META so the
  // legend can never drift from what the engine actually does.
  #buildFlyout(): HTMLDivElement {
    const fly = el('div', { class: 'ark-flyout' }) as HTMLDivElement
    const tab = el('button', { class: 'ark-flyout-tab', title: 'Power-up guide' }) as HTMLButtonElement
    tab.innerHTML = '<span class="ark-tab-label">PILLS</span><span class="ark-tab-chev">▸</span>'
    tab.onclick = () => this.#toggleFlyout()

    const panel = el('div', { class: 'ark-flyout-panel' }) as HTMLDivElement
    panel.appendChild(el('div', { class: 'ark-fly-head', text: 'Power-ups' }))
    for (const kind of POWER_ORDER) {
      const meta = POWER_META[kind]
      const row = el('div', { class: 'ark-pill-row' })
      const badge = el('div', { class: 'ark-pill-badge', text: meta.letter })
      badge.style.background = meta.color
      badge.style.boxShadow = `0 0 10px ${meta.color}aa`
      const txt = el('div', { class: 'ark-pill-text' })
      const nm = el('div', { class: 'ark-pill-name', text: meta.name.charAt(0).toUpperCase() + meta.name.slice(1) })
      nm.style.color = meta.color
      txt.append(nm, el('div', { class: 'ark-pill-desc', text: meta.desc }))
      row.append(badge, txt)
      panel.appendChild(row)
    }
    panel.appendChild(el('div', { class: 'ark-fly-head', text: 'Good to know' }))
    const basics: [string, string][] = [
      ['White ball = life', 'The white ball is your life; coloured balls are ammo. Lose the white one and you lose a life.'],
      ['The hunter', 'Dawdle too long and a hunter chases your white ball; a hit whacks your ball away fast (no instant loss). 3 hits — from the ball, ammo, lasers, or a rocket — destroy it.'],
      ['Sparkle bricks', 'Every 5 hits you land on the hunter, a sparkling brick appears and blooms into a big one. Five hits shatter it into shards — one hides a multiplier.'],
      ['Controls', '← → or mouse to move · Space / left-click to launch — or HOLD to charge a Laser fireball and release to fire · right-click to fire the missile · R restart · Esc to close.'],
    ]
    for (const [t, d] of basics) {
      const row = el('div', { class: 'ark-info-row' })
      row.append(el('div', { class: 'ark-info-title', text: t }), el('div', { class: 'ark-pill-desc', text: d }))
      panel.appendChild(row)
    }
    fly.append(panel, tab)
    return fly
  }

  #toggleFlyout(): void {
    this.#flyoutOpen = !this.#flyoutOpen
    this.#flyout?.classList.toggle('open', this.#flyoutOpen)
  }

  // ── mode + level control ──────────────────────────────────
  #setMode(mode: Mode): void {
    if (this.#mode === mode) return
    this.#mode = mode
    this.#syncTabs()
    this.#playBar?.classList.toggle('ark-hidden', mode !== 'play')
    this.#designBar?.classList.toggle('ark-hidden', mode !== 'design')
    this.#hideBanner()
    if (this.#canvas) this.#canvas.style.cursor = mode === 'design' ? 'crosshair' : 'none'
    if (mode === 'play') { this.#startPlay(this.#levelIndex) }
    else {
      this.#fireHeld = false; this.#engine?.releaseLaser()   // don't strand a held fireball charge on mode switch
      this.#exitLock()
      if (this.#nameInput) this.#nameInput.value = this.#designer.name
      this.#refreshLoadSelect()
      this.#updateToolButtons()
    }
  }

  #syncTabs(): void {
    const tabs = this.#root?.querySelectorAll('.ark-tab')
    tabs?.forEach((t, i) => t.classList.toggle('on', (i === 0) === (this.#mode === 'play')))
  }

  /** A random level index, optionally avoiding an immediate repeat. Auto-play
   *  (initial start + every level clear) picks at random; prev/next still walk
   *  LEVELS in order for manual jumping. */
  #randomLevelIndex(exclude = -1): number {
    if (LEVELS.length <= 1) return 0
    let n = exclude
    while (n === exclude) n = Math.floor(Math.random() * LEVELS.length)
    return n
  }

  #startPlay(index: number): void {
    const level = LEVELS[index]
    if (!level) return
    this.#levelIndex = index
    this.#testing = false
    this.#testLevel = null
    this.#startPlayLevel(cloneLevel(level), `${level.name}  (${index + 1}/${LEVELS.length})`, level.name, `LEVEL ${index + 1}`)
  }

  #startPlayLevel(level: ArkanoidLevel, label: string, introTitle: string, introSub: string): void {
    this.#mode = 'play'
    this.#syncTabs()
    this.#playBar?.classList.remove('ark-hidden')
    this.#designBar?.classList.add('ark-hidden')
    if (this.#canvas) this.#canvas.style.cursor = 'none'
    this.#engine = new Engine(level.rows)
    this.#engine.levelIndex = this.#levelIndex          // level → enemy-swarm size
    this.#engine.invaderPills = /invader/i.test(level.name)   // pills march like Space Invaders here
    this.#engine.difficulty = DIFFICULTY[this.#difficulty]   // the selected mode tunes the run
    this.#engine.lives = DIFFICULTY[this.#difficulty].lives  // fresh run starts on the mode's lives
    if (this.#launchOffset !== null) this.#engine.pinLaunchOffset(this.#launchOffset)   // reuse the on-paddle position; aim only the first time
    this.#paddleTargetX = this.#engine.paddle.x
    // Fresh run from this level: score back to 0, full lives, no carry-over.
    this.#transition = null
    this.#overShown = false
    this.#levelStartScore = this.#engine.score
    this.#levelStartLives = this.#engine.lives
    this.#syncJuice(this.#engine)
    this.#hideBanner()
    this.#fit()
    if (this.#levelLabel) this.#levelLabel.textContent = label
    this.#beginIntro(introTitle, introSub)
  }

  #cycleLevel(dir: number): void {
    const n = (this.#levelIndex + dir + LEVELS.length) % LEVELS.length
    this.#startPlay(n)
  }

  /** Advance the difficulty (Rookie → Hustler → Made → Kingpin → Gangster → Rookie),
   *  persist it, flash the swaggering tagline, and restart so the mode takes effect. */
  #cycleMode(): void {
    this.#difficulty = (this.#difficulty + 1) % DIFFICULTY.length
    saveDifficulty(this.#difficulty)
    this.#syncModeBtn()
    this.#flash(DIFFICULTY[this.#difficulty].tagline)
    this.#startPlay(this.#levelIndex)          // a mode change restarts the level (never mutates a live ball)
  }

  /** Label + colour-code the mode chip — calm steel for Rookie escalating to hot red
   *  for Gangster (one accent var; the chrome stays slim and cold-clean). */
  #syncModeBtn(): void {
    const btn = this.#modeBtn
    if (!btn) return
    const d = DIFFICULTY[this.#difficulty]
    btn.textContent = `◆ ${d.name}`
    btn.title = d.tagline
    const heat = this.#difficulty / (DIFFICULTY.length - 1)   // 0 = Rookie, 1 = Gangster
    const accent = `hsl(${Math.round(200 - heat * 200)}, ${Math.round(55 + heat * 35)}%, ${Math.round(62 - heat * 8)}%)`
    btn.style.setProperty('--mode-accent', accent)
    btn.style.color = accent
    btn.style.borderColor = accent
  }

  /** Repopulate the scene-theme picker from the registry (built-ins + any community
   *  themes that have registered) and reflect the active pick. Re-run on registry
   *  'change' so a theme module loaded later still shows up. */
  #syncThemeSelect = (): void => {
    const sel = this.#themeSel
    if (!sel) return
    const active = arkanoidThemes.activeId()
    sel.innerHTML = ''
    for (const t of arkanoidThemes.list()) sel.appendChild(opt(t.id, `✦ ${t.name}`))
    if (active) sel.value = active
  }

  // ── juice: shake + spark bursts + level intro ────────────
  // The engine is pure (no particle/event system), so the overlay infers events:
  // a per-frame brick snapshot diff drives break sparks, and score/lives deltas
  // drive shake + a death burst — all read AFTER engine.update().

  /** Remember which bricks are alive going into this frame's update. */
  #snapshotBricks(e: Engine): void {
    const arr = this.#brickAlive
    arr.length = e.bricks.length
    for (let i = 0; i < e.bricks.length; i++) arr[i] = e.bricks[i].alive
  }

  /** Any brick that went alive→dead since the snapshot bursts sparks at its
   *  centre, tinted to its colour. A rocket wiping a cluster naturally fires many
   *  bursts at once → a big shower + cumulative shake, no special-casing. */
  #diffBricks(e: Engine): void {
    const arr = this.#brickAlive
    let broke = 0
    const n = Math.min(arr.length, e.bricks.length)
    for (let i = 0; i < n; i++) {
      const b: Brick = e.bricks[i]
      // `covered` bricks were silently consumed under a blooming mega, NOT hit by
      // the player — no sparks / shake for those.
      if (arr[i] && !b.alive && !b.covered) {
        broke++
        this.#field.burst(b.x + b.w / 2, b.y + b.h / 2, {
          count: 14, speed: 130, size: 2.3, life: 0.5, gravity: 340, drag: 1.7,
          color: [brickColor(b.max), ...ARCADE.spark],
        })
      }
    }
    if (broke > 0) { this.#shaker.add(0.16 + Math.min(0.5, (broke - 1) * 0.07)); this.#renderer?.spike(0.35 + Math.min(0.9, broke * 0.18)) }   // the whole keep flares on the break
  }

  /** Read the post-update engine and turn meaningful changes into shake/sparks.
   *  Pure inference (score/lives deltas) keeps the engine free of view concerns. */
  #senseJuice(): void {
    const e = this.#engine
    if (!e) return
    if (e.lives < this.#prevLives) {
      // A life lost — the biggest kick + an ember shower at the floor (where the
      // white ball was lost), under the bat.
      this.#shaker.add(0.95)
      this.#field.burst(e.paddle.x, H - 6, {
        count: 22, speed: 180, size: 2.6, life: 0.7, gravity: 120, drag: 1.4,
        color: [...ARCADE.ember], angle: -Math.PI / 2, arc: Math.PI * 1.2,
      })
    }
    this.#prevScore = e.score
    this.#prevLives = e.lives
  }

  /** Snap the juice baselines to an engine without firing shake (level swaps /
   *  starts): reset deltas, the brick snapshot, the shaker, and clear sparks. */
  #syncJuice(e: Engine): void {
    this.#prevScore = e.score
    this.#prevLives = e.lives
    this.#brickAlive = e.bricks.map(b => b.alive)
    this.#shaker = new Shaker()
    this.#field.clear()
  }

  #beginIntro(title: string, sub: string): void { this.#intro = { t: 0, title, sub } }

  /** A short, non-blocking title card that pops in (overshoot), holds, then fades
   *  — identical in spirit to the Bubble overlay. Drawn in world units over the
   *  live game so play never stalls behind it. */
  #drawIntro(ctx: CanvasRenderingContext2D, dt: number): void {
    const intro = this.#intro
    if (!intro) return
    intro.t += dt
    const DUR = 1.7
    if (intro.t >= DUR) { this.#intro = null; return }
    const p = intro.t / DUR
    const appear = easeOutBack(Math.min(1, p / 0.22))
    const fade = p > 0.72 ? Math.max(0, 1 - (p - 0.72) / 0.28) : 1
    ctx.save()
    ctx.globalAlpha = fade
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.translate(W / 2, H * 0.36)
    ctx.scale(0.62 + 0.38 * appear, 0.62 + 0.38 * appear)
    ctx.shadowColor = 'rgba(126,224,255,0.6)'
    ctx.shadowBlur = 20
    ctx.fillStyle = ARCADE.cyan
    ctx.font = '800 ' + Math.round(H * 0.085) + 'px "Segoe UI", system-ui, sans-serif'
    ctx.fillText(intro.title, 0, 0)
    ctx.shadowBlur = 0
    ctx.fillStyle = ARCADE.gold
    ctx.font = '600 ' + Math.round(H * 0.04) + 'px "Segoe UI", system-ui, sans-serif'
    ctx.fillText(intro.sub, 0, H * 0.08)
    ctx.restore()
  }

  // Crisp scaling: back the canvas with device pixels and draw the world
  // through a single scale transform. The renderer works in world units.
  #fit = (): void => {
    const c = this.#canvas, s = this.#stage
    if (!c || !s) return
    const availW = (s.clientWidth - 28) * 0.9    // narrow the screen to 90% of the stage width (margins each side)
    const availH = s.clientHeight - 28
    if (availW <= 0 || availH <= 0) return
    const cssScale = Math.min(availW / W, availH / H)
    const dispW = W * cssScale, dispH = H * cssScale
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = Math.round(dispW * dpr)
    c.height = Math.round(dispH * dpr)
    c.style.width = `${Math.round(dispW)}px`
    c.style.height = `${Math.round(dispH)}px`
    this.#scaleBack = cssScale * dpr
    if (this.#ctx) this.#ctx.imageSmoothingEnabled = true
  }

  // ── loop ─────────────────────────────────────────────────
  #loop = (ts: number): void => {
    if (!this.#root) return
    if (!this.#lastTs) this.#lastTs = ts
    const dt = Math.min((ts - this.#lastTs) / 1000, 1 / 30)
    this.#lastTs = ts
    this.#time += dt

    const ctx = this.#ctx, r = this.#renderer
    if (ctx && r) {
      this.#shaker.update(dt)
      const sh = this.#shaker.offset()
      // Clear the whole backing buffer in DEVICE space first so a shake translate
      // can never smear the trailing edge; then draw the world through the scale
      // transform with the shake folded into its translation (same model as the
      // Bubble overlay).
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      ctx.setTransform(this.#scaleBack, 0, 0, this.#scaleBack, sh.x * this.#scaleBack, sh.y * this.#scaleBack)
      if (this.#mode === 'play' && this.#engine) {
        if (this.#transition) {
          // A level was cleared: the simulation is frozen while the score tallies
          // and the next screen scrolls in.
          this.#stepTransition(dt)
          this.#drawTransition(ctx, r)
        } else {
          // Snapshot brick life BEFORE update, diff AFTER, so any brick that died
          // this frame (ball, laser, or a rocket wiping a cluster) bursts sparks
          // at its centre — the engine needs no particle/event system.
          this.#snapshotBricks(this.#engine)
          this.#engine.update(dt)
          if (this.#engine.frantic && !this.#wasFrantic) { this.#shaker.add(1.1); this.#renderer?.spike(2.0) }   // frenzy start → hard shake + board-wide neon flare
          this.#wasFrantic = this.#engine.frantic
          this.#senseJuice()
          this.#diffBricks(this.#engine)
          r.draw(this.#engine, this.#time)
          this.#field.update(dt)
          this.#field.draw(ctx)
          this.#drawIntro(ctx, dt)
          if (this.#engine.state === 'won') this.#beginClear()
          else if (this.#engine.state === 'gameover' && !this.#overShown) { this.#overShown = true; this.#showGameOver() }
        }
      } else if (this.#mode === 'design') {
        r.drawEditor(this.#designer.grid, this.#hover)
      }
    }
    this.#raf = requestAnimationFrame(this.#loop)
  }

  // ── input (fully isolated) ───────────────────────────────
  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.#onClose(); return }
    if (e.ctrlKey || e.metaKey || e.altKey) return       // let OS/browser shortcuts pass
    if (document.activeElement === this.#nameInput) return // typing the level name
    e.preventDefault(); e.stopImmediatePropagation()
    if (this.#mode !== 'play') return
    const eng = this.#engine
    if (!eng || !GAME_KEYS.has(e.key)) return
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': eng.input.left = true; break
      case 'ArrowRight': case 'd': case 'D': eng.input.right = true; break
      case ' ': case 'ArrowUp': {
        if (e.repeat || this.#fireHeld) break                 // OS key-repeat: ignore — only the first edge counts
        this.#fireHeld = true
        if (eng.laserShots > 0 && !eng.aiming) eng.startLaserCharge()   // armed: HOLD charges the fireball
        else eng.shoot()                                      // otherwise: launch the ball / fire the gun
        break
      }
      case 'r': case 'R': this.#startPlay(this.#levelIndex); break
    }
  }

  #onKeyUp = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (document.activeElement === this.#nameInput) return
    e.stopImmediatePropagation()
    const eng = this.#engine
    if (!eng) return
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': eng.input.left = false; break
      case 'ArrowRight': case 'd': case 'D': eng.input.right = false; break
      case ' ': case 'ArrowUp': { this.#fireHeld = false; if (eng.laserCharging) eng.releaseLaser(); break }   // RELEASE launches the fireball
    }
  }

  #worldXFromEvent(e: PointerEvent): number | null {
    const c = this.#canvas
    if (!c) return null
    const rect = c.getBoundingClientRect()
    if (rect.width <= 0) return null
    return ((e.clientX - rect.left) / rect.width) * W   // may fall outside [0,W]; the engine clamps
  }

  #cellFromEvent(e: PointerEvent): { col: number; row: number } | null {
    const c = this.#canvas
    if (!c) return null
    const rect = c.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const wx = ((e.clientX - rect.left) / rect.width) * W
    const wy = ((e.clientY - rect.top) / rect.height) * H
    return { col: Math.floor((wx - BRICK_X0) / BRICK_W), row: Math.floor((wy - BRICK_TOP) / BRICK_H) }
  }

  #onPointerMove = (e: PointerEvent): void => {
    // Don't steer the bat while the mouse is reading the open power-up flyout.
    if (this.#flyoutOpen && this.#flyout && e.target instanceof Node && this.#flyout.contains(e.target)) return
    if (this.#mode === 'play') {
      if (this.#locked) {
        // Relative: accumulate captured motion (clientX is meaningless under lock).
        this.#paddleTargetX = Math.max(0, Math.min(W, this.#paddleTargetX + e.movementX * this.#worldPerCssPx()))
        this.#engine?.movePaddleTo(this.#paddleTargetX)
      } else {
        const x = this.#worldXFromEvent(e)
        if (x !== null) this.#engine?.movePaddleTo(x)
      }
    } else {
      const cell = this.#cellFromEvent(e)
      this.#hover = cell
      if (this.#painting && cell) this.#paintAt(cell)
    }
  }

  // ── pointer lock ─────────────────────────────────────────
  // CSS px → world units, so a 1px mouse move travels the same world distance
  // regardless of how big the canvas is scaled on screen.
  #worldPerCssPx(): number {
    const c = this.#canvas
    if (!c) return 1
    const rect = c.getBoundingClientRect()
    return rect.width > 0 ? W / rect.width : 1
  }

  #requestLock(): void {
    if (this.#mode !== 'play') return
    if (document.pointerLockElement === this.#canvas) return
    try { void this.#canvas?.requestPointerLock?.() } catch { /* gesture/permission — ignore */ }
  }

  #exitLock(): void {
    if (document.pointerLockElement === this.#canvas) {
      try { document.exitPointerLock?.() } catch { /* ignore */ }
    }
  }

  #onLockChange = (): void => {
    this.#locked = document.pointerLockElement === this.#canvas
    // Re-seed the accumulator from the live bat so capture never jumps.
    if (this.#locked && this.#engine) this.#paddleTargetX = this.#engine.paddle.x
  }

  #onPointerDown = (e: PointerEvent): void => {
    e.preventDefault()
    if (this.#mode === 'play') {
      const eng = this.#engine
      if (eng && eng.aiming) {                              // one-time aim: this click sets the on-paddle spot + frees the paddle (launch any time)
        eng.aimClick()
        if (!eng.aiming) this.#launchOffset = eng.launchOffset   // set → remember the on-paddle position all game
        return
      }
      if (eng && eng.pinballTimer > 0) {                    // pinball: mouse buttons ARE the flippers
        if (e.button === 2) eng.flipRight(true); else eng.flipLeft(true)
        return
      }
      if (e.button === 2) { eng?.fireRocket(); return }     // right-click = missile
      this.#requestLock()                                   // capture + hide the cursor
      if (!this.#locked) {                                  // lock is async — place the bat this once
        const x = this.#worldXFromEvent(e)
        if (x !== null) this.#engine?.movePaddleTo(x)
      }
      if (eng && eng.laserShots > 0 && !eng.aiming) eng.startLaserCharge()   // armed: HOLD left-click charges the fireball
      else this.#engine?.shoot()
    } else {
      const cell = this.#cellFromEvent(e)
      if (!cell) return
      this.#painting = true
      this.#lastCell = { col: -1, row: -1 }
      this.#paintAt(cell)
      this.#canvas?.setPointerCapture?.(e.pointerId)
    }
  }

  #onPointerUp = (e: PointerEvent): void => {
    this.#painting = false
    const eng = this.#engine                                // release the flipper (safe in any mode)
    if (eng) {
      if (e.button === 2) eng.flipRight(false)
      else { eng.flipLeft(false); if (eng.laserCharging) eng.releaseLaser() }   // left-button release launches the fireball
    }
  }

  #paintAt(cell: { col: number; row: number }): void {
    if (cell.col === this.#lastCell.col && cell.row === this.#lastCell.row) return
    this.#lastCell = cell
    this.#designer.paint(cell.col, cell.row)
  }

  // ── designer actions ──────────────────────────────────────
  #setTool(tool: Tool): void { this.#designer.setTool(tool); this.#updateToolButtons() }

  #updateToolButtons(): void {
    for (const [tool, b] of this.#toolButtons) b.classList.toggle('on', tool === this.#designer.tool)
  }

  #designerNew(): void {
    this.#designer.newLevel('My Level')
    if (this.#nameInput) this.#nameInput.value = this.#designer.name
    this.#flash('new blank level')
  }

  #designerSave(): void {
    const name = (this.#nameInput?.value ?? '').trim() || 'My Level'
    upsertCustomLevel(this.#designer.named(name))
    this.#refreshLoadSelect(name)
    this.#flash(`saved “${name}”`)
  }

  #designerTest(): void {
    const name = (this.#nameInput?.value ?? '').trim() || 'My Level'
    const level = this.#designer.named(name)
    this.#testing = true
    this.#testLevel = level
    this.#startPlayLevel(level, `${name}  (test)`, name, 'TEST')
  }

  #designerLoad(name: string): void {
    if (!name) return
    const lvl = loadCustomLevels().find(l => l.name === name) ?? LEVELS.find(l => l.name === name)
    if (!lvl) return
    this.#designer.setLevel(cloneLevel(lvl))
    if (this.#nameInput) this.#nameInput.value = lvl.name
    this.#flash(`editing “${name}”`)
  }

  #designerDelete(): void {
    const name = (this.#nameInput?.value ?? '').trim()
    if (!name) return
    deleteCustomLevel(name)
    this.#refreshLoadSelect()
    this.#flash(`deleted “${name}”`)
  }

  #designerExport(): void {
    const json = this.#designer.exportJson()
    try { void navigator.clipboard?.writeText(json); this.#flash('level JSON copied to clipboard') }
    catch { this.#flash('copy failed — see console'); console.log(json) }
  }

  #designerImport(): void {
    const text = window.prompt('Paste level JSON:')
    if (!text) return
    if (this.#designer.importJson(text)) {
      if (this.#nameInput) this.#nameInput.value = this.#designer.name
      this.#flash('level imported')
    } else this.#flash('import failed — invalid JSON')
  }

  #refreshLoadSelect(selected?: string): void {
    const sel = this.#loadSelect
    if (!sel) return
    const custom = loadCustomLevels()
    sel.innerHTML = ''
    sel.appendChild(opt('', custom.length ? '— load —' : '— no custom levels —'))
    for (const b of LEVELS) sel.appendChild(opt(b.name, `(built-in) ${b.name}`))
    for (const l of custom) sel.appendChild(opt(l.name, l.name))
    if (selected) sel.value = selected
  }

  // ── level clear → tally → pan to next (continuous play) ──

  /** Level cleared. Compute the level's score gain + any perfect bonus and open
   *  the tally→pan transition. Levels wrap, so play never stops on a clear. The
   *  bat keeps its pointer lock — play just continues into the next screen. */
  #beginClear(): void {
    const eng = this.#engine
    if (!eng || this.#transition || this.#mode !== 'play') return
    const levelScore = Math.max(0, eng.score - this.#levelStartScore)
    // lives only ever fall within a level, so "same as we started" ⇒ no deaths.
    const bonus = eng.lives >= this.#levelStartLives ? PERFECT_BONUS : 0

    // Continuous play advances to a RANDOM next level (no immediate repeat);
    // a designer test re-pans the same level.
    const nextIndex = this.#testing ? this.#levelIndex : this.#randomLevelIndex(this.#levelIndex)
    const nextLevel = this.#testing
      ? (this.#testLevel ?? LEVELS[this.#levelIndex])
      : (LEVELS[nextIndex] ?? LEVELS[this.#levelIndex])

    this.#transition = {
      phase: 'tally', t: 0,
      levelScore, bonus, baseScore: this.#levelStartScore,
      nextLevel, nextIndex, testing: this.#testing, prev: eng,
    }
    this.#hideBanner()
  }

  /** Advance the active transition: count the tally, then build + scroll in the
   *  next level (carrying the running score — bonus included — and lives). The
   *  bat carries its X so it doesn't snap to centre between screens. */
  #stepTransition(dt: number): void {
    const tr = this.#transition
    if (!tr) return
    tr.t += dt
    if (tr.phase === 'tally') {
      if (tr.t < TALLY_MS) return
      const carriedScore = tr.baseScore + tr.levelScore + tr.bonus
      const e = new Engine(tr.nextLevel.rows)
      e.levelIndex = tr.nextIndex          // level → enemy-swarm size
      e.invaderPills = /invader/i.test(tr.nextLevel.name)
      e.difficulty = DIFFICULTY[this.#difficulty]   // same mode carries into the next level
      e.score = carriedScore
      e.lives = tr.prev.lives              // lives carry over mid-run (don't reset to the mode default)
      e.paddle.x = tr.prev.paddle.x        // carry the paddle position; base range ⊂ any expanded range
      if (this.#launchOffset !== null) e.pinLaunchOffset(this.#launchOffset)   // ball rides the set on-paddle offset; no re-aim
      this.#engine = e
      this.#paddleTargetX = e.paddle.x
      this.#levelIndex = tr.nextIndex
      this.#levelStartScore = e.score
      this.#levelStartLives = e.lives
      // Snap the juice baselines to the new engine so the score/lives carry-over
      // doesn't fire a spurious shake and the brick snapshot starts fresh.
      this.#syncJuice(e)
      if (this.#levelLabel) {
        this.#levelLabel.textContent = tr.testing
          ? `${tr.nextLevel.name}  (test)`
          : `${tr.nextLevel.name}  (${tr.nextIndex + 1}/${LEVELS.length})`
      }
      tr.phase = 'pan'
      tr.t = 0
    } else if (tr.t >= PAN_MS) {
      this.#transition = null   // hand control back — play resumes on the new level
      // Pop the level-intro card the moment play resumes (same as Bubble).
      this.#beginIntro(tr.nextLevel.name, tr.testing ? 'TEST' : `LEVEL ${tr.nextIndex + 1}`)
    }
  }

  /** Render the transition: the frozen cleared level under the score tally, then
   *  the cleared level sliding off the top while the next rises from the bottom.
   *  The loop has already applied the world scale transform + cleared the frame. */
  #drawTransition(ctx: CanvasRenderingContext2D, r: Renderer): void {
    const tr = this.#transition
    if (!tr) return
    if (tr.phase === 'tally') {
      r.draw(tr.prev, this.#time)
      this.#drawTally(ctx, tr)
    } else {
      const p = easeInOut(Math.min(1, tr.t / PAN_MS))
      ctx.save(); ctx.translate(0, -p * H); r.draw(tr.prev, this.#time); ctx.restore()
      ctx.save(); ctx.translate(0, (1 - p) * H); r.draw(this.#engine!, this.#time); ctx.restore()
    }
  }

  /** The score add-up overlay: level gain counts up first, then any perfect
   *  bonus, with the running total ticking alongside. Drawn in world units. */
  #drawTally(ctx: CanvasRenderingContext2D, tr: Transition): void {
    const w = W, h = H
    const cx = w / 2
    const p = Math.min(1, tr.t / TALLY_MS)
    // Count the level score over the first ~62%, then the bonus over the rest.
    const levelP = Math.min(1, p / 0.62)
    const bonusP = tr.bonus > 0 ? Math.max(0, Math.min(1, (p - 0.62) / 0.30)) : 0
    const shownLevel = Math.round(tr.levelScore * levelP)
    const shownBonus = Math.round(tr.bonus * bonusP)
    const shownTotal = tr.baseScore + shownLevel + shownBonus
    const font = (size: number, weight = 700) =>
      `${weight} ${Math.round(size)}px "Segoe UI", system-ui, sans-serif`

    ctx.save()
    ctx.fillStyle = 'rgba(6,8,18,0.66)'
    ctx.fillRect(0, 0, w, h)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    ctx.fillStyle = '#7ee0ff'
    ctx.font = font(h * 0.085, 800)
    ctx.fillText('LEVEL CLEAR', cx, h * 0.30)

    ctx.fillStyle = '#ffffff'
    ctx.font = font(h * 0.045)
    ctx.fillText(`Level  +${shownLevel}`, cx, h * 0.46)

    if (tr.bonus > 0) {
      ctx.fillStyle = bonusP > 0 ? '#ffd76a' : 'rgba(255,215,106,0.28)'
      ctx.fillText(`Perfect Bonus  +${shownBonus}`, cx, h * 0.555)
    }

    ctx.fillStyle = '#bfe3ff'
    ctx.font = font(h * 0.054, 800)
    ctx.fillText(`✦ ${shownTotal}`, cx, h * 0.69)
    ctx.restore()
  }

  // ── banners + status ──────────────────────────────────────
  #showGameOver(): void {
    this.#exitLock()                                        // free the cursor for the banner buttons
    const score = this.#engine?.score ?? 0
    this.#showBanner('Game Over', `✦ ${score}`, [
      { label: '▶ Continue', fn: () => this.#continue() },          // keep score, fresh lives, same level
      { label: '↻ Restart', fn: () => this.#startPlay(this.#levelIndex) },
    ])
  }

  /** Resume the run after a game over — refill lives, keep the score and the
   *  bricks still standing, and hand control straight back so you play through. */
  #continue(): void {
    const eng = this.#engine
    if (!eng) return
    eng.continueGame()
    this.#overShown = false
    this.#hideBanner()
  }

  #showBanner(title: string, sub: string, actions: { label: string; fn: () => void }[]): void {
    const b = this.#banner
    if (!b) return
    b.innerHTML = ''
    b.appendChild(el('div', { class: 'ark-banner-title', text: title }))
    b.appendChild(el('div', { class: 'ark-banner-sub', text: sub }))
    const row = el('div', { class: 'ark-banner-actions' })
    for (const a of actions) {
      const btn = el('button', { class: 'ark-btn ark-btn-lg', text: a.label }) as HTMLButtonElement
      btn.onclick = a.fn
      row.appendChild(btn)
    }
    b.appendChild(row)
    b.classList.remove('ark-hidden')
  }

  #hideBanner(): void { this.#banner?.classList.add('ark-hidden') }

  #flashTimer = 0
  #flash(msg: string): void {
    if (!this.#status) return
    this.#status.textContent = msg
    if (this.#flashTimer) clearTimeout(this.#flashTimer)
    this.#flashTimer = window.setTimeout(() => { if (this.#status) this.#status.textContent = '' }, 2600)
  }

  // ── styles ───────────────────────────────────────────────
  #injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = CSS
    document.head.appendChild(style)
  }
}

// ── tiny DOM helpers ───────────────────────────────────────
function el(tag: string, props: { class?: string; text?: string; title?: string; placeholder?: string } = {}): HTMLElement {
  const e = document.createElement(tag)
  if (props.class) e.className = props.class
  if (props.text != null) e.textContent = props.text
  if (props.title) e.title = props.title
  if (props.placeholder) (e as HTMLInputElement).placeholder = props.placeholder
  return e
}

function opt(value: string, label: string): HTMLOptionElement {
  const o = document.createElement('option')
  o.value = value; o.textContent = label
  return o
}

const CSS = `
.ark-overlay{position:fixed;inset:0;display:flex;flex-direction:column;
  background:radial-gradient(130% 120% at 50% -8%,#3a2a8f 0%,#241a66 44%,#140f3e 78%,#0a0826 100%);
  font-family:'Segoe UI',system-ui,sans-serif;color:#e8e0ff;user-select:none;
  animation:ark-in .22s ease both}
@keyframes ark-in{from{opacity:0}to{opacity:1}}
@keyframes ark-candle{0%,100%{opacity:.78}45%{opacity:1}62%{opacity:.7}80%{opacity:.95}}
.ark-bar{display:flex;align-items:center;gap:.5rem;padding:.45rem .7rem;
  background:linear-gradient(180deg,rgba(18,10,34,.92),rgba(10,8,20,.86));
  border-bottom:1px solid rgba(122,60,255,.34);
  box-shadow:0 1px 0 rgba(57,255,106,.10),0 10px 30px rgba(0,0,0,.5);flex-wrap:wrap}
.ark-logo{font-weight:800;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;
  color:#39ff6a;text-shadow:0 0 6px rgba(57,255,106,.9),0 0 18px rgba(57,255,106,.5),0 0 2px #2be36b;
  animation:ark-candle 3.4s ease-in-out infinite}
.ark-tabs{display:flex;gap:.25rem;margin-left:.3rem}
.ark-tab{background:transparent;border:1px solid rgba(182,92,255,.34);color:#cbb6ff;
  padding:.2rem .7rem;border-radius:999px;cursor:pointer;font-size:.85rem;transition:all .15s ease}
.ark-tab:hover{border-color:rgba(182,92,255,.6);color:#e8e0ff}
.ark-tab.on{background:rgba(122,60,255,.26);color:#fff;border-color:rgba(182,92,255,.85);
  box-shadow:0 0 10px rgba(182,92,255,.55),inset 0 0 8px rgba(182,92,255,.2)}
.ark-ctl{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}
.ark-level-label{min-width:10rem;text-align:center;font-size:.85rem;color:#c8bdf0}
.ark-btn{background:rgba(122,60,255,.14);border:1px solid rgba(182,92,255,.32);
  color:#e8e0ff;padding:.22rem .6rem;border-radius:7px;cursor:pointer;font-size:.82rem;
  transition:background .15s ease,box-shadow .15s ease,border-color .15s ease}
.ark-btn:hover{background:rgba(122,60,255,.28);border-color:rgba(57,255,106,.5);
  box-shadow:0 0 12px rgba(57,255,106,.3)}
.ark-btn-lg{padding:.5rem 1.15rem;font-size:.95rem;border-color:rgba(57,255,106,.5);
  background:rgba(57,255,106,.12);color:#d8ffe2;
  box-shadow:0 0 16px rgba(57,255,106,.28),inset 0 0 10px rgba(57,255,106,.12)}
.ark-btn-lg:hover{background:rgba(57,255,106,.22);box-shadow:0 0 24px rgba(57,255,106,.45)}
.ark-palette{display:flex;gap:.2rem}
.ark-tool{width:2rem;height:2rem;display:flex;align-items:center;justify-content:center;
  background:rgba(232,224,255,.04);border:2px solid var(--tool-color,rgba(232,224,255,.2));
  border-radius:6px;color:var(--tool-color,#e8e0ff);cursor:pointer;font-size:.95rem;font-weight:700;line-height:1}
.ark-tool.on{background:color-mix(in srgb,var(--tool-color) 32%,transparent);
  box-shadow:0 0 10px var(--tool-color);color:#fff}
.ark-name{background:rgba(232,224,255,.05);border:1px solid rgba(182,92,255,.3);
  color:#fff;border-radius:6px;padding:.25rem .5rem;width:8rem;font-size:.82rem}
.ark-name:focus{outline:none;border-color:rgba(57,255,106,.6);box-shadow:0 0 8px rgba(57,255,106,.3)}
.ark-select{background:rgba(16,10,30,.96);border:1px solid rgba(182,92,255,.3);
  color:#fff;border-radius:6px;padding:.22rem .4rem;font-size:.8rem;max-width:11rem}
.ark-status{margin-left:auto;font-size:.8rem;color:#7bf09e;min-height:1em;
  text-shadow:0 0 8px rgba(57,255,106,.4)}
.ark-close{width:2rem;height:2rem;border-radius:50%;border:none;cursor:pointer;
  background:rgba(122,60,255,.22);color:#d8c2ff;font-size:1rem;transition:all .15s ease}
.ark-close:hover{background:rgba(255,80,120,.34);color:#fff;box-shadow:0 0 12px rgba(255,80,120,.5)}
.ark-stage{flex:1;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;padding:14px}
.ark-canvas{border-radius:12px;
  box-shadow:0 18px 64px rgba(0,0,0,.6),
    0 0 0 1px rgba(61,240,255,.45),
    0 0 22px rgba(61,240,255,.25),
    0 0 46px rgba(255,91,208,.3),
    inset 0 0 0 1px rgba(255,255,255,.12);
  background:#10204f;touch-action:none;cursor:none}
.ark-banner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:.7rem;background:rgba(7,4,14,.74);backdrop-filter:blur(3px)}
.ark-banner-title{font-size:2.5rem;font-weight:800;letter-spacing:.04em;color:#39ff6a;
  text-shadow:0 0 10px rgba(57,255,106,.9),0 0 30px rgba(57,255,106,.5),0 2px 2px #06040c;
  animation:ark-candle 3.4s ease-in-out infinite}
.ark-banner-sub{font-size:1.1rem;color:#ffb23a;text-shadow:0 0 12px rgba(255,178,58,.55)}
.ark-banner-actions{display:flex;gap:.6rem;margin-top:.4rem}
.ark-help{padding:.45rem .8rem;text-align:center;font-size:.78rem;color:#9c92c4;
  background:linear-gradient(0deg,rgba(10,8,20,.8),rgba(18,10,34,.5));
  border-top:1px solid rgba(122,60,255,.2)}
.ark-help b{color:#39ff6a;text-shadow:0 0 6px rgba(57,255,106,.5)}
.ark-flyout{position:absolute;left:0;top:0;bottom:0;z-index:7;pointer-events:none}
.ark-flyout-panel{position:absolute;left:0;top:0;bottom:0;width:238px;box-sizing:border-box;
  padding:14px 14px 20px;overflow-y:auto;pointer-events:auto;
  background:linear-gradient(180deg,rgba(18,10,34,.97),rgba(10,8,20,.96));
  border-right:1px solid rgba(122,60,255,.4);backdrop-filter:blur(6px);
  box-shadow:6px 0 30px rgba(0,0,0,.6),inset -1px 0 0 rgba(57,255,106,.12);
  transform:translateX(-100%);transition:transform .26s ease}
.ark-flyout.open .ark-flyout-panel{transform:translateX(0)}
.ark-flyout-tab{position:absolute;left:0;top:18px;display:flex;flex-direction:column;align-items:center;gap:7px;
  pointer-events:auto;cursor:pointer;color:#d8c2ff;
  background:linear-gradient(180deg,rgba(24,14,44,.94),rgba(14,8,26,.92));
  border:1px solid rgba(122,60,255,.4);border-left:none;
  border-radius:0 10px 10px 0;padding:11px 6px;transition:transform .26s ease,background .15s ease;
  box-shadow:3px 0 16px rgba(0,0,0,.5),0 0 12px rgba(122,60,255,.2)}
.ark-flyout.open .ark-flyout-tab{transform:translateX(238px)}
.ark-flyout-tab:hover{background:linear-gradient(180deg,rgba(40,22,72,.96),rgba(24,14,44,.94));color:#fff;
  box-shadow:3px 0 18px rgba(57,255,106,.3)}
.ark-tab-label{writing-mode:vertical-rl;text-orientation:upright;font-weight:800;font-size:.6rem;
  letter-spacing:.16em;color:#39ff6a;text-shadow:0 0 8px rgba(57,255,106,.5)}
.ark-tab-chev{font-size:.72rem;line-height:1;transition:transform .26s ease;color:#b65cff}
.ark-flyout.open .ark-tab-chev{transform:rotate(180deg)}
.ark-fly-head{font-weight:800;color:#39ff6a;font-size:.72rem;letter-spacing:.1em;margin:2px 0 6px;
  text-transform:uppercase;text-shadow:0 0 10px rgba(57,255,106,.5)}
.ark-fly-head:not(:first-child){margin-top:14px;padding-top:11px;border-top:1px solid rgba(122,60,255,.24)}
.ark-pill-row{display:flex;gap:9px;align-items:flex-start;margin:9px 0}
.ark-pill-badge{flex:0 0 auto;width:26px;height:26px;border-radius:7px;display:flex;align-items:center;
  justify-content:center;font-weight:800;font-size:.92rem;color:#06040c;line-height:1;
  box-shadow:0 0 8px rgba(0,0,0,.4)}
.ark-pill-text{display:flex;flex-direction:column;gap:1px;min-width:0}
.ark-pill-name{font-weight:700;font-size:.8rem;line-height:1.15;color:#e8e0ff}
.ark-pill-desc{font-size:.72rem;line-height:1.32;color:#a99fce}
.ark-info-row{margin:9px 0}
.ark-info-title{font-weight:700;font-size:.78rem;color:#d8ffe2;margin-bottom:1px}
.ark-hidden{display:none!important}
`
