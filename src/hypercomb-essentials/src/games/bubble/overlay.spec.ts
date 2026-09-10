import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BubbleOverlay } from './overlay.js'

type ArcadeInput = { left: boolean; right: boolean; jump: boolean; blow: boolean }
type Effects = Record<'jump' | 'blow' | 'trap' | 'pop' | 'fruit' | 'hurt' | 'clear', number>
type FakeEngine = {
  score: number; time: number; state: string; levelIndex: number; lives: number; fx: Effects
  update: ReturnType<typeof vi.fn<(dt: number, input: ArcadeInput) => void>>
  restart: ReturnType<typeof vi.fn<() => void>>
}
type FakeRenderer = { draw: ReturnType<typeof vi.fn> }
type FakeAudio = {
  muted: boolean
  unlock: ReturnType<typeof vi.fn>
  toggleMuted: ReturnType<typeof vi.fn>
  tone: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

const doubles = vi.hoisted(() => ({
  engines: [] as FakeEngine[], renderers: [] as FakeRenderer[], audio: [] as FakeAudio[],
  effects: (): Effects => ({ jump: 0, blow: 0, trap: 0, pop: 0, fruit: 0, hurt: 0, clear: 0 }),
}))

vi.mock('./engine.js', () => ({
  WIDTH: 256, HEIGHT: 224,
  Engine: class implements FakeEngine {
    score = 0
    time = 0
    state = 'playing'
    levelIndex = 0
    lives = 3
    fx = doubles.effects()
    update = vi.fn((dt: number, _input: ArcadeInput) => { this.time += dt })
    restart = vi.fn(() => {
      this.score = 0
      this.time = 0
      this.state = 'playing'
      this.levelIndex = 0
      this.lives = 3
      this.fx = doubles.effects()
    })
    constructor() { doubles.engines.push(this) }
  },
}))

vi.mock('./renderer.js', () => ({
  Renderer: class implements FakeRenderer {
    draw = vi.fn()
    constructor() { doubles.renderers.push(this) }
  },
}))

vi.mock('../audio.js', () => ({
  GameAudio: class implements FakeAudio {
    muted = false
    unlock = vi.fn()
    toggleMuted = vi.fn(() => { this.muted = !this.muted; return this.muted })
    tone = vi.fn()
    dispose = vi.fn()
    constructor() { doubles.audio.push(this) }
  },
}))

const SCORE_KEY = 'hc:bubble-arcade-hiscore'
const noInput: ArcadeInput = { left: false, right: false, jump: false, blow: false }
let overlays: BubbleOverlay[]
let canvasContext: CanvasRenderingContext2D | null
let stageSize: { width: number; height: number }
let now: number
let nextFrameId: number
let frames: Map<number, FrameRequestCallback>
let observers: Array<{ observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; fire: () => void }>

beforeEach(() => {
  doubles.engines.length = doubles.renderers.length = doubles.audio.length = 0
  overlays = []
  observers = []
  frames = new Map()
  now = 100
  nextFrameId = 0
  canvasContext = {} as CanvasRenderingContext2D
  stageSize = { width: 960, height: 896 }
  localStorage.removeItem(SCORE_KEY)
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++nextFrameId, callback)
    return nextFrameId
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id) }))
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn()
    disconnect = vi.fn()
    fire: () => void
    constructor(callback: () => void) {
      this.fire = callback
      observers.push(this)
    }
  })
  // Keep the actual iframe/document boundary. Only the unavailable canvas
  // implementation, layout metrics and pointer capture are test stand-ins.
  const append = document.body.appendChild.bind(document.body)
  vi.spyOn(document.body, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    const result = append(node)
    const frame = node instanceof Element ? node.querySelector('iframe') : null
    const inner = frame?.contentWindow as (Window & typeof globalThis) | null
    if (inner) {
      // Vitest preserves Node's AbortController globally; DOM listeners need
      // the browser implementation that a real page supplies instead.
      vi.stubGlobal('AbortController', inner.AbortController)
      Object.defineProperty(inner.HTMLCanvasElement.prototype, 'getContext', {
        configurable: true, value: vi.fn(() => canvasContext),
      })
      Object.defineProperty(inner.HTMLElement.prototype, 'clientWidth', {
        configurable: true, get: () => stageSize.width,
      })
      Object.defineProperty(inner.HTMLElement.prototype, 'clientHeight', {
        configurable: true, get: () => stageSize.height,
      })
      Object.defineProperty(inner.Element.prototype, 'setPointerCapture', {
        configurable: true, value: vi.fn(),
      })
    }
    return result
  })
})

