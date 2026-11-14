// hypercomb-web/src/setup/root-override.ts
//
// THE ROOT SCREEN: set the package root by its signature, before any package
// code loads.
//
// jwize, 2026-11-13: "we should have a place where we can do an override and
// set a new signature root so that we can host any os" · "before dynamic loads
// so that we have an injection point to save a corrupted or compromised build"
// · "Maybe something we type into the console but probably should show some
// interface and input values from there" · "and have the most recent as well.
// Maybe this file can only be created by a remote signer."
//
// Everything else that changes what runs — the hosts desk, the update notice,
// the words — is drawn by the package. A package that is broken or hostile
// cannot be trusted to draw its own way out, so this one is the SHELL's:
// plain DOM, shown from bootstrap() BEFORE the import map is attached, before
// a dependency or a bee is imported. On a page where it is up, no package code
// has run.
//
// HOW IT IS REACHED
//
//   • the console: `hypercomb.root()` (or `hypercomb.root('<sig>')` to fill
//     the field). It only leaves a note for the next boot and reloads — the
//     screen then stands before dynamic loads. main.ts defines it before
//     bootstrap, so it is there even when the hive never comes up.
//   • the address: `?root` (or `?root=<sig>`). A link can OPEN the screen and
//     fill the field. It can never take a root: that is a press, here.
//
// WHAT MAY BE TAKEN — no unsigned door is opened (planOverride):
//
//   HELD     a root that ran here or was admitted here before (the shell's
//            signature store). It is composed from bytes already held; no host
//            is asked. This is the rollback that saves a bad build, and it is
//            how a package saved on the hosts desk is run again.
//   SIGNED   THE DEFAULT: the root the publisher this shell ships with names
//            in their SIGNED index — schnorr-checked by the shell itself
//            (install-follow.ts), the same read a first install makes, and
//            read against the shell's OWN publisher record, never the one in
//            browser storage a compromised build could have rewritten. When
//            the participant follows a publisher of their own, that one's
//            signed root is offered beside it, named by its key. Admitted
//            through the gate's OVERRIDE door (runtime activation-authority.ts).
//   ORIGIN   a root this very domain serves — its code already runs here (the
//            gate's SELF door decides, not this file).
//
// There is no signing step and no override record (jwize, 2026-11-13: "You only
// have to publish a package. The override is just so that if something gets
// compromised it should load the default or a set replacement" · "the
// replicator get the package they adopted so it would already have the
// signature"). A package adopted here is held here with its signature, so the
// replacement is already on the device: that is the HELD door.
//
// Anything else is refused, with the sentence saying why. The root runs ALONE:
// picks laid over the trunk are released (their bytes stay), because a pick may
// be exactly what a rescue is leaving behind. Paths turned off stay off — that
// only ever removes code. Nothing is deleted.
//
// It writes no record of its own: taking a root is the ordinary activation
// (the installed stamp and manifest runtime writes), so there is no second
// truth to drift, and nothing here to forge.

import { I18N_IOC_KEY, isSandboxDoor, registerPoolMeaning, type I18nProvider } from '@hypercomb/core'
import { acquire, applySelection, layersIoFor, previousRoots, rootHolder, trustedHere } from '@hypercomb/runtime/acquire'
import { installedPackageSig } from '@hypercomb/runtime/installed-package'
import { headPackage, readInstallChannel, type ChannelRead } from '@hypercomb/runtime/host-packages'
import { HOST_PACKAGES_MEANING, markerIndices, parseMember, poolEntryName } from '@hypercomb/runtime/host-pool'
import { hostZone, listHostZones } from '@hypercomb/runtime/host-zones'
import { cacheImportMap } from './resolve-import-map'
import { shellDefaultFollow, shellInstallFollow, verifyIndexEvent } from './install-follow'

const SIG_RE = /^[a-f0-9]{64}$/
/** sessionStorage: the console asked for the screen. `1`, or the signature to fill in. */
export const ROOT_ASK_KEY = 'hc:root-override'
/** The address parameter that opens the screen. */
export const ROOT_PARAM = 'root'
/** How many saved packages and how many of a host's the screen lists. */
const RECENT = 5

// ── the plan: pure ──────────────────────────────────────────────────────────

