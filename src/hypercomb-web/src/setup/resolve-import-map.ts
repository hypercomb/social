// hypercomb-web/src/setup/resolve-import-map.ts

import { environment } from '@hypercomb/shared'

export type ResolvedImports = Record<string, string>

const OPFS_DEPENDENCY_BASE_PATH = '/opfs/__dependencies__'

export const resolveImportMap = async (): Promise<ResolvedImports> => {
  const imports: ResolvedImports = {}
  const aliasSource = new Map<string, string>()
  imports['@hypercomb/core'] = '/hypercomb-core.runtime.js'
  imports['pixi.js'] = '/vendor/pixi.runtime.js'


  const root = await navigator.storage.getDirectory()

  let depsDir: FileSystemDirectoryHandle | null = null
  try {
    depsDir = await root.getDirectoryHandle('__dependencies__')
  } catch {
    depsDir = null
  }
  if (!depsDir) return imports

  for await (const [signature, handle] of depsDir.entries()) {
    if (handle.kind !== 'file') continue

    const file = await (handle as FileSystemFileHandle).getFile()

    const text = await file.text()
    const firstLine = text.split('\n', 1)[0]?.trim()
    if (!firstLine) continue

    const alias = firstLine.split(/\s+/)[1]
    if (!alias) continue

    if (imports[alias]) {
      const existing = aliasSource.get(alias) ?? 'unknown'
      console.warn(`[resolveImportMap] alias collision for ${alias}; keeping ${existing}, skipping ${signature}`)
      continue
    }

    imports[alias] = `${OPFS_DEPENDENCY_BASE_PATH}/${signature}`
    aliasSource.set(alias, signature)
  }

  return imports
}
