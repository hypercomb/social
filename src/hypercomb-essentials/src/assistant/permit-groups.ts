// assistant/permit-groups.ts
//
// PERMISSION GROUPS (documentation/permission-groups.md). What runs on arrival
// is said per actor, not once for every machine. The Execution queue's device
// policy was one mode and one set of kinds for everything that asked; it is
// now the `everyone` group, and a participant can put a conversation, a
// provider or a model into a group with a policy of its own:
//
//   permit hermes add provider hermes-local
//   permit hermes read
//
// ONE DOCUMENT, ONE POOL. The whole policy is one participant document in
// `permit:groups` (colon-scoped, kind document: per participant, never
// replicated, every version kept). Reads are synchronous, so the queue decides
// a row the moment it arrives.
//
// HOW A ROW IS DECIDED (`decide`, pure). The row's facts — its conversation,
// provider and model — pick every group with a member that matches them; none
// picks `everyone`. A kind runs on arrival only if EVERY picked group runs it:
// two groups never add up to more than either, so narrowing never widens.
// `held` is manual, so an actor dropped into it runs nothing by itself. The
// queue's holds (needsGrant, leaves, foreign) and forceReview come first, and
// no group lifts them.
//
// FAILS CLOSED WHILE THE POOL IS READ. Once the Store is known, nothing runs
// by policy until the document has been read: a provider the participant held
// must not slip through in the moment before its group arrives. When it
// arrives, the queue releases what the policy covers. Where no Store ever
// comes (a spec), the seeded value decides at once.
//
// SEEDED ONCE, NEVER WRITTEN BACK. Until the participant edits, `everyone` is
// what the old device keys say (`hc:execution:mode`, `hc:execution:auto`).
// Nothing is written to them again.
//
// ACTORS. A member is an actor vertex — the atom `{actor:1, <facet>:<value>}`,
// stored silently by signature — with the facet and label it matches. For a
// conversation, a provider or a model the label IS the value matched, so the
// queue matches without hashing. Bridge codes (`add code <label>`) need the
// broker to stamp who is speaking, which is not built yet.

import { SignatureService, isSignature } from '@hypercomb/core'
import { ParticipantDocument, type DocumentStoreLike } from '../preferences/participant-document.js'
import type { ExecutionKind, ExecutionMode } from './execution-queue.js'

export const PERMIT_GROUPS_IOC_KEY = '@hypercomb.social/PermitGroups'
export const PERMIT_POOL = 'permit:groups'

export type PermitFacet = 'conversation' | 'provider' | 'model'
export const PERMIT_FACETS: readonly PermitFacet[] = Object.freeze(['conversation', 'provider', 'model'])

/** `facet` is one of PERMIT_FACETS for every member this build makes. A facet
 *  it does not know (a later build's `code`) is kept as read and never matches,
 *  so an older build never erases what a newer one wrote. */
export type PermitMember = { readonly actor: string; readonly facet: string; readonly label: string }

export type PermitGroup = {
  readonly name: string
  readonly mode: ExecutionMode
  /** The kinds that run on arrival in `auto`. */
  readonly auto: readonly ExecutionKind[]
  readonly members: readonly PermitMember[]
}

export type PermitDocument = { readonly kind: 'permit@1'; readonly groups: readonly PermitGroup[] }

/** What a row brings that picks its groups: where it was asked, and by what. */
export type PermitFacts = { readonly convoId?: string; readonly providerId?: string; readonly model?: string }

export type PermitVerdict = {
  readonly run: boolean
  /** The groups the facts picked; `everyone` when none did. */
  readonly groups: readonly string[]
  /** Nothing ran by policy because the document is still being read. */
  readonly waiting?: boolean
}

export type PermitEdit = { readonly ok: true; readonly group: PermitGroup } | { readonly ok: false; readonly reason: string }

// The queue's own lists, repeated rather than imported: the queue imports this
// file at load, so a value import back would be a cycle. A spec holds them equal.
export const PERMIT_KINDS: readonly ExecutionKind[] = Object.freeze(['read', 'additive', 'editing', 'destructive'])
export const PERMIT_MODES: readonly ExecutionMode[] = Object.freeze(['manual', 'auto', 'everything'])

export const EVERYONE = 'everyone'
export const HELD = 'held'
/** Built in: always present, never dissolved. */
export const BUILT_IN_GROUPS: readonly string[] = Object.freeze([EVERYONE, HELD])
/** Kept for the chat window's "this conversation runs by itself", which still
 *  keeps its own switch (permission-groups.md, step 7). */
const RESERVED = 'trusted'
/** Words the `permit` line reads as something other than a group's name. */
const LINE_WORDS = new Set<string>([...PERMIT_KINDS, ...PERMIT_MODES, ...PERMIT_FACETS, 'add', 'drop', 'dissolve', 'code', 'this', 'all', 'none'])

