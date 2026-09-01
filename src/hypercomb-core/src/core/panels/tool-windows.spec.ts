// tool-windows.spec.ts — ONE PRESS TAKES EVERYTHING, AND IT PARKS.
//
// The cascade knocks here to clear the screen, and what it gets back is the
// way to put the whole screen back. Three things are being pinned down:
//
//   1. It takes the LOT. Not the focused window, not the newest one — every
//      surface that is showing, in one press. What is up is rarely one thing
//      (a panel with the companion palette beside it, a pinned card over both,
//      the notes reader on its own), and climbing down a rung per press left
//      the hive covered the whole way.
//   2. It PARKS. Parking is "stop showing, keep everything", so what comes
//      back is what went: same scroll, same drill level, same half-typed
//      field. That is what makes an indiscriminate sweep safe — it costs
//      nothing. Closing is the participant's own decision and keeps its own
//      button, the ×.
//   3. The way back is SPENT and partial-aware. A surface the participant
//      opened again by hand is already back; putting it back would replay a
//      decision they have already made.
//
// `dismissFocused` is FOCUS ONLY: a press inside a window's own field belongs
// to that field. Anywhere else and the press is not about one window at all.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toolWindows } from './tool-windows.js'
import { holdToolWindow, resetWindowRule } from './window-rule.js'
import { holdWindow, isWindowShowing, resetWindowSession, type WindowSession } from './window-session.js'

/** A window that joins BOTH registries while it shows and drops out of them
 *  when it is put away — the round trip `hcDockedPanel` performs off its own
 *  visibility, which is what makes "is it showing" answerable at all. */
function openWindow(id: string, options: { dismiss?: () => boolean; root?: () => HTMLElement | null } = {}) {
  const log = { park: 0, unpark: 0, close: 0 }
  let release: (() => void)[] = []

  const show = (): void => {
    release = [holdToolWindow(id, session), holdWindow(id, session, options.root ?? (() => null))]
  }
  const hide = (): void => { for (const r of release) r(); release = [] }

  const session: WindowSession = {
    park: () => { log.park++; hide() },
    unpark: () => { log.unpark++; show() },
    close: () => { log.close++; hide() },
    ...(options.dismiss ? { dismiss: options.dismiss } : {}),
  }

  show()
  return { id, log, session }
}

/** A surface with no `close` at all — the pinnable hover stack's shape. It is
 *  swept like everything else: the sweep is about what is COVERING the hive,
 *  and parking costs it nothing. */
function openCard(id: string) {
  const log = { park: 0, unpark: 0 }
  let release: (() => void) | null = null
  const session: WindowSession = {
    park: () => { log.park++; release?.(); release = null },
    unpark: () => { log.unpark++; release = holdWindow(id, session, () => null) },
  }
  release = holdWindow(id, session, () => null)
  return { id, log, session }
}

describe('putAwayAll', () => {
  beforeEach(() => {
    resetWindowRule()
    resetWindowSession()
  })

  it('takes every showing surface in one call, and hands back the way back', () => {
    const panel = openWindow('tutorials')
    const card = openCard('contact')

    const back = toolWindows.putAwayAll()

    expect(back).toBeTypeOf('function')
    expect(panel.log.park).toBe(1)
    expect(card.log.park).toBe(1)
    expect(panel.log.close).toBe(0)
    expect(isWindowShowing('tutorials')).toBe(false)
    expect(isWindowShowing('contact')).toBe(false)

    expect(back!()).toBe(true)
    expect(panel.log.unpark).toBe(1)
    expect(card.log.unpark).toBe(1)
    expect(isWindowShowing('tutorials')).toBe(true)
    expect(isWindowShowing('contact')).toBe(true)
  })

  it('goes away again on the call after that — the same key, both ways', () => {
    const panel = openWindow('tutorials')

    toolWindows.putAwayAll()!()            // away, then back
    const back = toolWindows.putAwayAll()  // and away again

    expect(back).toBeTypeOf('function')
    expect(panel.log.park).toBe(2)
    expect(isWindowShowing('tutorials')).toBe(false)
  })

  it('brings back only what is still away', () => {
    const panel = openWindow('tutorials')
    const card = openCard('contact')
    const back = toolWindows.putAwayAll()!

    card.session.unpark()          // reopened by hand while the memory held it

    expect(back()).toBe(true)      // the panel still came back
    expect(panel.log.unpark).toBe(1)
    expect(card.log.unpark).toBe(1) // not brought back twice
  })

  it('says nothing landed when everything is already back', () => {
    const panel = openWindow('tutorials')
    const back = toolWindows.putAwayAll()!
    panel.session.unpark()

    expect(back()).toBe(false)
  })

  it('answers nothing when the screen is already clear', () => {
    expect(toolWindows.putAwayAll()).toBeNull()
  })

  it('still answers the door an older bundle knocks on', () => {
    const panel = openWindow('tutorials')

    expect(toolWindows.closeFocused()).toBe(true)
    expect(panel.log.park).toBe(1)
    expect(toolWindows.closeFocused()).toBe(false)
  })
})

describe('dismissFocused', () => {
  let root: HTMLElement | null = null

  beforeEach(() => {
    resetWindowRule()
    resetWindowSession()
  })

  afterEach(() => {
    root?.remove()
    root = null
  })

  const focusInside = (): HTMLElement => {
    root = document.createElement('div')
    root.tabIndex = 0
    document.body.appendChild(root)
    root.focus()
    return root
  }

  it('unwinds one level of the window the focus is inside', () => {
    let unwound = 0
    const held = focusInside()
    openWindow('tags', { dismiss: () => { unwound++; return true }, root: () => held })

    expect(toolWindows.dismissFocused()).toBe(true)
    expect(unwound).toBe(1)
  })

  it('leaves the press alone when the focus is out on the canvas', () => {
    let unwound = 0
    openWindow('tags', { dismiss: () => { unwound++; return true } })

    expect(toolWindows.dismissFocused()).toBe(false)
    expect(unwound).toBe(0)
  })
})
