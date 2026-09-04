// commands/machine-grammar.spec.ts
//
// WHAT THE SHIPPED BEHAVIOURS ACTUALLY OFFER A MACHINE.
//
// The grammar module's own spec proves it reads declarations faithfully using
// toy rules of its own. This one proves the real declarations say what we mean
// them to say — the half that would otherwise be assumed. Splitting them this
// way is deliberate: neither spec can pass by agreeing with a stale copy of
// the other, which is exactly how the old hand-kept allowlist fell behind the
// census until a participant was told Hypercomb cannot delete a tile.

import { describe, expect, it } from 'vitest'
import type { MachineGrammar } from '@hypercomb/core'

const registrations = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (key: string, value: unknown) => registrations.set(key, value),
    get: (key: string) => registrations.get(key),
    whenReady: () => void 0,
    // The drone's module scope scans already-registered queens and subscribes
    // to future ones; the manual providers this file reads are added inline.
    list: () => [],
    onRegister: () => void 0,
  },
  localStorage: { getItem: () => null, setItem: () => { /* noop */ } },
}
;(globalThis as unknown as { localStorage: unknown }).localStorage =
  { getItem: () => null, setItem: () => { /* noop */ } }

const { CreateQueenBee } = await import('./create.queen.js')
const { TitleQueenBee } = await import('./title.queen.js')
const { UndoQueenBee, RedoQueenBee } = await import('../history/undo.queen.js')
const { HideQueenBee } = await import('../presentation/tiles/hide.queen.js')
const { CopyQueenBee, CutQueenBee, PasteQueenBee } = await import('../clipboard/clipboard.queen.js')

const BACKSLASH = String.fromCharCode(92)

/** Every declaration must be usable AS the catalogue line a model reads. */
const wellFormed = (machine: { forms: string; example: string } | undefined, name: string): void => {
  expect(machine, `${name} declares a machine grammar`).toBeTruthy()
  expect(typeof machine!.forms).toBe('string')
  expect(machine!.example.startsWith(`/${name}`), `${name}'s example is a ${name} line`).toBe(true)
}

