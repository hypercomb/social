// hypercomb-legacy/src/app/core/resources/cell-image-resolver.ts

import { inject, Injectable } from '@angular/core'
import { Signature } from 'src/app/hive/storage/hash.service'
import {
  IResourceResolver,
  ResourceType,
  ImageResolverPayload
} from '../hive/i-resource-resolver.token'
import { Settings } from '../settings'

/*
image resource resolver
-----------------------
- resolves image resources from signed payloads
- payload is authoritative
- may emit nested resource signatures (bytes, thumbnails, profiles)
- no guessing, no filenames, no extensions
*/

@Injectable({ providedIn: 'root' })
export class CellImageResolver implements IResourceResolver<ImageResolverPayload> {
  private readonly settings = inject(Settings)

  public supports(type: ResourceType): boolean {
    return type === 'image'
  }

  public async resolve(
    signature: Signature,
    payload: ImageResolverPayload
  ): Promise<void> {
    // payload is now strongly typed
    const {
      mime,
      bytesSignature
    } = payload

    if (!bytesSignature) return

    // register image metadata in runtime cache / view layer
    // example:
    // imageCache.register(signature, {
    //   mime,
    //   width,
    //   height,
    //   bytes: bytesSignature,
    // })

    // nested resources (thumbnails, profiles, derivatives)
    // are handled by the orchestrator via payload.resources
  }
}
