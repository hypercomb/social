// Hypercomb shell for the source-based Bubble Bobble adaptation.
// Gameplay provenance and GPL notices: ./UPSTREAM.md and ./COPYING.
import { Engine, WIDTH, HEIGHT, type Input } from './engine.js'
import { Renderer } from './renderer.js'
import { GameAudio } from '../audio.js'

const HISCORE_KEY = 'hc:bubble-arcade-hiscore'
const STEP = 1 / 120
// The 256 × 224 raster was displayed on a horizontal 4:3 arcade monitor.
const DISPLAY_ASPECT = 4 / 3
const SOURCE = 'https://github.com/JulianRijken/BubbleBobble/tree/6a59ee99e621f4061cab50802155b9c28c51c4f9'
type Control = 'left' | 'right' | 'jump' | 'blow'

/** A local iframe gives the arcade its own keyboard document. Game keys never
 * reach the hive's earlier capture listeners; no remote page or runtime loads. */
export class BubbleOverlay {
  #root: HTMLDivElement | null = null
  #frame: HTMLIFrameElement | null = null
  #canvas: HTMLCanvasElement | null = null
  #renderer: Renderer | null = null
  #engine = new Engine()
  #audio = new GameAudio()
  #abort: AbortController | null = null
  #resize: ResizeObserver | null = null
  #restoreFocus: HTMLElement | null = null
  #raf = 0
  #last = 0
  #accumulator = 0
  #keys = new Set<string>()
  #touch = new Map<number, Control>()
  #started = false
  #paused = true
  #hiscore = 0
  #savedHiscore = 0
  #cover: HTMLElement | null = null
  #coverTitle: HTMLElement | null = null
  #coverCopy: HTMLElement | null = null
  #coverButton: HTMLButtonElement | null = null
  #pauseButton: HTMLButtonElement | null = null
  #soundButton: HTMLButtonElement | null = null
  #status: HTMLElement | null = null
  #lastState = ''
  #fx = { jump: 0, blow: 0, trap: 0, pop: 0, fruit: 0, hurt: 0, clear: 0 }

