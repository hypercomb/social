// Read a granted intelligence folder before a model is asked.
//
// The arguments are hashed the same way `intelligence get` hashes them. Each
// group in the folder names a pool, intelligence:<group>. A member file with
// that hash holds the domain and the answer's own signature. The bytes come
// from https://<domain>/<answer> and are spoken only when they hash to the
// answer signature. A copy already in the folder is spoken with no request.
// No grant, no member, or a bad body answers null, and the model call proceeds.

import { hashArguments, poolAddress, sha256Hex } from './intelligence-canonical.js'
import { grantedIntelligenceRoot, type DirectoryHandle } from './intelligence-folder.js'

const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const HASH = /^[0-9a-f]{64}$/

type Listed = { readonly kind: string; readonly name?: string }

const groupsOf = async (root: DirectoryHandle): Promise<string[]> => {
  const names: string[] = []
  for await (const [name, entry] of root.entries() as AsyncIterable<[string, Listed]>) {
    if (entry.kind !== 'directory' || HASH.test(name)) continue
    try {
      const handle = await root.getDirectoryHandle(name)
      const file = await handle.getFileHandle('group.json')
      const parsed = JSON.parse(await (await file.getFile()).text()) as { kind?: string; name?: string }
      if (parsed.kind === 'intelligence-group' && typeof parsed.name === 'string') names.push(parsed.name)
    } catch { /* a directory that is not a group */ }
  }
  return names.sort()
}

const parseMember = (text: string, argumentHash: string): { domain: string; answer: string } | null => {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length >= 2 && DOMAIN.test(lines[0]) && HASH.test(lines[1])) return { domain: lines[0], answer: lines[1] }
  if (lines.length === 1 && DOMAIN.test(lines[0])) return { domain: lines[0], answer: argumentHash }
  if (lines.length === 1 && HASH.test(lines[0])) return { domain: '', answer: lines[0] }
  return null
}

const memberOf = async (root: DirectoryHandle, group: string, hash: string): Promise<{ domain: string; answer: string } | null> => {
  try {
    const pool = await root.getDirectoryHandle(await poolAddress(group))
    const file = await pool.getFileHandle(hash)
    return parseMember(await (await file.getFile()).text(), hash)
  } catch {
    return null
  }
}

const readBytes = async (root: DirectoryHandle, answer: string): Promise<Uint8Array | null> => {
  try {
    const pool = await root.getDirectoryHandle(await poolAddress('answers'))
    const file = await pool.getFileHandle(answer)
    return new Uint8Array(await (await file.getFile()).arrayBuffer())
  } catch {
    return null
  }
}

/** Writes one file into the granted folder. The hive's one folder writer
 *  (FolderSyncService.writeGrantedFile) is the default, so the storage
 *  allowance stays in one place. With no writer, nothing is kept. */
export type IntelligenceWriter = (dir: DirectoryHandle, name: string, bytes: Uint8Array) => Promise<void>

const FOLDER_SYNC_KEY = '@diamondcoreprocessor.com/FolderSyncService'

const grantedWriter = (): IntelligenceWriter | null => {
  const service = (globalThis as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(FOLDER_SYNC_KEY) as
    { writeGrantedFile?: (dir: FileSystemDirectoryHandle, name: string, bytes: Uint8Array) => Promise<void> } | undefined
  if (!service?.writeGrantedFile) return null
  return (dir, name, bytes) => service.writeGrantedFile!(dir, name, bytes)
}

const bounded = (signal?: AbortSignal): AbortSignal => {
  const timeout = AbortSignal.timeout(8_000)
  if (!signal) return timeout
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout])
  return timeout
}

export type RecallOptions = {
  readonly signal?: AbortSignal
  readonly fetch?: typeof fetch
  readonly root?: DirectoryHandle | null
  readonly write?: IntelligenceWriter
}

/** The verified answer, or null when this ask is still open. */
export const recallIntelligence = async (args: unknown, options: RecallOptions = {}): Promise<string | null> => {
  try {
    const root = options.root === undefined ? await grantedIntelligenceRoot() : options.root
    if (!root) return null
    const hash = await hashArguments(args)
    let member: { domain: string; answer: string } | null = null
    for (const group of await groupsOf(root)) {
      member = await memberOf(root, group, hash)
      if (member) break
    }
    if (!member) return null
    const local = await readBytes(root, member.answer)
    if (local && await sha256Hex(local) === member.answer) {
      const text = new TextDecoder().decode(local)
      return text ? text : null
    }
    if (!member.domain) return null
    const response = await (options.fetch ?? fetch)(`https://${member.domain}/${member.answer}`, {
      signal: bounded(options.signal),
      cache: 'no-store',
    })
    if (!response.ok) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (await sha256Hex(bytes) !== member.answer) return null
    try {
      const write = options.write ?? grantedWriter()
      if (write) {
        const answers = await root.getDirectoryHandle(await poolAddress('answers'), { create: true })
        await write(answers, member.answer, bytes)
      }
    } catch { /* the pointer still answered; the copy can wait */ }
    const text = new TextDecoder().decode(bytes)
    return text ? text : null
  } catch {
    return null
  }
}

/** Record a finished answer in the granted folder. The bytes stay here until a host serves them. */
export const keepIntelligence = async (args: unknown, text: string, root?: DirectoryHandle | null, writer?: IntelligenceWriter): Promise<void> => {
  try {
    if (!text) return
    const write = writer ?? grantedWriter()
    if (!write) return
    const folder = root === undefined ? await grantedIntelligenceRoot() : root
    if (!folder) return
    const groups = await groupsOf(folder)
    const group = groups.includes('lineage-of-science') ? 'lineage-of-science' : groups[0]
    if (!group) return
    const hash = await hashArguments(args)
    const pool = await folder.getDirectoryHandle(await poolAddress(group), { create: true })
    try {
      await pool.getFileHandle(hash)
      return
    } catch { /* this ask is not a member yet */ }
    const bytes = new TextEncoder().encode(text)
    const answer = await sha256Hex(bytes)
    const answers = await folder.getDirectoryHandle(await poolAddress('answers'), { create: true })
    await write(answers, answer, bytes)
    await write(pool, hash, new TextEncoder().encode(`\n${answer}\n`))
  } catch { /* the model answer already stands */ }
}
