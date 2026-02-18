import { inject, Injectable } from '@angular/core'
import { environment } from '../../environments/environment'
import { Store } from '../store'
import { LocationParser } from './location-parser'
import type { IDomainInitializer } from './domain-initializer'

@Injectable({ providedIn: 'root' })
export class ServerInitializer implements IDomainInitializer {

    private readonly store = inject(Store)

    public enabled = async (_: string): Promise<boolean> => true

    public initialize = async (input: string): Promise<void> => {
        const parsed = LocationParser.parse(input)

        const layerDomain = await this.store.domainLayersDirectory(parsed.domain, true)
        const res = await fetch(`${input}/__layers__/${parsed.signature}.json`)

        if (!res.ok) throw new Error(`[server-initializer] failed to fetch layer: ${res.status} ${res.statusText}`)

        const handle = await layerDomain.getFileHandle(`${parsed.signature}-install`, { create: true })
        const writable = await handle.createWritable()
        try { await writable.write(await res.arrayBuffer()) } finally { await writable.close() }
    }
}
