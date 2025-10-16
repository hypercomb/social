import { Injectable, inject } from '@angular/core'
import { HIVE_NAME_RESOLVERS, HIVE_DATA_RESOLVERS } from 'src/app/shared/tokens/i-hive-resolver.token'
import { HIVE_CONTROLLER_ST, HIVE_STORE } from 'src/app/shared/tokens/i-hive-store.token'
import { IHiveLoader } from '../data-resolvers/i-data-resolver'
import { IHiveGuide } from './i-hive-resolver'
import { HiveScout } from '../hive-scout'
import { HIVE_HYDRATION } from 'src/app/shared/tokens/i-comb-service.token'
import { IDexieHive } from '../hive-models'
import { ServiceBase } from 'src/app/core/mixins/abstraction/service-base'
import { CarouselService } from 'src/app/common/carousel-menu/carousel-service'

@Injectable({ providedIn: 'root' })
export class HiveLoader extends ServiceBase {

  private readonly controller = inject(HIVE_CONTROLLER_ST)
  private readonly resolvers = inject<IHiveGuide[]>(HIVE_NAME_RESOLVERS) ?? []
  private readonly loaders = inject<IHiveLoader[]>(HIVE_DATA_RESOLVERS) ?? []
  private readonly hydration = inject(HIVE_HYDRATION)
  private readonly store = inject(HIVE_STORE)
  private readonly carousel = inject(CarouselService)
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
          console.debug(`[HiveLoader] resolved ${hiveName} via ${resolver.constructor.name}`)
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
    if (result) console.debug(`[HiveLoader] hydrated ${scout.name}`)
    this.hydration.setReady()
  }

  // ─────────────────────────────────────────────
  // external: activate hive in controller
  // ─────────────────────────────────────────────
  public async activate(scout: HiveScout): Promise<void> {
    const found = scout.hive!
    if(!found) {
      console.warn('[HiveLoader] cannot activate, no hive on scout', { scout })
      return
    }

  console.debug('[HiveLoader] calling setHive', { found })
    this.controller.setHive(found)
    this.carousel.jumpTo(found.hive)

    if (!found) {
      console.warn('[HiveLoader] no hive available to activate')
      return
    }


    this.carousel.jumpTo(found.hive)

    this.debug.log("startup", `[HiveLoader] activated hive: ${found.name}`)
  }

  // ─────────────────────────────────────────────
  // internal: match data loader by type
  // ─────────────────────────────────────────────
  private async hydrate(scout: HiveScout): Promise<IDexieHive | null> {
    for (const loader of this.loaders) {
      if (loader.enabled(scout)) {
        const hive = await loader.load(scout)
        console.debug(`[HiveLoader] loaded with ${loader.constructor.name}`)
        return hive
      }
    }
    console.warn(`[HiveLoader] no matching loader for ${scout.type}`)
    return null
  }

}
