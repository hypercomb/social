// diamondcoreprocessor.com/sharing/host.queen.ts
//
// `/host` — publish the CURRENT branch as a STATIC hive and mint its link.
//
// The publisher side of static hive hosting: no swarm, no relay, no
// hc:mesh-public — the whole flow rides the HTTPS byte tier. Sequence:
//
//   1. Consent — the operator confirms bytes go to the public content
//      endpoint and that their Nostr key will sign the uploads + index.
//   2. Mark the branch public (setBranchPublic) — /host IS the sanctioned
//      public enumerator for this branch; the swarm walk (if ever on)
//      agrees with it.
//   3. sealSubtree — re-derive a merkle-coherent root from LIVE location
//      heads (leaf-only-commit safe); heal + retry once on failure.
//   4. markPublic + drain — HostSyncService stages the sealed closure to
//      the public CDN (its own opt-in gate) and PUTs with confirmed
//      read-back receipts.
//   5. AVAILABILITY GATE — wait for the closure to be fully receipted.
//      "Bytes before broadcast": the index NEVER advances to a head whose
//      closure isn't confirmed served. On timeout the queue keeps retrying
//      detached and the operator re-runs /host — the pointer stays honest.
//   6. Sign + PUT the hive index (`/hive/<pubkey>`, kind 30564) with this
//      branch's lineageKey → sealed head merged over the existing index.
//   7. Mint the hive-link bundle (stable: segments + pubkey + hosts),
//      receipt it, copy `https://<host>/<bundleSig>` to the clipboard.

