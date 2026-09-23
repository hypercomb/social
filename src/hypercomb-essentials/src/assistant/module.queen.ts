// assistant/module.queen.ts
//
// THE SOURCE LIVES IN THE HIVE — the participant's side of it. A model writes
// a module section back through the write fence (hive-read-fence.md, "Writing
// a module") and the hive runs it here as a DRAFT: a pick over the installed
// package, this browser's alone. These are the words that see, drop, try in
// public, and promote what the hive runs:
//
//   module                 the drafts picked right now, and the paths turned
//                          off — what a commit would publish
//   module drop <path>     the trunk's layer runs at <path> again (reload)
//   module commit [<change>] [@<host>]
//                          WHAT RUNS HERE becomes a package: every draft at its
//                          path, every path turned off left out of the new root
//                          (unreachable, never deleted). It is uploaded whole to
//                          the host (the public one, or @<host>), read back, and
//                          stamped as the SANDBOX channel install:try-<change> —
//                          never the live one. Its door is try-<change>.<zone>:
//                          a full hive anyone can open, run, read and draft on
//                          (documentation/module-sandbox.md).
//   module promote <change> [<channel>] [@<host>]
//                          the live channel (default `essentials`) moves to the
//                          sandbox's root — the same signature, no rebuild, no
//                          upload. Followers are told on their next boot.
//   module withdraw <change> [@<host>]
//                          the sandbox pointer is removed: its door answers
//                          "nothing here", and every file stays on the host.
//   module focus [@<host>]
//                          Jev weighs every open trial on the zone — the
//                          readings, people's assessments, who took what,
//                          which trials change one file — and says where
//                          each stands (take · discuss · wait) and where to
//                          focus first. The pass is public under your key.
//   module review <change> [@<host>]
//                          the host's AI reads the change again, and so does
//                          Jev — its diff, rule by rule, against the doctrine
//                          (both read it once on every commit): module-review.ts.
//   module assess <change> [accept|refuse|unclear <note…>] [@<host>]
//                          anyone's own signed reading of a sandbox: without a
//                          verdict it says how the host's AI and people read
//                          it; with one it signs yours, under YOUR key, into
//                          your own index as assess:<package root>.
//   module trials [@<host>]
//                          every trial open on the zone, newest first: whose,
//                          when, what it changes, how the host's AI read it,
//                          and its door — so anyone can walk them one at a
//                          time. It reads; it publishes nothing.
//   module changes <change> [@<host>]
//                          opens the trial's change file by file, before and
//                          after, with the host AI's reading and people's
//                          signed notes, and steps through the zone's other
//                          trials (sandbox-change.view.ts). It reads.
//   module take <change> [<path>] [@<host>]
//                          YOUR OWN BUILD: the trial's layer at each path its
//                          change touched (or the one named) becomes a pick
//                          here, made by hand — so the code it brings waits in
//                          the brood until you accept it there, and runs after
//                          a reload. `module drop <path>` gives the path back.
//                          Only the participant says it: a model never brings
//                          somebody else's code into a hive.
//
// Every commit also publishes THE CHANGE — each drafted source file before and
// after — as change:try-<change>, and the host's AI's reading of it as
// review:try-<change>. Both are public beside the sandbox: its door names them.
//
// All five publishing words are the participant's alone: a model proposing
// them is refused, whatever the Execution policy.

import { QueenBee, EffectBus, I18N_IOC_KEY, INSTALL_IOC_KEY, MODULE_DRAFTS_IOC_KEY, type I18nProvider, type ModuleDraftsProvider } from '@hypercomb/core'
import { clearHiveRoot, ownHiveRoot, setHiveRoot } from '../sharing/hive-pointer.js'
import { JEV_IOC_KEY, jevDoctrineSections, type JevReadingInput, type JevReadingResult, type JevPassInput, type JevPassResult } from './jev-decision.js'
import { assessSandbox, changedPaths, doorReader, isSandboxSite, jevReadTrial, publishChange, readChange, reviewChange, takeDepsFrom, takeTrial, tallyAssessments, trialsOf, VERDICTS, type ModuleChangeRecord, type ReviewDeps, type ReviewVerdict, type SandboxSite, type SandboxTrial, jevPassZone } from './module-review.js'
import { INSTALL_CHANNEL_PREFIX, PUBLIC_CONTENT_HOSTS } from '../sharing/hive-link.js'

