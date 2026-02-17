// hypercomb-web/src/app/core/runtime-mediator.service.ts

import { Injectable, inject } from '@angular/core'
import { DependencyLoader, LayerInstaller, type DevManifest } from '@hypercomb/shared/core'

// import { LayerRestorationService } from './layer-restoration.service'
import { DomainInitializer } from '@hypercomb/shared/core'


@Injectable({ providedIn: 'root' })
export class RuntimeMediator {

  private readonly DEV_MANIFEST_URL = '/dev/name.manifest.js'
  private readonly initializer = inject(DomainInitializer)
  private readonly installer = inject(LayerInstaller)
  // private readonly restoration = inject(LayerRestorationService)
  private readonly dependency = inject(DependencyLoader)

  private running: Promise<void> | null = null

  public sync = async (): Promise<void> => {
    const run = async (): Promise<void> => {
      const manifest = <DevManifest>await import(/* @vite-ignore */ this.DEV_MANIFEST_URL)
      await this.dependency.load()
      await this.initializer.initialize(manifest)
      await this.installer.install(manifest)
      // await this.restoration.restore()
    }

    this.running = (this.running ?? Promise.resolve()).then(run, run)
    await this.running
  }
}
