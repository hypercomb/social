// hypercomb-web/src/app/core/initializers/dev-initializer.service.ts

import { inject, Injectable } from '@angular/core'
import { environment } from '../../../environments/environment'

import { Store } from '../store'
import { IDomainInitializer } from './domain-initializer'
import { LocationParser } from './location-parser'

@Injectable({ providedIn: 'root' })
export class DevInitializer implements IDomainInitializer {

  private readonly store = inject(Store)

  public enabled = async (_: string): Promise<boolean> => environment.production === false

  public initialize = async (input: string): Promise<void> => {
    const parsed = LocationParser.parse(input)

    // create the domain directory inside layers
    const domainLayers = await this.store.domainLayersDirectory(parsed.domain, true)

    const handle = await domainLayers.getFileHandle(`${parsed.signature}-install`, { create: true })
    const existing = await handle.getFile()
    if (existing.size > 0) return

    const path = `/dev/${parsed.domain}${parsed.path}.json`
    const res = await fetch(path)

    if (!res.ok) throw new Error(`[dev-initializer] failed to fetch layer: ${res.status} ${res.statusText}`)
        
    const writable = await handle.createWritable()

    try {
      await writable.write(await res.arrayBuffer())
    } finally {
      await writable.close()
    }
  }
}