/** The host backup service's participant-triggered upload (sharing/host-sync.service.ts). */
type HostSyncLike = {
  publishAtoms?(host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>):
    Promise<{ ok: true; sent: number; held: number } | { ok: false; error: string }>
}

const LIVE_CHANNEL = 'essentials'
/** Where sandbox doors open when publishing to the public host (decided 2026-09-22). */
export const SANDBOX_ZONE = 'hypercomb.com'
export const SANDBOX_PREFIX = 'try-'
const CHANNEL_RE = /^[a-z][a-z0-9-]*$/
const PATH_RE = /^[a-z0-9][a-z0-9._-]{0,63}(?:\/[a-z0-9][a-z0-9._-]{0,63})*$/i
const PUBLISHING = new Set(['commit', 'promote', 'withdraw', 'review', 'assess', 'focus'])
/** How many trials `module trials` says one by one; the rest are counted. */
const TRIALS_TOLD = 6
const STORE_KEY = '@hypercomb.social/Store'
const HOST_AI_KEY = '@diamondcoreprocessor.com/HostAi'
const ANATOMY_KEY = '@hypercomb.social/Anatomy'

type StoreLike = {
  putResource?(blob: Blob, options?: { emit?: boolean }): Promise<string>
  getResource?(sig: string): Promise<Blob | null>
}
type HostAiLike = {
  askWhole?(host: string, question: string, context: readonly string[]): Promise<{ ok: true; text: string; model: string } | { ok: false; error: string }>
}
type JevLike = { enabled?(): boolean; readyForHive?(): boolean; reading?(input: JevReadingInput): Promise<JevReadingResult>; pass?(input: JevPassInput): Promise<JevPassResult> }
/** The install provider, as far as these words need it (core InstallProvider). */
type InstallLike = Parameters<typeof takeDepsFrom>[0] & {
  selection?(): Promise<{ picks: Record<string, { root: string; byHand?: boolean }> }>
}
type Say = (key: string, fallback: string, params?: Record<string, string | number>) => string
type Toast = (message: string, type?: string) => void

/** What the review reads and writes, from this hive's store and the host.
 *  The host's AI is looked up only when a review asks it: its bee may load
 *  after this word's, and an assessment or a published change never needs it. */
const reviewDeps = (drafts: ModuleDraftsProvider, sync: HostSyncLike): ReviewDeps | null => {
  const store = window.ioc?.get?.(STORE_KEY) as StoreLike | undefined
  const putResource = store?.putResource?.bind(store)
  const getResource = store?.getResource?.bind(store)
  const publishAtoms = sync.publishAtoms?.bind(sync)
  if (!putResource || !getResource || !publishAtoms) return null
  const bytesOf = async (sig: string): Promise<Uint8Array | null> => {
    const held = await drafts.bytesOf(sig).catch(() => null)
    if (held) return held
    const blob = await getResource(sig).catch(() => null)
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  }
  return {
    put: (text, type) => putResource(new Blob([text], { type }), { emit: false }),
    get: async sig => (await getResource(sig).catch(() => null))?.text() ?? null,
    bytesOf,
    publish: async (host, sigs) => {
      const done = await publishAtoms(host, sigs, bytesOf)
      return done.ok ? { ok: true } : { ok: false, error: done.error }
    },
    ask: async (host, question, context) => {
      const ai = window.ioc?.get?.(HOST_AI_KEY) as HostAiLike | undefined
      return ai?.askWhole ? ai.askWhole(host, question, context) : { ok: false, error: 'the host AI service is not loaded yet' }
    },
    stamp: (host, key, sig) => setHiveRoot(host, key, sig),
    now: Date.now,
  }
}

/** Ask Jev to read the change's diffs against the doctrine, publish its
 *  reading, and say where the change stands. Quiet when Jev is off. */
