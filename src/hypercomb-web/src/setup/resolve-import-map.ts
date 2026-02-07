// hypercomb-web/src/setup/resolve-import-map.ts

import { environment } from '../environments/environment'

// alias → fetchable module url
export type ResolvedImports = Record<string, string>

// prod dependencies are served via SW from OPFS
const OPFS_DEPENDENCY_BASE_PATH = '/opfs/__dependencies__'

// dev dependencies are served directly from public
const DEV_DEPENDENCIES_IMPORTS =
  '/dev/essentials/dependencies.runtime-map.json'

export const resolveImportMap = async (): Promise<ResolvedImports> => {
  const imports: ResolvedImports = {}

  // -----------------------------------------
  // dependencies
  // -----------------------------------------

  if (environment.production) {
    // prod: discover dependencies from OPFS
    const root = await navigator.storage.getDirectory()

    let depsDir: FileSystemDirectoryHandle
    try {
      depsDir = await root.getDirectoryHandle('__dependencies__')
    } catch {
      // no dependencies installed yet
      return imports
    }

    for await (const [signature, handle] of depsDir.entries()) {
      if (handle.kind !== 'file') continue

      const file = await (handle as FileSystemFileHandle).getFile()

      // read first line only (header convention)
      const text = await file.text()
      const firstLine = text.split('\n', 1)[0]?.trim()
      if (!firstLine) continue

      // expected header: "// @alias/name"
      const alias = firstLine.split(/\s+/)[1]
      if (!alias) continue

      // collision guard
      if (imports[alias]) {
        throw new Error(`dependency alias collision: ${alias}`)
      }

      imports[alias] = `${OPFS_DEPENDENCY_BASE_PATH}/${signature}`
    }
  } else {
    // dev: import generated public imports module
    const devModule = await import(/* @vite-ignore */ DEV_DEPENDENCIES_IMPORTS)

    if (!devModule?.imports || typeof devModule.imports !== 'object') {
      throw new Error('invalid dev dependencies.imports.js')
    }

    Object.assign(imports, devModule.imports)
  }

  // -----------------------------------------
  // platform vendors (same in dev + prod)
  // -----------------------------------------

  imports['@hypercomb/core'] = '/hypercomb-core.runtime.js'
  imports['pixi.js'] = '/vendor/pixi.runtime.js'

  return imports
}
