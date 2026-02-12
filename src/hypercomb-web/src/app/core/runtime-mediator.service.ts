// hypercomb-web/src/app/core/runtime-mediator.service.ts

import { Injectable, inject } from '@angular/core'
import { DependencyLoader } from './dependency-loader'
import { LayerInstaller } from './layer-installer'
// import { LayerRestorationService } from './layer-restoration.service'
import { DomainInitializer } from './initializers/domain-initializer'
import { DevManifest } from './store'

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
      await this.initializer.initialize(manifest)
      await this.installer.install(manifest)
      // await this.restoration.restore()
      await this.dependency.load()
    }

    this.running = (this.running ?? Promise.resolve()).then(run, run)
    await this.running
  }
}
