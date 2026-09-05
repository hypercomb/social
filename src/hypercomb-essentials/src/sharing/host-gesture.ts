// sharing/host-gesture.ts
//
// Publish the CURRENT branch as a STATIC hive and mint its link.
//
// THERE IS NO `/host` BEHAVIOUR. Hosting infrastructure and publishing a
// branch are different things: a branch is published from its own line in
// Publish. This module keeps the one-call share-sheet GESTURE — consent,
// progress, the outcome toast, link delivery — because the phone
// share sheet still needs exactly one call that puts a branch into the world
// and hands back a link a cold stranger can open.
//
// The publisher side of static hive hosting: no swarm, no relay, no
// hc:mesh-public — the whole flow rides the HTTPS byte tier.
//
// THE SEQUENCE ITSELF LIVES IN `publish-branch.ts`. This module owns only the
// gesture: consent, progress notes, the outcome toast, and link delivery. The
// publish panel drives the same routine, so there is exactly one
// implementation of "put a branch into the world" and the two surfaces can
// never drift into publishing differently.
//
//   1. Consent — the operator confirms bytes go to the public content
//      endpoint and that their Nostr key will sign the uploads + index.
//   2..7 publishBranch(): mark public → seal (heal + retry) → stage + drain →
//      availability gate → index PUT behind the wipe guard → link bundle →
//      ledger record → confirmation round trip.

