import { InjectionToken } from '@angular/core'
import { Signature } from '../hash.service'


export type ResourceType =
  | 'text'
  | 'link'
  | 'image'
  | 'portal'
  | 'script'
  | 'unknown'

export interface ResourceSchemaMap {
  image: ImageResolverPayload
}

export interface ResourcePayload {
  type: ResourceType

  // optional graph expansion
  resources?: Signature[]

  // resolver-owned fields
  [key: string]: unknown
}

export interface ImageResolverPayload extends ResourcePayload {
  type: 'image'
  mime: string
  bytesSignature: Signature
}

export interface IResourceResolver<TPayload extends ResourcePayload = ResourcePayload> {
  supports(type: ResourceType): boolean

  resolve(
    signature: Signature,
    payload: TPayload
  ): Promise<void>
}

export const RESOURCE_RESOLVERS =
  new InjectionToken<ReadonlyArray<IResourceResolver>>('RESOURCE_RESOLVERS')
