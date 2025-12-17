import { Injectable, inject } from '@angular/core'
import { HIVE_RESOLVERS, HIVE_LOADERS } from 'src/app/shared/tokens/i-hive-resolver.token'
import { HIVE_CONTROLLER_ST } from 'src/app/shared/tokens/i-hive-store.token'
import { IHiveLoader } from './hive-loader.base'
import { IHiveGuide } from '../resolvers/i-hive-resolver'
import { HiveScout } from '../hive-scout'
import { HIVE_HYDRATION } from 'src/app/shared/tokens/i-honeycomb-service.token'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { HivePortal } from 'src/app/models/hive-portal'

@Injectable({ providedIn: 'root' })
export class HiveLoader extends Hypercomb {

  private readonly controller = inject(HIVE_CONTROLLER_ST)
  private readonly resolvers = inject<IHiveGuide[]>(HIVE_RESOLVERS) ?? []
  private readonly loaders = inject<IHiveLoader[]>(HIVE_LOADERS) ?? []
  private readonly hydration = inject(HIVE_HYDRATION)

  private lastResolved: HiveScout | null = null

  // ─────────────────────────────────────────────
  // keep resolve() for external use
  // ─────────────────────────────────────────────
  public async resolve(hiveName: string): Promise<HiveScout> {

    if (hiveName && this.lastResolved?.name === hiveName) return this.lastResolved

    for (const resolver of this.resolvers) {
      if (await resolver.enabled(hiveName)) {
        const scout = await resolver.resolve(hiveName)
        if (scout) {
          this.lastResolved = scout
          this.debug.log('lifecycle', `[HiveLoader] resolved ${hiveName} via ${resolver.constructor.name}`)
          return scout
        }
      }
    }

    throw new Error(`Unable to resolve hive: ${hiveName}`)
  }

  // ─────────────────────────────────────────────
  // external: load hydrated data into memory
  // ─────────────────────────────────────────────
  public async load(scout: HiveScout) {
    for (const loader of this.loaders) {
      if (loader.enabled(scout)) {
        await loader.load(scout)
        this.hydration.setReady()
        this.debug.log('lifecycle', `[HiveLoader] loaded with ${loader.constructor.name}`)
        return
      }
    }
    this.debug.log('warn', `[HiveLoader] no matching loader for ${scout.type}`)
    return
  }

  // ─────────────────────────────────────────────
  // external: activate hive in controller
  // ─────────────────────────────────────────────
  public async activate(seed: string) {
    this.controller.setHive(seed)
    this.debug.log('lifecycle', `[HiveLoader] activated hive: ${this.state.hive()}`)
  }
}
