import type { Lineage } from './lineage'
import type { Navigation } from './navigation'
import { OpfsTreeLogger } from './tree-logger'
import type { ScriptPreloader } from './script-preloader'
import { Store } from './store'

type PulseTarget = {
  pulse?: (reason: string) => Promise<void> | void
}

export type RuntimeInitializerOptions = {
  logOpfs?: boolean
  preloadBees?: boolean
  onMeshStateChange?: (enabled: boolean) => void
}

const STARTUP_PULSE_KEYS = [
  '@diamondcoreprocessor.com/PixiHostWorker',
  '@diamondcoreprocessor.com/ShowHoneycombWorker',
  '@diamondcoreprocessor.com/ZoomDrone',
  '@diamondcoreprocessor.com/PanningDrone',
  '@diamondcoreprocessor.com/TileOverlayDrone',
] as const

export const initializeRuntime = async (
  options: RuntimeInitializerOptions = {},
): Promise<void> => {
  const {
    logOpfs = false,
    preloadBees = true,
    onMeshStateChange,
  } = options

  if (logOpfs) {
    const logger = get('@hypercomb.social/OpfsTreeLogger') as OpfsTreeLogger | undefined
    await logger?.log?.()
  }

  const store = get('@hypercomb.social/Store') as Store | undefined
  await store?.initialize?.()

  if (preloadBees) {
    const preloader = get('@hypercomb.social/ScriptPreloader') as ScriptPreloader | undefined
    await preloader?.preload?.()
  }

  const lineage = get('@hypercomb.social/Lineage') as Lineage | undefined
  await lineage?.initialize?.()

  const navigation = get('@hypercomb.social/Navigation') as Navigation | undefined
  const segments = navigation?.segments().filter(Boolean) ?? []
  navigation?.bootstrap?.(segments)

  console.log('[runtime-initializer] ioc keys:', list())

  for (const key of STARTUP_PULSE_KEYS) {
    const target = get(key) as PulseTarget | undefined
    await target?.pulse?.('testing')
  }

  const mesh = get('@diamondcoreprocessor.com/NostrMeshWorker') as any
  if (!mesh) {
    console.warn('[runtime-initializer] NostrMeshWorker not found')
    return
  }

  await mesh.pulse?.('smoke-test')

  try {
    onMeshStateChange?.(!!mesh.isNetworkEnabled?.())
  } catch {
    // ignore mesh state probe failures
  }
}