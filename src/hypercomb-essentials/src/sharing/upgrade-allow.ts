// sharing/upgrade-allow.ts
//
// ALLOW, NEVER FORCE (jwize, 2026-09-24: "force is anti-hypercomb"). A moved
// channel pointer is a notice; the participant takes it with Update all. A
// participant may ALLOW their followed publisher's channel to be taken on
// its own the moment the scout sees it move — `upgrade allow`. Nothing here
// runs unless they said so, and `upgrade refuse` takes it back. The take is
// the SAME act the Packages window performs: the install port's `acquire`
// of the announced root from the hosts the participant already carries.

import { EffectBus, INSTALL_IOC_KEY, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { listCommunityHosts } from './community-hosts.js'

export const UPGRADE_ALLOW_KEY = 'hc:upgrade:allow'

type InstallPortLike = {
  acquire?: (root: string, zones: readonly string[], options?: { onHeld?: (sig: string) => void }) => Promise<{ ok: boolean; error?: string }>
}

const i18n = (): I18nProvider | undefined =>
  (window as { ioc?: { get?: <T>(k: string) => T | undefined } }).ioc?.get?.<I18nProvider>(I18N_IOC_KEY)

export const isUpgradeAllowed = (storage: Pick<Storage, 'getItem'> = localStorage): boolean => {
  try { return storage.getItem(UPGRADE_ALLOW_KEY) === '1' } catch { return false }
}

export const setUpgradeAllowed = (allowed: boolean, storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage): void => {
  try { if (allowed) storage.setItem(UPGRADE_ALLOW_KEY, '1'); else storage.removeItem(UPGRADE_ALLOW_KEY) } catch { /* private browsing — asks again */ }
}

/** One take per announced root per session — a take that did not stick must
 *  not loop; the notice stays and the participant decides. */
const attempted = new Set<string>()

/** The allowed take. Returns what happened; never throws. */
export const takeIfAllowed = async (
  packageSig: string,
  followHosts: readonly string[],
  deps: {
    storage?: Pick<Storage, 'getItem'>
    port?: InstallPortLike | null
    zones?: () => Promise<string[]>
    reload?: () => void
  } = {},
): Promise<'not-allowed' | 'no-port' | 'already-tried' | 'taken' | 'failed'> => {
  if (!isUpgradeAllowed(deps.storage ?? localStorage)) return 'not-allowed'
  const port = deps.port !== undefined
    ? deps.port
    : (window as { ioc?: { get?: <T>(k: string) => T | undefined } }).ioc?.get?.<InstallPortLike>(INSTALL_IOC_KEY) ?? null
  if (!port?.acquire) return 'no-port'
  if (attempted.has(packageSig)) return 'already-tried'
  attempted.add(packageSig)
  const carried = await (deps.zones ?? listCommunityHosts)().catch(() => [] as string[])
  const zones = [...new Set([...carried, ...followHosts].map(z => String(z ?? '').trim()).filter(Boolean))]
  const short = packageSig.slice(0, 12)
  EffectBus.emit('activity:log', { message: i18n()?.t('upgrade.applying', { sig: short }) ?? `taking the update ${short}… (you allowed this)`, icon: '⬡' })
  try {
    const outcome = await port.acquire(packageSig, zones)
    if (!outcome.ok) {
      EffectBus.emit('activity:log', { message: i18n()?.t('upgrade.apply-failed', { sig: short, error: outcome.error ?? '' }) ?? `the update ${short} could not be taken: ${outcome.error ?? 'package incomplete'} — it stays offered`, icon: '⬡' })
      return 'failed'
    }
  } catch (error) {
    EffectBus.emit('activity:log', { message: i18n()?.t('upgrade.apply-failed', { sig: short, error: error instanceof Error ? error.message : '' }) ?? `the update ${short} could not be taken — it stays offered`, icon: '⬡' })
    return 'failed'
  }
  EffectBus.emit('activity:log', { message: i18n()?.t('upgrade.applied', { sig: short }) ?? `updated to ${short} — restarting`, icon: '⬡' })
  setTimeout(() => (deps.reload ?? (() => location.reload()))(), 400)
  return 'taken'
}