const jevRead = async (host: string, changeSig: string, record: ModuleChangeRecord, deps: ReviewDeps, t: Say, toast: Toast): Promise<void> => {
  const jev = window.ioc?.get?.(JEV_IOC_KEY) as JevLike | undefined
  if (!jev?.reading || !jev.enabled?.()) return
  const doctrine = jevDoctrineSections((window.ioc?.get?.(ANATOMY_KEY) as { text?: string } | undefined)?.text ?? '')
  const read = await jevReadTrial(host, changeSig, record, doctrine, input => jev.reading!(input), deps)
  if (!read.ok) { toast(t('module.nojev', 'Jev did not read {name}: {reason}.', { name: record.sandbox, reason: read.error }), 'warning'); return }
  const worst = read.record.files.reduce((top, file) => file.worst.breaks > top.breaks ? file.worst : top, read.record.files[0]!.worst)
  const standing = read.record.verdict === 'follows'
    ? t('module.jevfollows', 'it follows every rule')
    : t(read.record.verdict === 'breaks' ? 'module.jevbreaks' : 'module.jevunsure', read.record.verdict === 'breaks' ? 'it breaks "{rule}"' : 'it may break "{rule}"', { rule: worst.rule })
  toast(t('module.jevread', 'Jev read {name}: {standing}. Its reading is public beside it.', { name: record.sandbox, standing }), read.record.verdict === 'breaks' ? 'warning' : 'success')
  EffectBus.emit('module:jevread', { name: record.sandbox, host, verdict: read.record.verdict, reading: read.sig, change: changeSig })
}

/** Ask the host's AI, publish its reading, and say the verdict. */
/** THE TRANSFER PACK beside a sandbox (hypercomb-runtime transfer-pack.ts):
 *  every file of the package in one content-addressed file, minted in memory
 *  and never written into the hive, sent like any other file and named in
 *  this hive's signed index as `pack:<sandbox>`. The door answers it to a
 *  cold visitor, who installs in a handful of requests instead of hundreds.
 *  A HINT: a pack that cannot be minted, sent or stamped costs a warning,
 *  never the commit or the install stamp. */
const publishPack = async (host: string, name: string, files: readonly string[], drafts: ModuleDraftsProvider, sync: HostSyncLike, t: Say, toast: Toast): Promise<void> => {
  const noPack = (reason: string): void =>
    toast(t('module.nopack', 'No transfer pack for {name}: {reason}. Its door installs file by file.', { name, reason }), 'warning')
  try {
    if (!drafts.pack || !sync.publishAtoms) return
    const pack = await drafts.pack(files)
    if (!pack) { noPack('a file of the package is not held here'); return }
    const sent = await sync.publishAtoms(host, [pack.sig], async sig => (sig === pack.sig ? pack.bytes : null))
    if (!sent.ok) { noPack(sent.error); return }
    const stamped = await setHiveRoot(host, `pack:${name}`, pack.sig)
    if (!stamped.ok) noPack(stamped.reason ?? 'the index refused it')
  } catch (error) {
    noPack(error instanceof Error ? error.message : 'it could not be sent')
  }
}

const review = async (host: string, changeSig: string, record: ModuleChangeRecord, deps: ReviewDeps, t: Say, toast: Toast): Promise<void> => {
  toast(t('module.reviewing', "Asking {host}'s AI to review {name}…", { host, name: record.sandbox }))
  const read = await reviewChange(host, changeSig, record, deps)
  if (!read.ok) { toast(t('module.noreview', 'The review cannot run here: {reason}.', { reason: read.error }), 'warning'); return }
  toast(t('module.reviewed', "{host}'s AI read {name}: {verdict}. The review is public beside it.", { host, name: record.sandbox, verdict: read.verdict }), read.verdict === 'accept' ? 'success' : 'warning')
  EffectBus.emit('module:reviewed', { name: record.sandbox, host, verdict: read.verdict, review: read.sig, change: changeSig, model: read.model })
}

/** What a sandbox's door says about itself — read from the door itself when
 *  this hive IS that door, and across origins otherwise (the host answers
 *  /site.json with CORS). Null when no sandbox answers. */
const sandboxSite = async (name: string, host: string): Promise<SandboxSite | null> => {
  const here = location.hostname.toLowerCase().startsWith(`${name}.`)
  try {
    const res = await fetch(here ? '/site.json' : `${sandboxDoorUrl(name, host)}/site.json`, { cache: 'no-store' })
    const site = res.ok ? await res.json() as unknown : null
    return isSandboxSite(site) ? site : null
  } catch { return null }
}

/** A change's sandbox name: `try-<change>`, one DNS label. */
export const sandboxName = (change: string): string => {
  const bare = String(change ?? '').toLowerCase().replace(/^try-/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
  return bare ? `${SANDBOX_PREFIX}${bare}` : ''
}

/** The zone sandboxes open on for a host: the sandbox zone for the public
 *  host, the host's own zone otherwise. Its /trials.json lists them. */
export const sandboxZoneUrl = (host: string): string => {
  const bare = host.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const publicHost = PUBLIC_CONTENT_HOSTS.includes(bare) || !bare
  const zone = publicHost ? SANDBOX_ZONE : bare.replace(/^content\./, '')
  const loopback = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3})(:\d{1,5})?$/i.test(zone)
  return `${loopback ? 'http' : 'https'}://${zone}`
}

