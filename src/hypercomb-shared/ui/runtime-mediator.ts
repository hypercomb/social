// hypercomb-web/src/app/runtime-mediator.service.ts

import { DependencyLoader, LayerInstaller, Store } from '@hypercomb/shared/core'
import { type LocationParseResult } from '@hypercomb/shared/core/initializers/location-parser'

const INSTALL_CACHE_NAME = '__install_cache__.json'

// Push-only install model: only bootstrap when OPFS is empty or a prior install was interrupted.
// See documentation/install-push-only.md for the full design.
async function shouldBootstrap(domain: string): Promise<boolean> {
  const store = get('@hypercomb.social/Store') as Store
  try {
    const dir = await store.domainLayersDirectory(domain, false)
    let hasLayerFile = false
    let hasInstallCache = false
    for await (const name of (dir as any).keys()) {
      if (name === INSTALL_CACHE_NAME) hasInstallCache = true
      else hasLayerFile = true
    }
    if (!hasLayerFile) return true       // empty directory → genesis bootstrap
    if (hasInstallCache) return true     // interrupted install → resume
    return false                         // populated and complete → skip
  } catch {
    return true                          // directory doesn't exist → genesis bootstrap
  }
}

function resolveDomainKey(parsed: LocationParseResult): string | null {
  if (parsed?.domain) return parsed.domain
  const baseUrl = parsed?.baseUrl ?? ''
  if (!baseUrl) return null
  try { return new URL(baseUrl).hostname || null } catch { return null }
}

export class RuntimeMediator {

  private running: Promise<void> | null = null

  public sync = async (parsed: LocationParseResult): Promise<void> => {
    const run = async (): Promise<void> => {
      const installer = get('@hypercomb.social/LayerInstaller') as LayerInstaller
      const dependency = get('@hypercomb.social/DependencyLoader') as DependencyLoader

      // 1) install only on genesis (empty OPFS) or resume (interrupted prior install).
      //    Subsequent loads are inert — DCP pushes handle updates.
      const domainKey = resolveDomainKey(parsed)
      if (domainKey && await shouldBootstrap(domainKey)) {
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
