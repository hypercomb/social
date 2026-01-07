// src/app/core/hive/resource-resolvers.token.ts

import { InjectionToken } from '@angular/core'
import { Signature } from 'src/app/hive/storage/hash.service'
// src/app/core/hive/resource.types.ts

export type ResourceType =
  | 'text'
  | 'link'
  | 'image'
  | 'portal'
  | 'script'
  | 'unknown'

export interface ResourceSchemaMap {
  //text: TextResourcePayload
  image: ImageResolverPayload
  // link: LinkResourcePayload
  // script: ScriptResourcePayload
}


export interface ImageResolverPayload extends ResourcePayload {
  type: 'image'
  mime: string
  bytesSignature: Signature
}


export interface ResourcePayload {
  type: ResourceType

  // optional graph expansion
  resources?: Signature[]

  // resolver-owned fields
  [key: string]: unknown
}

export interface IResourceResolver<TPayload extends ResourcePayload = ResourcePayload> {

  // declares whether this resolver handles the payload
  supports(type: ResourceType): boolean

  // performs resolution (pure, deterministic)
  resolve(
    signature: Signature,
    payload: TPayload
  ): Promise<void>
}

export const RESOURCE_RESOLVERS =
  new InjectionToken<ReadonlyArray<IResourceResolver>>('RESOURCE_RESOLVERS')