import { EffectBus, get, requestConfirm, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { deliverLink } from './deliver-link.js'
import { publishBranch, type PublishProgress } from './publish-branch.js'

const LINEAGE_KEY = '@hypercomb.social/Lineage'

/** How often the availability wait prints a progress note. The wait itself
 *  can run for minutes on a big first-time branch. */
const PROGRESS_NOTE_MS = 15_000

interface LineageLike { explorerSegments?: () => readonly string[] }

const t = (i18n: I18nProvider | undefined, key: string, fallback: string, params?: Record<string, unknown>): string =>
  i18n?.t(key, params as never) ?? fallback

const activity = (message: string, icon: string): void => {
  EffectBus.emit('activity:log', { message, icon })
}

const toast = (type: string, title: string, message: string): void => {
  EffectBus.emit('toast:show', { type, title, message })
}

export const hostCurrentBranch = async (): Promise<void> => {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    const lineage = get<LineageLike>(LINEAGE_KEY)

    const segments = (lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    if (segments.length === 0) {
      // The whole hive root is not a branch — name the gesture precisely.
      toast('tip', t(i18n, 'host.title', 'Publish branch'),
        t(i18n, 'host.not-branch', 'Navigate into the branch you want to publish, then try again.'))
      return
    }
    const name = segments[segments.length - 1] ?? ''

    // 1. Consent — names the CDN and the signer before anything happens.
    const confirmed = await requestConfirm({
      title: 'host.confirm.title',
      message: 'host.confirm.message',
      messageParams: { name },
      confirmLabel: 'host.confirm.allow',
      cancelLabel: 'host.confirm.deny',
    })
    if (!confirmed) return

    let nextNote = 0
    const onProgress = (p: PublishProgress): void => {
      if (p.phase === 'staging') {
        activity(t(i18n, 'host.uploading', 'uploading branch to the public host…'), '●')
        nextNote = Date.now() + PROGRESS_NOTE_MS
        return
      }
      if (p.phase !== 'waiting' || Date.now() < nextNote) return
      nextNote = Date.now() + PROGRESS_NOTE_MS
      activity(
        typeof p.pending === 'number'
          ? t(i18n, 'host.progress', `still uploading — ${p.pending} pending`, { pending: p.pending })
          : t(i18n, 'host.progress-quiet', 'still uploading…'),
        '○')
    }

    const result = await publishBranch(segments, { onProgress })

    if (!result.ok) {
      switch (result.failure) {
        case 'services':
          toast('error', t(i18n, 'host.title', 'Publish branch'), 'Core services are not ready yet.')
          return
        case 'no-branch':
          toast('tip', t(i18n, 'host.title', 'Publish branch'),
            t(i18n, 'host.not-branch', 'Navigate into the branch you want to publish, then try again.'))
          return
        case 'no-host':
          toast('tip', t(i18n, 'host.title', 'Publish branch'),
            t(i18n, 'host.no-host',
              'Nowhere to put the bytes ({reason}) — add a host to this branch, or set one in the hosts panel, then publish again. Nothing was published.',
              { reason: result.reason ?? 'no node' }))
          return
        case 'seal-failed':
          toast('error', t(i18n, 'host.title', 'Publish branch'),
            t(i18n, 'host.seal-failed', 'The branch could not be sealed (a child is cold or unresolvable) — visit its tiles once, then try again.'))
          return
        case 'no-signer':
          toast('error', t(i18n, 'host.title', 'Publish branch'), 'No signing key available — the hive index must be signed.')
          return
        case 'not-available':
          toast('info', t(i18n, 'host.title', 'Publish branch'),
            t(i18n, 'host.failed', 'The branch is still uploading — your hive index was NOT advanced (no dead links). Uploads retry automatically; try again once the sync pill clears.'))
          return
        case 'index-unsafe':
          // The refusal that protects every OTHER branch: rewriting the index
          // off a read we could not verify would drop the ones we cannot see.
          toast('error', t(i18n, 'host.title', 'Publish branch'),
            t(i18n, 'host.index-unsafe',
              'Your hive index could not be read back ({reason}), so it was left untouched — the bytes are hosted; try again when the host answers.',
              { reason: result.reason ?? 'unreachable' }))
          return
        case 'index-failed':
          toast('error', t(i18n, 'host.title', 'Publish branch'),
            t(i18n, 'host.index-failed', 'The bytes are hosted but the hive index update failed ({reason}) — try again to retry the index.', { reason: result.reason ?? 'unknown' }))
          return
        default:
          toast('error', t(i18n, 'host.title', 'Publish branch'), 'Could not create the link bundle resource.')
          return
      }
    }

    // The availability gate above can run for minutes, so this lands far
    // outside the tap's activation — deliverLink descends sheet → clipboard →
    // fresh-tap offer, and on phones that offer is the path that actually
    // fires (mobile browsers refuse both sheet and clipboard this late).
    const delivery = await deliverLink(result.url, name)
    const linkText = delivery === 'shared'
      ? 'Link shared — anyone who opens it can preview, then adopt.'
      : delivery === 'copied'
        ? 'Link copied — anyone who opens it can preview, then adopt.'
        : result.url
    const doneMsg = result.linkReceipted
      ? t(i18n, 'host.done', 'Branch published. {link}', { link: linkText })
      : t(i18n, 'host.done-pending-link', 'Branch published; the link itself is still uploading (retries automatically). {link}', { link: delivery === 'offered' ? result.url : 'Link ready.' })
    toast(result.status === 'confirmed' ? 'success' : 'info',
      t(i18n, 'host.title', 'Publish branch'),
      result.status === 'confirmed'
        ? doneMsg
        : t(i18n, 'host.done-unconfirmed',
          'Branch published — the public host has not served it back yet. Open /publish to watch it go live. {link}',
          { link: linkText }))

    // Evidence of a past index wipe (or a publish from another device): our
    // own ledger names branches the live index does not carry. Reported, never
    // silently re-asserted — republishing them is the participant's call.
    if (result.missingFromIndex.length > 0) {
      toast('info', t(i18n, 'host.title', 'Publish branch'),
        t(i18n, 'host.index-gaps',
          '{count} branch(es) you published before are missing from your hive index — open /publish to republish them.',
          { count: result.missingFromIndex.length }))
    }

    console.log(`[host] "${name}" sealed=${result.sealed.slice(0, 12)}… index=${result.host}/hive/${result.pubkey.slice(0, 12)}… link=${result.url} status=${result.status}`)
  }
