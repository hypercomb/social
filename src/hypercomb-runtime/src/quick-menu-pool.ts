// Quick menus are local creations. The meaning pool names stable menu
// locations; each location's latest signed marker names the current menu.
// The registry is only a synchronous cache for the pointer gesture. Nothing
// read from this pool runs code: slots name existing commands, effects, menus,
// or keys, and external adoption is a separate review/activation step.
import { listCreations, writeCreation, type CreationHead, type CreationStore } from './meaning-creations'

export const QUICK_MENUS_MEANING = 'menus:quick'

type Direction = 'centre' | 'east' | 'southeast' | 'southwest' | 'west' | 'northwest' | 'northeast'
const DIRECTIONS = new Set<Direction>(['centre', 'east', 'southeast', 'southwest', 'west', 'northwest', 'northeast'])
const ACTIONS = new Set(['command', 'effect', 'menu', 'key'])
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const word = (value: unknown, limit = 120): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= limit

export type QuickMenuData = {
  readonly name: string
  readonly title: string
  readonly titleKey?: string
  readonly contexts: readonly string[]
  readonly slots: readonly {
    readonly direction: Direction
    readonly label: string
    readonly labelKey?: string
    readonly activation?: 'release' | 'arrive'
    readonly action:
      | { readonly kind: 'command'; readonly command: string; readonly args?: string }
      | { readonly kind: 'effect'; readonly effect: string; readonly payload?: unknown }
      | { readonly kind: 'menu'; readonly menu: string }
      | { readonly kind: 'key'; readonly key: string }
  }[]
}

type QuickMenuLayer = { name: 'quick-menu'; definition: QuickMenuData }
export type QuickMenuCache = {
  all(): readonly QuickMenuData[]
  register(definition: QuickMenuData): void
  setWriter(writer: ((definition: QuickMenuData) => Promise<QuickMenuData | null>) | null): void
}

/** Validate the entire data vocabulary before it enters the active cache. */
export const validQuickMenu = (value: unknown): value is QuickMenuData => {
  if (!plain(value)) return false
  const { name, title, titleKey, contexts, slots } = value
  if (!word(name) || !word(title) || (titleKey !== undefined && !word(titleKey))
      || !Array.isArray(contexts) || contexts.length > 32
      || !contexts.every(context => word(context))
      || !Array.isArray(slots) || slots.length < 1 || slots.length > 7) return false
  const directions = new Set<string>()
  for (const slot of slots) {
    if (!plain(slot)) return false
    const { direction, label, labelKey, activation, action } = slot
    if (!DIRECTIONS.has(direction as Direction)
        || directions.has(String(direction)) || !word(label)
        || (labelKey !== undefined && !word(labelKey))
        || (activation !== undefined && activation !== 'release' && activation !== 'arrive')
        || !plain(action) || !ACTIONS.has(String(action['kind']))) return false
    directions.add(String(direction))
    if (action['kind'] === 'command' && (!word(action['command']) ||
        (action['args'] !== undefined && typeof action['args'] !== 'string'))) return false
    if (action['kind'] === 'effect' && !word(action['effect'])) return false
    if (action['kind'] === 'menu' && !word(action['menu'])) return false
    if (action['kind'] === 'key' && !word(action['key'])) return false
  }
  return true
}

const menuOf = (row: CreationHead<QuickMenuLayer>): QuickMenuData | null =>
  row.layer.name === 'quick-menu' && validQuickMenu(row.layer.definition)
    && row.key === row.layer.definition.name ? row.layer.definition : null

/** Re-read verified heads after a local adoption or revision. */
export const refreshQuickMenus = async (
  store: CreationStore, cache: QuickMenuCache,
): Promise<readonly QuickMenuData[]> => {
  const found: QuickMenuData[] = []
  for (const row of await listCreations<QuickMenuLayer>(store, QUICK_MENUS_MEANING)) {
    const definition = menuOf(row)
    if (!definition) continue
    cache.register(definition)
    found.push(definition)
  }
  return found
}

/** Write first, then read through the verified location path. */
export const writeQuickMenu = async (
  store: CreationStore, definition: QuickMenuData,
): Promise<QuickMenuData | null> => {
  let data: unknown
  try { data = JSON.parse(JSON.stringify(definition)) } catch { return null }
  if (!validQuickMenu(data)) return null
  const layer: QuickMenuLayer = { name: 'quick-menu', definition: data }
  const row = await writeCreation(store, QUICK_MENUS_MEANING, data.name, layer)
  return row ? menuOf(row) : null
}

const pending = new WeakMap<CreationStore, Promise<void>>()

/** Seed the shipped menu vocabulary once, then use pool heads as authority.
 *  This is local storage only; publication and remote adoption are separate. */
export const initializeQuickMenuPool = (
  store: CreationStore, cache: QuickMenuCache,
): Promise<void> => {
  const underway = pending.get(store)
  if (underway) return underway
  const task = (async () => {
    const held = await listCreations<QuickMenuLayer>(store, QUICK_MENUS_MEANING)
    const existing = new Set(held.filter(row => menuOf(row)).map(row => row.key))
    for (const definition of cache.all()) {
      if (!existing.has(definition.name)) await writeQuickMenu(store, definition)
    }
    await refreshQuickMenus(store, cache)
    cache.setWriter(definition => writeQuickMenu(store, definition))
  })()
  pending.set(store, task)
  void task.catch(() => pending.delete(store))
  return task
}
