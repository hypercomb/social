// A visitor's verified choice waits here until this hive accepts it. Each
// publisher identity has a stable location in a private meaning pool; a new
// choice or decision appends a signed layer instead of erasing prior heads.
import { listCreations, readCreation, writeCreation,
  type CreationStore } from '@hypercomb/runtime/meaning-creations'

export const PENDING_SELECTIONS_MEANING = 'host:pending-selections'

export type PendingSiteSelection = {
  name: 'host:pending-selection'
  selected: boolean
  source: string
  route: string
  pubkey: string
  lineage: string
  head: string
}

export type PendingCreationSelection = {
  name: 'host:pending-selection'
  selected: boolean
  kind: 'creation'
  source: string
  pubkey: string
  meaning: string
  key: string
  location: string
  head: string
}

export type PendingSelection = PendingSiteSelection | PendingCreationSelection
export type SelectionReference = Omit<PendingSiteSelection, 'name' | 'selected'>
  | Omit<PendingCreationSelection, 'name' | 'selected'>

const SIG = /^[a-f0-9]{64}$/
const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d{1,5})?$/
const LOOPBACK = /^(?:[a-z0-9-]+\.)*localhost(?::\d{1,5})?$/

const valid = (ref: SelectionReference): boolean => {
  if (!HOST.test(ref.source) || !SIG.test(ref.pubkey) || !SIG.test(ref.head)) return false
  if ('kind' in ref) return ref.kind === 'creation' && SIG.test(ref.location)
    && typeof ref.meaning === 'string' && /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(ref.meaning)
    && typeof ref.key === 'string' && ref.key.length > 0 && ref.key.length <= 512
    && !/[\x00-\x1f\x7f]/.test(ref.key)
  if (typeof ref.lineage !== 'string' || ref.lineage.length > 512) return false
  try {
    const route = new URL(ref.route)
    return HOST.test(route.host) && route.href === `${route.origin}/`
      && !route.username && !route.password
      && (route.protocol === 'https:' || (route.protocol === 'http:' && LOOPBACK.test(route.host)))
  } catch { return false }
}

const keyOf = (ref: SelectionReference): string =>
  'kind' in ref ? JSON.stringify(['creation', ref.source, ref.pubkey, ref.meaning, ref.key])
    : JSON.stringify([ref.source, ref.pubkey, ref.lineage])

/** Latest signed layer at each stable location decides whether a choice waits. */
export const listPendingSelectionLayers = async (store: CreationStore): Promise<PendingSelection[]> => {
  const rows = await listCreations<PendingSelection>(store, PENDING_SELECTIONS_MEANING)
  return rows.flatMap(row => {
    const layer = row.layer
    return layer.name === 'host:pending-selection' && layer.selected === true
      && valid(layer) && row.key === keyOf(layer) ? [layer] : []
  })
}

export const stagePendingSelectionLayer = async (
  store: CreationStore, ref: SelectionReference,
): Promise<boolean> => {
  if (!valid(ref)) return false
  const layer: PendingSelection = { name: 'host:pending-selection', selected: true, ...ref }
  return !!await writeCreation(store, PENDING_SELECTIONS_MEANING, keyOf(ref), layer)
}

/** A delayed decision cannot clear a newer choice at the same location. */
export const clearPendingSelectionLayer = async (
  store: CreationStore, ref: SelectionReference,
): Promise<boolean> => {
  if (!valid(ref)) return false
  const current = await readCreation<PendingSelection>(store, PENDING_SELECTIONS_MEANING, keyOf(ref))
  if (!current || current.layer.name !== 'host:pending-selection'
    || current.layer.selected !== true || current.layer.head !== ref.head
    || current.layer.source !== ref.source || !valid(current.layer)
    || ('kind' in ref ? !('kind' in current.layer) || current.layer.location !== ref.location
      : 'kind' in current.layer || current.layer.route !== ref.route)) return false
  return !!await writeCreation(store, PENDING_SELECTIONS_MEANING, keyOf(ref),
    { ...current.layer, selected: false })
}
