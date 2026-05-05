import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const REPO_ROOT = path.resolve(__dirname, '../..')
export const INTEL_DIR = path.join(REPO_ROOT, 'intel')
export const PAYLOADS_DIR = path.join(INTEL_DIR, 'payloads')
export const SKELETON_PATH = path.join(INTEL_DIR, 'relational-intelligence-skeleton.json')
export const MANIFEST_PATH = path.join(INTEL_DIR, 'relational-intelligence-manifest.json')
export const SEED_PATH = path.join(REPO_ROOT, 'relational-intelligence-seed.js')

export type Sig = string

export interface Manifest {
  skeletonSig: Sig
  workingSet: Record<string, Sig>
  history: { at: number; sig: Sig; summary: string }[]
}

export interface IterationBundle {
  iteration: number
  at: number
  summary: string
  workingSet: Record<string, Sig>
  generation: Sig
  previousIterationSig: Sig | null
}

export function sign(bytes: string): Sig {
  return createHash('sha256').update(bytes, 'utf8').digest('hex')
}

export async function ensureDirs(): Promise<void> {
  await fs.mkdir(PAYLOADS_DIR, { recursive: true })
}

export async function writePayload(bytes: string): Promise<Sig> {
  await ensureDirs()
  const sig = sign(bytes)
  const target = path.join(PAYLOADS_DIR, sig)
  try {
    const existing = await fs.readFile(target, 'utf8')
    if (existing === bytes) return sig
  } catch { /* doesn't exist */ }
  await fs.writeFile(target, bytes, 'utf8')
  return sig
}

export async function readPayload(sig: Sig): Promise<string> {
  const bytes = await fs.readFile(path.join(PAYLOADS_DIR, sig), 'utf8')
  const actual = sign(bytes)
  if (actual !== sig) {
    throw new Error(`integrity: payloads/${sig} hashes to ${actual} (bytes tampered or corrupted)`)
  }
  return bytes
}

export async function payloadExists(sig: Sig): Promise<boolean> {
  try {
    await fs.access(path.join(PAYLOADS_DIR, sig))
    return true
  } catch {
    return false
  }
}

export async function readManifest(): Promise<Manifest> {
  const text = await fs.readFile(MANIFEST_PATH, 'utf8')
  return JSON.parse(text)
}

export async function writeManifest(m: Manifest): Promise<void> {
  await ensureDirs()
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(m, null, 2) + '\n', 'utf8')
}

const SIG_RE = /"([a-f0-9]{64})"/g

export async function expand(text: string, ancestry: Set<Sig> = new Set()): Promise<string> {
  const matches = [...text.matchAll(SIG_RE)]
  if (matches.length === 0) return text

  const sigs = [...new Set(matches.map(m => m[1]))]
  const expanded: Record<Sig, string> = {}

  for (const sig of sigs) {
    if (ancestry.has(sig)) throw new Error(`cycle detected at sig ${sig}`)
    if (!(await payloadExists(sig))) throw new Error(`missing payload for sig ${sig}`)
    const bytes = await readPayload(sig)
    const next = new Set(ancestry); next.add(sig)
    expanded[sig] = await expand(bytes, next)
  }

  return text.replace(SIG_RE, (_, sig) => expanded[sig])
}

export function toJsonPayload(bytes: string): string {
  try {
    const parsed = JSON.parse(bytes)
    if (typeof parsed === 'object' && parsed !== null) {
      return bytes
    }
  } catch { /* not JSON */ }
  return JSON.stringify(bytes)
}
