// sharing/host-directory.view.ts
//
// <hc-host-directory> — THE HOST DIRECTORY, AND THE SWITCHBOARD IN IT.
//
// A FULL-SCREEN DESK (jwize, 2026-11-04: "the host window needs to be full
// screen"). The same shape as the editor, keyboard and comfy desks: a slim
// header, the hosts you carry as a list down the left, and the selected host's
// packages in the middle. Hosts are not a publishing setting, and this is not
// Publish's screen — Publish is what goes OUT, a switch list in a docked panel;
// this is what comes IN. They meet in one link, the Publish button on a host.
//
// The rail lists this origin and every host you carry, each saying how many
// packages it carries and whether an update is waiting or the host is behind,
// the ones with an update first. One search box finishes into lines, one per
// matching domain or package. This origin is every package all of your hosts
// carry; a host is the same list filtered to what it carries, with a count
// beside each row of how many of your hosts carry that SAME signature. Nothing
// switches: on and off are by name path, and a package turned off is shaded
// everywhere it appears.
//
// PACKAGES ARE BRANCHES, AND BRANCHES ARE RECURSIVE. A row with parts inside
// it is walked into — the list becomes its children, with the way back above
// it — so a change deep in the tree is reached by walking down to it and taken
// there, without moving anything beside it.
//
// REVISIONS OPEN BESIDE THE LIST. Each row's revisions icon opens that
// package's revisions in a drawer at the right, newest first, gathered by
// signature across every host you carry — decoupled from where you looked, and
// the list stays where it was. Choose one and the change is taken. An older
// revision that would replace newer parts inside it says so first, and sends
// you to configure those parts one by one; taken anyway, the newer parts are
// hidden, not deleted, until the package is back on its latest revision.
//
// A framework-free custom element contributed through the ShellSurfaceRegistry
// (`element:` shape) — never an Angular class, never a tag in app.html. The
// hosts drone owns whether it is open (`hosts:render`) and the host pool
// (`hosts:add`, `hosts:remove`); the install port owns what runs; the static
// peers drone owns the creations a host serves. This file owns none of them.

import {
  EffectBus,
  I18N_IOC_KEY,
  INSTALL_IOC_KEY,
  attachDockedPanel,
  isWindowShowing,
  type DockedPanel,
  type I18nProvider,
  type InstallNode,
  type InstallProvider,
  type InstallRevision,
  type InstallSelection,
  type AttestationVerdict,
  type WindowSession,
} from '@hypercomb/core'
import { hostZone } from './community-hosts.js'
import { fetchHiveIndex, type HiveIndexResult, type HiveManifest } from './hive-pointer.js'
import { isReservedRootKey } from './hive-link.js'
import { publisherKeyHex } from './key-list.client.js'
import { hostOnlineBlock } from './host-online.js'
import { trustCode, trustedCodeDomains } from './code-trust.js'
import { attestPackage, readWitnessed } from './package-attestation.js'
import { readInstallFollow, type InstallFollow } from './update-scout.service.js'

export const HOST_DIRECTORY_SURFACE = 'hc-host-directory'
const OWNER = '@diamondcoreprocessor.com/HostDirectoryView'
/** The window id the hosts drone asks `isWindowShowing` about. */
export const HOST_DIRECTORY_WINDOW = 'hosts-panel'
const STYLE_ID = 'hc-host-directory-style'
/** Where the directory was when a change restarted the app — read once. */
const REOPEN_KEY = 'hc:hosts:reopen'
/** Your own host (the hosts drone hands it to host-sync, its one writer, on `hosts:own-host`). Read only
 *  here. */
const OWN_HOST_KEY = 'hc:nostrmesh:self-domain'
const SIG_RE = /^[a-f0-9]{64}$/

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** The dev shell registers its source catalog: its modules are its working
 *  tree, so a revision it takes is a pointer it follows, never code it runs. */
const runsSource = (): boolean => !!ioc('@hypercomb.social/DevSourceCatalog')

/** A caption, or its plain-English stand-in — `t()` echoes an unknown key. */
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const fill = (text: string): string =>
    params ? text.replace(/\{(\w+)\}/g, (whole, name) => String(params[name] ?? whole)) : text
  try {
    const text = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    return text && text !== key && !text.startsWith(`${key}.`) ? text : fill(fallback)
  } catch { return fill(fallback) }
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

const button = (className: string, text: string, label = ''): HTMLButtonElement => {
  const node = make('button', className, text)
  node.type = 'button'
  if (label) { node.setAttribute('aria-label', label); node.title = label }
  return node
}

const zoneOf = (raw: unknown): string => hostZone(raw)

/** A module is named `<sig>.js` in one record and `<sig>` in another. */
const bareSig = (sig: string): string => sig.trim().toLowerCase().replace(/.(?:js|json)$/, '')

// ── the pure part ────────────────────────────────────────────────────────────

const parentOf = (path: string): string =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

const within = (path: string, ancestor: string): boolean =>
  ancestor === '' || path === ancestor || path.startsWith(`${ancestor}/`)

/** The nearest branch ABOVE a path that is off, or `''`. */
export const offAbove = (path: string, off: ReadonlySet<string>): string => {
  for (let at = parentOf(path); at; at = parentOf(at)) if (off.has(at)) return at
  return ''
}

export type ServedTree = { root: string; nodes: InstallNode[] }

/**
 * WHICH ROOTS THIS WINDOW MAY OFFER (jwize 2026-10-11: "make the update
 * window honest"). A host can serve an older package than the one the
 * publisher you follow names — hypercomb.com did, for hours, after each
 * publish — and offering its tree sent the participant into the activation
 * gate's refusal ("not signed by a publisher you follow — visit hypercomb.com
 * to try it on its own domain"). Offered are only the root that publisher
 * names now, what runs here (the trunk and the picks over it), and any root
 * that publisher has been seen to name before (the attester's witnesses,
 * under the key followed now — every one a valid rollback).
 *
 * `named` is `''` while the window does not KNOW what the publisher names now
 * — then nothing is cut, as before this rule: a guess would hide the very root
 * the publisher just stamped (a stamp nobody here has witnessed yet).
 */
export const offerableRoots = (input: {
  named: string
  trunk: string | null
  picks: readonly string[]
  witnessed: Readonly<Record<string, string>>
  followed: string | null
}): ((root: string) => boolean) => (root: string): boolean =>
  !!root && (!input.named || root === input.named || root === input.trunk || input.picks.includes(root)
    || (!!input.followed && input.witnessed[root] === input.followed))

/**
 * What the followed publisher names NOW, from a FRESH attestation of the
 * installed build (`attestPackage(..., { fresh: true })`): the build itself
 * only when an index read just now named it ('current'), the build it names
 * instead when it does not, and `''` — unknown — for anything else. A 'held'
 * verdict is a witness from the past (it was named once), never an answer
 * about now, so it is unknown here.
 */
export const namedFromVerdict = (verdict: AttestationVerdict | null | undefined, installedSig: string): string => {
  if (!verdict) return ''
  if (verdict.ok) return verdict.witnessed === 'current' ? installedSig : ''
  return verdict.reason === 'not-named' && verdict.named ? verdict.named : ''
}

/** The root a shell with nothing installed should take. `announced` is what
 *  the scout last heard. A fresh verdict that names another root wins, so a
 *  page left open across a stamp cannot take the package the publisher has
 *  stopped naming. */
export const namedWhenUninstalled = (
  announced: string,
  verdict: AttestationVerdict | null | undefined,
): string => {
  if (verdict?.ok && verdict.witnessed === 'current') return announced
  if (verdict && !verdict.ok && verdict.reason === 'not-named' && verdict.named) return verdict.named
  return announced
}

export interface DirectoryRow {
  path: string
  name: string
  description: string
  /** The signature this row shows: what runs here, or what the host carries. */
  layerSig: string
  /** Turned on, and running here. */
  on: boolean
  /** Part of what runs here. */
  held: boolean
  /** The branch above that is off, which has to come on first. */
  blockedBy: string
  /** The publisher you follow has moved it — or something inside it. */
  update: boolean
  /** A revision you picked shapes it. */
  picked: boolean
  /** Newer parts inside it that an older revision is hiding. */
  hidden: number
  /** How many of your hosts carry this same signature at this path. */
  count: number
  children: number
}

/**
 * THE LIST, as data. `scope` is `''` for this origin — the union of what runs
 * here, what the followed publisher names, and every host's head that may be
 * offered (`offerable`; a host serving an older package is listed under its
 * own name only) — or a host, for what that host carries. `at` is the branch
 * walked into. A search reaches every depth beneath `at`; without one, the
 * list is `at`'s own children.
 */
export const directoryRows = (input: {
  scope: string
  at: string
  query: string
  running: readonly InstallNode[]
  picks: Readonly<Record<string, { hides: boolean }>>
  eclipsed: readonly string[]
  next: ServedTree | null
  carried: ReadonlyMap<string, ServedTree | null>
  off: ReadonlySet<string>
  moved: ReadonlySet<string> | null
  offerable?: (root: string) => boolean
}): DirectoryRow[] => {
  const here = new Map(input.running.map(node => [node.path, node]))
  const nodes = new Map<string, InstallNode>()
  const take = (list: readonly InstallNode[] | undefined): void => {
    for (const node of list ?? []) if (!nodes.has(node.path)) nodes.set(node.path, node)
  }
  const offered = (tree: ServedTree | null | undefined): boolean => !!tree && (!input.offerable || input.offerable(tree.root))
  if (input.scope) take(input.carried.get(input.scope)?.nodes)
  else { take(input.running); take(input.next?.nodes); for (const tree of input.carried.values()) if (offered(tree)) take(tree?.nodes) }

  const nextAt = new Map((input.next?.nodes ?? []).map(node => [node.path, node.layerSig]))
  const q = input.query.trim().toLowerCase()
  return [...nodes.values()]
    .filter(node => q
      ? node.path !== input.at && within(node.path, input.at)
        && (node.path.toLowerCase().includes(q) || node.description.toLowerCase().includes(q))
      : parentOf(node.path) === input.at)
    .map(node => {
      const held = here.has(node.path)
      const blockedBy = offAbove(node.path, input.off)
      let count = 0
      for (const tree of input.carried.values()) {
        if (tree?.nodes.some(other => other.path === node.path && other.layerSig === node.layerSig)) count++
      }
      const moved = input.moved
        ? input.moved.has(node.path)
        : nextAt.has(node.path) && nextAt.get(node.path) !== here.get(node.path)?.layerSig
      return {
        path: node.path,
        name: node.name,
        description: node.description,
        layerSig: node.layerSig,
        on: held && !input.off.has(node.path) && !blockedBy,
        held,
        blockedBy,
        update: !input.scope && moved,
        picked: !!input.picks[node.path],
        hidden: input.picks[node.path]?.hides
          ? input.eclipsed.filter(path => path !== node.path && within(path, node.path)).length
          : 0,
        count,
        children: node.children.length,
      }
    })
    .sort((a, b) => Number(b.on) - Number(a.on) || a.path.localeCompare(b.path))
}

export interface DomainRow {
  /** `''` for this origin, else the host. */
  zone: string
  label: string
  /** Top-level packages the domain lists. */
  count: number
  /** The build the followed publisher names now is waiting there. */
  update: boolean
  /** A host whose head is not the build the followed publisher names. */
  behind: boolean
}

/** A host is BEHIND when the head it serves is not the build the followed
 *  publisher names — known only once both are. */
export const hostBehind = (head: string, named: string): boolean => !!named && !!head && head !== named

/**
 * THE DOMAINS, as data — the directory's first screen. This origin carries an
 * update when the followed publisher names a build this hive does not run; a
 * host carries one when that named build is the head it serves, and is BEHIND
 * when it serves any other (`named` is that build, `''` while it is unknown).
 * Every domain is listed: a host with nothing new is still a host you carry,
 * and hiding it would read as removed. The ones with an update come first, in
 * their own order.
 */
export const domainRows = (input: {
  homeLabel: string
  zones: readonly string[]
  trunk: string | null
  next: ServedTree | null
  served: ReadonlyMap<string, ServedTree | null>
  count: (zone: string) => number
  named?: string
}): DomainRow[] => {
  const waiting = input.trunk && input.next && input.next.root !== input.trunk ? input.next.root : ''
  const signed = input.named ?? ''
  const rows: DomainRow[] = [
    { zone: '', label: input.homeLabel, count: input.count(''), update: !!waiting, behind: false },
    ...input.zones.map(zone => {
      const head = input.served.get(zone)?.root ?? ''
      return {
        zone,
        label: zone,
        count: input.count(zone),
        update: !!waiting && head === waiting,
        behind: hostBehind(head, signed),
      }
    }),
  ]
  return rows
    .map((row, order) => ({ row, order }))
    .sort((a, b) => Number(b.row.update) - Number(a.row.update) || a.order - b.order)
    .map(({ row }) => row)
}

/**
 * HOW MANY BRANCHES A HOST NAMES AS LIVE — the number on a host's Publish link.
 * Read from the participant's own signed index on that host, the same index
 * the Publish panel's first step reads, and by the same rule it uses for a
 * branch being open on a domain: the index names a head for it, and its entry
 * either lists no doors (it opens on every domain) or lists this one. Pointers
 * the index carries (`plan:…`, `install:…`) are never branches.
 */
export const publishedOn = (manifest: Pick<HiveManifest, 'roots' | 'doors'>, zone: string): number => {
  let count = 0
  for (const [key, head] of Object.entries(manifest.roots ?? {})) {
    if (isReservedRootKey(key) || !SIG_RE.test(String(head ?? '').toLowerCase())) continue
    const doors = manifest.doors?.[key]
    if (doors === undefined || doors.includes(zone)) count++
  }
  return count
}

/** What reading a host's index needs: the key a device already holds, and the index. */
export interface PublishedIo {
  key(): Promise<string>
  index(zone: string, pubkey: string): Promise<HiveIndexResult>
}

const publishedIo: PublishedIo = {
  // `known`: looking at a host never mints a key for a device that has none.
  key: () => publisherKeyHex({ known: true }),
  index: (zone, pubkey) => fetchHiveIndex(zone, pubkey),
}

/**
 * The count for one host, or null when it cannot be told: no key here, the
 * host did not answer, or its index did not verify. A host that answers 404
 * has no index of yours, which is a plain none published. Null is never read
 * as zero — an unreachable host is not an empty one.
 */
export async function publishedCount(zone: string, io: PublishedIo = publishedIo): Promise<number | null> {
  try {
    const pubkey = (await io.key()).trim().toLowerCase()
    if (!SIG_RE.test(pubkey)) return null
    const read = await io.index(zone, pubkey)
    if (read.ok) return publishedOn(read.manifest, zone)
    return read.reason === 'http' && read.status === 404 ? 0 : null
  } catch { return null }
}

/** The parts inside a path that one of its revisions would replace: every
 *  descendant running here whose signature that revision does not carry. */
export const replacedBeneath = (path: string, running: readonly InstallNode[], revision: readonly InstallNode[]): string[] => {
  const then = new Map(revision.filter(node => node.path !== path && within(node.path, path)).map(node => [node.path, node.layerSig]))
  return running
    .filter(node => node.path !== path && within(node.path, path) && then.get(node.path) !== node.layerSig)
    .map(node => node.path)
    .sort()
}

/** Every file a tree names, by bare signature: its layers and the bees they declare. */
export const filesOf = (nodes: readonly InstallNode[]): Set<string> => {
  const files = new Set<string>()
  for (const node of nodes) {
    if (node.layerSig) files.add(bareSig(node.layerSig))
    for (const bee of node.bees) files.add(bareSig(bee))
  }
  return files
}

/** How far one path's CHANGE has come: only the files of its subtree in the
 *  new tree that this hive did not already run. Update all reads back every
 *  file it already holds, and those are not the update. */
export const updateProgress = (
  path: string,
  next: readonly InstallNode[],
  had: ReadonlySet<string>,
  held: ReadonlySet<string>,
): { done: number; total: number } => {
  let done = 0
  let total = 0
  for (const sig of filesOf(next.filter(node => within(node.path, path)))) {
    if (had.has(sig)) continue
    total++
    if (held.has(sig)) done++
  }
  return { done, total }
}

/** Is a revision older than the one running? Only when both are listed —
 *  a revision is never called older than something the list cannot place. */
export const isOlder = (revisions: readonly InstallRevision[], chosen: string, running: string): boolean => {
  const at = revisions.findIndex(revision => revision.layer === running)
  const pick = revisions.findIndex(revision => revision.layer === chosen)
  return at >= 0 && pick > at
}

/** One line of a revision list: a revision as it was published under one name,
 *  on one date. A revision published under two names is two lines. */
export type RevisionEntry = { revision: InstallRevision; name: string; at: string }

/** Everything published under one name. */
export type RevisionGroup = { name: string; entries: RevisionEntry[] }

/**
 * REVISIONS BY NAME, THEN DATE. One heading per name, and every revision
 * published under it is appended there, newest first — a name that comes back
 * after another name still lands under its one heading. Headings are ordered
 * by their newest revision. Lines that name nothing (held here, or a member
 * with no label) form the last group, undated ones after every dated one.
 * `latest` — the revision the followed publisher names — leads, dated or not,
 * so the list's "latest" is what that publisher calls latest.
 */
