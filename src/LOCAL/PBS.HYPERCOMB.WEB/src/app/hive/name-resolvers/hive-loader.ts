import { Injectable, inject } from '@angular/core'
import { HIVE_NAME_RESOLVERS, HIVE_LOADERS } from 'src/app/shared/tokens/i-hive-resolver.token'
import { HIVE_CONTROLLER_ST } from 'src/app/shared/tokens/i-hive-store.token'
import { IHiveLoader } from '../hive-loaders/i-data-resolver'
import { IHiveGuide } from './i-hive-resolver'
import { HiveScout } from '../hive-scout'
import { HIVE_HYDRATION } from 'src/app/shared/tokens/i-comb-service.token'
import { IDexieHive } from '../hive-models'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { CAROUSEL_SVC } from 'src/app/shared/tokens/i-hypercomb.token'

@Injectable({ providedIn: 'root' })
export class HiveLoader extends Hypercomb {

  private readonly controller = inject(HIVE_CONTROLLER_ST)
  private readonly resolvers = inject<IHiveGuide[]>(HIVE_NAME_RESOLVERS) ?? []
  private readonly loaders = inject<IHiveLoader[]>(HIVE_LOADERS) ?? []
  private readonly hydration = inject(HIVE_HYDRATION)
  private readonly carousel = inject(CAROUSEL_SVC)
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
  public async load(scout: HiveScout): Promise<void> {
    const result = await this.hydrate(scout)
    if (result) {
      this.debug.log('lifecycle', `[HiveLoader] hydrated ${scout.name}`)
    }
    this.hydration.setReady()
  }

  // ─────────────────────────────────────────────
  // external: activate hive in controller
  // ─────────────────────────────────────────────
  public async activate(scout: HiveScout): Promise<void> {
    const found = scout.hive!
    if (!found) {
      this.debug.log('warn', '[HiveLoader] cannot activate, no hive on scout', { scout })
      return
    }
    this.debug.log('lifecycle', '[HiveLoader] calling setHive', { found })
    this.controller.setHive(found)
    this.carousel.jumpTo(found.hive)

    if (!found) {
      this.debug.log('warn', '[HiveLoader] no hive available to activate')
      return
    }

    this.carousel.jumpTo(found.hive)
    this.debug.log('lifecycle', `[HiveLoader] activated hive: ${found.name}`)
  }

  // ─────────────────────────────────────────────
  // internal: match data loader by type
  // ─────────────────────────────────────────────
  private async hydrate(scout: HiveScout): Promise<IDexieHive | null> {
    for (const loader of this.loaders) {
      if (loader.enabled(scout)) {
        const hive = await loader.load(scout)
        this.debug.log('lifecycle', `[HiveLoader] loaded with ${loader.constructor.name}`)
        return hive
      }
    }
    this.debug.log('warn', `[HiveLoader] no matching loader for ${scout.type}`)
    return null
  }

}
