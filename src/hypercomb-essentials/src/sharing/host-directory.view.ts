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
import { beeDocsOf, beeWords, normalizeMeta, readBeeMeta, writeBeeMeta, type BeeDoc, type BeeMeta, type BeeWords } from './bee-meta.js'
import { codeClass, codeLanguage, codeThemeCss, tokenizeCode, type CodeLanguage, type CodeToken } from './code-theme.js'
import {
  PANE_LIMITS, clampPane, crumbTrail, deskRecord, deskRecordText, drillPage, drillRows, finishedLast,
  type Crumb, type DeskMode, type DrillPage, type PaneName,
} from './host-directory.drill.js'
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

/** THE DESK'S GLYPHS — Material Symbols ligatures, each named once here so the
 *  font subset carries it (scripts/icon-names.cjs reads every `…Icon: '…'`). */
const GLYPHS = {
  deskIcon: 'dns',
  simpleIcon: 'view_list',
  advancedIcon: 'view_column',
  selectIcon: 'checklist',
  closeIcon: 'close',
  backIcon: 'arrow_back',
  opensIcon: 'chevron_right',
  homeIcon: 'home',
  originIcon: 'hive',
  hostIcon: 'public',
  addIcon: 'add_link',
  searchIcon: 'search',
  bulbIcon: 'lightbulb',
  manageIcon: 'more_horiz',
  updateIcon: 'update',
  updatesIcon: 'cloud_download',
  creationsIcon: 'collections',
  visitIcon: 'open_in_new',
  blockIcon: 'block',
  firewallIcon: 'shield',
  resumeIcon: 'play_arrow',
  removeIcon: 'delete',
  hiveIcon: 'hive',
  publishIcon: 'ios_share',
  publishedIcon: 'public',
  packagesIcon: 'extension',
  filesIcon: 'description',
  codeIcon: 'code',
  revisionsIcon: 'history',
  describeIcon: 'edit',
  moreIcon: 'unfold_more',
  stackIcon: 'layers',
  infoIcon: 'info',
  queenIcon: 'terminal',
  droneIcon: 'emoji_nature',
  workerIcon: 'handyman',
  beeIcon: 'hive',
  sourceIcon: 'data_object',
} as const
type Glyph = keyof typeof GLYPHS

/** A glyph, for the eye only — the words beside it are what is read out. */
const glyph = (name: Glyph, className = ''): HTMLSpanElement => {
  const span = make('span', className ? `mat-sym hd-glyph ${className}` : 'mat-sym hd-glyph', GLYPHS[name])
  span.setAttribute('aria-hidden', 'true')
  return span
}

/** The glyph a code file wears, by what the build says it is. */
export const kindGlyph = (kind: string): Glyph =>
  kind === 'queen' ? 'queenIcon'
    : kind === 'drone' ? 'droneIcon'
      : kind === 'worker' ? 'workerIcon'
        : kind === 'bee' ? 'beeIcon'
          : 'sourceIcon'

/** A HOST'S OWN HUE: the accent turned by its name — one of twelve, 30° apart, so
 *  hosts are told apart at a glance and every theme keeps its weight. Looks only,
 *  never an identity (FNV-1a over the name; 0 is the accent itself). */
export const hostHue = (zone: string): number => {
  let hash = 0x811c9dc5
  for (const ch of zone) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0
  return (hash % 12) * 30
}

/** The letter a host's hexagon carries. */
export const hostInitial = (label: string): string =>
  (label.replace(/^www\./i, '').match(/[a-z0-9]/i)?.[0] ?? '?').toUpperCase()

/** A host's hexagon — your Home Domain wears home, this origin (the hive you are in)
 *  the hive, any other host its letter on its own hue. `state` lights a dot: an update waits, or behind. */
const hostBadge = (zone: string, label: string, state: '' | 'update' | 'behind' = '', own = false): HTMLElement => {
  const badge = make('span', state ? `hd-avatar ${state}` : 'hd-avatar')
  badge.setAttribute('aria-hidden', 'true')
  const hex = make('span', 'hd-hex')
  if (own) { badge.classList.add('own'); hex.append(glyph('homeIcon')) }
  else if (!zone) { badge.classList.add('origin'); hex.append(glyph('originIcon')) }
  else { badge.style.setProperty('--hd-hue', String(hostHue(zone))); hex.textContent = hostInitial(label) }
  badge.append(hex)
  return badge
}

/** A small word with its glyph — the host's acts, the lines under a host's name. */
const glyphed = (node: HTMLElement, name: Glyph): HTMLElement => {
  node.classList.add('hd-chip')
  node.prepend(glyph(name))
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

/** A code file a package declares, the package that declares it, and the layer of
 *  that package — which is where the build wrote down what the file is (`docs.bees`). */
export interface FileRow { sig: string; path: string; layer: string }

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
      files.push({ sig: bare, path: node.path, layer: node.layerSig })
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path) || a.sig.localeCompare(b.sig))
}

/**
 * THE DEFAULT VIEW'S PACKAGES: where the desk looks before anyone has picked — a
 * trail of one path per column, so the four panes (hosts, packages, files, code)
 * are filled the moment it opens instead of waiting to be asked. The first package,
 * in the order the first column lists them, that declares code of its own and has no
 * sub-packages (a package with some opens a column of its own, and the four panes
 * would be five); failing that, the first that declares code at all; failing that,
 * the first one found going down the branches in the order they are listed.
 * Empty when nothing listed declares any (a host still being read, an empty one).
 */
export function defaultTrail(
  listed: (parent: string) => readonly { path: string; children: number }[],
  declares: (path: string) => boolean,
): string[] {
  const own = listed('').filter(row => declares(row.path))
  const leaf = own.find(row => row.children === 0) ?? own[0]
  if (leaf) return [leaf.path]
  const walk = (parent: string, trail: readonly string[], depth: number): string[] | null => {
    if (depth > 12) return null
    for (const row of listed(parent)) {
      const here = [...trail, row.path]
      if (declares(row.path)) return here
      if (row.children > 0) {
        const found = walk(row.path, here, depth + 1)
        if (found) return found
      }
    }
    return null
  }
  return walk('', [], 0) ?? []
}

/** A file with the words it goes by: its logical name first, its signature last. */
export interface FileLabel extends FileRow, BeeWords {
  /** The first line of the source, when it is a comment — `@scope/name`, where the file came from. */
  source: string
}

/**
 * THE FILES BY WHAT THEY ARE, not by what they hash to. Each is named by the two
 * voices of its meta layer (bee-meta.ts) — the participant's words over what the
 * layer's own `docs` say — then by where its first line says it came from, and
 * only last by its signature. Sorted by that name, so a package's files read as a
 * list of things rather than a list of hashes; the order is the one the column
 * shows, the one a shift-range walks and the one the matrix keeps.
 */
export function labelFiles(
  files: readonly FileRow[],
  lookup: {
    docs(layer: string): ReadonlyMap<string, BeeDoc> | undefined
    meta(sig: string): BeeMeta | undefined
    source(sig: string): string
  },
): FileLabel[] {
  return files
    .map(file => {
      const source = lookup.source(file.sig)
      const words = beeWords({ sig: file.sig, meta: lookup.meta(file.sig), doc: lookup.docs(file.layer)?.get(file.sig), fileName: source })
      return { ...file, ...words, source }
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.path.localeCompare(b.path) || a.sig.localeCompare(b.sig))
}

/** What a code file calls itself: its first line, when that is a comment (the
 *  build writes `// @scope/name` there). '' when it is not. */
export const codeName = (text: string): string => {
  const first = text.slice(0, 400).split('\n', 1)[0]?.trim() ?? ''
  return first.startsWith('//') ? first.replace(/^\/\/+\s*/, '').slice(0, 90) : ''
}

/** The small line under a file's name: what kind it is, the package that declares it, its signature's start. */
export const fileWhere = (file: Pick<FileLabel, 'kind' | 'path' | 'sig'>): string =>
  [file.kind, file.path, file.sig.slice(0, 8)].filter(Boolean).join(' · ')

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

type View = 'domains' | 'revisions' | 'creations' | 'mine' | 'own' | 'firewall'

/** How much of a code file is read, how many lines show at first, and how many
 *  files are read side by side in the matrix. */
const CODE_KEEP = 400_000
const CODE_LINES = 300
const CODE_PANELS = 6
/** Where the desk keeps what the participant chose: the way to look, and the width
 *  of each pane — one current record, written only by a press or a drag. */
const DESK_POOL = 'hosts:desk'
type DeskStore = {
  openPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'versions' | 'current' }) => Promise<string | null>
}
interface CodeRead { name: string; text: string; size: number; cut: boolean; language: CodeLanguage }
/** The words being written for one file: what is typed, and whether the save is out or failed. */
interface Describing { sig: string; name: string; description: string; busy: boolean; failed: boolean }

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

/** How a page arrives: on the desk opening, a step in, a step back, or a change of view. */
type PageEnter = 'open' | 'in' | 'out' | 'swap'
/** How long an arrival lasts, the stagger of its rows included (ms) — matched by the styles. */
const ENTER_MS = 600
/** How many packages the search lists across the network before it stops. */
const NETWORK_LINES = 30

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

/** The shell's outgoing firewall, when it runs one: the zones it owns and the ones paused.
 *  The shell script is its one writer — this view only reads it and offers the click. */
