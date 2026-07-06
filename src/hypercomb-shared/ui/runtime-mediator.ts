// hypercomb-web/src/app/runtime-mediator.service.ts

import { DependencyLoader, LayerInstaller, Store } from '@hypercomb/shared/core'
import { type LocationParseResult } from '@hypercomb/shared/core/initializers/location-parser'

// Push-only install model: only bootstrap on genesis (fresh OPFS or first
// visit). After that, updates come via DCP push notifications, not
// auto-fetch from hypercomb. See documentation/install-push-only.md.
//
// Genesis is keyed off the sign('bees') POOL (unioned with the legacy
// `__bees__` drain dir while it exists) plus the web shell's installed
// flag — NOT the retired `__layers__` dir, which is absent for everyone
// post-migration and would re-run the installer on every sync forever.
// An installed hive always holds at least one bee; an empty pool with a
// live legacy dir is mid-drain, not genesis.
async function shouldBootstrap(): Promise<boolean> {
  // Cheap short-circuit: the web shell stamps this on every successful
  // install/resync (ensure-install's INSTALLED_FLAG_KEY).
  try { if (localStorage.getItem('hypercomb.installed') === 'true') return false } catch { /* private mode */ }
  const store = get('@hypercomb.social/Store') as Store
  const hasEntry = async (dir: FileSystemDirectoryHandle | undefined): Promise<boolean> => {
    if (!dir) return false
    try {
      // Any presence means we've installed — skip re-bootstrap. Install
      // pipeline is idempotent so re-running it is safe, just wasted
      // bandwidth.
      for await (const _name of (dir as any).keys()) return true
    } catch { /* unreadable — treat as empty */ }
    return false
  }
  if (await hasEntry(store.bees)) return false
  if (await hasEntry(store.legacyBees)) return false
  return true   // nothing installed anywhere → genesis bootstrap
}

export class RuntimeMediator {

  private running: Promise<void> | null = null

  public sync = async (parsed: LocationParseResult): Promise<void> => {
    const run = async (): Promise<void> => {
      const installer = get('@hypercomb.social/LayerInstaller') as LayerInstaller
      const dependency = get('@hypercomb.social/DependencyLoader') as DependencyLoader

      // 1) install only on genesis (empty layer pool). Subsequent loads
      //    are inert — DCP pushes handle updates explicitly.
      if (await shouldBootstrap()) {
        await installer.install(parsed)
      }

      // 2) load dependencies into memory
      await dependency.load()

    }

    this.running = (this.running ?? Promise.resolve()).then(run, run)
    await this.running
  }
}

register('@hypercomb.social/RuntimeMediator', new RuntimeMediator())