  constructor(private readonly onClose: () => void) {}
  isMounted(): boolean { return this.#root !== null }

  mount(): void {
    if (this.#root) return
    this.#restoreFocus = document.activeElement as HTMLElement | null
    try { this.#hiscore = Math.max(0, Number(localStorage.getItem(HISCORE_KEY)) || 0) } catch { /* local preference unavailable */ }
    this.#savedHiscore = this.#hiscore
    const root = document.createElement('div')
    root.className = 'bub-overlay'
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-modal', 'true')
    root.setAttribute('aria-label', 'Bubble Bobble')
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#000'
    const frame = document.createElement('iframe')
    frame.title = 'Bubble Bobble arcade'
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0'
    root.appendChild(frame)
    document.body.appendChild(root)
    this.#root = root
    this.#frame = frame
    const doc = frame.contentDocument!
    doc.open()
    doc.write(PAGE)
    doc.close()
    this.#abort = new AbortController()
    const signal = this.#abort.signal
    this.#canvas = doc.querySelector('canvas')!
    this.#canvas.width = WIDTH
    this.#canvas.height = HEIGHT
    const ctx = this.#canvas.getContext('2d')
    if (!ctx) {
      doc.querySelector('.bub-cover-copy')!.textContent = 'Canvas is unavailable in this browser.'
      doc.querySelector<HTMLButtonElement>('.bub-start')!.hidden = true
      doc.querySelector<HTMLButtonElement>('.bub-close')!.onclick = this.onClose
      return
    }
    this.#renderer = new Renderer(ctx)
    this.#cover = doc.querySelector('.bub-cover')
    this.#coverTitle = doc.querySelector('.bub-cover-title')
    this.#coverCopy = doc.querySelector('.bub-cover-copy')
    this.#coverButton = doc.querySelector('.bub-start')
    this.#pauseButton = doc.querySelector('.bub-pause')
    this.#soundButton = doc.querySelector('.bub-sound')
    this.#status = doc.querySelector('.bub-status')
    doc.querySelector<HTMLAnchorElement>('.bub-source')!.href = SOURCE
    doc.querySelector<HTMLButtonElement>('.bub-close')!.onclick = this.onClose
    doc.querySelector<HTMLButtonElement>('.bub-restart')!.onclick = () => this.#restart()
    this.#coverButton!.onclick = () => {
      if (this.#ended()) this.#restart()
      else this.#resume()
    }
    this.#pauseButton!.onclick = () => this.#paused ? this.#resume() : this.#pause()
    this.#soundButton!.onclick = () => {
      this.#audio.unlock()
      this.#audio.toggleMuted()
      this.#syncSound()
      this.#focusGame()
    }
    this.#syncSound()
    const frameWindow = frame.contentWindow!
    // Listeners inside this browsing context isolate J/K/arrows/Escape from
    // shell shortcuts regardless of which one registered its handler first.
    frameWindow.addEventListener('keydown', event => this.#keyDown(event), { signal })
    frameWindow.addEventListener('keyup', event => {
      this.#keys.delete(event.code)
      if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation()
    }, { signal })
    frameWindow.addEventListener('blur', () => this.#pause(), { signal })
    doc.addEventListener('contextmenu', event => event.preventDefault(), { signal })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') this.#pause()
    }, { signal })
    doc.querySelectorAll<HTMLButtonElement>('[data-control]').forEach(button => {
      button.addEventListener('pointerdown', event => {
        event.preventDefault()
        if (!this.#started || this.#paused || this.#ended()) return
        this.#audio.unlock()
        this.#touch.set(event.pointerId, button.dataset['control'] as Control)
        button.setPointerCapture(event.pointerId)
        button.setAttribute('data-held', '')
      }, { signal })
      const release = (event: PointerEvent): void => {
        this.#touch.delete(event.pointerId)
        button.removeAttribute('data-held')
      }
      button.addEventListener('pointerup', release, { signal })
      button.addEventListener('pointercancel', release, { signal })
      button.addEventListener('lostpointercapture', release, { signal })
    })
    this.#resize = new ResizeObserver(() => this.#fit())
    this.#resize.observe(doc.querySelector('.bub-stage')!)
    this.#fit()
    this.#syncCover()
    this.#coverButton?.focus()
    this.#last = 0
    this.#raf = requestAnimationFrame(this.#loop)
  }

  unmount(): void {
    cancelAnimationFrame(this.#raf)
    this.#raf = 0
    this.#saveScore()
    this.#abort?.abort()
    this.#abort = null
    this.#resize?.disconnect()
    this.#resize = null
    this.#audio.dispose()
    this.#root?.remove()
    this.#root = null
    this.#frame = null
    this.#canvas = null
    this.#renderer = null
    this.#keys.clear()
    this.#touch.clear()
    this.#restoreFocus?.focus?.({ preventScroll: true })
  }

  #ended(): boolean { return this.#engine.state === 'gameover' || this.#engine.state === 'won' }
  #focusGame(): void { this.#canvas?.focus({ preventScroll: true }) }
  #clearInput(): void {
    this.#keys.clear()
    this.#touch.clear()
    this.#frame?.contentDocument?.querySelectorAll('[data-held]').forEach(button => button.removeAttribute('data-held'))
    this.#accumulator = 0
    this.#last = 0
  }
  #resume(): void {
    this.#started = true
    this.#paused = false
    this.#clearInput()
    this.#audio.unlock()
    this.#syncCover()
    this.#focusGame()
  }
  #pause(): void {
    if (!this.#started || this.#paused || this.#ended()) return
    this.#paused = true
    this.#clearInput()
    this.#syncCover()
  }
  #restart(): void {
    this.#saveScore()
    this.#engine.restart()
    this.#fx = { ...this.#engine.fx }
    this.#lastState = ''
    this.#resume()
  }

  #keyDown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'Escape') { event.preventDefault(); this.onClose(); return }
    // Keep Tab usable, contained in the local arcade document.
    if (event.key === 'Tab') {
      const doc = this.#frame?.contentDocument
      const targets = [...(doc?.querySelectorAll<HTMLElement>('button,a[href],canvas') ?? [])]
        .filter(node => !node.closest('[hidden]') && !node.hasAttribute('disabled') && node.getClientRects().length > 0)
      if (targets.length) {
        event.preventDefault()
        const at = targets.indexOf(doc!.activeElement as HTMLElement)
        targets[(at + (event.shiftKey ? -1 : 1) + targets.length) % targets.length].focus()
      }
      return
    }
    // Native Space/Enter activate focused toolbar/start buttons.
    const target = event.target as HTMLElement | null
    if ((event.code === 'Space' || event.code === 'Enter') && target?.tagName === 'BUTTON') return
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyA', 'KeyD', 'KeyJ', 'KeyK', 'KeyZ', 'KeyX', 'Space', 'Enter', 'KeyP', 'KeyR'].includes(event.code)) {
      event.preventDefault()
      if (!event.repeat && event.code === 'KeyP') { this.#paused ? this.#resume() : this.#pause(); return }
      if (!event.repeat && event.code === 'KeyR') { this.#restart(); return }
      if (!event.repeat && (event.code === 'Enter' || event.code === 'Space') && (this.#paused || this.#ended())) {
        this.#ended() ? this.#restart() : this.#resume()
        return
      }
      if (!this.#paused && !this.#ended()) this.#keys.add(event.code)
    }
  }

  #input(): Input {
    const held = (control: Control, ...codes: string[]): boolean =>
      codes.some(code => this.#keys.has(code)) || [...this.#touch.values()].includes(control)
    return {
      left: held('left', 'ArrowLeft', 'KeyA'), right: held('right', 'ArrowRight', 'KeyD'),
      jump: held('jump', 'ArrowUp', 'KeyK', 'KeyX', 'Space'), blow: held('blow', 'KeyJ', 'KeyZ'),
    }
  }
  readonly #loop = (now: number): void => {
    if (!this.#root) return
    const dt = this.#last ? Math.min((now - this.#last) / 1000, 0.1) : 0
    this.#last = now
    if (!this.#paused && !this.#ended()) {
      this.#accumulator += dt
      while (this.#accumulator >= STEP) {
        this.#engine.update(STEP, this.#input())
        this.#accumulator -= STEP
      }
      this.#sounds()
    }
    this.#hiscore = Math.max(this.#hiscore, this.#engine.score)
    this.#renderer?.draw(this.#engine, this.#engine.time, this.#hiscore)
    const status = `ROUND ${String(this.#engine.levelIndex + 1).padStart(2, '0')} · ${this.#engine.lives} LIVES`
    if (this.#status && this.#status.textContent !== status) this.#status.textContent = status
    if (this.#lastState !== this.#engine.state) {
      this.#lastState = this.#engine.state
      this.#syncCover()
      if (this.#ended()) { this.#saveScore(); this.#coverButton?.focus() }
    }
    this.#raf = requestAnimationFrame(this.#loop)
  }
  #sounds(): void {
    const next = this.#engine.fx
    const tone = (freq: number, endFreq: number, dur: number): void => this.#audio.tone({ freq, endFreq, dur, type: 'square', vol: .06 })
    if (next.jump > this.#fx.jump) tone(210, 650, .12)
    if (next.blow > this.#fx.blow) tone(480, 920, .06)
    if (next.trap > this.#fx.trap) tone(340, 740, .15)
    if (next.pop > this.#fx.pop) tone(1000, 150, .1)
    if (next.fruit > this.#fx.fruit) tone(700, 1200, .12)
    if (next.hurt > this.#fx.hurt) tone(300, 60, .4)
    if (next.clear > this.#fx.clear) tone(500, 1400, .35)
    this.#fx = { ...next }
  }
  #saveScore(): void {
    this.#hiscore = Math.max(this.#hiscore, this.#engine.score)
    if (this.#hiscore <= this.#savedHiscore) return
    try { localStorage.setItem(HISCORE_KEY, String(this.#hiscore)); this.#savedHiscore = this.#hiscore } catch { /* quota */ }
  }
  #syncSound(): void {
    if (!this.#soundButton) return
    this.#soundButton.textContent = this.#audio.muted ? 'Sound off' : 'Sound on'
    this.#soundButton.setAttribute('aria-pressed', String(!this.#audio.muted))
  }
  #syncCover(): void {
    if (!this.#cover || !this.#coverTitle || !this.#coverCopy || !this.#coverButton) return
    const end = this.#ended()
    this.#cover.hidden = !this.#paused && !end
    this.#coverTitle.textContent = end ? (this.#engine.state === 'won' ? 'All three rounds cleared!' : 'Game over') : this.#started ? 'Paused' : 'Bubble Bobble'
    this.#coverCopy.textContent = end ? `Score ${this.#engine.score.toLocaleString()} · Best ${this.#hiscore.toLocaleString()}` : this.#started ? 'Ready when you are.' : 'Trap a foe in a bubble. Jump into it to pop it. Collect the fruit.'
    this.#coverButton.textContent = end ? 'Play again' : this.#started ? 'Resume' : 'Start game'
    if (this.#pauseButton) { this.#pauseButton.textContent = this.#paused ? 'Resume' : 'Pause'; this.#pauseButton.disabled = !this.#started || end }
  }
  #fit(): void {
    const stage = this.#frame?.contentDocument?.querySelector<HTMLElement>('.bub-stage')
    if (!stage || !this.#canvas) return
    // Fill the limiting dimension, including fractional scales. Rounding down
    // to an integer discarded up to a whole native frame of available space.
    const height = Math.max(0, Math.min(stage.clientHeight, stage.clientWidth / DISPLAY_ASPECT))
    this.#canvas.style.width = `${height * DISPLAY_ASPECT}px`
    this.#canvas.style.height = `${height}px`
  }
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bubble Bobble</title><style>
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;background:#000;color:#eaf7ff;font:14px/1.4 system-ui,sans-serif}body{display:flex;flex-direction:column}button,a{touch-action:manipulation}button{border:1px solid #40516e;background:#18233a;color:#eaf7ff;border-radius:6px;padding:5px 10px;cursor:pointer;font:inherit;min-height:32px}button:hover{background:#293951}button:disabled{opacity:.4;cursor:default}button:focus-visible,a:focus-visible{outline:2px solid #7febac;outline-offset:3px}[hidden]{display:none!important}.bub-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 12px;border-bottom:1px solid #24354f;flex:none;background:#10172a}.bub-logo{font-weight:800;color:#7febac;letter-spacing:.06em;margin-right:auto}.bub-status{font:11px/1.3 monospace;color:#b9c9e4}.bub-stage{position:relative;display:flex;align-items:center;justify-content:center;min-height:0;flex:1;padding:0;overflow:hidden}canvas{display:block;background:#000;image-rendering:pixelated;image-rendering:crisp-edges;outline:none;touch-action:none}.bub-cover{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:16px;background:rgba(0,0,0,.6)}.bub-cover-title{margin:0 0 12px;font-size:clamp(22px,4vw,38px);color:#7febac}.bub-cover-copy{max-width:400px;margin:0 0 22px;color:#c8d5ec}.bub-start{background:#7febac;color:#081a18;border:0;font-weight:800;padding:12px 28px;min-width:150px}.bub-start:hover{background:#aff7cd}.bub-footer{display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;flex:none;padding:4px 12px;color:#aebdd6;font-size:11px;text-align:center;border-top:1px solid #24354f}.bub-source{color:#91c5ff}.bub-touch{display:flex;justify-content:space-between;gap:12px;padding:10px 16px;flex:none}.bub-touch-group{display:flex;gap:10px}.bub-touch button{touch-action:none;user-select:none;-webkit-user-select:none;min-width:54px;min-height:48px;font-weight:700}.bub-touch button[data-held]{background:#7febac;color:#09151c}
@media(hover:hover) and (pointer:fine){.bub-touch{display:none}}@media(max-width:620px){.bub-bar{padding:7px;gap:5px}.bub-logo{font-size:13px}.bub-status{display:none}.bub-bar button{font-size:12px;padding:7px}.bub-footer{font-size:10px;padding:6px;gap:7px}.bub-touch{display:flex;padding:7px}.bub-touch button{min-width:48px}}
</style></head><body><header class="bub-bar"><strong class="bub-logo">BUBBLE BOBBLE</strong><span class="bub-status" role="status" aria-live="polite">ROUND 01</span><button class="bub-pause" disabled>Pause</button><button class="bub-restart">Restart</button><button class="bub-sound">Sound on</button><button class="bub-close" aria-label="Close Bubble Bobble">Close ×</button></header><main class="bub-stage"><canvas tabindex="0" aria-label="Bubble Bobble game. Move with arrows or A and D; K or up to jump; J to blow bubbles."></canvas><section class="bub-cover"><h1 class="bub-cover-title">Bubble Bobble</h1><p class="bub-cover-copy">Loading arcade…</p><button class="bub-start">Start game</button></section></main><nav class="bub-touch" aria-label="Touch game controls"><div class="bub-touch-group"><button data-control="left" aria-label="Move left">◀</button><button data-control="right" aria-label="Move right">▶</button></div><div class="bub-touch-group"><button data-control="jump">Jump</button><button data-control="blow">Bubble</button></div></nav><footer class="bub-footer"><span>← → / A D move · K / ↑ jump · J bubbles · P pause · R restart · Esc close</span><a class="bub-source" href="${SOURCE}" target="_blank" rel="noopener noreferrer">Adapted from Julian Rijken · GPL-3.0+</a></footer></body></html>`