type Firewall = { zones(): string[]; paused(): string[] }
const firewallOf = (): Firewall | undefined => (window as { __hcFirewall?: Firewall }).__hcFirewall

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
  /** THE DEFAULT VIEW, owed until someone picks: the packages (a trail of one path
   *  per column) first, then — once the files are named — the first file, so the
   *  four panes are full on opening. Any pick of the participant's own cancels it. */
  #niceCols = true
  #niceFile = false
  /** SIMPLE (the default) or ADVANCED (the four panes), and the widths of the panes
   *  the participant has dragged — both kept between openings (`#keepRecord`). */
  #mode: DeskMode = 'simple'
  #panes: Partial<Record<PaneName, number>> = {}
  /** A press or a drag made before the kept record was read wins over it. */
  #touched = false
  /** SIMPLE: on the hosts list or drilled in; reading the code of the picked files. */
  #atHosts = true
  #readCode = false
  /** ADVANCED: SELECT is on — a plain click toggles a row, as a Ctrl/Cmd-click does. */
  #multi = false
  /** The line the keys last moved to — focused again once the columns are redrawn. */
  #focusKey: string | null = null
  /** THE MOTION. The page last drawn — what it showed, how deep, how it arrived and
   *  when — so a step in or back moves and a repaint does not (`#markEnter`). */
  #shownPage: { key: string; depth: number; mode: DeskMode; enter: PageEnter; at: number } | null = null
  /** Where each drill page was scrolled when it was left, and where the next draw puts it. */
  #scrollMemo = new Map<string, number>()
  #scrollTo: number | null = null
  #bodyScroll = 0
  /** When each column, code panel or menu first appeared (`#arriving`); what this draw
   *  showed, so what is gone arrives again when it comes back. */
  #entered = new Map<string, number>()
  #seen = new Set<string>()
  /** Code read by signature (null: asked of the hosts and not found). A signature
   *  is immutable, so what was read outlives an opening of the desk. */
  #code = new Map<string, CodeRead | null>()
  #codeAsk = new Set<string>()
  /** Files not held here: a host is not asked for one until it is picked. */
  #heldNot = new Set<string>()
  #codeFull = new Set<string>()
  #codePaint = 0
  /** WHAT EACH FILE IS — the meta layer (bee-meta.ts). What the build wrote down of
   *  every bee a layer declares (`docs.bees`), read once per layer, which is
   *  immutable; and the words a participant gave a file instead, from the pool
   *  `meta:bees` (`{}`: asked, none given). */
  #docs = new Map<string, ReadonlyMap<string, BeeDoc>>()
  #docsAsk = new Set<string>()
  #meta = new Map<string, BeeMeta>()
  #metaAsk = new Set<string>()
  #metaQueue: string[] = []
  #metaActive = 0
  /** The file whose words are being written, and what is typed so far. */
  #describing: Describing | null = null
  /** The tokens of a file's lines, by signature and how many lines are drawn. */
  #tokens = new Map<string, CodeToken[][]>()
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
    // The desk's mark: the hosts glyph the controls bar opens it with, on a hexagon.
    const mark = make('span', 'hd-deskmark')
    mark.setAttribute('aria-hidden', 'true')
    mark.append(glyph('deskIcon'))
    head.append(mark, make('span', 'hd-title', t('hosts.title', 'Host directory')), make('span', 'hd-grow'))
    // ONE SWITCH between the two ways to look: the simple drill, and the four panes —
    // a segment for each, the one in use lit. A segment pressed is that way; a key
    // press on the switch goes to the other.
    const modeButton = button('hd-modes', '')
    for (const [mode, icon] of [['simple', 'simpleIcon'], ['advanced', 'advancedIcon']] as const) {
      const segment = make('span', 'hd-seg')
      segment.dataset['mode'] = mode
      segment.append(glyph(icon), make('span', 'hd-seg-label'))
      modeButton.append(segment)
    }
    modeButton.addEventListener('click', event => {
      const pressed = (event.target as HTMLElement).closest<HTMLElement>('.hd-seg')?.dataset['mode']
      this.#setMode(pressed === 'simple' || pressed === 'advanced' ? pressed : this.#mode === 'simple' ? 'advanced' : 'simple')
    })
    // SELECT is the four panes' own: a toggle that makes every click a Ctrl/Cmd-click.
    const selectButton = button('hd-link hd-select', '')
    selectButton.setAttribute('aria-pressed', 'false')
    selectButton.append(glyph('selectIcon'), make('span', 'hd-select-label'))
    selectButton.addEventListener('click', () => this.#setMulti(!this.#multi))
    // THE FIREWALL, an alternate list (jwize 11-05: "the block can be an alternate list
    // toggled by icon in the header"): the domains this shell connects to, each with its
    // Block or Resume. The icon goes there and, pressed again, back. Only a shell that
    // runs the outgoing firewall has the list, so only that shell shows the icon.
    const wallButton = button('hd-icon hd-wall-toggle', '')
    wallButton.append(glyph('firewallIcon'))
    wallButton.setAttribute('aria-pressed', 'false')
    wallButton.addEventListener('click', () => {
      this.#view = this.#view === 'firewall' ? 'domains' : 'firewall'
      this.#render()
    })
    const close = button('hd-close', '', t('panel.close', 'close'))
    close.append(glyph('closeIcon'))
    close.addEventListener('click', () => EffectBus.emit('hosts:close', {}))
    head.append(wallButton, selectButton, modeButton, close)

    // THE DRILL'S SEARCH (jwize 11-05: "Pin the Search in simple view … basically the top
    // of all sections … including domains … the placeholder is Search Your Network (do
    // away with header)"): one field, pinned at the top of every page of the simple drill
    // in place of the page's caption. Built once, as the rail's is, so a repaint never
    // takes a half-typed word, its caret or a composition from it.
    const drillSearch = make('label', 'hd-drill-search')
    drillSearch.append(glyph('searchIcon', 'hd-search-glyph'))
    const drillInput = make('input', 'hd-input hd-drill-input')
    drillInput.type = 'search'
    drillInput.autocomplete = 'off'
    drillInput.spellcheck = false
    drillInput.dataset['field'] = 'drill-search'
    // A new query starts the page at its top: what it found is there, not scrolled past.
    const narrow = (): void => { this.#query = drillInput.value; this.#scrollTo = 0; this.#renderBody() }
    // A word still being composed (an IME) is not a query yet: the page waits for it.
    drillInput.addEventListener('input', event => { if (!(event as InputEvent).isComposing) narrow() })
    drillInput.addEventListener('compositionend', narrow)
    drillInput.addEventListener('keydown', event => this.#drillSearchKeys(event))
    drillSearch.append(drillInput)

    // THE RAIL: the search, the hosts, and a field to add one. The search and the
    // field are built once — a repaint redraws only the list between them, so a
    // read landing never takes the focus from a half-typed domain.
    const search = make('div', 'hd-search')
    search.append(glyph('searchIcon', 'hd-search-glyph'))
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
    // The first of the four panes says what it is, as the other three do.
    const railHead = make('div', 'hd-colhead hd-rail-head', t('hosts.pane.hosts', 'Hosts'))
    side.append(search, railHead, hosts, this.#addForm())
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
    // The rail's edge is draggable; the packages' and files' edges are drawn with the columns.
    frame.append(side, main, drawer, this.#splitter('rail'))

    panel.append(head, frame)
    this.#refs.set('mode', modeButton).set('select', selectButton).set('wall', wallButton)
    this.#refs.set('drillSearch', drillSearch).set('drillInput', drillInput)
    this.#refs.set('search', search).set('input', input).set('hosts', hosts).set('side', side).set('railHead', railHead)
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
    this.#applyPanes()
    this.#render()
    void this.#recallRecord(panel)
    requestAnimationFrame(() => panel.focus({ preventScroll: true }))
  }

  #unmount(): void {
    this.#opening++
    this.#menu = null
    this.#agesAsk.clear()
    this.#ageQueue = []
    this.#ageActive = 0
    for (const [key, stamp] of this.#ages) if (stamp === null) this.#ages.delete(key)
    // A layer that could not be read is asked again next time; one that was read is immutable.
    for (const [layer, docs] of this.#docs) if (!docs.size) this.#docs.delete(layer)
    // The next opening is a fresh desk, and opens on the default view again.
    this.#niceCols = true
    this.#niceFile = false
    this.#describing = null
    // The simple drill starts at the hosts list each time, and nothing stays checked.
    this.#atHosts = true
    this.#readCode = false
    this.#multi = false
    this.#touched = false
    // The next opening arrives as an opening: nothing it draws has been seen.
    this.#shownPage = null
    this.#entered.clear()
    this.#scrollMemo.clear()
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
    add.append(glyph('addIcon', 'hd-add-glyph'), field, go)
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
    this.#niceCols = true
    this.#niceFile = false
    this.#atHosts = true
    this.#readCode = false
    this.#multi = false
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
    // Back where a restart left it, in the simple drill too: inside the host, not on the list of them.
    this.#atHosts = false
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
    if (stack.keys.join('\n') !== before) {
      this.#cols = []; this.#files = NOTHING_PICKED; this.#at = ''
      // A new list opens on its own good first view, as the desk did.
      this.#niceCols = true; this.#niceFile = false
    }
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
    if (this.#describing) { this.#describing = null; this.#renderBody(); return true }
    if (this.#menu !== null) { this.#menu = null; this.#renderBody(); return true }
    // SELECT (four panes) lets go first: the next click is a plain pick again.
    if (this.#multi) { this.#setMulti(false); return true }
    if (this.#query) { this.#query = ''; this.#render(); return true }
    if (this.#codeGate) { this.#codeGate = null; this.#renderBody(); return true }
    if (this.#warning) { this.#warning = null; this.#renderBody(); return true }
    if (this.#view !== 'domains') { this.#view = 'domains'; this.#render(); return true }
    // The code page of the simple drill is one step in: back is the list of files.
    if (this.#readCode) { this.#readCode = false; this.#files = NOTHING_PICKED; this.#renderBody(); return true }
    // Letting go of the default view is the participant's own act: it does not come back.
    if (this.#files.keys.length) { this.#files = NOTHING_PICKED; this.#stopNice(); this.#renderBody(); return true }
    const deepest = this.#cols.map(column => column.keys.length > 0).lastIndexOf(true)
    if (deepest >= 0) { this.#cols = this.#cols.slice(0, deepest); this.#stopNice(); this.#renderBody(); return true }
    // Out of the first host back to the list of hosts — the simple drill's first step.
    if (this.#mode === 'simple' && !this.#atHosts) { this.#atHosts = true; this.#renderBody(); return true }
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
    const railHead = this.#refs.get('railHead')
    if (railHead) railHead.textContent = t('hosts.pane.hosts', 'Hosts')
    // The drill's search: one query, the same one the rail's search holds, so a move
    // between the two ways to look never strands what was typed.
    const drillInput = this.#refs.get('drillInput') as HTMLInputElement | undefined
    if (drillInput) {
      const asked = t('hosts.search-network', 'Search Your Network')
      drillInput.placeholder = asked
      drillInput.setAttribute('aria-label', asked)
      if (drillInput.value !== this.#query) drillInput.value = this.#query
    }
    // The firewall's icon: only where the shell runs one; lit while its list is up.
    const wall = this.#refs.get('wall')
    if (wall) {
      wall.hidden = !firewallOf()
      const label = t('hosts.firewall.title', 'Firewall — block or resume the domains this shell connects to')
      wall.setAttribute('aria-label', label)
      wall.title = label
      wall.setAttribute('aria-pressed', String(this.#view === 'firewall'))
    }
    // The switch shows both ways and lights the one in use; what it is called — and
    // what a key press on it does — is the OTHER way to look.
    const mode = this.#refs.get('mode')
    if (mode) {
      mode.dataset['mode'] = this.#mode
      mode.setAttribute('aria-label', this.#mode === 'simple' ? t('hosts.mode.advanced', 'Advanced') : t('hosts.mode.simple', 'Simple view'))
      mode.title = this.#mode === 'simple'
        ? t('hosts.mode.advanced-tip', 'The four panes: hosts, packages, files and code side by side')
        : t('hosts.mode.simple-tip', 'One list at a time — drill in to the code')
      mode.querySelectorAll<HTMLElement>('.hd-seg').forEach(segment => {
        const simple = segment.dataset['mode'] === 'simple'
        segment.classList.toggle('on', segment.dataset['mode'] === this.#mode)
        const label = segment.querySelector('.hd-seg-label')
        if (label) label.textContent = simple ? t('hosts.mode.simple-short', 'Simple') : t('hosts.mode.advanced', 'Advanced')
      })
    }
    // Select is only in the four panes; the drill picks by going in.
    const select = this.#refs.get('select')
    if (select) {
      select.hidden = this.#mode === 'simple'
      const word = select.querySelector('.hd-select-label')
      if (word) word.textContent = t('hosts.select', 'Select')
      select.title = t('hosts.select-tip', 'A click toggles a row in or out of what is picked — as Ctrl/Cmd-click does')
      select.setAttribute('aria-pressed', String(this.#multi))
    }
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
    // Read before the page is emptied: an emptied page has nothing to scroll.
    this.#bodyScroll = body.scrollTop
    const columnsBefore = body.querySelectorAll('.hd-colbox').length
    // A row that holds the focus keeps it through any repaint — a read landing is no reason to lose it.
    const held = body.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).closest<HTMLElement>('li[data-key]')?.dataset['key'] ?? null
      : null
    // Words being typed keep the field, the caret and the selection through a repaint.
    const active = document.activeElement
    const typed = (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && body.contains(active) && active.dataset['field']
      ? { field: active.dataset['field'], from: active.selectionStart, to: active.selectionEnd }
      : null
    this.#renderRail()
    body.replaceChildren()
    if (this.#codeGate) this.#renderCodeGate(body, this.#codeGate)
    // Revisions have a column of their own: under it the columns stay as they were.
    const drawer = this.#view === 'revisions'
    const under: View = drawer ? 'domains' : this.#view
    const simple = this.#mode === 'simple'
    this.#panel?.classList.toggle('simple', simple)
    body.classList.toggle('with-columns', !simple && under === 'domains' && !this.#query.trim())
    // How this view arrives — the drill decides inside, where it knows how deep it is.
    if (!simple || under !== 'domains') this.#markEnter(body, `${this.#mode}:${under}:${this.#stack.keys.join(',')}:${this.#query.trim() ? 'search' : ''}`, under === 'domains' ? 0 : 1)
    if (under === 'domains') { if (simple) this.#renderSimple(body); else this.#renderPane(body) }
    else {
      // Without the rail there is no way back from these but this.
      if (simple) body.append(this.#backRow())
      if (under === 'creations') this.#renderCreations(body)
      else if (under === 'mine') this.#renderMine(body)
      else if (under === 'firewall') this.#renderFirewall(body)
      else this.#renderOwn(body)
      // The drill's search reaches across the network from these panes too.
      const across = simple && under !== 'firewall' ? this.#networkMatches(new Set()) : null
      if (across) body.append(across)
    }
    this.#renderDrawer(drawer)
    this.#renderMenu()
    // What this draw no longer shows arrives again when it comes back.
    for (const key of [...this.#entered.keys()]) if (!this.#seen.has(key)) this.#entered.delete(key)
    this.#seen.clear()
    if (this.#scrollTo !== null) { body.scrollTop = this.#scrollTo; this.#scrollTo = null }
    const strip = body.querySelector<HTMLElement>('.hd-cols')
    if (strip) {
      strip.querySelectorAll<HTMLElement>('ul.hd-col').forEach((column, at) => { column.scrollTop = scrolls[at] ?? 0 })
      strip.scrollLeft = strip.querySelectorAll('.hd-colbox').length > columnsBefore ? strip.scrollWidth : sideways
      this.#restoreFocus(strip, held)
    } else {
      // The simple drill has no strip: the row the keys were on is found in its page.
      const page = body.querySelector<HTMLElement>('.hd-simple')
      if (page) this.#restoreFocus(page, held)
    }
    if (typed) {
      const again = body.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${typed.field}"]`)
      if (again && !again.disabled) {
        again.focus({ preventScroll: true })
        if (typed.from !== null && typed.to !== null) again.setSelectionRange(typed.from, typed.to)
      }
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
      header.append(hostBadge(domain.zone, domain.label, domain.update ? 'update' : domain.behind ? 'behind' : ''), make('span', 'hd-domain-name', domain.label))
      if (domain.update) header.append(make('span', 'hd-mark', t('packages.update-mark', 'update')))
      const count = make('span', 'hd-count', domain.count ? String(domain.count) : '')
      if (domain.count) count.title = t('hosts.package-count', '{count} packages', { count: domain.count })
      header.append(count)
      header.addEventListener('click', event => this.#pickHost(domain.zone, this.#modeOf(event), order))
      li.append(header)
      list.append(li)
    }
    const ownOpen = !searching && pane === OWN_PANE
    const own = make('li', `hd-section hd-own-entry${ownOpen ? ' open' : ''}`)
    const ownButton = button('hd-domain', '', t('hosts.your-host', 'Home Domain'))
    ownButton.dataset['pane'] = OWN_PANE
    if (ownOpen) ownButton.setAttribute('aria-current', 'true')
    ownButton.append(hostBadge('', '', '', true), make('span', 'hd-domain-name', t('hosts.your-host', 'Home Domain')))
    ownButton.addEventListener('click', () => this.#selectOwn())
    own.append(ownButton)
    list.append(own)
    if (this.#reading && domains.every(domain => !domain.count)) {
      const reading = make('li', 'hd-rail-note')
      reading.append(make('p', 'hd-note hd-reading', t('packages.reading', 'Reading what is served…')))
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
      const stackMark = make('span', 'hd-avatar hd-stackmark')
      stackMark.setAttribute('aria-hidden', 'true')
      const stackHex = make('span', 'hd-hex')
      stackHex.append(glyph('stackIcon'))
      stackMark.append(stackHex)
      stacked.append(stackMark, make('h2', 'hd-pane-title', t('hosts.stacked', '{count} hosts stacked', { count: this.#stack.keys.length })))
      body.append(stacked, make('p', 'hd-note hd-stack-note', this.#stack.keys.map(zone => domains.find(row => row.zone === zone)?.label ?? zone).join(' · ')))
      body.append(this.#renderColumns())
      return
    }
    const domain = domains.find(row => row.zone === this.#section) ?? domains[0]
    if (!domain) return
    body.append(this.#hostHead(domain))
    if (domain.behind) body.append(make('p', 'hd-note hd-behind', this.#behindText(domain.label)))
    body.append(this.#sectionBody(domain.zone))
    body.append(this.#renderColumns())
  }

  /** A host's name, whether an update waits there, and the one door to Publish. */
  #hostHead(domain: DomainRow): HTMLElement {
    const head = make('div', 'hd-pane-head hd-host-hero')
    head.append(hostBadge(domain.zone, domain.label, domain.update ? 'update' : domain.behind ? 'behind' : ''), make('h2', 'hd-pane-title', domain.label))
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
      const publish = button('hd-link hd-publish', t('hosts.publish', 'Publish'), t('hosts.publish-tip', 'Open Publish — what goes out to your domains'))
      publish.prepend(glyph('publishIcon'))
      publish.append(glyph('opensIcon', 'hd-opens'))
      publish.addEventListener('click', () => this.#openPublish())
      head.append(publish)
    }
    return head
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
    const head = make('div', 'hd-pane-head hd-host-hero')
    head.append(hostBadge('', '', '', true), make('h2', 'hd-pane-title', t('hosts.your-host', 'Home Domain')))
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
    field.placeholder = t('hosts.own-host-placeholder', 'your home domain — where your backup goes')
    field.setAttribute('aria-label', t('hosts.own-host', 'Home Domain'))
    field.title = t('hosts.own-host', 'Home Domain')
    const go = make('button', 'hd-quiet', t('hosts.own-host-set', 'Set'))
    go.type = 'submit'
    const label = make('label', 'hd-own-label', t('hosts.own-host', 'Home Domain'))
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
        this.#stopNice()
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
    glyphed(toggle, blocked ? 'resumeIcon' : 'blockIcon')
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
      addLine(glyphed(creations, 'creationsIcon'))
      if (hostZone(this.#scope) !== this.#home) {
        const visit = make('a', 'hd-link', t('hosts.visit', 'Visit'))
        visit.href = `https://${this.#scope}/`
        visit.target = '_blank'
        visit.rel = 'noopener'
        visit.title = t('hosts.visit-tip', 'Open {host} in a new tab', { host: this.#scope })
        addLine(glyphed(visit, 'visitIcon'))
      }
      // Blocking this host's zone is the firewall's list now, behind the shield in the header.
      const remove = button('hd-link', t('hosts.remove-short', 'Remove'), t('hosts.remove', 'Remove {host} from your host directory', { host: this.#scope }))
      remove.addEventListener('click', () => {
        const zone = this.#scope
        this.#toDomains()
        EffectBus.emit('hosts:remove', { zone })
        this.#render()
      })
      addLine(glyphed(remove, 'removeIcon'))
    } else {
      if (this.#mine.length) {
        const mine = button('hd-link', t('hosts.mine.open', 'In your hive ({count})', { count: this.#mine.length }))
        mine.addEventListener('click', () => { this.#view = 'mine'; this.#render() })
        addLine(glyphed(mine, 'hiveIcon'))
      }
      // The firewall — every zone this shell owns, Block or Resume — is its own list,
      // behind the shield in the header (`#renderFirewall`).
    }
    if (lines.childElementCount) section.append(lines)

    // EVERYTHING THE FOLLOWED PUBLISHER MOVED, in one act — this origin only.
    // It is a source shell's one act too: it follows the channel, so taking the
    // revision records it while the code it runs stays its working tree.
    if (!zone && (trunk || runsSource()) && this.#next && this.#next.root !== trunk) {
      const bar = make('div', 'hd-updates')
      bar.setAttribute('role', 'status')
      bar.append(glyph('updatesIcon', 'hd-updates-glyph'))
      // While it moves, the bar is one whole sentence — a done-of-total over the
      // changed files, the same count the rows fill against — and no button.
      const moving = this.#held
      const overall = moving ? updateProgress('', this.#next.nodes, this.#had, moving) : null
      bar.append(make('span', 'hd-updates-text', !moving
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
      bar.append(glyph('updatesIcon', 'hd-updates-glyph'), make('span', '', t('packages.updates.not-held', 'An update is ready, but none of your hosts has it yet')))
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

  /** THE FIREWALL, as its own list (jwize 11-05: "the block can be an alternate list
   *  toggled by icon in the header"): every zone this shell owns, whether it is open or
   *  blocked, and the one act that flips it. Every zone is open until it is blocked;
   *  a block pauses every connection to it until it is resumed. The click is the human
   *  door — the shell's own script writes the list; this view offers the click and
   *  draws what the list says. A sentence never flips one. */
  #renderFirewall(body: HTMLElement): void {
    const head = make('div', 'hd-pane-head hd-host-hero')
    const mark = make('span', 'hd-avatar hd-wallmark')
    mark.setAttribute('aria-hidden', 'true')
    const hex = make('span', 'hd-hex')
    hex.append(glyph('firewallIcon'))
    mark.append(hex)
    head.append(mark, make('h2', 'hd-pane-title', t('hosts.firewall.heading', 'Firewall')))
    body.append(head, make('p', 'hd-note', t('hosts.firewall.note', 'Every domain this shell connects to is open until you block it. A block pauses every connection to it until you resume it.')))
    const wall = firewallOf()
    const owned = wall?.zones() ?? []
    const zones = owned.filter(zone => this.#hits(zone))
    if (!zones.length) {
      body.append(owned.length ? this.#nothingFound() : make('p', 'hd-note', t('hosts.firewall.empty', 'This shell owns no domain to block.')))
      return
    }
    const paused = wall?.paused() ?? []
    const list = make('ul', 'hd-list hd-wall')
    for (const zone of zones) {
      const blocked = paused.includes(zone)
      const li = make('li', blocked ? 'hd-wall-row blocked' : 'hd-wall-row')
      const state = make('span', blocked ? 'hd-mark hd-wall-state' : 'hd-mark quiet hd-wall-state',
        blocked ? t('hosts.firewall.blocked', 'blocked') : t('hosts.firewall.open', 'open'))
      li.append(hostBadge(zone, zone), make('span', 'hd-wall-name', zone), state, this.#firewallToggle(zone, paused))
      list.append(li)
    }
    body.append(list)
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
    this.#niceView()
    const model = this.#columnModel()
    if (!model.length) {
      strip.append(make('p', this.#reading || !this.#loaded ? 'hd-note hd-cols-empty hd-reading' : 'hd-note hd-cols-empty', this.#reading || !this.#loaded
        ? t('packages.reading', 'Reading what is served…')
        : t('packages.empty', 'Nothing listed here yet.')))
      this.#at = ''
      return strip
    }
    const top = this.#stack.keys.length > 1
      ? t('hosts.stacked-packages', 'Packages across {count} hosts', { count: this.#stack.keys.length })
      : t('hosts.packages', 'Packages')
    model.forEach(({ rows, picked, parents }, k) => {
      const column = this.#packageColumn(rows, k, picked, k === 0 ? top : parents.join(' · '))
      // A column opened by a pick arrives from the side it opens on.
      this.#arriving(`col:${k}:${parents.join(',')}`, column)
      strip.append(column)
    })
    // The packages' edge: drag it to set how wide the package columns are.
    strip.append(this.#splitter('packages'))
    // Where a restart should put you back: the one package the columns end on.
    const last = [...model].reverse().find(column => column.picked.keys.length)
    this.#at = last && last.picked.keys.length === 1 ? last.picked.keys[0]! : ''

    const { files, paths } = this.#fileModel(model)
    // The default view's file: the first by name, once the names are in — before that
    // the order is the signatures', and the first of those is nobody's choice.
    if (this.#niceFile && files.length && !this.#files.keys.length && files.every(file => this.#docs.has(file.layer))) {
      this.#niceFile = false
      this.#files = pickKey(NOTHING_PICKED, files[0]!.sig, 'only', files.map(file => file.sig))
    }
    if (this.#describing && !this.#files.keys.includes(this.#describing.sig)) this.#describing = null
    // FOUR PANES, always: the hosts in the rail, then packages, files and code. The last
    // two are drawn before there is anything to put in them, and say what they wait for.
    strip.append(this.#fileColumn(files, paths), this.#splitter('files'))
    if (files.length) {
      this.#wantCode(files)
      this.#wantWords(files)
    }
    strip.append(this.#codeMatrix(files))
    return strip
  }

  // ── the simple drill ─────────────────────────────────────────────────────
  //
  // One large list in the middle, and a step in at a time: the hosts, a host's
  // packages (and the packages inside one), the files a package declares, the code.
  // It is the same state the four panes read — `#stack`, `#cols`, `#files` — shown
  // one step at a time, so a step in is a pick and a step back is `#back`.

  /** A check box on a row of the four panes, while Select is on. The drill has none:
   *  it has no multiple select — that is for the four panes (Ctrl/Cmd-click, or Select). */
  #checkBox(on: boolean): HTMLElement {
    const box = make('span', `hd-check${on ? ' on' : ''}`, on ? '✓' : '')
    box.setAttribute('aria-hidden', 'true')
    return box
  }

  /** How a click picks in the four panes: the Finder's way (Ctrl/Cmd toggles, Shift
   *  extends), and with SELECT on a plain click toggles too. */
  #modeOf(event: MouseEvent): PickMode {
    const mode = pickMode(event)
    return this.#multi && mode === 'only' ? 'toggle' : mode
  }

  /** SELECT, in the four panes: while it is on every click toggles a row in or out of
   *  what is picked. Ctrl/Cmd-click does the same without it. */
  #setMulti(on: boolean): void {
    this.#multi = on
    this.#refs.get('select')?.setAttribute('aria-pressed', String(on))
    this.#renderBody()
  }

  /** A click on a row of the drill: one step in. */
  #chooseRow(key: string, kind: 'host' | 'package' | 'file', k: number): void {
    this.#stopNice()
    // A step in from a narrowed list starts the next page whole.
    this.#query = ''
    if (kind === 'host') { this.#openHosts([key]); return }
    if (kind === 'package') {
      this.#cols = [...this.#cols.slice(0, k), { keys: [key], anchor: key }]
      this.#files = NOTHING_PICKED
    } else {
      this.#files = { keys: [key], anchor: key }
      this.#readCode = true
    }
    this.#renderBody()
  }

  /** Go into these hosts: one, or several stacked — their packages are one list — and,
   *  from a line the search found, straight down to that package. */
  #openHosts(zones: readonly string[], at = ''): void {
    const keys = zones.length ? [...zones] : ['']
    this.#stack = { keys, anchor: keys[0]! }
    this.#section = keys[0]!
    this.#scope = keys[0]!
    this.#view = 'domains'
    this.#query = ''
    this.#warning = null
    this.#error = ''
    this.#cols = this.#chainTo(at)
    this.#files = NOTHING_PICKED
    this.#at = at
    this.#atHosts = false
    this.#readCode = false
    this.#stopNice()
    if (at) this.#focusKey = at
    this.#render()
  }

  #renderSimple(body: HTMLElement): void {
    const model = this.#atHosts ? [] : this.#columnModel()
    const { files, paths } = this.#atHosts ? { files: [] as FileLabel[], paths: [] as string[] } : this.#fileModel(model)
    const page = drillPage({ atHosts: this.#atHosts, reading: this.#readCode, filesPicked: this.#files.keys.length })
    // Words being typed in the editor must not outlive the file they are for.
    if (this.#describing && !this.#files.keys.includes(this.#describing.sig)) this.#describing = null
    // HOW THE PAGE ARRIVES: a step in slides in from the right, a step back from the left.
    const trail = this.#trail(page, model, files)
    const depth = page === 'hosts' ? 0 : page === 'code' ? 2 + model.length : 1 + drillRows(model).level
    // The page is told by what it is OF — hosts, picks and files by key, never by the
    // names drawn, which change as the reads land and would make a repaint look new.
    const keyOf = [page, this.#atHosts ? '' : this.#stack.keys.join(','), model.map(column => column.picked.keys.join('+')).join('/'), page === 'code' ? this.#files.keys.join('+') : '']
    this.#markEnter(body, `drill:${keyOf.join('|')}`, depth)
    const wrap = make('div', `hd-simple${page === 'code' ? ' wide' : ''}`)
    wrap.addEventListener('keydown', event => this.#simpleKeys(event))
    wrap.append(this.#simpleHead(page, trail))
    if (this.#error) {
      const err = make('p', 'hd-error', this.#error)
      err.setAttribute('role', 'alert')
      wrap.append(err)
    }
    if (page === 'hosts') this.#hostsPage(wrap)
    else if (page === 'packages') this.#packagesPage(wrap, model, files, paths)
    else this.#codePage(wrap, files)
    body.append(wrap)
  }

  /** The trail of where the drill is: the hosts, the host(s) opened, each level of
   *  packages picked, and the file being read — named by what it is. */
  #trail(page: DrillPage, model: readonly { picked: Picked }[], files: readonly FileLabel[]): Crumb[] {
    const domains = this.#domains()
    const labelOf = (zone: string): string => domains.find(row => row.zone === zone)?.label ?? zone
    return crumbTrail({
      atHosts: this.#atHosts,
      hosts: this.#stack.keys.map(labelOf),
      picks: model.map(column => column.picked.keys),
      // The file being read is named — by what it is, not by what it hashes to.
      reading: page === 'code' ? this.#files.keys.map(sig => files.find(file => file.sig === sig)?.name ?? sig.slice(0, 12)) : [],
    })
  }

  /** THE PINNED BAR at the top of every page of the drill: the way back and the trail
   *  of where you are — each crumb behind you a way back to it — and the search, in
   *  place of the page's caption. On the domains page, where there is nothing behind
   *  you, the search is the whole bar. */
  #simpleHead(page: DrillPage, trail: readonly Crumb[]): HTMLElement {
    const head = make('div', 'hd-simple-head')
    if (page !== 'hosts') {
      const back = button('hd-back', '', t('hosts.back', 'Back'))
      back.append(glyph('backIcon'))
      back.addEventListener('click', () => { this.#back() })
      const nav = make('nav', 'hd-trail')
      nav.setAttribute('aria-label', t('hosts.trail', 'Where you are'))
      trail.forEach((crumb, at) => {
        if (at) nav.append(glyph('opensIcon', 'hd-trail-sep'))
        const text = crumb.kind === 'hosts' ? t('hosts.pane.hosts', 'Hosts')
          : crumb.kind === 'host' ? (crumb.one || t('hosts.stacked', '{count} hosts stacked', { count: crumb.count }))
            : crumb.kind === 'package' ? (crumb.one || t('hosts.trail.packages', '{count} packages', { count: crumb.count }))
              : (crumb.one || t('hosts.trail.files', '{count} files', { count: crumb.count }))
        const icon: Glyph = crumb.kind === 'hosts' ? 'deskIcon' : crumb.kind === 'host' ? (crumb.count > 1 ? 'stackIcon' : 'hostIcon') : crumb.kind === 'package' ? 'packagesIcon' : 'codeIcon'
        if (at === trail.length - 1) {
          const now = make('span', 'hd-trail-now', text)
          now.prepend(glyph(icon))
          now.setAttribute('aria-current', 'page')
          nav.append(now)
          return
        }
        const step = button('hd-trail-step', text)
        step.prepend(glyph(icon))
        step.addEventListener('click', () => this.#backTo(at + 1))
        nav.append(step)
      })
      head.append(back, nav)
    }
    head.append(this.#drillSearchField())
    return head
  }

  /** The drill's one search field — the same node on every page, so what is typed,
   *  the caret and the focus outlive any repaint. */
  #drillSearchField(): HTMLElement {
    return this.#refs.get('drillSearch') ?? make('span')
  }

  /** Keys in the drill's search: Down goes to the first line found, Enter opens it.
   *  Escape is the desk's — it lets go of the query first (`#back`). */
  #drillSearchKeys(event: KeyboardEvent): void {
    if (event.isComposing) return
    if (event.key !== 'ArrowDown' && event.key !== 'Enter') return
    const first = this.#refs.get('body')?.querySelector<HTMLElement>('li[data-key], .hd-match')
    if (!first) return
    event.preventDefault()
    if (event.key === 'Enter') first.click()
    else first.focus()
  }

  /** What the search asks of a line: every word typed is somewhere in what it says. */
  #hits(...texts: readonly (string | undefined)[]): boolean {
    const words = this.#query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return true
    const said = texts.filter(Boolean).join(' ').toLowerCase()
    return words.every(word => said.includes(word))
  }

  /** WHAT THE SEARCH FINDS ACROSS YOUR NETWORK, under the page's own narrowed list: the
   *  domains whose names match, and the packages — at any depth — of every host you
   *  carry, one line each however many carry it. A line jumps to its place in the
   *  drill. What the page already shows is left out. Nothing when nothing is typed. */
  #networkMatches(shown: ReadonlySet<string>): HTMLElement | null {
    if (!this.#query.trim()) return null
    const domains = this.#domains()
    const labelOf = (zone: string): string => domains.find(row => row.zone === zone)?.label ?? zone
    const list = make('ul', 'hd-list hd-matches')
    list.setAttribute('aria-label', t('hosts.search.across', 'Across your network'))
    const line = (badge: HTMLElement, label: string, where: string, go: () => void, update = false): void => {
      const li = make('li', 'hd-match-row')
      const choose = button('hd-match', '')
      choose.append(badge, make('span', 'hd-match-name', label))
      if (update) choose.append(make('span', 'hd-mark', t('packages.update-mark', 'update')))
      choose.append(make('span', 'hd-match-where', where))
      choose.addEventListener('click', go)
      li.append(choose)
      list.append(li)
    }
    for (const domain of domains) {
      if (shown.has(`host:${domain.zone}`) || !this.#hits(domain.label, domain.zone)) continue
      line(hostBadge(domain.zone, domain.label, domain.update ? 'update' : domain.behind ? 'behind' : ''), domain.label, t('hosts.domain', 'domain'),
        () => this.#openHosts([domain.zone]), domain.update)
    }
    const carried = domains.map(domain => ({ zone: domain.zone, rows: this.#rows(domain.zone, '', this.#query) }))
    let packages = 0
    for (const match of stackRows(carried)) {
      // Its own name or words, not a parent's: "desk" finds the desks, not every part of one.
      if (shown.has(match.path) || !this.#hits(match.name, match.description)) continue
      if (++packages > NETWORK_LINES) break
      line(glyph('packagesIcon', 'hd-kind'), match.path, match.zones.map(labelOf).join(' · '),
        () => this.#openHosts([match.zones[0] ?? ''], match.path), match.update)
    }
    if (!list.childElementCount) return null
    const box = make('section', 'hd-across')
    box.append(make('h3', 'hd-across-title', t('hosts.search.across', 'Across your network')), list)
    return box
  }

  /** Nothing on the page and nothing across the network: said once, plainly. */
  #nothingFound(): HTMLElement {
    return make('p', 'hd-note hd-none', t('hosts.no-match', 'Nothing matches “{query}”.', { query: this.#query.trim() }))
  }

  /** A crumb pressed: step back, rung by rung, until the trail ends on it. */
  #backTo(length: number): void {
    for (let guard = 0; guard < 24; guard++) {
      const model = this.#atHosts ? [] : this.#columnModel()
      const page = drillPage({ atHosts: this.#atHosts, reading: this.#readCode, filesPicked: this.#files.keys.length })
      if (this.#trail(page, model, []).length <= length || !this.#back()) return
    }
  }

  /** How the page arrives — a step in from the right, a step back from the left, a
   *  change of view crossfaded — told by what it shows and how deep it is against the
   *  page before. A repaint of the same page does not move; one landing while the page
   *  is still arriving carries the animation on where it was (`--hd-since`). */
  #markEnter(body: HTMLElement, key: string, depth: number): void {
    const now = performance.now()
    const last = this.#shownPage
    let enter: PageEnter | '' = !last ? 'open'
      : last.mode !== this.#mode ? 'swap'
        : last.key !== key ? (depth > last.depth ? 'in' : depth < last.depth ? 'out' : 'swap')
          : ''
    let at = now
    if (!enter && last && now - last.at < ENTER_MS) { enter = last.enter; at = last.at }
    // A step back finds the list where it was left; a step in starts at its top.
    if (last && last.key !== key && this.#mode === 'simple') {
      this.#scrollMemo.set(last.key, this.#bodyScroll)
      this.#scrollTo = enter === 'out' ? this.#scrollMemo.get(key) ?? 0 : 0
    }
    this.#shownPage = enter
      ? { key, depth, mode: this.#mode, enter, at }
      : { key, depth, mode: this.#mode, enter: last?.enter ?? 'open', at: last?.at ?? 0 }
    if (enter) {
      body.dataset['enter'] = enter
      body.style.setProperty('--hd-since', `${Math.round(now - at)}ms`)
    } else {
      delete body.dataset['enter']
      body.style.removeProperty('--hd-since')
    }
  }

  /** Something that has just appeared — a column, a code panel, the menu — arrives;
   *  under ENTER_MS a repaint carries its arrival on, past it it is simply there. */
  #arriving(key: string, node: HTMLElement): void {
    const now = performance.now()
    this.#seen.add(key)
    const at = this.#entered.get(key)
    if (at === undefined) this.#entered.set(key, now)
    const since = now - (at ?? now)
    if (since >= ENTER_MS) return
    node.classList.add('hd-enter')
    node.style.setProperty('--hd-since', `${Math.round(since)}ms`)
  }

  /** PAGE ONE: your network, large — this origin, every host you carry, your Home
   *  Domain, and the way to add one. The search at the top narrows the domains as it
   *  is typed, and finds the packages under them across the network. */
  #hostsPage(wrap: HTMLElement): void {
    const domains = this.#domains()
    const list = make('ul', 'hd-col hd-bigrows hd-hosts-list')
    list.setAttribute('role', 'listbox')
    list.setAttribute('aria-label', t('hosts.network', 'Your Network'))
    // A host is a card: its hexagon, its name, what it carries — and the way in.
    const card = (li: HTMLElement, badge: HTMLElement, name: string, about: string): void => {
      const words = make('span', 'hd-host-words')
      words.append(make('span', 'hd-host-name', name))
      if (about) words.append(make('span', 'hd-host-about', about))
      li.append(badge, words)
    }
    const shown = new Set<string>()
    domains.filter(domain => this.#hits(domain.label, domain.zone)).forEach((domain, at) => {
      shown.add(`host:${domain.zone}`)
      const li = make('li', 'hd-row hd-host-row')
      li.dataset['key'] = domain.zone
      li.setAttribute('role', 'option')
      li.setAttribute('aria-selected', 'false')
      li.tabIndex = at === 0 ? 0 : -1
      li.style.setProperty('--i', String(at))
      const state = domain.update ? 'update' : domain.behind ? 'behind' : ''
      card(li, hostBadge(domain.zone, domain.label, state), domain.label,
        domain.count ? t('hosts.package-count', '{count} packages', { count: domain.count }) : '')
      const marks = make('span', 'hd-marks')
      if (domain.update) marks.append(make('span', 'hd-mark', t('packages.update-mark', 'update')))
      if (domain.behind) li.title = this.#behindText(domain.label)
      li.append(marks, glyph('opensIcon', 'hd-opens'))
      li.addEventListener('click', () => this.#chooseRow(domain.zone, 'host', -1))
      list.append(li)
    })
    let ownZone = ''
    try { ownZone = zoneOf(localStorage.getItem(OWN_HOST_KEY) ?? '') } catch { ownZone = '' }
    const ownName = t('hosts.your-host', 'Home Domain')
    if (this.#hits(ownName, ownZone)) {
      const own = make('li', 'hd-row hd-host-row hd-own-row')
      own.dataset['key'] = OWN_PANE
      own.setAttribute('role', 'option')
      own.tabIndex = list.childElementCount ? -1 : 0
      own.style.setProperty('--i', String(list.childElementCount))
      card(own, hostBadge('', '', '', true), ownName, ownZone)
      own.append(make('span', 'hd-marks'), glyph('opensIcon', 'hd-opens'))
      own.addEventListener('click', () => this.#selectOwn())
      list.append(own)
    }
    if (this.#reading && domains.every(domain => !domain.count)) list.append(make('li', 'hd-note hd-reading', t('packages.reading', 'Reading what is served…')))
    const across = this.#networkMatches(shown)
    if (list.childElementCount) wrap.append(list)
    if (across) wrap.append(across)
    if (!list.childElementCount && !across) wrap.append(this.#nothingFound())
    // Adding a domain is not a search: the field stays, whatever is typed above.
    wrap.append(this.#addForm())
  }

  /** PAGE TWO: what is inside — a host's packages, then the parts of one, with the
   *  files that package declares under them. */
  #packagesPage(wrap: HTMLElement, model: readonly { rows: readonly StackRow[]; picked: Picked; parents: string[] }[], files: readonly FileLabel[], paths: readonly string[]): void {
    const { level, rows } = drillRows(model)
    // At the top of a host, the host itself: its name, its door to Publish, what it carries.
    if (level === 0) {
      const domains = this.#domains()
      const domain = this.#stack.keys.length === 1 ? domains.find(row => row.zone === this.#stack.keys[0]) : undefined
      if (domain) {
        wrap.append(this.#hostHead(domain))
        if (domain.behind) wrap.append(make('p', 'hd-note hd-behind', this.#behindText(domain.label)))
        wrap.append(this.#sectionBody(domain.zone))
      }
    }
    if (!model.length) {
      wrap.append(make('p', this.#reading || !this.#loaded ? 'hd-note hd-reading' : 'hd-note', this.#reading || !this.#loaded
        ? t('packages.reading', 'Reading what is served…')
        : t('packages.empty', 'Nothing listed here yet.')))
      return
    }
    // THE SEARCH narrows this page — the packages listed and the files under them — and
    // finds the rest across the network below.
    const searching = !!this.#query.trim()
    // A line is found by its own name and words — not its parent's, which every line on the page shares.
    const listed = searching ? rows.filter(row => this.#hits(row.name, row.description)) : rows
    const found = searching ? files.filter(file => this.#hits(file.name, file.kind, file.source, file.description)) : files
    if (listed.length) {
      const caption = level === 0
        ? (this.#stack.keys.length > 1
          ? t('hosts.stacked-packages', 'Packages across {count} hosts', { count: this.#stack.keys.length })
          : t('hosts.packages', 'Packages'))
        : (model[level]?.parents ?? []).join(' · ')
      wrap.append(this.#packageColumn(listed, level, NOTHING_PICKED, caption))
    }
    if (paths.length) {
      if (!searching || found.length) wrap.append(this.#fileColumn(found, paths))
      if (files.length) {
        this.#wantCode(files)
        this.#wantWords(files)
      }
    }
    const across = this.#networkMatches(new Set(listed.map(row => row.path)))
    if (across) wrap.append(across)
    if (searching && !listed.length && !found.length && !across) wrap.append(this.#nothingFound())
  }

  /** PAGE THREE: the code of the file, or files, chosen. */
  #codePage(wrap: HTMLElement, files: readonly FileLabel[]): void {
    if (files.length) {
      this.#wantCode(files)
      this.#wantWords(files)
    }
    wrap.append(this.#codeMatrix(files))
    const across = this.#networkMatches(new Set())
    if (across) wrap.append(across)
  }

  /** Where the way back is for the panes the drill has no list of (your host, the
   *  creations a host serves, what is in your hive). */
  #backRow(): HTMLElement {
    const row = make('div', 'hd-simple-head hd-simple-back')
    const back = button('hd-back', '', t('hosts.back', 'Back'))
    back.append(glyph('backIcon'))
    back.addEventListener('click', () => { this.#back() })
    row.append(back, make('span', 'hd-trail-now', t('hosts.back', 'Back')), this.#drillSearchField())
    return row
  }

  /** In the drill the arrows only MOVE along a list; going in is Enter or a click. */
  #simpleKeys(event: KeyboardEvent): void {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const line = target.closest<HTMLElement>('li[data-key]')
    const list = line?.parentElement
    if (!line || !list) return
    const lines = [...list.querySelectorAll<HTMLElement>(':scope > li[data-key]')]
    const at = lines.indexOf(line)
    const move = (by: number): void => {
      event.preventDefault()
      lines[Math.max(0, Math.min(lines.length - 1, at + by))]?.focus()
    }
    if (event.key === 'ArrowDown') move(1)
    else if (event.key === 'ArrowUp') move(-1)
    else if ((event.key === 'Enter' || event.key === ' ') && target === line) { event.preventDefault(); line.click() }
  }

  // ── the way to look, and the width of the panes — both remembered ────────

  #setMode(mode: DeskMode): void {
    if (mode === this.#mode) return
    this.#mode = mode
    this.#touched = true
    // Select belongs to the four panes: it is off in the other way of looking, and off on the way.
    this.#multi = false
    this.#refs.get('select')?.setAttribute('aria-pressed', 'false')
    this.#readCode = false
    this.#menu = null
    if (mode === 'simple') {
      // What was typed comes along — the drill's search holds the same query the rail's
      // does — and where the four panes were is where the drill is: the hosts, if
      // nothing was picked.
      this.#atHosts = !this.#cols.some(column => column.keys.length)
    } else if (!this.#cols.some(column => column.keys.length) && !this.#files.keys.length) {
      this.#niceCols = true
      this.#niceFile = false
    }
    void this.#keepRecord()
    this.#render()
  }

  /** A pane's edge, to drag. The width is set live and kept when it is let go; the
   *  arrow keys nudge it, and a double-click gives it back to the default. */
  #splitter(pane: PaneName): HTMLElement {
    const bar = make('div', `hd-split hd-split-${pane}`)
    const limits = PANE_LIMITS[pane]
    bar.setAttribute('role', 'separator')
    bar.setAttribute('aria-orientation', 'vertical')
    bar.setAttribute('aria-valuemin', String(limits.min))
    bar.setAttribute('aria-valuemax', String(limits.max))
    bar.setAttribute('aria-valuenow', String(this.#paneWidth(pane)))
    bar.setAttribute('aria-label', t('hosts.split', 'Drag to resize — double-click to reset'))
    bar.title = t('hosts.split', 'Drag to resize — double-click to reset')
    bar.tabIndex = 0
    const rem = (): number => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    bar.addEventListener('pointerdown', down => {
      if (down.button !== 0) return
      down.preventDefault()
      const start = this.#paneWidth(pane)
      const from = down.clientX
      bar.setPointerCapture(down.pointerId)
      bar.classList.add('dragging')
      const move = (event: PointerEvent): void => this.#setPane(pane, start + (event.clientX - from) / rem(), false)
      const end = (): void => {
        bar.removeEventListener('pointermove', move)
        bar.removeEventListener('pointerup', end)
        bar.removeEventListener('pointercancel', end)
        bar.classList.remove('dragging')
        void this.#keepRecord()
      }
      bar.addEventListener('pointermove', move)
      bar.addEventListener('pointerup', end)
      bar.addEventListener('pointercancel', end)
    })
    bar.addEventListener('keydown', event => {
      const by = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
      if (!by) return
      event.preventDefault()
      this.#setPane(pane, this.#paneWidth(pane) + by, true)
      bar.setAttribute('aria-valuenow', String(this.#paneWidth(pane)))
    })
    bar.addEventListener('dblclick', () => this.#resetPane(pane))
    return bar
  }

  #paneWidth(pane: PaneName): number {
    return this.#panes[pane] ?? PANE_LIMITS[pane].start
  }

  #setPane(pane: PaneName, rem: number, keep: boolean): void {
    this.#panes[pane] = clampPane(pane, rem)
    this.#touched = true
    this.#applyPanes()
    if (keep) void this.#keepRecord()
  }

  #resetPane(pane: PaneName): void {
    delete this.#panes[pane]
    this.#touched = true
    this.#applyPanes()
    void this.#keepRecord()
  }

  /** The widths the participant set, as custom properties on the desk — a pane that
   *  has none keeps the stylesheet's own. */
  #applyPanes(): void {
    const panel = this.#panel
    if (!panel) return
    const names: Record<PaneName, string> = { rail: '--hd-rail-w', packages: '--hd-pkg-w', files: '--hd-files-w' }
    for (const pane of Object.keys(names) as PaneName[]) {
      const width = this.#panes[pane]
      if (typeof width === 'number') panel.style.setProperty(names[pane], `${width}rem`)
      else panel.style.removeProperty(names[pane])
    }
  }

  /** The one current record, written only by a press or a drag — never by the desk itself. */
  async #keepRecord(): Promise<void> {
    try {
      const store = ioc<DeskStore>('@hypercomb.social/Store')
      const pool = await store?.getPool?.(DESK_POOL)
      if (!pool || !store?.putPoolDoc) return
      const bytes = new TextEncoder().encode(deskRecordText({ mode: this.#mode, panes: this.#panes })).buffer as ArrayBuffer
      await store.putPoolDoc(pool, bytes, undefined, { keep: 'current' })
    } catch { /* not kept this time: the desk is exactly as it was drawn */ }
  }

  /** What the participant left: the way to look and the widths. A read never mints the
   *  pool, and a press or a drag made first is newer than it. */
  async #recallRecord(panel: HTMLElement): Promise<void> {
    try {
      const store = ioc<DeskStore>('@hypercomb.social/Store')
      const pool = await store?.openPool?.(DESK_POOL)
      if (!pool || !store?.getPoolDoc) return
      const bytes = await store.getPoolDoc(pool)
      if (!bytes || this.#panel !== panel || this.#touched) return
      const record = deskRecord(JSON.parse(new TextDecoder().decode(bytes)))
      this.#panes = { ...record.panes }
      this.#applyPanes()
      this.#mode = record.mode
      this.#atHosts = true
      this.#render()
    } catch { /* no record, or not ours: the desk opens as it does for everyone */ }
  }

  /** The files of what is picked, named by what they are — for the four panes and the
   *  simple drill alike: what is picked here must be among them, and the order is the
   *  one every pick walks. */
  #fileModel(model: readonly { picked: Picked }[]): { files: FileLabel[]; paths: string[] } {
    const { files: held, paths } = this.#pickedFiles(model)
    this.#files = stillPicked(this.#files, held.map(file => file.sig))
    const files = labelFiles(held, {
      docs: layer => this.#docs.get(layer),
      meta: sig => this.#meta.get(sig),
      source: sig => this.#code.get(sig)?.name ?? '',
    })
    return { files, paths }
  }

  /** A pick in a package column: what is deeper no longer applies, and the files
   *  are the picked packages' own. */
  #pickPackage(k: number, path: string, mode: PickMode, order: readonly string[]): void {
    this.#cols = [...this.#cols.slice(0, k), pickKey(this.#cols[k] ?? NOTHING_PICKED, path, mode, order)]
    this.#files = NOTHING_PICKED
    this.#focusKey = path
    this.#stopNice()
    this.#renderBody()
  }

  #pickFile(sig: string, mode: PickMode, order: readonly string[]): void {
    this.#files = pickKey(this.#files, sig, mode, order)
    this.#focusKey = sig
    this.#stopNice()
    this.#renderBody()
  }

  /** THE DEFAULT VIEW is a courtesy for a desk nobody has touched. A pick of the
   *  participant's own — or letting one go — ends it for good: the desk never puts
   *  back what was chosen away. */
  #stopNice(): void {
    this.#niceCols = false
    this.#niceFile = false
  }

  /**
   * The four panes are never left waiting to be asked: with nothing picked, the
   * first package that declares code is picked down its trail (`defaultTrail`) and
   * its files, then its first file, open the next panes — so a desk opens as a
   * place, not an empty list. Waits for what it needs (the list, then the files'
   * names) and gives up quietly once everything is read and nothing declares code.
   */
  #niceView(): void {
    if (!this.#niceCols) return
    if (this.#cols.some(column => column.keys.length) || this.#files.keys.length) { this.#stopNice(); return }
    const nodes = this.#treeNodes()
    const trail = defaultTrail(parent => this.#childRows([parent]), path => filesPicked(nodes, [path]).length > 0)
    if (!trail.length) {
      // An empty list is a list still being read — a followed host's tree lands some
      // seconds after the desk opens — so it is waited for. The default is given up
      // only when something IS listed, nothing is being read, and none of it declares code.
      if (!this.#reading && this.#childRows(['']).length) this.#stopNice()
      return
    }
    this.#cols = trail.map(key => ({ keys: [key], anchor: key }))
    this.#niceCols = false
    this.#niceFile = true
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
      this.#stopNice()
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
  #colHead(label: string, icon?: Glyph): HTMLElement {
    const head = make('div', 'hd-colhead', label)
    head.title = label
    if (icon) head.prepend(glyph(icon))
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
    // A package whose update has landed (every changed file of it is in) drops to the
    // bottom of the list with a completed look, so what is still moving stays in view.
    const landed = (row: StackRow): boolean => {
      if (!moving || !row.update) return false
      const measured = updateProgress(row.path, this.#next?.nodes ?? [], this.#had, moving)
      return !!measured.total && measured.done >= measured.total
    }
    const shown = finishedLast(changing.length ? changing : rows, landed)
    const order = shown.map(row => row.path)
    const simple = this.#mode === 'simple'
    const tabbable = picked.keys.find(path => order.includes(path)) ?? order[0]
    shown.forEach((row, index) => {
      const li = make('li', 'hd-row')
      li.dataset['key'] = row.path
      li.style.setProperty('--i', String(index))
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
      // or off. It tells, and a press on it switches (jwize, 2026-11-10: "Yes, bulb
      // switches" — until then the switch was only inside the manage menu).
      const running = this.#selection?.nodes.find(node => node.path === row.path)?.layerSig ?? ''
      if (row.on && row.update && running) this.#queueAge(row.path, running)
      const stamp = this.#ages.get(`${row.path}\n${running}`)
      const light = lightOf(row, stamp, Date.now())
      const bulb = button(`hd-bulb ${light.state}`, '')
      bulb.tabIndex = -1
      bulb.style.setProperty('--hd-age', String(light.level))
      const lit = light.state === 'off'
        ? t('hosts.light.off', '{name} is off', { name: row.path })
        : light.state === 'on'
          ? t('hosts.light.on', '{name} is on', { name: row.path })
          : typeof stamp === 'number'
            ? t('hosts.light.behind', '{name} is on, and a newer version exists — the one running is from {date}', { name: row.path, date: new Date(stamp).toISOString().slice(0, 10) })
            : t('hosts.light.behind-unknown', '{name} is on, and a newer version exists', { name: row.path })
      // The same rule the menu's first item follows, and the same reason when it cannot.
      const switching = this.#switchable(row)
      const press = row.on
        ? t('packages.turn-off', 'Turn off {name}', { name: row.path })
        : t('packages.turn-on', 'Turn on {name}', { name: row.path })
      bulb.setAttribute('aria-pressed', String(row.on))
      bulb.setAttribute('aria-label', switching.blocked ? lit : press)
      bulb.title = [lit, switching.blocked ? switching.reason : press].filter(Boolean).join(' — ')
      bulb.disabled = switching.blocked
      bulb.addEventListener('click', () => { void this.#toggle(row) })
      bulb.append(glyph('bulbIcon', row.on ? 'filled' : ''))

      // The name is the line: clicking it, or the row around it, picks.
      const name = button('hd-name', row.name)
      name.tabIndex = -1
      const words = make('span', 'hd-pkg-words')
      words.append(name)
      if (simple && row.description) words.append(make('span', 'hd-pkg-about', row.description))

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
      const manage = button('hd-icon hd-manage', '', t('hosts.manage', 'Manage {name}', { name: row.path }))
      manage.append(glyph('manageIcon'))
      manage.tabIndex = -1
      manage.setAttribute('aria-haspopup', 'menu')
      manage.setAttribute('aria-expanded', String(this.#menu === row.path))
      manage.addEventListener('click', () => { this.#menu = this.#menu === row.path ? null : row.path; this.#renderBody() })

      if (progress) {
        const done = progress.total > 0 && progress.done >= progress.total
        li.classList.add(done ? 'updated' : 'updating')
        if (done) li.classList.add('completed')
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
      li.append(bulb, words, marks, count, manage)
      // Parts inside it open as the next column when it is picked.
      if (row.children) li.append(glyph('opensIcon', 'hd-opens'))
      else li.append(make('span', 'hd-icon-slot'))

      // The four panes: a check box on every row while Select is on.
      if (!simple && this.#multi) {
        li.classList.add('hd-checking')
        li.prepend(this.#checkBox(picked.keys.includes(row.path)))
      }
      li.addEventListener('click', event => {
        if ((event.target as HTMLElement).closest('button:not(.hd-name), a')) return
        if (simple) this.#chooseRow(row.path, 'package', k)
        else this.#pickPackage(k, row.path, this.#modeOf(event), order)
      })
      list.append(li)
    })
    const box = make('div', 'hd-colbox')
    box.append(this.#colHead(caption, 'packagesIcon'), list)
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
    const { blocked, reason } = this.#switchable(row)

    const menu = make('div', 'hd-menu')
    menu.setAttribute('role', 'menu')
    const item = (icon: Glyph, label: string, go: () => void, off = false, title = '', accent = false): void => {
      const entry = button(`hd-menu-item${accent ? ' accent' : ''}`, label)
      entry.prepend(glyph(icon))
      entry.setAttribute('role', 'menuitem')
      entry.disabled = off
      if (title) entry.title = title
      entry.addEventListener('click', () => { this.#menu = null; go() })
      menu.append(entry)
    }
    item('bulbIcon', row.on
      ? t('packages.turn-off', 'Turn off {name}', { name: row.path })
      : t('packages.turn-on', 'Turn on {name}', { name: row.path }), () => { void this.#toggle(row) }, blocked, reason)
    if (row.update) {
      item('updateIcon', t('hosts.update-newest', 'Update {name} to the newest', { name: row.path }), () => { void this.#takeUpdate(row) }, !acts || !recursive || !!this.#busy, '', true)
    }
    item('revisionsIcon', t('hosts.revisions.pick', 'Pick a revision…'), () => { void this.#openRevisions(row.path) }, !recursive)
    item('codeIcon', t('hosts.code.look', 'Look at the code'), () => this.#lookAtCode(k, row, model[k]!.rows.map(candidate => candidate.path)))

    this.#arriving(`menu:${path}`, menu)
    panel.append(menu)
    const at = anchor.getBoundingClientRect()
    const host = panel.getBoundingClientRect()
    const left = Math.max(8, Math.min(host.width - menu.offsetWidth - 8, at.right - host.left - menu.offsetWidth))
    let top = at.bottom - host.top + 4
    if (top + menu.offsetHeight > host.height - 8) top = Math.max(8, at.top - host.top - menu.offsetHeight - 4)
    menu.style.left = `${Math.round(left)}px`
    menu.style.top = `${Math.round(top)}px`
  }

  /** Whether a package can be switched on or off here, and why not when it
   *  cannot — one rule for the bulb on the row and the menu's first item. */
  #switchable(row: DirectoryRow): { blocked: boolean; reason: string } {
    const reach = port()
    const acts = !!reach && !!this.#selection?.trunk
    const untakeable = !row.held && !this.#carrying(row.path)
    const blocked = !acts || !!this.#busy || !!row.blockedBy || (!row.held && !reach?.recursive) || untakeable
    const reason = row.blockedBy
      ? t('hosts.blocked', 'Turn on {name} first', { name: row.blockedBy })
      : untakeable && this.#isBehind(this.#scope)
        ? this.#behindText(this.#scope)
        : !acts
          ? t('hosts.from-source', 'This shell loads its packages from source, so turning them on or off and picking revisions happens on a hive.')
          : ''
    return { blocked, reason }
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

  /** THE FILES PANE — the third of the four, and always there: the code files the
   *  picked packages declare, by what they are, or what it waits for. */
  #fileColumn(files: readonly FileLabel[], paths: readonly string[]): HTMLElement {
    if (!files.length) {
      const waiting = make('div', 'hd-colbox hd-filesbox hd-files-empty')
      waiting.append(
        this.#colHead(t('hosts.files', 'Files'), 'filesIcon'),
        make('p', 'hd-note hd-pane-empty', paths.length
          ? t('hosts.files.none', 'This package declares no code of its own.')
          : t('hosts.files.pick', 'Pick a package to see the code it declares.')),
      )
      return waiting
    }
    const list = make('ul', 'hd-col hd-files')
    list.setAttribute('role', 'listbox')
    list.setAttribute('aria-multiselectable', 'true')
    const caption = t('hosts.files-in', 'Files in {paths}', { paths: paths.join(' · ') })
    list.setAttribute('aria-label', caption)
    const order = files.map(file => file.sig)
    // The drill picks nothing here: a file is opened by going in. The four panes pick.
    const simple = this.#mode === 'simple'
    const picked = simple ? NOTHING_PICKED : this.#files
    const tabbable = picked.keys.find(sig => order.includes(sig)) ?? order[0]
    files.forEach((file, index) => {
      const li = make('li', 'hd-file')
      li.dataset['key'] = file.sig
      li.setAttribute('role', 'option')
      li.setAttribute('aria-selected', String(picked.keys.includes(file.sig)))
      li.tabIndex = file.sig === tabbable ? 0 : -1
      if (picked.keys.includes(file.sig)) li.classList.add('picked')
      if (!simple && this.#multi) li.classList.add('hd-checking')
      const yours = file.yoursName || file.yoursDescription
      if (yours) li.classList.add('mine')
      // Its name first; what kind it is, the package that declares it and the start
      // of its signature after — the signature is how it is found, not who it is.
      li.append(make('span', 'hd-file-name', file.name), make('span', 'hd-file-where', fileWhere(file)))
      li.prepend(glyph(kindGlyph(file.kind), 'hd-kind'))
      li.style.setProperty('--i', String(index))
      li.title = [file.name, file.description, `${file.path} · ${file.sig}`, yours ? t('hosts.meta.yours', 'Described by you') : '']
        .filter(Boolean).join('\n')
      if (!simple && this.#multi) li.prepend(this.#checkBox(picked.keys.includes(file.sig)))
      li.addEventListener('click', event => {
        if (simple) this.#chooseRow(file.sig, 'file', -1)
        else this.#pickFile(file.sig, this.#modeOf(event), order)
      })
      list.append(li)
    })
    const box = make('div', 'hd-colbox hd-filesbox')
    box.append(this.#colHead(caption, 'filesIcon'), list)
    // The files of a new pick arrive; the drill's page arrives whole.
    if (!simple) this.#arriving(`files:${paths.join(',')}`, box)
    return box
  }

  /** THE CODE PANE — the fourth of the four, captioned like the rest and always
   *  there: the matrix when a file is picked, and what it waits for when not. */
  #codeMatrix(files: readonly FileLabel[]): HTMLElement {
    const pane = make('section', 'hd-codepane')
    const caption = t('hosts.code', 'Code')
    pane.setAttribute('aria-label', caption)
    pane.append(this.#colHead(caption, 'codeIcon'))
    if (this.#files.keys.length) pane.append(this.#codeGrid(files))
    else pane.append(make('p', 'hd-note hd-pane-empty', t('hosts.code.pick', 'Pick a file to read its code here.')))
    return pane
  }

  /** THE MATRIX: every picked file read side by side, one panel each. */
  #codeGrid(files: readonly FileLabel[]): HTMLElement {
    const matrix = make('div', 'hd-matrix')
    const order = files.map(file => file.sig)
    const shown = this.#files.keys.slice(0, CODE_PANELS)
    for (const sig of shown) {
      const file = files.find(candidate => candidate.sig === sig)
      const read = this.#code.get(sig)
      const name = file?.name ?? read?.name ?? sig.slice(0, 12)
      const box = make('article', 'hd-codebox')
      const head = make('header', 'hd-codehead')
      const title = make('span', 'hd-codename', name)
      title.title = sig
      head.append(glyph(kindGlyph(file?.kind ?? ''), 'hd-kind'))
      // Its logical place first — the kind, where its source says it came from, the
      // package that declares it — and the signature that proves it, last.
      const where = [file?.kind, file?.source, file?.path, sig.slice(0, 8), read ? `${Math.max(1, Math.round(read.size / 1024))} KB` : '']
        .filter(Boolean).join(' · ')
      head.append(title, make('span', 'hd-codewhere', where))
      if (file) {
        const describe = button('hd-icon hd-describe', '', t('hosts.meta.describe', 'Describe {name}', { name }))
        describe.append(glyph('describeIcon'))
        describe.setAttribute('aria-pressed', String(this.#describing?.sig === sig))
        describe.addEventListener('click', () => this.#describe(file))
        head.append(describe)
      }
      const close = button('hd-icon', '', t('hosts.code.close', 'Stop reading {name}', { name }))
      close.append(glyph('closeIcon'))
      close.addEventListener('click', () => this.#pickFile(sig, 'toggle', order))
      head.append(close)
      box.append(head)
      if (file && this.#describing?.sig === sig) box.append(this.#editor(file))
      else if (file?.description) {
        const about = make('p', file.yoursDescription ? 'hd-codedesc mine' : 'hd-codedesc', file.description)
        if (file.yoursDescription) about.title = t('hosts.meta.yours', 'Described by you')
        box.append(about)
      }
      if (read === undefined) box.append(make('p', 'hd-note', t('hosts.code.reading', 'Reading…')))
      else if (read === null) box.append(make('p', 'hd-note', t('hosts.code.missing', 'Not held here, and none of your hosts answered with it.')))
      else {
        // THE DRILL'S SEARCH, on the code page, finds text in the file being read: only
        // the lines that hold it, out of the whole file, each keeping its own number.
        const seek = this.#mode === 'simple' ? this.#query.trim().toLowerCase() : ''
        const full = this.#codeFull.has(sig) || !!seek
        const { lines, more } = codeLines(read.text, full ? Number.MAX_SAFE_INTEGER : CODE_LINES)
        const pre = make('pre', seek ? 'hd-code filtered' : 'hd-code')
        pre.dataset['language'] = read.language
        this.#tokensOf(sig, read, lines).forEach((tokens, at) => {
          if (seek && !(lines[at] ?? '').toLowerCase().includes(seek)) return
          const row = make('div', 'cl')
          if (seek) row.dataset['n'] = String(at + 1)
          for (const token of tokens) {
            if (token.kind === 'plain') row.append(document.createTextNode(token.text))
            else row.append(make('span', codeClass(token.kind), token.text))
          }
          pre.append(row)
        })
        if (seek && !pre.childElementCount) box.append(make('p', 'hd-note', t('hosts.code.no-match', 'No line of this file holds “{query}”.', { query: this.#query.trim() })))
        else box.append(pre)
        if (!seek && (more > 0 || read.cut)) {
          const rest = button('hd-quiet', more > 0
            ? t('hosts.code.more', 'Show the other {count} lines', { count: more })
            : t('hosts.code.cut', 'Only the start of this file is read'))
          rest.disabled = more <= 0
          if (more > 0) rest.prepend(glyph('moreIcon'))
          rest.addEventListener('click', () => { this.#codeFull.add(sig); this.#renderBody() })
          box.append(rest)
        }
      }
      // A panel newly picked in the four panes arrives; the drill's page arrives whole.
      if (this.#mode === 'advanced') this.#arriving(`code:${sig}`, box)
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
      this.#code.set(sig, { name: codeName(text), text, size: blob.size, cut, language: codeLanguage(text) })
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

  /** The lines of a file, as tokens — read once for as many lines as are drawn. */
  #tokensOf(sig: string, read: CodeRead, lines: readonly string[]): CodeToken[][] {
    const key = `${sig}:${lines.length}`
    let rows = this.#tokens.get(key)
    if (!rows) {
      rows = tokenizeCode(lines.join('\n'), read.language)
      this.#tokens.set(key, rows)
      if (this.#tokens.size > 40) this.#tokens.delete(this.#tokens.keys().next().value as string)
    }
    return rows
  }

  // ── what a file is: its meta layer ───────────────────────────────────────

  /** A file is named by the layer that declares it and by what its participant said
   *  of it; both are read as the files come in, and the names repaint when they land. */
  #wantWords(files: readonly FileRow[]): void {
    for (const layer of new Set(files.map(file => file.layer))) {
      if (SIG_RE.test(layer) && !this.#docs.has(layer) && !this.#docsAsk.has(layer)) void this.#askDocs(layer)
    }
    for (const { sig } of files) {
      if (this.#meta.has(sig) || this.#metaAsk.has(sig)) continue
      this.#metaAsk.add(sig)
      this.#metaQueue.push(sig)
    }
    this.#pumpMeta()
  }

  /** A layer is small JSON and immutable: its `docs.bees` are read once, from what is
   *  held here or else from a host. A layer nobody has comes back empty — the files
   *  are then named by their first line, or their signature, as they always were. */
  async #askDocs(layer: string): Promise<void> {
    this.#docsAsk.add(layer)
    try {
      const store = ioc<{ getResource?(sig: string): Promise<Blob | null>; getResourceLocal?(sig: string): Promise<Blob | null> }>('@hypercomb.social/Store')
      const blob = (await store?.getResourceLocal?.(layer)) ?? (await store?.getResource?.(layer))
      this.#docs.set(layer, blob ? beeDocsOf(await blob.text()) : new Map())
      if (this.#docs.size > 300) this.#docs.delete(this.#docs.keys().next().value as string)
    } catch {
      this.#docs.set(layer, new Map())
    } finally {
      this.#docsAsk.delete(layer)
      this.#codeSoon()
    }
  }

  /** The participant's words are a document each: a few are read at a time. */
  #pumpMeta(): void {
    while (this.#metaActive < 6 && this.#metaQueue.length) {
      const sig = this.#metaQueue.shift() as string
      this.#metaActive++
      void readBeeMeta(sig)
        // A save made while the read was out is newer than it.
        .then(meta => { if (!this.#meta.has(sig)) this.#meta.set(sig, meta) })
        .catch(() => { if (!this.#meta.has(sig)) this.#meta.set(sig, {}) })
        .finally(() => {
          this.#metaActive--
          this.#metaAsk.delete(sig)
          this.#codeSoon()
          this.#pumpMeta()
        })
    }
  }

  /** Open the editor on a file, with the words the participant already gave it. */
  #describe(file: FileLabel): void {
    if (this.#describing?.sig === file.sig) { this.#describing = null; this.#renderBody(); return }
    const own = this.#meta.get(file.sig) ?? {}
    this.#describing = { sig: file.sig, name: own.name ?? '', description: own.description ?? '', busy: false, failed: false }
    this.#renderBody()
    this.#refs.get('body')?.querySelector<HTMLElement>('.hd-editor [data-field="name"]')?.focus()
  }

  /**
   * THE EDITOR: a name and a description, each over what the file says of itself —
   * the published words are the placeholders, so an empty field is visibly "as
   * published". Saving keeps every earlier version; it changes nothing but this
   * hive's words for the file. Enter saves (a description is one paragraph).
   */
  #editor(file: FileLabel): HTMLElement {
    const draft = this.#describing as Describing
    const doc = this.#docs.get(file.layer)?.get(file.sig)
    const published = beeWords({ sig: file.sig, doc, fileName: file.source })
    const form = make('form', 'hd-editor')
    form.noValidate = true

    const field = <E extends HTMLInputElement | HTMLTextAreaElement>(control: E, key: 'name' | 'description', label: string, placeholder: string, max: number): HTMLLabelElement => {
      control.className = 'hd-input'
      control.value = draft[key]
      control.placeholder = placeholder
      control.maxLength = max
      control.dataset['field'] = key
      control.disabled = draft.busy
      control.addEventListener('input', () => { draft[key] = control.value })
      const wrap = make('label', 'hd-field')
      wrap.append(make('span', 'hd-field-label', label), control)
      return wrap
    }
    const name = make('input')
    name.type = 'text'
    const about = make('textarea')
    about.rows = 3
    about.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit() }
    })
    form.append(
      field(name, 'name', t('hosts.meta.name', 'Name'), published.name, 80),
      field(about, 'description', t('hosts.meta.description', 'What it does'), published.description, 600),
      make('p', 'hd-note', t('hosts.meta.note', 'Kept in this hive, with every earlier version. The file itself, and every signature, stay as published.')),
    )
    if (draft.failed) {
      const failed = make('p', 'hd-error', t('hosts.meta.failed', 'Could not save — nothing was changed.'))
      failed.setAttribute('role', 'alert')
      form.append(failed)
    }
    const actions = make('div', 'hd-editor-actions')
    const save = button('hd-primary', t('hosts.meta.save', 'Save'))
    save.type = 'submit'
    save.disabled = draft.busy
    actions.append(save)
    const own = this.#meta.get(file.sig) ?? {}
    if (own.name || own.description) {
      const reset = button('hd-quiet', t('hosts.meta.reset', 'Use the published words'))
      reset.type = 'button'
      reset.disabled = draft.busy
      reset.addEventListener('click', () => void this.#saveWords(file.sig, {}))
      actions.append(reset)
    }
    const cancel = button('hd-quiet', t('hosts.meta.cancel', 'Cancel'))
    cancel.type = 'button'
    cancel.addEventListener('click', () => { this.#describing = null; this.#renderBody() })
    actions.append(cancel)
    form.append(actions)
    form.addEventListener('submit', event => {
      event.preventDefault()
      void this.#saveWords(file.sig, { name: draft.name, description: draft.description })
    })
    return form
  }

  /** Keep the participant's words for a file — `{}` hands the published ones back. */
  async #saveWords(sig: string, words: BeeMeta): Promise<void> {
    const draft = this.#describing
    if (draft?.sig === sig) {
      if (draft.busy) return
      draft.busy = true
      draft.failed = false
    }
    const saved = await writeBeeMeta(sig, words)
    if (!saved) {
      if (draft && this.#describing === draft) { draft.busy = false; draft.failed = true; this.#renderBody() }
      return
    }
    this.#meta.set(sig, normalizeMeta(words))
    if (this.#describing === draft) this.#describing = null
    this.#focusKey = sig
    this.#renderBody()
  }

  #renderRevisions(body: HTMLElement): void {
    const path = this.#revPath
    const head = make('div', 'hd-crumbs')
    const back = button('hd-back', '', t('hosts.revisions.back', 'Back to the list'))
    back.append(glyph('backIcon'))
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
    const back = button('hd-back', '', t('hosts.revisions.back', 'Back to the list'))
    back.append(glyph('backIcon'))
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
    for (const row of known.rows.filter(row => this.#hits(row.title, row.host, row.publisherLabel))) {
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
    const back = button('hd-back', '', t('hosts.revisions.back', 'Back to the list'))
    back.append(glyph('backIcon'))
    back.addEventListener('click', () => { this.#view = 'domains'; this.#render() })
    head.append(back, make('span', 'hd-drill-title', t('hosts.mine.open', 'In your hive ({count})', { count: this.#mine.length })))
    body.append(head)
    const list = make('ul', 'hd-list')
    for (const row of this.#mine.filter(row => this.#hits(row.name, row.host))) {
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

  /** Turn a package on or off, by path. Held bytes make this a repoint that
   *  the running hive takes at once (#live); a restart is kept for what cannot
   *  let go while it runs. A package only a host carries is picked in from that
   *  host first, through the same gate every install passes, and restarts. */
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
      } else if (await this.#live()) {
        EffectBus.emit('activity:log', { message: row.on
          ? t('packages.turned-off', '{name} is off', { name: row.path })
          : t('packages.turned-on', '{name} is on', { name: row.path }) })
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

  /** ON AND OFF WHILE THE HIVE RUNS (jwize, 2026-11-10). The activation record
   *  is already rewritten; the shell's preloader makes what runs match it —
   *  what came on loads and is pulsed, what went off is disposed. It answers
   *  false, having changed nothing, when only a restart is honest (a running
   *  bee with no `dispose()`, other namespace bundles, a shell from before
   *  it), and the caller restarts as it always did. */
  async #live(): Promise<boolean> {
    const preloader = ioc<{ recompose?: () => Promise<boolean> }>('@hypercomb.social/ScriptPreloader')
    try { return (await preloader?.recompose?.()) === true } catch { return false }
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
/* THE DESK'S LOOK. A cold, clean desk: one reading face (Source Sans 3 — the app's
   own face is one Light cut whose bold is faked) with mono kept for what is
   machine-read (signatures, counts, code); glyphs from the shipped Material
   subset; every host its own hexagon; colours by role, never named. Motion only
   where something arrives — a step in or back, a column opened, a panel picked —
   never on a repaint, and none at all under reduced motion. */
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
  --hd-raised:color-mix(in srgb, rgb(var(--acc)) 3.5%, var(--hd-ground));
  --hd-wash:rgba(var(--acc),0.07);
  --hd-wash-strong:rgba(var(--acc),0.14);
  --hd-face:'Source Sans 3',var(--hc-font,system-ui),sans-serif;
  --hd-mono:var(--hc-mono,ui-monospace,monospace);
  --hd-ease:cubic-bezier(.2,.8,.2,1);
  position:fixed;
  top:var(--hc-safe-top,0px);
  left:var(--hc-controls-left,0px)!important;
  right:max(var(--hc-inset-right,0px), var(--hc-controls-right,0px))!important;
  bottom:calc(max(var(--hc-controls-bottom,0px), var(--hc-safe-bottom,0px)) + var(--hc-mobile-row-lift,0px));
  width:auto!important;max-width:none!important;transform:none!important;
  z-index:60001;pointer-events:auto;box-sizing:border-box;
  display:flex;flex-direction:column;min-height:0;
  font-family:var(--hd-face);font-size:calc(1rem * var(--hc-panel-scale,1));line-height:1.35;
  color:var(--hd-ink);background:var(--hd-ground);outline:none;
}
${S} .hd-panel button,${S} .hd-panel input,${S} .hd-panel textarea{font-family:inherit;}
${S} .hd-panel button:focus-visible,${S} .hd-panel input:focus-visible{outline:2px solid color-mix(in srgb, rgb(var(--acc)) 72%, white);outline-offset:1px;}
/* GLYPHS: sized by the words they sit with, never by the page. */
${S} .hd-glyph{flex:none;font-size:1.2em;line-height:1;vertical-align:-.22em;}
${S} .hd-glyph.filled{font-variation-settings:'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24;}

/* THE HEAD: the desk's mark, its name, the two ways to look, Select, close. */
${S} .hd-head{flex:0 0 auto;display:flex;align-items:center;gap:.6em;padding:.6em .9em .6em 1em;border-bottom:1px solid var(--hd-rule);background:var(--hd-raised);}
${S} .hd-deskmark{display:grid;place-items:center;width:1.85em;height:2.1em;clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);background:var(--hc-window-accent);color:var(--hc-window-on-accent);}
${S} .hd-deskmark .hd-glyph{font-size:1.05em;}
${S} .hd-grow{flex:1 1 auto;}
${S} .hd-title{font-size:1.02em;font-weight:600;letter-spacing:.01em;color:var(--hd-ink);}
${S} .hd-close{display:inline-grid;place-items:center;width:2em;height:2em;padding:0;background:none;border:none;border-radius:var(--hc-radius-control,2px);color:var(--hd-ink-quiet);cursor:pointer;transition:background-color .15s,color .15s;}
${S} .hd-close:hover{color:var(--hd-ink);background:var(--hd-wash-strong);}
/* ONE SWITCH, two segments, a thumb that slides to the one in use. */
${S} .hd-modes{position:relative;display:inline-grid;grid-auto-flow:column;grid-auto-columns:1fr;padding:2px;font:inherit;color:inherit;background:var(--hd-wash);border:1px solid var(--hd-rule);border-radius:var(--hc-radius-control,2px);cursor:pointer;}
${S} .hd-modes::before{content:'';position:absolute;top:2px;bottom:2px;left:2px;width:calc(50% - 2px);background:var(--hd-ground);border-radius:var(--hc-radius-control,2px);box-shadow:0 1px 2px rgba(0,0,0,.14),0 0 0 1px var(--hd-rule);transition:translate .26s var(--hd-ease);}
${S} .hd-modes[data-mode="advanced"]::before{translate:100% 0;}
${S} .hd-seg{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;gap:.4em;padding:.32em .8em;font-size:.82em;font-weight:600;color:var(--hd-ink-quiet);white-space:nowrap;transition:color .2s;}
${S} .hd-seg.on{color:var(--hd-ink);}
${S} .hd-seg.on .hd-glyph{color:var(--hc-window-accent);}
${S} .hd-modes:hover .hd-seg:not(.on){color:var(--hd-ink);}
${S} .hd-select{display:inline-flex;align-items:center;gap:.35em;padding:.3em .65em;font-size:.82em;font-weight:600;color:var(--hd-ink-quiet);background:none;border:1px solid var(--hd-rule);border-radius:var(--hc-radius-control,2px);text-decoration:none;cursor:pointer;transition:background-color .15s,color .15s,border-color .15s;}
${S} .hd-select:hover{color:var(--hd-ink);background:var(--hd-wash);text-decoration:none;}
${S} .hd-select[aria-pressed="true"]{color:var(--hc-window-on-accent);background:var(--hc-window-accent);border-color:var(--hc-window-accent);}

/* THE FRAME: the rail, the main pane, the revisions drawer. */
${S} .hd-frame{flex:1 1 auto;min-height:0;position:relative;display:grid;grid-template-columns:var(--hd-rail-w,18rem) minmax(0,1fr);}
${S} .hd-frame.with-drawer{grid-template-columns:var(--hd-rail-w,18rem) minmax(0,1fr) minmax(18rem,26rem);}
${S} .hd-side{min-height:0;overflow-y:auto;border-right:1px solid var(--hd-rule);padding:.6em .55em .9em;background:var(--hd-raised);}
${S} .hd-main{min-width:0;min-height:0;overflow-y:auto;padding:1em 1.4em 1.8em;}
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
/* FOUR PANES — hosts (the rail), packages, files, code — fit a 1280px desk without a scroll: the columns give a little before the strip scrolls, and the code takes what is left. */
${S} .hd-colbox{flex:0 1 var(--hd-pkg-w,16rem);width:var(--hd-pkg-w,16rem);min-width:11rem;min-height:0;display:flex;flex-direction:column;border-right:1px solid var(--hd-rule);}
${S} .hd-colbox.hd-filesbox{flex-basis:var(--hd-files-w,16rem);width:var(--hd-files-w,16rem);}
/* THE PANES' EDGES: each is dragged to set the width the participant prefers, which is kept. */
${S} .hd-split{position:relative;flex:0 0 0;width:0;z-index:3;cursor:col-resize;outline:none;}
${S} .hd-split::before{content:'';position:absolute;top:0;bottom:0;left:-3px;width:6px;transition:background-color .15s;}
${S} .hd-split:hover::before,${S} .hd-split:focus-visible::before,${S} .hd-split.dragging::before{background:rgba(var(--acc),0.4);}
${S} .hd-split-rail{position:absolute;top:0;bottom:0;left:var(--hd-rail-w,18rem);}
${S} .hd-panel.simple .hd-split{display:none;}
${S} .hd-pane-empty{margin:1em .9em;}
${S} .hd-rail-head{margin-top:.7em;padding-left:.55em;border-bottom:none;}
${S} .hd-rail-head::before{content:'dns' / '';margin-right:.45em;font-family:'Material Symbols Outlined';font-feature-settings:'liga';font-size:1.45em;font-weight:400;letter-spacing:normal;text-transform:none;vertical-align:-.3em;color:var(--hc-window-accent);}
/* A package whose update has landed: dropped to the bottom of the list (the order is the view's), and dimmed. */
${S} .hd-row.completed{opacity:.62;}
${S} .hd-row.completed .hd-name::before{content:'✓ ';color:var(--hc-status-ok);}
${S} .hd-row.completed .hd-bulb{color:var(--hc-status-ok);}

/* A HOST'S HEXAGON: its letter on its own hue (the accent, turned by its name). */
${S} .hd-avatar{--hd-tint:rgb(var(--acc));position:relative;flex:none;display:inline-grid;width:2.34em;height:2.7em;}
@supports (color: oklch(from red l c h)){
${S} .hd-avatar{--hd-tint:oklch(from rgb(var(--acc)) l c calc(h + var(--hd-hue,0)));}
}
${S} .hd-hex{display:grid;place-items:center;clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);font-size:1.05em;font-weight:700;line-height:1;color:var(--hd-tint);background:color-mix(in srgb, var(--hd-tint) 17%, var(--hd-ground));transition:background-color .2s var(--hd-ease);}
${S} .hd-hex .hd-glyph{font-size:1.15em;vertical-align:0;}
${S} .hd-avatar.update::after,${S} .hd-avatar.behind::after{content:'';position:absolute;top:.05em;right:-.12em;width:.6em;height:.6em;border-radius:50%;background:var(--hc-window-accent);box-shadow:0 0 0 2px var(--hd-ground);}
${S} .hd-avatar.behind::after{background:var(--hc-status-warn);}
${S} .hd-domain .hd-avatar{width:1.56em;height:1.8em;}
${S} .hd-domain .hd-hex{font-size:.82em;}
${S} .hd-host-hero .hd-avatar{width:2.9em;height:3.35em;}
${S} .hd-host-hero .hd-hex{font-size:1.3em;}
${S} .hd-main.with-columns .hd-host-hero .hd-avatar{width:2.1em;height:2.42em;}
${S} .hd-main.with-columns .hd-host-hero .hd-hex{font-size:1em;}

/* THE SIMPLE DRILL: no rail, one large list in the middle, a step in at a time. */
${S} .hd-panel.simple .hd-side{display:none;}
${S} .hd-panel.simple .hd-frame,${S} .hd-panel.simple .hd-frame.with-drawer{grid-template-columns:minmax(0,1fr);}
${S} .hd-panel.simple .hd-main{padding:0 1.4em 2.6em;}
${S} .hd-panel.simple .hd-drawer{position:absolute;inset:0;z-index:2;border-left:none;background:var(--hd-ground);}
${S} .hd-panel.simple .hd-main > :not(.hd-simple){max-width:48rem;margin-left:auto;margin-right:auto;}
${S} .hd-simple{max-width:48rem;margin:0 auto;display:flex;flex-direction:column;gap:.9em;}
${S} .hd-simple.wide{max-width:88rem;}
${S} .hd-simple > *{max-width:none;}
/* The trail stays in sight while a long list scrolls under it. */
${S} .hd-simple-head{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:.55em .7em;min-height:2.3em;padding:.9em 0 .6em;background:linear-gradient(var(--hd-ground) 86%, transparent);}
/* THE DRILL'S SEARCH, pinned in that bar in place of the page's caption. */
${S} .hd-drill-search{position:relative;flex:1 1 18rem;min-width:12rem;display:flex;align-items:center;margin:0;}
${S} .hd-drill-search .hd-search-glyph{position:absolute;top:0;bottom:0;left:.75em;display:flex;align-items:center;font-size:1.2em;color:var(--hd-ink-quiet);pointer-events:none;transition:color .15s;}
${S} .hd-drill-search:focus-within .hd-search-glyph{color:var(--hc-window-accent);}
${S} .hd-input.hd-drill-input{height:2.6em;padding:0 .9em 0 2.4em;font-size:.98em;background:var(--hd-raised);border:1px solid var(--hd-rule);transition:border-color .15s,box-shadow .15s,background-color .15s;}
${S} .hd-input.hd-drill-input:focus{border-color:rgba(var(--acc),.6);background:var(--hd-ground);box-shadow:0 0 0 3px rgba(var(--acc),.14);}
${S} .hd-panel .hd-drill-input:focus-visible{outline:none;}
/* The field's own clear, in the desk's ink rather than the browser's blue. */
${S} .hd-input::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none;width:.9em;height:.9em;margin-left:.4em;cursor:pointer;background:var(--hd-ink-quiet);-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 6l12 12M18 6L6 18' stroke='black' stroke-width='2.6' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 6l12 12M18 6L6 18' stroke='black' stroke-width='2.6' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;}
${S} .hd-input::-webkit-search-cancel-button:hover{background:var(--hd-ink);}
${S} .hd-simple-back .hd-trail-now{flex:0 0 auto;}
${S} .hd-simple-back{margin-bottom:.5em;}
${S} .hd-back{display:inline-grid;place-items:center;flex:none;width:2.1em;height:2.1em;padding:0;color:var(--hd-ink-quiet);background:var(--hd-raised);border:1px solid var(--hd-rule);border-radius:var(--hc-radius-control,2px);cursor:pointer;transition:background-color .15s,color .15s,border-color .15s;}
${S} .hd-back:hover{color:var(--hd-ink);background:var(--hd-wash-strong);border-color:rgba(var(--acc),.4);}
${S} .hd-back .hd-glyph{font-size:1.15em;transition:translate .18s var(--hd-ease);}
${S} .hd-back:hover .hd-glyph{translate:-2px 0;}
${S} .hd-trail{display:flex;flex-wrap:wrap;align-items:center;gap:.15em .1em;min-width:0;font-size:.9em;}
${S} .hd-trail-step,${S} .hd-trail-now{display:inline-flex;align-items:center;gap:.35em;min-width:0;padding:.28em .5em;border-radius:var(--hc-radius-control,2px);}
${S} .hd-trail-step{font:inherit;color:var(--hd-ink-quiet);background:none;border:none;cursor:pointer;transition:background-color .15s,color .15s;}
${S} .hd-trail-step:hover{color:var(--hd-ink);background:var(--hd-wash-strong);}
${S} .hd-trail-sep{font-size:1.05em;color:var(--hd-ink-quiet);opacity:.5;}
${S} .hd-trail-now{color:var(--hd-ink);font-weight:600;}
${S} .hd-trail-now .hd-glyph{color:var(--hc-window-accent);}
${S} .hd-simple .hd-colbox{flex:none;width:auto;min-width:0;border:1px solid var(--hd-rule);border-radius:var(--hc-radius-card,3px);overflow:hidden;background:var(--hd-raised);}
${S} .hd-simple .hd-col{overflow:visible;padding:0;}
${S} .hd-simple .hd-colhead{display:none;}
${S} .hd-simple .hd-col .hd-row{padding:.72em 1em;column-gap:.85em;font-size:1em;}
${S} .hd-simple .hd-row .hd-name{font-size:1em;font-weight:600;}
${S} .hd-simple .hd-file{padding:.7em 1em;column-gap:.85em;}
${S} .hd-simple .hd-file-name{font-size:1em;}
${S} .hd-simple .hd-file-where{font-size:.72em;}
${S} .hd-simple .hd-kind{font-size:1.2em;}
/* The drill reads code on the page itself: the pane is as tall as the code, not a four-pane column. */
${S} .hd-simple .hd-codepane{flex:none;min-width:0;}
${S} .hd-simple .hd-matrix{overflow:visible;padding:0;}
${S} .hd-simple .hd-code{max-height:calc(100vh - 15rem);}
/* PAGE ONE: a card for every host. */
${S} .hd-simple .hd-hosts-list{display:flex;flex-direction:column;gap:.55em;}
${S} .hd-simple .hd-col .hd-host-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;column-gap:1em;padding:.85em 1.1em .85em 1em;font-size:1em;cursor:pointer;user-select:none;background:var(--hd-raised);border:1px solid var(--hd-rule);border-radius:var(--hc-radius-card,3px);transition:border-color .18s,box-shadow .18s,background-color .18s;}
${S} .hd-simple .hd-col .hd-host-row:hover{border-color:rgba(var(--acc),.45);background:color-mix(in srgb, rgb(var(--acc)) 6%, var(--hd-ground));box-shadow:0 2px 12px rgba(0,0,0,.07);}
${S} .hd-host-row:hover .hd-hex{background:color-mix(in srgb, var(--hd-tint) 26%, var(--hd-ground));}
${S} .hd-host-words{display:flex;flex-direction:column;gap:.12em;min-width:0;}
${S} .hd-host-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:1.12em;font-weight:600;color:var(--hd-ink);}
${S} .hd-host-about{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8em;color:var(--hd-ink-quiet);}
${S} .hd-simple .hd-hosts-list + .hd-add{margin-top:.6em;}
${S} .hd-row.hd-checking{grid-template-columns:auto auto minmax(0,1fr) auto auto auto auto;}
${S} .hd-file.hd-checking{grid-template-columns:auto auto minmax(0,1fr);}
${S} .hd-file.hd-checking .hd-check{grid-row:1 / span 2;align-self:center;}
${S} .hd-check{display:inline-flex;align-items:center;justify-content:center;width:1.15em;height:1.15em;font-size:.8em;line-height:1;color:var(--hc-window-on-accent);border:1.5px solid var(--hd-ink-quiet);border-radius:var(--hc-radius-control,2px);transition:background-color .15s,border-color .15s;}
${S} .hd-check.on{background:var(--hc-window-accent);border-color:var(--hc-window-accent);}
${S} .hd-about{margin:0;}

/* THE PANES' HEADS: what each is, with its glyph. */
${S} .hd-codepane{flex:1 0 24rem;min-width:24rem;min-height:0;display:flex;flex-direction:column;}
${S} .hd-colhead{flex:0 0 auto;padding:.62em .85em .5em;font-size:.68em;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--hd-ink-quiet);border-bottom:1px solid var(--hd-rule);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .hd-colhead .hd-glyph{margin-right:.45em;font-size:1.45em;letter-spacing:normal;vertical-align:-.3em;color:var(--hc-window-accent);}
${S} .hd-col{flex:1 1 auto;min-height:0;overflow-y:auto;margin:0;padding:.2em 0;list-style:none;}
${S} .hd-col > li{outline:none;}
${S} .hd-col .hd-row{padding:.36em .65em;cursor:default;user-select:none;}
${S} .hd-col .hd-row.picked,${S} .hd-file.picked{background:var(--hd-wash-strong);box-shadow:inset 2px 0 0 var(--hc-window-accent);}
${S} .hd-col .hd-row:focus-visible,${S} .hd-file:focus-visible{box-shadow:inset 0 0 0 2px color-mix(in srgb, rgb(var(--acc)) 72%, white);}
${S} .hd-opens{color:var(--hd-ink-quiet);transition:translate .18s var(--hd-ease),color .18s;}
${S} li:hover > .hd-opens,${S} .hd-publish:hover .hd-opens{translate:3px 0;color:var(--hc-window-accent);}
/* FILES: what kind of code each is, its name, and where it is from in mono. */
${S} .hd-file{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:.65em;row-gap:.08em;align-items:center;padding:.45em .8em;border-bottom:1px solid rgba(var(--acc),0.06);cursor:default;user-select:none;transition:background-color .15s;}
${S} .hd-file:hover{background:var(--hd-wash);}
${S} .hd-kind{display:grid;place-items:center;width:1.7em;height:1.7em;font-size:1.05em;vertical-align:0;color:var(--hc-window-accent);background:var(--hd-wash-strong);border-radius:var(--hc-radius-control,2px);}
${S} .hd-file > .hd-kind{grid-row:1 / span 2;}
${S} .hd-file-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.88em;font-weight:600;color:var(--hd-ink);}
${S} .hd-file-where{font-family:var(--hd-mono);font-size:.64em;color:var(--hd-ink-quiet);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
/* THE MATRIX: one panel per picked file, as many across as there is room for. */
${S} .hd-matrix{flex:1 1 auto;min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(22rem,1fr));gap:.7em;padding:.7em;align-content:start;}
${S} .hd-file.mine .hd-file-name::after{content:' ✎';font-size:.85em;color:var(--hc-window-accent);}
${S} .hd-codebox{min-width:0;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--hd-rule);border-radius:var(--hc-radius-card,3px);box-shadow:0 1px 3px rgba(0,0,0,.06);}
${S} .hd-codehead{display:flex;align-items:center;gap:.55em;padding:.45em .5em .45em .6em;border-bottom:1px solid var(--hd-rule);}
${S} .hd-codehead .hd-kind{width:1.6em;height:1.6em;font-size:.95em;}
${S} .hd-codename{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.9em;font-weight:600;color:var(--code-plain);}
${S} .hd-codewhere{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--hd-mono);font-size:.62em;color:var(--code-gutter);}
${S} .hd-codebox .hd-icon{color:var(--code-gutter);}
${S} .hd-codebox .hd-icon:hover,${S} .hd-codebox .hd-icon[aria-pressed="true"]{color:var(--hc-window-accent);}
/* THE META LAYER ON A CODE FILE: what it does, in the participant's words when they gave some. */
${S} .hd-codedesc{margin:0;padding:.5em .75em;font-size:.8em;line-height:1.5;color:var(--code-plain);border-bottom:1px solid var(--hd-rule);}
${S} .hd-codedesc.mine{box-shadow:inset 2px 0 0 var(--hc-window-accent);}
${S} .hd-editor{display:flex;flex-direction:column;gap:.45em;padding:.55em .75em .65em;font-size:.8em;border-bottom:1px solid var(--hd-rule);}
${S} .hd-field{display:flex;flex-direction:column;gap:.15em;}
${S} .hd-field-label{font-size:.9em;color:var(--code-gutter);}
${S} .hd-editor .hd-input{color:var(--code-plain);background:var(--code-bg);border-color:var(--hd-rule);resize:vertical;}
${S} .hd-editor .hd-input::placeholder{color:var(--code-comment);}
${S} .hd-panel textarea:focus-visible{outline:2px solid color-mix(in srgb, rgb(var(--acc)) 72%, white);outline-offset:1px;}
${S} .hd-editor .hd-note{margin:0;color:var(--code-gutter);}
${S} .hd-editor .hd-quiet{color:var(--code-punc);}
${S} .hd-editor-actions{display:flex;flex-wrap:wrap;align-items:center;gap:.4em;}
/* THE CODE THEME: the DCP installer's one syntax map (code-theme.ts), under the panels that show source. */
${S} .hd-code{margin:0;padding:.45em 0;overflow:auto;max-height:70vh;font-family:var(--hc-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-variant-ligatures:var(--hc-code-ligatures,none);font-size:.74em;line-height:1.6;counter-reset:l;tab-size:2;}
${S} .hd-code .cl{counter-increment:l;white-space:pre;padding-right:1em;}
${S} .hd-code .cl:hover{background:var(--code-line);}
${S} .hd-code .cl::before{content:counter(l);display:inline-block;width:3.4em;margin-right:1em;text-align:right;color:var(--code-gutter);user-select:none;}
${S} .hd-code.filtered .cl::before{content:attr(data-n);}
${codeThemeCss(S)}
${S} .hd-codebox > .hd-quiet{align-self:stretch;display:flex;align-items:center;justify-content:center;gap:.35em;padding:.55em;border-top:1px solid var(--hd-rule);border-radius:0;}
${S} .hd-stack-note{margin:.2em 0 .5em;}
${S} .hd-drawer{min-width:0;min-height:0;overflow-y:auto;border-left:1px solid var(--hd-rule);padding:.8em 1em 1.4em;background:var(--hd-raised);}

/* A HOST'S HERO: its hexagon, its name, the count beside the door to Publish. */
${S} .hd-pane-head{display:flex;align-items:center;gap:.75em;margin:0 0 .7em;}
${S} .hd-pane-title{margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:1.2em;font-weight:600;letter-spacing:-.005em;color:var(--hd-ink);}
${S} .hd-simple .hd-host-hero{margin:.2em 0 .1em;}
${S} .hd-simple .hd-host-hero .hd-pane-title,${S} .hd-panel.simple .hd-host-hero .hd-pane-title{font-size:1.55em;}
${S} .hd-main.with-columns .hd-host-hero .hd-pane-title{font-size:1.15em;}
${S} .hd-publish{display:inline-flex;align-items:center;gap:.35em;padding:.38em .45em .38em .7em;font-size:.86em;font-weight:600;color:var(--hc-window-accent);background:none;border:1px solid rgba(var(--acc),.45);border-radius:var(--hc-radius-control,2px);text-decoration:none;transition:background-color .15s,border-color .15s;}
${S} .hd-publish:hover{background:var(--hd-wash-strong);border-color:var(--hc-window-accent);text-decoration:none;}
${S} .hd-published{display:inline-flex;align-items:center;gap:.3em;font-size:.82em;color:var(--hd-ink-quiet);white-space:nowrap;}
${S} .hd-published::before{content:'public' / '';font-family:'Material Symbols Outlined';font-feature-settings:'liga';font-size:1.25em;line-height:1;}
${S} .hd-stackmark .hd-hex{color:var(--hc-window-accent);}
${S} .hd-own-entry{margin-top:.5em;border-top:1px solid var(--hd-rule);border-bottom:none;padding-top:.4em;}
${S} .hd-rail-note{list-style:none;}
/* THE RAIL: a mini hexagon for every host; the ones stacked are lit with a bar. */
${S} .hd-section{border-bottom:none;}
${S} .hd-section.open > .hd-domain{background:var(--hd-wash-strong);box-shadow:inset 2px 0 0 var(--hc-window-accent);}
${S} .hd-section.open .hd-domain-name{font-weight:600;}
${S} .hd-section-body{padding:0 0 .6em;}
/* A HOST'S ACTS: small words with their glyphs. */
${S} .hd-lines{list-style:none;margin:.1em 0 .85em;padding:0;display:flex;flex-wrap:wrap;gap:.4em;font-size:.84em;}
${S} .hd-lines .hd-chip,${S} .hd-wall .hd-chip{display:inline-flex;align-items:center;gap:.35em;padding:.3em .65em;color:var(--hd-ink-quiet);background:var(--hd-raised);border:1px solid var(--hd-rule);border-radius:var(--hc-radius-control,2px);text-decoration:none;cursor:pointer;transition:background-color .15s,color .15s,border-color .15s;}
${S} .hd-lines .hd-chip:hover,${S} .hd-wall .hd-chip:hover{color:var(--hd-ink);background:var(--hd-wash-strong);border-color:rgba(var(--acc),.4);text-decoration:none;}
${S} .hd-lines .hd-chip .hd-glyph,${S} .hd-wall .hd-chip .hd-glyph{font-size:1.15em;color:var(--hc-window-accent);}
${S} .hd-match-row{border-bottom:1px solid rgba(var(--acc),0.08);}
${S} .hd-across{margin-top:.3em;}
${S} .hd-across-title{margin:.1em 0 .5em;font-size:.68em;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--hd-ink-quiet);}
${S} .hd-across .hd-matches{background:var(--hd-raised);border:1px solid var(--hd-rule);border-radius:var(--hc-radius-card,3px);overflow:hidden;}
${S} .hd-across .hd-match-row:last-child{border-bottom:none;}
${S} .hd-across .hd-match{grid-template-columns:auto minmax(0,1fr) auto auto;column-gap:.75em;padding:.6em .9em;border-radius:0;}
${S} .hd-across .hd-avatar{width:1.56em;height:1.8em;}
${S} .hd-across .hd-hex{font-size:.82em;}
${S} .hd-across .hd-kind{width:1.56em;height:1.56em;font-size:1em;}
${S} .hd-none{margin:.6em 0;}
/* THE FIREWALL: one row a zone — its hexagon, its name, open or blocked, the act. */
${S} .hd-wall{display:flex;flex-direction:column;gap:.45em;margin-top:.7em;}
${S} .hd-wall-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;column-gap:.85em;padding:.6em .7em .6em .9em;background:var(--hd-raised);border:1px solid var(--hd-rule);border-radius:var(--hc-radius-card,3px);transition:border-color .18s;}
${S} .hd-wall-row.blocked{border-color:color-mix(in srgb,var(--hc-status-alert) 45%,transparent);}
${S} .hd-wall-row.blocked .hd-wall-state{color:var(--hc-status-alert);background:color-mix(in srgb,var(--hc-status-alert) 12%,transparent);}
${S} .hd-wall .hd-avatar{width:1.9em;height:2.2em;}
${S} .hd-wall .hd-hex{font-size:.9em;}
${S} .hd-wall-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:var(--hd-ink);}
${S} .hd-wallmark .hd-hex{color:var(--hc-window-accent);}
${S} .hd-head .hd-wall-toggle{width:2em;height:2em;font-size:1em;}
${S} .hd-wall-toggle[aria-pressed="true"]{color:var(--hc-window-on-accent);background:var(--hc-window-accent);}
${S} .hd-wall-toggle[aria-pressed="true"]:hover{color:var(--hc-window-on-accent);background:var(--hc-window-accent);}
${S} .hd-match{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;column-gap:.6em;width:100%;padding:.55em .45em;font:inherit;font-size:.9em;color:var(--hd-ink);background:none;border:none;border-radius:var(--hc-radius-control,2px);text-align:left;cursor:pointer;transition:background-color .15s;}
${S} .hd-match:hover{background:var(--hd-wash);}
${S} .hd-match-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}
${S} .hd-match-where{font-size:.82em;color:var(--hd-ink-quiet);}
${S} .hd-domain{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;column-gap:.65em;width:100%;padding:.42em .55em;border-radius:var(--hc-radius-control,2px);font:inherit;font-size:.92em;color:var(--hd-ink);background:none;border:none;text-align:left;cursor:pointer;transition:background-color .15s;}
${S} .hd-domain:hover{background:var(--hd-wash);}
${S} .hd-domain-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;}
${S} .hd-chevron{color:var(--hd-ink-quiet);}
/* ADD A HOST: one field, its glyph, its word. */
${S} .hd-add{box-sizing:border-box;display:flex;align-items:center;gap:.45em;margin:.8em 0 0;padding:.25em .3em .25em .65em;background:var(--hd-raised);border:1px dashed rgba(var(--acc),.38);border-radius:var(--hc-radius-card,3px);transition:border-color .15s,background-color .15s;}
${S} .hd-add:focus-within{border-style:solid;border-color:rgba(var(--acc),.65);background:var(--hd-ground);}
${S} .hd-add-glyph{color:var(--hc-window-accent);}
${S} .hd-add-input{flex:1 1 auto;min-width:0;padding:.4em .1em;font:inherit;font-size:.92em;color:var(--hd-ink);background:none;border:none;outline:none;}
${S} .hd-panel .hd-add-input:focus-visible{outline:none;}
${S} .hd-add-input::placeholder{color:var(--hd-ink-quiet);}
${S} .hd-add:has(.hd-add-input[aria-invalid="true"]){border-color:var(--hc-status-alert);}
${S} .hd-add-input[aria-invalid="true"]{color:var(--hc-status-alert);}
${S} .hd-add .hd-quiet{font-weight:600;color:var(--hc-window-accent);}
${S} .hd-side .hd-add{font-size:.86em;}
${S} .hd-own-label{flex:0 0 auto;font-size:.82em;color:var(--hd-ink);opacity:.75;white-space:nowrap;}
${S} .hd-quiet{display:inline-flex;align-items:center;gap:.3em;padding:.32em .6em;font:inherit;font-size:.82em;color:var(--hd-ink-quiet);background:none;border:1px solid transparent;border-radius:var(--hc-radius-control,2px);cursor:pointer;transition:background-color .15s,color .15s;}
${S} .hd-quiet:hover{color:var(--hd-ink);background:var(--hd-wash-strong);}
${S} .hd-quiet:disabled{cursor:default;opacity:.55;}
/* THE SEARCH: a field with its glyph inside it. */
${S} .hd-search{position:relative;padding:.15em .05em .55em;}
${S} .hd-search-glyph{position:absolute;top:.15em;bottom:.55em;left:.55em;display:flex;align-items:center;font-size:1.15em;color:var(--hd-ink-quiet);pointer-events:none;}
${S} .hd-search .hd-input{padding-left:2.1em;}
${S} .hd-input{width:100%;box-sizing:border-box;padding:.45em .6em;font:inherit;font-size:.9em;color:var(--hd-ink);background:var(--hd-ground);border:1px solid var(--hd-rule);border-radius:var(--hc-radius-control,2px);transition:border-color .15s;}
${S} .hd-input:focus{border-color:rgba(var(--acc),.6);}
${S} .hd-link{padding:0;font:inherit;color:var(--hd-ink-quiet);background:none;border:none;text-decoration:none;cursor:pointer;}
${S} .hd-link:hover{color:var(--hd-ink);text-decoration:underline;}
${S} .hd-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:.45em;margin:.15em 0 .6em;font-size:.86em;}
${S} .hd-crumb{padding:0;font:inherit;color:var(--hd-ink-quiet);background:none;border:none;cursor:pointer;}
${S} .hd-crumb:hover{color:var(--hd-ink);}
${S} .hd-crumb.here{color:var(--hd-ink);}
${S} .hd-sep{color:var(--hd-ink-quiet);opacity:.6;}
${S} .hd-drill-title{font-weight:600;color:var(--hd-ink);}
/* AN UPDATE IS READY: a band with its glyph, the act at its end. */
${S} .hd-updates{display:flex;align-items:center;gap:.7em;margin:.2em 0 .7em;padding:.6em .7em .6em .8em;font-size:.88em;background:rgba(var(--acc),0.08);border:1px solid rgba(var(--acc),0.3);border-left:3px solid var(--hc-window-accent);border-radius:var(--hc-radius-card,3px);}
${S} .hd-updates > span:not(.hd-glyph){flex:1 1 auto;min-width:0;}
${S} .hd-updates-glyph{font-size:1.4em;color:var(--hc-window-accent);}
${S} .hd-primary{padding:.42em .9em;font:inherit;font-size:.95em;font-weight:600;color:var(--hc-window-on-accent);background:var(--hc-window-accent);border:1px solid var(--hc-window-accent);border-radius:var(--hc-radius-control,2px);cursor:pointer;transition:filter .15s,box-shadow .15s;}
${S} .hd-primary:hover:not(:disabled){filter:brightness(1.08);box-shadow:0 2px 8px rgba(var(--acc),.3);}
${S} .hd-primary:disabled{cursor:default;opacity:.55;}
${S} .hd-error{margin:.1em 0 .4em;font-size:.82em;line-height:1.4;color:var(--hc-status-alert);}
${S} .hd-note{margin:.5em 0 0;font-size:.82em;line-height:1.5;color:var(--hd-ink-quiet);}
/* READING: a small ring that turns while the hosts answer. */
${S} .hd-reading{display:flex;align-items:center;gap:.6em;list-style:none;}
${S} .hd-reading::before{content:'';flex:none;width:.85em;height:.85em;border-radius:50%;border:2px solid var(--hd-wash-strong);border-top-color:var(--hc-window-accent);animation:hd-spin .8s linear infinite;}
${S} .hd-online{margin-top:1em;padding-top:.75em;border-top:1px solid var(--hd-rule);}
${S} .hd-online-title{margin:0 0 .3em;font-size:inherit;font-weight:600;}
${S} .hd-online-steps{margin:.4em 0;padding-left:1.2em;display:flex;flex-direction:column;gap:.5em;}
${S} .hd-online-actions{display:flex;gap:.5em;flex-wrap:wrap;}
${S} .hd-online-link{color:var(--hc-window-accent);word-break:break-all;}
${S} .hd-online-said.ok{color:var(--hc-window-accent);}
${S} .hd-list{list-style:none;margin:0;padding:0;}
/* A PACKAGE: its light in a well, its name (and, large, what it is), its marks, its menu. */
${S} .hd-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto auto auto;column-gap:.5em;align-items:center;padding:.3em .2em;border-bottom:1px solid rgba(var(--acc),0.07);transition:background-color .15s;}
${S} .hd-row:hover{background:var(--hd-wash);}
${S} .hd-row.busy{cursor:progress;}
${S} .hd-row{position:relative;}
${S} .hd-row.updating,${S} .hd-row.updated{background:rgba(var(--acc),0.05);}
${S} .hd-progress{position:absolute;left:0;right:0;bottom:0;height:2px;background:rgba(var(--acc),0.12);pointer-events:none;}
${S} .hd-progress-fill{display:block;height:100%;background:var(--hc-window-accent);transition:width .2s ease-out;}
${S} .hd-row.updated .hd-progress-fill{background:var(--hc-status-ok);}
/* A NARROW COLUMN keeps the name whole: the marks drop under it instead of eating it. */
${S} .hd-cols .hd-colbox{container-type:inline-size;}
@container (max-width: 22rem){
${S} .hd-packages .hd-row{row-gap:.18em;}
${S} .hd-packages .hd-row > *{grid-row:1 / span 2;}
${S} .hd-packages .hd-row > .hd-pkg-words{grid-row:1;grid-column:2;}
${S} .hd-packages .hd-row > .hd-marks{grid-row:2;grid-column:2;}
${S} .hd-packages .hd-row.hd-checking > .hd-pkg-words,${S} .hd-packages .hd-row.hd-checking > .hd-marks{grid-column:3;}
${S} .hd-packages .hd-row > .hd-marks:empty{display:none;}
${S} .hd-packages .hd-row > .hd-progress{grid-row:auto;}
${S} .hd-packages .hd-mark{font-size:.6em;}
}
/* THE LIGHT: lit and current, lit and dim — dimmer the older the version running, set by --hd-age — or out. */
${S} .hd-bulb{display:inline-grid;place-items:center;width:1.6em;height:1.6em;padding:0;font:inherit;font-size:1em;line-height:1;border:none;cursor:pointer;color:var(--hc-status-warn);background:color-mix(in srgb, var(--hc-status-warn) 11%, transparent);border-radius:var(--hc-radius-control,2px);transition:background-color .2s,color .2s;}
${S} .hd-bulb .hd-glyph{font-size:1.05em;vertical-align:0;}
${S} .hd-simple .hd-bulb{width:2.2em;height:2.2em;}
${S} .hd-simple .hd-bulb .hd-glyph{font-size:1.25em;}
${S} .hd-bulb.behind{opacity:var(--hd-age,.55);}
${S} .hd-bulb:disabled{cursor:default;}
${S} .hd-bulb:not(:disabled):hover,${S} .hd-bulb:focus-visible{box-shadow:inset 0 0 0 1px currentColor;opacity:1;}
${S} .hd-bulb.off,${S} .hd-row.off .hd-bulb{color:var(--hd-ink-quiet);background:none;box-shadow:inset 0 0 0 1px var(--hd-rule);}
/* THE MANAGE MENU: over the desk, beside the row it is for. */
${S} .hd-menu{position:absolute;z-index:5;min-width:14.5rem;display:flex;flex-direction:column;padding:.3em;background:var(--hd-ground);border:1px solid rgba(var(--acc),0.3);border-radius:var(--hc-radius-floating,4px);box-shadow:0 12px 32px rgba(0,0,0,0.22);}
${S} .hd-menu-item{display:flex;align-items:center;gap:.6em;padding:.5em .7em;text-align:left;font:inherit;font-size:.86em;color:var(--hd-ink);background:none;border:none;border-radius:var(--hc-radius-control,2px);cursor:pointer;transition:background-color .12s;}
${S} .hd-menu-item .hd-glyph{color:var(--hd-ink-quiet);}
${S} .hd-menu-item:hover:not(:disabled){background:var(--hd-wash-strong);}
${S} .hd-menu-item:hover:not(:disabled) .hd-glyph{color:var(--hc-window-accent);}
${S} .hd-menu-item:disabled{cursor:default;opacity:.45;}
${S} .hd-menu-item.accent,${S} .hd-menu-item.accent .hd-glyph{color:var(--hc-window-accent);}
${S} .hd-pkg-words{display:flex;flex-direction:column;gap:.1em;min-width:0;}
${S} .hd-pkg-about{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8em;color:var(--hd-ink-quiet);}
${S} .hd-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.9em;font-weight:500;color:var(--hd-ink);background:none;border:none;padding:0;font-family:inherit;text-align:left;cursor:pointer;}
${S} .hd-row.off .hd-name{color:var(--hd-ink-quiet);}
${S} .hd-marks{display:inline-flex;gap:.3em;}
${S} .hd-mark{padding:.16em .5em;font:inherit;font-size:.66em;font-weight:600;letter-spacing:.02em;white-space:nowrap;color:var(--hc-window-accent);background:rgba(var(--acc),.12);border:none;border-radius:var(--hc-radius-control,2px);}
${S} button.hd-mark{cursor:pointer;transition:background-color .15s;}
${S} button.hd-mark:hover:not(:disabled){background:rgba(var(--acc),.22);}
${S} button.hd-mark:disabled{cursor:default;opacity:.55;}
${S} .hd-mark.quiet{color:var(--hd-ink-quiet);background:color-mix(in srgb, var(--hd-ink-quiet) 11%, transparent);}
${S} .hd-count{min-width:1.2em;font-family:var(--hd-mono);font-size:.66em;text-align:center;color:var(--hd-ink-quiet);}
${S} .hd-icon{display:inline-grid;place-items:center;width:1.85em;height:1.85em;padding:0;font:inherit;font-size:.9em;line-height:1;color:var(--hd-ink-quiet);background:none;border:none;border-radius:var(--hc-radius-control,2px);cursor:pointer;transition:background-color .15s,color .15s,opacity .15s;}
${S} .hd-icon:hover{color:var(--hd-ink);background:var(--hd-wash-strong);}
${S} .hd-icon:disabled{cursor:default;opacity:.35;}
${S} .hd-icon .hd-glyph{font-size:1.25em;vertical-align:0;}
${S} .hd-manage{opacity:.6;}
${S} .hd-row:hover .hd-manage,${S} .hd-manage[aria-expanded="true"],${S} .hd-manage:focus-visible{opacity:1;}
${S} .hd-icon-slot{width:1.2em;}
${S} .hd-detail{grid-column:2 / -1;padding:.15em 0 .3em;}
${S} .hd-desc{margin:0 0 .2em;font-size:.76em;line-height:1.4;color:var(--hd-ink-quiet);}
${S} .hd-where{margin:.1em 0;font-size:.74em;line-height:1.4;color:var(--hd-ink-quiet);}
/* REVISIONS: newest first, by name, in the drawer. */
${S} .hd-rev-name{padding:.8em .2em .25em;font-size:.72em;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--hc-window-accent);list-style:none;}
${S} .hd-rev-name ~ .hd-rev{margin-left:.9em;}
${S} .hd-rev{border-bottom:1px solid rgba(var(--acc),0.08);}
${S} .hd-rev.busy{cursor:progress;}
${S} .hd-rev-choose{display:flex;align-items:center;gap:.6em;width:100%;padding:.48em .3em;font:inherit;font-size:.84em;color:var(--hd-ink);background:none;border:none;border-radius:var(--hc-radius-control,2px);text-align:left;cursor:pointer;transition:background-color .15s;}
${S} .hd-rev-choose:hover:not(:disabled){background:var(--hd-wash);}
${S} .hd-rev-choose:disabled{cursor:default;}
${S} .hd-rev-sig{font-family:var(--hd-mono);font-size:.9em;font-variant-numeric:tabular-nums;}
${S} .hd-rev-at,${S} .hd-rev-hosts{color:var(--hd-ink-quiet);}
${S} .hd-rev-hosts{margin-right:auto;}
${S} .hd-warning{margin:.2em 0 .7em;padding:.6em .7em;font-size:.86em;border:1px solid color-mix(in srgb,var(--hc-status-alert) 55%,transparent);border-left:3px solid var(--hc-status-alert);border-radius:var(--hc-radius-card,3px);}
${S} .hd-warning-title{margin:0 0 .3em;font-weight:600;color:var(--hd-ink);}
${S} .hd-warning-list{margin:0 0 .5em;padding-left:1.1em;color:var(--hd-ink-quiet);}
${S} .hd-warning-list .quiet{list-style:none;}
${S} .hd-warning-acts{display:flex;align-items:center;gap:.5em;}
${S} .hd-creation{display:grid;grid-template-columns:minmax(0,1fr) auto auto;column-gap:.5em;align-items:center;padding:.4em .2em;border-bottom:1px solid rgba(var(--acc),0.08);font-size:.88em;}
${S} .hd-creation-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--hd-ink);text-decoration:none;}
${S} a.hd-creation-name:hover{text-decoration:underline;}
${S} .hd-creation-by{font-size:.85em;color:var(--hd-ink-quiet);}

/* MOTION. The desk rises in when it opens; a page slides in from the side it was
   reached from (a step in from the right, a step back from the left) or fades
   when the view changes, its rows following a beat apart; a column opened by a
   pick, a code panel picked and the manage menu arrive the same way. Only an
   arrival moves (\`data-enter\`, \`.hd-enter\`, set by the view for ${ENTER_MS}ms), and a
   repaint during one carries it on where it was (\`--hd-since\`). */
@keyframes hd-rise{from{opacity:0;translate:0 10px;}}
@keyframes hd-from-right{from{opacity:0;translate:28px 0;}}
@keyframes hd-from-left{from{opacity:0;translate:-28px 0;}}
@keyframes hd-fade{from{opacity:0;}}
@keyframes hd-row-in{from{opacity:0;translate:0 6px;}}
@keyframes hd-col-in{from{opacity:0;translate:-14px 0;}}
@keyframes hd-pop{from{opacity:0;translate:0 -4px;scale:.98;}}
@keyframes hd-spin{to{rotate:1turn;}}
${S} .hd-panel > .hd-head{animation:hd-rise .3s var(--hd-ease) both;}
${S} .hd-panel > .hd-frame{animation:hd-rise .36s var(--hd-ease) .05s both;}
${S} .hd-main[data-enter] > :not(.hd-simple),${S} .hd-main[data-enter] > .hd-simple > :not(.hd-simple-head){animation-duration:.3s;animation-timing-function:var(--hd-ease);animation-fill-mode:both;animation-delay:calc(0ms - var(--hd-since,0ms));}
${S} .hd-main[data-enter="in"] > :not(.hd-simple),${S} .hd-main[data-enter="in"] > .hd-simple > :not(.hd-simple-head){animation-name:hd-from-right;}
${S} .hd-main[data-enter="out"] > :not(.hd-simple),${S} .hd-main[data-enter="out"] > .hd-simple > :not(.hd-simple-head){animation-name:hd-from-left;}
${S} .hd-main[data-enter="swap"] > :not(.hd-simple),${S} .hd-main[data-enter="swap"] > .hd-simple > :not(.hd-simple-head),${S} .hd-main[data-enter="open"] > :not(.hd-simple),${S} .hd-main[data-enter="open"] > .hd-simple > :not(.hd-simple-head){animation-name:hd-fade;}
${S} .hd-main[data-enter] .hd-col > li{animation:hd-row-in .3s var(--hd-ease) both;animation-delay:calc(min(var(--i,0), 12) * 16ms - var(--hd-since,0ms));}
${S} .hd-colbox.hd-enter{animation:hd-col-in .28s var(--hd-ease) both;animation-delay:calc(0ms - var(--hd-since,0ms));}
${S} .hd-codebox.hd-enter{animation:hd-row-in .3s var(--hd-ease) both;animation-delay:calc(0ms - var(--hd-since,0ms));}
${S} .hd-menu.hd-enter{animation:hd-pop .16s var(--hd-ease) both;animation-delay:calc(0ms - var(--hd-since,0ms));}
@media (prefers-reduced-motion: reduce){
${S} *,${S} *::before,${S} *::after{animation:none!important;transition:none!important;}
}

/* Three columns need room. Narrower than that the drawer lies over the list
   instead of squeezing it: the list underneath is not touched. */
@media (max-width:1100px){
${S} .hd-frame.with-drawer{grid-template-columns:minmax(13rem,18rem) minmax(0,1fr);}
${S} .hd-drawer{position:absolute;top:0;right:0;bottom:0;width:min(26rem,86%);z-index:2;box-shadow:-12px 0 24px rgba(0,0,0,0.18);}
}
@media (max-width:720px){
${S} .hd-frame,${S} .hd-frame.with-drawer{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);}
${S} .hd-split{display:none;}
${S} .hd-side{max-height:36vh;border-right:none;border-bottom:1px solid var(--hd-rule);}
${S} .hd-drawer{position:absolute;inset:0;z-index:2;border-left:none;background:var(--hd-ground);}
${S} .hd-seg-label{display:none;}
}
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
