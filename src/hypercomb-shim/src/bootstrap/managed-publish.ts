// hypercomb-shim/src/bootstrap/managed-publish.ts
//
// A MANAGED SITE DOOR PUBLISHES ONE ROOT (jwize 2026-11-13: "The whole idea is
// we are upgrading something that we replicated"). The owner's marked browser
// at <name>.<zone>/@hypercomb holds a copy of the published card; when the copy
// has moved on, this puts the new head where every reader reads it.
//
// The page signs with ITS OWN listed key (device-invite.ts: `keys allow <this
// site>` on the hive, the link opened here, Allow) — never the publisher's
// secret, which never leaves its own browser. A host takes that key's writes as
// the publisher's because the publisher's key list names it, and an index the
// key signs says whose it is with `['anchor', <publisher>]`.
//
// WHERE: not the site door, which is read-only for everyone (worker.js, above
// every route). The worker tells the page the zone root whose store this site
// reads (manage-record.ts `writes`, worker.js writeFaceFor) — pluginthematrix.com
// for *.jwize.com, whose apex is the publisher's own relay. That is a hint, not
// an authority: before anything is written there, the write host must serve the
// very signed index this site door serves, the same event (essentials
// publish-branch.ts indexHome asks the same question). A host that serves some
// other index — another store, a stale copy, a stranger — is refused, and
// nothing is written anywhere.
//
// WHAT: device-owner.ts's read-change-sign, for one root. The new head's
// closure goes up first (layers, decorations, resources — signatures only, and
// only what the host does not already hold), then the publisher's index is read
// fresh at the write host and signed again changing ONLY roots[lineageKey], with
// every other field carried through, tagged ['anchor', A] and ['prev', <id>],
// and PUT; a 409 means another place wrote in between, so it is read and signed
// again. Last, the index is read back through this site door: the act is done
// when the site door names the head.
//
// The confirm dialog is the caller's (essentials site-manage asks it before it
// calls publishRoot); this module only does what was agreed to.

import { CHILD_SLOTS, isMetaEnvelope, isReferentField, lineageKey, metaPayloadOf } from '@hypercomb/core'
import { readDeviceBinding, type DeviceBinding } from './device-binding'
import { deviceSigner, type DeviceSigner } from './device-key'
import { carryChain, heldOn, putIndex, signIndex, uploadAtom } from './device-owner'
import { manageRecord, type ManageRecord } from './manage-record'
import { readOwnerIndex } from './showcase-record'

/** The ioc key the site-manage bar's Publish reaches this through. */
export const MANAGED_PUBLISH_KEY = '@hypercomb.social/ManagedPublish'

export type ManagedPublishResult = {
  readonly ok: boolean
  readonly error?: string
  /** The head the site door now names (or, on a read-back that has not caught up, the one written). */
  readonly head?: string
  /** False when the index already named this head and nothing was signed. */
  readonly changed?: boolean
  /** Atoms put on the write host. */
  readonly uploaded?: number
  /** Leaf references neither this browser nor the host holds — page links, a picture named in a data
   *  blob — carried as they are. A layer or a declared part that is missing refuses the publish. */
  readonly loose?: number
}

export type ManagedPublish = {
  publishRoot(lineage: string, layerSig: string): Promise<ManagedPublishResult>
}

const SIG = /^[0-9a-f]{64}$/
const CLOSURE_LIMIT = 5_000
const UPLOAD_CONCURRENCY = 4
const INDEX_TRIES = 3
const READ_BACK_TRIES = 5
const READ_BACK_PAUSE_MS = 1_500

// ── the closure ──────────────────────────────────────────────────────────────
//
// The same walk the hive's push makes (essentials sharing/host-sync.service.ts
// #enqueueLayerRefs + #enqueueResourceClosure, decoration-closure.ts), which a
// module cannot lend the shim: a layer's array slots (child slots are layers,
// every other slot a resource), a meta envelope's one payload, a decoration's
// declared parts (refs, a reference's bouquet, a page body and what it embeds),
// a data blob's nested signatures (never a referent field — core edge-registry).
// managed-publish.spec.ts holds it to the hive's on the same records.
// Code (bees, dependencies) is never carried from here: a card that declares
// code is refused on the way in (swarm-adopt), so a head that names some is
// not this page's to push.

