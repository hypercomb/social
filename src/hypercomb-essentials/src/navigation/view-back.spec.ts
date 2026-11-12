// The hardware BACK button leaves a view. Pins the trap's state machine: ONE
// synthetic entry per open-view stack, consumed by the press and routed
// through BackGesture, re-armed while an owner remains, dropped — only while
// it is still on top — when the view closes by another path, and never
// touched while the close-up (which traps itself) is open.
//
// The world is real where it matters — the ModeRegistry that counts owners
// and the BackGesture that resolves the way out are the shipped classes — and
// fake only at the seams: a session history whose back() lands
// asynchronously as a popstate, the way the browser's does.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import type { HistoryLike, ViewBack as ViewBackType } from './view-back.js'
import type { BackGesture as BackGestureType } from './back-gesture.service.js'
import type { ModeRegistry as ModeRegistryType } from './mode-registry.service.js'

/** A session history that behaves like the browser's: pushState lands a new
 *  entry on top (dropping any forward entries), back() TRAVERSES LATER — the
 *  entry changes and the popstate fires on a following task, never inside
 *  the call. */
class FakeHistory implements HistoryLike {
  entries: unknown[]
  index: number
  backs = 0
  constructor(entries: unknown[] = [{}]) {
    this.entries = entries
    this.index = entries.length - 1
  }
  get state(): unknown { return this.entries[this.index] }
  get length(): number { return this.entries.length }
  pushState = (state: unknown): void => {
    this.entries.length = this.index + 1
    this.entries.push(state)
    this.index++
  }
  back = (): void => {
    this.backs++
    queueMicrotask(() => {
      if (this.index === 0) return
      this.index--
      window.dispatchEvent(new Event('popstate'))
    })
  }
  /** The participant pressed BACK. */
  press = async (): Promise<void> => {
    this.back()
    await flush()
  }
}

const flush = (): Promise<void> => vi.advanceTimersByTimeAsync(0).then(() => undefined)
const settle = (): Promise<void> => vi.advanceTimersByTimeAsync(REARM_MS + 10).then(() => undefined)

const registrations = new Map<string, unknown>()
const services = new Map<string, unknown>()
/** Module-level singletons are caught here and stood down: they listen on the
 *  same window and the same real history as the instances under test. */
const strays: Array<{ dispose?: () => void }> = []
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key) ?? registrations.get(key),
  register: (key: string, value: unknown) => {
    registrations.set(key, value)
    strays.push(value as { dispose?: () => void })
  },
  whenReady: () => void 0,
}

const { ModeRegistry } = await import('./mode-registry.service.js')
const { BackGesture } = await import('./back-gesture.service.js')
const { ViewBack, REARM_MS } = await import('./view-back.js')
while (strays.length) strays.pop()?.dispose?.()

let history: FakeHistory
let modes: ModeRegistryType
let gesture: BackGestureType
let viewBack: ViewBackType
let setMode: ReturnType<typeof vi.fn>
let navigationBack: ReturnType<typeof vi.fn>
/** The address each fake entry shows, by index — the URL bar: a replace edits
 *  the CURRENT entry's address, a pop reveals the one underneath's. */
let addresses: Map<number, string[]>
const ENTRANCE = ['deep', 'tile', 'lifted']
const address = (): string[] => addresses.get(history.index) ?? ENTRANCE
let replaceRaw: ReturnType<typeof vi.fn>
let closeUpOpen = false
let arrival = false

const stand = (entries?: unknown[]): void => {
  history = new FakeHistory(entries)
  viewBack = new ViewBack(history, window)
}

/** A view comes up: it enters `view:active` and (most do) registers its way
 *  out. Slides and the scroller register nothing. */
const open = (owner: string, back?: () => void): void => {
  if (back) gesture.register({ owner, back })
  modes.enter('view:active', owner)
}
const close = (owner: string): void => modes.exit('view:active', owner)
const owners = (): readonly string[] => modes.ownersOf('view:active')
const ours = (): boolean => typeof (history.state as { hcView?: unknown } | null)?.hcView === 'string'

beforeEach(() => {
  vi.useFakeTimers()
  EffectBus.clear()
  closeUpOpen = false
  arrival = false
  setMode = vi.fn()
  navigationBack = vi.fn(() => history.back())
  addresses = new Map()
  replaceRaw = vi.fn((segments: readonly string[]) => { addresses.set(history.index, [...segments]) })
  modes = new ModeRegistry()
  gesture = new BackGesture()
  services.set('@diamondcoreprocessor.com/ModeRegistry', modes)
  services.set('@diamondcoreprocessor.com/BackGesture', gesture)
  services.set('@diamondcoreprocessor.com/TileViewDrone', { get open_() { return closeUpOpen } })
  services.set('@diamondcoreprocessor.com/ViewBee', { isArrivalSurface: () => arrival })
  services.set('@hypercomb.social/ViewMode', { setMode })
  services.set('@hypercomb.social/Lineage', { explorerSegments: () => ['honey-garden'] })
  services.set('@hypercomb.social/Navigation', {
    back: navigationBack,
    segmentsRaw: address,
    replaceRaw,
  })
  stand()
})

