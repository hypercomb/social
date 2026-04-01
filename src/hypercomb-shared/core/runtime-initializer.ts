import { EffectBus } from '@hypercomb/core'
import type { Lineage } from './lineage'
import type { LocalizationService } from './i18n.service'
import type { Navigation } from './navigation'
import { OpfsTreeLogger } from './tree-logger'
import type { BootstrapHistory } from './bootstrap-history'
import { Store } from './store'

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
    const children = Array.isArray(parsed?.children)
      ? (parsed.children as unknown[]).map(c => String(c).trim()).filter(c => /^[a-f0-9]{64}$/i.test(c))
      : []
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

  // Load host translations for the i18n service
  const i18n = get('@hypercomb.social/I18n') as LocalizationService | undefined
  if (i18n) {
    try {
      const [en, ja] = await Promise.all([
        import('../i18n/en.json', { with: { type: 'json' } }),
        import('../i18n/ja.json', { with: { type: 'json' } }),
      ])
      i18n.registerTranslations('app', 'en', en.default)
      i18n.registerTranslations('app', 'ja', ja.default)
    } catch { /* translations unavailable — graceful degradation */ }
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