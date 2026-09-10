/** Three independent adventure saves. One localStorage replacement commits
 *  the active choice, slot payloads, and timestamps together. Payloads are
 *  opaque JSON snapshots; this service never changes their game semantics. */
export const SAVE_SLOTS_KEY = 'hc:solomon-adventure:slots:v2'
export const LEGACY_SAVE_KEY = 'hc:solomon-adventure:v1'
export const SAVE_SLOT_IDS = [1, 2, 3] as const
export type SaveSlotId = typeof SAVE_SLOT_IDS[number]

export interface SaveSlotSummary {
  id: SaveSlotId
  occupied: boolean
  updatedAt: number | null
}

export interface SaveSlotStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface SavedSlot<T> { updatedAt: number; payload: T }
interface SlotRecord<T> {
  version: 2
  activeSlot: SaveSlotId
  slots: Record<SaveSlotId, SavedSlot<T> | null>
}

const slotId = (value: unknown): value is SaveSlotId => value === 1 || value === 2 || value === 3
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const emptyRecord = <T>(): SlotRecord<T> => ({ version: 2, activeSlot: 1, slots: { 1: null, 2: null, 3: null } })
const clone = <T>(value: T): T => structuredClone(value)

function parseRecord<T>(raw: string): SlotRecord<T> {
  let record: unknown
  try { record = JSON.parse(raw) } catch { throw new Error('Saved adventures could not be read. Existing saves were left unchanged.') }
  if (!object(record) || record['version'] !== 2 || !slotId(record['activeSlot']) || !object(record['slots'])) {
    throw new Error('Saved adventures have an unsupported format. Existing saves were left unchanged.')
  }
  const slots = record['slots']
  if (Object.keys(slots).length !== SAVE_SLOT_IDS.length || SAVE_SLOT_IDS.some(id => !Object.hasOwn(slots, id))) {
    throw new Error('The save-slot record is incomplete. Existing saves were left unchanged.')
  }
  for (const id of SAVE_SLOT_IDS) {
    const slot = slots[id]
    if (slot === null) continue
    if (!object(slot) || !Object.hasOwn(slot, 'payload')
      || typeof slot['updatedAt'] !== 'number' || !Number.isFinite(slot['updatedAt']) || slot['updatedAt'] < 0) {
      throw new Error(`Save slot ${id} could not be read. Existing saves were left unchanged.`)
    }
  }
  return record as unknown as SlotRecord<T>
}

export class SaveSlotStore<T> {
  #snapshot: SlotRecord<T> = emptyRecord()
  #loadedOnce = false
  #error: string | null = null

  constructor(private readonly storage: SaveSlotStorage, private readonly now: () => number = Date.now) {
    try {
      const existing = storage.getItem(SAVE_SLOTS_KEY)
      if (existing !== null) {
        this.#snapshot = parseRecord<T>(existing)
        this.#loadedOnce = true
        return
      }
      // Even an empty record is persisted. Its presence is the migration
      // marker, so resetting all slots cannot resurrect the preserved v1 key.
      const initial = this.#legacyRecord()
      this.#snapshot = initial
      this.#loadedOnce = true
      this.#persist(initial)
    } catch (error) { this.#fail(error) }
  }

  get activeSlot(): SaveSlotId { return this.#snapshot.activeSlot }
  get error(): string | null { return this.#error }

  read(id: number = this.activeSlot): T | null {
    if (!slotId(id)) { this.#invalidSlot(); return null }
    const entry = this.#snapshot.slots[id]
    return entry === null ? null : clone(entry.payload)
  }

  list(): SaveSlotSummary[] {
    return SAVE_SLOT_IDS.map(id => ({
      id, occupied: this.#snapshot.slots[id] !== null,
      updatedAt: this.#snapshot.slots[id]?.updatedAt ?? null,
    }))
  }

  save(payload: T): boolean {
    // Bind the destination to this tab's selected slot at intent time. A
    // different tab selecting another slot must not redirect this adventure.
    const id = this.activeSlot
    return this.#change(record => {
      record.activeSlot = id
      record.slots[id] = { updatedAt: this.#timestamp(), payload }
    })
  }

  select(id: number): boolean {
    if (!slotId(id)) return this.#invalidSlot()
    return this.#change(record => { record.activeSlot = id })
  }

  reset(id: number): boolean {
    if (!slotId(id)) return this.#invalidSlot()
    const selected = this.activeSlot
    return this.#change(record => { record.activeSlot = selected; record.slots[id] = null })
  }

  #change(change: (record: SlotRecord<T>) => void): boolean {
    try {
      // Merge against the newest complete record, preserving other tabs'
      // writes to other slots. localStorage.setItem replaces one value
      // atomically; failures cannot leave a partly-written set of slots.
      const raw = this.storage.getItem(SAVE_SLOTS_KEY)
      const latest = raw !== null ? parseRecord<T>(raw)
        : this.#loadedOnce ? this.#snapshot : this.#legacyRecord()
      const candidate = clone(latest)
      change(candidate)
      return this.#persist(candidate)
    } catch (error) { return this.#fail(error) }
  }

  #legacyRecord(): SlotRecord<T> {
    const record = emptyRecord<T>()
    const legacy = this.storage.getItem(LEGACY_SAVE_KEY)
    if (legacy === null) return record
    let payload: T
    try { payload = JSON.parse(legacy) as T } catch {
      throw new Error('The previous adventure could not be read. Its original save was left unchanged.')
    }
    record.slots[1] = { updatedAt: this.#timestamp(), payload }
    return record
  }

  #persist(candidate: SlotRecord<T>): boolean {
    try {
      // Round-trip before writing, so an unserializable top-level payload
      // cannot create a record that this same reader would later reject.
      const encoded = JSON.stringify(candidate)
      const saved = parseRecord<T>(encoded)
      this.storage.setItem(SAVE_SLOTS_KEY, encoded)
      this.#snapshot = saved
      this.#loadedOnce = true
      this.#error = null
      return true
    } catch (error) { return this.#fail(error) }
  }

  #timestamp(): number {
    const value = this.now()
    if (!Number.isFinite(value) || value < 0) throw new Error('The save timestamp is unavailable. The previous save was kept.')
    return value
  }

  #invalidSlot(): false {
    this.#error = 'Choose save slot 1, 2, or 3.'
    return false
  }

  #fail(error: unknown): false {
    const named = error as { name?: unknown; message?: unknown } | null
    this.#error = named?.name === 'QuotaExceededError'
      ? 'Storage is full. Your last successful save was kept; new progress is not saved yet.'
      : named?.name === 'SecurityError' || named?.name === 'NotAllowedError'
        ? 'This browser is blocking save storage. Your last readable save was kept; new progress is not saved yet.'
        : typeof named?.message === 'string' ? named.message
          : 'The adventure could not be saved. Your last successful save was kept.'
    return false
  }
}
