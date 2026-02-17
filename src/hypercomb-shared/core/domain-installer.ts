// // hypercomb-web/src/app/core/domain-installer.ts

// import { inject, Injectable } from '@angular/core'
// import { DomainParser } from './initializers/location-parser'
// import { Store } from './store'

// export interface DomainInstallResult {
//   domain: string
//   signature: string
//   domainFolderPath: string
//   installFolderPath: string
//   markerFilePath: string
// }

// @Injectable({ providedIn: 'root' })
// export class DomainInstaller {

//   private readonly store = inject(Store)

//   private static readonly LOCATION_FILE = '__location__'
//   private static readonly INSTALL_SUFFIX = '-install'

//   public install = async (input: string): Promise<DomainInstallResult> => {
//     const raw = (input ?? '').trim()
//     if (!raw) throw new Error('[domain-installer] empty input')

//     const parsed = DomainParser.parse(raw)

//     const domain = (parsed.domain ?? '').trim().toLowerCase()
//     const signature = (parsed.signature ?? '').trim().toLowerCase()

//     if (!domain) throw new Error('[domain-installer] missing domain')
//     if (!signature) throw new Error('[domain-installer] missing signature')

//     const location = this.normalizeLocation(raw)

//     // step 1: put domain folder in root
//     await this.store.domainDirectory(domain, true)

//     // step 2: installs live in __layers__/domain/
//     const domainLayersDir = await this.store.domainLayersDirectory(domain, true)

//     // store provenance once per domain
//     await this.writeTextFile(domainLayersDir, DomainInstaller.LOCATION_FILE, location)

//     // step 3: create <sig>-install marker in the same domain layers dir
//     const markerName = `${signature}${DomainInstaller.INSTALL_SUFFIX}`
//     const markerExists = await this.fileExists(domainLayersDir, markerName)

//     if (!markerExists) {
//       await this.writeTextFile(domainLayersDir, markerName, JSON.stringify({ signature }))
//     }

//     // step 4: done
//     return {
//       domain,
//       signature,
//       domainFolderPath: `/${domain}/`,
//       installFolderPath: `/__layers__/${domain}/`,
//       markerFilePath: `/__layers__/${domain}/${markerName}`
//     }
//   }

//   private normalizeLocation = (raw: string): string => {
//     let url: URL

//     if (/^\s*https?:\/\//i.test(raw)) url = new URL(raw)
//     else if (/^\s*\/\//.test(raw)) url = new URL(`https:${raw}`)
//     else url = new URL(`https://${raw}`)

//     const pathname = (url.pathname ?? '').trim()

//     // absolute origin + path, no trailing slash
//     return `${url.origin}${pathname}`.replace(/\/+$/, '')
//   }

//   private writeTextFile = async (
//     dir: FileSystemDirectoryHandle,
//     name: string,
//     text: string
//   ): Promise<void> => {
//     const handle = await dir.getFileHandle(name, { create: true })
//     const writable = await handle.createWritable({ keepExistingData: false })
//     try {
//       await writable.write(text)
//     } finally {
//       await writable.close()
//     }
//   }

//   private fileExists = async (
//     dir: FileSystemDirectoryHandle,
//     name: string
//   ): Promise<boolean> => {
//     try {
//       await dir.getFileHandle(name, { create: false })
//       return true
//     } catch {
//       return false
//     }
//   }
// }
