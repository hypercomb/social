// hypercomb-web/src/app/core/layer-installer.ts

import { Injectable, inject } from '@angular/core'
import { DevManifest, Store } from './store'
import { environment } from '../../environments/environment'

type LayerInstallFile = {
  signature: string
  name?: string
  layers?: string[]
  drones?: string[]
  dependencies?: string[]
}

@Injectable({ providedIn: 'root' })
export class LayerInstaller {

  private readonly store = inject(Store)

  private static readonly LOCATION_FILE = '__location__'
  private static readonly INSTALL_SUFFIX = '-install'

  public install = async (manifest: DevManifest): Promise<void> => {
    const domains = <string[]>Array.from(<any>manifest.domains)
    for (const domain of domains) {
      const domainLayersDir = await this.store.domainLayersDirectory(domain, true)

      // note: this creates an empty file if it doesn't exist yet
      // if you rely on this being json, you must seed/write the json before parsing it later
      await domainLayersDir.getFileHandle(
        `${manifest.root}${LayerInstaller.INSTALL_SUFFIX}`,
        { create: true }
      )

      await this.installDomain(domain, domainLayersDir)
    }
    console.log(`[layer-installer] install complete for manifest`)
  }

  private installDomain = async (
    domain: string,
    domainLayersDir: FileSystemDirectoryHandle
  ): Promise<void> => {
    const visited = new Set<string>()
    await this.installRecursive(domain, domainLayersDir, visited)
  }

  private installRecursive = async (
    domain: string,
    layersDomainDir: FileSystemDirectoryHandle,
    visited: Set<string>
  ): Promise<void> => {


    for await (const [name, handle] of layersDomainDir.entries()) {
      if (handle.kind !== 'file') continue
      if (!name.endsWith(LayerInstaller.INSTALL_SUFFIX)) continue

      const sig = name
        .replace(LayerInstaller.INSTALL_SUFFIX, '')
        .replace(/^install-/, '')

      if (visited.has(sig)) continue
      visited.add(sig)

      // your current convention: the install file itself contains the layer json
      const layerJsonHandle = await layersDomainDir.getFileHandle(`${sig}${LayerInstaller.INSTALL_SUFFIX}`)

      const layerFile = await layerJsonHandle.getFile()
      const layerText = await layerFile.text()
      const layer = JSON.parse(layerText) as LayerInstallFile

      console.log(
        `[layer-installer] installing layer ${sig} (${layerFile.size} bytes)`
      )

      // -----------------------------------------
      // install dependencies (dev fetch -> opfs)
      // -----------------------------------------

      const targetDirectory = this.store.dependenciesDirectory()
      const devBase = `/dev/${domain}/__dependencies__/`

      for (const dependency of layer.dependencies ?? []) {
        try {
          await targetDirectory.getFileHandle(dependency)
          console.log(
            `[layer-installer] dependency already present: ${dependency}`
          )
          continue
        } catch {
          // not present
        }

        const url = `${devBase}${dependency}`
        const res = await fetch(url, { cache: 'no-store' })

        const ct = res.headers.get('content-type') ?? ''
        console.log(
          `[layer-installer] fetch ${url} -> ${res.status} ${ct}`
        )

        if (!res.ok) {
          const body = await res.text().catch(() => '')
          console.log(
            `[layer-installer] fetch failed body (first 200): ${body.slice(0, 200)}`
          )
          continue
        }

        if (ct.includes('text/html')) {
          const body = await res.text().catch(() => '')
          console.log(
            `[layer-installer] unexpected html (first 200): ${body.slice(0, 200)}`
          )
          continue
        }

        const bytes = new Uint8Array(await res.arrayBuffer())
        const outHandle =
          await targetDirectory.getFileHandle(dependency, { create: true })

        const writable = await outHandle.createWritable()
        await writable.write(bytes)
        await writable.close()

        console.log(
          `[layer-installer] stored dependency ${dependency} (${bytes.byteLength} bytes)`
        )
      }

      // -----------------------------------------
      // install drones (dev fetch -> opfs)
      // -----------------------------------------

      const dronesTargetDirectory = this.store.dronesDirectory()
      const devDronesBase = `/dev/${domain}/__drones__/`

      for (const drone of layer.drones ?? []) {
        try {
          await dronesTargetDirectory.getFileHandle(drone)
          console.log(
            `[layer-installer] drone already present: ${drone}`
          )
          continue
        } catch {
          // not present
        }

        const url = `${devDronesBase}${drone}.js`
        const res = await fetch(url, { cache: 'no-store' })

        const ct = res.headers.get('content-type') ?? ''
        console.log(
          `[layer-installer] fetch ${url} -> ${res.status} ${ct}`
        )

        if (!res.ok) {
          const body = await res.text().catch(() => '')
          console.log(
            `[layer-installer] fetch failed body (first 200): ${body.slice(0, 200)}`
          )
          continue
        }

        if (ct.includes('text/html')) {
          const body = await res.text().catch(() => '')
          console.log(
            `[layer-installer] unexpected html (first 200): ${body.slice(0, 200)}`
          )
          continue
        }

        const bytes = new Uint8Array(await res.arrayBuffer())
        const outHandle =
          await dronesTargetDirectory.getFileHandle(drone, { create: true })

        const writable = await outHandle.createWritable()
        await writable.write(bytes)
        await writable.close()

        console.log(
          `[layer-installer] stored drone ${drone} (${bytes.byteLength} bytes)`
        )
      }

      // -----------------------------------------
      // seed child layer install files (same dir)
      // -----------------------------------------

      const devLayersBase = `/dev/${domain}/__layers__/`

      for (const childSig of layer.layers ?? []) {
        const childInstallName = `${childSig}`
        try {
          await layersDomainDir.getFileHandle(childInstallName)
          continue
        } catch {
          // not present
        }

        const url = `${devLayersBase}${childInstallName}.json`
        const res = await fetch( url, { cache: 'no-store' })

        const ct = res.headers.get('content-type') ?? ''
        console.log(
          `[layer-installer] fetch ${url} -> ${res.status} ${ct}`
        )

        if (!res.ok) {
          const body = await res.text().catch(() => '')
          console.log(
            `[layer-installer] fetch failed body (first 200): ${body.slice(0, 200)}`
          )
          continue
        }

        if (ct.includes('text/html')) {
          const body = await res.text().catch(() => '')
          console.log(
            `[layer-installer] unexpected html (first 200): ${body.slice(0, 200)}`
          )
          continue
        }

        const bytes = new Uint8Array(await res.arrayBuffer())
        const outHandle = await layersDomainDir.getFileHandle(`${childInstallName}-install`, { create: true })

        const writable = await outHandle.createWritable()
        await writable.write(bytes)
        await writable.close()

        console.log(
          `[layer-installer] stored layer ${childSig} (${bytes.byteLength} bytes)`
        )
      }

      // -----------------------------------------
      // rename original marker to consume it
      // -----------------------------------------

      const consumedHandle = await layersDomainDir.getFileHandle(sig, { create: true })

      const consumedWritable = await consumedHandle.createWritable()
      await consumedWritable.write(layerText)
      await consumedWritable.close()

      await layersDomainDir.removeEntry(name)

      // next pass will pick up newly seeded children
      await this.installRecursive(domain, layersDomainDir, visited)
    }
  }
}
