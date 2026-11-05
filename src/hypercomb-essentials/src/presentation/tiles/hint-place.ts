// presentation/tiles/hint-place.ts
//
// WHERE AN ICON'S EXPLANATION IS SAID. Resting the pointer on one of a tile's
// icons says what it does. By default that is said ON THE TILE, in the same
// label that carries the tile's name (the raised name, tile-name.drone.ts), so
// the words stay where the eye already is. The other way is the caption,
// top-centre under the command line (presentation/caption). The `hints` word
// flips between the two.
//
// The choice is sticky, and it is kept in the store, not in a browser key: one
// current record in the `hint:place` pool, recalled by the overlay on boot.
// A press that lands before the read wins.
//
//   EffectBus 'hint:place' { place }                — the choice (replayed)
//   EffectBus 'hint:say'   { label, title?, text? } — the words for the tile
//                                                     `label` (transient);
//                                                     `label: null` takes
//                                                     them down

export type HintPlace = 'tile' | 'top'

/** The choice, as an effect — replayed to late subscribers. */
export const HINT_PLACE = 'hint:place'
/** The explanation for a tile's label while its icon is under the pointer. */
export const HINT_SAY = 'hint:say'

export type HintSay = { label: string | null; title?: string; text?: string }

/** On the tile, unless the participant asked for the top. */
export const DEFAULT_HINT_PLACE: HintPlace = 'tile'

const STATE_POOL = 'hint:place'
const STORE_KEY = '@hypercomb.social/Store'

/** The words a participant may say after `hints`. */
export const HINT_PLACE_WORDS: readonly HintPlace[] = ['tile', 'top']

/** The place a word names, or null when it names none. */
export function hintPlaceOf(word: string | undefined | null): HintPlace | null {
  const said = String(word ?? '').trim().toLowerCase()
  if (said === 'tile' || said === 'on-tile' || said === 'label') return 'tile'
  if (said === 'top' || said === 'caption' || said === 'at-top') return 'top'
  return null
}

/** The other way — what a bare `hints` flips to. */
export function otherHintPlace(place: HintPlace): HintPlace {
  return place === 'tile' ? 'top' : 'tile'
}

type StoreLike = {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle) => Promise<ArrayBuffer | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey: undefined, options: { keep: 'current' }) => Promise<unknown>
}
type IocLike = { get?: (k: string) => unknown; whenReady?: (k: string, cb: (v: unknown) => void) => void }
const ioc = (): IocLike | undefined => (globalThis as { ioc?: IocLike }).ioc

/** Keep the choice: one current record, written only by a press. */
export async function keepHintPlace(place: HintPlace): Promise<void> {
  const store = ioc()?.get?.(STORE_KEY) as StoreLike | undefined
  const pool = await store?.getPool?.(STATE_POOL)
  if (!pool || !store?.putPoolDoc) return
  const bytes = new TextEncoder().encode(JSON.stringify({ place, at: Date.now() })).buffer as ArrayBuffer
  await store.putPoolDoc(pool, bytes, undefined, { keep: 'current' }).catch(() => undefined)
}

/** The choice the participant left, or null when there is none. The store may
 *  register after the overlay mounts, so this waits for it. */
export function recallHintPlace(): Promise<HintPlace | null> {
  const read = async (store: StoreLike | undefined): Promise<HintPlace | null> => {
    try {
      const pool = await store?.getPool?.(STATE_POOL)
      if (!pool || !store?.getPoolDoc) return null
      const bytes = await store.getPoolDoc(pool)
      if (!bytes) return null
      const record = JSON.parse(new TextDecoder().decode(bytes)) as { place?: unknown }
      return hintPlaceOf(typeof record?.place === 'string' ? record.place : null)
    } catch { return null } // no record, or not ours: the default stands
  }
  return new Promise(resolve => {
    const container = ioc()
    const store = container?.get?.(STORE_KEY) as StoreLike | undefined
    if (store) void read(store).then(resolve)
    else if (container?.whenReady) container.whenReady(STORE_KEY, v => { void read(v as StoreLike).then(resolve) })
    else resolve(null)
  })
}
