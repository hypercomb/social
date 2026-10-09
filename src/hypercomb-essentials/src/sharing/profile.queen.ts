// sharing/profile.queen.ts
//
// THE PROFILE WORD (documentation/sealed-audiences.md, "Names", step 3): a
// participant says who their key is, signed by that key, on their host.
//
//   profile                              your npub, and the profile your
//                                        index names on the host
//   profile name <name>                  set one field; the others are kept
//   profile about <text>
//   profile picture <https-url | sig>    a signature names an image this hive
//                                        holds: published to the host first,
//                                        then named by its URL there
//   profile @<host> …                    on that host instead of yours — the
//                                        host comes FIRST, so the end of an
//                                        about is always the about's
//
// Each set signs the WHOLE profile anew (kind 0), keeps the complete signed
// event as an atom, ships it, and names it in the index as `nostr:profile`
// (profile.ts says what a reader checks). Sets run one at a time, and the
// stamp names the new atom only while the index still names the profile the
// set merged from. Showing reads only: it uses the key this session already
// knows and mints nothing.
//
// Everything after the word is taken verbatim (rawArgs): an about is prose,
// a picture is a URL, and no word in either is another behaviour.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { fetchHiveIndex, putHiveManifest, setHiveRoot } from './hive-pointer.js'
import { cachedPubkey, readerPubkey } from './head-claim-signer.js'
import { PUBLIC_CONTENT_HOSTS } from './hive-link.js'
import {
  parseProfileWord, profileHostUrl, profileMachineRefusal, profileValue, setProfileField, showProfile,
  PROFILE_ABOUT_MAX, PROFILE_NAME_MAX, PROFILE_REASON_TEXT, type ProfileDeps, type ProfileReason, type ProfileReasonParams,
} from './profile.js'

const STORE_KEY = '@hypercomb.social/Store'
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
/** The name this hive already goes by on the mesh — read, never written here. */
const USER_LABEL_KEY = 'hc:user-label'
const NONE = '—'
const SIG_RE = /^[0-9a-f]{64}$/

