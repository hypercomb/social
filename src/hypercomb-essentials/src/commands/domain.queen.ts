// commands/domain.queen.ts

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { PUBLIC_CONTENT_HOSTS } from '../sharing/hive-link.js'
import { DomainClaims, liveClaimIo, type ClaimReport } from '../sharing/domain-claim.js'

/**
 * /domain — claim a domain, and manage mesh relay domains.
 *
 * Syntax:
 *   /domain claim example.org            — claim a domain under your key
 *   /domain claim example.org @<host>    — claim it on another host
 *   /domain wss://relay.example.com     — add a relay domain
 *   /domain ws://localhost:7777          — add a local relay
 *   /domain remove wss://relay.example.com — remove a relay domain
 *   /domain list                         — list all configured domains
 *   /domain clear                        — remove all domains
 *   /domain                              — list all configured domains
 *
 * CLAIMING A DOMAIN IS ONE WORD (documentation/domain-claim.md; jwize
 * 2026-10-01: "make it so: claim domain with one command"). The hive asks
 * its host (the public content host unless `@<host>` names another) for the
 * domain under the participant's key and toasts the two nameservers it
 * answers with — copied to the clipboard when the browser allows. Setting
 * them at the registrar is the whole proof. The hive keeps checking every
 * minute while it is open, and at every boot for a week; saying the word
 * again checks at once. When the host reads the domain active AND answers
 * the participant's own signed ask with it (the public reading never names
 * the key), it is theirs: it joins the hive's Hosts, so the Publish panel
 * offers it as a switch, and `domain:claimed` { domain } is emitted. The
 * logic is sharing/domain-claim.ts; this word only says what it reports.
 *
 * NOT A MODEL'S WORD. There is deliberately no `machine` block, so the model
 * channel refuses every form of this word by default (machine-admission.ts:
 * no declaration, no call) — `claim` above all, which signs under the
 * participant's key. That is all "participant only" means here, as for
 * `grant` and `trust`: the bridge's `submit` arrives as the 'operator' — the
 * participant's own tool, on their own machine — and is admitted like every
 * undeclared word, so whoever drives the bridge (scripts/bridge/manager.cjs
 * included) can claim. Refusing that door too needs an admission
 * declaration both callers honour, which does not exist yet.
 *
 * Relay domains are relay URLs that the mesh passively monitors.
 * Subscribe to a signature and the mesh fans out the request
 * to every known domain — whichever has matching events responds.
 */
export class DomainQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'domain'
  override description = 'Claim a domain with one word, or add, remove, or list mesh relay domains'
  override descriptionKey = 'slash.domain'
  override options = ['claim <domain> [@<host>]', '<ws:// or wss:// url>', 'remove <url>', 'list', 'clear']
  override examples = [
    { input: '/domain claim example.org', result: 'Claims the domain: set the two nameservers it names at your registrar' },
    { input: '/domain wss://relay.example.com', result: 'Adds the relay to the mesh' },
    { input: '/domain list', result: 'Lists configured relays with socket state' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    const all = ['claim ', 'list', 'remove ', 'clear']
    if (!q) return all
    return all.filter(word => word.startsWith(q) && word.trim() !== q)
  }

  protected async execute(args: string): Promise<void> {
    const trimmed = args.trim()

    // /domain claim <domain> [@<host>] — needs no mesh, only a host
    const claimMatch = trimmed.match(/^claim(?:\s+([\s\S]*))?$/i)
    if (claimMatch) {
      const parts = (claimMatch[1] ?? '').split(/\s+/).filter(Boolean)
      const at = parts.find(part => part.startsWith('@'))
      await claims.claim(parts.find(part => !part.startsWith('@')) ?? '', at)
      return
    }

    const mesh = get('@diamondcoreprocessor.com/NostrMeshDrone') as any
    if (!mesh) {
      console.warn('[/domain] Mesh not available')
      return
    }

    // no args or /domain list — show current domains
    if (!trimmed || trimmed.toLowerCase() === 'list') {
      this.#list(mesh)
      return
    }

    // /domain clear — remove all
    if (trimmed.toLowerCase() === 'clear') {
      mesh.configureRelays([], true)
      console.log('[/domain] All domains cleared')
      return
    }

    // /domain remove <url> — remove one
    const removeMatch = trimmed.match(/^remove\s+(.+)$/i)
    if (removeMatch) {
      const url = removeMatch[1].trim()
      this.#remove(mesh, url)
      return
    }

    // /domain <url> — add one
    this.#add(mesh, trimmed)
  }

  #list(mesh: any): void {
    const debug = mesh.getDebug?.()
    const relays: string[] = debug?.relays ?? []

    if (relays.length === 0) {
      console.log('[/domain] No domains configured')
      return
    }

    console.log(`[/domain] ${relays.length} domain(s):`)
    for (const url of relays) {
      const socket = debug?.sockets?.find((s: any) => s.url === url)
      const state = socket ? ['connecting', 'open', 'closing', 'closed'][socket.readyState] ?? 'unknown' : 'no socket'
      console.log(`  ${url}  (${state})`)
    }
  }

  #add(mesh: any, url: string): void {
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      console.warn(`[/domain] Invalid URL — must start with ws:// or wss://`)
      return
    }

    const debug = mesh.getDebug?.()
    const current: string[] = debug?.relays ?? []

    if (current.includes(url)) {
      console.log(`[/domain] Already configured: ${url}`)
      return
    }

    mesh.configureRelays([...current, url], true)
    console.log(`[/domain] Added: ${url}`)
  }

  #remove(mesh: any, url: string): void {
    const debug = mesh.getDebug?.()
    const current: string[] = debug?.relays ?? []
    const next = current.filter(u => u !== url)

    if (next.length === current.length) {
      console.log(`[/domain] Not found: ${url}`)
      return
    }

    mesh.configureRelays(next, true)
    console.log(`[/domain] Removed: ${url}`)
  }
}

