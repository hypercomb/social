// presentation/tiles/quick-tray.ring.ts
//
// THE SHELF RING — the shelf's saved groups, as pure functions.
//
// The shelf holds what you are carrying right now; the ring is every handful
// you chose to keep. A kept shelf is a context group (assistant/context-groups.ts,
// pool `context:groups`) — a named set of tiles by signature — so the ring adds
// no storage of its own: saving starts a new group, recalling reads one back.
// Only a tile the page lists by signature can be kept; one without a sig has
// nothing to name it by, so it stays on the shelf and out of the group.

import { SignatureService } from '@hypercomb/core'
import type { ContextGroup, ContextMember } from '../../assistant/context-groups.js'
import type { TrayEntry } from './quick-tray.entries.js'

const SIG = /^[0-9a-f]{64}$/
const TAG_PATH = 'tag:'

/** What names a tag as a member: the signature of `tag:<name>`. */
export const tagSignature = (name: string): Promise<string> =>
  SignatureService.sign(new TextEncoder().encode(TAG_PATH + name.trim().toLowerCase()).buffer as ArrayBuffer)

/** The kinds of shelf: one that holds only tags, and any other. */
export const shelfType = (group: Pick<ContextGroup, 'members'>): 'tags' | 'tiles' =>
  group.members.length > 0 && group.members.every(m => m.path.startsWith(TAG_PATH)) ? 'tags' : 'tiles'

/** The shelf's rows as group members. A row with no signature is left out. */
export const entriesToMembers = (entries: readonly TrayEntry[]): ContextMember[] =>
  entries.flatMap(entry =>
    entry.sig && SIG.test(entry.sig)
      ? [{ path: entry.kind === 'tag' ? TAG_PATH + entry.label : [...entry.sourceSegments, entry.label].join('/'), name: entry.label, sig: entry.sig }]
      : [])

/** A group's members back as shelf rows: the last path segment is the tile,
 *  the rest is the page it was taken from. */
export const membersToEntries = (members: readonly ContextMember[]): TrayEntry[] =>
  members.flatMap(member => {
    if (member.path.startsWith(TAG_PATH)) return [{ label: member.name, sourceSegments: [], sig: member.sig, kind: 'tag' as const }]
    const segments = member.path.split('/').filter(Boolean)
    const label = member.name || segments[segments.length - 1]
    if (!label) return []
    return [{ label, sourceSegments: segments.slice(0, -1), sig: member.sig }]
  })

/** The tags on the shelf, in the order they were taken: the bouquet it holds. */
export const bouquetOf = (entries: readonly TrayEntry[]): string[] =>
  entries.filter(entry => entry.kind === 'tag').map(entry => entry.label)
