// keyboard-desk/bindings/bindings.ts
//
// TRAIT `bindings` — the participant's own chords. One document in the
// `keymap:bindings` pool: every version kept, the newest is the one that runs,
// and the document's signature names that whole keymap, so it can be read back,
// compared or handed to somebody else.

import { registerPoolMeaning, type KeyChord } from '@hypercomb/core'
import { USER_KEYMAP_LAYER, sameChord } from '../../keyboard/chord-match.js'
import { lineupOf, wordOf, type Behaviour, type BindingsPart, type Chord, type Choice } from '../parts.js'

export const KEYMAP_POOL = 'keymap:bindings'
const LAYER_PRIORITY = 100

type PoolStore = {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
  putPoolDoc?: (
    pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'versions' | 'current' },
  ) => Promise<string | null>
  opfsRoot?: FileSystemDirectoryHandle
}

const store = (): PoolStore | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@hypercomb.social/Store') as PoolStore | undefined

/** Reading never mints the pool: a hive with no choices stays without one. */
const readOnlyPool = async (): Promise<FileSystemDirectoryHandle | null> => {
  const root = store()?.opfsRoot
  if (!root) return null
  try { return await root.getDirectoryHandle(await registerPoolMeaning(KEYMAP_POOL), { create: false }) }
  catch { return null }
}

const isChord = (value: unknown): value is KeyChord =>
  !!value && typeof value === 'object' && typeof (value as { key?: unknown }).key === 'string'

export const parseChoices = (bytes: ArrayBuffer | null): readonly Choice[] => {
  if (!bytes) return []
  try {
    const list = (JSON.parse(new TextDecoder().decode(bytes)) as { bindings?: unknown }).bindings
    if (!Array.isArray(list)) return []
    return list.flatMap((item): Choice[] => {
      const { cmd, sequence, description, category } = (item ?? {}) as Record<string, unknown>
      if (typeof cmd !== 'string' || !cmd || !Array.isArray(sequence)) return []
      if (!sequence.every(step => Array.isArray(step) && step.every(isChord))) return []
      return [{
        cmd,
        sequence: sequence as KeyChord[][],
        ...(typeof description === 'string' ? { description } : {}),
        ...(typeof category === 'string' ? { category } : {}),
      }]
    })
  } catch { return [] }
}

export const loadChoices = async (): Promise<readonly Choice[]> => {
  const s = store()
  const pool = await readOnlyPool()
  return pool && s?.getPoolDoc ? parseChoices(await s.getPoolDoc(pool)) : []
}

export const saveChoices = async (choices: readonly Choice[]): Promise<string | null> => {
  const s = store()
  if (!s?.getPool || !s.putPoolDoc) return null
  const pool = await s.getPool(KEYMAP_POOL)
  if (!pool) return null
  const bytes = new TextEncoder().encode(JSON.stringify({ meaning: KEYMAP_POOL, bindings: choices }))
  return s.putPoolDoc(pool, bytes.buffer as ArrayBuffer, undefined, { keep: 'versions' })
}

const startsWith = (sequence: readonly (readonly KeyChord[])[], chord: Chord): boolean =>
  sequence.length === chord.length && chord.every((step, index) => {
    const here = sequence[index]
    return !!here?.length && here.some(k => sameChord(k, step))
  })

/** A word or a lineup has no default beneath it to read from. */
const ownCommand = (cmd: string): boolean => wordOf(cmd) !== null || lineupOf(cmd) !== null

/** One chord runs one chosen behaviour: choosing it again moves it. */
export const assignChoice = (choices: readonly Choice[], behaviour: Behaviour, chord: Chord): readonly Choice[] => {
  const kept = choices.filter(choice =>
    choice.cmd !== behaviour.id && !startsWith(choice.sequence, chord))
  return [...kept, {
    cmd: behaviour.id,
    sequence: chord.map(step => [step]),
    ...(ownCommand(behaviour.id) ? { description: behaviour.description, category: behaviour.group } : {}),
  }]
}

/** A word or a lineup just goes. A default stays off with an empty sequence over it. */
export const unbindChoice = (choices: readonly Choice[], cmd: string): readonly Choice[] => {
  const kept = choices.filter(choice => choice.cmd !== cmd)
  return ownCommand(cmd) ? kept : [...kept, { cmd, sequence: [] }]
}

/** Reaches past a text field, as the shipped modifier bindings do: a plain key
 *  stays typing, a chord with a modifier never was. */
const pierces = (sequence: readonly (readonly KeyChord[])[]): boolean =>
  !!sequence[0]?.some(k => k.primary || k.ctrl || k.alt || k.meta)

export const layerOfChoices = (choices: readonly Choice[]): { id: string; priority: number; bindings: Choice[] } => ({
  id: USER_KEYMAP_LAYER,
  priority: LAYER_PRIORITY,
  bindings: choices.map(choice => ({ ...choice, ...(pierces(choice.sequence) ? { pierce: true } : {}) })),
})

export const bindingsPart: BindingsPart = {
  load: loadChoices,
  save: saveChoices,
  assign: assignChoice,
  unbind: unbindChoice,
  layerOf: layerOfChoices,
}
