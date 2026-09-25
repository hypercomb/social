// Text themes are creations, not a fixed settings enum. Their membership is
// discovered from one meaning pool, and each hashed location's latest meta →
// layer head supplies the current revision. Settings consumes only that read.
import {
  CODE_FONTS, READ_FONTS, TEXT_THEME_SEEDS, registerTextTheme,
  replaceTextThemes,
  setTextThemeWriter, type TextTheme, type TextThemeDraft,
} from '@hypercomb/core'
import { listCreations, writeCreation, type CreationHead } from './meaning-creations'
import type { Store } from './store'

export const TEXT_THEMES_MEANING = 'themes:text'

type TextThemeLayer = {
  name: 'text-theme'
  label: string
  read: string
  code: string
  /** The revision this creation borrowed from, if any. */
  source?: string
}

export const isTextThemeLayer = (value: unknown): value is TextThemeLayer => {
  const layer = value as TextThemeLayer | null
  return layer?.name === 'text-theme' && typeof layer.label === 'string'
  && layer.label.trim().length > 0 && layer.label.length <= 80
  && READ_FONTS.some(face => face.key === layer.read)
  && CODE_FONTS.some(face => face.key === layer.code)
  && (layer.source === undefined || /^[a-f0-9]{64}$/.test(layer.source))
  && Object.keys(layer).every(key => ['name', 'label', 'read', 'code', 'source'].includes(key))
}

const valid = (layer: TextThemeLayer): boolean => isTextThemeLayer(layer)

const installed = new WeakSet<Store>()

/** Load discovered heads, seed the included examples, and attach the writer
 *  used by framework-free tool-window settings. Neither map nor seed is the
 *  authority once the pool is present. */
export const initializeTextThemePool = async (store: Store): Promise<void> => {
  if (installed.has(store)) return
  await store.initialize()
  if (!store.opfsAvailable) return
  const held = await listCreations<TextThemeLayer>(store, TEXT_THEMES_MEANING)
  const existing = new Set(held.map(row => row.key))
  for (const seed of TEXT_THEME_SEEDS) {
    if (existing.has(seed.key)) continue
    await writeCreation(store, TEXT_THEMES_MEANING, seed.key, {
      name: 'text-theme', label: seed.label, read: seed.read, code: seed.code,
    })
  }
  await refreshTextThemes(store)
  setTextThemeWriter(draft => createTextThemeInPool(store, draft))
  installed.add(store)
}

const registerHead = (row: CreationHead<TextThemeLayer>): TextTheme | null => {
  if (!valid(row.layer)) return null
  const theme = { key: row.key, label: row.layer.label, read: row.layer.read,
    code: row.layer.code, location: row.location, head: row.head }
  registerTextTheme(theme)
  return theme
}

/** Re-read the pool after a replication/adoption changes a location bag. */
export const refreshTextThemes = async (store: Store): Promise<readonly TextTheme[]> => {
  const found: TextTheme[] = []
  for (const row of await listCreations<TextThemeLayer>(store, TEXT_THEMES_MEANING)) {
    const theme = valid(row.layer) ? { key: row.key, label: row.layer.label,
      read: row.layer.read, code: row.layer.code, location: row.location, head: row.head } : null
    if (theme) found.push(theme)
  }
  replaceTextThemes(found)
  return found
}

/** Name the current reading/code pairing as a new creation. Borrowing keeps
 *  the source revision in the layer so inspection can show where it came from. */
export const createTextThemeInPool = async (
  store: Store, draft: TextThemeDraft,
): Promise<TextTheme | null> => {
  const label = String(draft.label ?? '').trim().slice(0, 80)
  const layer: TextThemeLayer = {
    name: 'text-theme', label, read: draft.read, code: draft.code,
    ...(draft.source && /^[a-f0-9]{64}$/.test(draft.source) ? { source: draft.source } : {}),
  }
  if (!valid(layer)) return null
  const key = crypto.randomUUID()
  const created = await writeCreation(store, TEXT_THEMES_MEANING, key, layer)
  if (!created) return null
  const theme = { key, label, read: layer.read, code: layer.code,
    location: created.location, head: created.head }
  registerTextTheme(theme)
  return theme
}
