// // hypercomb-web/src/app/core/drone-payload-resolver.service.ts

// import { Injectable, inject } from '@angular/core'
// import { has } from '@hypercomb/core'
// import { Store } from './store'

// @Injectable({ providedIn: 'root' })
// export class DronePayloadResolver {

//   private readonly store = inject(Store)

//   public ensure = async (location: string, signature: string): Promise<void> => {
//     if (has(signature)) return

//     const cached = await this.readCached(signature)
//     if (cached) return

//     // prefer the old worker path (dev cache-first, prod opfs fallback)
//     const workerBytes = await this.fetchFromWorker(signature)
//     if (workerBytes) {
//       await this.writeCached(signature, workerBytes)
//       return
//     }

//     // fallback: direct domain fetch (prod install base)
//     const fetched = await this.fetchFromLocation(location, signature)
//     if (!fetched) return

//     await this.writeCached(signature, fetched)
//   }

//   // ------------------------------

//   private readCached = async (
//     signature: string
//   ): Promise<ArrayBuffer | null> => {
//     try {
//       const handle =
//         await this.store.resourcesDirectory().getFileHandle(signature)
//       const file = await handle.getFile()
//       return await file.arrayBuffer()
//     } catch {
//       return null
//     }
//   }

//   private writeCached = async (
//     signature: string,
//     bytes: ArrayBuffer
//   ): Promise<void> => {

//     const handle =
//       await this.store.resourcesDirectory().getFileHandle(signature, { create: true })
//     const writable = await handle.createWritable()
//     try {
//       await writable.write(bytes)
//     } finally {
//       await writable.close()
//     }
//   }

//   private fetchFromWorker = async (signature: string): Promise<ArrayBuffer | null> => {
//     try {
//       const res = await fetch(`/opfs/__drones__/${signature}`)
//       if (!res.ok) return null
//       return await res.arrayBuffer()
//     } catch {
//       return null
//     }
//   }

//   private fetchFromLocation = async (
//     location: string,
//     signature: string
//   ): Promise<ArrayBuffer | null> => {

//     const base = (location ?? '').trim().replace(/\/+$/, '')
//     if (!base) return null

//     const url = `${base}/${signature}`

//     const res = await fetch(url)
//     if (!res.ok) return null

//     return await res.arrayBuffer()
//   }
// }
