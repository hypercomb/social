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