// ── what a claim reports, said ─────────────────────────────────────

const say = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const value = (window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined)?.t?.(key, params)
  return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
}
const toast = (message: string, type: 'info' | 'success' | 'warning', duration?: number): void => {
  EffectBus.emit('toast:show', { type, message, ...(duration !== undefined ? { duration } : {}) })
}

const tell = (report: ClaimReport): void => {
  switch (report.kind) {
    case 'usage':
      toast(say('domain.claim.usage', 'Say domain claim <domain>, for example domain claim example.org — then set the two nameservers it names at your registrar.'), 'warning')
      return
    case 'invalid':
      toast(say('domain.claim.invalid', '{text} is not a domain name. Say domain claim example.org.', { text: report.text }), 'warning')
      return
    case 'badhost':
      toast(say('domain.claim.badhost', '{host} is not a host. Say domain claim <domain> @<host>, or leave the host out.', { host: report.host }), 'warning')
      return
    case 'pending': {
      const named = say('domain.claim.pending', 'To claim {domain}, set its nameservers at your registrar to {nameservers}. The hive keeps checking and tells you when it is yours.', { domain: report.domain, nameservers: report.nameservers.join(', ') })
      const copied = report.copied ? ` ${say('domain.claim.copied', 'The nameservers are on your clipboard.')}` : ''
      // Sticky: the participant is about to go and type these somewhere else.
      toast(named + copied, 'info', 0)
      return
    }
    case 'active':
      toast(say('domain.claim.active', '{domain} is yours. Any tile can be switched on there in the Publish panel.', { domain: report.domain }), 'success', 10_000)
      // The hosts drone is the community pool's one writer; it normalizes the zone.
      EffectBus.emit('hosts:add', { zone: report.domain })
      EffectBus.emit('domain:claimed', { domain: report.domain })
      return
    case 'contested':
      toast(say('domain.claim.contested', '{domain} is contested: another key claimed it too. Neither is bound until {host}\'s operator decides.', { domain: report.domain, host: report.host }), 'warning')
      return
    case 'refused':
      toast(say('domain.claim.refused', '{domain} was not claimed: {reason}', { domain: report.domain, reason: report.reason }), 'warning')
      return
    case 'unconfigured':
      toast(say('domain.claim.unconfigured', '{host} takes no domain claims.', { host: report.host }), 'warning')
      return
    case 'unsigned':
      toast(say('domain.claim.unsigned', 'There is no key here to claim {domain} with. Claim from the hive you publish from.', { domain: report.domain }), 'warning')
      return
    case 'unreachable':
      toast(say('domain.claim.unreachable', '{host} could not be reached about {domain}. Try again.', { domain: report.domain, host: report.host }), 'warning')
      return
    case 'failed':
      toast(say('domain.claim.failed', '{host} could not check {domain}: {reason}. Try again.', { domain: report.domain, host: report.host, reason: report.reason }), 'warning')
      return
    case 'lost':
      // `word` names the host whenever it is not the default, so saying it
      // goes back to where the claim was made.
      toast(say('domain.claim.lost', '{host} no longer holds a claim on {domain}: it lapsed or its operator removed it. Say {word} to claim it again.', { domain: report.domain, host: report.host, word: report.word }), 'warning')
      return
    case 'expired':
      toast(say('domain.claim.expired', 'Stopped checking {domain} after 7 days. Say {word} to check again.', { domain: report.domain, word: report.word }), 'info')
      return
    default: {
      const unsaid: never = report
      void unsaid
    }
  }
}

const claims = new DomainClaims(liveClaimIo(), tell, PUBLIC_CONTENT_HOSTS[0] ?? '')

const _domain = new DomainQueenBee()
window.ioc.register('@diamondcoreprocessor.com/DomainQueenBee', _domain)

// A CLAIM STILL WAITING IS ASKED ABOUT AT EVERY BOOT, and watched while the
// hive is open. Nothing kept, nothing asked: a hive with no claim pays one
// localStorage read. What it reports is said when the answer arrives, so the
// catalogs are read then, not now.
//
// ONCE THE TOASTS ARE LISTENING. A claim a week old is reported expired
// synchronously, here, and the bus replays only the LAST value to a late
// subscriber — so two expiring at one boot, before ToastDrone had subscribed
// (the dev shell loads this queen first), showed one toast and lost the
// other. ToastDrone subscribes in its constructor, before it registers.
//
// AND IT KEEPS HER AWAKE. This wait is the load-time act the build sees
// (scripts/passive-queen.ts): a queen whose module only registered herself
// would sleep until her word, and no claim would be asked about at boot.
// Keep it a plain call — the build does not read an optional one (`?.`).
window.ioc.whenReady('@diamondcoreprocessor.com/ToastDrone', () => {
  try { claims.resume() } catch { /* nothing kept */ }
})
