// diamondcoreprocessor.com/assistant/context-groups.ts
//
// CONTEXT GROUPS — a named handful of tiles that get asked about together.
//
// THE SET IS CONTENT. THE GROUP IS IDENTITY. That distinction is the whole
// file, and it answers the question that produced it: what happens when two
// groups end up holding exactly the same tiles?
//
// A context's MEMBERS are signatures, so the set has a signature of its own —
// `setSignature` canonicalises (sorted, deduped) and hashes them. Two groups
// holding the same tiles therefore share a setSig, and that is a FEATURE, not
// a collision: the request they compose is byte-identical, so it dedupes,
// caches, and a responder that already read that closure knows it has.
//
// But they stay TWO GROUPS. A group is `{id, label, members}` — a name that
// POINTS AT a set — and two names may point at one set for as long as their
// owner finds both names useful. Nothing collapses them, because nothing
// about a group's identity is derived from its contents.
//
// It is the same split the rest of the system runs on: a layer's signature is
// content, a location is identity, and two locations may hold the same layer
// sig without becoming one place.
//
// The two acts a participant can take are therefore genuinely different, and
// the interface must not blur them:
//
//   START A NEW GROUP sharing tiles   → a new IDENTITY. Same members, new id,
//                                       new label. The old group is untouched.
//   ADD A TILE TO A GROUP             → the same identity, new CONTENT. The
//                                       id and label survive; the setSig does
//                                       not, because the set really did change.
//
// Groups are participant-local working state — which handful you are asking
// about right now — so they live in a pool, never in a layer. A group that
// deserves to be permanent is a COLLECTION, and that is a different act.

import { EffectBus, SignatureService, isSignature } from '@hypercomb/core'

/** Pool holding the named groups. Colon-scoped: a bare `context` would
 *  collide with any tile slugged "context", and the root is an untagged
 *  union of lineage bags and pools. */
export const GROUPS_POOL = 'context:groups'

/** One tile inside a group. The path names it on screen; the signature is
 *  what actually rides in a request. */
export interface ContextMember {
  readonly path: string
  readonly name: string
  readonly sig: string
}

export interface ContextGroup {
  readonly kind: 'context-group'
  /** Identity. Minted once, never derived from the members — which is what
   *  lets two groups hold the same tiles and stay two groups. */
  readonly id: string
  readonly label: string
  readonly members: readonly ContextMember[]
  readonly at: number
}

type StoreLike = {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string) => Promise<string | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
}

const store = (): StoreLike | undefined => get<StoreLike>('@hypercomb.social/Store')

/** THE SET'S OWN SIGNATURE — sorted and deduped first, so the order tiles
 *  were added in cannot change the payload's identity. Two groups holding
 *  the same tiles hash to the same value on purpose. */
export const setSignature = async (members: readonly ContextMember[]): Promise<string> => {
  const sigs = [...new Set(members.map(m => m.sig).filter(isSignature))].sort()
  if (!sigs.length) return ''
  return SignatureService.sign(new TextEncoder().encode(JSON.stringify(sigs)).buffer as ArrayBuffer)
}