type StoreLike = {
  putResource?(blob: Blob, options?: { emit?: boolean }): Promise<string>
  getResourceLocal?(sig: string): Promise<Blob | null>
}
type HostSyncLike = {
  publicHostDomain?(): string
  publishAtoms?(host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>):
    Promise<{ ok: true; sent: number; held: number } | { ok: false; error: string }>
}
type SignerLike = {
  signEvent?(evt: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<Record<string, unknown>>
}
type Say = (key: string, fallback: string, params?: Record<string, string | number>) => string

const ioc = <T>(key: string): T | undefined => window.ioc?.get?.(key) as T | undefined

/** The host this participant publishes to, else the compiled public content host. */
const defaultHost = (): string => {
  try { return ioc<HostSyncLike>(HOST_SYNC_KEY)?.publicHostDomain?.() || PUBLIC_CONTENT_HOSTS[0] || '' }
  catch { return PUBLIC_CONTENT_HOSTS[0] ?? '' }
}

const seedLabel = (): string | null => {
  try { return localStorage.getItem(USER_LABEL_KEY) } catch { return null }
}

const bytesOfBlob = async (blob: Blob | null | undefined): Promise<Uint8Array | null> =>
  blob ? new Uint8Array(await blob.arrayBuffer()) : null

/** The live collaborators. Any the hive has not loaded answers as a failure
 *  the set reports; a show needs none of the writers. */
const liveDeps = (): ProfileDeps => {
  const store = (): StoreLike | undefined => ioc<StoreLike>(STORE_KEY)
  const readLocal = async (sig: string): Promise<Uint8Array | null> => {
    try { return await bytesOfBlob(await store()?.getResourceLocal?.(sig)) } catch { return null }
  }
  return {
    cachedPubkey: () => cachedPubkey(),
    signerPubkey: () => readerPubkey(),
    sign: async event => {
      const signer = ioc<SignerLike>(NOSTR_SIGNER_KEY)
      if (!signer?.signEvent) throw new Error('no Nostr signer is available')
      return signer.signEvent(event)
    },
    readIndex: (host, pubkey) => fetchHiveIndex(host, pubkey),
    readLocal,
    fetchAtom: async (host, sig) => {
      try {
        const res = await fetch(`${profileHostUrl(host)}/${sig}`, { cache: 'no-store' })
        // A page (an SPA fallback answering 200) is not a held atom.
        if (!res.ok || (res.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) return null
        return new Uint8Array(await res.arrayBuffer())
      } catch { return null }
    },
    put: async bytes => {
      const held = store()
      if (!held?.putResource) throw new Error('the store is not loaded')
      return held.putResource(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/json' }), { emit: false })
    },
    publish: async (host, sigs) => {
      const sync = ioc<HostSyncLike>(HOST_SYNC_KEY)
      if (!sync?.publishAtoms) return { ok: false, error: 'the host service is not loaded' }
      const done = await sync.publishAtoms(host, sigs, readLocal)
      return done.ok ? { ok: true } : { ok: false, error: done.error }
    },
    // The condition rides on setHiveRoot's OWN read — the one its merge is
    // built from — so nothing can land between the check and that merge
    // inside this hive: the write goes ahead only if that read still names
    // what the set started from.
    stamp: async (host, key, sig, expected) => {
      let named: string | null = null
      let changed = false
      const done = await setHiveRoot(host, key, sig, {
        fetchIndex: async (h, pubkey) => {
          const read = await fetchHiveIndex(h, pubkey)
          const root = read.ok ? String(read.manifest.roots[key] ?? '').toLowerCase() : ''
          named = SIG_RE.test(root) ? root : null
          return read
        },
        putManifest: (...args: Parameters<typeof putHiveManifest>) => {
          if (named === expected) return putHiveManifest(...args)
          changed = true
          return Promise.resolve({ ok: false, pubkey: '', createdAt: 0, reason: 'changed' })
        },
      })
      return done.ok ? { ok: true } : changed ? { ok: false, changed: true } : { ok: false, reason: done.reason }
    },
    now: Date.now,
  }
}

export class ProfileQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'profile'
  override description = 'See or set your public profile — name, about and picture — on your host'
  override descriptionKey = 'slash.profile'
  override options = ['name <name>', 'about <text>', 'picture <https-url | signature>', '@<host> …']
  override examples = [
    { input: '/profile', result: 'Shows your npub and the profile your host holds for it' },
    { input: '/profile name jwize', result: 'Your signed profile names you jwize on your host; about and picture are kept' },
    { input: '/profile picture https://example.com/me.png', result: 'Your profile shows that picture' },
    { input: '/profile @example.com about I make hives', result: 'Sets the about of your profile on example.com instead of your own host' },
  ]

  // An about is prose and a picture a URL: no dot is a walk, no word another behaviour's.
  override rawArgs = true

  override machine = {
    // The argument only — the census writes the word itself.
    forms: '',
    example: '/profile',
    bare: true,
    consequence: "Shows only, from the participant's own host; setting a field publishes under their key, so it is theirs alone.",
    // Shows only: it reads the participant's own host and writes nothing
    // anywhere (every set form, and any other host, is refused).
    reach: 'additive' as const,
    scope: 'local' as const,
    refuse: profileMachineRefusal,
  }

  override slashComplete(args: string): readonly string[] {
    // A leading `@<host>` is kept as typed; the field follows it.
    const lead = /^@\S*\s+/.exec(args.trimStart())?.[0] ?? ''
    const q = args.trimStart().slice(lead.length).toLowerCase()
    const all = ['name ', 'about ', 'picture ']
    if (!q) return all.map(form => lead + form)
    return all.filter(form => form.startsWith(q) && form !== q).map(form => lead + form)
  }

  /** The set running now: sets run one at a time, so a second one merges
   *  from what the first published rather than from the same old profile. */
  #sets: Promise<unknown> = Promise.resolve()

  protected async execute(args: string): Promise<void> {
    const i18n = ioc<I18nProvider>(I18N_IOC_KEY)
    const t: Say = (key, fallback, params) => {
      const value = i18n?.t?.(key, params)
      return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
    }
    /** A reason in the participant's language: its own key, its English beside it. */
    const why = (reason: ProfileReason, params: ProfileReasonParams = {}): string =>
      t(`profile.reason.${reason}`, PROFILE_REASON_TEXT[reason], { ...params })
    const toast = (message: string, type = 'info'): void => { EffectBus.emit('toast:show', { type, message }) }
    const usage = (): void => toast(t('profile.usage', 'Say profile to see yours, or profile name <name>, profile about <text> or profile picture <https address or signature>. For another host, put it first: profile @<host> name <name>. A name is lowercase letters, digits, dot, dash or underscore, up to 64.'), 'warning')

    const word = parseProfileWord(args)
    if (word.form === 'usage') { usage(); return }
    if (word.form === 'badhost') { toast(t('profile.badhost', '{host} is not a host name — put @<domain> right after profile, like profile @example.com.', { host: word.host || '@' }), 'warning'); return }
    const host = word.host ?? defaultHost()
    if (!host) { toast(t('profile.unpublished', 'Your profile was NOT published: {reason}', { reason: why('nohost') }), 'warning'); return }

    if (word.form === 'show') {
      const shown = await showProfile(host, liveDeps(), seedLabel)
      if (shown.kind === 'nokey') { toast(t('profile.nokey', 'No key is known in this session yet, so there is no profile to show, and none was made. Setting a field — profile name <name> — signs with your key.'), 'warning'); return }
      if (shown.kind === 'none') { toast(t('profile.none', '{npub} has no profile on {host} yet. Say profile name {name} to publish one.', { npub: shown.npub, host, name: shown.seed ?? '<name>' })); return }
      if (shown.kind === 'unreadable') { toast(t('profile.unreadable', 'Could not read your profile on {host}: {reason}', { host, reason: why(shown.reason, shown.params) }), 'warning'); return }
      const { name, about, picture } = shown.profile.fields
      toast(t('profile.shown', '{npub} on {host} — name: {name} · about: {about} · picture: {picture}', { npub: shown.npub, host, name: name ?? NONE, about: about ?? NONE, picture: picture ?? NONE }))
      return
    }

    const judged = profileValue(word.field, word.value)
    if (!judged.ok) {
      if (judged.problem === 'toolong') { toast(t('profile.toolong', 'A profile {field} is at most {max} characters.', { field: word.field, max: judged.max ?? (word.field === 'name' ? PROFILE_NAME_MAX : PROFILE_ABOUT_MAX) }), 'warning'); return }
      if (judged.problem === 'badpicture') { toast(t('profile.badpicture', 'A picture is an https:// address, or the 64-hex signature of an image this hive holds.'), 'warning'); return }
      usage(); return
    }

    const field = word.field
    const run = this.#sets.then(() => setProfileField(host, field, word.value, liveDeps()))
    this.#sets = run.catch(() => undefined)
    const done = await run
    if (!done.ok) { toast(t('profile.unpublished', 'Your profile was NOT published: {reason}', { reason: why(done.reason, done.params) }), 'warning'); return }
    toast(t('profile.set', 'Published your profile ({field}) on {host}.', { field, host }), 'success')
    EffectBus.emit('profile:published', { host, pubkey: done.profile.pubkey, sig: done.sig })
  }
}

const _profile = new ProfileQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ProfileQueenBee', _profile)
