// meadowverse/src/resolve-import-map.ts

export type ResolvedImports = Record<string, string>

const OPFS_DEPENDENCY_BASE_PATH = '/opfs/__dependencies__'

export const resolveImportMap = async (): Promise<ResolvedImports> => {
  const imports: ResolvedImports = {}
  const aliasSource = new Map<string, string>()

  // core runtime — bees import from @hypercomb/core at runtime
  imports['@hypercomb/core'] = '/hypercomb-core.runtime.js'

  // three.js vendor bundle (loaded from public/ or future vendor build)
  imports['three'] = '/vendor/three.runtime.js'

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

    const prefix = await file.slice(0, 512).arrayBuffer()
    const firstLine = new TextDecoder().decode(prefix).split('\n', 1)[0]?.trim()
    if (!firstLine) continue

    const alias = firstLine.split(/\s+/)[1]
    if (!alias) continue

    if (imports[alias]) {
      const existing = aliasSource.get(alias) ?? 'unknown'
      console.warn(`[meadowverse:importmap] alias collision for ${alias}; keeping ${existing}, skipping ${signature}`)
      continue
    }

    imports[alias] = `${OPFS_DEPENDENCY_BASE_PATH}/${signature}`
    aliasSource.set(alias, signature)
  }

  // cache alias map for DependencyLoader
  ;(globalThis as any).__hypercombAliasMap = aliasSource

  return imports
}