const MODE_KEY = 'hc:execution:mode'
const AUTO_KEY = 'hc:execution:auto'
const STORE_KEY = '@hypercomb.social/Store'

/** Why a word cannot name a new group, or null when it can. */
export const groupNameProblem = (name: string): string | null => {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(name)) return 'a group is named in lowercase letters, digits and hyphens, starting with a letter'
  if (name === RESERVED) return '"trusted" is kept for the chat window\'s own "runs by itself" switch'
  if (LINE_WORDS.has(name)) return `"${name}" is a word the line reads, so it cannot name a group`
  return null
}

/** `everyone` as the old device keys left it: in the participant's own domain
 *  every kind runs (execution-queue.ts), unless the device ever chose. */
const legacyEveryone = (): PermitGroup => {
  let mode: ExecutionMode = 'auto'
  let auto: readonly ExecutionKind[] = PERMIT_KINDS
  try {
    const stored = globalThis.localStorage?.getItem(MODE_KEY)
    if (PERMIT_MODES.includes(stored as ExecutionMode)) mode = stored as ExecutionMode
    const kinds = globalThis.localStorage?.getItem(AUTO_KEY)
    if (typeof kinds === 'string') {
      const list: unknown = JSON.parse(kinds)
      if (Array.isArray(list)) auto = PERMIT_KINDS.filter(kind => list.includes(kind))
    }
  } catch { /* defaults */ }
  return { name: EVERYONE, mode, auto, members: [] }
}

const emptyHeld = (): PermitGroup => ({ name: HELD, mode: 'manual', auto: [], members: [] })

const seeded = (): PermitDocument => ({ kind: 'permit@1', groups: [legacyEveryone(), emptyHeld()] })

const parseMember = (raw: unknown): PermitMember | null => {
  if (!raw || typeof raw !== 'object') return null
  const { actor, facet, label } = raw as Record<string, unknown>
  if (!isSignature(actor) || typeof facet !== 'string' || !/^[a-z]+$/.test(facet)) return null
  if (typeof label !== 'string' || !label.trim()) return null
  return { actor, facet, label: label.trim() }
}

/** Read a document off disk. The built-ins are always there, `everyone` takes
 *  no members and `held` is always manual — whatever the bytes say, dropping an
 *  actor must never widen it. A group this build would not let a participant
 *  name (`trusted`, kept for a later step) is still kept as read. */
export const parsePermit = (raw: unknown): PermitDocument | null => {
  if (!raw || typeof raw !== 'object' || (raw as { kind?: unknown }).kind !== 'permit@1') return null
  const list = (raw as { groups?: unknown }).groups
  if (!Array.isArray(list)) return null
  const groups: PermitGroup[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const name = typeof record['name'] === 'string' ? record['name'] : ''
    if (groups.some(group => group.name === name)) continue
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(name)) continue
    const mode = PERMIT_MODES.includes(record['mode'] as ExecutionMode) ? record['mode'] as ExecutionMode : 'manual'
    const auto = Array.isArray(record['auto']) ? PERMIT_KINDS.filter(kind => (record['auto'] as unknown[]).includes(kind)) : []
    const members = Array.isArray(record['members'])
      ? (record['members'] as unknown[]).map(parseMember).filter((member): member is PermitMember => member !== null)
      : []
    if (name === EVERYONE) groups.push({ name, mode, auto, members: [] })
    else if (name === HELD) groups.push({ name, mode: 'manual', auto: [], members })
    else groups.push({ name, mode, auto, members })
  }
  if (!groups.some(group => group.name === EVERYONE)) groups.unshift(legacyEveryone())
  if (!groups.some(group => group.name === HELD)) groups.push(emptyHeld())
  return { kind: 'permit@1', groups }
}

/** The kinds a group runs on arrival. */
export const kindsRun = (group: PermitGroup): ReadonlySet<ExecutionKind> =>
  group.mode === 'everything' ? new Set(PERMIT_KINDS) : group.mode === 'auto' ? new Set(group.auto) : new Set()

const factOf = (facet: PermitFacet, facts: PermitFacts): string =>
  String((facet === 'conversation' ? facts.convoId : facet === 'provider' ? facts.providerId : facts.model) ?? '').trim().toLowerCase()

const matches = (member: PermitMember, facts: PermitFacts): boolean => {
  if (!PERMIT_FACETS.includes(member.facet as PermitFacet)) return false
  const value = factOf(member.facet as PermitFacet, facts)
  return !!value && value === member.label.toLowerCase()
}

/** The groups a row's facts pick: every group with a member that matches,
 *  else `everyone`. */