export type OverridePlan =
  | { take: true; by: 'held' | 'signed' | 'origin' }
  | { take: false; why: 'not-a-signature' | 'running' | 'forged' | 'unvouched' }

/** May this root be taken, and by which door? Pure. */
export const planOverride = (q: {
  asked: string
  /** What runs here now. */
  running: string | null
  /** It ran here or was admitted here, and reads as a package root. */
  held: boolean
  /** The root the followed publisher's verified signed index names; null when
   *  none could be read. */
  signed: string | null
  /** A door served an index that is not the followed publisher's. */
  forged: boolean
  /** This domain itself serves the root's file. */
  origin: boolean
}): OverridePlan => {
  const asked = String(q.asked ?? '').trim().toLowerCase()
  if (!SIG_RE.test(asked)) return { take: false, why: 'not-a-signature' }
  if (asked === q.running) return { take: false, why: 'running' }
  if (q.held) return { take: true, by: 'held' }
  // A substituted index is the loudest condition there is: nothing is taken on its word.
  if (q.forged) return { take: false, why: 'forged' }
  if (q.signed === asked) return { take: true, by: 'signed' }
  if (q.origin) return { take: true, by: 'origin' }
  return { take: false, why: 'unvouched' }
}

/** Does a layer record read as a PACKAGE root — not a branch of one, and not a
 *  draft's record? The store trusts every signature it admitted, layers and
 *  draft records among them; a branch taken as the root would boot a hive with
 *  one package of fifty. */
export const readsAsPackageRoot = (record: unknown): boolean => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false
  const fields = record as Record<string, unknown>
  if ('draft' in fields) return false
  const filled = (value: unknown): boolean => Array.isArray(value) && value.length > 0
  return filled(fields['cells']) && filled(fields['dependencies'])
}

/** What the address asks: null when it does not ask, '' to open the screen,
 *  a signature to fill the field with. */
export const askedInAddress = (search: string): string | null => {
  let params: URLSearchParams
  try { params = new URLSearchParams(search) } catch { return null }
  if (!params.has(ROOT_PARAM)) return null
  const value = (params.get(ROOT_PARAM) ?? '').trim().toLowerCase()
  return SIG_RE.test(value) ? value : ''
}

// ── the console's half ──────────────────────────────────────────────────────

/** `hypercomb.root()`: leave the note and restart, so the screen stands before
 *  any package code on the next boot. It takes nothing. */
export const askRootOverride = (sig?: unknown): string => {
  const fill = String(sig ?? '').trim().toLowerCase()
  try { sessionStorage.setItem(ROOT_ASK_KEY, SIG_RE.test(fill) ? fill : '1') } catch {
    return 'This page cannot keep a note across a restart — open the address with ?root instead.'
  }
  setTimeout(() => location.reload(), 0)
  return 'Restarting onto the root screen — it stands before any package code loads.'
}

/** Read the request once: the console's note, or the address. null: not asked. */
const takeRequest = (): string | null => {
  let asked: string | null = null
  try {
    const note = sessionStorage.getItem(ROOT_ASK_KEY)
    if (note !== null) {
      sessionStorage.removeItem(ROOT_ASK_KEY)
      asked = SIG_RE.test(note) ? note : ''
    }
  } catch { /* no session storage: the address alone */ }
  const fromAddress = askedInAddress(location.search)
  if (fromAddress !== null) {
    asked = asked || fromAddress
    // The address stops asking: a restart after a take must not land back here.
    try {
      const url = new URL(location.href)
      url.searchParams.delete(ROOT_PARAM)
      history.replaceState(history.state, '', url.pathname + url.search + url.hash)
    } catch { /* the address stays; the screen still closes */ }
  }
  return asked
}

// ── what is known here ──────────────────────────────────────────────────────

type Recent = { sig: string; from: 'before' | 'default' | 'signed' | 'saved' | 'host'; label: string; where: string; at: string }

/** One publisher's signed word, as the shell read and verified it: the default
 *  this shell ships with, or the publisher the participant follows. */
export type Vouch = { kind: 'default' | 'followed'; read: ChannelRead; hosts: readonly string[]; pubkey: string }

