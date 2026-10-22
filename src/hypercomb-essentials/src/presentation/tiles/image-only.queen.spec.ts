// presentation/tiles/image-only.queen.spec.ts — ONE WORD, TWO SCOPES.
//
// With nothing selected `/image-only` is a lens: it states the mode on
// `tile:toggle-text` and writes nothing. With a selection it flips the selected
// tiles' own name switch and saves them, all onto one side. Text only and image
// only never hold at once.

import { describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const held = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { held.set(key, value) },
  get: (key: string) => held.get(key),
  list: () => [...held.keys()],
  whenReady: () => void 0,
  onRegister: () => void 0,
}
const set = (key: string, value: unknown): void => { held.set(key, value) }

const state = vi.hoisted(() => ({
  props: new Map<string, Record<string, unknown>>(),
  writes: [] as { label: string; segments: readonly string[]; updates: Record<string, unknown> }[],
}))
vi.mock('../../editor/tile-properties.js', () => ({
  readTilePropertiesAt: async (_segments: readonly string[], label: string) => ({ ...(state.props.get(label) ?? {}) }),
  writeTilePropertiesAt: async (segments: readonly string[], label: string, updates: Record<string, unknown>) => {
    state.writes.push({ label, segments, updates })
    const next = { ...(state.props.get(label) ?? {}), ...updates }
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key]
    state.props.set(label, next)
  },
}))

const { ImageOnlyQueenBee, nextHideText } = await import('./image-only.queen.js')
const queen = held.get('@diamondcoreprocessor.com/ImageOnlyQueenBee') as InstanceType<typeof ImageOnlyQueenBee>

const last = <T,>(effect: string): (() => T | undefined) => {
  let value: T | undefined
  EffectBus.on<T>(effect, p => { value = p })
  return () => value
}

describe('nextHideText — the selection lands on one side', () => {
  it('hides every tile while any still shows its name', () => {
    expect(nextHideText([false, false])).toBe(true)
    expect(nextHideText([true, false])).toBe(true)
  })
  it('shows them all only once every one hides', () => {
    expect(nextHideText([true, true])).toBe(false)
  })
})

describe('/image-only with nothing selected — a lens', () => {
  it('states the mode on tile:toggle-text and toggles back on the second word', async () => {
    set('@diamondcoreprocessor.com/SelectionService', { selected: new Set<string>() })
    const mode = last<{ imageOnly: boolean }>('tile:toggle-text')
    await queen.invoke('')
    expect(mode()).toEqual({ imageOnly: true })
    expect(state.writes).toEqual([])
    await queen.invoke('')
    expect(mode()).toEqual({ imageOnly: false })
  })

  it('never holds together with text only', async () => {
    set('@diamondcoreprocessor.com/SelectionService', { selected: new Set<string>() })
    const textOnly = last<{ textOnly: boolean }>('render:set-text-only')
    const mode = last<{ imageOnly: boolean }>('tile:toggle-text')
    EffectBus.emit('render:set-text-only', { textOnly: true })
    await queen.invoke('')                       // image only on → text only off
    expect(mode()).toEqual({ imageOnly: true })
    expect(textOnly()).toEqual({ textOnly: false })
    EffectBus.emit('render:set-text-only', { textOnly: true })   // text only on → image only off
    expect(mode()).toEqual({ imageOnly: false })
    EffectBus.emit('render:set-text-only', { textOnly: false })
  })

  it('refuses an argument', async () => {
    expect(queen.machine.refuse('on')).toContain('no arguments')
    await expect(queen.invoke('on')).rejects.toThrow('no arguments')
  })
})

describe('/image-only with a selection — the tiles\' own switch, saved', () => {
  it('hides every selected name while one still shows, then shows them all', async () => {
    set('@diamondcoreprocessor.com/SelectionService', { selected: new Set(['a', 'b']) })
    set('@hypercomb.social/Lineage', { explorerSegments: () => ['x'] })
    state.props.set('a', {})
    state.props.set('b', { hideText: true })
    state.writes.length = 0
    const saved: { cell: string; segments: readonly string[] }[] = []
    const off = EffectBus.on<{ cell: string; segments: readonly string[] }>('tile:saved', p => { saved.push(p) })
    const mode = last<{ imageOnly: boolean }>('tile:toggle-text')
    const before = mode()

    await queen.invoke('')
    // only "a" changes — "b" already hid — and the page mode is untouched
    expect(state.writes).toEqual([{ label: 'a', segments: ['x'], updates: { hideText: true } }])
    expect(saved.at(-1)).toEqual({ cell: 'a', segments: ['x'] })
    expect(mode()).toEqual(before)

    state.writes.length = 0
    await queen.invoke('')
    // every one hid, so every one shows again: the switch is cleared, not set false
    expect(state.writes.map(w => w.label).sort()).toEqual(['a', 'b'])
    for (const write of state.writes) expect(write.updates).toEqual({ hideText: undefined })
    expect(state.props.get('a')).toEqual({})
    expect(state.props.get('b')).toEqual({})
    off()
  })
})