/** Where a sandbox is opened: its door on the sandbox zone, or on the host it was published to. */
export const sandboxDoorUrl = (name: string, host: string): string => sandboxZoneUrl(host).replace('://', `://${name}.`)

/** The trials a zone lists, or why it lists none. */
const zoneTrials = async (zone: string): Promise<{ ok: true; trials: SandboxTrial[] } | { ok: false; reason: string }> => {
  try {
    const res = await fetch(`${zone}/trials.json`, { cache: 'no-store' })
    if (!res.ok) return { ok: false, reason: `it answered ${res.status}` }
    return { ok: true, trials: trialsOf(await res.json()) }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'it did not answer' }
  }
}

export class ModuleQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'module'
  override description = 'See, drop, try in public, or promote what runs here'
  override descriptionKey = 'slash.module'
  override options = ['list', 'drop <path>', 'commit [<change>] [@<host>]', 'promote <change> [<channel>]', 'withdraw <change>', 'review <change>', 'assess <change> [accept|refuse|unclear <note>]', 'trials [@<host>]', 'changes <change>', 'take <change> [<path>]', 'focus [@<host>]']
  override examples = [
    { input: '/module', result: 'Lists the drafts picked over the installed package' },
    { input: '/module commit fresh-rooms', result: 'Publishes what runs here to try-fresh-rooms.hypercomb.com, not to followers' },
    { input: '/module promote fresh-rooms', result: 'The live channel moves to the sandbox — followers are told' },
  ]
  override machine = {
    forms: 'list | drop <path>',
    example: '/module list',
    bare: true,
    reach: 'editing' as const,
    scope: 'network' as const,
    refuse: (args: string): string | undefined => {
      const [word = 'list'] = args.trim().split(/\s+/)
      if (PUBLISHING.has(word)) return `/module ${word} publishes; only the participant says it`
      if (word === 'take') return '/module take brings somebody else\'s code into this hive; only the participant says it'
      return ['list', 'drop'].includes(word) ? undefined : '/module takes list or drop <path>'
    },
  }

  override slashComplete(args: string): readonly string[] {
    const typed = args.trim().toLowerCase()
    return ['list', 'drop ', 'commit ', 'promote ', 'withdraw ', 'review ', 'assess ', 'trials', 'changes ', 'take ', 'focus'].filter(word => word.startsWith(typed) && word.trim() !== typed)
  }

  protected async execute(args: string): Promise<void> {
    const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
    const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
      const value = i18n?.t?.(key, params)
      return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
    }
    const toast = (message: string, type = 'info'): void => { EffectBus.emit('toast:show', { type, message }) }
    const drafts = window.ioc?.get?.(MODULE_DRAFTS_IOC_KEY) as ModuleDraftsProvider | undefined
    if (!drafts) { toast(t('module.unavailable', 'Module drafts are not available here: nothing is installed to draft onto.'), 'warning'); return }

    const [word = 'list', ...rest] = args.trim().split(/\s+/).filter(Boolean)
    if (word === 'list') {
      const held = await drafts.list()
      const off = drafts.offPaths()
      const install = window.ioc?.get?.(INSTALL_IOC_KEY) as InstallLike | undefined
      const picks = (await install?.selection?.().catch(() => null))?.picks ?? {}
      const taken = Object.entries(picks).filter(([, pick]) => pick.byHand === true)
      if (!held.length && !off.length && !taken.length) { toast(t('module.none', 'No drafts are picked here, and nothing is turned off.')); return }
      for (const draft of held) toast(t('module.draft', '{path}: {section} (from {from})', { path: draft.path, section: draft.section, from: draft.from.slice(0, 12) + '…' }))
      for (const [path, pick] of taken) toast(t('module.taken', '{path}: taken by hand from {root}', { path, root: pick.root.slice(0, 12) + '…' }))
      if (off.length) toast(t('module.off', 'Turned off, left out of the next commit: {paths}', { paths: off.join(', ') }))
      return
    }
    if (word === 'drop') {
      const path = rest[0] ?? ''
      if (!PATH_RE.test(path)) { toast(t('module.path', 'Say which draft by its package path, like games/solomon.'), 'warning'); return }
      const outcome = await drafts.drop(path)
      if (!outcome.ok) { toast(outcome.error, 'error'); return }
      toast(t('module.dropped', 'Dropped the draft at {path} — reload to run the package as it was.', { path }), 'success')
      return
    }
    if (!PUBLISHING.has(word) && !['trials', 'changes', 'take'].includes(word)) { toast(t('module.usage', '/module takes list, drop <path>, commit [<change>], promote <change>, withdraw <change>, review <change>, assess <change>, trials, changes <change>, take <change> [<path>] or focus.'), 'warning'); return }

    // [@<host>] publishes to a host of your own (a machine running
    // hypercomb-serve, a relay) instead of the public one; the other words are
    // the change's name and, for promote, the live channel.
    const host = rest.find(part => part.startsWith('@'))?.slice(1) || (PUBLIC_CONTENT_HOSTS[0] ?? '')
    const words = rest.filter(part => !part.startsWith('@'))
    if (!host) { toast(t('module.nohost', 'No host is configured to publish to.'), 'warning'); return }

    if (word === 'promote') {
      const name = sandboxName(words[0] ?? '')
      const live = CHANNEL_RE.test(words[1] ?? '') ? words[1]! : LIVE_CHANNEL
      if (!name) { toast(t('module.which', 'Say which sandbox, like: module promote fresh-rooms.'), 'warning'); return }
      if (live.startsWith(SANDBOX_PREFIX)) { toast(t('module.notlive', '{channel} is a sandbox, not a live channel.', { channel: live }), 'warning'); return }
      const root = await ownHiveRoot(host, `${INSTALL_CHANNEL_PREFIX}${name}`).catch(() => null)
      if (!root) { toast(t('module.nosandbox', 'You have no sandbox {name} on {host}.', { name, host }), 'warning'); return }
      const stamped = await setHiveRoot(host, `${INSTALL_CHANNEL_PREFIX}${live}`, root).catch(error => ({ ok: false, reason: error instanceof Error ? error.message : 'refused' }))
      if (!stamped.ok) { toast(t('module.unstamped', 'The install channel was not stamped: {reason}', { reason: stamped.reason ?? 'refused' }), 'warning'); return }
      toast(t('module.promoted', 'Promoted {name}: {channel} now names {root}. Followers are told on their next boot.', { name, channel: `${INSTALL_CHANNEL_PREFIX}${live}`, root: root.slice(0, 12) + '…' }), 'success')
      return
    }

    if (word === 'take') {
      const name = sandboxName(words[0] ?? '')
      if (!name) { toast(t('module.which', 'Say which sandbox, like: module take fresh-rooms.'), 'warning'); return }
      const install = window.ioc?.get?.(INSTALL_IOC_KEY) as InstallLike | undefined
      if (!install?.pick || !install.revisionsOf) { toast(t('module.unavailable', 'Module drafts are not available here: nothing is installed to draft onto.'), 'warning'); return }
      const site = await sandboxSite(name, host)
      if (!site) { toast(t('module.nosite', 'No sandbox {name} answers at {door}.', { name, door: sandboxDoorUrl(name, host) }), 'warning'); return }
      const door = location.hostname.toLowerCase().startsWith(`${name}.`) ? location.origin : sandboxDoorUrl(name, host)
      const named = PATH_RE.test(words[1] ?? '') ? [words[1]!] : null
      const paths = named ?? (site.change ? changedPaths(await readChange(site.change, { get: doorReader(door) })) : [])
      if (!paths.length) { toast(t('module.takewhat', 'Say which path to take from {name}, like: module take {change} preferences.', { name, change: name.replace(/^try-/, '') }), 'warning'); return }
      const outcome = await takeTrial(site.package, paths, [new URL(door).host], takeDepsFrom(install))
      for (const refused of outcome.refused) toast(t('module.nottaken', '{path} was not taken: {reason}', { path: refused.path, reason: refused.error }), 'warning')
      if (!outcome.taken.length) return
      const took = { paths: outcome.taken.join(', '), name, held: outcome.held }
      if (outcome.held) {
        toast(t('module.tookheld', 'Took {paths} from {name}. Its new code is held ({held}) and does not run until you accept it: brood list shows it, brood accept 1 lets it run, then reload.', took), 'success')
        EffectBus.emit('brood:open', { at: Date.now() })
      } else {
        toast(t('module.took', 'Took {paths} from {name} — reload to run it.', took), 'success')
      }
      EffectBus.emit('module:taken', { name, root: site.package, paths: outcome.taken, held: outcome.held })
      return
    }

    if (word === 'changes') {
      const name = sandboxName(words[0] ?? '')
      if (!name) { toast(t('module.which', 'Say which sandbox, like: module changes fresh-rooms.'), 'warning'); return }
      const site = await sandboxSite(name, host)
      if (!site) { toast(t('module.nosite', 'No sandbox {name} answers at {door}.', { name, door: sandboxDoorUrl(name, host) }), 'warning'); return }
      const door = location.hostname.toLowerCase().startsWith(`${name}.`) ? location.origin : sandboxDoorUrl(name, host)
      // The what-changed panel (sandbox-change.view.ts) opens on this; `at` guards the replay.
      EffectBus.emit('module:changes', { name, door, site, at: Date.now() })
      return
    }

    if (word === 'focus') {
      const zone = sandboxZoneUrl(host)
      const listed = await zoneTrials(zone)
      if (!listed.ok) { toast(t('module.notrials', '{zone} did not list its trials: {reason}.', { zone, reason: listed.reason }), 'warning'); return }
      if (!listed.trials.length) { toast(t('module.notrial', 'No trials are open on {zone}.', { zone })); return }
      const jev = window.ioc?.get?.(JEV_IOC_KEY) as JevLike | undefined
      if (!jev?.pass || !jev.readyForHive?.()) { toast(t('module.unweighed', 'Jev did not weigh {zone}: {reason}.', { zone, reason: 'Jev is off, or OpenRouter may not read this hive' }), 'warning'); return }
      const sync = window.ioc?.get?.('@diamondcoreprocessor.com/HostSyncService') as HostSyncLike | undefined
      const deps = sync ? reviewDeps(drafts, sync) : null
      if (!deps) { toast(t('module.unweighed', 'Jev did not weigh {zone}: {reason}.', { zone, reason: 'the store is not loaded' }), 'warning'); return }
      toast(t('module.weighing', 'Asking Jev to weigh the {count} open trials on {zone}…', { count: listed.trials.length, zone }))
      const passed = await jevPassZone(host, new URL(zone).host, listed.trials, input => jev.pass!(input), { ...deps, site: trial => sandboxSite(trial.name, host), reader: doorReader })
      if (!passed.ok) { toast(t('module.unweighed', 'Jev did not weigh {zone}: {reason}.', { zone, reason: passed.error }), 'warning'); return }
      const { record } = passed
      // Each trial's standing first, the sum last.
      for (const trial of record.trials.slice(0, TRIALS_TOLD)) {
        const why = trial.standing === 'take' ? t('module.standtake', 'within the rules, and nobody refused it')
          : trial.standing === 'discuss' ? t('module.standdiscuss', 'somebody refused it — read their note')
          : t('module.standwait', 'not read yet, or unsure')
        const more = [
          trial.takenBy.length ? t('module.takenby', 'taken into {names}', { names: trial.takenBy.join(', ') }) : '',
          trial.clashes.length ? t('module.clashes', 'changes a file {names} also changes — only one can be folded, or a merge drafted', { names: trial.clashes.join(', ') }) : '',
        ].filter(Boolean)
        toast(t('module.standing', '{name}: {standing} — {why}{more}', { name: trial.name, standing: trial.standing, why, more: more.length ? '; ' + more.join('; ') : '' }))
      }
      const count = (standing: string): number => record.trials.filter(trial => trial.standing === standing).length
      toast(t('module.weighed', 'Jev weighed {count} trials on {zone}: {take} to take, {discuss} to discuss, {wait} waiting. {focus} The pass is public under your key.', {
        count: record.trials.length, zone, take: count('take'), discuss: count('discuss'), wait: count('wait'),
        focus: record.focus ? t('module.focuson', 'Focus first on {name}.', { name: record.focus }) : t('module.nofocus', 'No trial stands out yet.'),
      }), 'success')
      EffectBus.emit('module:focus', { zone, host, pass: passed.sig, record })
      return
    }

    if (word === 'trials') {
      const zone = sandboxZoneUrl(host)
      const listed = await zoneTrials(zone)
      if (!listed.ok) { toast(t('module.notrials', '{zone} did not list its trials: {reason}.', { zone, reason: listed.reason }), 'warning'); return }
      EffectBus.emit('module:trials', { zone, trials: listed.trials })
      if (!listed.trials.length) { toast(t('module.notrial', 'No trials are open on {zone}.', { zone })); return }
      for (const trial of listed.trials.slice(0, TRIALS_TOLD)) {
        const what = [
          trial.sections.join(', '),
          trial.off.length ? t('module.turnsoff', 'turns off {paths}', { paths: trial.off.join(', ') }) : '',
        ].filter(Boolean).join('; ') || t('module.samecode', 'no source changes')
        toast(t('module.trial', "{name} by {publisher}, {when}: {what}. The host's AI says {review}. {door}", {
          name: trial.name, publisher: trial.publisher || trial.pubkey.slice(0, 12) + '…',
          when: trial.at ? new Date(trial.at).toLocaleString() : t('module.undated', 'undated'),
          what, review: trial.reviewVerdict ?? t('module.unreviewed', 'nothing yet'), door: trial.door,
        }))
      }
      if (listed.trials.length > TRIALS_TOLD) toast(t('module.moretrials', '…and {count} more on {zone}.', { count: listed.trials.length - TRIALS_TOLD, zone }))
      return
    }

    if (word === 'assess') {
      const name = sandboxName(words[0] ?? '')
      if (!name) { toast(t('module.which', 'Say which sandbox, like: module assess fresh-rooms accept reads well.'), 'warning'); return }
      const site = await sandboxSite(name, host)
      if (!site) { toast(t('module.nosite', 'No sandbox {name} answers at {door}.', { name, door: sandboxDoorUrl(name, host) }), 'warning'); return }
      const verdict = (VERDICTS as readonly string[]).includes(words[1] ?? '') ? words[1] as ReviewVerdict : null
      if (!verdict) {
        const tally = tallyAssessments(site)
        toast(t('module.assessments', "{name}: the host's AI says {review}; people say {accept} accept, {refuse} refuse, {unclear} unclear.", {
          name, review: site.reviewVerdict ?? t('module.unreviewed', 'nothing yet'), accept: tally.accept, refuse: tally.refuse, unclear: tally.unclear,
        }))
        return
      }
      const sync = window.ioc?.get?.('@diamondcoreprocessor.com/HostSyncService') as HostSyncLike | undefined
      const deps = sync ? reviewDeps(drafts, sync) : null
      if (!deps) { toast(t('module.noreview', 'The review cannot run here: {reason}.', { reason: 'the store is not loaded' }), 'warning'); return }
      const signed = await assessSandbox(host, site, verdict, words.slice(2).join(' '), deps)
      if (!signed.ok) { toast(t('module.unassessed', 'Your assessment was not published: {reason}', { reason: signed.error }), 'warning'); return }
      toast(t('module.assessed', 'Your assessment of {name} ({verdict}) is signed with your key and public beside it.', { name, verdict }), 'success')
      EffectBus.emit('module:assessed', { name, host, verdict, record: signed.sig, root: site.package })
      return
    }

    if (word === 'review') {
      const name = sandboxName(words[0] ?? '')
      if (!name) { toast(t('module.which', 'Say which sandbox, like: module review fresh-rooms.'), 'warning'); return }
      const sync = window.ioc?.get?.('@diamondcoreprocessor.com/HostSyncService') as HostSyncLike | undefined
      const deps = sync ? reviewDeps(drafts, sync) : null
      if (!deps) { toast(t('module.noreview', 'The review cannot run here: {reason}.', { reason: 'the host AI or the store is not loaded' }), 'warning'); return }
      const changeSig = await ownHiveRoot(host, `change:${name}`).catch(() => null)
      const record = changeSig ? await readChange(changeSig, deps) : null
      if (!changeSig || !record) { toast(t('module.nochange', 'There is no published change for {name} on {host}.', { name, host }), 'warning'); return }
      await review(host, changeSig, record, deps, t, toast)
      await jevRead(host, changeSig, record, deps, t, toast)
      return
    }

    if (word === 'withdraw') {
      const name = sandboxName(words[0] ?? '')
      if (!name) { toast(t('module.which', 'Say which sandbox, like: module withdraw fresh-rooms.'), 'warning'); return }
      const cleared = await clearHiveRoot(host, `${INSTALL_CHANNEL_PREFIX}${name}`).catch(error => ({ ok: false, reason: error instanceof Error ? error.message : 'refused' }))
      if (!cleared.ok) { toast(t('module.unstamped', 'The install channel was not stamped: {reason}', { reason: cleared.reason ?? 'refused' }), 'warning'); return }
      toast(t('module.withdrawn', 'Withdrew {name}: its door is closed, and its files stay on the host.', { name }), 'success')
      return
    }

    // COMMIT → A SANDBOX. The change is named by the word given, or by the
    // path of the first draft.
    const held = await drafts.list()
    const name = sandboxName(words[0] ?? held[0]?.path.split('/').pop() ?? 'change')
    const committed = await drafts.commit(name)
    if (!committed.ok) { toast(committed.error, 'error'); return }
    // Folded picks, and those held back (core ModuleCommitOutcome `taken` / `held`).
    const { taken = [], held: heldBack = [] } = committed as { taken?: readonly { path: string; root: string }[]; held?: readonly string[] }
    const what = [...committed.drafts, ...taken.map(pick => `${pick.path} (taken)`), ...committed.off.map(path => `-${path}`)].join(', ')
    toast(t('module.committed', 'Committed {what}: package {root} is entry {index} of this host, and runs here on reload.', { what, root: committed.rootSig.slice(0, 12) + '…', index: committed.index }), 'success')
    // A BUILD FOR EVERYBODY carries only code this hive accepted: what still
    // waits in the brood stayed a pick, and is named so it is not forgotten.
    if (heldBack.length) toast(t('module.heldback', 'Not folded in: {paths} still waits in the brood — accept it there, then commit again.', { paths: heldBack.join(', ') }), 'warning')

    // THE FILES FIRST, ALL OF THEM. The door installs the package from the
    // host alone, so the host must hold every file of it, not only the new
    // ones; what it already holds is skipped. A failure leaves every pointer
    // where it was.
    const sync = window.ioc?.get?.('@diamondcoreprocessor.com/HostSyncService') as HostSyncLike | undefined
    if (!sync?.publishAtoms) { toast(t('module.unpublished', 'Committed here, but not published: {reason}. The install channel was not moved.', { reason: 'the host service is not loaded' }), 'warning'); return }
    const published = await sync.publishAtoms(host, committed.files, drafts.bytesOf)
    if (!published.ok) { toast(t('module.unpublished', 'Committed here, but not published: {reason}. The install channel was not moved.', { reason: published.error }), 'warning'); return }
    toast(t('module.published', 'Published {sent} new files to {host} ({held} were already there).', { sent: published.sent, held: published.held, host }), 'success')

    // THE SANDBOX STAMP: install:try-<change> → the new root, signed by this
    // browser. The live channel does not move; `module promote` moves it.
    try {
      const key = `${INSTALL_CHANNEL_PREFIX}${name}`
      const stamped = await setHiveRoot(host, key, committed.rootSig)
      if (!stamped.ok) { toast(t('module.unstamped', 'The install channel was not stamped: {reason}', { reason: stamped.reason ?? 'refused' }), 'warning'); return }
      const door = sandboxDoorUrl(name, host)
      toast(t('module.sandboxed', 'Sandbox {name} is open at {door}. Promote it when you are happy with it.', { name, door }), 'success')
      EffectBus.emit('module:sandboxed', { name, door, root: committed.rootSig, host })

      // The transfer pack, awaited before the stamps below: the index is
      // rewritten whole on every stamp, so two writers at once would lose one.
      await publishPack(host, name, committed.files, drafts, sync, t, toast)

      // THE CHANGE, PUBLIC, AND THE HOST'S READING OF IT. Never a gate: a
      // failure here leaves the sandbox open and says why.
      const deps = reviewDeps(drafts, sync)
      if (!deps) { toast(t('module.noreview', 'The review cannot run here: {reason}.', { reason: 'the host AI or the store is not loaded' }), 'warning'); return }
      const change = await publishChange(host, name, committed.rootSig, committed.changes, committed.off, deps, taken)
      if (!change.ok) { toast(t('module.noreview', 'The review cannot run here: {reason}.', { reason: change.error }), 'warning'); return }
      await review(host, change.sig, change.record, deps, t, toast)
      await jevRead(host, change.sig, change.record, deps, t, toast)
    } catch (error) {
      toast(t('module.unstamped', 'The install channel was not stamped: {reason}', { reason: error instanceof Error ? error.message : 'refused' }), 'warning')
    }
  }
}

const _module = new ModuleQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ModuleQueenBee', _module)