import { EffectBus, get, requestConfirm, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import {
  HIVE_LINK_KIND,
  HIVE_LINK_VERSION,
  PUBLIC_CONTENT_HOSTS,
  encodeHiveLinkBundle,
  type HiveLinkBundle,
} from './hive-link.js'
import { fetchHiveManifest, putHiveManifest } from './hive-pointer.js'
import { lineageKey } from '../history/lineage-key.js'
import { isBranchPublic, setBranchPublic } from '../presentation/tiles/tile-actions.drone.js'

const STORE_KEY = '@hypercomb.social/Store'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const SELF_DOMAIN_KEY = 'hc:nostrmesh:self-domain'

const SIG_RE = /^[a-f0-9]{64}$/
const LOOPBACK_RE = /^(localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i
// Availability wait: closure receipts normally land in seconds; a big
// first-time branch can take longer. Past the deadline the drain keeps
// retrying detached — /host just declines to advance the pointer yet.
const AVAILABILITY_DEADLINE_MS = 120_000
const AVAILABILITY_POLL_MS = 2_500
const PROGRESS_NOTE_MS = 15_000

interface StoreLike { putResource: (b: Blob) => Promise<string> }
interface LineageLike { explorerSegments?: () => readonly string[] }
interface HistoryLike {
  sealSubtree: (segments: readonly string[]) => Promise<string | null>
  healSubtreeBags: (segments: readonly string[]) => Promise<unknown>
}
interface HostSyncLike {
  isEnabled?: () => boolean
  isPublicHostEnabled?: () => boolean
  enablePublicHost?: () => void
  markPublic?: (sig: string, kind?: string, closure?: boolean) => Promise<void>
  drain?: () => Promise<void>
  isClosureAvailable?: (sig: string, kind: string, closure: boolean) => Promise<boolean>
  ensureReceipt?: (sig: string, timeoutMs?: number) => Promise<boolean>
}
interface SignerLike { getPublicKeyHex?: () => Promise<string | null> }

function normalizeHost(raw: string): string {
  return String(raw ?? '').trim()
    .replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '').toLowerCase()
}

export class HostQueenBee {
  readonly command = 'host'
  readonly aliases = ['publish-static', 'host-branch'] as const
  readonly description =
    'Host the current branch as a static hive: seal it, upload its closure to the public content endpoint, advance your signed hive index, and copy a shareable preview link.'
  readonly descriptionKey = 'slash.host'

  async invoke(_args: string): Promise<void> {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    const store = get<StoreLike>(STORE_KEY)
    const lineage = get<LineageLike>(LINEAGE_KEY)
    const history = get<HistoryLike>(HISTORY_KEY)
    const hostSync = get<HostSyncLike>(HOST_SYNC_KEY)
    const signer = get<SignerLike>(NOSTR_SIGNER_KEY)
    if (!store?.putResource || !history?.sealSubtree || !hostSync?.markPublic || !signer?.getPublicKeyHex) {
      this.#toast('error', this.#t(i18n, 'host.title', 'Host branch'), 'Core services are not ready yet.')
      return
    }

    const segments = (lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    if (segments.length === 0) {
      // The whole hive root is not a branch — name the gesture precisely.
      this.#toast('tip', this.#t(i18n, 'host.title', 'Host branch'),
        this.#t(i18n, 'host.not-branch', 'Navigate into the branch you want to host, then run /host again.'))
      return
    }
    const name = segments[segments.length - 1]

    // 1. Consent — names the CDN and the signer before anything happens.
    const confirmed = await requestConfirm({
      title: 'host.confirm.title',
      message: 'host.confirm.message',
      messageParams: { name },
      confirmLabel: 'host.confirm.allow',
      cancelLabel: 'host.confirm.deny',
    })
    if (!confirmed) return

    // 2. /host IS the sanctioned public enumerator for this branch.
    const parentLocation = '/' + segments.slice(0, -1).join('/')
    if (!isBranchPublic(parentLocation, name)) setBranchPublic(parentLocation, name, true)
    hostSync.enablePublicHost?.()

    // 3. A merkle-coherent root from live heads; heal once, retry, else
    //    fail LOUD — never publish a lossy seal.
    let sealed = await history.sealSubtree(segments)
    if (!sealed) {
      try { await history.healSubtreeBags(segments) } catch { /* heal is best-effort */ }
      sealed = await history.sealSubtree(segments)
    }
    if (!sealed || !SIG_RE.test(sealed)) {
      this.#toast('error', this.#t(i18n, 'host.title', 'Host branch'),
        this.#t(i18n, 'host.seal-failed', 'The branch could not be sealed (a child is cold or unresolvable) — visit its tiles once, then run /host again.'))
      return
    }

    // 4. Stage the sealed closure to the CDN and start pushing.
    this.#activity(this.#t(i18n, 'host.uploading', 'uploading branch to the public host…'), '●')
    await hostSync.markPublic(sealed, 'layer', true)
    void hostSync.drain?.()

    // 5. THE AVAILABILITY GATE — the index only ever names a served head.
    let pending = -1
    const offSync = EffectBus.on<{ pending?: number }>('sync:state', p => {
      if (typeof p?.pending === 'number') pending = p.pending
    })
    let available = false
    const deadline = Date.now() + AVAILABILITY_DEADLINE_MS
    let nextNote = Date.now() + PROGRESS_NOTE_MS
    try {
      for (;;) {
        available = (await hostSync.isClosureAvailable?.(sealed, 'layer', true)) === true
        if (available || Date.now() >= deadline) break
        if (Date.now() >= nextNote) {
          nextNote = Date.now() + PROGRESS_NOTE_MS
          this.#activity(
            pending >= 0
              ? this.#t(i18n, 'host.progress', `still uploading — ${pending} pending`, { pending })
              : this.#t(i18n, 'host.progress-quiet', 'still uploading…'),
            '○')
        }
        await new Promise(r => setTimeout(r, AVAILABILITY_POLL_MS))
      }
    } finally { offSync() }
    if (!available) {
      this.#toast('info', this.#t(i18n, 'host.title', 'Host branch'),
        this.#t(i18n, 'host.failed', 'The branch is still uploading — your hive index was NOT advanced (no dead links). Uploads retry automatically; run /host again once the sync pill clears.'))
      return
    }

    // 6. Merge + sign + PUT the index. The index is replaceable, not
    //    mergeable on the host — carry every previously-published root.
    const pubkey = String((await signer.getPublicKeyHex()) ?? '').toLowerCase()
    if (!SIG_RE.test(pubkey)) {
      this.#toast('error', this.#t(i18n, 'host.title', 'Host branch'), 'No signing key available — the hive index must be signed.')
      return
    }
    const key = lineageKey(segments)
    const indexHost = PUBLIC_CONTENT_HOSTS[0]
    const existing = await fetchHiveManifest(indexHost, pubkey)
    const roots = { ...(existing?.roots ?? {}), [key]: sealed }
    const put = await putHiveManifest(indexHost, roots)
    if (!put.ok) {
      this.#toast('error', this.#t(i18n, 'host.title', 'Host branch'),
        this.#t(i18n, 'host.index-failed', 'The bytes are hosted but the hive index update failed ({reason}) — run /host again to retry the index.', { reason: put.reason ?? 'unknown' }))
      return
    }

    // 7. The stable bearer link: segments + pubkey + hosts (+ the sealed
    //    head as a cold-index fallback hint).
    const selfDomain = this.#selfDomain()
    const hosts = [
      ...(hostSync.isEnabled?.() && selfDomain ? [selfDomain] : []),
      ...PUBLIC_CONTENT_HOSTS,
    ]
    const bundle: HiveLinkBundle = {
      kind: HIVE_LINK_KIND,
      v: HIVE_LINK_VERSION,
      segments,
      pubkey,
      hosts,
      rootSig: sealed,
      createdAt: Date.now(),
    }
    let bundleSig: string
    try {
      bundleSig = await store.putResource(encodeHiveLinkBundle(bundle))
    } catch {
      this.#toast('error', this.#t(i18n, 'host.title', 'Host branch'), 'Could not create the link bundle resource.')
      return
    }
    await hostSync.markPublic(bundleSig, 'resource')
    const receipted = (await hostSync.ensureReceipt?.(bundleSig, 12_000)) === true

    const linkHost = normalizeHost(window.location.host) || window.location.host
    const scheme = LOOPBACK_RE.test(linkHost) ? 'http' : 'https'
    const url = `${scheme}://${linkHost}/${bundleSig}`
    let copied = false
    try { await navigator.clipboard.writeText(url); copied = true }
    catch { /* clipboard needs focus/permission — the toast carries the URL */ }

    const doneMsg = receipted
      ? this.#t(i18n, 'host.done', 'Branch hosted. {link}', { link: copied ? 'Link copied — anyone who opens it can preview, then adopt.' : url })
      : this.#t(i18n, 'host.done-pending-link', 'Branch hosted; the link itself is still uploading (retries automatically). {link}', { link: copied ? 'Link copied.' : url })
    this.#toast('success', this.#t(i18n, 'host.title', 'Host branch'), doneMsg)
    console.log(`[host] "${name}" sealed=${sealed.slice(0, 12)}… index=${indexHost}/hive/${pubkey.slice(0, 12)}… link=${url}`)
  }

  #selfDomain = (): string => {
    try { return normalizeHost(localStorage.getItem(SELF_DOMAIN_KEY) ?? '') } catch { return '' }
  }

  #t = (i18n: I18nProvider | undefined, key: string, fallback: string, params?: Record<string, unknown>): string =>
    i18n?.t(key, params as never) ?? fallback

  #activity = (message: string, icon: string): void => {
    EffectBus.emit('activity:log', { message, icon })
  }

  #toast = (type: string, title: string, message: string): void => {
    EffectBus.emit('toast:show', { type, title, message })
  }
}

const _host = new HostQueenBee()
window.ioc.register('@diamondcoreprocessor.com/HostQueenBee', _host)