afterEach(() => {
  try {
    for (const overlay of overlays) if (overlay.isMounted()) overlay.unmount()
  } finally {
    document.body.replaceChildren()
    localStorage.removeItem(SCORE_KEY)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

function mount() {
  let overlay: BubbleOverlay
  const onClose = vi.fn(() => overlay.unmount())
  overlay = new BubbleOverlay(onClose)
  overlays.push(overlay)
  overlay.mount()
  const frame = document.querySelector<HTMLIFrameElement>('.bub-overlay iframe')!
  const doc = frame.contentDocument!
  const inner = frame.contentWindow as Window & typeof globalThis
  const canvas = doc.querySelector('canvas')!
  return { overlay, onClose, frame, doc, inner, canvas, engine: doubles.engines.at(-1)! }
}

function frame(delta = 20): void {
  now += delta
  const callbacks = [...frames.values()]
  frames.clear()
  for (const callback of callbacks) callback(now)
}

function key(game: ReturnType<typeof mount>, code: string, type = 'keydown', keyValue?: string): KeyboardEvent {
  const event = new game.inner.KeyboardEvent(type, {
    code, key: keyValue ?? (code.startsWith('Key') ? code.slice(3).toLowerCase() : code),
    bubbles: true, cancelable: true,
  })
  game.canvas.dispatchEvent(event)
  return event
}

function click(doc: Document, selector: string): void {
  doc.querySelector<HTMLButtonElement>(selector)!.click()
}

function start(game: ReturnType<typeof mount>): void {
  click(game.doc, '.bub-start')
  frame()
  frame()
}

function touch(game: ReturnType<typeof mount>, selector: string, type: string, pointerId: number): void {
  const event = new game.inner.Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  game.doc.querySelector(selector)!.dispatchEvent(event)
}

describe('BubbleOverlay responsive playfield', () => {
  it('fills a desktop stage at fractional scale with a 4:3 cabinet display and the original logical resolution', () => {
    stageSize = { width: 650, height: 700 }
    const { canvas } = mount()
    expect(Number.parseFloat(canvas.style.width)).toBeCloseTo(650, 6)
    expect(Number.parseFloat(canvas.style.height)).toBeCloseTo(487.5, 6)
    expect(canvas.width).toBe(256)
    expect(canvas.height).toBe(224)
  })

  it('shrinks the display to fit a narrow stage without cropping the logical game surface', () => {
    stageSize = { width: 210, height: 380 }
    const { canvas } = mount()
    expect(Number.parseFloat(canvas.style.width)).toBeCloseTo(210, 6)
    expect(Number.parseFloat(canvas.style.height)).toBeCloseTo(157.5, 6)
    expect(canvas.width).toBe(256)
    expect(canvas.height).toBe(224)
  })

  it('uses all available stage height in a wide window without overflowing its width', () => {
    stageSize = { width: 1360, height: 610 }
    const { canvas } = mount()
    expect(Number.parseFloat(canvas.style.height)).toBeCloseTo(610, 6)
    expect(Number.parseFloat(canvas.style.width)).toBeCloseTo(813.3333333333333, 6)
  })

  it('refits the same canvas when resizing from a wide stage to portrait and then a short landscape stage', () => {
    stageSize = { width: 1440, height: 900 }
    const { canvas, doc } = mount()
    expect(Number.parseFloat(canvas.style.width)).toBeCloseTo(1200, 6)
    expect(Number.parseFloat(canvas.style.height)).toBeCloseTo(900, 6)
    stageSize = { width: 360, height: 600 }
    observers[0].fire()
    expect(Number.parseFloat(canvas.style.width)).toBeCloseTo(360, 6)
    expect(Number.parseFloat(canvas.style.height)).toBeCloseTo(270, 6)
    stageSize = { width: 900, height: 300 }
    observers[0].fire()
    expect(Number.parseFloat(canvas.style.height)).toBeCloseTo(300, 6)
    expect(Number.parseFloat(canvas.style.width)).toBeCloseTo(400, 6)
    expect(doc.querySelector('canvas')).toBe(canvas)
    expect(canvas.width).toBe(256)
    expect(canvas.height).toBe(224)
  })
})

describe('BubbleOverlay keyboard isolation', () => {
  it('mounts the local arcade synchronously and keeps game input out of earlier shell capture listeners', () => {
    const shellKey = vi.fn()
    window.addEventListener('keydown', shellKey, true)
    document.addEventListener('keydown', shellKey, true)
    try {
      const game = mount()
      expect(game.overlay.isMounted()).toBe(true)
      expect(game.inner.location.href).toBe('about:blank')
      expect(game.doc.querySelector('.bub-start')?.textContent).toBe('Start game')
      expect(game.doc.activeElement).toBe(game.doc.querySelector('.bub-start'))
      frame()
      expect(game.engine.update).not.toHaveBeenCalled()
      expect(doubles.renderers[0].draw).toHaveBeenCalled()

      game.canvas.focus()
      key(game, 'Enter')
      expect(game.doc.querySelector<HTMLElement>('.bub-cover')!.hidden).toBe(true)
      expect(game.doc.activeElement).toBe(game.canvas)
      key(game, 'ArrowRight')
      key(game, 'KeyK')
      key(game, 'KeyJ')
      frame()
      frame()
      expect(game.engine.update).toHaveBeenLastCalledWith(expect.any(Number), {
        left: false, right: true, jump: true, blow: true,
      })
      key(game, 'ArrowRight', 'keyup')
      key(game, 'KeyK', 'keyup')
      key(game, 'KeyJ', 'keyup')
      frame()
      expect(game.engine.update).toHaveBeenLastCalledWith(expect.any(Number), noInput)
      expect(shellKey).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', shellKey, true)
      document.removeEventListener('keydown', shellKey, true)
    }
  })

  it('closes on Escape inside the frame without invoking the outer Escape handler', () => {
    const shellEscape = vi.fn()
    window.addEventListener('keydown', shellEscape, true)
    try {
      const game = mount()
      key(game, 'Escape')
      expect(game.onClose).toHaveBeenCalledOnce()
      expect(game.overlay.isMounted()).toBe(false)
      expect(shellEscape).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', shellEscape, true)
    }
  })
})

describe('BubbleOverlay pause and restart', () => {
  it('freezes simulation on pause and resumes with both keyboard and touch input released', () => {
    const game = mount()
    start(game)
    key(game, 'ArrowLeft')
    touch(game, '[data-control="blow"]', 'pointerdown', 4)
    frame()
    expect(game.engine.update).toHaveBeenLastCalledWith(expect.any(Number), {
      ...noInput, left: true, blow: true,
    })
    expect(game.doc.querySelector('[data-held]')).not.toBeNull()
    click(game.doc, '.bub-pause')
    expect(game.doc.querySelector('.bub-cover-title')?.textContent).toBe('Paused')
    expect(game.doc.querySelector('[data-held]')).toBeNull()
    const callsBeforePause = game.engine.update.mock.calls.length
    frame(1000)
    frame(1000)
    expect(game.engine.update).toHaveBeenCalledTimes(callsBeforePause)
    click(game.doc, '.bub-start')
    frame()
    frame()
    expect(game.engine.update.mock.calls.length).toBeGreaterThan(callsBeforePause)
    expect(game.engine.update).toHaveBeenLastCalledWith(expect.any(Number), noInput)
  })

  it('pauses on iframe blur and does not replay held keys or elapsed background time when resumed', () => {
    const game = mount()
    start(game)
    key(game, 'KeyD')
    key(game, 'KeyK')
    frame()
    game.inner.dispatchEvent(new game.inner.Event('blur'))
    const callsBeforeBlur = game.engine.update.mock.calls.length
    frame(20000)
    expect(game.engine.update).toHaveBeenCalledTimes(callsBeforeBlur)
    expect(game.doc.querySelector('.bub-start')?.textContent).toBe('Resume')
    key(game, 'KeyP')
    frame(20000)
    expect(game.engine.update).toHaveBeenCalledTimes(callsBeforeBlur)
    frame()
    expect(game.engine.update.mock.calls.length - callsBeforeBlur).toBeLessThan(4)
    expect(game.engine.update).toHaveBeenLastCalledWith(expect.any(Number), noInput)
  })

  it('pauses when the outer document is hidden and requires an explicit resume', () => {
    const game = mount()
    start(game)
    key(game, 'KeyJ')
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    const callsBeforeHidden = game.engine.update.mock.calls.length
    frame(5000)
    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    frame()
    expect(game.engine.update).toHaveBeenCalledTimes(callsBeforeHidden)
    click(game.doc, '.bub-start')
    frame()
    frame()
    expect(game.engine.update).toHaveBeenLastCalledWith(expect.any(Number), noInput)
  })

  it('restarts a paused run, saves its score and clears held controls before simulation resumes', () => {
    const game = mount()
    start(game)
    game.engine.score = 750
    key(game, 'ArrowLeft')
    click(game.doc, '.bub-pause')
    click(game.doc, '.bub-restart')
    expect(game.engine.restart).toHaveBeenCalledOnce()
    expect(localStorage.getItem(SCORE_KEY)).toBe('750')
    expect(game.doc.querySelector<HTMLElement>('.bub-cover')!.hidden).toBe(true)
    expect(game.doc.activeElement).toBe(game.canvas)
    frame()
    frame()
    expect(game.engine.update).toHaveBeenLastCalledWith(expect.any(Number), noInput)
    expect(doubles.renderers[0].draw).toHaveBeenLastCalledWith(game.engine, game.engine.time, 750)
  })
})

describe('BubbleOverlay score and lifecycle', () => {
  it('retains a stored best score, persists an improved completed run and offers another game', () => {
    localStorage.setItem(SCORE_KEY, '1000')
    const game = mount()
    frame()
    expect(doubles.renderers[0].draw).toHaveBeenLastCalledWith(game.engine, game.engine.time, 1000)
    start(game)
    game.engine.score = 1250
    game.engine.state = 'gameover'
    frame()
    expect(localStorage.getItem(SCORE_KEY)).toBe('1250')
    expect(game.doc.querySelector('.bub-cover-title')?.textContent).toBe('Game over')
    expect(game.doc.activeElement).toBe(game.doc.querySelector('.bub-start'))
    expect(game.doc.querySelector('.bub-start')?.textContent).toBe('Play again')
    click(game.doc, '.bub-start')
    expect(game.engine.restart).toHaveBeenCalledOnce()
    expect(game.doc.querySelector<HTMLElement>('.bub-cover')!.hidden).toBe(true)
    game.overlay.unmount()
    expect(localStorage.getItem(SCORE_KEY)).toBe('1250')
  })

  it('removes the frame, cancels animation, disconnects observers, disposes audio and restores shell focus on close', () => {
    const launcher = document.createElement('button')
    document.body.appendChild(launcher)
    launcher.focus()
    const game = mount()
    start(game)
    game.engine.score = 400
    const pending = [...frames.keys()][0]
    const observer = observers[0]
    expect(observer.observe).toHaveBeenCalledWith(game.doc.querySelector('.bub-stage'))
    click(game.doc, '.bub-close')
    expect(game.onClose).toHaveBeenCalledOnce()
    expect(game.overlay.isMounted()).toBe(false)
    expect(game.frame.isConnected).toBe(false)
    expect(document.querySelector('.bub-overlay')).toBeNull()
    expect(cancelAnimationFrame).toHaveBeenCalledWith(pending)
    expect(frames.size).toBe(0)
    expect(observer.disconnect).toHaveBeenCalledOnce()
    expect(doubles.audio[0].dispose).toHaveBeenCalledOnce()
    expect(localStorage.getItem(SCORE_KEY)).toBe('400')
    expect(document.activeElement).toBe(launcher)
    // Retained references must no longer own input or schedule work.
    key(game, 'Escape')
    game.inner.dispatchEvent(new game.inner.Event('blur'))
    document.dispatchEvent(new Event('visibilitychange'))
    observer.fire()
    expect(game.onClose).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
  })

  it('still closes cleanly when canvas rendering is unavailable', () => {
    canvasContext = null
    const game = mount()
    expect(game.doc.querySelector('.bub-cover-copy')?.textContent).toMatch(/canvas is unavailable/i)
    expect(game.doc.querySelector<HTMLButtonElement>('.bub-start')!.hidden).toBe(true)
    expect(doubles.renderers).toHaveLength(0)
    expect(frames.size).toBe(0)
    click(game.doc, '.bub-close')
    expect(game.onClose).toHaveBeenCalledOnce()
    expect(game.frame.isConnected).toBe(false)
    expect(doubles.audio[0].dispose).toHaveBeenCalledOnce()
  })
})
