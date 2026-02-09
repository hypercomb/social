import { environment } from '../environments/environment'

// alias → fetchable module url
export type ResolvedImports = Record<string, string>

// prod dependencies are served via SW from OPFS
const OPFS_DEPENDENCY_BASE_PATH = '/opfs/__dependencies__'

// dev namespace manifest (explicit)
const DEV_NAMESPACE_MANIFEST = '/dev/namespace.manifest.js'

export const resolveImportMap = async (): Promise<ResolvedImports> => {
  const imports: ResolvedImports = {}

  // -----------------------------------------
  // prod: signed dependencies via OPFS
  // -----------------------------------------

  if (environment.production) {
    const root = await navigator.storage.getDirectory()

    let depsDir: FileSystemDirectoryHandle
    try {
      depsDir = await root.getDirectoryHandle('__dependencies__')
    } catch {
      return imports
    }

    for await (const [signature, handle] of depsDir.entries()) {
      if (handle.kind !== 'file') continue

      const file = await (handle as FileSystemFileHandle).getFile()
      const text = await file.text()

      // first line convention: "// @namespace/path"
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

  // -----------------------------------------
  // dev: explicit namespace → entry mapping
  // -----------------------------------------

  else {
    const manifest = await import(/* @vite-ignore */ DEV_NAMESPACE_MANIFEST)

    if (
      !manifest ||
      typeof manifest.namespaceEntries !== 'object'
    ) {
      throw new Error('invalid dev namespace.manifest.js')
    }

    for (const [ns, entry] of Object.entries(manifest.namespaceEntries)) {
      imports[ns] = `/dev/${entry}`
    }
  }

  // -----------------------------------------
  // platform vendors (same in dev + prod)
  // -----------------------------------------

  imports['@hypercomb/core'] = '/hypercomb-core.runtime.js'
  imports['pixi.js'] = '/vendor/pixi.runtime.js'

  return imports
}
