// sharing/arrival.queen.ts
//
// `arrival` — what a published branch's first view needs, and nothing more.
//
//   arrival <lineage> <Class…>   the arrival loads these bees (and what they
//                                declare they read); the rest wake when the
//                                reader steps into the hive
//   arrival <lineage> none       withdraw it — the whole package loads again
//
// The plan is a record `{ arrive: [IoC keys] }`, content-addressed, sent to
// your host under your key and named in your signed index as
// `plan:<lineage>` (hypercomb-runtime arrival-plan.ts reads it). Names are IoC
// keys, which survive every rebuild of the package; a bare class name is taken
// as `@diamondcoreprocessor.com/<Class>`.

import { EffectBus, QueenBee, SignatureService } from '@hypercomb/core'
import { clearHiveRoot, setHiveRoot } from './hive-pointer.js'
import { PUBLIC_CONTENT_HOSTS } from './hive-link.js'

type HostSyncLike = {
  publishAtoms?: (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) =>
    Promise<{ ok: true } | { ok: false; error: string }>
}

const say = (type: string, message: string): void => {
  EffectBus.emit('toast:show', { type, title: 'arrival', message, duration: 6000 })
}

/** A lineage as the signed index keys it: lower-case segments joined by `/`. */
const lineageOf = (raw: string): string =>
  raw.trim().toLowerCase().split('/').map(s => s.trim()).filter(Boolean).join('/')

const keyOf = (raw: string): string => {
  const name = raw.trim()
  if (!name) return ''
  if (name.startsWith('@')) return name
  return /^[A-Za-z][A-Za-z0-9]*$/.test(name) ? `@diamondcoreprocessor.com/${name}` : ''
}

export class ArrivalQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'arrival'
  override description = 'Name what a published branch\'s first view loads — the rest waits until the reader steps into the hive'
  override examples = [
    { input: 'arrival revolucion ViewBee WebsiteQueenBee SiteViewDrone', result: 'revolucion arrives on three bees' },
    { input: 'arrival revolucion none', result: 'revolucion loads its whole package again' },
  ]

  protected async execute(args: string): Promise<void> {
    const [branch = '', ...names] = args.trim().split(/\s+/).filter(Boolean)
    const lineage = lineageOf(branch)
    const host = PUBLIC_CONTENT_HOSTS[0] ?? ''
    if (!lineage || !host) { say('warning', 'Name the branch and the bees: "arrival revolucion ViewBee SiteViewDrone".'); return }
    const pointer = `plan:${lineage}`

    if (names.length === 1 && names[0]!.toLowerCase() === 'none') {
      const cleared = await clearHiveRoot(host, pointer)
      say(cleared.ok ? 'success' : 'error', cleared.ok
        ? `${lineage} loads its whole package again.`
        : `Your index on ${host} refused it: ${cleared.reason ?? 'unknown'}`)
      return
    }

    const keys = [...new Set(names.map(keyOf).filter(Boolean))]
    if (!keys.length) { say('warning', 'Name at least one bee by its class or IoC key.'); return }
    const bytes = new TextEncoder().encode(JSON.stringify({ arrive: keys }))
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
    const sync = window.ioc?.get?.('@diamondcoreprocessor.com/HostSyncService') as HostSyncLike | undefined
    if (!sync?.publishAtoms) { say('error', 'Host sync is not available here.'); return }
    const sent = await sync.publishAtoms(host, [sig], async wanted => (wanted === sig ? bytes : null))
    if (!sent.ok) { say('error', `The plan could not be sent to ${host}: ${sent.error}`); return }
    const stamped = await setHiveRoot(host, pointer, sig)
    if (!stamped.ok) { say('error', `Your index on ${host} refused it: ${stamped.reason ?? 'unknown'}`); return }
    say('success', `${lineage} arrives on ${keys.length} bee${keys.length === 1 ? '' : 's'}; the rest wakes in the hive.`)
  }
}

const _arrival = new ArrivalQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ArrivalQueenBee', _arrival)
