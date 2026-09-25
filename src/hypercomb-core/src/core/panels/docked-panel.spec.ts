// hypercomb-core/src/core/panels/docked-panel.spec.ts
//
// THE DOCKED PANEL, covered for the first time.
//
// It could not be covered before: the chrome was an Angular directive, so
// importing it under JIT threw on its field decorators and every spec in this
// folder had to test the MODEL and take the chrome on trust (dock-lanes.spec.ts
// still says so in its header). Extracting the primitive out of the shell
// (2026-09-01) is what makes these assertions possible at all, and they are the
// point of the exercise: the thing a behaviour will call is now the thing CI
// runs.
//
// What is pinned here is the CONTRACT an element gets by being attached to —
// the grip, the gear, the width, the scale variable, the lane place — and that
// `dispose()` hands every one of them back. Not the look: the geometry lives in
// panel-settings.ts and moves without this file caring.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachDockedPanel, DockedPanel } from './docked-panel.js'
import { laneOccupants, resetLanes } from './dock-lanes.js'
import { registerTextTheme, setTextThemeWriter } from './panel-groups.js'

/** A tool window as the DOM has one: a header with a close button, and a body.
 *  The header matters — the gear is placed relative to it, and a window with no
 *  header must still attach cleanly rather than throw. */
const makePanel = (withHeader = true): HTMLElement => {
  const aside = document.createElement('aside')
  if (withHeader) {
    const header = document.createElement('header')
    const close = document.createElement('button')
    close.className = 'close'
    header.appendChild(close)
    aside.appendChild(header)
  }
  aside.appendChild(document.createElement('div'))
  document.body.appendChild(aside)
  return aside
}

const attached: DockedPanel[] = []
const attach = (el: HTMLElement, options = {}): DockedPanel => {
  const panel = attachDockedPanel(el, { id: 'spec-panel', dockSide: 'right', ...options })
  attached.push(panel)
  return panel
}

beforeEach(() => {
  localStorage.clear()
  resetLanes()
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true, writable: true })
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true, writable: true })
})

afterEach(() => {
  setTextThemeWriter(null)
  for (const panel of attached.splice(0)) panel.dispose()
  document.body.innerHTML = ''
})

describe('attaching', () => {
  it('gives the element a grip, a gear and a width', () => {
    const el = makePanel()
    attach(el, { defaultWidth: 400 })

    expect(el.querySelector('[data-hc-grip]')).toBeTruthy()
    expect(el.style.width).toBe('400px')
    // The multiplier every panel's SCSS sizes its body text off. Set here and
    // nowhere else, so a window cannot get a second opinion about its type.
    expect(el.style.getPropertyValue('--hc-panel-scale')).toBeTruthy()
  })

  it('takes a place in its edge lane, and gives it back on dispose', async () => {
    const el = makePanel()
    const panel = attach(el, { id: 'lane-one' })
    // The claim is deferred one microtask ON PURPOSE — the width set during
    // init (or by the window's own first render) is what the lane measures.
    await Promise.resolve()
    expect(laneOccupants('right').map(m => m.laneId)).toEqual(['lane-one'])

    panel.dispose()
    expect(laneOccupants('right')).toEqual([])
  })

  it('puts the grip on the INNER edge — the side you can actually drag from', () => {
    const right = makePanel()
    const left = makePanel()
    attach(right, { id: 'r', dockSide: 'right' })
    attach(left, { id: 'l', dockSide: 'left' })

    // A right-docked panel resizes from its left edge, and the reverse.
    expect((right.querySelector('[data-hc-grip]') as HTMLElement).style.left).toBe('0px')
    expect((left.querySelector('[data-hc-grip]') as HTMLElement).style.right).toBe('0px')
  })

  it('attaches to a window with no header rather than throwing', () => {
    // The gear needs a header; a window without one still gets everything else.
    // Throwing here would take down whatever mounted the panel.
    const el = makePanel(false)
    expect(() => attach(el)).not.toThrow()
    expect(el.querySelector('[data-hc-grip]')).toBeTruthy()
  })
})