/** Read what each publisher signed: the shell's default always, and the
 *  participant's own follow when it names somebody else. Never throws. */
const readVouches = async (): Promise<Vouch[]> => {
  const unreachable: ChannelRead = { state: 'unreachable' }
  const ask = async (kind: Vouch['kind'], follow: ReturnType<typeof shellDefaultFollow>): Promise<Vouch | null> => follow
    ? { kind, read: await readInstallChannel(follow, verifyIndexEvent).catch(() => unreachable), hosts: follow.hosts, pubkey: follow.pubkey }
    : null
  const standard = shellDefaultFollow()
  const own = shellInstallFollow()
  const another = !!own && !(standard && own.pubkey === standard.pubkey && own.channel === standard.channel)
  const read = await Promise.all([ask('default', standard), another ? ask('followed', own) : Promise.resolve(null)])
  return read.filter((vouch): vouch is Vouch => !!vouch)
}

/** Where an activation leaves its module sets (runtime acquire.ts). */
const INSTALL_MANIFEST_KEY = 'core-adapter.installed-manifest'

/** The roots that ran here before this one, newest first — what a rescue
 *  reaches for first. Read from the activation record; a hint for the list. */
const ranBefore = (): Recent[] => {
  try {
    return previousRoots(JSON.parse(localStorage.getItem(INSTALL_MANIFEST_KEY) ?? 'null'))
      .map(sig => ({ sig, from: 'before' as const, label: '', where: '', at: '' }))
  } catch { return [] }
}

/** The packages saved in this hive's own `host:packages` pool, newest first.
 *  Read without minting the pool. */
const savedHere = async (): Promise<Recent[]> => {
  try {
    const store = (globalThis as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.('@hypercomb.social/Store') as
      { initialize?: () => Promise<void>; hypercombRoot?: FileSystemDirectoryHandle } | undefined
    await store?.initialize?.()
    const root = store?.hypercombRoot
    if (!root) return []
    const dir = await root.getDirectoryHandle(await registerPoolMeaning(HOST_PACKAGES_MEANING), { create: false })
    const names: string[] = []
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name)
    const out: Recent[] = []
    for (const index of markerIndices(names).reverse().slice(0, RECENT)) {
      try {
        const file = await (await dir.getFileHandle(poolEntryName(index), { create: false })).getFile()
        const member = parseMember(await file.text())
        if (member) out.push({ sig: member.packageSig, from: 'saved', label: member.label, where: '', at: file.lastModified ? new Date(file.lastModified).toISOString() : '' })
      } catch { /* an entry that cannot be read is not listed */ }
    }
    return out
  } catch { return [] }
}

/** Is the root held here as a package root that this shell already trusted? */
const heldAsRoot = async (sig: string): Promise<boolean> => {
  if (!trustedHere(sig)) return false
  try {
    const io = await layersIoFor([])
    const bytes = await io?.read(sig)
    return !!bytes && readsAsPackageRoot(JSON.parse(new TextDecoder().decode(bytes)))
  } catch { return false }
}

// ── the take ────────────────────────────────────────────────────────────────

export type TakeOutcome = { ok: true; by: 'held' | 'signed' | 'origin' } | { ok: false; why: string; detail?: string }

/** Take one root, by the door the plan names. Complete-or-absent: a refusal or
 *  a failure leaves what runs here exactly as it was. */
