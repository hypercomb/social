// hypercomb site — resolve a creation AND materialize its visitor faces.
//
//   hypercomb site <sig> --from <url> [--from <url>…] --to <dir>
//
// The resolver fills the pool (install.ts); this command additionally walks
// the layer protocol — tile and branch expansion — and writes the branch's
// visual:website:page tree as <name>/…/index.html plus the root index.html,
// so the folder is a rendered website, not only an oasis. Face copies are
// rewritten to stand alone on a dumb server (resource:<sig>/x.css inlined —
// <link> is MIME-enforced; other resource: refs become /<sig>); the pool
// bytes stay canonical under their signatures.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveClosure, type ResolverIO, type ResolveStats } from './install.js'

const SIG = /^[a-f0-9]{64}$/
const DEFAULT_MAX_SIGS = 20_000
const FETCH_TIMEOUT_MS = 30_000

/** A layer's visual:website:page htmlSig, read from the resolved pool. */
const pageSigOf = (out: string, layerSig: string): string | null => {
  try {
    const layer = JSON.parse(readFileSync(join(out, layerSig), 'utf8'))
    for (const sig of (Array.isArray(layer?.decorations) ? layer.decorations.map(String) : [])) {
      try {
        const rec = JSON.parse(readFileSync(join(out, sig), 'utf8'))
        const html = String(rec?.payload?.htmlSig ?? '')
        if (rec?.kind === 'visual:website:page' && SIG.test(html)) return html
      } catch { /* not a JSON decoration record */ }
    }
  } catch { /* not a JSON layer */ }
  return null
}

/** Make a page copy stand alone: inline resource: css (MIME-enforced link
 *  tags die on octet-stream hosts), point other resource: refs at /<sig>. */
export const standaloneFace = (out: string, html: string): string =>
  html
    .replace(/<link\b[^>]*href="resource:([a-f0-9]{64})\/[^"]*\.css"[^>]*>/g, (tag, sig) => {
      try { return `<style>\n${readFileSync(join(out, sig), 'utf8')}\n</style>` } catch { return tag }
    })
    .replace(/resource:([a-f0-9]{64})\/[^"' )]*/g, '/$1')

/** Materialize the page TREE: every descendant layer carrying a
 *  visual:website:page becomes <out>/<name>/…/index.html; the root layer's
 *  page is also the folder's index.html. Returns the page count. */
export const materializePages = (out: string, headSig: string): number => {
  let pages = 0
  const walk = (layerSig: string, at: string[]): void => {
    let layer: Record<string, unknown>
    try { layer = JSON.parse(readFileSync(join(out, layerSig), 'utf8')) } catch { return }
    const name = String(layer?.['name'] ?? '').trim()
    if (!name) return
    const here = [...at, name]
    const pageSig = pageSigOf(out, layerSig)
    if (pageSig) {
      const html = standaloneFace(out, readFileSync(join(out, pageSig), 'utf8'))
      const dir = join(out, ...here)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'index.html'), html)
      if (at.length === 0) writeFileSync(join(out, 'index.html'), html)
      pages++
    }
    for (const child of (Array.isArray(layer?.['children']) ? (layer['children'] as unknown[]).map(String) : [])) {
      if (SIG.test(child)) walk(child, here)
    }
  }
  walk(headSig, [])
  return pages
}

/** Network sources over the one contract, staged writes into the out dir —
 *  the same discipline as the install command's disk IO. */
export const networkSiteIO = (out: string, sources: string[]): ResolverIO => ({
  fetch: async (sig) => {
    for (const base of sources) {
      try {
        const res = await fetch(`${base.replace(/\/+$/, '')}/${sig}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        if (res.ok) return new Uint8Array(await res.arrayBuffer())
      } catch { /* next source */ }
    }
    return null
  },
  has: (sig) => { try { readFileSync(join(out, sig)); return true } catch { return false } },
  read: (sig) => readFileSync(join(out, sig)),
  write: (sig, bytes) => {
    const part = join(out, `.part-${sig}`)
    writeFileSync(part, bytes)
    renameSync(part, join(out, sig))
  },
})

/** Resolve + materialize, one call — the shim's sync verb. */
export async function syncSite(
  head: string,
  out: string,
  io: ResolverIO,
  maxSigs = DEFAULT_MAX_SIGS,
): Promise<ResolveStats & { pages: number }> {
  mkdirSync(out, { recursive: true })
  const stats = await resolveClosure(head, io, { maxSigs })
  const pages = io.has(head) ? materializePages(out, head) : 0
  return { ...stats, pages }
}

const USAGE = `usage: hypercomb site <sig> --from <url> [--from <url>…] --to <dir> [--max <n>]

Resolve a creation's closure AND materialize its website faces into <dir>.
The folder is then a deployable read-only website and an open oasis.`

export async function runSite(args: string[]): Promise<void> {
  const sources: string[] = []
  let out = ''
  let head = ''
  let maxSigs = DEFAULT_MAX_SIGS
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from') sources.push(args[++i] ?? '')
    else if (args[i] === '--to') out = args[++i] ?? ''
    else if (args[i] === '--max') maxSigs = Number(args[++i]) || DEFAULT_MAX_SIGS
    else if (!args[i].startsWith('--') && !head) head = args[i]
  }
  if (!SIG.test(head) || !sources.length || !sources.every(Boolean) || !out) {
    console.error(USAGE)
    process.exit(1)
  }
  const stats = await syncSite(head, out, networkSiteIO(out, sources), maxSigs)
  console.log(`closure ${head.slice(0, 12)}…: ${stats.total} sigs — already had ${stats.present}, fetched ${stats.fetched}, holes ${stats.holes.length}, refused ${stats.refused.length}`)
  console.log(`${stats.pages} website page(s) materialized`)
  if (!stats.pages) console.warn('no visual:website:page found — the folder is an oasis without a face')
  if (stats.holes.length) console.warn('holes:', stats.holes.map(s => s.slice(0, 12)).join(', '))
  console.log(`site at ${out} — serve it with: hypercomb serve ${out}`)
}
