// sharing/serve.queen.ts
//
// `serve` — YOUR DOMAIN OPENS YOUR PAGE (jwize 2026-10-18: free self-hosting
// through a tunnel; "domain opens your page" first).
//
//   serve at alice.example.com      the page you stand on opens there
//   serve off alice.example.com     that domain opens nothing any more
//
// THE DOOR. A domain's bag, sign(<hostname>), holds `host:activation` layers
// (hypercomb-runtime host-activation.ts); the newest names the head a visitor
// opens. This machine's host (Hive ▸ Serve This Hive, hypercomb-serve) reads
// the Host a request names, finds that door, and answers with the visitor
// shell carrying it — exactly as the Cloudflare worker does for a published
// site. A tunnel in front puts the domain on the internet.
//
// SEALED, NOT LIVE. The door names the page SEALED as it is now
// (history sealSubtree, as publishing does), so a visitor walks its current
// children — never the older generation a parent still carries. Say the word
// again after changing the page. The participant says it; a model may not
// (no machine grammar): pointing a domain at a page faces outward.
//
// Essentials imports only core, so the door is written here with core's
// primitives, in the runtime's exact shape; host-activation.spec in the
// runtime reads what this writes (serve.queen.spec.ts).

import {
  EffectBus, get, HOME_MOLECULE_NAME, QueenBee, SignatureService,
  canonicalLayerJson, latestLayerMarker, writeLayerMarker,
} from '@hypercomb/core'
import { publisherKeyHex } from './key-list.client.js'

const SIG_RE = /^[0-9a-f]{64}$/
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** The door layer — `HostActivation` in hypercomb-runtime host-activation.ts. */
export type DoorActivation = {
  name: 'host:activation'
  enabled: boolean
  pubkey: string
  lineage: string
  sourceRoute: string
  localRoute: string
  head: string
  source: string
}

export type DoorStore = {
  opfsRoot: FileSystemDirectoryHandle
  writeLayerBytes(sig: string, bytes: ArrayBuffer): Promise<void>
  getLayerPoolBytes(sig: string): Promise<Uint8Array | null>
}

/** `https://Alice.Example.com:443/x` → `alice.example.com`; anything that is
 *  not a plain hostname → ''. The same reading as the runtime's
 *  `hostRouteName` and the host's Host header. */