describe('the machine grammar the shipped behaviours declare', () => {
  it('offers deletion under its own name, at destructive reach', async () => {
    // The whole reason this contract moved onto the behaviours: `/remove` has
    // shipped for months and any participant can type it, but the machine
    // census was a five-name table that did not list it — so a local model
    // reported, accurately from what it had been given, that Hypercomb has no
    // way to delete a tile.
    await import('./slash-behaviour.drone.js')
    const drone = registrations.get('@diamondcoreprocessor.com/SlashBehaviourDrone') as
      { entries(): readonly { name: string; machine?: MachineGrammar }[] }
    const remove = drone.entries().find(entry => entry.name === 'remove')

    wellFormed(remove?.machine, 'remove')
    expect(remove?.machine?.reach).toBe('destructive')

    // THE CATALOGUE MUST NOT LIE. /remove is one LayerCommitter.update setting
    // the parent's children slot to the survivors — nothing leaves the disk —
    // and confirmRemoval skips its dialog entirely when nothing is nested,
    // which is the common case. The shell printed "removes; asks the
    // participant to confirm" for every destructive verb and both halves were
    // false here, so a model relayed a confirmation that never happened.
    const consequence = remove?.machine?.consequence ?? ''
    expect(consequence, '/remove states what really happens').toBeTruthy()
    expect(consequence).toContain('survive')
    expect(consequence).toContain('/undo')
    expect(consequence).toMatch(/only when|nested/)
    expect(consequence, 'never an unqualified promise of a dialog')
      .not.toMatch(/^Asks the participant to confirm/)
    expect(remove?.machine?.refuse?.('drafts')).toBeUndefined()
    expect(remove?.machine?.refuse?.('[drafts, notes]')).toBeUndefined()
    // A bare `/remove` acts on the current SELECTION, which a machine cannot
    // see and must not guess at, so names are required on this seam.
    expect(remove?.machine?.bare).not.toBe(true)
    expect(remove?.machine?.refuse?.('')).toBeTruthy()
    expect(remove?.machine?.refuse?.('projects/drafts')).toContain('does not reach through')
  })

  it('reaches the gentle verb first: /hide is offered, reversible by the same word', () => {
    const hide = new HideQueenBee()
    wellFormed(hide.machine, 'hide')
    expect(hide.machine?.reach).toBe('editing')
    expect(hide.machine?.forms).toContain('~<tile>')
    // Hiding writes a participant-local lens, not a commit, so the worst case
    // is a view the same word restores.
    expect(hide.machine?.refuse?.('drafts')).toBeUndefined()
    expect(hide.machine?.refuse?.('~drafts')).toBeUndefined()
    expect(hide.machine?.refuse?.('[a, b]')).toBeUndefined()
    expect(hide.machine?.refuse?.('')).toContain('needs a tile name')
    // A tile name is a path segment; reaching through `/` names a different tile.
    expect(hide.machine?.refuse?.('projects/drafts')).toContain('does not reach through')
  })

  it('lets a machine walk history in both directions, bare', () => {
    for (const queen of [new UndoQueenBee(), new RedoQueenBee()]) {
      wellFormed(queen.machine, queen.command)
      expect(queen.machine?.bare, `${queen.command} means something on its own`).toBe(true)
      expect(queen.machine?.refuse?.('')).toBeUndefined()
      expect(queen.machine?.refuse?.('3')).toBeUndefined()
      expect(queen.machine?.refuse?.('lots')).toContain('whole number')
      expect(queen.machine?.refuse?.('999')).toContain('at most')
    }
  })

  it('refuses what /create would silently normalize into nothing', () => {
    const create = new CreateQueenBee()
    wellFormed(create.machine, 'create')
    expect(create.machine?.reach).toBe('additive')
    expect(create.machine?.refuse?.('roadmap')).toBeUndefined()
    expect(create.machine?.refuse?.('meals/breakfast')).toBeUndefined()
    // A name is the tile's ADDRESS: an empty or relative segment is a different
    // tile, or none. A clean no-op would earn the model a receipt that lied.
    expect(create.machine?.refuse?.('')).toBeTruthy()
    expect(create.machine?.refuse?.('a//b')).toBeTruthy()
    expect(create.machine?.refuse?.('..')).toBeTruthy()
    expect(create.machine?.refuse?.('a' + BACKSLASH + 'b')).toBeTruthy()
  })

  it('makes /keyword and /accent name their tile, so a machine never fires blind', async () => {
    // Both inherited their machine grammar from the old five-name table, and
    // both act on the current SELECTION — which a speaker cannot see. A model
    // saying `/keyword urgent` with nothing picked wrote only the global tag
    // registry and still earned a clean receipt. /accent was worse: the same
    // line could write localStorage, the tag registry, or per-tile properties
    // depending on invisible state.
    await import('./slash-behaviour.drone.js')
    const drone = registrations.get('@diamondcoreprocessor.com/SlashBehaviourDrone') as
      { entries(): readonly { name: string; machine?: MachineGrammar }[] }
    const entry = (name: string) => drone.entries().find(e => e.name === name)?.machine

    const keyword = entry('keyword')
    wellFormed(keyword, 'keyword')
    expect(keyword?.refuse?.('roadmap = urgent')).toBeUndefined()
    expect(keyword?.refuse?.('roadmap = urgent(#c0392b)')).toBeUndefined()
    expect(keyword?.refuse?.('roadmap = ~urgent')).toBeUndefined()
    expect(keyword?.refuse?.('urgent'), 'the selection form is refused a machine').toContain('named tile')
    expect(keyword?.refuse?.('roadmap = urgent(red)')).toContain('hexadecimal')
    expect(keyword?.refuse?.('a/b = urgent')).toContain('one tile on this page')

    const accent = entry('accent')
    wellFormed(accent, 'accent')
    expect(accent?.refuse?.('roadmap = ember')).toBeUndefined()
    expect(accent?.refuse?.('ember'), 'the bare preset writes localStorage, not a tile').toContain('named tile')
    expect(accent?.refuse?.('roadmap = ultraviolet')).toContain('not a known accent preset')
  })

  it('lets a machine SET a title but not clear one — clearing is a removal', () => {
    const title = new TitleQueenBee()
    wellFormed(title.machine, 'title')
    expect(title.machine?.refuse?.('roadmap = Road map')).toBeUndefined()

    // WITHDRAWN 2026-09-04. This used to assert the opposite, on the argument
    // that a title is an ordinary decoration and `/undo` puts either back. That
    // is true and was the wrong axis: setting swaps one record for another,
    // while clearing runs the same removal loop and writes nothing after it —
    // "takes something away", which is the rubric's own destructive wording. One
    // `reach: 'editing'` cannot cover both, and a gate reading it would be gated
    // on the weaker half. Reversibility does not separate the tiers: /remove is
    // destructive and undoable too.
    //
    // A model can still correct a wrong title by setting another. Clearing back
    // to no-title stays a participant's form.
    expect(title.machine?.refuse?.('roadmap =')).toContain('clearing')
    expect(title.machine?.forms).not.toContain('<cell> = |')
    expect(title.machine?.forms.endsWith('<cell> = <text>')).toBe(true)

    expect(title.machine?.refuse?.('= Something')).toContain('one child tile name')
    expect(title.machine?.refuse?.('child/path = Something')).toContain('one child tile name')
  })
  it('names its tiles on the clipboard verbs, because a speaker cannot see a selection', () => {
    for (const queen of [new CopyQueenBee(), new CutQueenBee()]) {
      wellFormed(queen.machine, queen.command)
      expect(queen.machine?.refuse?.('drafts')).toBeUndefined()
      expect(queen.machine?.refuse?.('[drafts, notes]')).toBeUndefined()
      // The button acts on whatever is picked. That is right for a hand and
      // useless to a speaker, so the machine seam requires names.
      expect(queen.machine?.bare).not.toBe(true)
      expect(queen.machine?.refuse?.('')).toContain('cannot see what is picked')
      expect(queen.machine?.refuse?.('projects/drafts')).toContain('does not reach through')
    }

    // Paste is the exception: "place what is held, where I am" is entire.
    const paste = new PasteQueenBee()
    wellFormed(paste.machine, 'paste')
    expect(paste.machine?.bare).toBe(true)
    expect(paste.machine?.refuse?.('')).toBeUndefined()
    expect(paste.machine?.refuse?.('drafts')).toContain('takes no argument')
  })
})