export const revisionGroups = (revisions: readonly InstallRevision[], latest = ''): RevisionGroup[] => {
  const entries: (RevisionEntry & { order: number })[] = []
  revisions.forEach((revision, order) => {
    const named = new Map<string, string>()
    for (const source of revision.sources) {
      const name = (source.name ?? '').trim()
      if (!name) continue
      const held = named.get(name) ?? ''
      named.set(name, source.at > held ? source.at : held)
    }
    if (!named.size) named.set('', revision.at)
    for (const [name, at] of named) entries.push({ revision, name, at, order })
  })
  const newestFirst = (a: RevisionEntry & { order: number }, b: RevisionEntry & { order: number }): number => {
    const [leadsA, leadsB] = [!!latest && a.revision.layer === latest, !!latest && b.revision.layer === latest]
    if (leadsA !== leadsB) return leadsA ? -1 : 1
    if (a.at && b.at) return a.at === b.at ? a.order - b.order : b.at.localeCompare(a.at)
    if (!!a.at !== !!b.at) return a.at ? -1 : 1
    return a.order - b.order
  }
  entries.sort(newestFirst)
  // Entries are now newest first, so a group's first entry is its newest and
  // groups form in the order their newest revisions appear.
  const groups = new Map<string, RevisionGroup>()
  for (const { revision, name, at } of entries) {
    const group = groups.get(name) ?? { name, entries: [] }
    group.entries.push({ revision, name, at })
    groups.set(name, group)
  }
  const named = [...groups.values()].filter(group => group.name)
  const unnamed = groups.get('')
  if (!unnamed) return named
  // The lead stays first even when nothing names it.
  return latest && entries[0]?.revision.layer === latest && !entries[0].name ? [unnamed, ...named] : [...named, unnamed]
}

/**
 * THE REVISIONS THIS WINDOW OFFERS: each revision's sources cut to the roots
 * that may be offered (`offerableRoots`), a revision no such root carries
 * dropped, and the one `named` carries first. A source of the named root that
 * no host labels is labelled with the channel it was named on, so it heads
 * the channel's revisions instead of reading as "held here".
 */
export const offeredRevisions = (
  found: readonly InstallRevision[],
  offerable: (root: string) => boolean,
  named: string,
  channel: string,
): InstallRevision[] => {
  const kept = found
    .map(revision => ({
      ...revision,
      sources: revision.sources
        .filter(source => offerable(source.root))
        .map(source => source.root === named && !source.name && channel ? { ...source, name: channel } : source),
    }))
    .filter(revision => revision.sources.length)
  const lead = named ? kept.findIndex(revision => revision.sources.some(source => source.root === named)) : -1
  return lead > 0 ? [kept[lead]!, ...kept.slice(0, lead), ...kept.slice(lead + 1)] : kept
}

/** `2026-09-20 11:08` from an ISO stamp; the date alone when it has no time. */
export const revisionDate = (at: string): string =>
  at.length >= 16 && at[10] === 'T' ? `${at.slice(0, 10)} ${at.slice(11, 16)}` : at.slice(0, 10)

/** The roots to take a revision from, the trunk first when it carries it —
 *  the trunk needs no gate, and taking its own layer is no pick at all. */
export const rootsFor = (revision: InstallRevision, trunk: string | null): string[] => {
  const roots = [...new Set(revision.sources.map(source => source.root))]
  return trunk && roots.includes(trunk) ? [trunk, ...roots.filter(root => root !== trunk)] : roots
}

// ── the browser's pure part: picking, stacking, files, code ──────────────────
//
// The desk is a column browser, as the Finder's is: a plain click picks one
// line, ctrl/cmd-click adds or takes one away, shift-click extends from where
// the last pick was, and whatever is picked in a column opens the next one.

/** What is picked in one column, and where the last pick was (the anchor a
 *  shift-click extends from). */
export interface Picked { readonly keys: readonly string[]; readonly anchor: string | null }
export const NOTHING_PICKED: Picked = { keys: [], anchor: null }
export type PickMode = 'only' | 'toggle' | 'range'

/** The Finder's rules. `order` is the column as it is drawn, top to bottom. */
export function pickKey(picked: Picked, key: string, mode: PickMode, order: readonly string[]): Picked {
  if (mode === 'toggle') {
    return { keys: picked.keys.includes(key) ? picked.keys.filter(k => k !== key) : [...picked.keys, key], anchor: key }
  }
  if (mode === 'range' && picked.anchor !== null) {
    const from = order.indexOf(picked.anchor)
    const to = order.indexOf(key)
    if (from >= 0 && to >= 0) return { keys: order.slice(Math.min(from, to), Math.max(from, to) + 1), anchor: picked.anchor }
  }
  return { keys: [key], anchor: key }
}

/** Every line of a column, the anchor staying where it was. */
export const pickAll = (picked: Picked, order: readonly string[]): Picked =>
  ({ keys: [...order], anchor: picked.anchor !== null && order.includes(picked.anchor) ? picked.anchor : order[0] ?? null })

/** How a click or a key picks: shift extends, ctrl or cmd adds, nothing replaces. */
export const pickMode = (event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): PickMode =>
  event.shiftKey ? 'range' : (event.ctrlKey || event.metaKey) ? 'toggle' : 'only'

/** Only what is still on offer stays picked: a column that changed under a pick
 *  does not keep a line it no longer has. */
export const stillPicked = (picked: Picked, order: readonly string[]): Picked => {
  const keys = picked.keys.filter(key => order.includes(key))
  return keys.length === picked.keys.length ? picked : { keys, anchor: picked.anchor !== null && keys.includes(picked.anchor) ? picked.anchor : keys[0] ?? null }
}

/** A line of the stacked list: one package, however many of the stacked hosts
 *  carry it. `differs` — they do not all carry the SAME signature. */
export interface StackRow extends DirectoryRow {
  zones: readonly string[]
  differs: boolean
}

/**
 * SEVERAL HOSTS AS ONE LIST. Each host's own lines in, one line per package
 * out: the first host that lists a path supplies it, `zones` says who else
 * does, and `differs` says whether they disagree about the signature. The
 * order is the list's own — what runs first, then by path.
 */
export function stackRows(lists: ReadonlyArray<{ zone: string; rows: readonly DirectoryRow[] }>): StackRow[] {
  const merged = new Map<string, StackRow>()
  for (const { zone, rows } of lists) {
    for (const row of rows) {
      const seen = merged.get(row.path)
      if (!seen) { merged.set(row.path, { ...row, zones: [zone], differs: false }); continue }
      merged.set(row.path, {
        ...seen,
        zones: [...seen.zones, zone],
        differs: seen.differs || seen.layerSig !== row.layerSig,
        update: seen.update || row.update,
        count: Math.max(seen.count, row.count),
        children: Math.max(seen.children, row.children),
      })
    }
  }
  return [...merged.values()].sort((a, b) => Number(b.on) - Number(a.on) || a.path.localeCompare(b.path))
}

// ── the light on a package ───────────────────────────────────────────────────
//
// A package that is ON and has a newer version is not off and not current: it is
// lit, and dim — the dimmer the older the version running. (jwize, 2026-11-04:
// "it should be on but dim if there is a newer version and a spectrum based on
// how old.") The Update brings it to the newest; the manage menu turns it off,
// picks a revision, or opens its code in the columns.

/** How bright a package shows that is on with a newer version out: the freshest
 *  of those, the oldest, and one whose age could not be told. */
export const LIGHT_BRIGHTEST = 0.85
export const LIGHT_DIMMEST = 0.3
export const LIGHT_UNKNOWN = 0.55
/** The age at which a package is as dim as it gets. */
export const LIGHT_FAR_DAYS = 180

/** The brightness for a running version first seen at `stamp` (ms), `now` being
 *  ms too. Logarithmic, so the first days matter and the months do not crowd. */
export const ageLevel = (stamp: number | null, now: number): number => {
  if (stamp === null || !Number.isFinite(stamp)) return LIGHT_UNKNOWN
  const days = Math.max(0, (now - stamp) / 86_400_000)
  const along = Math.min(1, Math.log1p(days) / Math.log1p(LIGHT_FAR_DAYS))
  return LIGHT_BRIGHTEST - (LIGHT_BRIGHTEST - LIGHT_DIMMEST) * along
}

export interface Light {
  /** off · on and current · on with a newer version. */
  state: 'off' | 'on' | 'behind'
  /** 0 for off, 1 for current, else the spectrum. */
  level: number
}

/** What the bulb says of a row. `stamp` is when the running version first
 *  appeared, `undefined` while it has not been read. */
export const lightOf = (row: Pick<DirectoryRow, 'on' | 'update'>, stamp: number | null | undefined, now: number): Light =>
  !row.on ? { state: 'off', level: 0 }
    : row.update ? { state: 'behind', level: ageLevel(stamp ?? null, now) }
      : { state: 'on', level: 1 }

/** When the running layer first appeared on a host: the earliest date any host
 *  gave for it. null when no revision names it or none carries a date. */
export const runningStamp = (revisions: readonly InstallRevision[], running: string): number | null => {
  const mine = revisions.find(revision => revision.layer === running)
  if (!mine) return null
  const stamps = [mine.at, ...mine.sources.map(source => source.at)]
    .map(at => Date.parse(String(at ?? '')))
    .filter(Number.isFinite)
  return stamps.length ? Math.min(...stamps) : null
}

/** A code file a package declares, and the package that declares it. */
export interface FileRow { sig: string; path: string }

/**
 * THE FILES OF WHAT IS PICKED: the bees the picked packages declare, each once
 * per package that declares it. `nodes` are the layers as they were read; a
 * picked path with several versions across the stacked hosts lists the files
 * of every version, so nothing a host carries is hidden behind another.
 */
export function filesPicked(nodes: readonly InstallNode[], paths: readonly string[]): FileRow[] {
  const wanted = new Set(paths)
  const seen = new Set<string>()
  const files: FileRow[] = []
  for (const node of nodes) {
    if (!wanted.has(node.path)) continue
    for (const sig of node.bees) {
      const bare = bareSig(sig)
      if (!SIG_RE.test(bare) || seen.has(bare)) continue
      seen.add(bare)
      files.push({ sig: bare, path: node.path })
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path) || a.sig.localeCompare(b.sig))
}

/** What a code file calls itself: its first line, when that is a comment (the
 *  build writes `// @scope/name` there). '' when it is not. */
export const codeName = (text: string): string => {
  const first = text.slice(0, 400).split('\n', 1)[0]?.trim() ?? ''
  return first.startsWith('//') ? first.replace(/^\/\/+\s*/, '').slice(0, 90) : ''
}

/** The first `max` lines, and how many more there are. */
export const codeLines = (text: string, max: number): { lines: string[]; more: number } => {
  const all = text.split('\n')
  return { lines: all.slice(0, max), more: Math.max(0, all.length - max) }
}

// ── the element ──────────────────────────────────────────────────────────────

/** Mirrors HostCreationRow (static-peers.drone.ts). `offer` is sent back
 *  exactly as it arrived — only the drone knows how a plate becomes one. */
interface CreationRow {
  name: string
  title: string
  lineage: string
  host: string
  url: string
  publisherLabel: string
  offered: boolean
  offer: unknown | null
}

interface MineRow {
  name: string
  host: string
}

type View = 'domains' | 'revisions' | 'creations' | 'mine' | 'own'

/** How much of a code file is read, how many lines show at first, and how many
 *  files are read side by side in the matrix. */
const CODE_KEEP = 400_000
const CODE_LINES = 300
const CODE_PANELS = 6
interface CodeRead { name: string; text: string; size: number; cut: boolean }

/** The desks' shared doors (keyboard-desk, comfy-desk): the view modes that put
 *  the page behind a full-screen window to sleep, the back gesture, the input gate. */
const DESK_KEYS = {
  modes: '@diamondcoreprocessor.com/ModeRegistry',
  back: '@diamondcoreprocessor.com/BackGesture',
  gate: '@diamondcoreprocessor.com/InputGate',
} as const
type ModesShape = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void; releaseOwner?(owner: string): void }
type BackShape = { register(entry: { owner: string; back: () => void; active?: () => boolean }): () => void }
type GateShape = { lock(reason: string): void; unlock(reason: string): void }
/** The rail's own entry, beside the hosts: where your own host is set. */
const OWN_PANE = '#own'

type Warning = { revision: InstallRevision; replaced: string[]; picksBeneath: string[] }

/** THEIR CODE FROM THEN ON. Replicating a package from another domain means
 *  that domain's code runs your hive from the next restart — signatures prove
 *  the bytes are what it published, never what the code does. So the first
 *  time a domain's code would run here, the window says so and waits. A
 *  domain you accept is remembered in the `trust:code` pool — the same consent
 *  the activation prompt keeps (code-trust.ts); your own origin and the
 *  publisher you follow never ask. */
type CodeGate = { host: string; sig: string; go: () => void }

function readCodeTrust(): Set<string> {
  return new Set([...trustedCodeDomains()].map(zoneOf).filter(Boolean))
}

function writeCodeTrust(host: string): void {
  void trustCode(host)
}

/** The install port, or an older shell's port read as a tree one level deep. */
type Port = {
  install: InstallProvider
  /** Picks, revisions and paths — a shell whose runtime predates them lists
   *  top-level packages and turns them on and off, nothing more. */
  recursive: boolean
}

const port = (): Port | null => {
  const install = ioc<InstallProvider>(INSTALL_IOC_KEY)
  if (!install) return null
  return { install, recursive: typeof install.selection === 'function' && typeof install.pick === 'function' }
}

export class HostDirectoryElement extends HTMLElement {

  #panel: HTMLElement | null = null
  #dock: DockedPanel | null = null
  #cleanup: (() => void)[] = []
  #refs = new Map<string, HTMLElement>()

  /** The hosts drone's word: should the directory be showing? */
  #wanted = false
  #zones: string[] = []
  #loaded = false

  #scope = ''
  /** The host whose pane is open — `''` is this origin. Always one: a desk
   *  opens onto a host, never onto a shut list. */
  #section = ''
  #at = ''
  #query = ''
  /** The one row open at a time. */
  #opened = ''
  /** Every fresh open starts on this origin's pane. */
  #view: View = 'domains'
  /** What the desk holds while it is open, and lets go of when it closes. */
  #modes: ModesShape | null = null
  #releaseBack: (() => void) | null = null
  #deskCleanup: (() => void)[] = []
  /** The rail entry the keys just moved to: its button is new after the repaint. */
  #railFocus: string | null = null
  /** How many branches each host's signed index opens there — null when it
   *  could not be told. Read once per host per opening of the desk. */
  #published = new Map<string, number | null>()
  #publishedAsk = new Set<string>()
  /** Which opening of the desk this is — a read that outlives its opening is dropped. */
  #opening = 0
  /** THE BROWSER. The hosts stacked in the rail (`''` is this origin) — their
   *  packages are one list, and the search and every column read across them. */
  #stack: Picked = { keys: [''], anchor: '' }
  /** What is picked in each package column, left to right. */
  #cols: Picked[] = []
  /** The code files picked to be read in the matrix. */
  #files: Picked = NOTHING_PICKED
  /** The line the keys last moved to — focused again once the columns are redrawn. */
  #focusKey: string | null = null
  /** Code read by signature (null: asked of the hosts and not found). A signature
   *  is immutable, so what was read outlives an opening of the desk. */
  #code = new Map<string, CodeRead | null>()
  #codeAsk = new Set<string>()
  /** Files not held here: a host is not asked for one until it is picked. */
  #heldNot = new Set<string>()
  #codeFull = new Set<string>()
  #codePaint = 0
  /** The package whose manage menu is open (a path), or null. */
  #menu: string | null = null
  /** When the running version of a package first appeared — keyed by path and the
   *  layer running — for the light's age. null: it could not be told. */
  #ages = new Map<string, number | null>()
  #agesAsk = new Set<string>()
  #ageQueue: string[] = []
  #ageActive = 0
  #agePaint = 0
  /** The next open continues where an act left off (a restart, a notice)
   *  instead of collapsing. */
  #resume = false

  #selection: InstallSelection | null = null
  #next: ServedTree | null = null
  /** The root the followed publisher names — kept apart from #next, which is
   *  only set when a host can serve that root's tree. `''` while unknown. */
  #named = ''
  /** Which roots may be offered here (offerableRoots), as of the last read. */
  #offerable: (root: string) => boolean = () => true
  #announced = ''
  #moved: Set<string> | null = null
  #served = new Map<string, ServedTree | null>()
  #trees = new Map<string, Promise<ServedTree | null>>()
  #heads = new Map<string, Promise<void>>()
  #reading = false

  #revPath = ''
  #revisions: InstallRevision[] | null = null
  #warning: Warning | null = null
  #codeGate: CodeGate | null = null

  #creations = new Map<string, { rows: CreationRow[]; answered: boolean }>()
  #mine: MineRow[] = []

  #busy = ''
  #error = ''
  #restarting = false
  /** UPDATE ALL, MOVING: every CHANGED file held here since it was pressed, as
   *  the install port reports it. Null when no Update all is running. */
  #held: Set<string> | null = null
  /** What already ran here when Update all was pressed — never counted as the update. */
  #had: ReadonlySet<string> = new Set()
  #heldPaint = 0

  /** The domain this app runs on: never offered a Visit — a second tab on
   *  your own hive is a second writer on one store. */
  readonly #home = hostZone(location.host)