export type ClosureKind = 'layer' | 'resource' | 'page' | 'leaf'

const CHILD_SLOT_SET: ReadonlySet<string> = new Set(CHILD_SLOTS)
const CODE_SLOTS: ReadonlySet<string> = new Set(['bees', 'dependencies'])

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
const sigOf = (raw: unknown): string => { const s = String(raw ?? '').trim().toLowerCase(); return SIG.test(s) ? s : '' }

const jsonObject = (bytes: Uint8Array): Record<string, unknown> | null => {
  for (const byte of bytes) {
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue
    if (byte !== 0x7b) return null
    break
  }
  try {
    const value = JSON.parse(decode(bytes)) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}

/** Every 64-hex run inside a value, never through a referent field. */
const sigsDeep = (value: unknown, out = new Set<string>()): Set<string> => {
  if (typeof value === 'string') { for (const run of value.toLowerCase().match(/[0-9a-f]{64}/g) ?? []) out.add(run); return out }
  if (Array.isArray(value)) { for (const item of value) sigsDeep(item, out); return out }
  if (value && typeof value === 'object') {
    for (const [field, item] of Object.entries(value as Record<string, unknown>)) if (!isReferentField(field)) sigsDeep(item, out)
  }
  return out
}

/** A page body's embedded parts: `resource:<sig>` anywhere, and bare-sig src/href/data-src attributes. */
const pageRefs = (text: string): string[] => {
  const out = new Set<string>()
  for (const m of text.matchAll(/resource:([0-9a-f]{64})/g)) out.add(m[1]!)
  for (const m of text.matchAll(/(?:src|href|data-src)=(["'])([0-9a-f]{64})\1/g)) out.add(m[2]!)
  return [...out]
}

const envelopeChild = (record: Record<string, unknown>): [string, ClosureKind] | null => {
  if (!isMetaEnvelope(record)) return null
  const payload = metaPayloadOf(record)
  if (!payload || payload.kind === 'bee' || payload.kind === 'dependency') return null
  return [payload.sig, payload.kind === 'layer' ? 'layer' : 'resource']
}

/** What an atom names that must travel with it, and as what. */
export const closureChildren = (kind: ClosureKind, bytes: Uint8Array): Array<[string, ClosureKind]> => {
  if (kind === 'leaf') return []
  if (kind === 'page') {
    const text = decode(bytes)
    return text.includes('�') ? [] : pageRefs(text).map(sig => [sig, 'leaf'])
  }
  const record = jsonObject(bytes)
  if (!record) return []
  const envelope = envelopeChild(record)
  if (envelope) return [envelope]
  if (kind === 'layer') {
    const out: Array<[string, ClosureKind]> = []
    for (const [slot, value] of Object.entries(record)) {
      if (!Array.isArray(value) || CODE_SLOTS.has(slot)) continue
      for (const raw of value) { const sig = sigOf(raw); if (sig) out.push([sig, CHILD_SLOT_SET.has(slot) ? 'layer' : 'resource']) }
    }
    return out
  }
  // A resource: a decoration declares its own parts; a signed event names none; a data blob is mined.
  const recordKind = record['kind']
  if (typeof recordKind === 'number') return []
  if (typeof recordKind === 'string') {
    // Identity only: no bytes stand behind a group's or a creation's signature.
    if (recordKind === 'group' || recordKind === 'creation') return []
    const refs = Array.isArray(record['refs']) ? record['refs'].map(sigOf).filter(Boolean) : []
    if (refs.length) return refs.map(sig => [sig, 'leaf'])
    const payload = record['payload'] && typeof record['payload'] === 'object' ? record['payload'] as Record<string, unknown> : {}
    if (recordKind === 'reference') { const bouquet = sigOf(payload['requiredBouquet']); return bouquet ? [[bouquet, 'leaf']] : [] }
    const html = sigOf(payload['htmlSig'])
    return html ? [[html, 'page']] : []
  }
  if (record['succession'] === 1) return (Array.isArray(record['members']) ? record['members'] : []).map(sigOf).filter(Boolean).map(sig => [sig, 'leaf'])
  return [...sigsDeep(record)].map(sig => [sig, 'leaf'])
}

/** Read this browser's copy of an atom by signature. Null when it holds none. */
export type LocalBytes = (sig: string) => Promise<Uint8Array | null>

export type ClosurePlan = {
  /** What the host lacks and this browser holds, deepest first (`depth` from the root, 0) — a host
   *  never holds a parent whose parts are still on the way, so "held" is safe to stop at, even after
   *  a publish that broke off halfway. */
  readonly put: ReadonlyArray<{ readonly sig: string; readonly bytes: Uint8Array; readonly depth: number }>
  readonly held: number
  /** A layer or a declared part held neither here nor there: the publish is refused. */
  readonly missing: readonly string[]
  readonly loose: readonly string[]
  readonly limited: boolean
}

/** Walk the closure of `root` against what `zone` already holds. An atom the host holds is not walked
 *  into: the publish that put it there carried what it names. */
export const planClosure = async (root: string, local: LocalBytes, zone: string, limit = CLOSURE_LIMIT): Promise<ClosurePlan> => {
  const seen = new Set([root])
  const queue: Array<[string, ClosureKind, number]> = [[root, 'layer', 0]]
  const put: Array<{ sig: string; bytes: Uint8Array; depth: number }> = []
  const missing: string[] = []
  const loose: string[] = []
  let held = 0
  let walked = 0
  while (queue.length && walked < limit) {
    const frontier = queue.splice(0, Math.min(UPLOAD_CONCURRENCY, limit - walked))
    walked += frontier.length
    await Promise.all(frontier.map(async ([sig, kind, depth]) => {
      if (await heldOn(zone, sig)) { held++; return }
      let bytes: Uint8Array | null = null
      try { bytes = await local(sig) } catch { bytes = null }
      if (!bytes) { (kind === 'leaf' ? loose : missing).push(sig); return }
      put.push({ sig, bytes, depth })
      for (const [child, childKind] of closureChildren(kind, bytes)) {
        if (seen.has(child)) continue
        seen.add(child)
        queue.push([child, childKind, depth + 1])
      }
    }))
  }
  return { put: put.sort((a, b) => b.depth - a.depth), held, missing, loose, limited: queue.length > 0 }
}

// ── the act ──────────────────────────────────────────────────────────────────

/** This browser's copy of an atom, from the store the runtime registered — reached structurally: a
 *  second Store module here would be a second instance over the same OPFS (build.mjs refuses one). */
type LocalStore = {
  getLayerPoolBytes?: (sig: string) => Promise<Uint8Array | null>
  getResourceLocal?: (sig: string) => Promise<Blob | null>
}

const storeBytes: LocalBytes = async sig => {
  const store = (globalThis as { ioc?: { get?: <T>(key: string) => T | undefined } }).ioc?.get?.<LocalStore>('@hypercomb.social/Store')
  if (!store) return null
  try { const layer = await store.getLayerPoolBytes?.(sig); if (layer) return layer } catch { /* a resource, perhaps */ }
  try { const blob = await store.getResourceLocal?.(sig); if (blob) return new Uint8Array(await blob.arrayBuffer()) } catch { /* held nowhere here */ }
  return null
}

export type ManagedPublishDeps = {
  readonly record?: () => ManageRecord | null
  readonly signer?: () => DeviceSigner | null
  readonly binding?: () => Promise<DeviceBinding | null>
  readonly local?: LocalBytes
  /** This site door's host, where readers read and the result is read back. */
  readonly siteDoor?: () => string
  readonly pause?: (ms: number) => Promise<void>
  /** Is a person's gesture live right now? (navigator.userActivation) */
  readonly hand?: () => boolean
}

/** A live user gesture, as the browser reports it. A browser without the API
 *  (none current) is not refused: the bar's confirm dialog still stands. */
const ownersHand = (): boolean => {
  const activation = (globalThis.navigator as { userActivation?: { isActive: boolean } } | undefined)?.userActivation
  return activation ? activation.isActive : true
}

const short = (key: string): string => `${key.slice(0, 8)}…`
const rootsOf = (content: Record<string, unknown>): Record<string, string> =>
  content['roots'] && typeof content['roots'] === 'object' && !Array.isArray(content['roots']) ? content['roots'] as Record<string, string> : {}

/** One root's publish from this page, as the page's own listed key. Never throws; the reasons are said
 *  to a person. One at a time: each is a read-change-sign of the same index. */
export const managedPublish = (deps: ManagedPublishDeps = {}): ManagedPublish => {
  const recordOf = deps.record ?? (() => manageRecord())
  const signerOf = deps.signer ?? (() => deviceSigner(false))
  const bindingOf = deps.binding ?? readDeviceBinding
  const local = deps.local ?? storeBytes
  const siteDoorOf = deps.siteDoor ?? (() => location.host.toLowerCase())
  const pause = deps.pause ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const handOf = deps.hand ?? ownersHand

  const run = async (lineage: string, layerSig: string): Promise<ManagedPublishResult> => {
    // THE OWNER'S HAND, NEVER THE MODEL'S (jwize, 2026-11-13: "AI can't publish
    // on the community but it can make changes"). On this page the AI may write
    // and run code, and code can reach this service through ioc — so the
    // service itself asks for a live user gesture: the owner's tap (the bar's
    // Publish, then the consent dialog's yes) carries one; code running on its
    // own does not.
    if (!handOf()) return { ok: false, error: 'publishing takes your own tap' }
    const head = String(layerSig ?? '').trim().toLowerCase()
    if (!SIG.test(head)) return { ok: false, error: 'that is not a layer signature' }
    const segments = String(lineage ?? '').split('/').map(s => s.trim()).filter(Boolean)
    const key = lineageKey(segments)
    if (!key || key.length > 200) return { ok: false, error: 'that is not a place' }
    const record = recordOf()
    if (!record) return { ok: false, error: 'this page is not a managed site door' }
    const publisher = record.publisher
    if (!publisher) return { ok: false, error: 'this site names no publisher' }
    const writes = record.writes
    if (!writes) return { ok: false, error: 'the host did not say where this site\'s publish is written' }
    const siteDoor = siteDoorOf()
    const signer = signerOf()
    if (!signer) return { ok: false, error: `this browser holds no key yet: run "keys allow ${siteDoor}" on your hive and open the link here` }
    const binding = await bindingOf().catch(() => null)
    if (!binding || binding.anchor !== publisher) {
      return { ok: false, error: binding
        ? `this browser publishes for ${short(binding.anchor)}, and this site is ${short(publisher)}'s`
        : `this browser is not on ${short(publisher)}'s key list: run "keys allow ${siteDoor}" on your hive and open the link here` }
    }
    // The host has the list naming this key before it is asked to take anything this key signs.
    if (!await carryChain(writes, binding, signer).catch(() => false)) {
      return { ok: false, error: `${writes} does not hold your key list with this browser on it` }
    }

    // THE WRITE HOST IS THE STORE THIS SITE READS: the same signed event at both, or nothing is written.
    const [seen, there] = await Promise.all([readOwnerIndex(siteDoor, publisher), readOwnerIndex(writes, publisher)])
    if (!seen || seen === 'missing') return { ok: false, error: `could not read the index ${siteDoor} serves` }
    if (!there || there === 'missing') return { ok: false, error: `${writes} holds no index of ${short(publisher)}'s; nothing was written` }
    if (String(there.event['id'] ?? '') !== String(seen.event['id'] ?? '')) {
      return { ok: false, error: `${writes} does not serve the index ${siteDoor} reads; nothing was written` }
    }
    if (String(rootsOf(there.content)[key] ?? '').toLowerCase() === head) return { ok: true, head, changed: false, uploaded: 0 }

    // THE BYTES FIRST: the index only ever names a head its readers can open.
    const plan = await planClosure(head, local, writes)
    if (plan.limited) return { ok: false, error: `this version names more than ${CLOSURE_LIMIT} pieces` }
    if (plan.missing.length) {
      return { ok: false, error: `${plan.missing.length} piece${plan.missing.length === 1 ? '' : 's'} of this version (${short(plan.missing[0]!)}) are held neither in this browser nor on ${writes}` }
    }
    // A few at a time, never a parent beside its own parts: one depth finishes before the next begins.
    for (let at = 0; at < plan.put.length;) {
      const depth = plan.put[at]!.depth
      let end = at
      while (end < plan.put.length && end - at < UPLOAD_CONCURRENCY && plan.put[end]!.depth === depth) end++
      const refused = (await Promise.all(plan.put.slice(at, end)
        .map(atom => uploadAtom(writes, atom.bytes, atom.sig, publisher, signer, `part ${short(atom.sig)}`, 'held')))).find(Boolean)
      if (refused) return { ok: false, error: refused }
      at = end
    }

    // ONE ROOT CHANGES: read fresh, carry every other field, sign, PUT; another place's write in between
    // (409) is read and signed again.
    let written = false
    for (let tries = 0; tries < INDEX_TRIES && !written; tries++) {
      const read = await readOwnerIndex(writes, publisher)
      if (!read || read === 'missing') return { ok: false, error: `could not read your index on ${writes}` }
      const roots = rootsOf(read.content)
      if (String(roots[key] ?? '').toLowerCase() === head) { written = true; break }
      const event = signIndex(signer, publisher, read.event, { ...read.content, roots: { ...roots, [key]: head } })
      const put = await putIndex(writes, publisher, event, signer)
      if (put === 'stale') continue
      if (put) return { ok: false, error: put }
      written = true
    }
    if (!written) return { ok: false, error: 'your index kept changing underneath; try again' }

    // DONE WHEN THE SITE SAYS SO: read back through this site door.
    for (let tries = 0; tries < READ_BACK_TRIES; tries++) {
      if (tries) await pause(READ_BACK_PAUSE_MS)
      const back = await readOwnerIndex(siteDoor, publisher)
      if (back && back !== 'missing' && String(rootsOf(back.content)[key] ?? '').toLowerCase() === head) {
        return { ok: true, head, changed: true, uploaded: plan.put.length, ...(plan.loose.length ? { loose: plan.loose.length } : {}) }
      }
    }
    return { ok: false, head, uploaded: plan.put.length, error: `${writes} took it, but ${siteDoor} does not show it yet; look again in a moment` }
  }

  let lane: Promise<unknown> = Promise.resolve()
  return {
    publishRoot: (lineage, layerSig) => {
      const next = lane.then(() => run(lineage, layerSig)).catch((): ManagedPublishResult => ({ ok: false, error: 'the publish failed' }))
      lane = next
      return next
    },
  }
}

/** On a managed site door, lend the act to the page's bees (essentials site-manage's Publish). */
export const registerManagedPublish = (): void => {
  if (!manageRecord()) return
  const ioc = (globalThis as { ioc?: { get?: (key: string) => unknown; register?: (key: string, value: unknown) => void } }).ioc
  if (!ioc?.register || ioc.get?.(MANAGED_PUBLISH_KEY)) return
  ioc.register(MANAGED_PUBLISH_KEY, managedPublish())
}