export const takeRoot = async (asked: string, vouches: readonly Vouch[]): Promise<TakeOutcome> => {
  const sig = String(asked ?? '').trim().toLowerCase()
  // The publisher whose verified signed index names exactly this root — the default first.
  const voucher = vouches.find(vouch => vouch.read.state === 'named' && vouch.read.packageSig === sig) ?? null
  const signed = voucher ? sig : null
  // A substituted index speaks for nothing; it only stops what nobody else vouched for.
  const forged = !voucher && vouches.some(vouch => vouch.read.state === 'forged')
  const held = SIG_RE.test(sig) ? await heldAsRoot(sig) : false
  // The origin is asked only when nothing else vouches: one request, and none on a rollback.
  const needOrigin = SIG_RE.test(sig) && !held && !voucher && !forged
  const origin = needOrigin ? !!(await rootHolder(hostZone(location.host), sig).catch(() => null)) : false
  const plan = planOverride({ asked: sig, running: installedPackageSig(), held, signed, forged, origin })
  if (!plan.take) return { ok: false, why: plan.why }

  if (plan.by === 'held') {
    // From what is held: the root alone, no pick laid over it, no host asked.
    const outcome = await applySelection(sig, [], {})
    return outcome.ok ? { ok: true, by: 'held' } : { ok: false, why: 'failed', detail: outcome.error }
  }
  const carried = await listHostZones().catch(() => [] as string[])
  const zones = plan.by === 'signed' && voucher
    ? [...new Set([voucher.read.state === 'named' ? voucher.read.zone : '', ...voucher.hosts, ...carried].map(hostZone).filter(Boolean))]
    : [hostZone(location.host)]
  const outcome = await acquire(sig, zones, { alone: true, ...(plan.by === 'signed' ? { override: true } : {}) })
  return outcome.ok
    ? { ok: true, by: plan.by }
    : { ok: false, why: 'failed', detail: outcome.error ?? `${outcome.holes.length} file(s) could not be had` }
}

// ── the screen ──────────────────────────────────────────────────────────────

const STYLE = `
.hc-root-screen{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:6vh 16px;box-sizing:border-box;background:rgb(var(--hc-panel-pane,18 20 26));color:var(--hc-window-ink-plain,#e8e6e1);font:15px/1.5 var(--hc-font-ui,system-ui,sans-serif);}
.hc-root-card{width:min(44rem,100%);display:flex;flex-direction:column;gap:.9rem;}
.hc-root-card h1{margin:0;font-size:1.35rem;font-weight:600;}
.hc-root-card p{margin:0;}
.hc-root-quiet{color:var(--hc-window-ink-quiet,#a8a59d);font-size:.86rem;}
.hc-root-sig{font-family:var(--hc-font-mono,ui-monospace,Consolas,monospace);font-size:.82rem;overflow-wrap:anywhere;user-select:all;}
.hc-root-form{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;}
.hc-root-form input{flex:1 1 22rem;min-width:0;padding:.55rem .65rem;font:inherit;font-family:var(--hc-font-mono,ui-monospace,Consolas,monospace);font-size:.82rem;color:inherit;background:rgba(127,127,127,.12);border:1px solid var(--hc-window-line,rgba(127,127,127,.4));border-radius:var(--hc-radius-card,3px);}
.hc-root-form input[aria-invalid="true"]{border-color:var(--hc-status-alert,#e0655c);}
.hc-root-screen button{padding:.5rem .9rem;font:inherit;color:inherit;background:rgba(127,127,127,.14);border:1px solid var(--hc-window-line,rgba(127,127,127,.4));border-radius:var(--hc-radius-card,3px);cursor:pointer;}
.hc-root-screen button.primary{border-color:var(--hc-window-accent,#d9a441);color:var(--hc-window-accent,#d9a441);font-weight:600;}
.hc-root-screen button:disabled{opacity:.5;cursor:default;}
.hc-root-screen :focus-visible{outline:2px solid var(--hc-window-accent,#d9a441);outline-offset:2px;}
.hc-root-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.35rem;}
.hc-root-list li{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem;padding:.45rem .6rem;border:1px solid var(--hc-window-line,rgba(127,127,127,.3));border-radius:var(--hc-radius-card,3px);}
.hc-root-list .what{flex:1 1 14rem;min-width:0;}
.hc-root-list .mark{font-size:.74rem;padding:.05rem .4rem;border:1px solid currentColor;border-radius:99px;opacity:.8;}
.hc-root-status[data-bad="true"]{color:var(--hc-status-alert,#e0655c);}
.hc-root-acts{display:flex;flex-wrap:wrap;gap:.6rem;}
`

const say = (key: string, fallback: string, params: Record<string, string> = {}): string => {
  const fill = (text: string): string => text.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '')
  try {
    const i18n = (globalThis as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
    const value = i18n?.t?.(key, params)
    return value && value !== key ? value : fill(fallback)
  } catch { return fill(fallback) }
}

