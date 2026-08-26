// hypercomb-core/src/core/panels/panel-groups.ts
//
// Tool-window GROUPS — the model behind the settings gear in every docked
// panel's header (hc-docked-panel.directive.ts builds that chrome).
//
// A group is JUST TEXT. Type the same word into two windows and they move
// together; type nothing and a window is on its own. There is no registry, no
// group objects, no badges — matching text IS the grouping, which is why a
// group may span dock sides and needs no creating, naming or deleting.
//
// Windows in the same group share attributes — the width and the TEXT SIZE —
// and the record is deliberately shaped so more attributes can join later
// without a new storage key.
//
// Three records, all participant-local (localStorage — nothing here is content,
// so nothing here is signed): each window's group text (`hc:panel-group:<window>`),
// each group's shared attributes (`hc:panel-group-attrs:<text>`), and each
// window's own text size for when it is in no group (`hc:panel-text:<window>`).
// Module scope, no service: the directive is already self-contained chrome.

/** Attributes a group shares across its members. New shared attributes are
 *  added HERE (and to a member's `adopt`) — stored as one JSON blob per group,
 *  so growing it needs no new key or migration.
 *
 *  `text` is the content scale a window's body renders at. ABSENT means auto —
 *  the scale the panel derives from its own width. A member reads the
 *  difference between "no opinion" and "auto" from whether the KEY is there,
 *  which is why `adopt` tests `'text' in attrs` rather than the value.
 *
 *  `font` is a CODE_FONTS key, not a font stack: the key is what survives a
 *  stack being edited, a face being swapped for a better cut, or a family
 *  being dropped. ABSENT means the window has no opinion and inherits the
 *  --hc-code default from :root — which is why it, too, is read by key
 *  presence. `ligatures` rides with it, because it is a property of the face
 *  that was chosen rather than a separate taste.
 *
 *  `read` is a READ_FONTS key — the face PROSE renders in, the second half of
 *  a window's typography. Same rules as `font`: key not stack, absent means
 *  inherit :root's --hc-read. */
export type GroupAttrs = { width?: number; text?: number; font?: string; ligatures?: boolean; read?: string }

/** The text sizes a window (or a group) can be set to. AUTO — `null` — is the
 *  old behaviour: the content scales with the window's width. The rest hold it
 *  steady, which is the point: a window widened to read a long note should not
 *  also shout it.
 *
 *  A short fixed ladder rather than a slider or a px field: the number is a
 *  MULTIPLIER over each panel's own base size, so panels stay in proportion to
 *  each other, and there is nothing to type. */
export const TEXT_SIZES: readonly { key: string; label: string; scale: number | null }[] = [
  { key: 'auto', label: 'Auto', scale: null },
  { key: 'small', label: 'Small', scale: 0.85 },
  { key: 'normal', label: 'Normal', scale: 1 },
  { key: 'large', label: 'Large', scale: 1.15 },
  { key: 'larger', label: 'Larger', scale: 1.32 },
]

// ── the code font ────────────────────────────────────────────────────
//
// Which face a window READS CODE IN. Separate from --hc-mono, the UI mono that
// draws sig strings and chips: that one is monospace as a signal, a few
// characters at chrome size, and the system font is the right answer for it.
// This is the font you read whole blocks in, in a panel narrow enough that the
// measure matters, which is a different question with a different answer.
//
// A short ladder rather than a free font field: every entry here is a face the
// app can actually produce — two are shipped with it, two ship with Windows,
// and the last is whatever the participant's system already resolves. A typed
// font name that silently falls through to the fallback is a setting that lies
// about what it did.

/** One offered face. `stack` ends in `var(--hc-mono)` so a face that is not
 *  there degrades down the system chain rather than to bare `monospace`;
 *  `ligatures` is whether this face HAS any, which is what decides whether the
 *  switch is worth offering at all — a dead control is worse than no control.
 *
 *  No specimen string per face: the picker draws each NAME in the face it
 *  names, and the close-up in the picker's corner (CODE_SAMPLE) shows the
 *  characters at size for whichever one you are pointing at. A line of sample
 *  text under EVERY entry was the same question asked five times at once. */
