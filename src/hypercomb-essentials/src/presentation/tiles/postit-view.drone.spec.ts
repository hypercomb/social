// postit-view.drone.spec.ts — an opened post is rebuilt only when what it
// shows changed, and a rebuild never lets go of the surface.
//
// arkanoid.pluginthematrix.com, 2026-10-24: a published postit face. Every
// reconcile tore the post down and mounted it again, flapping `view:active`
// 1 → 0 → 1. view-back.ts reads a 1 → 0 as the view closing and drops its
// history entry with history.back(); the pop came back as a `navigate`
// (Navigation turns every popstate into one), the navigate reconciled the
// post, and the post flapped again — ~15 turns a second from the first
// background pulse on, re-running the page's scripts each time.
//
// The world is real where the loop lives — the shipped ModeRegistry and
// ViewBack over a session history whose back() lands later as a popstate,
// the way the browser's does — and fake only at the decoration reads.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import type { HistoryLike, ViewBack as ViewBackType } from '../../navigation/view-back.js'
import type { ModeRegistry as ModeRegistryType } from '../../navigation/mode-registry.service.js'

type Payload = { version: 1; title?: string; htmlSig?: string; text?: string }
let payload: Payload
const pages = new Map<string, string>()

vi.mock('../../commands/decoration-manifest.js', async original => ({
  ...(await original<typeof import('../../commands/decoration-manifest.js')>()),
  listDecorations: async () => [{ record: { payload } }],
}))
vi.mock('../../sharing/feature-hidden.js', async original => ({
  ...(await original<typeof import('../../sharing/feature-hidden.js')>()),
  isFeatureHidden: async () => false,
}))
vi.mock('../../sharing/behavior-enablement.js', async original => ({
  ...(await original<typeof import('../../sharing/behavior-enablement.js')>()),
  isBehaviorDormant: () => false,
  isPublishedVisitorShell: () => true,
}))
vi.mock('./scroll-gutter.js', () => ({ trackScrollGutter: () => () => {} }))

/** A session history like the browser's: back() traverses on a later TASK,
 *  after the microtasks of whatever called it (a remount's awaits) are done. */
class FakeHistory implements HistoryLike {
  entries: unknown[] = [{}]
  index = 0
  backs = 0
  get state(): unknown { return this.entries[this.index] }
  get length(): number { return this.entries.length }
  pushState = (state: unknown): void => {
    this.entries.length = this.index + 1
    this.entries.push(state)
    this.index++
  }
  back = (): void => {
    this.backs++
    setTimeout(() => {
      if (this.index === 0) return
      this.index--
      window.dispatchEvent(new Event('popstate'))
    }, 0)
  }
}

const services = new Map<string, unknown>()
const strays: Array<{ markDisposed?: () => void }> = []
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (_key: string, value: unknown) => { strays.push(value as { markDisposed?: () => void }) },
  whenReady: () => void 0,
}

const { ModeRegistry } = await import('../../navigation/mode-registry.service.js')
const { ViewBack } = await import('../../navigation/view-back.js')
const { PostitViewDrone } = await import('./postit-view.drone.js')
while (strays.length) strays.pop()?.markDisposed?.()

class ViewModeStub extends EventTarget {
  mode = 'postit'
  setMode(next: string): void {
    if (next === this.mode) return
    this.mode = next
    this.dispatchEvent(new Event('change'))
  }
}

/** Navigation.onPopState: every popstate is a `navigate`. */
const popToNavigate = (): void => { window.dispatchEvent(new Event('navigate')) }
const settle = (ms = 100): Promise<unknown> => vi.advanceTimersByTimeAsync(ms)
const post = (): HTMLElement | null => document.querySelector('.hc-postit-view')
const pageText = (): string => post()?.querySelector('.postit-page')?.shadowRoot?.textContent ?? ''

let history: FakeHistory
let modes: ModeRegistryType
let viewBack: ViewBackType
let drone: InstanceType<typeof PostitViewDrone>
let claims: Array<boolean>

beforeEach(async () => {
  vi.useFakeTimers()
  EffectBus.clear()
  pages.clear()
  pages.set('a'.repeat(64), '<h1>Arkanoid</h1>')
  pages.set('b'.repeat(64), '<h1>Arkanoid II</h1>')
  payload = { version: 1, title: 'Arkanoid', htmlSig: 'a'.repeat(64) }
  modes = new ModeRegistry()
  services.set('@diamondcoreprocessor.com/ModeRegistry', modes)
  services.set('@hypercomb.social/ViewMode', new ViewModeStub())
  services.set('@hypercomb.social/Lineage', { explorerSegments: () => ['games', 'arkanoid'] })
  services.set('@hypercomb.social/Store', {
    // The page's bytes as the store hands them (jsdom's Blob has no text()).
    getResource: async (sig: string) => {
      const html = pages.get(sig)
      return html === undefined ? null : { size: html.length, text: async () => html }
    },
  })
  history = new FakeHistory()
  viewBack = new ViewBack(history, window)
  window.addEventListener('popstate', popToNavigate)
  claims = []
  EffectBus.on<{ active?: boolean }>('view:active', p => claims.push(p?.active === true))
  drone = new PostitViewDrone()
  await drone.pulse('')
  await settle()
})

afterEach(() => {
  drone.markDisposed()
  viewBack.dispose()
  window.removeEventListener('popstate', popToNavigate)
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('the opened post — a pass that changes nothing leaves it alone', () => {
  it('mounts the page once and claims the surface once', () => {
    expect(pageText()).toContain('Arkanoid')
    expect(claims).toEqual([true])
    expect(history.length).toBe(2)            // view-back armed its one trap
  })

  it('a background pulse, a synchronize and a navigate keep the same post', async () => {
    const first = post()
    await drone.pulse('')
    window.dispatchEvent(new Event('synchronize'))
    window.dispatchEvent(new Event('navigate'))
    await settle(500)
    expect(post()).toBe(first)
    expect(claims).toEqual([true])
  })

  it('the first background pulse no longer starts the back/navigate loop', async () => {
    await drone.pulse('')                     // what the visitor's idle wake does at ~10 s
    for (let i = 0; i < 20; i++) await settle(100)
    expect(history.backs).toBe(0)
    expect(history.length).toBe(2)
    expect(claims).toEqual([true])
  })
})

describe('the opened post — a change swaps in place', () => {
  it('a new page replaces the old one without letting go of the surface', async () => {
    const first = post()
    payload = { version: 1, title: 'Arkanoid II', htmlSig: 'b'.repeat(64) }
    EffectBus.emit('decorations:changed', {})
    await settle(500)
    expect(post()).not.toBe(first)
    expect(pageText()).toContain('Arkanoid II')
    expect(document.querySelectorAll('.hc-postit-view').length).toBe(1)
    expect(claims).toEqual([true])
    expect(history.backs).toBe(0)
  })

  it('a page that had not arrived mounts once it does, and only then', async () => {
    payload = { version: 1, title: 'Late', htmlSig: 'c'.repeat(64) }
    EffectBus.emit('decorations:changed', {})
    await settle(500)
    const waiting = post()
    expect(pageText()).toContain('has not arrived yet')

    window.dispatchEvent(new Event('synchronize'))
    await settle(500)
    expect(post()).toBe(waiting)              // still missing: nothing to rebuild

    pages.set('c'.repeat(64), '<h1>Late page</h1>')
    window.dispatchEvent(new Event('synchronize'))
    await settle(500)
    expect(pageText()).toContain('Late page')
    expect(claims).toEqual([true])
  })
})