describe('the width it opens at', () => {
  it('is remembered per id, so a panel reopens where you left it', () => {
    const first = makePanel()
    attach(first, { id: 'remembered', defaultWidth: 360 }).dispose()

    // Re-open at a width the participant dragged to.
    localStorage.setItem('hc:docked-width:remembered', '512')
    const second = makePanel()
    attach(second, { id: 'remembered', defaultWidth: 360 })
    expect(second.style.width).toBe('512px')
  })

  it('is clamped to the window\'s own range', () => {
    localStorage.setItem('hc:docked-width:clamped', '9000')
    const el = makePanel()
    attach(el, { id: 'clamped', minWidth: 280, maxWidth: 680, defaultWidth: 360 })
    expect(el.style.width).toBe('680px')
  })
})

describe('text themes', () => {
  it('applies a reading and code pairing through the shared settings gear', () => {
    const el = makePanel()
    const panel = attach(el, { id: 'reading-panel', hasReadingSurface: true })
    ;(el.querySelector('[data-hc-panel-settings]') as HTMLButtonElement).click()

    const editorial = el.querySelector('[data-hc-row="text-theme:editorial"]') as HTMLButtonElement
    expect(editorial).toBeTruthy()
    editorial.click()

    expect(el.style.getPropertyValue('--hc-read')).toContain('Georgia')
    expect(el.style.getPropertyValue('--hc-code')).toContain('IBM Plex Mono')
    expect(localStorage.getItem('hc:panel-read:reading-panel')).toBe('serif')
    expect(localStorage.getItem('hc:panel-font:reading-panel')).toBe('plex')
    expect(el.querySelector('[data-hc-row="text-theme:editorial"]')?.getAttribute('aria-pressed')).toBe('true')

    panel.dispose()
    const reopened = makePanel()
    attach(reopened, { id: 'reading-panel', hasReadingSurface: true })
    ;(reopened.querySelector('[data-hc-panel-settings]') as HTMLButtonElement).click()
    expect(reopened.querySelector('[data-hc-row="text-theme:editorial"]')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('shows a discovered theme in an open menu and saves a borrowed pairing', async () => {
    const el = makePanel()
    attach(el, { id: 'theme-creation', hasReadingSurface: true })
    ;(el.querySelector('[data-hc-panel-settings]') as HTMLButtonElement).click()
    const discovered = { key: 'community-studio', label: 'Studio', read: 'serif', code: 'jetbrains',
      head: 'a'.repeat(64) }
    registerTextTheme(discovered)
    const option = el.querySelector('[data-hc-row="text-theme:community-studio"]') as HTMLButtonElement
    expect(option?.textContent).toContain('Studio')
    option.click()
    expect(el.style.getPropertyValue('--hc-code')).toContain('JetBrains Mono')

    const saved: unknown[] = []
    setTextThemeWriter(async draft => {
      saved.push(draft)
      return { key: 'new-studio', label: draft.label, read: draft.read, code: draft.code }
    })
    const name = el.querySelector('[data-hc-row="text-theme-name"]') as HTMLInputElement
    name.value = 'My Studio'
    name.dispatchEvent(new Event('change', { bubbles: true }))
    ;(el.querySelector('[data-hc-row="text-theme-save"]') as HTMLButtonElement).click()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(saved).toEqual([{ label: 'My Studio', read: 'serif', code: 'jetbrains', source: 'a'.repeat(64) }])
    expect(localStorage.getItem('hc:panel-theme:theme-creation')).toBe('new-studio')
  })

  it('shows a changed head without applying its new face until clicked', () => {
    const key = 'community-revision'
    registerTextTheme({ key, label: 'Revision', read: 'hive', code: 'plex', head: 'b'.repeat(64) })
    const el = makePanel()
    attach(el, { id: 'revision-panel', hasReadingSurface: true })
    ;(el.querySelector('[data-hc-panel-settings]') as HTMLButtonElement).click()
    ;(el.querySelector(`[data-hc-row="text-theme:${key}"]`) as HTMLButtonElement).click()
    expect(el.style.getPropertyValue('--hc-code')).toContain('IBM Plex Mono')

    registerTextTheme({ key, label: 'Revision', read: 'hive', code: 'jetbrains', head: 'c'.repeat(64) })
    expect(el.style.getPropertyValue('--hc-code')).toContain('IBM Plex Mono')
    const changed = el.querySelector(`[data-hc-row="text-theme:${key}"]`) as HTMLButtonElement
    expect(changed.getAttribute('aria-pressed')).toBe('false')
    changed.click()
    expect(el.style.getPropertyValue('--hc-code')).toContain('JetBrains Mono')
  })

  it('offers a selected held theme only when its share switch is pressed', async () => {
    const shell = window as Window & { ioc?: { get: (key: string) => unknown } }
    const original = shell.ioc
    let state: 'off' | 'current' = 'off'
    const calls: { key: string; host: string; on: boolean }[] = []
    shell.ioc = { get: key => key === '@diamondcoreprocessor.com/TextThemeOffering'
      ? {
        defaultHost: () => 'jwize.com',
        status: async () => ({ ok: true, state }),
        set: async (theme: { key: string }, host: string, on: boolean) => {
          calls.push({ key: theme.key, host, on })
          state = on ? 'current' : 'off'
          return { ok: true, state }
        },
      } : original?.get(key) }
    try {
      registerTextTheme({ key: 'share-studio', label: 'Studio', read: 'serif', code: 'plex',
        location: 'a'.repeat(64), head: 'b'.repeat(64) })
      const el = makePanel()
      attach(el, { id: 'offer-panel', hasReadingSurface: true })
      ;(el.querySelector('[data-hc-panel-settings]') as HTMLButtonElement).click()
      ;(el.querySelector('[data-hc-row="text-theme:share-studio"]') as HTMLButtonElement).click()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(calls).toEqual([])
      const host = el.querySelector('[data-hc-row="text-theme-offer-host"]') as HTMLInputElement
      expect(host.value).toBe('jwize.com')
      host.value = 'art.example'
      host.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
      const switchOn = el.querySelector('[data-hc-row="text-theme-offer"]') as HTMLInputElement
      expect(switchOn.checked).toBe(false)
      switchOn.click()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(calls).toEqual([{ key: 'share-studio', host: 'art.example', on: true }])
      const switchOff = el.querySelector('[data-hc-row="text-theme-offer"]') as HTMLInputElement
      expect(switchOff.checked).toBe(true)
      switchOff.click()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(calls.at(-1)).toEqual({ key: 'share-studio', host: 'art.example', on: false })
    } finally { shell.ioc = original }
  })
})

describe('being pushed out of a full lane', () => {
  it('ASKS the owner to close, and never closes itself', () => {
    // The window keeps its own signal, launcher state and teardown
    // authoritative — this was an @Output for that reason and is a callback for
    // the same one. A window with no session of its own can only close.
    let asked = 0
    const el = makePanel()
    const panel = attach(el, { id: 'evicted', onClose: () => { asked++ } })
    panel.evictFromLane()

    expect(asked).toBe(1)
    expect(el.isConnected).toBe(true)   // still on screen: the owner decides
  })

  it('PARKS instead, when the window brought a session', () => {
    // Being pushed out is not something the participant asked for, so it must
    // cost them nothing: the window stops showing and keeps what it had staged.
    let asked = 0, parked = 0
    const panel = attach(makePanel(), {
      id: 'parked',
      onClose: () => { asked++ },
      hcSession: { park: () => { parked++ }, unpark: () => {} },
    })
    panel.evictFromLane()

    expect(parked).toBe(1)
    expect(asked).toBe(0)
  })
})

describe('dispose', () => {
  it('leaves nothing of itself behind', () => {
    const el = makePanel()
    const panel = attach(el, { id: 'clean' })
    expect(el.querySelector('[data-hc-grip]')).toBeTruthy()

    panel.dispose()
    expect(el.querySelector('[data-hc-grip]')).toBeNull()
    expect(el.style.getPropertyValue('--hc-panel-scale')).toBe('')
    expect(laneOccupants('right')).toEqual([])
  })

  it('is safe to call twice', () => {
    // A component's teardown and an owner's explicit close both reach here.
    const panel = attach(makePanel(), { id: 'twice' })
    panel.dispose()
    expect(() => panel.dispose()).not.toThrow()
  })
})