afterEach(() => {
  viewBack.dispose()
  gesture.dispose()
  vi.useRealTimers()
})

describe('view-back — the trap', () => {
  it('pushes ONE entry when the first view comes up, and none for a nested one', () => {
    open('site-view', () => close('site-view'))
    expect(history.length).toBe(2)
    expect(history.state).toMatchObject({ hcView: 'site-view', hcTrap: expect.any(String) })
    expect(viewBack.armed).toBe(true)

    open('photo', () => close('photo'))
    expect(history.length).toBe(2)          // the mode never re-broadcast; one trap per stack
  })

  it('leaves the top view through its registered way out — the lineage stays put', async () => {
    const back = vi.fn(() => close('postit-view'))
    open('postit-view', back)

    await history.press()
    expect(back).toHaveBeenCalledOnce()
    expect(owners()).toEqual([])
    expect(navigationBack).not.toHaveBeenCalled()
    expect(setMode).not.toHaveBeenCalled()
    // The press consumed the entry; the close that followed had nothing to pop.
    expect(history.backs).toBe(1)
    expect(history.index).toBe(0)
    await settle()
    expect(viewBack.armed).toBe(false)
    expect(history.index).toBe(0)
  })

  it('peels a view that never registered (slides, the scroller) to hexagons', async () => {
    setMode.mockImplementation((mode: string) => { if (mode === 'hexagons') close('slides-view') })
    open('slides-view')

    await history.press()
    expect(setMode).toHaveBeenCalledWith('hexagons')
    expect(owners()).toEqual([])
    expect(navigationBack).not.toHaveBeenCalled()
    await settle()
    expect(viewBack.armed).toBe(false)
  })

  it('backs out of an ARRIVAL FACE by navigating — BackGesture\'s rule, honoured as is', async () => {
    viewBack.dispose()
    stand([{ page: 'root' }, { page: 'honey-garden' }])
    arrival = true
    open('slides-view')
    expect(history.index).toBe(2)

    await history.press()                  // consumes the trap → navigate
    expect(navigationBack).toHaveBeenCalledOnce()
    expect(setMode).not.toHaveBeenCalled()
    await flush()                          // the traversal lands: the page moved
    expect(history.index).toBe(0)
    close('slides-view')                   // …and the view followed the lineage down
    await settle()
    expect(viewBack.armed).toBe(false)
    expect(history.index).toBe(0)
    expect(history.backs).toBe(2)          // the press and the navigate; never a third
  })

  it('absorbs the press and re-arms when the view closed nothing', async () => {
    open('photo')                          // registers nothing, and setMode is inert here
    await history.press()
    expect(setMode).toHaveBeenCalledWith('hexagons')
    expect(owners()).toEqual(['photo'])
    expect(viewBack.armed).toBe(false)     // consumed…
    await settle()
    expect(viewBack.armed).toBe(true)      // …and back, so the next press cannot leave the page
    expect(ours()).toBe(true)
    expect(history.index).toBe(1)
  })

  it('nested owners: one trap per stack, re-armed while any owner remains', async () => {
    open('site-view', () => close('site-view'))
    open('photo', () => close('photo'))

    await history.press()
    expect(owners()).toEqual(['site-view'])
    expect(viewBack.armed).toBe(false)
    await settle()
    expect(viewBack.armed).toBe(true)
    expect(history.state).toMatchObject({ hcView: 'site-view', hcTrap: expect.any(String) })

    await history.press()
    expect(owners()).toEqual([])
    await settle()
    expect(viewBack.armed).toBe(false)
    expect(history.index).toBe(0)
  })

  it('drops the trap when the view closed by another path — the stack is as it was found', async () => {
    open('postit-view', () => close('postit-view'))
    close('postit-view')                   // × / Escape
    await flush()
    expect(history.backs).toBe(1)
    expect(history.index).toBe(0)
    expect(viewBack.armed).toBe(false)
    expect(setMode).not.toHaveBeenCalled()
    expect(navigationBack).not.toHaveBeenCalled()
  })

  it('carries an address replaced during the close across the dropped entry', async () => {
    // Coming back out where you went in (view-spawn.ts): the exit replaces
    // the address while OUR entry is still on top, then the view's teardown
    // closes `view:active`. The pop discards that entry — and the browser
    // shows the entrance again — unless the chosen place is carried over.
    open('lift-view', () => close('lift-view'))
    close('lift-view')                              // Escape → the view's teardown, first listener
    addresses.set(history.index, ['deep', 'tile']) // the way back replaced OUR entry's address, a later listener
    expect(history.backs).toBe(0)                   // the drop waits for them all
    await flush()
    expect(history.backs).toBe(1)
    expect(history.index).toBe(0)
    expect(replaceRaw).toHaveBeenLastCalledWith(['deep', 'tile'])
    expect(address()).toEqual(['deep', 'tile'])     // the entry underneath now says where the close chose
    expect(viewBack.armed).toBe(false)
  })

  it('leaves the address alone when the close did not move it', async () => {
    open('postit-view', () => close('postit-view'))
    close('postit-view')
    await flush()
    expect(replaceRaw).not.toHaveBeenCalled()
  })

  it('never pops a foreign entry pushed above the trap', async () => {
    open('postit-view', () => close('postit-view'))
    history.pushState({ navigationId: 7 }) // the shell navigated on top of us
    close('postit-view')
    expect(history.backs).toBe(0)
    expect(history.index).toBe(2)
    expect(viewBack.armed).toBe(false)
  })

  it('stands down while the close-up is open — it traps BACK itself', async () => {
    closeUpOpen = true
    open('slides-view')
    expect(history.length).toBe(1)
    expect(viewBack.armed).toBe(false)
    window.dispatchEvent(new Event('popstate'))
    expect(setMode).not.toHaveBeenCalled()
    expect(owners()).toEqual(['slides-view'])
    close('slides-view')
    expect(history.backs).toBe(0)

    closeUpOpen = false
    open('tile-view')
    expect(history.length).toBe(1)
  })

  it('a second press inside the settle window is not answered twice', async () => {
    viewBack.dispose()
    stand([{ page: 'root' }, { page: 'honey-garden' }])
    open('slides-view')                    // a slow view: setMode closes nothing yet
    await history.press()
    expect(setMode).toHaveBeenCalledTimes(1)
    await history.press()                  // the page entry itself — the lineage moves
    expect(setMode).toHaveBeenCalledTimes(1)
    expect(history.index).toBe(0)
    await settle()
    expect(viewBack.armed).toBe(true)      // the view is still up; whoever remains gets a trap
  })

  it('keeps a trap on top for a view that came up while its own pop was landing', async () => {
    open('postit-view', () => close('postit-view'))
    close('postit-view')                   // back() issued, not yet landed
    open('slides-view')                    // a new view in the gap
    await flush()
    expect(owners()).toEqual(['slides-view'])
    expect(viewBack.armed).toBe(true)
    expect(ours()).toBe(true)
  })

  // THE CHAT'S RAIL WALK (2026-11-12): a view pushes real places over the
  // trap (navigation.ts goRaw tags them `hcOver` + this trap's token). BACK
  // walks those steps with the view still up; only the press that leaves the
  // trap itself leaves the view.
  it('a pop onto a step the view pushed, or onto the trap, stays inside the view', async () => {
    const back = vi.fn(() => close('chat-window'))
    open('chat-window', back)
    const trap = (history.state as { hcTrap: string }).hcTrap
    history.pushState({ hcRaw: ['a'], hcOver: 'chat-window', hcOverDepth: 1, hcOverTrap: trap })
    history.pushState({ hcRaw: ['a', 'b'], hcOver: 'chat-window', hcOverDepth: 2, hcOverTrap: trap })

    await history.press()                  // /a/b → /a: a step back inside the view
    expect(back).not.toHaveBeenCalled()
    expect(viewBack.armed).toBe(true)
    expect(owners()).toEqual(['chat-window'])

    await history.press()                  // /a → the trap: still inside, still armed
    expect(back).not.toHaveBeenCalled()
    expect(viewBack.armed).toBe(true)
    expect(ours()).toBe(true)

    await history.press()                  // the trap is consumed: the press leaves
    expect(back).toHaveBeenCalledOnce()
    expect(owners()).toEqual([])
    await settle()
    expect(history.length).toBe(4)         // nothing was pushed over the walk
  })

  it('a step left by an EARLIER trap is not this one — the press still leaves', async () => {
    viewBack.dispose()
    stand([{ hcRaw: ['a'], hcOver: 'chat-window', hcOverDepth: 1, hcOverTrap: 'stale' }])
    const back = vi.fn(() => close('chat-window'))
    open('chat-window', back)
    await history.press()
    expect(back).toHaveBeenCalledOnce()
  })

  it('closing on top of a step leaves the walk alone — the view unwinds it itself', () => {
    open('chat-window', () => close('chat-window'))
    const trap = (history.state as { hcTrap: string }).hcTrap
    history.pushState({ hcRaw: ['a'], hcOver: 'chat-window', hcOverDepth: 1, hcOverTrap: trap })
    close('chat-window')
    expect(history.backs).toBe(0)
    expect(viewBack.armed).toBe(false)
  })

  it('stops listening once disposed', () => {
    viewBack.dispose()
    open('slides-view')
    expect(history.length).toBe(1)
  })
})
