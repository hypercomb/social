// assistant/module.queen.ts
//
// THE SOURCE LIVES IN THE HIVE — the participant's side of it. A model writes
// a module section back through the write fence (hive-read-fence.md, "Writing
// a module") and the hive runs it here as a DRAFT: a pick over the installed
// package, this browser's alone. These are the words that see, drop and
// commit drafts, so no draft is ever a thing only a reload can reveal:
//
//   module                 list the drafts picked right now
//   module drop <path>     the trunk's layer runs at <path> again (reload)
//   module commit [<path>] [<name>]
//                          the draft becomes the package: re-minted root,
//                          appended to this host's host:packages pool as
//                          <name> (default `essentials`), made the trunk
//                          here, and the install:<name> channel stamped so
//                          followers take it — publish:revision, from inside.
//
// The runtime does the minting (module-drafts.ts, reached through the key
// core declares); the stamp is done here because the signing key lives in
// sharing/hive-pointer.ts.

import { QueenBee, EffectBus, I18N_IOC_KEY, MODULE_DRAFTS_IOC_KEY, type I18nProvider, type ModuleDraftsProvider } from '@hypercomb/core'
import { setHiveRoot } from '../sharing/hive-pointer.js'
import { INSTALL_CHANNEL_PREFIX, PUBLIC_CONTENT_HOSTS } from '../sharing/hive-link.js'

const DEFAULT_CHANNEL = 'essentials'
const CHANNEL_RE = /^[a-z][a-z0-9-]*$/
const PATH_RE = /^[a-z0-9][a-z0-9._-]{0,63}(?:\/[a-z0-9][a-z0-9._-]{0,63})*$/i

export class ModuleQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'module'
  override description = 'See, drop or commit the module drafts running here'
  override descriptionKey = 'slash.module'
  override options = ['list', 'drop <path>', 'commit [<path>] [<name>]']
  override examples = [
    { input: '/module', result: 'Lists the drafts picked over the installed package' },
    { input: '/module commit games/solomon', result: 'The draft becomes the package this host publishes' },
  ]
  override machine = {
    forms: 'list | drop <path> | commit [<path>] [<name>]',
    example: '/module list',
    bare: true,
    reach: 'editing' as const,
    scope: 'network' as const,
    refuse: (args: string): string | undefined => {
      const [word = 'list'] = args.trim().split(/\s+/)
      return ['list', 'drop', 'commit'].includes(word) ? undefined : '/module takes list, drop <path> or commit [<path>] [<name>]'
    },
  }

  override slashComplete(args: string): readonly string[] {
    const typed = args.trim().toLowerCase()
    return ['list', 'drop ', 'commit '].filter(word => word.startsWith(typed) && word.trim() !== typed)
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
      if (!held.length) { toast(t('module.none', 'No drafts are picked here.')); return }
      for (const draft of held) toast(t('module.draft', '{path}: {section} (from {from})', { path: draft.path, section: draft.section, from: draft.from.slice(0, 12) + '…' }))
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
    if (word !== 'commit') { toast(t('module.usage', '/module takes list, drop <path> or commit [<path>] [<name>].'), 'warning'); return }

    // commit [<path>] [<name>]: a path is what a draft sits at; a name is a channel word.
    let path = ''
    let name = DEFAULT_CHANNEL
    for (const part of rest) {
      if (part.includes('/') || (PATH_RE.test(part) && !CHANNEL_RE.test(part))) path = part
      else if (CHANNEL_RE.test(part)) name = part
    }
    if (!path) {
      const held = await drafts.list()
      if (held.length !== 1) {
        toast(held.length ? t('module.which', 'Several drafts are picked; say which path to commit.') : t('module.none', 'No drafts are picked here.'), 'warning')
        return
      }
      path = held[0]!.path
    }
    const committed = await drafts.commit(path, name)
    if (!committed.ok) { toast(committed.error, 'error'); return }
    toast(t('module.committed', 'Committed {path}: package {root} is entry {index} of this host, and runs here on reload.', { path, root: committed.rootSig.slice(0, 12) + '…', index: committed.index }), 'success')

    // THE STAMP: install:<name> → the new root, signed by this browser. A
    // refusal leaves the commit standing — the package is published; only the
    // pointer followers read has not moved.
    const host = PUBLIC_CONTENT_HOSTS[0] ?? ''
    if (!host) { toast(t('module.nohost', 'No index host is configured, so the install channel was not stamped.'), 'warning'); return }
    try {
      const stamped = await setHiveRoot(host, `${INSTALL_CHANNEL_PREFIX}${name}`, committed.rootSig)
      if (stamped.ok) toast(t('module.stamped', 'Stamped {key} on {host}.', { key: `${INSTALL_CHANNEL_PREFIX}${name}`, host: stamped.host }), 'success')
      else toast(t('module.unstamped', 'The install channel was not stamped: {reason}', { reason: stamped.reason ?? 'refused' }), 'warning')
    } catch (error) {
      toast(t('module.unstamped', 'The install channel was not stamped: {reason}', { reason: error instanceof Error ? error.message : 'refused' }), 'warning')
    }
  }
}

const _module = new ModuleQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ModuleQueenBee', _module)