export const groupsFor = (doc: PermitDocument, facts: PermitFacts): readonly PermitGroup[] => {
  const picked = doc.groups.filter(group => group.name !== EVERYONE && group.members.some(member => matches(member, facts)))
  return picked.length ? picked : doc.groups.filter(group => group.name === EVERYONE)
}

/** Run on arrival, or wait for a hand. Pure, so a verdict can be computed
 *  again from the document and the row. */
export const decide = (doc: PermitDocument, kind: ExecutionKind, facts: PermitFacts): PermitVerdict => {
  const picked = groupsFor(doc, facts)
  return { run: picked.length > 0 && picked.every(group => kindsRun(group).has(kind)), groups: picked.map(group => group.name) }
}

/** The actor atom's bytes: one facet, canonical, so the same actor is always
 *  the same signature. */
const actorBytes = (facet: PermitFacet, label: string): ArrayBuffer =>
  new TextEncoder().encode(JSON.stringify({ actor: 1, [facet]: label })).buffer as ArrayBuffer

type IocLike = { whenReady?: (key: string, cb: (value: unknown) => void) => void; get?: (key: string) => unknown }
const ioc = (): IocLike | undefined => (globalThis as { ioc?: IocLike }).ioc

/** The Store, however it arrives. A `whenReady` parked on a map the shell later
 *  replaces never fires, so this also looks for the service itself. */
const findStore = (ready: (store: DocumentStoreLike) => void): void => {
  let found = false
  const take = (value: unknown): void => {
    if (found || !value) return
    found = true
    ready(value as DocumentStoreLike)
  }
  try { ioc()?.whenReady?.(STORE_KEY, take) } catch { /* no map yet */ }
  const started = Date.now()
  const look = (): void => {
    if (found) return
    try { take(ioc()?.get?.(STORE_KEY)) } catch { /* no map yet */ }
    if (!found && Date.now() - started < 60_000) setTimeout(look, 250)
  }
  look()
}

export type PermitGroupsOptions = {
  /** How the Store is reached; a spec hands in its own, or one that never comes. */
  readonly whenStore?: (ready: (store: DocumentStoreLike) => void) => void
}

export class PermitGroupsStore extends EventTarget {
  readonly #doc: ParticipantDocument<PermitDocument>
  #store: DocumentStoreLike | undefined
  #reading = false

  constructor(options: PermitGroupsOptions = {}) {
    super()
    const whenStore = options.whenStore ?? findStore
    this.#doc = new ParticipantDocument<PermitDocument>({
      meaning: PERMIT_POOL,
      parse: parsePermit,
      empty: seeded(),
      whenStore: ready => whenStore(store => { this.#store = store; this.#reading = true; ready(store) }),
    })
    this.#doc.addEventListener('change', () => this.#changed())
    this.#doc.addEventListener('hydrated', () => { this.#reading = false; this.#changed() })
  }

