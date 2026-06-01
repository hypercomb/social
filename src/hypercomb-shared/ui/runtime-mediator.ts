// hypercomb-web/src/app/runtime-mediator.service.ts

import { DependencyLoader, LayerInstaller, Store } from '@hypercomb/shared/core'
import { type LocationParseResult } from '@hypercomb/shared/core/initializers/location-parser'

// Push-only install model: only bootstrap when the local layer pool is
// empty (genesis case — fresh OPFS or first visit). After that, updates
// come via DCP push notifications, not auto-fetch from hypercomb.
// See documentation/install-push-only.md for the full design.
async function shouldBootstrap(): Promise<boolean> {
  const store = get('@hypercomb.social/Store') as Store
  if (!store.layers) return true
  try {
    // Any presence in the pool means we've installed (and possibly the
    // user has committed) — skip re-bootstrap. Install pipeline is
    // idempotent so re-running it is safe, just wasted bandwidth.
    for await (const _name of (store.layers as any).keys()) {
      return false
    }
    return true   // empty pool → genesis bootstrap
  } catch {
    return true   // pool unreachable → bootstrap and let install handle it
  }
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
