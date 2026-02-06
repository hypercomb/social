// src/app/core/drone-payload-resolver.service.ts

import { Injectable, inject } from '@angular/core'
import { has } from '@hypercomb/core'
import { Store } from './store'

@Injectable({ providedIn: 'root' })
export class DronePayloadResolver {

  private readonly store = inject(Store)

  private static readonly DEFAULT_ORIGIN =
    'https://storagehypercomb.blob.core.windows.net/content'

  public ensure = async (signature: string): Promise<void> => {
    if (has(signature)) return

    const cached = await this.readCached(signature)
    if (cached) return

    const fetched = await this.fetch(signature)
    if (!fetched) return

    await this.writeCached(signature, fetched)
  }

  // ------------------------------

  private readCached = async (
    signature: string
  ): Promise<ArrayBuffer | null> => {
    try {
      const handle =
        await this.store.resourcesDirectory().getFileHandle(signature)
      const file = await handle.getFile()
      return await file.arrayBuffer()
    } catch {
      return null
    }
  }

  private writeCached = async (
    signature: string,
    bytes: ArrayBuffer
  ): Promise<void> => {

    const handle =
      await this.store.resourcesDirectory().getFileHandle(signature, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(bytes)
    } finally {
      await writable.close()
    }
  }

  private fetch = async (
    signature: string
  ): Promise<ArrayBuffer | null> => {

    const url =
      `${DronePayloadResolver.DEFAULT_ORIGIN}/__resources__/${signature}`

    const res = await fetch(url)
    if (!res.ok) return null

    return await res.arrayBuffer()
  }
}
