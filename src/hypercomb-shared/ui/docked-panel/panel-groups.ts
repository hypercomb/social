// hypercomb-shared/ui/docked-panel/panel-groups.ts
//
// Tool-window GROUPS — the model behind the settings gear in every docked
// panel's header (hc-docked-panel.directive.ts builds that chrome).
//
// A group is JUST TEXT. Type the same word into two windows and they move
// together; type nothing and a window is on its own. There is no registry, no
// group objects, no badges — matching text IS the grouping, which is why a
// group may span dock sides and needs no creating, naming or deleting.
//
// Windows in the same group share attributes — right now the width, and the
// record is deliberately shaped so more attributes can join later without a new
// storage key.
//
// Two records, both participant-local (localStorage — nothing here is content,
// so nothing here is signed): each window's group text (`hc:panel-group:<window>`)
// and each group's shared attributes (`hc:panel-group-attrs:<text>`). Module
// scope, no service: the directive is already self-contained chrome.

/** Attributes a group shares across its members. New shared attributes are
 *  added HERE (and to a member's `adopt`) — stored as one JSON blob per group,
 *  so growing it needs no new key or migration. */
export type GroupAttrs = { width?: number }

/** A live tool window, as the sharing cares about it. The directive implements
 *  this; `adopt` is where a member clamps an incoming attribute to its own
 *  limits, so a window that cannot go that wide sits at its limit rather than
 *  breaking layout. */
export interface GroupMember {
  readonly group: string
  attrs(): GroupAttrs
  adopt(attrs: GroupAttrs): void
}

/** Steel hairline — the cold/clean chrome convention shared with the header /
 *  command line, so every docked panel's chrome reads identically. */
export const STEEL = '126, 182, 214'

export const memberKey = (window: string): string => `hc:panel-group:${window}`
export const attrsKey = (group: string): string => `hc:panel-group-attrs:${group}`

// ── pairing ──────────────────────────────────────────────────────────
//
// A window can bring ANOTHER up alongside it, because some gestures need two
// windows on screen: a pheromone is dragged from the pheromone panel onto a row
// of the notes window, so opening notes with no pheromones in reach is opening
// half of a tool. The pairing is ON by default for the windows that declare one
// and is a plain participant-local switch in the window's settings gear.
//
// It fires only when the window OPENS, and only into a FREE place in the lane.
// Close the paired window and it stays closed — a default is an opening move,
// not an argument.

export const pairKey = (window: string): string => `hc:panel-pair:${window}`

/** Does this window bring its pair up? Default ON — the declared pairings exist
 *  because the two windows are halves of one gesture. */
export const readPairing = (window: string): boolean => {
  try { return localStorage.getItem(pairKey(window)) !== '0' } catch { return true }
}

export const writePairing = (window: string, on: boolean): void => {
  try {
    if (on) localStorage.removeItem(pairKey(window))
    else localStorage.setItem(pairKey(window), '0')
  } catch { /* ignore */ }
}

/** Matching is on the trimmed text — trailing space is a typo, not a group. */
export const normalizeGroup = (text: string): string => text.trim()

// ── membership ───────────────────────────────────────────────────────
export const readMembership = (window: string): string => {
  try { return normalizeGroup(localStorage.getItem(memberKey(window)) ?? '') } catch { return '' }
}

export const writeMembership = (window: string, group: string): void => {
  try {
    if (group) localStorage.setItem(memberKey(window), group)
    else localStorage.removeItem(memberKey(window))
  } catch { /* ignore */ }
}

// ── shared attributes ────────────────────────────────────────────────
export const readGroupAttrs = (group: string): GroupAttrs => {
  if (!group) return {}
  try {
    const raw = localStorage.getItem(attrsKey(group))
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return (parsed && typeof parsed === 'object') ? parsed as GroupAttrs : {}
  } catch { return {} }
}

export const writeGroupAttrs = (group: string, attrs: GroupAttrs): void => {
  if (!group) return
  try { localStorage.setItem(attrsKey(group), JSON.stringify(attrs)) } catch { /* ignore */ }
}

/** Every mounted tool window. Attributes are pushed only across members whose
 *  group text MATCHES. */
export const members = new Set<GroupMember>()

/** Make `source`'s attributes its GROUP's, and push them to every other live
 *  member with the same text. Ungrouped windows publish nothing. */
export const publishAttrs = (source: GroupMember): void => {
  const group = source.group
  if (!group) return
  const attrs: GroupAttrs = { ...readGroupAttrs(group), ...source.attrs() }
  writeGroupAttrs(group, attrs)
  for (const member of members) {
    if (member !== source && member.group === group) member.adopt(attrs)
  }
}
