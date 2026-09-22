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
//
// All three publishing words are the participant's alone: a model proposing
// them is refused, whatever the Execution policy.

import { QueenBee, EffectBus, I18N_IOC_KEY, MODULE_DRAFTS_IOC_KEY, type I18nProvider, type ModuleDraftsProvider } from '@hypercomb/core'
import { clearHiveRoot, ownHiveRoot, setHiveRoot } from '../sharing/hive-pointer.js'
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
const PUBLISHING = new Set(['commit', 'promote', 'withdraw'])

/** A change's sandbox name: `try-<change>`, one DNS label. */
export const sandboxName = (change: string): string => {
  const bare = String(change ?? '').toLowerCase().replace(/^try-/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
  return bare ? `${SANDBOX_PREFIX}${bare}` : ''
}

/** Where a sandbox is opened: its door on the sandbox zone, or on the host it was published to. */
export const sandboxDoorUrl = (name: string, host: string): string => {
  const bare = host.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const publicHost = PUBLIC_CONTENT_HOSTS.includes(bare) || !bare
  const zone = publicHost ? SANDBOX_ZONE : bare.replace(/^content\./, '')
  const loopback = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3})(:\d{1,5})?$/i.test(zone)
  return `${loopback ? 'http' : 'https'}://${name}.${zone}`
}

export class ModuleQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'module'
  override description = 'See, drop, try in public, or promote what runs here'
  override descriptionKey = 'slash.module'
  override options = ['list', 'drop <path>', 'commit [<change>] [@<host>]', 'promote <change> [<channel>]', 'withdraw <change>']
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
      return ['list', 'drop'].includes(word) ? undefined : '/module takes list or drop <path>'
    },
  }

  override slashComplete(args: string): readonly string[] {
    const typed = args.trim().toLowerCase()
    return ['list', 'drop ', 'commit ', 'promote ', 'withdraw '].filter(word => word.startsWith(typed) && word.trim() !== typed)
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
      if (!held.length && !off.length) { toast(t('module.none', 'No drafts are picked here, and nothing is turned off.')); return }
      for (const draft of held) toast(t('module.draft', '{path}: {section} (from {from})', { path: draft.path, section: draft.section, from: draft.from.slice(0, 12) + '…' }))
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
    if (!PUBLISHING.has(word)) { toast(t('module.usage', '/module takes list, drop <path>, commit [<change>], promote <change> or withdraw <change>.'), 'warning'); return }

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
    const what = [...committed.drafts, ...committed.off.map(path => `-${path}`)].join(', ')
    toast(t('module.committed', 'Committed {what}: package {root} is entry {index} of this host, and runs here on reload.', { what, root: committed.rootSig.slice(0, 12) + '…', index: committed.index }), 'success')

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
    } catch (error) {
      toast(t('module.unstamped', 'The install channel was not stamped: {reason}', { reason: error instanceof Error ? error.message : 'refused' }), 'warning')
    }
  }
}

const _module = new ModuleQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ModuleQueenBee', _module)
