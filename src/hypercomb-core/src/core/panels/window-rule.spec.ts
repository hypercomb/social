// hypercomb-shared/ui/window-rule.spec.ts
//
// ONE WINDOW AT A TIME, with the pheromone palette the single surface allowed
// to stay beside one. The chrome that drives this is an Angular directive (it
// cannot be imported under JIT), so this covers the model it drives — exactly
// as dock-lanes.spec.ts and panel-groups.spec.ts do for theirs.

import { beforeEach, describe, expect, it } from 'vitest'
import { displacedBy, holdToolWindow, resetWindowRule, toolWindowIds, windowsToKeep } from './window-rule.js'
import type { WindowSession } from './window-session.js'

/** A tool window as the rule sees one: something that can be put away, and a
 *  note of whether it was.
 *
 *  Parking DROPS it from the showing set, because that is what parking does to
 *  a real one — the panel unmounts and its `ngOnDestroy` releases it. A fake
 *  that stayed registered after being put away would be swept again by the
 *  next opening and report parks the shell never made. Unparking REGISTERS it
 *  again, as a real remount does; closing releases with `closed: true`, as the
 *  docked panel does for the participant's own close. */
class FakeWindow implements WindowSession {
  parked = 0
  unparked = 0
  closed = 0
  release: ((closed?: boolean) => void) | null = null
  constructor(readonly id = '', readonly companion = false) {}
  park(): void { this.parked++; this.release?.(); this.release = null }
  unpark(): void { this.unparked++; if (this.id) this.release = holdToolWindow(this.id, this) }
  close(): void { this.closed++; this.release?.(true); this.release = null }
}

/** The rule defers its sweep a microtask (a registration happens inside the
 *  opening window's own change detection). Let it run. */
const settle = (): Promise<void> => Promise.resolve().then(() => {})

/** Reset + a settled sweep, for the tests that set the scene with several
 *  windows before the one under test opens. */
const opened = async (...held: [string, FakeWindow][]): Promise<void> => {
  for (const [id, session] of held) session.release = holdToolWindow(id, session)
  await settle()
}

const setViewport = (width: number, height = 900): void => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true })
}