  readonly #session: WindowSession = {
    park: () => this.#unmount(),
    unpark: () => { if (this.#wanted) this.#mount() },
    dismiss: () => this.#back(),
    close: () => EffectBus.emit('hosts:close', {}),
  }

  connectedCallback(): void {
    installHostDirectoryStyles()
    facade.current = this
    this.#cleanup.push(
      EffectBus.on<{ open?: boolean; zones?: unknown; loaded?: boolean }>('hosts:render', (p) => {
        this.#zones = Array.isArray(p?.zones) ? p.zones.map(zoneOf).filter(Boolean) : []
        this.#loaded = !!p?.loaded
        if (this.#stack.keys.some(zone => zone && !this.#zones.includes(zone))) this.#toDomains()
        const wanted = !!p?.open
        if (wanted !== this.#wanted) {
          this.#wanted = wanted
          if (wanted) {
            if (!this.#resume) this.#toDomains()
            this.#resume = false
            this.#mount()
            void this.#read()
          } else this.#unmount()
        } else if (this.#panel) {
          this.#render()
          void this.#read()
        }
      }),
      // The notice, /upgrade and every "packages on this host" door land here.
      EffectBus.on<{ zone?: unknown }>('packages:open', (p) => {
        const zone = zoneOf(p?.zone)
        this.#toList(zone && zone !== this.#home ? zone : '', '')
        this.#resume = true
        if (this.#panel) this.#render()
        EffectBus.emit('hosts:open', {})
      }),
      EffectBus.on<{ available?: boolean; packageSig?: unknown; source?: unknown }>('update:available', (p) => {
        const sig = String(p?.packageSig ?? '').toLowerCase()
        if (p?.available && p.source === 'channel' && SIG_RE.test(sig) && sig !== port()?.install.installedSig()) this.#announced = sig
        if (this.#panel) void this.#read()
      }),
      EffectBus.on<{ zone?: unknown; rows?: CreationRow[]; answered?: boolean }>('hosts:creations:render', (p) => {
        const zone = zoneOf(p?.zone)
        if (!zone) return
        this.#creations.set(zone, { rows: Array.isArray(p?.rows) ? p.rows : [], answered: !!p?.answered })
        if (this.#view === 'creations') this.#renderBody()
      }),
      EffectBus.on<{ offers?: MineRow[] }>('community:offers-render', (p) => {
        this.#mine = Array.isArray(p?.offers) ? p.offers : []
        if (this.#panel) this.#render()
      }),
    )

    // A press on the hosts glyph while the desk is PARKED — an Escape sweep, or
    // another window opened over it — means "show it". The drone already says
    // open, so the render it emits changes nothing here and the press would be
    // lost; only a second sweep-restore could bring the desk back. A window
    // that is showing, or closed, is the drone's to open and close as before.
    // The bus replays the last press to a new listener, and a replay is no press.
    let live = false
    this.#cleanup.push(EffectBus.on('hosts:view-toggle', () => {
      if (live && this.#wanted && !this.#panel) { this.#mount(); void this.#read() }
    }))
    live = true

    // Back where a change restarted the app from: the list it was chosen in.
    try {
      const raw = sessionStorage.getItem(REOPEN_KEY)
      if (raw) {
        sessionStorage.removeItem(REOPEN_KEY)
        const where = JSON.parse(raw) as { scope?: unknown; at?: unknown }
        this.#toList(zoneOf(where.scope), typeof where.at === 'string' ? where.at : '')
        this.#resume = true
        queueMicrotask(() => EffectBus.emit('hosts:open', {}))
      }
    } catch { /* storage unavailable — opens fresh */ }
  }

  disconnectedCallback(): void {
    for (const off of this.#cleanup.splice(0)) off()
    this.#unmount()
    if (facade.current === this) facade.current = null
  }

  get open(): boolean { return this.#panel !== null }

  // ── the window ───────────────────────────────────────────────────────────

  #mount(): void {
    if (this.#panel) { this.#render(); return }
    const panel = make('aside', 'hd-panel')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', t('hosts.title', 'Host directory'))
    panel.setAttribute('data-consumes-wheel', '')
    panel.dataset['hcSheet'] = 'full'
    panel.tabIndex = -1

    const head = make('header', 'hd-head')
    head.append(make('span', 'hd-title', t('hosts.title', 'Host directory')), make('span', 'hd-grow'))
    const close = button('hd-close', '×', t('panel.close', 'close'))
    close.addEventListener('click', () => EffectBus.emit('hosts:close', {}))
    head.append(close)

    // THE RAIL: the search, the hosts, and a field to add one. The search and the
    // field are built once — a repaint redraws only the list between them, so a
    // read landing never takes the focus from a half-typed domain.
    const search = make('div', 'hd-search')
    const input = make('input', 'hd-input')
    input.type = 'search'
    input.addEventListener('input', () => {
      this.#query = input.value
      // A search is across every host: it leaves a branch walked into, for the matches.
      if (this.#query.trim() && this.#view !== 'domains') this.#view = 'domains'
      this.#renderBody()
    })
    search.append(input)
    const hosts = make('ul', 'hd-list hd-hosts')
    const side = make('nav', 'hd-side')
    side.setAttribute('aria-label', t('hosts.rail', 'Hosts you carry'))
    side.append(search, hosts, this.#addForm())
    side.addEventListener('keydown', event => this.#railKeys(event))
    // A click anywhere but the menu and its icon closes the menu, and still reaches what it was for.
    panel.addEventListener('click', event => {
      if (this.#menu === null || (event.target as HTMLElement).closest('.hd-menu, .hd-manage')) return
      this.#menu = null
      this.#renderBody()
    }, true)

    const main = make('section', 'hd-main')
    const drawer = make('aside', 'hd-drawer')
    drawer.hidden = true
    const frame = make('div', 'hd-frame')
    frame.append(side, main, drawer)

    panel.append(head, frame)
    this.#refs.set('search', search).set('input', input).set('hosts', hosts).set('side', side)
      .set('body', main).set('drawer', drawer).set('frame', frame)
    this.appendChild(panel)
    this.#panel = panel

    // A desk, as the editor, keyboard and comfy desks are: docked for the window
    // session, but it takes the whole page and sizes itself (see the styles).
    this.#dock = attachDockedPanel(panel, {
      id: HOST_DIRECTORY_WINDOW,
      launcherControlId: 'hosts',
      dockSide: 'right',
      dockExclusive: false,
      ownsSize: false,
      sizeOwner: { panelWidth: () => 400, setPanelWidth: () => undefined },
      defaultText: 1,
      hcSession: this.#session,
      onClose: () => EffectBus.emit('hosts:close', {}),
    })
    this.#claimDesk(panel)
    this.#render()
    requestAnimationFrame(() => panel.focus({ preventScroll: true }))
  }

  #unmount(): void {
    this.#opening++
    this.#menu = null
    this.#agesAsk.clear()
    this.#ageQueue = []
    this.#ageActive = 0
    for (const [key, stamp] of this.#ages) if (stamp === null) this.#ages.delete(key)
    this.#published.clear()
    this.#publishedAsk.clear()
    this.#releaseDesk()
    this.#dock?.dispose()
    this.#dock = null
    this.#panel?.remove()
    this.#panel = null
    this.#refs.clear()
  }

  /** What a full-screen window takes while it is up: the view modes (the page
   *  behind sleeps, the controls stay), the keymap and the input gate, the back
   *  gesture — and Escape, which unwinds this desk before the hive's own keys. */
  #claimDesk(panel: HTMLElement): void {
    this.#claimModes(panel)
    EffectBus.emit('keymap:suppress', { reason: HOST_DIRECTORY_WINDOW })
    ioc<GateShape>(DESK_KEYS.gate)?.lock(HOST_DIRECTORY_WINDOW)
    this.#releaseBack = ioc<BackShape>(DESK_KEYS.back)?.register({
      owner: HOST_DIRECTORY_WINDOW,
      active: () => this.#panel !== null,
      back: () => { if (!this.#back()) EffectBus.emit('hosts:close', {}) },
    }) ?? null

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
      // The hive's keymap hears it first and unwinds one rung through the window
      // session (dismiss → #back). A second unwind from here would take two rungs
      // for one press — the drawer, and then the whole desk.
      if (event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      const target = event.target
      const typing = target instanceof HTMLElement && !!target.closest('input, textarea')
      // A search in the box clears first; any other field just lets go.
      if (typing && !(this.#query && target === this.#refs.get('input'))) { (target as HTMLElement).blur(); return }
      if (!this.#back()) EffectBus.emit('hosts:close', {})
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    this.#deskCleanup.push(() => window.removeEventListener('keydown', onKeyDown, { capture: true }))
    // A field that lets go hands the focus back to the desk, so Escape is heard here.
    const onFocusOut = (event: FocusEvent): void => {
      if (event.relatedTarget) return
      requestAnimationFrame(() => {
        if (this.#panel === panel && document.activeElement === document.body) panel.focus({ preventScroll: true })
      })
    }
    panel.addEventListener('focusout', onFocusOut)
  }

  #releaseDesk(): void {
    const attempt = (what: () => void): void => {
      try { what() } catch (error) { console.warn('[host-directory] teardown step failed', error) }
    }
    const modes = this.#modes
    this.#modes = null
    if (modes) attempt(() => {
      if (modes.releaseOwner) { modes.releaseOwner(HOST_DIRECTORY_WINDOW); return }
      modes.exit('view:active', HOST_DIRECTORY_WINDOW)
      modes.exit('view:keeps-controls', HOST_DIRECTORY_WINDOW)
    })
    attempt(() => EffectBus.emit('keymap:unsuppress', { reason: HOST_DIRECTORY_WINDOW }))
    attempt(() => ioc<GateShape>(DESK_KEYS.gate)?.unlock(HOST_DIRECTORY_WINDOW))
    attempt(() => this.#releaseBack?.())
    this.#releaseBack = null
    for (const off of this.#deskCleanup.splice(0)) attempt(off)
  }

  /** A host is added at the foot of the rail — the hosts drone owns the pool,
   *  and the new row arrives on its next render. */
  #addForm(): HTMLFormElement {
    const add = make('form', 'hd-add')
    const field = make('input', 'hd-add-input')
    field.type = 'text'
    field.autocomplete = 'off'
    field.spellcheck = false
    field.placeholder = t('packages.add-placeholder', 'add a domain')
    field.setAttribute('aria-label', t('packages.add', 'Add a domain'))
    const go = make('button', 'hd-quiet', t('packages.add-go', 'Add'))
    go.type = 'submit'
    add.append(field, go)
    add.addEventListener('submit', (event) => {
      event.preventDefault()
      const zone = zoneOf(field.value)
      if (!zone) { field.setAttribute('aria-invalid', 'true'); field.focus(); return }
      field.removeAttribute('aria-invalid')
      EffectBus.emit('hosts:add', { zone })
      field.value = ''
    })
    return add
  }

  /** The view modes: the page behind a full-screen window sleeps and the controls
   *  stay. The registry may not be up yet, so a late one is claimed when it is. */
  #claimModes(panel: HTMLElement): void {
    const claim = (modes: ModesShape): void => {
      this.#modes = modes
      modes.enter('view:keeps-controls', HOST_DIRECTORY_WINDOW)
      modes.enter('view:active', HOST_DIRECTORY_WINDOW)
    }
    const modes = ioc<ModesShape>(DESK_KEYS.modes)
    if (modes) { claim(modes); return }
    ;(window as { ioc?: { whenReady?: (k: string, cb: (v: unknown) => void) => void } }).ioc
      ?.whenReady?.(DESK_KEYS.modes, value => { if (this.#panel === panel && !this.#modes) claim(value as ModesShape) })
  }

  /** Arrow keys walk the rail, and the pane follows the focus. Typing in the
   *  search or the add field is left alone. */
  #railKeys(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const target = event.target
    if (!(target instanceof HTMLElement) || target.closest('input')) return
    const items = [...(this.#refs.get('hosts')?.querySelectorAll<HTMLButtonElement>('button.hd-domain') ?? [])]
    const at = items.indexOf(target as HTMLButtonElement)
    if (at < 0) return
    event.preventDefault()
    const next = items[Math.max(0, Math.min(items.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]
    if (!next || next === target) return
    this.#railFocus = next.dataset['pane'] ?? ''
    // The hosts walked past are picked as the Finder picks them: shift extends the stack.
    if (this.#railFocus === OWN_PANE) { this.#selectOwn(); return }
    this.#pickHost(this.#railFocus, event.shiftKey ? 'range' : 'only', items.map(item => item.dataset['pane'] ?? '').filter(pane => pane !== OWN_PANE))
  }

  /** Back to the start: this origin alone, nothing picked, the search cleared. */
  #toDomains(): void {
    this.#stack = { keys: [''], anchor: '' }
    this.#section = ''
    this.#scope = ''
    this.#cols = []
    this.#files = NOTHING_PICKED
    this.#at = ''
    this.#query = ''
    this.#view = 'domains'
    this.#warning = null
    this.#opened = ''
    this.#error = ''
  }

  /** One host, its columns open down to a path inside it: each level of the
   *  path picked, so the parts of the path itself are the column that opens. */
  #toList(scope: string, at: string): void {
    this.#stack = { keys: [scope], anchor: scope }
    this.#section = scope
    this.#scope = scope
    this.#cols = this.#chainTo(at)
    this.#files = NOTHING_PICKED
    this.#at = at
    this.#view = 'domains'
    this.#warning = null
    this.#opened = ''
    this.#error = ''
  }

  /** The picks that lead down a path: one per level. */
  #chainTo(at: string): Picked[] {
    if (!at) return []
    const segments = at.split('/')
    return segments.map((_, level) => {
      const key = segments.slice(0, level + 1).join('/')
      return { keys: [key], anchor: key }
    })
  }

  /** A host picked in the rail, as the Finder picks: a click takes one, ctrl/cmd
   *  stacks another, shift stacks the run between. The hosts stacked are one
   *  list in every column and one scope for the search. */
  #pickHost(zone: string, mode: PickMode, order: readonly string[]): void {
    const before = this.#stack.keys.join('\n')
    let stack = pickKey(this.#stack, zone, mode, order)
    // The desk always looks at something: the last host cannot be taken away.
    if (!stack.keys.length) stack = { keys: [zone], anchor: zone }
    this.#stack = stack
    this.#section = stack.keys[0] ?? ''
    this.#scope = this.#section
    this.#view = 'domains'
    this.#query = ''
    this.#warning = null
    this.#error = ''
    // A different stack is a different list, so the columns start again.
    if (stack.keys.join('\n') !== before) { this.#cols = []; this.#files = NOTHING_PICKED; this.#at = '' }
    this.#render()
  }

  /** The rail's own entry: where your own host is set. */
  #selectOwn(): void {
    this.#view = 'own'
    this.#query = ''
    this.#warning = null
    this.#error = ''
    this.#render()
  }

  /** Escape unwinds one level, innermost first: the search, the question, the
   *  warning, the drawer or a pane opened over the columns, the code being read,
   *  then the deepest column's pick. With nothing picked it has nothing, and
   *  closes the desk. */
  #back(): boolean {
    if (this.#menu !== null) { this.#menu = null; this.#renderBody(); return true }
    if (this.#query) { this.#query = ''; this.#render(); return true }
    if (this.#codeGate) { this.#codeGate = null; this.#renderBody(); return true }
    if (this.#warning) { this.#warning = null; this.#renderBody(); return true }
    if (this.#view !== 'domains') { this.#view = 'domains'; this.#render(); return true }
    if (this.#files.keys.length) { this.#files = NOTHING_PICKED; this.#renderBody(); return true }
    const deepest = this.#cols.map(column => column.keys.length > 0).lastIndexOf(true)
    if (deepest >= 0) { this.#cols = this.#cols.slice(0, deepest); this.#renderBody(); return true }
    return false
  }

  // ── what is on screen ────────────────────────────────────────────────────

  #rows(scope = this.#scope, at = this.#at, query = this.#query): DirectoryRow[] {
    const selection = this.#selection
    return directoryRows({
      scope,
      at,
      query,
      running: selection?.nodes ?? [],
      picks: selection?.picks ?? {},
      eclipsed: selection?.eclipsed ?? [],
      next: this.#next,
      carried: this.#served,
      off: port()?.install.offUnits() ?? new Set(),
      moved: this.#moved,
      offerable: this.#offerable,
    })
  }

  #render(): void {
    if (!this.#panel) return
    const input = this.#refs.get('input') as HTMLInputElement
    const placeholder = t('hosts.search', 'Search domains and packages')
    input.placeholder = placeholder
    input.setAttribute('aria-label', placeholder)
    if (input.value !== this.#query) input.value = this.#query
    this.#renderBody()
  }

  #renderBody(): void {
    const body = this.#refs.get('body')
    if (!body) return
    // The columns come back where they were: each one's scroll, how far the strip
    // had gone sideways — and a column that is new scrolls into view.
    const scrolls = [...body.querySelectorAll<HTMLElement>('ul.hd-col')].map(column => column.scrollTop)
    const sideways = body.querySelector<HTMLElement>('.hd-cols')?.scrollLeft ?? 0
    const columnsBefore = body.querySelectorAll('.hd-colbox').length
    // A row that holds the focus keeps it through any repaint — a read landing is no reason to lose it.
    const held = body.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).closest<HTMLElement>('li[data-key]')?.dataset['key'] ?? null
      : null
    this.#renderRail()
    body.replaceChildren()
    if (this.#codeGate) this.#renderCodeGate(body, this.#codeGate)
    // Revisions have a column of their own: under it the columns stay as they were.
    const drawer = this.#view === 'revisions'
    const under: View = drawer ? 'domains' : this.#view
    body.classList.toggle('with-columns', under === 'domains' && !this.#query.trim())
    if (under === 'domains') this.#renderPane(body)
    else if (under === 'creations') this.#renderCreations(body)
    else if (under === 'mine') this.#renderMine(body)
    else this.#renderOwn(body)
    this.#renderDrawer(drawer)
    this.#renderMenu()
    const strip = body.querySelector<HTMLElement>('.hd-cols')
    if (strip) {
      strip.querySelectorAll<HTMLElement>('ul.hd-col').forEach((column, at) => { column.scrollTop = scrolls[at] ?? 0 })
      strip.scrollLeft = strip.querySelectorAll('.hd-colbox').length > columnsBefore ? strip.scrollWidth : sideways
      this.#restoreFocus(strip, held)
    }
    // Escape goes by the focus: with it on the body it would put every window away.
    if (document.activeElement === document.body) this.#panel?.focus({ preventScroll: true })
  }

  /** The revisions column: shown while a package's revisions are open. */
  #renderDrawer(open: boolean): void {
    const drawer = this.#refs.get('drawer')
    const frame = this.#refs.get('frame')
    if (!drawer || !frame) return
    drawer.hidden = !open
    frame.classList.toggle('with-drawer', open)
    drawer.replaceChildren()
    if (open) this.#renderRevisions(drawer)
  }

  #renderCodeGate(body: HTMLElement, gate: CodeGate): void {
    const box = make('div', 'hd-warning')
    box.setAttribute('role', 'alertdialog')
    box.append(
      make('p', 'hd-warning-title', t('hosts.their-code.title', "From now on, {host}'s code runs your hive", { host: gate.host })),
      make('p', 'hd-note', t('hosts.their-code.body', 'Your tiles stay yours, on this device. But the code decides what you see and what happens to them — the signature {sig} proves it is what {host} published, not what it does. Run it only if you trust {host}.', { host: gate.host, sig: gate.sig.slice(0, 8) })),
    )
    const run = button('hd-primary', t('hosts.their-code.run', "Run {host}'s code", { host: gate.host }))
    run.disabled = !!this.#busy
    run.addEventListener('click', () => {
      writeCodeTrust(gate.host)
      this.#codeGate = null
      gate.go()
    })
    const cancel = button('hd-quiet', t('hosts.their-code.cancel', 'Not now'))
    cancel.addEventListener('click', () => { this.#codeGate = null; this.#renderBody() })
    const acts = make('div', 'hd-warning-acts')
    acts.append(run, cancel)
    box.append(acts, make('p', 'hd-note', t('hosts.their-code.note', 'Asked once per domain. Your own domain and the publisher you follow never ask.')))
    body.append(box)
  }

  /** The domain whose code this act would run, when it has to ask first —
   *  '' when every source is your origin, the publisher you follow, or a
   *  domain you already accepted (any one such source is enough: the bytes
   *  are the same signature wherever they come from). */
  #foreignCodeHost(zones: readonly string[]): string {
    const known = zones.map(zoneOf).filter(Boolean)
    if (!known.length) return ''
    const trusted = readCodeTrust()
    const followed = new Set(this.#channelSources().map(zoneOf))
    if (known.some(zone => zone === this.#home || followed.has(zone) || trusted.has(zone))) return ''
    return known[0]
  }

  /** Ask before `go` when it would run a domain's code for the first time.
   *  True = the question is on screen and the act waits for it. */
  #askForCode(zones: readonly string[], sig: string, go: () => void): boolean {
    const host = this.#foreignCodeHost(zones)
    if (!host) return false
    this.#codeGate = { host, sig, go }
    this.#renderBody()
    return true
  }

  #domains(): DomainRow[] {
    return domainRows({
      homeLabel: this.#home || t('packages.mine', 'this hive'),
      zones: this.#zones.filter(zone => zone !== this.#home),
      trunk: this.#selection?.trunk ?? null,
      next: this.#next,
      served: this.#served,
      count: zone => zone ? (this.#served.get(zone) ? this.#rows(zone, '', '').length : 0) : this.#rows('', '', '').length,
      named: this.#named,
    })
  }

  /** The plain sentence for a host whose head is not the named build. */
  #behindText(host: string): string {
    return t('hosts.behind', "{host} hasn't got the newest version yet", { host })
  }

  #isBehind(zone: string): boolean {
    return !!zone && hostBehind(this.#served.get(zone)?.root ?? '', this.#named)
  }

  /** THE RAIL: this origin, then every host you carry — a dot saying whether an
   *  update waits there or the host is behind, its name, how many packages it
   *  lists — and your own host's entry after them. The pane follows the choice. */
  #renderRail(): void {
    const list = this.#refs.get('hosts')
    if (!list) return
    const domains = this.#domains()
    const searching = !!this.#query.trim()
    const pane = this.#view === 'own' ? OWN_PANE : this.#section
    const order = domains.map(domain => domain.zone)
    list.replaceChildren()
    for (const domain of domains) {
      // Every host stacked is lit, not only the first.
      const open = !searching && pane !== OWN_PANE && this.#stack.keys.includes(domain.zone)
      const li = make('li', `hd-section${domain.update ? ' has-update' : ''}${open ? ' open' : ''}`)
      const header = button('hd-domain', '', t('hosts.open-domain', 'Open {host}', { host: domain.label }))
      header.dataset['pane'] = domain.zone
      if (open) header.setAttribute('aria-current', 'true')
      const dot = make('span', `hd-dot${domain.update ? ' update' : domain.behind ? ' behind' : ''}`)
      dot.setAttribute('aria-hidden', 'true')
      header.append(dot, make('span', 'hd-domain-name', domain.label))
      if (domain.update) header.append(make('span', 'hd-mark', t('packages.update-mark', 'update')))
      const count = make('span', 'hd-count', domain.count ? String(domain.count) : '')
      if (domain.count) count.title = t('hosts.package-count', '{count} packages', { count: domain.count })
      header.append(count)
      header.addEventListener('click', event => this.#pickHost(domain.zone, pickMode(event), order))
      li.append(header)
      list.append(li)
    }
    const ownOpen = !searching && pane === OWN_PANE
    const own = make('li', `hd-section hd-own-entry${ownOpen ? ' open' : ''}`)
    const ownButton = button('hd-domain', '', t('hosts.your-host', 'Your host'))
    ownButton.dataset['pane'] = OWN_PANE
    if (ownOpen) ownButton.setAttribute('aria-current', 'true')
    const ring = make('span', 'hd-dot own')
    ring.setAttribute('aria-hidden', 'true')
    ownButton.append(ring, make('span', 'hd-domain-name', t('hosts.your-host', 'Your host')))
    ownButton.addEventListener('click', () => this.#selectOwn())
    own.append(ownButton)
    list.append(own)
    if (this.#reading && domains.every(domain => !domain.count)) {
      const reading = make('li', 'hd-rail-note')
      reading.append(make('p', 'hd-note', t('packages.reading', 'Reading what is served…')))
      list.append(reading)
    }
    // The keys moved here: the button they landed on is new, so the focus follows.
    if (this.#railFocus !== null) {
      const want = this.#railFocus
      this.#railFocus = null
      list.querySelectorAll<HTMLButtonElement>('button.hd-domain').forEach(item => { if (item.dataset['pane'] === want) item.focus() })
    }
  }

  /** THE PANE of the host chosen in the rail: its name, the way to Publish, then
   *  what it serves. A search replaces it with its lines, whatever was chosen. */
  #renderPane(body: HTMLElement): void {
    const domains = this.#domains()
    if (this.#query.trim()) { this.#renderMatches(body, domains); return }
    // HOSTS STACKED: one pane, and no act that belongs to one host. The packages
    // of them all are the columns, and what the search finds is theirs.
    if (this.#stack.keys.length > 1) {
      const stacked = make('div', 'hd-pane-head')
      stacked.append(make('h2', 'hd-pane-title', t('hosts.stacked', '{count} hosts stacked', { count: this.#stack.keys.length })))
      body.append(stacked, make('p', 'hd-note hd-stack-note', this.#stack.keys.map(zone => domains.find(row => row.zone === zone)?.label ?? zone).join(' · ')))
      body.append(this.#renderColumns())
      return
    }
    const domain = domains.find(row => row.zone === this.#section) ?? domains[0]
    if (!domain) return
    const head = make('div', 'hd-pane-head')
    head.append(make('h2', 'hd-pane-title', domain.label))
    if (domain.update) head.append(make('span', 'hd-mark', t('packages.update-mark', 'update')))
    head.append(make('span', 'hd-grow'))
    // THE ONE LINK TO PUBLISH. This is what comes in; Publish is what goes out,
    // on its own screen. A host is where a branch may be sent, so a host has the
    // door and this origin, which is no destination, does not. Beside the door,
    // how many branches that host names as live now — read from your signed index
    // there, never from Publish's sweep, which seals and probes every branch.
    if (domain.zone) {
      const published = make('span', 'hd-published')
      published.dataset['zone'] = domain.zone
      this.#refs.set('published', published)
      this.#paintPublished(published, domain.zone)
      head.append(published)
      void this.#askPublished(domain.zone)
      const publish = button('hd-link hd-publish', `${t('hosts.publish', 'Publish')} ›`, t('hosts.publish-tip', 'Open Publish — what goes out to your domains'))
      publish.addEventListener('click', () => this.#openPublish())
      head.append(publish)
    }
    body.append(head)
    if (domain.behind) body.append(make('p', 'hd-note hd-behind', this.#behindText(domain.label)))
    body.append(this.#sectionBody(domain.zone))
    body.append(this.#renderColumns())
  }

  /** The count beside the Publish door: nothing until it is told, never a zero
   *  for a host that did not answer. */
  #paintPublished(span: HTMLElement, zone: string): void {
    const count = this.#published.get(zone)
    span.hidden = count === undefined || count === null
    if (count === undefined || count === null) { span.textContent = ''; return }
    span.textContent = count > 0
      ? t('hosts.published-here', '{count} published here', { count })
      : t('hosts.published-none', 'Nothing published here yet')
    span.title = t('hosts.published-tip', 'What your signed index on {host} names as live', { host: zone })
  }

  /** Ask a host once — the count is kept until the desk closes — and paint it
   *  in place, so a read landing never repaints the list under the pointer. */
  async #askPublished(zone: string): Promise<void> {
    if (this.#published.has(zone) || this.#publishedAsk.has(zone)) return
    const opening = this.#opening
    this.#publishedAsk.add(zone)
    const count = await publishedCount(zone)
    // A desk that closed since this was asked — and may have opened again — has
    // cleared what it kept. An answer from before that is not this opening's: it
    // would overwrite a fresh read, or stand in the way of one.
    if (opening !== this.#opening) return
    this.#publishedAsk.delete(zone)
    this.#published.set(zone, count)
    const span = this.#refs.get('published')
    if (span && span.dataset['zone'] === zone) this.#paintPublished(span, zone)
  }

  /** This desk covers the page, so it closes before Publish opens. */
  #openPublish(): void {
    EffectBus.emit('hosts:close', {})
    if (!isWindowShowing('publish-panel')) EffectBus.emit('publish:view-toggle', {})
  }

  /** YOUR HOST'S PANE: where it is named, and — on the desktop — the walkthrough
   *  for serving your hive from this computer (host-online.ts; not drawn on the
   *  web, where nothing can serve). */
  #renderOwn(body: HTMLElement): void {
    const head = make('div', 'hd-pane-head')
    head.append(make('h2', 'hd-pane-title', t('hosts.your-host', 'Your host')))
    body.append(head)
    body.append(make('p', 'hd-note', t('hosts.own-host-note', 'The domain you serve from: your backup goes there, and the bytes you share are offered from it.')))
    body.append(this.#ownHostForm())
    const online = hostOnlineBlock({ t, make, button, repaint: () => this.#renderBody() })
    if (online) body.append(online)
  }

  /** YOUR OWN HOST — the domain you serve from (`hc:nostrmesh:self-domain`):
   *  your host backup goes there, and the bytes you share are offered from
   *  it. It sat in the swarm selector as "host" until 2026-10-12 — but a host
   *  is REPLICATION, never who meets ("hosts are added to our portal for
   *  replication"; the room is meeting point + room + secret), so it lives
   *  here with the rest of your hosts. Empty until you name one; an empty
   *  field clears it. The hosts drone hands it to host-sync (`hosts:own-host` → setOwnHost). */
  #ownHostForm(): HTMLFormElement {
    const own = make('form', 'hd-add hd-own')
    const field = make('input', 'hd-add-input')
    field.type = 'text'
    field.autocomplete = 'off'
    field.spellcheck = false
    try { field.value = zoneOf(localStorage.getItem(OWN_HOST_KEY) ?? '') } catch { field.value = '' }
    field.placeholder = t('hosts.own-host-placeholder', 'your own host — where your backup goes')
    field.setAttribute('aria-label', t('hosts.own-host', 'Your own host'))
    field.title = t('hosts.own-host', 'Your own host')
    const go = make('button', 'hd-quiet', t('hosts.own-host-set', 'Set'))
    go.type = 'submit'
    const label = make('label', 'hd-own-label', t('hosts.own-host', 'Your own host'))
    field.id = 'hd-own-host'
    label.htmlFor = field.id
    own.append(label, field, go)
    own.addEventListener('submit', (event) => {
      event.preventDefault()
      const raw = field.value.trim()
      const host = raw ? zoneOf(raw) : ''
      if (raw && !host) { field.setAttribute('aria-invalid', 'true'); field.focus(); return }
      field.removeAttribute('aria-invalid')
      field.value = host
      EffectBus.emit('hosts:own-host', { host })
    })
    return own
  }

  /** THE SEARCH FINISHES INTO LINES: one per matching host, and one per matching
   *  package across the hosts STACKED in the rail — a package several of them
   *  carry is one line, saying which. Choosing a line opens its place. */
  #renderMatches(body: HTMLElement, domains: readonly DomainRow[]): void {
    const q = this.#query.trim().toLowerCase()
    const list = make('ul', 'hd-list hd-matches')
    const line = (label: string, where: string, go: () => void, update = false): void => {
      const li = make('li', 'hd-match-row')
      const choose = button('hd-match', '')
      choose.append(make('span', 'hd-match-name', label))
      if (update) choose.append(make('span', 'hd-mark', t('packages.update-mark', 'update')))
      choose.append(make('span', 'hd-match-where', where))
      choose.addEventListener('click', go)
      li.append(choose)
      list.append(li)
    }
    // Any host whose name matches can be taken into the rail's pick.
    for (const domain of domains) {
      if (domain.label.toLowerCase().includes(q)) {
        line(domain.label, t('hosts.domain', 'domain'), () => this.#pickHost(domain.zone, 'only', [domain.zone]), domain.update)
      }
    }
    const labelOf = (zone: string): string => domains.find(row => row.zone === zone)?.label ?? zone
    const stacked = this.#stack.keys.map(zone => ({ zone, rows: this.#rows(zone, '', this.#query) }))
    for (const match of stackRows(stacked)) {
      line(match.path, match.zones.map(labelOf).join(' · '), () => {
        this.#query = ''
        this.#cols = this.#chainTo(match.path)
        this.#files = NOTHING_PICKED
        this.#focusKey = match.path
        this.#view = 'domains'
        this.#render()
      }, match.update)
    }
    if (list.childElementCount) body.append(list)
    else body.append(make('p', 'hd-note', t('hosts.no-match', 'Nothing matches “{query}”.', { query: this.#query.trim() })))
  }

  /** Block or Resume for one zone the shell already owns. The button only
   *  names the zone. The shell script that ran before any bee is the writer,
   *  and only for a click the browser itself dispatched inside this element.
   *  A word (`follow`, a claim) and a script call leave the firewall where it
   *  is. The repaint runs after that script, on the way back up. */
  #firewallToggle(owned: string, paused: readonly string[]): HTMLButtonElement {
    const blocked = paused.includes(owned)
    const toggle = button('hd-link', blocked
      ? t('hosts.firewall.resume', 'Resume {host}', { host: owned })
      : t('hosts.firewall.block', 'Block {host}', { host: owned }),
    blocked
      ? t('hosts.firewall.resume-tip', 'Let this shell connect to {host} again', { host: owned })
      : t('hosts.firewall.block-tip', 'Pause every connection from this shell to {host}', { host: owned }))
    toggle.setAttribute('data-hc-firewall', owned)
    toggle.addEventListener('click', () => this.#render())
    return toggle
  }

  /** An open domain: its own acts as lines, then its packages. */
  #sectionBody(zone: string): HTMLElement {
    const section = make('div', 'hd-section-body')
    const reach = port()
    const trunk = this.#selection?.trunk ?? null

    const lines = make('ul', 'hd-lines')
    const addLine = (node: HTMLElement): void => { const li = make('li', 'hd-line'); li.append(node); lines.append(li) }
    if (zone) {
      // THE HOST ITSELF: what else it serves, its own door, and letting it go.
      const creations = button('hd-link', t('hosts.creations.title', 'Creations on {host}', { host: this.#scope }))
      creations.addEventListener('click', () => {
        this.#view = 'creations'
        this.#render()
        EffectBus.emit('hosts:creations', { zone: this.#scope })
      })
      addLine(creations)
      if (hostZone(this.#scope) !== this.#home) {
        const visit = make('a', 'hd-link', t('hosts.visit', 'Visit'))
        visit.href = `https://${this.#scope}/`
        visit.target = '_blank'
        visit.rel = 'noopener'
        visit.title = t('hosts.visit-tip', 'Open {host} in a new tab', { host: this.#scope })
        addLine(visit)
      }
      // THE FIREWALL SWITCH: a host is open by default; Block pauses every
      // connection to its zone until Resume. Only a shell that runs the
      // outgoing firewall offers it, and only for a zone that shell owns.
      // The click is the human door. This view does not write the list.
      const firewall = (window as { __hcFirewall?: { zones(): string[]; paused(): string[] } }).__hcFirewall
      const owned = firewall?.zones().find(z => this.#scope === z || this.#scope.endsWith('.' + z))
      if (firewall && owned) addLine(this.#firewallToggle(owned, firewall.paused()))
      const remove = button('hd-link', t('hosts.remove-short', 'Remove'), t('hosts.remove', 'Remove {host} from your host directory', { host: this.#scope }))
      remove.addEventListener('click', () => {
        const zone = this.#scope
        this.#toDomains()
        EffectBus.emit('hosts:remove', { zone })
        this.#render()
      })
      addLine(remove)
    } else {
      if (this.#mine.length) {
        const mine = button('hd-link', t('hosts.mine.open', 'In your hive ({count})', { count: this.#mine.length }))
        mine.addEventListener('click', () => { this.#view = 'mine'; this.#render() })
        addLine(mine)
      }
      // THE FIREWALL: your own zones are open by default and each can be
      // paused here, by a click. Only a shell that runs the outgoing firewall
      // has the list. A sentence does not flip one.
      const wall = (window as { __hcFirewall?: { zones(): string[]; paused(): string[] } }).__hcFirewall
      const held = wall?.paused() ?? []
      for (const owned of wall?.zones() ?? []) addLine(this.#firewallToggle(owned, held))
    }
    if (lines.childElementCount) section.append(lines)

    // EVERYTHING THE FOLLOWED PUBLISHER MOVED, in one act — this origin only.
    // It is a source shell's one act too: it follows the channel, so taking the
    // revision records it while the code it runs stays its working tree.
    if (!zone && (trunk || runsSource()) && this.#next && this.#next.root !== trunk) {
      const bar = make('div', 'hd-updates')
      bar.setAttribute('role', 'status')
      // While it moves, the bar is one whole sentence — a done-of-total over the
      // changed files, the same count the rows fill against — and no button.
      const moving = this.#held
      const overall = moving ? updateProgress('', this.#next.nodes, this.#had, moving) : null
      bar.append(make('span', '', !moving
        ? t('packages.updates.shared', 'An update is ready')
        : overall?.total
          ? t('hosts.updating', 'Updating — {done} of {total} changed files', { done: overall.done, total: overall.total })
          : t('hosts.updating-short', 'Updating…')))
      if (!moving) {
        const take = button('hd-primary', t('hosts.update-all', 'Update all'))
        take.disabled = !!this.#busy
        take.addEventListener('click', () => { void this.#updateAll() })
        bar.append(take)
      }
      section.append(bar)
    } else if (!zone && (trunk || runsSource()) && this.#named && this.#named !== trunk && !this.#reading) {
      // AN UPDATE NONE OF YOUR HOSTS CAN SERVE YET: said plainly, with the
      // hosts that are behind — never a button that would end in a refusal.
      const bar = make('div', 'hd-updates')
      bar.setAttribute('role', 'status')
      bar.append(make('span', '', t('packages.updates.not-held', 'An update is ready, but none of your hosts has it yet')))
      section.append(bar)
      for (const host of this.#zones) {
        if (host !== this.#home && this.#isBehind(host)) section.append(make('p', 'hd-note hd-behind', this.#behindText(host)))
      }
    }
    if (reach && !trunk) {
      section.append(make('p', 'hd-note', t('hosts.from-source', 'This shell loads its packages from source, so turning them on or off and picking revisions happens on a hive.')))
    }
    if (this.#error) {
      const err = make('p', 'hd-error', this.#error)
      err.setAttribute('role', 'alert')
      section.append(err)
    }

    return section
  }

  // ── the columns ──────────────────────────────────────────────────────────
  //
  // The Finder's column view, over what the stacked hosts carry. The first column
  // is the rail (the hosts: stack as many as you like), each package column opens
  // from whatever is picked in the one before it, the last column is the code
  // files of what is picked, and a picked file is read in the matrix beside it.

  /** The package columns as data: each is the merged lines of whatever the column
   *  before it picked, across every stacked host, and what is picked in it. */
  #columnModel(): { rows: StackRow[]; picked: Picked; parents: string[] }[] {
    const model: { rows: StackRow[]; picked: Picked; parents: string[] }[] = []
    let parents: string[] = ['']
    for (let k = 0; k < 32; k++) {
      const rows = this.#childRows(parents)
      if (!rows.length) break
      const picked = stillPicked(this.#cols[k] ?? NOTHING_PICKED, rows.map(row => row.path))
      model.push({ rows, picked, parents })
      parents = picked.keys.filter(path => (rows.find(row => row.path === path)?.children ?? 0) > 0)
      if (!parents.length) break
    }
    return model
  }

  /** The lines under each of `parents`, from every stacked host, as one list. */
  #childRows(parents: readonly string[]): StackRow[] {
    return stackRows(this.#stack.keys.flatMap(zone => parents.map(at => ({ zone, rows: this.#rows(zone, at, '') }))))
  }

  /** Every layer read from the stacked hosts — what this origin runs and is offered
   *  (the union a scope of `''` lists), or just what each stacked host serves. */
  #treeNodes(): InstallNode[] {
    const nodes: InstallNode[] = []
    const zones = this.#stack.keys
    if (zones.includes('')) {
      nodes.push(...(this.#selection?.nodes ?? []), ...(this.#next?.nodes ?? []))
      for (const tree of this.#carried()) nodes.push(...tree.nodes)
    } else for (const zone of zones) nodes.push(...(this.#served.get(zone)?.nodes ?? []))
    return nodes
  }

  #carried(): ServedTree[] {
    return [...this.#served.values()].filter((tree): tree is ServedTree => !!tree && this.#offerable(tree.root))
  }

  /** The code files of the packages picked in the deepest column that has a pick. */
  #pickedFiles(model: readonly { picked: Picked }[]): { files: FileRow[]; paths: string[] } {
    for (let k = model.length - 1; k >= 0; k--) {
      const paths = [...model[k]!.picked.keys]
      if (paths.length) return { files: filesPicked(this.#treeNodes(), paths), paths }
    }
    return { files: [], paths: [] }
  }

  #renderColumns(): HTMLElement {
    const strip = make('div', 'hd-cols')
    strip.addEventListener('keydown', event => this.#colKeys(event))
    const model = this.#columnModel()
    if (!model.length) {
      strip.append(make('p', 'hd-note hd-cols-empty', this.#reading || !this.#loaded
        ? t('packages.reading', 'Reading what is served…')
        : t('packages.empty', 'Nothing listed here yet.')))
      this.#at = ''
      return strip
    }
    const top = this.#stack.keys.length > 1
      ? t('hosts.stacked-packages', 'Packages across {count} hosts', { count: this.#stack.keys.length })
      : t('hosts.packages', 'Packages')
    model.forEach(({ rows, picked, parents }, k) => {
      strip.append(this.#packageColumn(rows, k, picked, k === 0 ? top : parents.join(' · ')))
    })
    // Where a restart should put you back: the one package the columns end on.
    const last = [...model].reverse().find(column => column.picked.keys.length)
    this.#at = last && last.picked.keys.length === 1 ? last.picked.keys[0]! : ''

    const { files, paths } = this.#pickedFiles(model)
    this.#files = stillPicked(this.#files, files.map(file => file.sig))
    if (files.length) {
      strip.append(this.#fileColumn(files, paths))
      this.#wantCode(files)
      if (this.#files.keys.length) strip.append(this.#codeMatrix(files))
    }
    return strip
  }

  /** A pick in a package column: what is deeper no longer applies, and the files
   *  are the picked packages' own. */
  #pickPackage(k: number, path: string, mode: PickMode, order: readonly string[]): void {
    this.#cols = [...this.#cols.slice(0, k), pickKey(this.#cols[k] ?? NOTHING_PICKED, path, mode, order)]
    this.#files = NOTHING_PICKED
    this.#focusKey = path
    this.#renderBody()
  }

  #pickFile(sig: string, mode: PickMode, order: readonly string[]): void {
    this.#files = pickKey(this.#files, sig, mode, order)
    this.#focusKey = sig
    this.#renderBody()
  }

  /** Arrow keys walk a column and the pick follows (shift extends); right opens
   *  the next column on its first line, left goes back; ctrl/cmd-A takes the lot. */
  #colKeys(event: KeyboardEvent): void {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const line = target.closest<HTMLElement>('li[data-key]')
    const column = line?.closest<HTMLElement>('ul.hd-col')
    if (!line || !column) return
    const lines = [...column.querySelectorAll<HTMLElement>(':scope > li[data-key]')]
    const order = lines.map(item => item.dataset['key'] ?? '')
    const at = lines.indexOf(line)
    const files = column.classList.contains('hd-files')
    const k = Number(column.dataset['col'] ?? -1)
    const pick = (key: string, mode: PickMode): void => {
      event.preventDefault()
      if (files) this.#pickFile(key, mode, order)
      else this.#pickPackage(k, key, mode, order)
    }
    const next = (by: number): void => {
      const key = order[Math.max(0, Math.min(order.length - 1, at + by))]
      if (key !== undefined) pick(key, event.shiftKey ? 'range' : 'only')
    }
    if (event.key === 'ArrowDown') next(1)
    else if (event.key === 'ArrowUp') next(-1)
    else if (event.key === 'Enter' || event.key === ' ') pick(order[at] ?? '', 'only')
    else if ((event.key === 'a' || event.key === 'A') && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      if (files) { this.#files = pickAll(this.#files, order); this.#renderBody() }
      else { this.#cols = [...this.#cols.slice(0, k), pickAll(this.#cols[k] ?? NOTHING_PICKED, order)]; this.#files = NOTHING_PICKED; this.#renderBody() }
    } else if (event.key === 'ArrowRight') {
      const beside = column.parentElement?.nextElementSibling?.querySelector<HTMLElement>('ul.hd-col > li[data-key]')
      if (!beside) return
      event.preventDefault()
      const key = beside.dataset['key'] ?? ''
      const nextFiles = beside.closest('ul.hd-col')?.classList.contains('hd-files') ?? false
      if (nextFiles) { this.#focusKey = key; beside.focus() } else this.#pickPackage(k + 1, key, 'only', [...(beside.closest('ul.hd-col')?.querySelectorAll<HTMLElement>(':scope > li[data-key]') ?? [])].map(item => item.dataset['key'] ?? ''))
    } else if (event.key === 'ArrowLeft') {
      const behind = column.parentElement?.previousElementSibling
      const before = behind?.querySelector<HTMLElement>('ul.hd-col > li[aria-selected="true"]') ?? behind?.querySelector<HTMLElement>('ul.hd-col > li[data-key]')
      if (!before) return
      event.preventDefault()
      this.#focusKey = before.dataset['key'] ?? ''
      before.focus()
    }
  }

  /** The line the keys last moved to, focused again once the columns are redrawn. */
  #restoreFocus(strip: ParentNode, held: string | null = null): void {
    const key = this.#focusKey ?? held
    this.#focusKey = null
    if (key === null) return
    for (const item of strip.querySelectorAll<HTMLElement>('li[data-key]')) {
      if (item.dataset['key'] === key) { item.focus({ preventScroll: false }); break }
    }
  }

  /** A caption over a column — what it lists. */
  #colHead(label: string): HTMLElement {
    const head = make('div', 'hd-colhead', label)
    head.title = label
    return head
  }

  /** One column of packages, one line each. Whatever is picked here opens the next. */
  #packageColumn(rows: readonly StackRow[], k: number, picked: Picked, caption: string): HTMLElement {
    const reach = port()
    const trunk = this.#selection?.trunk ?? null
    const acts = !!reach && !!trunk
    const recursive = !!reach?.recursive
    const list = make('ul', 'hd-col hd-packages')
    list.setAttribute('role', 'listbox')
    list.setAttribute('aria-multiselectable', 'true')
    list.setAttribute('aria-label', caption)
    list.dataset['col'] = String(k)
    // WHILE UPDATE ALL RUNS, the list is only what it is changing, each row
    // filling as its changed files arrive — never the whole package.
    const moving = this.#held
    const changing = moving ? rows.filter(row => row.update) : []
    const shown = changing.length ? changing : rows
    const order = shown.map(row => row.path)
    const tabbable = picked.keys.find(path => order.includes(path)) ?? order[0]
    for (const row of shown) {
      const li = make('li', 'hd-row')
      li.dataset['key'] = row.path
      li.setAttribute('role', 'option')
      li.setAttribute('aria-selected', String(picked.keys.includes(row.path)))
      li.tabIndex = row.path === tabbable ? 0 : -1
      if (picked.keys.includes(row.path)) li.classList.add('picked')
      if (row.description) li.title = row.description
      const measured = moving && row.update ? updateProgress(row.path, this.#next?.nodes ?? [], this.#had, moving) : null
      // A change only in a namespace bundle has no file of its own to fill.
      const progress = measured?.total ? measured : null
      if (!row.on) li.classList.add('off')
      if (this.#busy === row.path) li.classList.add('busy')

      // THE LIGHT: on and current, on with a newer version (dimmer the older the one
      // running — the age is read for rows that are on and behind, a few at a time),
      // or off. It tells; the manage menu acts.
      const running = this.#selection?.nodes.find(node => node.path === row.path)?.layerSig ?? ''
      if (row.on && row.update && running) this.#queueAge(row.path, running)
      const stamp = this.#ages.get(`${row.path}\n${running}`)
      const light = lightOf(row, stamp, Date.now())
      const bulb = make('span', `hd-bulb ${light.state}`)
      bulb.setAttribute('role', 'img')
      bulb.style.setProperty('--hd-age', String(light.level))
      const lit = light.state === 'off'
        ? t('hosts.light.off', '{name} is off', { name: row.path })
        : light.state === 'on'
          ? t('hosts.light.on', '{name} is on', { name: row.path })
          : typeof stamp === 'number'
            ? t('hosts.light.behind', '{name} is on, and a newer version exists — the one running is from {date}', { name: row.path, date: new Date(stamp).toISOString().slice(0, 10) })
            : t('hosts.light.behind-unknown', '{name} is on, and a newer version exists', { name: row.path })
      bulb.setAttribute('aria-label', lit)
      bulb.title = lit
      const glyph = make('span', 'mat-sym', row.on ? 'lightbulb' : 'lightbulb_outline')
      glyph.setAttribute('aria-hidden', 'true')
      bulb.append(glyph)

      // The name is the line: clicking it, or the row around it, picks.
      const name = button('hd-name', row.name)
      name.tabIndex = -1

      const marks = make('span', 'hd-marks')
      if (row.update) {
        const update = button('hd-mark', t('packages.update-mark', 'update'), t('hosts.update-one', 'Take the update to {name}', { name: row.path }))
        update.disabled = !acts || !recursive || !!this.#busy
        update.addEventListener('click', () => { void this.#takeUpdate(row) })
        marks.append(update)
      }
      if (row.picked) marks.append(make('span', 'hd-mark quiet', t('hosts.picked', 'picked')))
      if (row.hidden) marks.append(make('span', 'hd-mark quiet', t('hosts.hidden-beneath', '{count} newer hidden', { count: row.hidden })))
      if (!row.held) marks.append(make('span', 'hd-mark quiet', t('packages.new', 'not here yet')))
      // Stacked hosts that carry different signatures of one package say so.
      if (row.differs) marks.append(make('span', 'hd-mark quiet', t('hosts.differs', 'differs')))

      const count = make('span', 'hd-count', row.count ? String(row.count) : '')
      if (row.count) count.title = t('hosts.carried-by', '{count} of your hosts carry this signature', { count: row.count })

      // The manage icon opens a menu: turn it off or on, update it to the newest,
      // pick a revision, look at its code in the columns.
      const manage = button('hd-icon hd-manage', '⋯', t('hosts.manage', 'Manage {name}', { name: row.path }))
      manage.tabIndex = -1
      manage.setAttribute('aria-haspopup', 'menu')
      manage.setAttribute('aria-expanded', String(this.#menu === row.path))
      manage.addEventListener('click', () => { this.#menu = this.#menu === row.path ? null : row.path; this.#renderBody() })

      if (progress) {
        const done = progress.total > 0 && progress.done >= progress.total
        li.classList.add(done ? 'updated' : 'updating')
        marks.prepend(make('span', `hd-mark${done ? '' : ' quiet'}`, done
          ? t('hosts.update-in', 'in')
          : `${progress.done}/${progress.total}`))
        const bar = make('span', 'hd-progress')
        bar.setAttribute('role', 'progressbar')
        bar.setAttribute('aria-valuemin', '0')
        bar.setAttribute('aria-valuemax', String(progress.total))
        bar.setAttribute('aria-valuenow', String(progress.done))
        bar.setAttribute('aria-label', t('hosts.update-progress', 'Updating {name}', { name: row.path }))
        const fill = make('span', 'hd-progress-fill')
        fill.style.width = `${progress.total ? Math.round(100 * progress.done / progress.total) : 0}%`
        bar.append(fill)
        li.append(bar)
      }
      li.append(bulb, name, marks, count, manage)
      // Parts inside it open as the next column when it is picked.
      if (row.children) {
        const opens = make('span', 'hd-opens', '›')
        opens.setAttribute('aria-hidden', 'true')
        li.append(opens)
      } else li.append(make('span', 'hd-icon-slot'))

      li.addEventListener('click', event => {
        if ((event.target as HTMLElement).closest('button:not(.hd-name), a')) return
        this.#pickPackage(k, row.path, pickMode(event), order)
      })
      list.append(li)
    }
    const box = make('div', 'hd-colbox')
    box.append(this.#colHead(caption), list)
    return box
  }

  // ── the manage menu, and how old the light says a package is ─────────────

  /** The manage menu of the row named in `#menu`, over the desk. It survives a
   *  repaint because it is state — a path — and not a node. */
  #renderMenu(): void {
    const panel = this.#panel
    panel?.querySelector(':scope > .hd-menu')?.remove()
    const path = this.#menu
    if (!panel || path === null) return
    const model = this.#columnModel()
    const k = model.findIndex(column => column.rows.some(row => row.path === path))
    const row = k >= 0 ? model[k]!.rows.find(candidate => candidate.path === path) : undefined
    const anchor = this.#refs.get('body')?.querySelector<HTMLElement>(`li[data-key="${CSS.escape(path)}"] .hd-manage`)
    if (!row || !anchor) { this.#menu = null; return }

    const reach = port()
    const acts = !!reach && !!this.#selection?.trunk
    const recursive = !!reach?.recursive
    const untakeable = !row.held && !this.#carrying(row.path)
    const blocked = !acts || !!this.#busy || !!row.blockedBy || (!row.held && !recursive) || untakeable
    // Why it cannot be switched, in the words the old bulb said it in.
    const reason = row.blockedBy
      ? t('hosts.blocked', 'Turn on {name} first', { name: row.blockedBy })
      : untakeable && this.#isBehind(this.#scope)
        ? this.#behindText(this.#scope)
        : !acts
          ? t('hosts.from-source', 'This shell loads its packages from source, so turning them on or off and picking revisions happens on a hive.')
          : ''

    const menu = make('div', 'hd-menu')
    menu.setAttribute('role', 'menu')
    const item = (label: string, go: () => void, off = false, title = '', accent = false): void => {
      const entry = button(`hd-menu-item${accent ? ' accent' : ''}`, label)
      entry.setAttribute('role', 'menuitem')
      entry.disabled = off
      if (title) entry.title = title
      entry.addEventListener('click', () => { this.#menu = null; go() })
      menu.append(entry)
    }
    item(row.on
      ? t('packages.turn-off', 'Turn off {name}', { name: row.path })
      : t('packages.turn-on', 'Turn on {name}', { name: row.path }), () => { void this.#toggle(row) }, blocked, reason)
    if (row.update) {
      item(t('hosts.update-newest', 'Update {name} to the newest', { name: row.path }), () => { void this.#takeUpdate(row) }, !acts || !recursive || !!this.#busy, '', true)
    }
    item(t('hosts.revisions.pick', 'Pick a revision…'), () => { void this.#openRevisions(row.path) }, !recursive)
    item(t('hosts.code.look', 'Look at the code'), () => this.#lookAtCode(k, row, model[k]!.rows.map(candidate => candidate.path)))

    panel.append(menu)
    const at = anchor.getBoundingClientRect()
    const host = panel.getBoundingClientRect()
    const left = Math.max(8, Math.min(host.width - menu.offsetWidth - 8, at.right - host.left - menu.offsetWidth))
    let top = at.bottom - host.top + 4
    if (top + menu.offsetHeight > host.height - 8) top = Math.max(8, at.top - host.top - menu.offsetHeight - 4)
    menu.style.left = `${Math.round(left)}px`
    menu.style.top = `${Math.round(top)}px`
  }

  /** The menu's door to the code: pick the package, so its files are the column
   *  that opens, and put the focus on the first of them. */
  #lookAtCode(k: number, row: StackRow, order: readonly string[]): void {
    this.#pickPackage(k, row.path, 'only', order)
    this.#refs.get('body')?.querySelector<HTMLElement>('ul.hd-files > li')?.focus()
  }

  /** How old the running version of a package that is on and behind is — read
   *  from its revisions, two packages at a time, once each. */
  #queueAge(path: string, running: string): void {
    const key = `${path}\n${running}`
    if (this.#ages.has(key) || this.#agesAsk.has(key)) return
    this.#agesAsk.add(key)
    this.#ageQueue.push(key)
    this.#pumpAges()
  }

  #pumpAges(): void {
    while (this.#ageActive < 2 && this.#ageQueue.length) {
      const key = this.#ageQueue.shift()!
      this.#ageActive++
      void this.#readAge(key).finally(() => { this.#ageActive--; this.#pumpAges() })
    }
  }

  async #readAge(key: string): Promise<void> {
    const [path = '', running = ''] = key.split('\n')
    const opening = this.#opening
    let stamp: number | null = null
    try {
      const reach = port()
      if (reach?.recursive) {
        const roots = [...new Set([this.#named, this.#next?.root ?? '', ...[...this.#served.values()].map(tree => tree?.root ?? '')])]
          .filter(root => SIG_RE.test(root) && this.#offerable(root))
        stamp = runningStamp(await reach.install.revisionsOf(path, this.#sources(), roots), running)
      }
    } catch { stamp = null }
    if (opening !== this.#opening) return
    this.#agesAsk.delete(key)
    this.#ages.set(key, stamp)
    if (this.#agePaint) return
    this.#agePaint = window.setTimeout(() => { this.#agePaint = 0; if (this.#panel) this.#renderBody() }, 120)
  }

  /** The last column: the code files the picked packages declare. */
  #fileColumn(files: readonly FileRow[], paths: readonly string[]): HTMLElement {
    const list = make('ul', 'hd-col hd-files')
    list.setAttribute('role', 'listbox')
    list.setAttribute('aria-multiselectable', 'true')
    const caption = t('hosts.files-in', 'Files in {paths}', { paths: paths.join(' · ') })
    list.setAttribute('aria-label', caption)
    const order = files.map(file => file.sig)
    const tabbable = this.#files.keys.find(sig => order.includes(sig)) ?? order[0]
    for (const file of files) {
      const read = this.#code.get(file.sig)
      const li = make('li', 'hd-file')
      li.dataset['key'] = file.sig
      li.setAttribute('role', 'option')
      li.setAttribute('aria-selected', String(this.#files.keys.includes(file.sig)))
      li.tabIndex = file.sig === tabbable ? 0 : -1
      if (this.#files.keys.includes(file.sig)) li.classList.add('picked')
      const name = read?.name || file.sig.slice(0, 12)
      li.append(make('span', 'hd-file-name', name), make('span', 'hd-file-where', `${file.path} · ${file.sig.slice(0, 8)}`))
      li.title = `${name}\n${file.path} · ${file.sig}`
      li.addEventListener('click', event => this.#pickFile(file.sig, pickMode(event), order))
      list.append(li)
    }
    const box = make('div', 'hd-colbox')
    box.append(this.#colHead(caption), list)
    return box
  }

  /** THE MATRIX: every picked file read side by side, one panel each. */
  #codeMatrix(files: readonly FileRow[]): HTMLElement {
    const matrix = make('div', 'hd-matrix')
    matrix.setAttribute('aria-label', t('hosts.code', 'Code'))
    const order = files.map(file => file.sig)
    const shown = this.#files.keys.slice(0, CODE_PANELS)
    for (const sig of shown) {
      const file = files.find(candidate => candidate.sig === sig)
      const read = this.#code.get(sig)
      const box = make('article', 'hd-codebox')
      const head = make('header', 'hd-codehead')
      const title = make('span', 'hd-codename', read?.name || sig.slice(0, 12))
      title.title = sig
      head.append(title, make('span', 'hd-codewhere', `${file?.path ?? ''} · ${sig.slice(0, 8)}${read ? ` · ${Math.max(1, Math.round(read.size / 1024))} KB` : ''}`))
      const close = button('hd-icon', '×', t('hosts.code.close', 'Stop reading {name}', { name: read?.name || sig.slice(0, 8) }))
      close.addEventListener('click', () => this.#pickFile(sig, 'toggle', order))
      head.append(close)
      box.append(head)
      if (read === undefined) box.append(make('p', 'hd-note', t('hosts.code.reading', 'Reading…')))
      else if (read === null) box.append(make('p', 'hd-note', t('hosts.code.missing', 'Not held here, and none of your hosts answered with it.')))
      else {
        const full = this.#codeFull.has(sig)
        const { lines, more } = codeLines(read.text, full ? Number.MAX_SAFE_INTEGER : CODE_LINES)
        const pre = make('pre', 'hd-code')
        for (const text of lines) pre.append(make('div', 'cl', text))
        box.append(pre)
        if (more > 0 || read.cut) {
          const rest = button('hd-quiet', more > 0
            ? t('hosts.code.more', 'Show the other {count} lines', { count: more })
            : t('hosts.code.cut', 'Only the start of this file is read'))
          rest.disabled = more <= 0
          rest.addEventListener('click', () => { this.#codeFull.add(sig); this.#renderBody() })
          box.append(rest)
        }
      }
      matrix.append(box)
    }
    if (this.#files.keys.length > shown.length) {
      matrix.append(make('p', 'hd-note', t('hosts.code.others', '{count} more picked — the first {shown} are shown', { count: this.#files.keys.length - shown.length, shown: shown.length })))
    }
    return matrix
  }

  /** Code is read for what is HELD here, to name the files — and from a host only
   *  for a file that is picked, since a bundle can be a megabyte and nobody asked. */
  #wantCode(files: readonly FileRow[]): void {
    const picked = new Set(this.#files.keys)
    for (const { sig } of files) {
      if (this.#code.has(sig)) continue
      if (picked.has(sig)) void this.#askCode(sig, true)
      else if (!this.#heldNot.has(sig)) void this.#askCode(sig, false)
    }
  }

  async #askCode(sig: string, remote: boolean): Promise<void> {
    const key = `${sig}${remote ? '+' : ''}`
    if (this.#codeAsk.has(key)) return
    this.#codeAsk.add(key)
    try {
      const store = ioc<{ getResource?(sig: string): Promise<Blob | null>; getResourceLocal?(sig: string): Promise<Blob | null> }>('@hypercomb.social/Store')
      const blob = remote ? await store?.getResource?.(sig) : await store?.getResourceLocal?.(sig)
      if (!blob) { if (remote) this.#code.set(sig, null); else this.#heldNot.add(sig); return }
      const cut = blob.size > CODE_KEEP
      const text = await (cut ? blob.slice(0, CODE_KEEP) : blob).text()
      this.#code.set(sig, { name: codeName(text), text, size: blob.size, cut })
      if (this.#code.size > 80) this.#code.delete(this.#code.keys().next().value as string)
    } catch {
      if (remote) this.#code.set(sig, null)
    } finally {
      this.#codeAsk.delete(key)
      this.#codeSoon()
    }
  }

  /** Reads land a few at a time: one repaint for them all. */
  #codeSoon(): void {
    if (this.#codePaint) return
    this.#codePaint = window.setTimeout(() => { this.#codePaint = 0; if (this.#panel) this.#renderBody() }, 80)
  }

  #renderRevisions(body: HTMLElement): void {
    const path = this.#revPath
    const head = make('div', 'hd-crumbs')
    const back = button('hd-back', '‹', t('hosts.revisions.back', 'Back to the list'))
    back.addEventListener('click', () => { this.#view = 'domains'; this.#warning = null; this.#render() })
    head.append(back, make('span', 'hd-drill-title', t('hosts.revisions.title', 'Revisions of {name}', { name: path })))
    body.append(head)
    if (this.#error) {
      const err = make('p', 'hd-error', this.#error)
      err.setAttribute('role', 'alert')
      body.append(err)
    }

    const warning = this.#warning
    if (warning) {
      const box = make('div', 'hd-warning')
      box.setAttribute('role', 'alertdialog')
      box.append(make('p', 'hd-warning-title', t('hosts.downgrade.title', 'An older {name} replaces newer parts inside it', { name: path })))
      const parts = [...new Set([...warning.replaced, ...warning.picksBeneath])].sort()
      const shown = parts.slice(0, 8)
      const list = make('ul', 'hd-warning-list')
      for (const part of shown) list.append(make('li', '', part))
      if (parts.length > shown.length) list.append(make('li', 'quiet', t('hosts.downgrade.more', 'and {count} more', { count: parts.length - shown.length })))
      box.append(list)
      const configure = button('hd-primary', t('hosts.downgrade.configure', 'Configure them one by one'))
      configure.addEventListener('click', () => { this.#toList(this.#scope, path); this.#render() })
      const anyway = button('hd-quiet', t('hosts.downgrade.anyway', 'Take it anyway'))
      anyway.disabled = !!this.#busy
      anyway.addEventListener('click', () => { void this.#pick(path, warning.revision, true) })
      const acts = make('div', 'hd-warning-acts')
      acts.append(configure, anyway)
      box.append(acts, make('p', 'hd-note', t('hosts.downgrade.note', 'Taken anyway, the newer parts are hidden, not deleted, until {name} is on its latest revision again.', { name: path })))
      body.append(box)
    }

    const revisions = this.#revisions
    if (!revisions) { body.append(make('p', 'hd-note', t('hosts.revisions.reading', 'Reading revisions from your hosts…'))); return }
    if (!revisions.length) { body.append(make('p', 'hd-note', t('hosts.revisions.none', 'None of your hosts carries a revision of this.'))); return }

    const trunk = this.#selection?.trunk ?? null
    const running = this.#selection?.nodes.find(node => node.path === path)?.layerSig ?? ''
    const list = make('ul', 'hd-list')
    // Names are headings only when there is something to tell apart: a list
    // nobody named (an older host, or revisions held here) stays one plain run.
    const latest = revisions.find(revision => revision.sources.some(source => source.root === this.#named))?.layer ?? ''
    const groups = revisionGroups(revisions, latest)
    const headed = groups.some(group => group.name)
    groups.forEach((group, groupIndex) => {
      if (headed) {
        const heading = make('li', 'hd-rev-name', group.name || t('hosts.revisions.unnamed', 'Held here'))
        heading.setAttribute('role', 'presentation')
        list.append(heading)
      }
      group.entries.forEach(({ revision, at }, index) => {
        const li = make('li', 'hd-rev')
        const choose = button('hd-rev-choose', '')
        const isRunning = revision.layer === running
        choose.disabled = !trunk || isRunning || !!this.#busy
        if (this.#busy === revision.layer) li.classList.add('busy')
        choose.append(make('span', 'hd-rev-sig', revision.layer.slice(0, 8)))
        if (at) choose.append(make('span', 'hd-rev-at', revisionDate(at)))
        const zones = new Set(revision.sources.map(source => source.zone).filter(Boolean))
        choose.append(make('span', 'hd-rev-hosts', zones.size
          ? t('hosts.revisions.hosts', 'on {count} of your hosts', { count: zones.size })
          : t('hosts.revisions.held', 'held here')))
        // "latest" is the newest line of the whole list — the first line of the first group.
        if (groupIndex === 0 && index === 0) choose.append(make('span', 'hd-mark quiet', t('hosts.revisions.latest', 'latest')))
        if (isRunning) choose.append(make('span', 'hd-mark', t('hosts.revisions.running', 'running')))
        choose.setAttribute('aria-label', t('hosts.revisions.take', 'Take revision {sig} of {name}', { sig: revision.layer.slice(0, 8), name: path }))
        choose.addEventListener('click', () => { void this.#chooseRevision(revision) })
        li.append(choose)
        list.append(li)
        if (!trunk) choose.title = t('hosts.from-source', 'This shell loads its packages from source, so turning them on or off and picking revisions happens on a hive.')
      })
    })
    body.append(list)
  }

  #renderCreations(body: HTMLElement): void {
    const zone = this.#scope
    const head = make('div', 'hd-crumbs')
    const back = button('hd-back', '‹', t('hosts.revisions.back', 'Back to the list'))
    back.addEventListener('click', () => { this.#view = 'domains'; this.#render() })
    head.append(back, make('span', 'hd-drill-title', t('hosts.creations.title', 'Creations on {host}', { host: zone })))
    body.append(head, make('p', 'hd-note', t('hosts.creations.note', 'What people made on this domain. Showing one adds a shaded tile to your hive. Serving it from a domain of your own requires choosing a local route.')))

    const known = this.#creations.get(zone)
    if (!known) { body.append(make('p', 'hd-note', t('hosts.probing', 'asking…'))); return }
    if (!known.rows.length) {
      body.append(make('p', 'hd-note', known.answered
        ? t('hosts.creations.none', 'No offerings available from this domain')
        : t('hosts.creations.silent', 'No offerings available from this domain')))
      return
    }
    const list = make('ul', 'hd-list')
    for (const row of known.rows) {
      const li = make('li', `hd-creation${row.offered ? ' held' : ''}`)
      const link = make('a', 'hd-creation-name', row.title)
      link.href = row.url
      link.target = '_blank'
      link.rel = 'noopener'
      link.title = t('hosts.creations.visit', 'Open on {host}', { host: row.host })
      li.append(link, make('span', 'hd-creation-by', row.publisherLabel))
      if (row.offer || row.offered) {
        const take = button(`hd-mark${row.offered ? '' : ' quiet'}`,
          row.offered ? t('hosts.creations.shown', 'shown') : t('hosts.creations.show', 'show'),
          row.offered
            ? t('hosts.creations.shown-title', 'Shown in your hive — press to stop showing it', { name: row.title })
            : t('hosts.creations.show-title', 'Show {name} in your hive — it stands shaded until you walk into it', { name: row.title }))
        take.addEventListener('click', () => {
          if (row.offered) EffectBus.emit('community:withdraw', { name: row.name })
          else if (row.offer) EffectBus.emit('community:offer', row.offer)
        })
        li.append(take)
      } else li.append(make('span', 'hd-mark quiet', t('hosts.creations.unheld', 'no verified head')))
      list.append(li)
    }
    body.append(list)
  }

  #renderMine(body: HTMLElement): void {
    const head = make('div', 'hd-crumbs')
    const back = button('hd-back', '‹', t('hosts.revisions.back', 'Back to the list'))
    back.addEventListener('click', () => { this.#view = 'domains'; this.#render() })
    head.append(back, make('span', 'hd-drill-title', t('hosts.mine.open', 'In your hive ({count})', { count: this.#mine.length })))
    body.append(head)
    const list = make('ul', 'hd-list')
    for (const row of this.#mine) {
      const li = make('li', 'hd-creation held')
      li.append(make('span', 'hd-creation-name', row.name), make('span', 'hd-creation-by', row.host))
      const shown = button('hd-mark', t('hosts.creations.shown', 'shown'), t('hosts.creations.shown-title', 'Shown in your hive — press to stop showing it', { name: row.name }))
      shown.addEventListener('click', () => EffectBus.emit('community:withdraw', { name: row.name }))
      li.append(shown)
      list.append(li)
    }
    body.append(list, make('p', 'hd-note', t('hosts.mine.note', 'Shown creations stand in your hive, shaded. Walking into one is what takes it.')))
  }

  // ── the acts ─────────────────────────────────────────────────────────────

  /** Turn a package on or off, by path. Held bytes make this a repoint and a
   *  restart; a package only a host carries is picked in from that host first,
   *  through the same gate every install passes. */
  async #toggle(row: DirectoryRow): Promise<void> {
    const reach = port()
    if (!reach || this.#busy || row.blockedBy) return
    if (!row.on && !row.held) {
      const tree = this.#carrying(row.path)
      const zones = tree && tree !== this.#next
        ? [...this.#served].filter(([, served]) => served === tree).map(([zone]) => zone)
        : []
      if (this.#askForCode(zones, row.layerSig, () => { void this.#toggle(row) })) return
    }
    const { install } = reach
    this.#busy = row.path
    this.#error = ''
    this.#renderBody()
    const before = new Set(install.offUnits())
    try {
      const off = new Set(before)
      if (row.on) off.add(row.path); else off.delete(row.path)
      install.setOffUnits(off)
      if (!row.held) {
        const tree = this.#carrying(row.path)
        const node = tree?.nodes.find(candidate => candidate.path === row.path)
        const roots = [...this.#served.values()]
          .filter((other): other is ServedTree => !!other && this.#offerable(other.root)
            && other.nodes.some(n => n.path === row.path && n.layerSig === node?.layerSig))
          .map(other => other.root)
        const outcome = tree && node
          ? await install.pick(row.path, { layer: node.layerSig, root: tree.root, roots }, this.#sources())
          : { ok: false, error: this.#isBehind(this.#scope) ? this.#behindText(this.#scope) : t('hosts.nothing-to-take', 'none of your hosts carries it') }
        if (!outcome.ok) { install.setOffUnits(before); this.#error = outcome.error ?? 'package incomplete'; return }
      } else if (!(await install.applyUnits())) {
        install.setOffUnits(before)
        this.#error = t('hosts.not-held', 'what runs here could not be read back, so nothing changed')
        return
      }
      this.#restart()
    } catch (error) {
      install.setOffUnits(before)
      this.#error = error instanceof Error ? error.message : 'package could not be applied'
    } finally {
      if (!this.#restarting) { this.#busy = ''; this.#renderBody() }
    }
  }

  /** Take the followed publisher's revision of ONE package — nothing beside it moves. */
  async #takeUpdate(row: DirectoryRow): Promise<void> {
    const next = this.#next
    const node = next?.nodes.find(candidate => candidate.path === row.path)
    if (!next || !node) return
    await this.#pick(row.path, { layer: node.layerSig, at: '', sources: [{ root: next.root, zone: '', at: '' }] }, false)
  }

  /** Move the trunk to what the followed publisher names now. Picks stay picked. */
  async #updateAll(): Promise<void> {
    const reach = port()
    if (!reach || this.#busy) return
    this.#busy = '*'
    this.#error = ''
    this.#renderBody()
    const held = new Set<string>()
    try {
      // The bar may still name the root the page opened on. Read what the
      // publisher names now and take that, before a single byte is asked for.
      const trunk = this.#selection?.trunk ?? null
      const named = await this.#namedRoot(trunk)
      if (named) {
        this.#named = named
        if (this.#next?.root !== named) {
          this.#offerable = this.#offerFor(named)
          this.#next = await this.#tree(named, this.#channelSources())
        }
      }
      const next = this.#next
      if (!next || (named && next.root !== named)) {
        this.#error = t('packages.updates.not-held', 'An update is ready, but none of your hosts has it yet')
        return
      }
      this.#held = held
      this.#renderBody()
      const had = await this.#runningFiles(reach)
      this.#had = had
      const outcome = await reach.install.acquire(next.root, [...new Set([...this.#sources(), ...this.#channelSources()])], {
        onHeld: sig => {
          const bare = bareSig(sig)
          if (had.has(bare)) return
          held.add(bare)
          this.#paintHeld()
        },
      })
      if (!outcome.ok) { this.#error = outcome.error ?? 'package incomplete'; return }
      this.#restart()
    } catch (error) {
      this.#error = error instanceof Error ? error.message : 'update could not be applied'
    } finally {
      if (!this.#restarting) { this.#busy = ''; this.#held = null; this.#renderBody() }
    }
  }

  /** Every file what runs here already holds: its layers, its bees, and its
   *  namespace bundles — so a file read back is never counted as the update. */
  async #runningFiles(reach: Port): Promise<Set<string>> {
    const files = filesOf(this.#selection?.nodes ?? [])
    const modules = await reach.install.modulesOf?.(null, []).catch(() => null) ?? null
    for (const bee of modules?.bees ?? []) files.add(bareSig(bee.sig))
    for (const dependency of modules?.dependencies ?? []) files.add(bareSig(dependency.sig))
    return files
  }

  /** Files arrive by the hundred — paint at most every tenth of a second. A
   *  timer, not a frame: a hidden tab never runs a frame. */
  #paintHeld(): void {
    if (this.#heldPaint) return
    this.#heldPaint = window.setTimeout(() => {
      this.#heldPaint = 0
      if (this.#held) this.#renderBody()
    }, 100)
  }

  async #openRevisions(path: string): Promise<void> {
    const reach = port()
    if (!reach?.recursive) return
    this.#view = 'revisions'
    this.#revPath = path
    this.#revisions = null
    this.#warning = null
    this.#error = ''
    this.#render()
    const roots = [...new Set([this.#named, this.#next?.root ?? '', ...[...this.#served.values()].map(tree => tree?.root ?? '')])]
      .filter(root => SIG_RE.test(root) && this.#offerable(root))
    const found = await reach.install.revisionsOf(path, this.#sources(), roots).catch(() => [])
    if (this.#view !== 'revisions' || this.#revPath !== path) return
    // Only what may be taken here, the followed publisher's named root first.
    this.#revisions = offeredRevisions(found, this.#offerable, this.#named, this.#follow()?.channel ?? 'essentials')
    this.#renderBody()
  }

  /** A newer revision is taken at once. An older one that would replace newer
   *  parts inside it — or picks made there — asks first. */
  async #chooseRevision(revision: InstallRevision): Promise<void> {
    const reach = port()
    const selection = this.#selection
    const path = this.#revPath
    if (!reach?.recursive || !selection?.trunk || this.#busy) return
    const running = selection.nodes.find(node => node.path === path)?.layerSig ?? ''
    if (revision.layer === running) return
    if (running && isOlder(this.#revisions ?? [], revision.layer, running)) {
      this.#busy = revision.layer
      this.#renderBody()
      const root = rootsFor(revision, selection.trunk)[0] ?? ''
      const nodes = root ? await reach.install.revisionNodes(path, root, this.#sources()).catch(() => []) : []
      this.#busy = ''
      const replaced = replacedBeneath(path, selection.nodes, nodes)
      const picksBeneath = Object.keys(selection.picks).filter(other => other !== path && within(other, path))
      if (replaced.length || picksBeneath.length) {
        this.#warning = { revision, replaced, picksBeneath }
        this.#renderBody()
        return
      }
    }
    await this.#pick(path, revision, false)
  }

  async #pick(path: string, revision: InstallRevision, hides: boolean): Promise<void> {
    const reach = port()
    const trunk = this.#selection?.trunk ?? null
    if (!reach?.recursive || !trunk) return
    // A source with no zone is held here or named by the followed publisher.
    const zones = revision.sources.map(source => source.zone)
    if (!zones.some(zone => !zone)
      && this.#askForCode(zones, revision.layer, () => { void this.#pick(path, revision, hides) })) return
    const roots = rootsFor(revision, trunk)
    this.#busy = revision.layer
    this.#error = ''
    this.#renderBody()
    try {
      const outcome = await reach.install.pick(path, { layer: revision.layer, root: roots[0] ?? '', roots }, this.#sources(), { hides })
      if (!outcome.ok) { this.#error = outcome.error ?? 'revision could not be taken'; return }
      this.#toList(this.#scope, parentOf(path))
      this.#restart()
    } catch (error) {
      this.#error = error instanceof Error ? error.message : 'revision could not be taken'
    } finally {
      if (!this.#restarting) { this.#busy = ''; this.#renderBody() }
    }
  }

  /** The tree to take a package from when it does not run here: the host in
   *  view first, then the followed publisher, then any host carrying it —
   *  never a host's tree this window may not offer (offerableRoots). */
  #carrying(path: string): ServedTree | null {
    const has = (tree: ServedTree | null | undefined): tree is ServedTree =>
      !!tree && this.#offerable(tree.root) && tree.nodes.some(node => node.path === path)
    if (this.#scope && has(this.#served.get(this.#scope))) return this.#served.get(this.#scope)!
    if (has(this.#next)) return this.#next
    for (const tree of this.#served.values()) if (has(tree)) return tree
    return null
  }

  #sources(): string[] {
    return [...new Set([this.#scope, ...this.#zones].filter(Boolean))]
  }

  /** Where the followed channel's package is served: the carried hosts, and
   *  the hosts the follow names. A package committed from inside a hive
   *  (module commit) is uploaded to the host its signed pointer lives on,
   *  which the participant need not carry. */
  #channelSources(): string[] {
    return [...new Set([...this.#zones, ...(this.#follow()?.hosts ?? []).map(zoneOf)].filter(Boolean))]
  }

  /** Whom builds follow here — the update scout's record. */
  #follow(): InstallFollow | null {
    try { return readInstallFollow(localStorage) } catch { return null }
  }

  /** Which roots may be offered, given the root the publisher names now. */
  #offerFor(named: string): (root: string) => boolean {
    let witnessed: Record<string, string> = {}
    try { witnessed = readWitnessed(localStorage) } catch { /* no storage: nothing witnessed */ }
    return offerableRoots({
      named,
      trunk: this.#selection?.trunk ?? null,
      picks: Object.values(this.#selection?.picks ?? {}).map(pick => pick.root),
      witnessed,
      followed: this.#follow()?.pubkey ?? null,
    })
  }

  #restart(): void {
    this.#restarting = true
    try { sessionStorage.setItem(REOPEN_KEY, JSON.stringify({ scope: this.#scope, at: this.#at })) } catch { /* opens fresh */ }
    EffectBus.emit('activity:log', { message: t('packages.restarting', 'packages changed; restarting') })
    setTimeout(() => location.reload(), 400)
  }

  // ── what is served ───────────────────────────────────────────────────────

  async #read(): Promise<void> {
    const reach = port()
    if (!reach) { this.#render(); return }
    const { install } = reach
    this.#reading = true
    this.#renderBody()
    try {
      this.#selection = await this.#selectionOf(reach)
      const trunk = this.#selection?.trunk ?? null
      const named = await this.#namedRoot(trunk)
      this.#named = named
      this.#offerable = this.#offerFor(named)
      if (named && named !== trunk) {
        const from = this.#channelSources()
        if (this.#next?.root !== named) this.#next = await this.#tree(named, from)
        this.#moved = reach.recursive
          ? new Set(await install.movedPaths(named, from).catch(() => []))
          : trunk ? new Set(await install.movedUnits(trunk, named, from).catch(() => [])) : null
      } else { this.#next = null; this.#moved = null }
      this.#render()
      // EVERY host's head, because the list is the union of them — each read
      // once per open and shown as it arrives.
      // An open and its zones landing are two reads a tick apart; they share
      // one in-flight head per zone instead of asking every host twice.
      await Promise.all(this.#zones.map(zone => {
        if (this.#served.has(zone)) return
        let pending = this.#heads.get(zone)
        if (!pending) {
          pending = (async () => {
            const head = await install.headOf(zone).catch(() => null)
            this.#served.set(zone, head ? await this.#tree(head, [zone]) : null)
            this.#render()
          })().finally(() => this.#heads.delete(zone))
          this.#heads.set(zone, pending)
        }
        return pending
      }))
    } finally {
      this.#reading = false
      this.#render()
    }
  }

  async #selectionOf(reach: Port): Promise<InstallSelection | null> {
    // Whatever a source shell has taken, it runs its working tree: nothing here
    // reads as running, and nothing turns on, off, or to another revision.
    if (runsSource()) return { trunk: null, picks: {}, applied: [], eclipsed: [], nodes: [] }
    if (reach.recursive) return reach.install.selection().catch(() => null)
    const trunk = reach.install.installedSig()
    const tree = trunk ? await this.#tree(trunk, []) : null
    return { trunk, picks: {}, applied: [], eclipsed: [], nodes: tree?.nodes ?? [] }
  }

  /** What the followed publisher names NOW. An installed build is read fresh
   *  (namedFromVerdict) — never from a witness, which only says a root was
   *  named once. A shell with nothing installed (localhost's source shell)
   *  attests the announcement the same way, so Update all follows a stamp
   *  that landed after the page opened. When that read cannot say, the
   *  scout's announcement, else `''` (unknown — the window then cuts nothing). */
  async #namedRoot(installedSig: string | null): Promise<string> {
    if (!installedSig) {
      const announced = this.#announced
      if (!SIG_RE.test(announced)) return announced
      const verdict = await attestPackage(announced, this.#zones, { fresh: true }).catch(() => null)
      return namedWhenUninstalled(announced, verdict)
    }
    const verdict = await attestPackage(installedSig, this.#zones, { fresh: true }).catch(() => null)
    return namedFromVerdict(verdict, installedSig) || this.#announced
  }

  #tree(root: string, zones: readonly string[]): Promise<ServedTree | null> {
    const key = `${root}|${zones.join(',')}`
    let pending = this.#trees.get(key)
    if (!pending) {
      pending = (async () => {
        const reach = port()
        if (!reach) return null
        const nodes: InstallNode[] = reach.recursive
          ? await reach.install.nodesOf(root, zones)
          : (await reach.install.unitsOf(root, zones)).map(unit => ({ path: unit.name, name: unit.name, layerSig: unit.layerSig, bees: unit.bees, children: [], description: unit.description, base: unit.layerSig }))
        return nodes.length ? { root, nodes } : null
      })().catch(() => null)
      this.#trees.set(key, pending)
    }
    return pending
  }
}

// ── material ─────────────────────────────────────────────────────────────────
// Restated by ROLE, never by colour (documentation/tool-window-colour-roles.md).
// Shape stays on the ladder: control 2 / card 3, through the shared tokens.

export function installHostDirectoryStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  const S = HOST_DIRECTORY_SURFACE
  style.textContent = `
${S}{display:block;}
${S} [hidden]{display:none!important;}
${S} .hd-panel{
  --acc:var(--hc-chrome-accent);
  --hc-window-accent:rgb(var(--acc));
  --hc-window-on-accent:var(--md-on-primary);
  --hd-ink:var(--hc-window-ink-loud,currentColor);
  --hd-ink-quiet:var(--hc-window-ink-quiet,currentColor);
  --hd-rule:var(--hc-window-line,rgba(128,128,128,0.18));
  --hd-ground:var(--md-surface,#0d151e);
  position:fixed;
  top:var(--hc-safe-top,0px);
  left:var(--hc-controls-left,0px)!important;
  right:max(var(--hc-inset-right,0px), var(--hc-controls-right,0px))!important;
  bottom:calc(max(var(--hc-controls-bottom,0px), var(--hc-safe-bottom,0px)) + var(--hc-mobile-row-lift,0px));
  width:auto!important;max-width:none!important;transform:none!important;
  z-index:60001;pointer-events:auto;box-sizing:border-box;
  display:flex;flex-direction:column;min-height:0;
  font-family:var(--hc-mono,system-ui);font-size:calc(1rem * var(--hc-panel-scale,1));
  color:var(--hd-ink);background:var(--hd-ground);outline:none;
}
${S} .hd-panel button:focus-visible,${S} .hd-panel input:focus-visible{outline:2px solid color-mix(in srgb, rgb(var(--acc)) 72%, white);outline-offset:1px;}
${S} .hd-head{flex:0 0 auto;display:flex;align-items:center;gap:.4em;padding:.55em .9em;border-bottom:1px solid var(--hd-rule);}
${S} .hd-grow{flex:1 1 auto;}
${S} .hd-title{font-size:.9em;letter-spacing:.05em;color:var(--hc-window-accent);}
${S} .hd-close{background:none;border:none;padding:0 .2em;font:inherit;font-size:1.3em;line-height:1;color:var(--hd-ink-quiet);cursor:pointer;}
${S} .hd-close:hover{color:var(--hd-ink);}
${S} .hd-frame{flex:1 1 auto;min-height:0;position:relative;display:grid;grid-template-columns:minmax(13rem,18rem) minmax(0,1fr);}
${S} .hd-frame.with-drawer{grid-template-columns:minmax(13rem,18rem) minmax(0,1fr) minmax(18rem,26rem);}
${S} .hd-side{min-height:0;overflow-y:auto;border-right:1px solid var(--hd-rule);padding:.5em .5em .8em;}
${S} .hd-main{min-width:0;min-height:0;overflow-y:auto;padding:.9em 1.3em 1.6em;}
${S} .hd-main > *{max-width:62rem;}
/* THE COLUMN BROWSER. A host's pane is its acts on top and the columns under
   them, full width and full height; every other pane keeps the readable column. */
${S} .hd-main.with-columns{display:flex;flex-direction:column;overflow:hidden;padding:.9em 0 0;}
${S} .hd-main.with-columns > *{max-width:none;}
${S} .hd-main.with-columns > :not(.hd-cols){flex:0 0 auto;margin-left:1.3em;margin-right:1.3em;}
${S} .hd-main.with-columns > .hd-cols{flex:1 1 auto;min-height:0;margin:.5em 0 0;}
/* The host's acts sit over the columns; they scroll before they take the columns' room. */
${S} .hd-main.with-columns > .hd-section-body{max-height:min(11rem,30vh);overflow-y:auto;}
${S} .hd-cols{display:flex;align-items:stretch;overflow-x:auto;overflow-y:hidden;border-top:1px solid var(--hd-rule);}
${S} .hd-cols-empty{margin:.8em 1.3em;}
${S} .hd-colbox{flex:0 0 17rem;width:17rem;min-height:0;display:flex;flex-direction:column;border-right:1px solid var(--hd-rule);}
${S} .hd-colhead{flex:0 0 auto;padding:.4em .75em;font-size:.68em;letter-spacing:.05em;color:var(--hd-ink-quiet);border-bottom:1px solid rgba(var(--acc),0.08);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .hd-col{flex:1 1 auto;min-height:0;overflow-y:auto;margin:0;padding:.15em 0;list-style:none;}
${S} .hd-col > li{outline:none;}
${S} .hd-col .hd-row{padding:.32em .6em;cursor:default;user-select:none;}
${S} .hd-col .hd-row.picked,${S} .hd-file.picked{background:rgba(var(--acc),0.18);}
${S} .hd-col .hd-row:focus-visible,${S} .hd-file:focus-visible{box-shadow:inset 0 0 0 2px color-mix(in srgb, rgb(var(--acc)) 72%, white);}
${S} .hd-opens{color:var(--hd-ink-quiet);padding:0 .25em;}
${S} .hd-file{display:grid;grid-template-columns:minmax(0,1fr);gap:.05em;padding:.38em .75em;border-bottom:1px solid rgba(var(--acc),0.06);cursor:default;user-select:none;}
${S} .hd-file:hover{background:rgba(var(--acc),0.05);}
${S} .hd-file-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8em;color:var(--hd-ink);}
${S} .hd-file-where{font-size:.62em;color:var(--hd-ink-quiet);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
/* THE MATRIX: one panel per picked file, as many across as there is room for. */
${S} .hd-matrix{flex:1 0 26rem;min-width:26rem;min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(22rem,1fr));gap:.6em;padding:.6em;align-content:start;}
${S} .hd-codebox{min-width:0;display:flex;flex-direction:column;border:1px solid var(--hd-rule);border-radius:var(--hc-radius-card,3px);background:color-mix(in srgb, rgb(var(--acc)) 2%, var(--hd-ground));}
${S} .hd-codehead{display:flex;align-items:baseline;gap:.6em;padding:.35em .6em;border-bottom:1px solid var(--hd-rule);}
${S} .hd-codename{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8em;color:var(--hd-ink);}
${S} .hd-codewhere{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.62em;color:var(--hd-ink-quiet);}
${S} .hd-code{margin:0;padding:.4em 0;overflow:auto;max-height:70vh;font-size:.7em;line-height:1.55;counter-reset:l;tab-size:2;}
${S} .hd-code .cl{counter-increment:l;white-space:pre;padding-right:1em;}
${S} .hd-code .cl::before{content:counter(l);display:inline-block;width:3.4em;margin-right:1em;text-align:right;color:var(--hd-ink-quiet);opacity:.55;user-select:none;}
${S} .hd-stack-note{margin:.2em 0 .5em;}
${S} .hd-drawer{min-width:0;min-height:0;overflow-y:auto;border-left:1px solid var(--hd-rule);padding:.7em 1em 1.4em;background:color-mix(in srgb, rgb(var(--acc)) 3%, var(--hd-ground));}
${S} .hd-pane-head{display:flex;align-items:center;gap:.6em;margin:0 0 .6em;}
${S} .hd-pane-title{margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:1.05em;font-weight:600;color:var(--hd-ink);}
${S} .hd-publish{font-size:.78em;}
${S} .hd-published{font-size:.74em;color:var(--hd-ink-quiet);white-space:nowrap;}
${S} .hd-dot{width:.55em;height:.55em;border-radius:50%;background:var(--hd-ink-quiet);opacity:.45;}
${S} .hd-dot.update{background:var(--hc-window-accent);opacity:1;}
${S} .hd-dot.behind{background:var(--hc-status-warn);opacity:1;}
${S} .hd-dot.own{background:none;border:1px solid var(--hd-ink-quiet);box-sizing:border-box;opacity:.8;}
${S} .hd-own-entry{margin-top:.4em;border-top:1px solid rgba(var(--acc),0.12);border-bottom:none;padding-top:.3em;}
${S} .hd-rail-note{list-style:none;}
${S} .hd-section{border-bottom:none;}
${S} .hd-section.open > .hd-domain{color:var(--hc-window-accent);background:rgba(var(--acc),0.09);}
${S} .hd-section-body{padding:0 0 .55em;}
${S} .hd-lines{list-style:none;margin:.05em 0 .7em;padding:0;display:flex;flex-wrap:wrap;gap:.25em 1.1em;font-size:.78em;}
${S} .hd-match-row{border-bottom:1px solid rgba(var(--acc),0.08);}
${S} .hd-match{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;column-gap:.5em;width:100%;padding:.45em .2em;font:inherit;font-size:.8em;color:var(--hd-ink);background:none;border:none;text-align:left;cursor:pointer;}
${S} .hd-match:hover{background:rgba(var(--acc),0.05);}
${S} .hd-match-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .hd-match-where{font-size:.85em;color:var(--hd-ink-quiet);}
${S} .hd-domain{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;column-gap:.6em;width:100%;padding:.5em .55em;border-radius:var(--hc-radius-control,2px);font:inherit;font-size:.82em;color:var(--hd-ink);background:none;border:none;text-align:left;cursor:pointer;}
${S} .hd-domain:hover{background:rgba(var(--acc),0.05);}
${S} .hd-domain-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .hd-chevron{color:var(--hd-ink-quiet);}
${S} .hd-add{display:flex;align-items:center;gap:.25em;margin:.7em 0 0;}
${S} .hd-add-input{flex:1 1 auto;min-width:0;padding:.2em .4em;font:inherit;font-size:.7em;color:var(--hd-ink);background:rgba(var(--acc),0.06);border:1px solid rgba(var(--acc),0.22);border-radius:var(--hc-radius-control,2px);}
${S} .hd-add-input[aria-invalid="true"]{border-color:var(--hc-status-alert);}
${S} .hd-own-label{flex:0 0 auto;font-size:.7em;color:var(--hd-ink);opacity:.7;white-space:nowrap;}
${S} .hd-quiet{padding:.2em .45em;font:inherit;font-size:.7em;color:var(--hd-ink-quiet);background:none;border:1px solid transparent;border-radius:var(--hc-radius-control,2px);cursor:pointer;}
${S} .hd-quiet:hover{color:var(--hd-ink);background:rgba(var(--acc),0.07);}
${S} .hd-quiet:disabled{cursor:default;opacity:.55;}
${S} .hd-search{padding:.2em .1em .5em;}
${S} .hd-input{width:100%;box-sizing:border-box;padding:.3em .45em;font:inherit;font-size:.8em;color:var(--hd-ink);background:rgba(var(--acc),0.06);border:1px solid rgba(var(--acc),0.22);border-radius:var(--hc-radius-control,2px);}
${S} .hd-link{padding:0;font:inherit;color:var(--hd-ink-quiet);background:none;border:none;text-decoration:none;cursor:pointer;}
${S} .hd-link:hover{color:var(--hd-ink);text-decoration:underline;}
${S} .hd-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:.25em;margin:.15em 0 .4em;font-size:.74em;}
${S} .hd-back{padding:0 .35em;font:inherit;font-size:1.2em;line-height:1;color:var(--hd-ink-quiet);background:none;border:none;cursor:pointer;}
${S} .hd-back:hover,${S} .hd-crumb:hover{color:var(--hd-ink);}
${S} .hd-crumb{padding:0;font:inherit;color:var(--hd-ink-quiet);background:none;border:none;cursor:pointer;}
${S} .hd-crumb.here{color:var(--hd-ink);}
${S} .hd-sep{color:var(--hd-ink-quiet);opacity:.6;}
${S} .hd-drill-title{color:var(--hd-ink);}
${S} .hd-updates{display:flex;align-items:center;justify-content:space-between;gap:.5em;margin:.2em 0 .5em;padding:.45em .6em;font-size:.76em;background:rgba(var(--acc),0.1);border:1px solid rgba(var(--acc),0.42);border-radius:var(--hc-radius-card,3px);}
${S} .hd-primary{padding:.38em .8em;font:inherit;font-size:.95em;font-weight:600;color:var(--hc-window-on-accent);background:var(--hc-window-accent);border:1px solid var(--hc-window-accent);border-radius:var(--hc-radius-control,2px);cursor:pointer;}
${S} .hd-primary:disabled{cursor:default;opacity:.55;}
${S} .hd-error{margin:.1em 0 .4em;font-size:.72em;line-height:1.35;color:var(--hc-status-alert);}
${S} .hd-note{margin:.5em 0 0;font-size:.72em;line-height:1.45;color:var(--hd-ink-quiet);}
${S} .hd-online{margin-top:1em;padding-top:.75em;border-top:1px solid rgba(var(--acc),0.12);}
${S} .hd-online-title{margin:0 0 .3em;font-size:inherit;font-weight:600;}
${S} .hd-online-steps{margin:.4em 0;padding-left:1.2em;display:flex;flex-direction:column;gap:.5em;}
${S} .hd-online-actions{display:flex;gap:.5em;flex-wrap:wrap;}
${S} .hd-online-link{color:var(--hc-window-accent);word-break:break-all;}
${S} .hd-online-said.ok{color:var(--hc-window-accent);}
${S} .hd-list{list-style:none;margin:0;padding:0;}
${S} .hd-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto auto auto;column-gap:.4em;align-items:center;padding:.3em .2em;border-bottom:1px solid rgba(var(--acc),0.08);}
${S} .hd-row:hover{background:rgba(var(--acc),0.04);}
${S} .hd-row.busy{cursor:progress;}
${S} .hd-row{position:relative;}
${S} .hd-row.updating,${S} .hd-row.updated{background:rgba(var(--acc),0.05);}
${S} .hd-progress{position:absolute;left:0;right:0;bottom:0;height:2px;background:rgba(var(--acc),0.12);pointer-events:none;}
${S} .hd-progress-fill{display:block;height:100%;background:var(--hc-window-accent);transition:width .2s ease-out;}
${S} .hd-row.updated .hd-progress-fill{background:var(--hc-status-ok);}
/* THE LIGHT: lit and current, lit and dim — dimmer the older the version running, set by --hd-age — or out. */
${S} .hd-bulb{display:inline-flex;padding:.1em;font-size:1em;line-height:1;color:var(--hc-status-warn);}
${S} .hd-bulb.behind{opacity:var(--hd-age,.55);}
${S} .hd-bulb.off,${S} .hd-row.off .hd-bulb{color:var(--hd-ink-quiet);}
/* THE MANAGE MENU: over the desk, beside the row it is for. */
${S} .hd-menu{position:absolute;z-index:5;min-width:13.5rem;display:flex;flex-direction:column;padding:.25em;background:var(--hd-ground);border:1px solid rgba(var(--acc),0.5);border-radius:var(--hc-radius-card,3px);box-shadow:0 8px 24px rgba(0,0,0,0.28);}
${S} .hd-menu-item{padding:.45em .7em;text-align:left;font:inherit;font-size:.78em;color:var(--hd-ink);background:none;border:none;border-radius:var(--hc-radius-control,2px);cursor:pointer;}
${S} .hd-menu-item:hover:not(:disabled){background:rgba(var(--acc),0.14);}
${S} .hd-menu-item:disabled{cursor:default;opacity:.45;}
${S} .hd-menu-item.accent{color:var(--hc-window-accent);}
${S} .hd-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8em;color:var(--hd-ink);background:none;border:none;padding:0;font-family:inherit;text-align:left;cursor:pointer;}
${S} .hd-name:hover{text-decoration:underline;}
${S} .hd-row.off .hd-name{color:var(--hd-ink-quiet);}
${S} .hd-marks{display:inline-flex;gap:.25em;}
${S} .hd-mark{padding:.05em .4em;font:inherit;font-size:.62em;letter-spacing:.06em;text-transform:uppercase;color:var(--hc-status-warn);background:none;border:1px solid rgba(var(--acc),0.35);border-radius:var(--hc-radius-control,2px);}
${S} button.hd-mark{cursor:pointer;}
${S} button.hd-mark:disabled{cursor:default;opacity:.55;}
${S} .hd-mark.quiet{color:var(--hd-ink-quiet);}
${S} .hd-count{min-width:1.2em;font-size:.62em;text-align:center;color:var(--hd-ink-quiet);}
${S} .hd-icon{padding:0 .25em;font:inherit;font-size:.9em;line-height:1;color:var(--hd-ink-quiet);background:none;border:none;cursor:pointer;}
${S} .hd-icon:hover{color:var(--hd-ink);}
${S} .hd-icon:disabled{cursor:default;opacity:.35;}
${S} .hd-icon-slot{width:.9em;}
${S} .hd-detail{grid-column:2 / -1;padding:.15em 0 .3em;}
${S} .hd-desc{margin:0 0 .2em;font-size:.68em;line-height:1.35;color:var(--hd-ink-quiet);}
${S} .hd-where{margin:.1em 0;font-size:.66em;line-height:1.35;color:var(--hd-ink-quiet);}
${S} .hd-rev-name{padding:.7em .2em .2em;font-size:.72em;letter-spacing:.05em;color:var(--hc-window-accent);list-style:none;}
${S} .hd-rev-name ~ .hd-rev{margin-left:.9em;}
${S} .hd-rev{border-bottom:1px solid rgba(var(--acc),0.08);}
${S} .hd-rev.busy{cursor:progress;}
${S} .hd-rev-choose{display:flex;align-items:center;gap:.6em;width:100%;padding:.4em .2em;font:inherit;font-size:.74em;color:var(--hd-ink);background:none;border:none;text-align:left;cursor:pointer;}
${S} .hd-rev-choose:hover:not(:disabled){background:rgba(var(--acc),0.06);}
${S} .hd-rev-choose:disabled{cursor:default;}
${S} .hd-rev-sig{font-variant-numeric:tabular-nums;}
${S} .hd-rev-at,${S} .hd-rev-hosts{color:var(--hd-ink-quiet);}
${S} .hd-rev-hosts{margin-right:auto;}
${S} .hd-warning{margin:.2em 0 .6em;padding:.5em .6em;font-size:.76em;border:1px solid color-mix(in srgb,var(--hc-status-alert) 55%,transparent);border-radius:var(--hc-radius-card,3px);}
${S} .hd-warning-title{margin:0 0 .3em;color:var(--hd-ink);}
${S} .hd-warning-list{margin:0 0 .5em;padding-left:1.1em;color:var(--hd-ink-quiet);}
${S} .hd-warning-list .quiet{list-style:none;}
${S} .hd-warning-acts{display:flex;align-items:center;gap:.5em;}
${S} .hd-creation{display:grid;grid-template-columns:minmax(0,1fr) auto auto;column-gap:.5em;align-items:center;padding:.3em .2em;border-bottom:1px solid rgba(var(--acc),0.08);font-size:.78em;}
${S} .hd-creation-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--hd-ink);text-decoration:none;}
${S} a.hd-creation-name:hover{text-decoration:underline;}
/* Three columns need room. Narrower than that the drawer lies over the list
   instead of squeezing it: the list underneath is not touched. */
@media (max-width:1100px){
${S} .hd-frame.with-drawer{grid-template-columns:minmax(13rem,18rem) minmax(0,1fr);}
${S} .hd-drawer{position:absolute;top:0;right:0;bottom:0;width:min(26rem,86%);z-index:2;box-shadow:-12px 0 24px rgba(0,0,0,0.18);}
}
@media (max-width:720px){
${S} .hd-frame,${S} .hd-frame.with-drawer{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);}
${S} .hd-side{max-height:36vh;border-right:none;border-bottom:1px solid var(--hd-rule);}
${S} .hd-drawer{position:absolute;inset:0;z-index:2;border-left:none;background:var(--hd-ground);}
}
${S} .hd-creation-by{font-size:.85em;color:var(--hd-ink-quiet);}
`
  document.head.appendChild(style)
}

/** The view's IoC face — the element is created by the shell's surface host,
 *  so the registered object forwards to whichever element is mounted. */
const facade = {
  current: null as HostDirectoryElement | null,
  get open(): boolean { return facade.current?.open ?? false },
}

type IocShape = {
  register?: (k: string, v: unknown) => void
  whenReady?: (k: string, cb: (v: { add(s: unknown): void }) => void) => void
}
const hostIoc = (): IocShape | undefined =>
  typeof window === 'undefined' ? undefined : (window as { ioc?: IocShape }).ioc

// hosts.drone.ts registers the facade and adds this element to the shell's
// surface registry (atomic-modules-plan.md): a dependency registers nothing.
export { facade as hostDirectoryFacade, OWNER as HOST_DIRECTORY_VIEW_KEY }
