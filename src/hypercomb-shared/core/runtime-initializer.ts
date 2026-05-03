import { EffectBus } from '@hypercomb/core'
import type { Lineage } from './lineage'
import type { LocalizationService } from './i18n.service'
import type { Navigation } from './navigation'
import { OpfsTreeLogger } from './tree-logger'
import './install-monitor'
import type { BootstrapHistory } from './bootstrap-history'
import { Store } from './store'
import { materializeStructure } from './structure-materializer'

// ─── layer tree materialization ───────────────────────────────────────────────
// After a sentinel or local install the layer JSON files land in
// __layers__/<domain>/<sig> but the tile directories under hypercomb.io/ are
// never created.  This step walks the layer tree and creates those directories
// so ShowCellDrone has something to render on first boot.

type LayerNode = { name: string; children: string[] }

const readLayerNode = async (
  dir: FileSystemDirectoryHandle,
  sig: string,
): Promise<LayerNode | null> => {
  try {
    const handle = await dir.getFileHandle(sig)
    const file = await handle.getFile()
    const parsed = JSON.parse(await file.text())
    const name = String(parsed?.name ?? '').trim()
    // Child layer sigs live under `cells` — same primitive name as
    // the slim hypercomb.io layer. Accept legacy `layers`/`children`
    // as fallbacks during the transition.
    const rawChildren = Array.isArray(parsed?.cells) ? parsed.cells
      : Array.isArray(parsed?.layers) ? parsed.layers
      : Array.isArray(parsed?.children) ? parsed.children
      : []
    const children = (rawChildren as unknown[])
      .map(c => String(c).trim())
      .filter(c => /^[a-f0-9]{64}$/i.test(c))
    if (!name) return null
    return { name, children }
  } catch {
    return null
  }
}

const applyLayerToDir = async (
  targetDir: FileSystemDirectoryHandle,
  layer: LayerNode,
  layerMap: Map<string, LayerNode>,
  depth: number = 0,
): Promise<void> => {
  if (depth > 8) return // guard against unexpectedly deep trees
  for (const childSig of layer.children) {
    const childLayer = layerMap.get(childSig)
    if (!childLayer?.name) continue
    try {
      const childDir = await targetDir.getDirectoryHandle(childLayer.name, { create: true })
      if (childLayer.children.length > 0) {
        await applyLayerToDir(childDir, childLayer, layerMap, depth + 1)
      }
    } catch { /* skip individual failures */ }
  }
}

const materializeInstalledLayers = async (store: Store): Promise<void> => {
  try {
    const raw = localStorage.getItem('core-adapter.installed-manifest')
    if (!raw) return

    let manifest: unknown
    try { manifest = JSON.parse(raw) } catch { return }

    const layerSigs: string[] = Array.isArray((manifest as any)?.layers)
      ? ((manifest as any).layers as unknown[]).map(s => String(s)).filter(s => /^[a-f0-9]{64}$/i.test(s))
      : []
    if (!layerSigs.length) return

    // Skip if hypercomb.io/ already has tile directories
    for await (const [, handle] of store.hypercombRoot.entries()) {
      if (handle.kind === 'directory') return
    }

    // Find which domain directory holds these layer files
    let layerDir: FileSystemDirectoryHandle | null = null
    for (const domain of ['sentinel', 'local']) {
      try {
        const candidate = await store.domainLayersDirectory(domain)
        await candidate.getFileHandle(layerSigs[0])
        layerDir = candidate
        break
      } catch { /* try next domain */ }
    }
    if (!layerDir) return

    // Parse all layer nodes
    const layerMap = new Map<string, LayerNode>()
    for (const sig of layerSigs) {
      const node = await readLayerNode(layerDir, sig)
      if (node) layerMap.set(sig, node)
    }
    if (!layerMap.size) return

    // Root = the layer sig not referenced as a child of any other
    const allChildSigs = new Set<string>()
    for (const { children } of layerMap.values()) {
      for (const c of children) allChildSigs.add(c)
    }
    const rootSig = layerSigs.find(sig => layerMap.has(sig) && !allChildSigs.has(sig))
    if (!rootSig) return

    // The slim meta-root (built with name `"root"` when the layer has no
    // rel path of its own) groups domain wrappers — its children are
    // namespaces like `miro.com` and `diamondcoreprocessor.com`, not
    // user-content tiles. Iterating it would write one tile dir per
    // domain into hypercomb.io/. User content tiles only live under a
    // real domain root, so bail when the root is the meta-root.
    if (layerMap.get(rootSig)!.name === 'root') return

    await applyLayerToDir(store.hypercombRoot, layerMap.get(rootSig)!, layerMap)
    console.log('[runtime-initializer] materialized layer tree into hypercomb.io/')
  } catch (err) {
    console.warn('[runtime-initializer] layer materialization failed (non-fatal):', err)
  }
}
// ──────────────────────────────────────────────────────────────────────────────

export type RuntimeInitializerOptions = {
  logOpfs?: boolean
  onMeshStateChange?: (enabled: boolean) => void
}