const WHY: Record<string, [string, string]> = {
  'not-a-signature': ['root.why.not-a-signature', 'A root is a signature: 64 characters, 0 to 9 and a to f.'],
  running: ['root.why.running', 'That root is what runs here now.'],
  forged: ['root.why.forged', 'A host served an index that is not the one your publisher signed, so nothing is taken on its word. A root that already ran here can still be taken.'],
  unvouched: ['root.why.unvouched', 'Not taken: that root was never adopted here, it is not the default, and this domain does not serve it.'],
  failed: ['root.why.failed', 'Not taken, and nothing changed: {detail}'],
}

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const made = document.createElement(tag)
  if (className) made.className = className
  if (text) made.textContent = text
  return made
}

/** Draw the screen and wait: resolves when the participant goes on without a
 *  change. A take restarts the page instead, and never resolves. */
const showRootScreen = (fill: string): Promise<void> => new Promise<void>(resolve => {
  const style = node('style')
  style.textContent = STYLE
  const screen = node('div', 'hc-root-screen')
  screen.setAttribute('role', 'dialog')
  screen.setAttribute('aria-modal', 'true')
  screen.setAttribute('data-hc-root-screen', '')
  const card = node('div', 'hc-root-card')
  const title = node('h1', '', say('root.title', 'Package root'))
  title.id = 'hc-root-title'
  screen.setAttribute('aria-labelledby', title.id)
  const running = installedPackageSig()
  const now = node('p', 'hc-root-quiet', running ? say('root.running', 'Running here now:') : say('root.nothing', 'No package is installed here yet.'))
  if (running) now.append(' ', node('span', 'hc-root-sig', running))

  const form = node('form', 'hc-root-form')
  const field = node('input')
  field.type = 'text'
  field.autocomplete = 'off'
  field.spellcheck = false
  field.maxLength = 64
  field.value = fill
  field.placeholder = say('root.placeholder', 'a root signature — 64 characters')
  field.setAttribute('aria-label', say('root.field', 'Root signature'))
  const take = node('button', 'primary', say('root.take', 'Take this root'))
  take.type = 'submit'
  form.append(field, take)

  const status = node('p', 'hc-root-status')
  status.setAttribute('role', 'status')
  const tell = (text: string, bad = false): void => { status.textContent = text; status.dataset['bad'] = String(bad) }

  const recentHead = node('p', 'hc-root-quiet', say('root.recent', 'Most recent'))
  const list = node('ul', 'hc-root-list')
  const reading = node('li', 'hc-root-quiet', say('root.reading', 'Reading the default and what this hive holds…'))
  list.append(reading)

  const goOn = node('button', '', say('root.continue', 'Continue without changing'))
  goOn.type = 'button'
  const acts = node('div', 'hc-root-acts')
  acts.append(goOn)
  const note = node('p', 'hc-root-quiet', say('root.note', 'No package code has loaded on this page. A root is taken only if it was adopted here before, it is the default, or this domain itself serves it. It runs alone: picks laid over the package are released. Nothing is deleted.'))

  card.append(title, now, form, status, recentHead, list, acts, note)
  screen.append(card)
  document.head.append(style)
  document.body.append(screen)
  field.focus()

  // What each publisher signed is read once and reused by the take.
  const vouches: Promise<Vouch[]> = readVouches().catch(() => [])

  const row = (entry: Recent): HTMLLIElement => {
    const li = node('li')
    const what = node('span', 'what')
    const label = entry.from === 'before'
      ? say('root.from.before', 'Ran here before')
      : entry.from === 'default'
      ? say('root.from.default', 'The default: signed by the publisher this shell ships with, on {host}', { host: entry.where })
      : entry.from === 'signed'
      ? say('root.from.signed', 'Signed by the publisher you follow ({key}), on {host}', { key: entry.label, host: entry.where })
      : entry.from === 'saved'
        ? say('root.from.saved', 'Saved in this hive: {name}', { name: entry.label })
        : say('root.from.host', '{host} lists: {name}', { host: entry.where, name: entry.label })
    what.append(node('span', '', label), node('br'), node('span', 'hc-root-sig', entry.sig))
    if (entry.at) what.append(' ', node('span', 'hc-root-quiet', entry.at.slice(0, 10)))
    li.append(what)
    if (entry.sig === running) li.append(node('span', 'mark', say('root.mark.running', 'running')))
    const use = node('button', '', say('root.use', 'Use'))
    use.type = 'button'
    use.setAttribute('aria-label', say('root.use-label', 'Put {sig} in the field', { sig: entry.sig.slice(0, 12) }))
    use.addEventListener('click', () => { field.value = entry.sig; field.removeAttribute('aria-invalid'); field.focus() })
    li.append(use)
    return li
  }

  void (async () => {
    const [read, saved, zones] = await Promise.all([vouches, savedHere(), listHostZones().catch(() => [] as string[])])
    const signed: Recent[] = read.flatMap(vouch => vouch.read.state === 'named'
      ? [{ sig: vouch.read.packageSig, from: vouch.kind === 'default' ? 'default' as const : 'signed' as const, label: `${vouch.pubkey.slice(0, 12)}…`, where: vouch.read.zone, at: vouch.read.createdAt ? new Date(vouch.read.createdAt * 1000).toISOString() : '' }]
      : [])
    // THE DEFAULT FIRST, then what ran here before — the two things a rescue reaches
    // for. A root that ran before says what else it is: a package saved under a name
    // (its newest), or one a publisher signed.
    const known = new Map([...[...saved].reverse(), ...signed].map(entry => [entry.sig, entry] as const))
    const entries: Recent[] = [
      ...signed.filter(entry => entry.from === 'default'),
      ...ranBefore().map(entry => known.get(entry.sig) ?? entry),
      ...signed.filter(entry => entry.from !== 'default'),
      ...saved,
    ]
    const heads = await Promise.all(zones.slice(0, RECENT).map(zone => headPackage(zone).catch(() => null)))
    for (const head of heads) if (head) entries.push({ sig: head.packageSig, from: 'host', label: head.label, where: head.zone, at: head.at })
    // One line per root: the first place it was found says where it is from.
    const seen = new Set<string>()
    const rows = entries.filter(entry => !seen.has(entry.sig) && !!seen.add(entry.sig))
    list.replaceChildren(...(rows.length ? rows.map(row) : [node('li', 'hc-root-quiet', say('root.none', 'Nothing recent could be read. A signature you already have can still be entered above.'))]))
    if (read.some(vouch => vouch.read.state === 'forged')) tell(say(WHY['forged']![0], WHY['forged']![1]), true)
  })()

  const close = (): void => { screen.remove(); style.remove(); resolve() }
  goOn.addEventListener('click', close)
  screen.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close() } })

  form.addEventListener('submit', event => {
    event.preventDefault()
    const asked = field.value.trim().toLowerCase()
    if (!SIG_RE.test(asked)) { field.setAttribute('aria-invalid', 'true'); tell(say(WHY['not-a-signature']![0], WHY['not-a-signature']![1]), true); return }
    field.removeAttribute('aria-invalid')
    take.disabled = true
    goOn.disabled = true
    tell(say('root.taking', 'Checking that root, then taking it…'))
    void (async () => {
      let outcome: TakeOutcome
      try { outcome = await takeRoot(asked, await vouches) } catch (error) {
        outcome = { ok: false, why: 'failed', detail: error instanceof Error ? error.message : String(error) }
      }
      if (!outcome.ok) {
        const [key, fallback] = WHY[outcome.why] ?? WHY['failed']!
        tell(say(key, fallback, { detail: outcome.detail ?? '' }), true)
        take.disabled = false
        goOn.disabled = false
        return
      }
      tell(say('root.taken', 'Taken. Restarting onto it…'))
      // The restart replays a frozen import map: cache the one this root makes.
      try { await cacheImportMap() } catch { /* the boot re-derives it and reloads once */ }
      location.reload()
    })()
  })
})

/**
 * Called from bootstrap() before any dynamic load. Resolves at once when
 * nothing asked for the screen; otherwise when the participant goes on without
 * a change (a take restarts the page). Never on a published website, which
 * runs a publisher's renderer over session memory, nor on a sandbox door,
 * which writes nothing.
 */
export const rootOverrideGate = async (): Promise<void> => {
  if ((globalThis as { __HC_READONLY__?: boolean }).__HC_READONLY__ === true || isSandboxDoor()) return
  const asked = takeRequest()
  if (asked === null) return
  await showRootScreen(asked)
}
