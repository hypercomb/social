// hypercomb-shared/ui/window-session.spec.ts
//
// The rules that make "put the windows away for the installer, bring them back
// on the way home" safe to run in the middle of an install.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  holdWindow, parkWindows, unparkWindows, windowsParked, parkedWindowIds,
  resetWindowSession, signalSession, type BooleanSignal,
} from './window-session.js'

/** A window that is nothing but a boolean, the way most of them are. */
const fakeSignal = (initial: boolean): BooleanSignal => {
  let value = initial
  const s = (() => value) as BooleanSignal
  s.set = (next: boolean) => { value = next }
  return s
}

describe('window session', () => {
  beforeEach(() => resetWindowSession())

  it('parks every showing window and brings them all back', () => {
    const notes = fakeSignal(true)
    const files = fakeSignal(true)
    holdWindow('notes-strip', signalSession(notes))
    holdWindow('files-viewer', signalSession(files))

    expect(parkWindows()).toBe(2)
    expect(notes()).toBe(false)
    expect(files()).toBe(false)
    expect(windowsParked()).toBe(true)

    expect(unparkWindows()).toBe(2)
    expect(notes()).toBe(true)
    expect(files()).toBe(true)
    expect(windowsParked()).toBe(false)
  })

  it('announces shut while parked, so the Escape cascade and the lights agree', () => {
    const visible = fakeSignal(true)
    const said: boolean[] = []
    holdWindow('clipboard-panel', signalSession(visible, open => said.push(open)))

    parkWindows()
    unparkWindows()
    expect(said).toEqual([false, true])
  })

  it('a second park keeps the FIRST remembered set — never the empty screen', () => {
    const visible = fakeSignal(true)
    holdWindow('features-viewer', signalSession(visible))

    parkWindows()
    // The panel's element went with the parking, so it dropped out of the
    // showing set. A queued install parking again must not forget it.
    expect(parkWindows()).toBe(0)
    expect(parkedWindowIds()).toEqual(['features-viewer'])

    unparkWindows()
    expect(visible()).toBe(true)
  })

  it('brings back a window whose registration is gone (parking took its DOM)', () => {
    const visible = fakeSignal(true)
    const release = holdWindow('history-viewer', signalSession(visible))

    parkWindows()
    release()                       // the panel's directive was destroyed
    unparkWindows()
    expect(visible()).toBe(true)
  })

  it('leaves a window opened DURING the park alone', () => {
    const parkedOne = fakeSignal(true)
    holdWindow('tags-viewer', signalSession(parkedOne))
    parkWindows()

    const opened = fakeSignal(true)
    holdWindow('feedback-viewer', signalSession(opened))
    unparkWindows()

    expect(parkedOne()).toBe(true)
    expect(opened()).toBe(true)     // untouched — unparking adds, never closes
  })

  it('re-registering the same id replaces rather than doubling', () => {
    const first = fakeSignal(true)
    const second = fakeSignal(true)
    holdWindow('aggregate-collections', signalSession(first))
    holdWindow('aggregate-collections', signalSession(second))

    expect(parkWindows()).toBe(1)
    expect(second()).toBe(false)
  })

  it('one window throwing still parks the rest', () => {
    const ok = fakeSignal(true)
    holdWindow('bad', { park: () => { throw new Error('boom') }, unpark: () => {} })
    holdWindow('good', signalSession(ok))

    expect(() => parkWindows()).not.toThrow()
    expect(ok()).toBe(false)
  })

  it('unparking nothing is a no-op', () => {
    expect(unparkWindows()).toBe(0)
    expect(windowsParked()).toBe(false)
  })
})
