// src/app/core/locator/locator-router.ts

import { inject, Injectable } from '@angular/core'
import { OpfsLocator } from './opfs.locator'
import { WindowsLocator } from './windows.locator'
import { Locator } from './locator'
import { LocationRef } from './location-ref'

@Injectable({ providedIn: 'root' })
export class LocatorRouter {

    private readonly opfs = inject(OpfsLocator)
    private readonly windows = inject(WindowsLocator)

    public resolve = async (
        ref: LocationRef
    ): Promise<FileSystemHandle | null> => {

        switch (ref.scheme) {
            case 'opfs':
                return this.opfs.resolve(ref.path)

            case 'windows':
                return this.windows.resolve(ref.path)

            default:
                return null
        }
    }
}
