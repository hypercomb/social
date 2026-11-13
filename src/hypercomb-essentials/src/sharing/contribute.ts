// sharing/contribute.ts
//
// THE CONTRIBUTE ACT (jwize 2026-11-12: "let's make it explore recipes instead
// of need and contribute recipes or whatever").
//
// Contributing puts a list for the tile you stand on onto a host, under your
// own key: the values you say (`contribute soup, bread`), or else the names of
// the tiles under it. The host is the one you name (`@host`), else the first
// host of the branch. The record and the index stamp are need-lists.ts; what
// `explore` reads back is need-feeds.ts.
//
// Publishing is the participant's own act: only the typed word or the
// explore view's button run it (contribute.queen.ts refuses a model).
//
// Exports; registers nothing.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { offerNeedList } from './need-lists.js'
import { childNamesAt } from '../commands/trait-read.js'
import { hostOfferDeps } from './host-offer.js'
import { hostsOfBranch } from './community-hosts.js'
import { zoneDoor } from './zone-door.js'

/** Said once a list landed: `{ name, host, record, count }`. */
export const CONTRIBUTED_EFFECT = 'need:offered'

type LineageLike = { explorerSegments?: () => readonly string[] }
const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** Where the participant stands. */
export const standingSegments = (): string[] =>
  [...(ioc<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])].map(String)

/** `contribute` arguments: the values said (comma-separated) and the host
 *  named with `@`. No values said = null, the tiles under where you stand. */
export const parseContribution = (rest: string): { values: string[] | null; host: string } => {
  const host = /(?:^|\s)@(\S+)/.exec(rest)?.[1] ?? ''
  const said = rest.replace(/(?:^|\s)@\S+/g, ' ').trim()
  const values = said ? said.split(',').map(v => v.trim()).filter(Boolean) : []
  return { values: values.length ? values : null, host }
}

const say = (key: string, fallback: string, params: Record<string, string | number> = {}): string => {
  const out = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key)
  const text = out && out !== key ? out : fallback
  return text.replace(/\{(\w+)\}/g, (whole, token: string) => token in params ? String(params[token]) : whole)
}

const toast = (type: string, message: string): void => { EffectBus.emit('toast:show', { type, message }) }

/**
 * Contribute a list for the tile you stand on. Toasts its own outcome; true
 * when the list landed on the host.
 */
export async function contributeHere(rest: string): Promise<boolean> {
  const standing = standingSegments()
  const name = standing[standing.length - 1] ?? ''
  if (!name) {
    toast('tip', say('need.offer-root', 'Stand on a tile first — its name is what the list is contributed for.'))
    return false
  }
  const said = parseContribution(rest)
  const values = said.values ?? await childNamesAt(standing).catch(() => [])
  if (!values.length) {
    toast('warning', say('need.offer-empty', 'Nothing to contribute: "{name}" has no tiles under it — say contribute a, b, c.', { name }))
    return false
  }
  const host = zoneDoor(said.host) || (await hostsOfBranch(standing).catch(() => []))[0] || ''
  if (!host) {
    toast('warning', say('need.offer-nohost', 'No host for "{name}" — say contribute @<host>.', { name }))
    return false
  }
  const deps = hostOfferDeps()
  const done = deps
    ? await offerNeedList(host, name, values, deps).catch((error: unknown) => ({ ok: false as const, error: String((error as Error)?.message ?? error) }))
    : { ok: false as const, error: 'the store or the host service is not loaded' }
  if (!done.ok) {
    toast('warning', say('need.offer-failed', 'The list for "{name}" was not contributed: {reason}', { name, reason: done.error }))
    return false
  }
  toast('success', say('need.offer-done', 'Contributed {count} values for "{name}" on {host}', { count: done.record.values.length, name, host }))
  EffectBus.emit(CONTRIBUTED_EFFECT, { name, host, record: done.sig, count: done.record.values.length })
  return true
}
