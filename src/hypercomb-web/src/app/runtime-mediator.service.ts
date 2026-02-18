// hypercomb-web/src/app/core/runtime-mediator.service.ts

import { Injectable } from '@angular/core'
import { DependencyLoader, LayerInstaller } from '@hypercomb/shared/core'
import { type LocationParseResult } from '@hypercomb/shared/core/initializers/location-parser'
import { LayerService } from './layer-service'


@Injectable({ providedIn: 'root' })
export class RuntimeMediator {

  private running: Promise<void> | null = null

  public sync = async (parsed: LocationParseResult): Promise<void> => {
    const run = async (): Promise<void> => {
      const { get } = window.ioc

      const layersvc = get('LayerService') as LayerService
      const installer = get('LayerInstaller') as LayerInstaller
      const dependency = get('DependencyLoader') as DependencyLoader

      // step 1: materialize the root layer into opfs (mechanical fetch-on-miss)
      const layer = await layersvc.get(parsed, parsed.signature)

      // step 2: install drones + dependencies for any discovered layers
      await installer.install(parsed)

      // step 3: load dependency graph now that new modules exist in opfs
      await dependency.load()
    }

    this.running = (this.running ?? Promise.resolve()).then(run, run)
    await this.running
  }
}


window.ioc.register('RuntimeMediator', new RuntimeMediator())