export const doorHost = (raw: unknown): string => {
  let value = String(raw ?? '').trim().toLowerCase()
  if (value.includes('://')) {
    try { value = new URL(value).hostname } catch { return '' }
  }
  value = value.split(/[/?#]/)[0] ?? ''
  const port = /:(\d{1,5})$/.exec(value)
  if (port) value = value.slice(0, -port[0].length)
  value = value.replace(/\.+$/, '')
  return value.length <= 253 && value.split('.').every(label => LABEL_RE.test(label)) ? value : ''
}

const bytesOf = (layer: DoorActivation | { name: string }): Uint8Array =>
  new TextEncoder().encode(canonicalLayerJson(layer as Parameters<typeof canonicalLayerJson>[0]))
const signBytes = (bytes: Uint8Array): Promise<string> =>
  SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

/** The door a domain opens now, or null. */
export const readDoor = async (store: DoorStore, domain: string): Promise<DoorActivation | null> => {
  const host = doorHost(domain)
  if (!host) return null
  let bag: FileSystemDirectoryHandle
  try {
    bag = await store.opfsRoot.getDirectoryHandle(await signBytes(new TextEncoder().encode(host)), { create: false })
  } catch { return null }
  const latest = await latestLayerMarker(bag)
  if (!latest) return null
  const bytes = await store.getLayerPoolBytes(latest.layer)
  if (!bytes) return null
  try {
    const layer = JSON.parse(new TextDecoder().decode(bytes)) as DoorActivation
    return layer?.name === 'host:activation' && layer.localRoute === host ? layer : null
  } catch { return null }
}

/** Append the door's next revision — `commitLocationLayer`'s steps: an
 *  empty first revision when the bag is new, the layer bytes before the
 *  marker that names them, nothing when the head already says this. */
export const writeDoor = async (store: DoorStore, door: DoorActivation): Promise<string> => {
  const bytes = bytesOf(door)
  const sig = await signBytes(bytes)
  const location = await signBytes(new TextEncoder().encode(door.localRoute))
  const bag = await store.opfsRoot.getDirectoryHandle(location, { create: true })
  let current = await latestLayerMarker(bag)
  if (!current) {
    const empty = bytesOf({ name: door.name })
    const emptySig = await signBytes(empty)
    await store.writeLayerBytes(emptySig, empty.buffer as ArrayBuffer)
    await writeLayerMarker(bag, emptySig, '00000000')
    current = { name: '00000000', layer: emptySig }
  }
  if (current.layer === sig) return sig
  await store.writeLayerBytes(sig, bytes.buffer as ArrayBuffer)
  await writeLayerMarker(bag, sig)
  return sig
}

type SealHistory = { sealSubtree(segments: readonly string[]): Promise<string | null> }
type Signer = { getPublicKeyHex(): Promise<string | null | undefined> }
type LineageLike = { explorerSegments?: () => readonly string[] }

export class ServeQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'serve'
  override description = 'Serve the page you are on at a domain this computer hosts — the domain opens it (Hive ▸ Serve This Hive, a tunnel in front)'
  override descriptionKey = 'slash.serve'
  override options = ['at <domain>', 'off <domain>']
  override examples = [
    { input: '/serve at alice.example.com', result: 'alice.example.com opens this page, sealed as it is now' },
    { input: '/serve off alice.example.com', result: 'alice.example.com opens nothing any more' },
  ]
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const words = args.trim().split(/\s+/).filter(Boolean)
    const off = words[0]?.toLowerCase() === 'off'
    if (words[0]?.toLowerCase() === 'at' || off) words.shift()
    const raw = words.join(' ')
    if (!raw) {
      this.#say(this.#t('serve.usage', 'Serve: say the domain — "serve at alice.example.com", or "serve off alice.example.com"'))
      return
    }
    const domain = doorHost(raw)
    if (!domain) { this.#say(this.#t('serve.bad-domain', '"{domain}" is not a domain', { domain: raw })); return }

    const store = get<DoorStore>('@hypercomb.social/Store')
    if (!store?.opfsRoot) { this.#say(this.#t('serve.failed', 'Could not serve {page}: {reason}', { page: domain, reason: 'no store' })); return }

    if (off) {
      const current = await readDoor(store, domain)
      if (!current?.enabled) { this.#say(this.#t('serve.not-serving', '{domain} opens nothing here', { domain })); return }
      await writeDoor(store, { ...current, enabled: false })
      this.#say(this.#t('serve.off', '{domain} no longer opens a page', { domain }))
      return
    }

    const segments = [...(get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
    const page = segments.length ? segments.join('/') : HOME_MOLECULE_NAME
    const history = get<SealHistory>('@diamondcoreprocessor.com/HistoryService')
    const signer = get<Signer>('@diamondcoreprocessor.com/NostrSigner')
    const pubkey = await publisherKeyHex()
    if (!SIG_RE.test(pubkey)) { this.#say(this.#t('serve.failed', 'Could not serve {page}: {reason}', { page, reason: 'no signing key' })); return }
    const head = String((await history?.sealSubtree?.(segments).catch(() => null)) ?? '').toLowerCase()
    if (!SIG_RE.test(head)) { this.#say(this.#t('serve.failed', 'Could not serve {page}: {reason}', { page, reason: 'it could not be sealed — visit its tiles once' })); return }

    await writeDoor(store, {
      name: 'host:activation',
      enabled: true,
      pubkey,
      lineage: page,
      sourceRoute: `https://${domain}/`,
      localRoute: domain,
      head,
      source: domain,
    })
    this.#say(this.#t('serve.on', '{domain} now opens {page}, sealed as it is now — say it again after changes', { domain, page }))
  }

  #t(key: string, fallback: string, params?: Record<string, unknown>): string {
    const i18n = get<{ t(k: string, p?: Record<string, unknown>): string }>('@hypercomb.social/I18n')
    const text = i18n?.t?.(key, params)
    if (text && text !== key) return text
    return fallback.replace(/\{(\w+)\}/g, (all, token: string) => params && token in params ? String(params[token]) : all)
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '⌂' })
  }
}

const _serve = new ServeQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ServeQueenBee', _serve)