  get document(): PermitDocument { return this.#doc.value }

  /** The pool is being read: nothing runs by policy until it answers. */
  get reading(): boolean { return this.#reading }

  groups(): readonly PermitGroup[] { return this.document.groups }

  group(name: string): PermitGroup | undefined {
    const key = name.trim().toLowerCase()
    return this.document.groups.find(group => group.name === key)
  }

  /** The group an actor sits in, by facet and label. */
  groupOf(facet: string, label: string): PermitGroup | undefined {
    const key = label.trim().toLowerCase()
    return this.document.groups.find(group => group.members.some(member => member.facet === facet && member.label.toLowerCase() === key))
  }

  decide(kind: ExecutionKind, facts: PermitFacts): PermitVerdict {
    const verdict = decide(this.document, kind, facts)
    return this.#reading ? { run: false, groups: verdict.groups, waiting: true } : verdict
  }

  /** `manual`, `everything`, or `auto` with exactly these kinds. A group not
   *  yet made is made. `held` runs nothing by itself, whatever is said. */
  setPolicy(name: string, mode: ExecutionMode, kinds?: readonly ExecutionKind[]): PermitEdit {
    const key = name.trim().toLowerCase()
    if (key === HELD) return { ok: false, reason: 'held runs nothing by itself; that is what holding an actor means' }
    if (!PERMIT_MODES.includes(mode)) return { ok: false, reason: `"${mode}" is not a mode` }
    const current = this.group(key) ?? this.#made(key)
    if ('reason' in current) return { ok: false, reason: current.reason }
    const auto = kinds ? PERMIT_KINDS.filter(kind => kinds.includes(kind)) : current.auto
    return this.#put({ ...current, mode, auto })
  }

  /** Put an actor into a group, taking it out of any other. A held actor is
   *  released only by `permit held drop <label>`, never by being added. */
  async addMember(name: string, facet: PermitFacet, label: string): Promise<PermitEdit> {
    const key = name.trim().toLowerCase()
    const value = label.trim()
    if (!value) return { ok: false, reason: 'say which one' }
    if (!PERMIT_FACETS.includes(facet)) return { ok: false, reason: `"${facet}" is not something a group can hold` }
    if (key === EVERYONE) return { ok: false, reason: 'everyone takes no members: it is whatever no group names' }
    if (key === HELD) return { ok: false, reason: `to hold it, say permit <its group> drop ${value}` }
    const sits = this.groupOf(facet, value)
    if (sits?.name === HELD) return { ok: false, reason: `${value} is held; permit held drop ${value} releases it first` }
    if (sits?.name === key) return { ok: true, group: sits }
    const target = this.group(key) ?? this.#made(key)
    if ('reason' in target) return { ok: false, reason: target.reason }
    const actor = await this.#mintActor(facet, value)
    // Read the document again after the await: an edit may have landed
    // meanwhile, and one that held this actor still holds it.
    if (this.groupOf(facet, value)?.name === HELD) return { ok: false, reason: `${value} is held; permit held drop ${value} releases it first` }
    const groups = this.document.groups.map(group => group.name === key ? group : withoutActor(group, facet, value))
    const base = groups.find(group => group.name === key) ?? target
    const next: PermitGroup = { ...base, members: [...base.members, { actor, facet, label: value }] }
    this.#write(groups.some(group => group.name === key) ? groups.map(group => group.name === key ? next : group) : [...groups, next])
    return { ok: true, group: next }
  }

  /** Take an actor out of a group. From any group it moves to `held`, never
   *  out to `everyone`; from `held` it is released. */
  drop(name: string, label: string): PermitEdit {
    const key = name.trim().toLowerCase()
    const value = label.trim().toLowerCase()
    const group = this.group(key)
    if (!group) return { ok: false, reason: `there is no group called ${key}` }
    const leaving = group.members.filter(member => member.label.toLowerCase() === value)
    if (!leaving.length) return { ok: false, reason: `${label.trim()} is not in ${key}` }
    const left = { ...group, members: group.members.filter(member => !leaving.includes(member)) }
    if (key === HELD) {
      this.#write(this.document.groups.map(entry => entry.name === HELD ? left : entry))
      return { ok: true, group: left }
    }
    const held = this.group(HELD) ?? emptyHeld()
    const nextHeld = { ...held, members: [...held.members, ...leaving] }
    this.#write(this.document.groups.map(entry => entry.name === key ? left : entry.name === HELD ? nextHeld : entry))
    return { ok: true, group: left }
  }

  /** A group goes; its members are held. The built-ins stay. */
  dissolve(name: string): PermitEdit {
    const key = name.trim().toLowerCase()
    if (BUILT_IN_GROUPS.includes(key)) return { ok: false, reason: `${key} is built in and stays` }
    const group = this.group(key)
    if (!group) return { ok: false, reason: `there is no group called ${key}` }
    const held = this.group(HELD) ?? emptyHeld()
    const nextHeld = { ...held, members: [...held.members, ...group.members] }
    this.#write(this.document.groups.filter(entry => entry.name !== key).map(entry => entry.name === HELD ? nextHeld : entry))
    return { ok: true, group: nextHeld }
  }

  #made(name: string): PermitGroup | { readonly reason: string } {
    const problem = groupNameProblem(name)
    return problem ? { reason: problem } : { name, mode: 'manual', auto: [], members: [] }
  }

  #put(group: PermitGroup): PermitEdit {
    const known = this.document.groups.some(entry => entry.name === group.name)
    this.#write(known ? this.document.groups.map(entry => entry.name === group.name ? group : entry) : [...this.document.groups, group])
    return { ok: true, group }
  }

  #write(groups: readonly PermitGroup[]): void {
    this.#doc.write({ kind: 'permit@1', groups })
    this.#changed()
  }

  /** The actor's signature, and its atom kept silently where a Store is. */
  async #mintActor(facet: PermitFacet, label: string): Promise<string> {
    const bytes = actorBytes(facet, label)
    const sig = await SignatureService.sign(bytes)
    const put = (this.#store as { putResource?: (blob: Blob, options?: { emit?: boolean }) => Promise<string> } | undefined)?.putResource
    if (put) {
      try { await put.call(this.#store, new Blob([bytes], { type: 'application/json' }), { emit: false }) } catch { /* the sig stands */ }
    }
    return sig
  }

  #changed(): void {
    this.dispatchEvent(new CustomEvent('change'))
  }
}

const withoutActor = (group: PermitGroup, facet: string, label: string): PermitGroup => {
  const key = label.toLowerCase()
  const members = group.members.filter(member => !(member.facet === facet && member.label.toLowerCase() === key))
  return members.length === group.members.length ? group : { ...group, members }
}

export const permitGroups = new PermitGroupsStore()
