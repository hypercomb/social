// hypercomb-essentials/src/sharing/publish-groups.ts
//
// PUBLISH GROUPS — the pure half (jwize 2026-10-10: "a behavior that you get
// to put tiles in, assign icons and colors in the hive itself"; top of the
// hive, select then tap, per layer). The drone (publish-groups.drone.ts) owns
// the strip, the reads and the writes; everything here is a decision it can be
// tested on without a hive.
//
// THE MODEL, in the doctrine's words — relations are marks the members wear,
// never a parent that holds them:
//
//   • the BEHAVIOUR is the deposit `publish:groups` on the layer, lit from the
//     Beehaviors panel like any other — while lit, the strip shows there;
//   • a GROUP is one `publish:group` record on that layer carrying its
//     appearance `{ meaning, name, icon, color }`. Its identity is
//     `groupSignature(meaning)` — DERIVED, never written into the payload:
//     `writeDecoration` declares every 64-hex string in a payload as a ref, and
//     a group signature names no bytes, so a host would 404 on it forever;
//   • a MEMBER is a child tile wearing that signature as an ordinary `group`
//     mark (pheromones/enrollment-acts.ts) — renaming or recolouring the group
//     never touches a member, because the meaning does not change.

/** The behaviour's deposit — lit per layer from the Beehaviors panel. */
export const PUBLISH_GROUPS_KIND = 'publish:groups'

/** One group's appearance, on the layer the group belongs to. */
export const PUBLISH_GROUP_KIND = 'publish:group'

/** Group meanings are scoped like every group meaning (`host:<zone>`,
 *  `site:<slug>`): a colon keeps them apart from every other family. */
export const PUBLISH_GROUP_FAMILY = 'publish'

/** A new group's glyph until the participant picks another. */
export const DEFAULT_GROUP_ICON = 'label'

/** The colours a group can wear — bright enough to read on the dark hive and
 *  on a bright theme, and each one far from the others. A new group takes the
 *  first one this layer is not using yet. */
export const GROUP_COLORS = ['#48c6ff', '#ffb020', '#3ddc84', '#ff6bd6', '#ff4d4d', '#b9a4ff'] as const

export interface PublishGroupAppearance {
  readonly meaning: string
  readonly name: string
  readonly icon: string
  readonly color: string
}

/** A group as read off a layer: its appearance plus the record carrying it
 *  (an edit writes the new record, then drops this one). */
export interface PublishGroup extends PublishGroupAppearance {
  readonly recordSig: string
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** A `publish:group` record's payload, or null when it is not one we can use.
 *  Defensive on purpose: records arrive from peers and older builds. */
export function parseGroupPayload(payload: unknown): PublishGroupAppearance | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  const meaning = typeof p['meaning'] === 'string' ? p['meaning'].trim() : ''
  if (!meaning.startsWith(PUBLISH_GROUP_FAMILY + ':') || meaning.length <= PUBLISH_GROUP_FAMILY.length + 1) return null
  const name = typeof p['name'] === 'string' ? p['name'].trim() : ''
  const icon = typeof p['icon'] === 'string' && p['icon'].trim() ? p['icon'].trim() : DEFAULT_GROUP_ICON
  const color = typeof p['color'] === 'string' && HEX_COLOR.test(p['color']) ? p['color'] : GROUP_COLORS[0]
  return { meaning, name, icon, color }
}

/** The layer's groups in slot order, ONE per meaning. An edit appends the new
 *  record before it removes the old, so for a moment both are in the slot —
 *  the later one is the edit, and it wins. */
export function groupsInSlotOrder(
  records: readonly { readonly sig: string; readonly kind: string; readonly payload?: unknown }[],
): PublishGroup[] {
  // `Map.set` on an existing key keeps its first position, so an edited group
  // stays where it was on the strip while its later record wins.
  const byMeaning = new Map<string, PublishGroup>()
  for (const record of records) {
    if (record.kind !== PUBLISH_GROUP_KIND) continue
    const appearance = parseGroupPayload(record.payload)
    if (appearance) byMeaning.set(appearance.meaning, { ...appearance, recordSig: record.sig })
  }
  return [...byMeaning.values()]
}

/** The tap. With tiles selected, the group takes the ones not in it yet; when
 *  every selected tile is ALREADY in it, the same tap takes them out — one
 *  gesture, both directions, like every mark toggle in the hive. */
export function decideTap(
  selected: readonly string[],
  members: ReadonlySet<string>,
): { readonly join: string[]; readonly leave: string[] } {
  const picked = [...new Set(selected.map(s => String(s ?? '').trim()).filter(Boolean))]
  if (picked.length === 0) return { join: [], leave: [] }
  const missing = picked.filter(label => !members.has(label))
  return missing.length > 0 ? { join: missing, leave: [] } : { join: [], leave: picked }
}

/** The first colour this layer's groups are not wearing — wrapping round when
 *  every one is taken. */
export function nextGroupColor(used: readonly string[]): string {
  const taken = new Set(used.map(c => c.toLowerCase()))
  return GROUP_COLORS.find(c => !taken.has(c)) ?? GROUP_COLORS[used.length % GROUP_COLORS.length]
}

/** A fresh meaning — unique, so two groups named alike on two layers (or one)
 *  are still two groups. The NAME is appearance and can change freely; the
 *  meaning is the identity the members wear and never changes. */
export function newGroupMeaning(random: () => number = Math.random, now: () => number = Date.now): string {
  const stamp = now().toString(36)
  const salt = Math.floor(random() * 0xffffff).toString(36).padStart(5, '0')
  return `${PUBLISH_GROUP_FAMILY}:${stamp}${salt}`
}