const newGroupId = (): string => `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const readAll = async (): Promise<Record<string, ContextGroup>> => {
  const s = store()
  const pool = await s?.getPool?.(GROUPS_POOL)
  if (!pool || !s?.getPoolDoc) return {}
  try {
    const bytes = await s.getPoolDoc(pool)
    if (!bytes) return {}
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, ContextGroup> = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const group = value as Partial<ContextGroup>
      if (!Array.isArray(group?.members)) continue
      out[id] = {
        kind: 'context-group',
        id,
        label: String(group.label ?? ''),
        members: group.members.map(m => ({
          path: String(m?.path ?? ''),
          name: String(m?.name ?? ''),
          sig: String(m?.sig ?? ''),
        })),
        at: Number(group.at) || 0,
      }
    }
    return out
  } catch { return {} }
}

const writeAll = async (groups: Record<string, ContextGroup>): Promise<boolean> => {
  const s = store()
  const pool = await s?.getPool?.(GROUPS_POOL)
  if (!pool || !s?.putPoolDoc) return false
  const bytes = new TextEncoder().encode(JSON.stringify(groups)).buffer as ArrayBuffer
  const ok = await s.putPoolDoc(pool, bytes)
  if (ok) EffectBus.emit('context:groups-changed', { count: Object.keys(groups).length })
  return !!ok
}

/** Every group, newest first. */
export const listGroups = async (): Promise<ContextGroup[]> =>
  Object.values(await readAll()).sort((a, b) => b.at - a.at)

export const readGroup = async (id: string): Promise<ContextGroup | null> =>
  (await readAll())[String(id ?? '')] ?? null

/** START A NEW GROUP. Always a new identity, even when the members are
 *  identical to a group that already exists — that is the participant saying
 *  "these same tiles, asked about differently", and refusing them a second
 *  name would be the tool overruling them. */
export const startGroup = async (
  label: string,
  members: readonly ContextMember[],
): Promise<ContextGroup | null> => {
  const groups = await readAll()
  const group: ContextGroup = {
    kind: 'context-group',
    id: newGroupId(),
    label: String(label ?? '').trim() || 'context',
    members: [...members],
    at: Date.now(),
  }
  groups[group.id] = group
  return (await writeAll(groups)) ? group : null
}

/** ADD TO AN EXISTING GROUP — same identity, new content. The set signature
 *  changes because the set changed; the id and the label do not. */
export const addToGroup = async (id: string, member: ContextMember): Promise<ContextGroup | null> => {
  const groups = await readAll()
  const group = groups[String(id ?? '')]
  if (!group) return null
  if (group.members.some(m => m.sig === member.sig && m.path === member.path)) return group
  const next: ContextGroup = { ...group, members: [...group.members, member], at: Date.now() }
  groups[next.id] = next
  return (await writeAll(groups)) ? next : null
}

export const removeFromGroup = async (id: string, path: string): Promise<ContextGroup | null> => {
  const groups = await readAll()
  const group = groups[String(id ?? '')]
  if (!group) return null
  const next: ContextGroup = { ...group, members: group.members.filter(m => m.path !== path), at: Date.now() }
  groups[next.id] = next
  return (await writeAll(groups)) ? next : null
}

/** Rename — the whole point of two groups over one set is that their names
 *  differ, so renaming is a first-class act rather than an edit. */
export const renameGroup = async (id: string, label: string): Promise<ContextGroup | null> => {
  const groups = await readAll()
  const group = groups[String(id ?? '')]
  if (!group) return null
  const next: ContextGroup = { ...group, label: String(label ?? '').trim() || group.label }
  groups[next.id] = next
  return (await writeAll(groups)) ? next : null
}

export const deleteGroup = async (id: string): Promise<boolean> => {
  const groups = await readAll()
  if (!groups[String(id ?? '')]) return true
  delete groups[String(id ?? '')]
  return writeAll(groups)
}

/** Groups holding a given tile — what the sidebar reads to draw a tile as
 *  part of something. A tile may be in several, and being in one never stops
 *  it having its own solo conversation. */
export const groupsHolding = (groups: readonly ContextGroup[], path: string): ContextGroup[] =>
  groups.filter(group => group.members.some(member => member.path === path))

// ── the seam to the shell ──────────────────────────────────────────────
export class ContextGroups {
  readonly listGroups = listGroups
  readonly readGroup = readGroup
  readonly startGroup = startGroup
  readonly addToGroup = addToGroup
  readonly removeFromGroup = removeFromGroup
  readonly renameGroup = renameGroup
  readonly deleteGroup = deleteGroup
  readonly setSignature = setSignature
  readonly groupsHolding = groupsHolding
}

export const CONTEXT_GROUPS_IOC_KEY = '@diamondcoreprocessor.com/ContextGroups'

window.ioc.register(CONTEXT_GROUPS_IOC_KEY, new ContextGroups())
