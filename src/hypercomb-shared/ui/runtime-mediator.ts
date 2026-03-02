// hypercomb-web/src/app/runtime-mediator.service.ts

import { DependencyLoader, LayerInstaller } from '@hypercomb/shared/core'
import { type LocationParseResult } from '@hypercomb/shared/core/initializers/location-parser'

export class RuntimeMediator {

  private running: Promise<void> | null = null

  public sync = async (parsed: LocationParseResult): Promise<void> => {
    const run = async (): Promise<void> => {
      const installer = get('LayerInstaller') as LayerInstaller
      const dependency = get('DependencyLoader') as DependencyLoader

      // 1) download + install all files via install.manifest.json (resumable)
      await installer.install(parsed)

      // 2) load dependencies into memory
      await dependency.load()

    }

    this.running = (this.running ?? Promise.resolve()).then(run, run)
    await this.running
  }
}

register('@hypercomb.social/RuntimeMediator', new RuntimeMediator(), 'RuntimeMediator')
