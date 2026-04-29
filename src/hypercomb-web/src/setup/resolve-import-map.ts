// hypercomb-web/src/setup/resolve-import-map.ts

import { environment } from '@hypercomb/shared'

export type ResolvedImports = Record<string, string>

const OPFS_DEPENDENCY_BASE_PATH = '/opfs/__dependencies__'

export const resolveImportMap = async (): Promise<ResolvedImports> => {
  const traceEnabled = (() => { try { return localStorage.getItem('hc:boot-trace') !== '0' } catch { return true } })()
  const t0 = performance.now()
  const imports: ResolvedImports = {}
  const aliasSource = new Map<string, string>()
  imports['@hypercomb/core'] = '/hypercomb-core.runtime.js'
  imports['pixi.js'] = '/vendor/pixi.runtime.js'


  let root: FileSystemDirectoryHandle
  try {
    root = await Promise.race([
      navigator.storage.getDirectory(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OPFS timed out')), 3_000)
      )
    ])
  } catch (err) {
    console.warn('[resolveImportMap] OPFS unavailable — returning core imports only', err)
    return imports
  }

  let depsDir: FileSystemDirectoryHandle | null = null
  try {
    depsDir = await root.getDirectoryHandle('__dependencies__')
  } catch {
    depsDir = null
  }
  if (!depsDir) return imports

  let scanned = 0
  for await (const [signature, handle] of depsDir.entries()) {
    if (handle.kind !== 'file') continue
    scanned++

    const file = await (handle as FileSystemFileHandle).getFile()

    const prefix = await file.slice(0, 512).arrayBuffer()
    const firstLine = new TextDecoder().decode(prefix).split('\n', 1)[0]?.trim()
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

  // Cache alias map so DependencyLoader can skip redundant OPFS scan
  ;(globalThis as any).__hypercombAliasMap = aliasSource

  if (traceEnabled) {
    console.log(`[resolveImportMap] scanned ${scanned} __dependencies__ entries, registered ${Object.keys(imports).length} aliases in ${(performance.now() - t0).toFixed(0)}ms`)
  }

  return imports
}
