// hypercomb-web/src/setup/resolve-import-map.ts

import { environment } from '../environments/environment'

export type ResolvedImports = Record<string, string>

export type DevManifest = {
  imports: Record<string, string>
  resources?: Record<string, string[]>
  domains?: unknown
}

const CACHE_NAME = 'hypercomb-modules-v1'

const DEP_DIR = '__dependencies__'
const DEP_VIRTUAL_PREFIX = '/opfs/__dependencies__/'

const DEV_MANIFEST_URL = '/dev/name.manifest.js'

export const resolveImportMap = async (): Promise<ResolvedImports> => {
  return environment.production ? resolveFromOpfs() : resolveFromDevManifest()
}

const resolveFromDevManifest = async (): Promise<ResolvedImports> => {
  const imports: ResolvedImports = {}

  let manifest: DevManifest | null = null
  try {
    const mod = await import(/* @vite-ignore */ DEV_MANIFEST_URL)
    const raw = (mod as any)?.nameManifest ?? mod
    const map = (raw as any)?.imports ?? (mod as any)?.imports
    if (!map || typeof map !== 'object') return imports

    manifest = {
      imports: map as Record<string, string>,
      resources: (raw as any)?.resources ?? (mod as any)?.resources,
      domains: (raw as any)?.domains ?? (mod as any)?.domains,
    }
  } catch {
    return imports
  }

  let cache: Cache | null = null
  try {
    cache = await caches.open(CACHE_NAME)
  } catch {
    cache = null
  }

  const entries = Object.entries(manifest.imports).sort((a, b) => a[0].localeCompare(b[0]))

  for (const [alias, devUrlRaw] of entries) {
    if (typeof alias !== 'string' || !alias.trim()) continue
    if (typeof devUrlRaw !== 'string' || !devUrlRaw.trim()) continue

    const devUrl = new URL(devUrlRaw.trim(), location.origin)

    const sig = readSignatureFromDevPath(devUrl.pathname)
    if (!sig) continue

    // runtime resolution lane (bypasses vite): alias -> /opfs/__dependencies__/sig
    imports[alias] = `${DEP_VIRTUAL_PREFIX}${sig}`

    // dev: seed the sw cache so /opfs/__dependencies__/sig can be served without hitting vite
    // NOTE: devUrl MUST NOT look like js, otherwise vite import-analysis will run and fail.
    if (!cache) continue

    try {
      const r = await fetch(devUrl.toString(), { cache: 'no-store' })
      if (!r.ok) continue

      const bytes = await r.arrayBuffer()

      const opfsUrl = new URL(`${DEP_VIRTUAL_PREFIX}${sig}`, location.origin).toString()
      await cache.put(opfsUrl, new Response(bytes, { headers: jsNoStoreHeaders() }))
    } catch {
      // ignore
    }
  }

  return imports
}

const resolveFromOpfs = async (): Promise<ResolvedImports> => {
  const imports: ResolvedImports = {}

  const root = await navigator.storage.getDirectory()

  let depDir: FileSystemDirectoryHandle
  try {
    depDir = await root.getDirectoryHandle(DEP_DIR)
  } catch {
    return imports
  }

  for await (const [sig, entry] of depDir.entries()) {
    if (entry.kind !== 'file') continue
    if (!isSignature(sig)) continue

    try {
      const file = await (entry as FileSystemFileHandle).getFile()

      const slice = file.slice(0, 512)
      const bytes = await slice.arrayBuffer()
      const first = readFirstLine(bytes)

      const alias = readAliasFromFirstLine(first)
      if (!alias) continue

      imports[alias] = `${DEP_VIRTUAL_PREFIX}${sig}`
    } catch {
      // ignore
    }
  }

  return imports
}

const jsNoStoreHeaders = (): Headers => {
  const h = new Headers()
  h.set('content-type', 'application/javascript')
  h.set('cache-control', 'no-store')
  return h
}

const readFirstLine = (bytes: ArrayBuffer): string => {
  const text = new TextDecoder().decode(bytes)
  return text.split('\n', 1)[0]?.trim() ?? ''
}

const readAliasFromFirstLine = (first: string): string | null => {
  if (!first.startsWith('//')) return null
  const parts = first.split(/\s+/)
  const token = (parts[1] ?? '').trim()
  if (!token.startsWith('@')) return null
  return token
}

const readSignatureFromDevPath = (pathname: string): string | null => {
  const last = pathname.split('/').pop() ?? ''
  if (!last) return null

  // allow: <sig>, <sig>.js, <sig>.bin
  const token =
    last.endsWith('.bin') ? last.slice(0, -4) :
    last.endsWith('.js') ? last.slice(0, -3) :
    last

  return isSignature(token) ? token : null
}

const isSignature = (name: string): boolean =>
  /^[a-f0-9]{64}$/i.test(name)