export interface CodeFont {
  key: string
  label: string
  stack: string
  ligatures: boolean
}

/** What the picker's close-up shows for a code face: the characters a
 *  monospace font is actually judged on — the ones that get confused with each
 *  other, and an operator that ligates, so the ligature switch has something to
 *  demonstrate itself on. */
export const CODE_SAMPLE = 'Il1 O0o =>'

export const CODE_FONTS: readonly CodeFont[] = [
  { key: 'plex', label: 'IBM Plex Mono', stack: "'IBM Plex Mono', var(--hc-mono)", ligatures: false },
  { key: 'jetbrains', label: 'JetBrains Mono', stack: "'JetBrains Mono', var(--hc-mono)", ligatures: true },
  { key: 'cascadia', label: 'Cascadia Mono', stack: "'Cascadia Mono', var(--hc-mono)", ligatures: false },
  { key: 'consolas', label: 'Consolas', stack: 'Consolas, var(--hc-mono)', ligatures: false },
  { key: 'system', label: 'System', stack: 'var(--hc-mono)', ligatures: true },
]

/** What :root's --hc-code already resolves to. A window with no record renders
 *  in this WITHOUT holding a record — so changing the app's default later moves
 *  every window that never chose, and leaves every window that did. */
export const DEFAULT_CODE_FONT = 'plex'

export const codeFont = (key: string | undefined): CodeFont | undefined =>
  CODE_FONTS.find(f => f.key === key)

// ── the reading font ─────────────────────────────────────────────────
//
// Which face a window reads PROSE in — the other half of its typography.
// The tool-window shell sets everything in --hc-mono, which is right for
// chrome and wrong for sentences: an answer, a note, a paragraph of setup
// text should read as text. A window that has a reading surface renders it
// in `var(--hc-read)` and this ladder decides what that resolves to.
//
// No ligature switch here — that is a property of code faces; prose faces
// keep their designer's defaults.

/** One offered reading face. `stack` always ends in a var() so a face that is
 *  not present degrades down a declared chain, never to the UA default. Same
 *  rule as the code ladder: the name is the sample, the corner is the close-up. */
export interface ReadFont {
  key: string
  label: string
  stack: string
}

/** A reading face is judged on different things: the two cases, a descender,
 *  and the figures. */
export const READ_SAMPLE = 'Aa Gg 123'