describe('one window at a time', () => {
  beforeEach(() => {
    resetWindowRule()
    setViewport(1600)
  })

  it('leaves the first window alone', async () => {
    const notes = new FakeWindow()
    await opened(['notes-strip', notes])
    expect(notes.parked).toBe(0)
  })

  it('puts the open window away when another opens', async () => {
    const history = new FakeWindow()
    const notes = new FakeWindow()
    await opened(['history-viewer', history])
    await opened(['notes-strip', notes])
    expect(history.parked).toBe(1)
    expect(notes.parked).toBe(0)
  })

  it('puts away EVERY other window, on either edge', async () => {
    // Three opened one after another: each one already puts the previous away,
    // so by the time notes arrives only the newest is still up — and it goes.
    const left = new FakeWindow()
    const right = new FakeWindow()
    const third = new FakeWindow()
    await opened(['history-viewer', left])
    await opened(['sequence-viewer', right])
    await opened(['files-viewer', third])
    const notes = new FakeWindow()
    await opened(['notes-strip', notes])
    expect([left.parked, right.parked, third.parked]).toEqual([1, 1, 1])
    expect(notes.parked).toBe(0)
  })

  // A restore (the installer handing back what it parked) registers several
  // windows in ONE turn. One sweep, on the newest — not one per registration,
  // each re-parking the losers and re-announcing it.
  it('sweeps once for a burst of registrations', async () => {
    const a = new FakeWindow()
    const b = new FakeWindow()
    await opened(['history-viewer', a], ['sequence-viewer', b])
    expect([a.parked, b.parked]).toEqual([1, 0])
  })

  it('PARKS rather than closes — the shell made this decision, not the participant', async () => {
    const history = new FakeWindow()
    await opened(['history-viewer', history])
    await opened(['notes-strip', new FakeWindow()])
    expect(history.closed).toBe(0)
  })

  // The exception, and the reason it exists: a mark is applied by dragging FROM
  // the palette ONTO a note in the window that holds it. Put either away and
  // the gesture is impossible — which is what a plain one-window rule would do.
  describe('the pheromone palette', () => {

    it('stays when a window opens beside it', async () => {
      const palette = new FakeWindow('tags-viewer', true)
      await opened(['tags-viewer', palette])
      await opened(['notes-strip', new FakeWindow()])
      expect(palette.parked).toBe(0)
    })

    it('keeps the window it is there to paint on', async () => {
      const notes = new FakeWindow()
      await opened(['notes-strip', notes])
      await opened(['tags-viewer', new FakeWindow('tags-viewer', true)])
      expect(notes.parked).toBe(0)
    })

    it('does not spare a THIRD window', async () => {
      const palette = new FakeWindow('tags-viewer', true)
      const history = new FakeWindow()
      await opened(['tags-viewer', palette], ['history-viewer', history])
      const notes = new FakeWindow()
      await opened(['notes-strip', notes])
      expect(history.parked).toBe(1)
      expect(palette.parked).toBe(0)
      expect(notes.parked).toBe(0)
    })

    it('is spent on a phone, where a second panel is a second slab', async () => {
      setViewport(390, 844)
      const palette = new FakeWindow('tags-viewer', true)
      await opened(['tags-viewer', palette])
      await opened(['notes-strip', new FakeWindow()])
      expect(palette.parked).toBe(1)
    })

    it('is spent on a LANDSCAPE phone too — wide, and still no room', async () => {
      setViewport(932, 430)
      const palette = new FakeWindow('tags-viewer', true)
      await opened(['tags-viewer', palette])
      await opened(['notes-strip', new FakeWindow()])
      expect(palette.parked).toBe(1)
    })
  })

  // A CLOSE restores what the arrival displaced; a PARK never does.
  describe('closing the newcomer', () => {
    it('brings back the window it displaced', async () => {
      const chat = new FakeWindow('chat-window')
      const notes = new FakeWindow('notes-strip')
      await opened(['chat-window', chat])
      await opened(['notes-strip', notes])
      expect(chat.parked).toBe(1)
      expect(displacedBy('notes-strip')).toBe('chat-window')

      notes.close()
      await settle()
      expect(chat.unparked).toBe(1)
      expect(toolWindowIds()).toEqual(['chat-window'])
      // Spent: nothing is owed to anyone now.
      expect(displacedBy('notes-strip')).toBeNull()
    })

    it('unwinds a step per close, never more', async () => {
      const a = new FakeWindow('a'), b = new FakeWindow('b'), c = new FakeWindow('c')
      await opened(['a', a])
      await opened(['b', b])
      await opened(['c', c])
      c.close(); await settle()
      expect([a.unparked, b.unparked]).toEqual([0, 1])
      b.close(); await settle()
      expect([a.unparked, b.unparked]).toEqual([1, 1])
    })

    it('PARKED instead (Escape, the installer) brings nothing back', async () => {
      const chat = new FakeWindow('chat-window')
      const notes = new FakeWindow('notes-strip')
      await opened(['chat-window', chat])
      await opened(['notes-strip', notes])
      notes.park()              // the sweep: a plain release, no `closed`
      await settle()
      expect(chat.unparked).toBe(0)
      // And the memory went with the sweep: put back and closed later, the
      // notes desk owes the chat nothing — that press asked for the hexagons.
      notes.unpark(); await settle()
      notes.close(); await settle()
      expect(chat.unparked).toBe(0)
    })

    it('replays nothing for a window the participant reopened themselves', async () => {
      const chat = new FakeWindow('chat-window')
      const notes = new FakeWindow('notes-strip')
      await opened(['chat-window', chat])
      await opened(['notes-strip', notes])
      // Reopened by hand while notes is up: the rule parks notes for it, and
      // the chat is nobody's to restore.
      chat.unpark(); await settle()
      expect(notes.parked).toBe(1)
      expect(displacedBy('notes-strip')).toBeNull()
      expect(displacedBy('chat-window')).toBe('notes-strip')
      chat.close(); await settle()
      expect(notes.unparked).toBe(1)
      expect(chat.unparked).toBe(1)   // the one by hand; nothing since
    })

    it('restores the window, not the companion beside it', async () => {
      const palette = new FakeWindow('tags-viewer', true)
      const notes = new FakeWindow('notes-strip')
      const chat = new FakeWindow('chat-window')
      await opened(['notes-strip', notes], ['tags-viewer', palette])
      await opened(['chat-window', chat])
      expect(displacedBy('chat-window')).toBe('notes-strip')
      chat.close(); await settle()
      expect(notes.unparked).toBe(1)
    })
  })

  it('drops a window from the set when it goes', async () => {
    const notes = new FakeWindow()
    const release = holdToolWindow('notes-strip', notes)
    await settle()
    expect(toolWindowIds()).toEqual(['notes-strip'])
    release()
    expect(toolWindowIds()).toEqual([])
    // Gone means gone: a later opening has nothing of ours to park.
    holdToolWindow('history-viewer', new FakeWindow())
    await settle()
    expect(notes.parked).toBe(0)
  })

  it('treats a remount as the same window, not a second one', async () => {
    const notes = new FakeWindow()
    holdToolWindow('notes-strip', notes)
    await opened(['notes-strip', notes])
    expect(toolWindowIds()).toEqual(['notes-strip'])
    expect(notes.parked).toBe(0)
  })

  it('parks nothing for a window that closed again before the sweep ran', async () => {
    const history = new FakeWindow()
    await opened(['history-viewer', history])
    const release = holdToolWindow('notes-strip', new FakeWindow())
    release()                 // opened and gone inside the same turn
    await settle()
    expect(history.parked).toBe(0)
  })

  it('survives a window that throws on the way out', async () => {
    const bad: WindowSession = { park: () => { throw new Error('boom') }, unpark: () => {} }
    const good = new FakeWindow()
    holdToolWindow('bad', bad)
    await opened(['good-one', good])
    const notes = new FakeWindow()
    await opened(['notes-strip', notes])
    // The thrower does not stop the sweep reaching the window after it.
    expect(good.parked).toBe(1)
  })

  describe('who may stay', () => {
    it('names the arriving window and the palette', async () => {
      await opened(['tags-viewer', new FakeWindow('tags-viewer', true)], ['history-viewer', new FakeWindow()])
      await opened(['notes-strip', new FakeWindow()])
      expect([...windowsToKeep('notes-strip')].sort()).toEqual(['notes-strip', 'tags-viewer'])
    })

    it('is empty for a window that is not showing', () => {
      expect(windowsToKeep('nobody').size).toBe(0)
    })
  })
})
