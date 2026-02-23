// hypercomb-web/src/app/runtime-mediator.service.ts

import { Injectable } from '@angular/core'
import { DependencyLoader, LayerInstaller } from '@hypercomb/shared/core'
import { type LocationParseResult } from '@hypercomb/shared/core/initializers/location-parser'
import { VisualUpdateService } from '@hypercomb/shared/core/visual-update.service'

@Injectable({ providedIn: 'root' })
export class RuntimeMediator {

  private running: Promise<void> | null = null

  public sync = async (parsed: LocationParseResult): Promise<void> => {
    const run = async (): Promise<void> => {
      const { get } = window.ioc

      const installer = get('LayerInstaller') as LayerInstaller
      const dependency = get('DependencyLoader') as DependencyLoader
      const visualUpdates = get('VisualUpdateService') as VisualUpdateService

      // 1) download + install all files via install.manifest.json (resumable)
      await installer.install(parsed)

      // 2) load dependencies into memory
      await dependency.load()

      // 3) load drones into memory is handled by script-preloader (boot phase)
      visualUpdates.notifyChange('runtime:sync')
    }

    this.running = (this.running ?? Promise.resolve()).then(run, run)
    await this.running
  }
}

const { register } = window.ioc
register('RuntimeMediator', new RuntimeMediator())
