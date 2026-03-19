import { EffectBus } from '@hypercomb/core'
import type { Lineage } from './lineage'
import type { Navigation } from './navigation'
import { OpfsTreeLogger } from './tree-logger'
import type { BootstrapHistory } from './bootstrap-history'
import { Store } from './store'

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

  const lineage = get('@hypercomb.social/Lineage') as Lineage | undefined
  await lineage?.initialize?.()

  const navigation = get('@hypercomb.social/Navigation') as Navigation | undefined
  navigation?.listen?.()

  // Walk the seed tree from root to current URL, loading markers at each depth.
  // encounter() calls find() → reads markers → loads bees → pulses them.
  const history = get('@hypercomb.social/BootstrapHistory') as BootstrapHistory | undefined
  await history?.run?.()

  console.log('[runtime-initializer] ioc keys:', list())

  // restore persisted pivot state — emitted here so bees are already loaded
  if (localStorage.getItem('hc:hex-pivot') === 'true') {
    EffectBus.emit('render:set-pivot', { pivot: true })
  }

  // Probe mesh state for UI toggle
  const mesh = get('@diamondcoreprocessor.com/NostrMeshWorker') as any
  if (mesh) {
    try {
      onMeshStateChange?.(!!mesh.isNetworkEnabled?.())
    } catch {
      // ignore mesh state probe failures
    }
  }
}