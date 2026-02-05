// src/app/core/dependency-loader.ts

export type DependencyMap = Record<string, string>

export const loadOpfsDependencies = async (): Promise<DependencyMap> => {
  const map: DependencyMap = {}

  // get OPFS root
  const root = await navigator.storage.getDirectory()

  let depsDir: FileSystemDirectoryHandle
  try {
    depsDir = await root.getDirectoryHandle('__dependencies__')
  } catch {
    // no dependencies present
    return map
  }

  for await (const [name, handle] of depsDir.entries()) {
    if (handle.kind !== 'file') continue

    const file = await (handle as FileSystemFileHandle).getFile()
    const blobUrl = URL.createObjectURL(file)

    // IMPORTANT:
    // name is the signature
    // aliasing happens later
    map[name] = blobUrl
  }

  return map
}