export const READ_FONTS: readonly ReadFont[] = [
  { key: 'hive', label: 'Source Sans', stack: 'var(--hc-font)' },
  { key: 'system', label: 'System', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { key: 'serif', label: 'Georgia', stack: "Georgia, 'Iowan Old Style', 'Times New Roman', serif" },
  { key: 'mono', label: 'Match code', stack: 'var(--hc-code)' },
]

/** What :root's --hc-read resolves to — same contract as DEFAULT_CODE_FONT:
 *  a window that never chose inherits it live rather than pinning a copy. */
export const DEFAULT_READ_FONT = 'hive'

export const readFont = (key: string | undefined): ReadFont | undefined =>
  READ_FONTS.find(f => f.key === key)

export const fontKey = (window: string): string => `hc:panel-font:${window}`
export const ligaturesKey = (window: string): string => `hc:panel-ligatures:${window}`
export const readFontKey = (window: string): string => `hc:panel-read:${window}`

/** This window's chosen reading face, or `undefined` for "never chose". */
export const readReadFont = (window: string): string | undefined => {
  try {
    const raw = localStorage.getItem(readFontKey(window))
    return raw && readFont(raw) ? raw : undefined
  } catch { return undefined }
}

export const writeReadFont = (window: string, key: string | undefined): void => {
  try {
    if (key) localStorage.setItem(readFontKey(window), key)
    else localStorage.removeItem(readFontKey(window))
  } catch { /* ignore */ }
}

/** This window's chosen face, or `undefined` for "never chose" — the state that
 *  inherits the app default rather than pinning today's value of it. */
export const readCodeFont = (window: string): string | undefined => {
  try {
    const raw = localStorage.getItem(fontKey(window))
    return raw && codeFont(raw) ? raw : undefined
  } catch { return undefined }
}

export const writeCodeFont = (window: string, key: string | undefined): void => {
  try {
    if (key) localStorage.setItem(fontKey(window), key)
    else localStorage.removeItem(fontKey(window))
  } catch { /* ignore */ }
}

/** Ligatures OFF by default, for every face that has them. In a window where
 *  you read code you did NOT write, a `!==` redrawn as one glyph is a place to
 *  guess at what you are looking at; turning them on is one click for the
 *  people who prefer the face as its designer drew it. */
export const readLigatures = (window: string): boolean => {
  try { return localStorage.getItem(ligaturesKey(window)) === '1' } catch { return false }
}

export const writeLigatures = (window: string, on: boolean): void => {
  try {
    if (on) localStorage.setItem(ligaturesKey(window), '1')
    else localStorage.removeItem(ligaturesKey(window))
  } catch { /* ignore */ }
}

/** A live tool window, as the sharing cares about it. The directive implements
 *  this; `adopt` is where a member clamps an incoming attribute to its own
 *  limits, so a window that cannot go that wide sits at its limit rather than
 *  breaking layout. */
export interface PanelGroupMember {
  readonly group: string
  attrs(): GroupAttrs
  adopt(attrs: GroupAttrs): void
  /** Optional identity, so a mate's membership hint can NAME its group
   *  fellows across implementations (the `members` set is the one shared
   *  census; a member that stays anonymous simply isn't listed). */
  readonly memberId?: string
  memberLabel?(): string
}

/** Steel hairline — the cold/clean chrome convention shared with the header /
 *  command line, so every docked panel's chrome reads identically. */
export const STEEL = '126, 182, 214'

export const memberKey = (window: string): string => `hc:panel-group:${window}`
export const attrsKey = (group: string): string => `hc:panel-group-attrs:${group}`
export const textKey = (window: string): string => `hc:panel-text:${window}`

// ── text size ────────────────────────────────────────────────────────
//
// A window's own text size, for the windows that are in no group. A grouped
// window still keeps this record — it is what the group last handed it, so the
// window reopens at its group's size even if no mate is up to publish it.

/** This window's text scale: a number if it is pinned, `null` if the
 *  participant chose AUTO, `undefined` if they have never chosen at all.
 *
 *  The third case is not pedantry — it is the same distinction the group
 *  record already draws with `'text' in attrs`. A window that reads for a
 *  living declares a default (`defaultText`), and "never chosen" is the only
 *  state that default may fill: picking Auto has to survive a reload, not be
 *  read back as "no opinion" and overwritten by the default every time. */
export const readTextScale = (window: string): number | null | undefined => {
  try {
    const raw = localStorage.getItem(textKey(window))
    if (raw === null) return undefined
    if (raw === AUTO_TEXT) return null
    const n = parseFloat(raw)
    return Number.isFinite(n) && n > 0 ? n : undefined
  } catch { return undefined }
}

/** Auto is WRITTEN, not erased. Removing the key would put the window back in
 *  "never chosen" and hand it its default again on the next open. */
const AUTO_TEXT = 'auto'

export const writeTextScale = (window: string, scale: number | null): void => {
  try { localStorage.setItem(textKey(window), scale === null ? AUTO_TEXT : String(scale)) }
  catch { /* ignore */ }
}

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
export const members = new Set<PanelGroupMember>()

/** Make `source`'s attributes its GROUP's, and push them to every other live
 *  member with the same text. Ungrouped windows publish nothing. */
export const publishAttrs = (source: PanelGroupMember): void => {
  const group = source.group
  if (!group) return
  const attrs: GroupAttrs = { ...readGroupAttrs(group), ...source.attrs() }
  writeGroupAttrs(group, attrs)
  for (const member of members) {
    if (member !== source && member.group === group) member.adopt(attrs)
  }
}
