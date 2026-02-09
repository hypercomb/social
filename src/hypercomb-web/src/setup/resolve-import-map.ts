// hypercomb-web/src/setup/resolve-import-map.ts

import { environment } from '../environments/environment'

export type ResolvedImports = Record<string, string>

const OPFS_DEPENDENCY_BASE_PATH = '/opfs/__dependencies__'
const DEV_NAME_MANIFEST = '/dev/name.manifest.js'

export const resolveImportMap = async (): Promise<ResolvedImports> => {
  const imports: ResolvedImports = {}

  if (environment.production) {
    const root = await navigator.storage.getDirectory()

    let depsDir: FileSystemDirectoryHandle | null = null
    try {
      depsDir = await root.getDirectoryHandle('__dependencies__')
    } catch {
      depsDir = null
    }

    if (depsDir) {
      for await (const [signature, handle] of depsDir.entries()) {
        if (handle.kind !== 'file') continue

        const file = await (handle as FileSystemFileHandle).getFile()

        const text = await file.text()
        const firstLine = text.split('\n', 1)[0]?.trim()
        if (!firstLine) continue

        const alias = firstLine.split(/\s+/)[1]
        if (!alias) continue

        if (imports[alias]) {
          throw new Error(`dependency alias collision: ${alias}`)
        }

        imports[alias] = `${OPFS_DEPENDENCY_BASE_PATH}/${signature}`
      }
    }
  } else {
    const mod = await import(/* @vite-ignore */ DEV_NAME_MANIFEST)

    const devImports = mod?.imports
    if (!devImports || typeof devImports !== 'object') {
      throw new Error('invalid dev name.manifest.js')
    }

    Object.assign(imports, devImports as ResolvedImports)
  }

  imports['@hypercomb/core'] = '/hypercomb-core.runtime.js'
  imports['pixi.js'] = '/vendor/pixi.runtime.js'

  return imports
}