export const initializeRuntime = async (
  options: RuntimeInitializerOptions = {},
): Promise<void> => {
  const {
    logOpfs = false,
    onMeshStateChange,
  } = options

  if (logOpfs) {
    const logger = get('@hypercomb.social/OpfsTreeLogger') as OpfsTreeLogger | undefined
    await logger?.log?.()
  }

  const store = get('@hypercomb.social/Store') as Store | undefined
  await store?.initialize?.()

  // Materialize layer tree → tile directories in hypercomb.io/ (no-op if tiles already exist)
  if (store) await materializeInstalledLayers(store)

  // Materialize install structure tree → __structure__/ for program inspection
  if (store) await materializeStructure(store)

  // Load host translations for the i18n service
  const i18n = get('@hypercomb.social/I18n') as LocalizationService | undefined
  if (i18n) {
    try {
      const [en, ja, zh, es, ar, pt, fr, de, ko, ru, hi, id, tr, it] = await Promise.all([
        import('../i18n/en.json', { with: { type: 'json' } }),
        import('../i18n/ja.json', { with: { type: 'json' } }),
        import('../i18n/zh.json', { with: { type: 'json' } }),
        import('../i18n/es.json', { with: { type: 'json' } }),
        import('../i18n/ar.json', { with: { type: 'json' } }),
        import('../i18n/pt.json', { with: { type: 'json' } }),
        import('../i18n/fr.json', { with: { type: 'json' } }),
        import('../i18n/de.json', { with: { type: 'json' } }),
        import('../i18n/ko.json', { with: { type: 'json' } }),
        import('../i18n/ru.json', { with: { type: 'json' } }),
        import('../i18n/hi.json', { with: { type: 'json' } }),
        import('../i18n/id.json', { with: { type: 'json' } }),
        import('../i18n/tr.json', { with: { type: 'json' } }),
        import('../i18n/it.json', { with: { type: 'json' } }),
      ])
      i18n.registerTranslations('app', 'en', en.default)
      i18n.registerTranslations('app', 'ja', ja.default)
      i18n.registerTranslations('app', 'zh', zh.default)
      i18n.registerTranslations('app', 'es', es.default)
      i18n.registerTranslations('app', 'ar', ar.default)
      i18n.registerTranslations('app', 'pt', pt.default)
      i18n.registerTranslations('app', 'fr', fr.default)
      i18n.registerTranslations('app', 'de', de.default)
      i18n.registerTranslations('app', 'ko', ko.default)
      i18n.registerTranslations('app', 'ru', ru.default)
      i18n.registerTranslations('app', 'hi', hi.default)
      i18n.registerTranslations('app', 'id', id.default)
      i18n.registerTranslations('app', 'tr', tr.default)
      i18n.registerTranslations('app', 'it', it.default)
    } catch { /* translations unavailable — graceful degradation */ }

    // User override layer — a single JSON file in OPFS whose shape is
    //   { "<locale>": { "<key>": "<value>", ... }, ... }
    // Loaded after defaults so savvy users/consumers can shadow any key
    // without editing the shipped catalogs. The file is plain bytes — it
    // can be edited, exported, shared, or signed like any other resource.
    try {
      const root = await navigator.storage.getDirectory()
      const overridesDir = await root.getDirectoryHandle('overrides', { create: false }).catch(() => null)
      const fileHandle = await overridesDir?.getFileHandle('i18n.json', { create: false }).catch(() => null)
      if (fileHandle) {
        const file = await fileHandle.getFile()
        const json = JSON.parse(await file.text()) as Record<string, Record<string, string>>
        for (const [locale, catalog] of Object.entries(json)) {
          if (catalog && typeof catalog === 'object') {
            i18n.registerOverrides('app', locale, catalog)
          }
        }
      }
    } catch { /* no overrides file or malformed — ignore silently */ }
  }

  const lineage = get('@hypercomb.social/Lineage') as Lineage | undefined
  await lineage?.initialize?.()

  const navigation = get('@hypercomb.social/Navigation') as Navigation | undefined
  navigation?.listen?.()

  // Walk the cell tree from root to current URL, loading markers at each depth.
  // encounter() calls find() → reads markers → loads bees → pulses them.
  const history = get('@hypercomb.social/BootstrapHistory') as BootstrapHistory | undefined
  await history?.run?.()

  // console.log('[runtime-initializer] ioc keys:', list())

  // pivot: restore persisted state + handle toggle command
  let pivotOn = localStorage.getItem('hc:hex-pivot') === 'true'
  if (pivotOn) {
    EffectBus.emit('render:set-pivot', { pivot: true })
  }
  EffectBus.on<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
    if (cmd !== 'render.togglePivot') return
    pivotOn = !pivotOn
    localStorage.setItem('hc:hex-pivot', String(pivotOn))
    EffectBus.emit('render:set-pivot', { pivot: pivotOn })
  })

  // mesh: toggle public/private on keymap command
  EffectBus.on<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
    if (cmd !== 'mesh.togglePublic') return
    const current = localStorage.getItem('hc:mesh-public') === 'true'
    const next = !current
    localStorage.setItem('hc:mesh-public', String(next))
    const mesh = get('@diamondcoreprocessor.com/NostrMeshDrone') as any
    mesh?.setNetworkEnabled?.(next, true)
    EffectBus.emit('mesh:public-changed', { public: next })
  })

  // Probe mesh state for UI toggle
  const mesh = get('@diamondcoreprocessor.com/NostrMeshDrone') as any
  if (mesh) {
    try {
      onMeshStateChange?.(!!mesh.isNetworkEnabled?.())
    } catch {
      // ignore mesh state probe failures
    }
  }
}