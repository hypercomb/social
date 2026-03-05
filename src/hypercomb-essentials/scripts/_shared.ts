// hypercomb-essentials/scripts/_shared.ts

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join, relative } from 'path'

export const relPosix = (from: string, to: string): string => relative(from, to).replace(/\\/g, '/') || ''

export const walkFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walkFiles(full))
    else out.push(full)
  }
  return out
}

export const ensureDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true })
}

export const rmDir = (dir: string): void => {
  rmSync(dir, { recursive: true, force: true })
}

export const isBee = (file: string): boolean => file.endsWith('.drone.ts') || file.endsWith('.drone.js') || file.endsWith('.worker.ts') || file.endsWith('.worker.js')

export const stripExt = (p: string): string => p.slice(0, -extname(p).length)

export const fileBase = (p: string): string => basename(stripExt(p))

export const textToBytes = (text: string): Uint8Array => new TextEncoder().encode(text)

export const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export const isSig = (v: string): boolean => /^[a-f0-9]{64}$/i.test(v)

export const writeSigFile = (dir: string, sig: string, bytes: Uint8Array): void => {
  if (!isSig(sig)) throw new Error(`invalid signature: ${sig}`)
  writeFileSync(join(dir, sig), bytes)
}

export const readText = (path: string): string => readFileSync(path, 'utf8')

export const isUnderDir = (file: string, dirAbs: string): boolean => {
  const f = file.replace(/\\/g, '/')
  const d = dirAbs.replace(/\\/g, '/').replace(/\/+$/, '')
  return f.startsWith(d + '/')
}

// reads only the first line and extracts the first token that starts with "@essentials/"
export const readEssentialsTokenFromFirstLine = (text: string): string | null => {
  const first = text.split('\n', 1)[0]?.trim() ?? ''
  if (!first.startsWith('//')) return null
  const parts = first.split(/\s+/)
  const token = parts[1] ?? ''
  if (!token.startsWith('@essentials/')) return null
  return token
}

// ensures each dependency has a unique specifier so import map can bind it 1:1
// - if missing/invalid: @essentials/default/<base>
// - if only a namespace (two segments): @essentials/<group>/<base>
// - if already qualified: keep
export const normalizeEssentialsSpecifier = (token: string | null, base: string): string => {
  if (!token || !token.startsWith('@essentials/')) return `@essentials/default/${base}`
  const parts = token.split('/')
  if (parts.length === 2) return `${token}/${base}`
  if (parts.length === 3 && !parts[2]) return `${parts[0]}/${parts[1]}/${base}`
  return token
}

export const toNamespace = (specifier: string): string => {
  const parts = specifier.split('/')
  if (parts.length < 2) return specifier
  return `${parts[0]}/${parts[1]}`
}

// removes a single leading essentials header line if present
export const stripLeadingEssentialsHeaderLine = (text: string): string => {
  const lines = text.split('\n')
  const first = lines[0]?.trim() ?? ''
  if (first.startsWith('//')) {
    const parts = first.split(/\s+/)
    const token = parts[1] ?? ''
    if (token.startsWith('@essentials/')) return lines.slice(1).join('\n')
  }
  return text
}
