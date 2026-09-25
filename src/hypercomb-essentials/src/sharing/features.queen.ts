// sharing/features.queen.ts
//
// `features` — which features exist only for participants.
//
//   features                          list them
//   features participant <name…>      readers of your sites never load these
//   features everyone <name…>         give them back to every reader
//   features publish [host]           send the set, signed, to your host
//
// The set is the `features:participant` pool (participant-features.ts); the
// publish folds it into one snapshot and names it in your signed index.

import { EffectBus, QueenBee } from '@hypercomb/core'
import { setHiveRoot } from './hive-pointer.js'
import { PUBLIC_CONTENT_HOSTS } from './hive-link.js'
import {
  PARTICIPANT_FEATURES_POINTER,
  addParticipantFeature,
  listParticipantFeatures,
  participantSnapshot,
  removeParticipantFeature,
} from './participant-features.js'

type HostSyncLike = {
  publishAtoms?: (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) =>
    Promise<{ ok: true } | { ok: false; error: string }>
}

const say = (type: string, message: string): void => {
  EffectBus.emit('toast:show', { type, title: 'features', message, duration: 6000 })
}

export class FeaturesQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'features'
  override description = 'Which features exist only for participants — readers of your published sites never load them'
  override examples = [
    { input: 'features', result: 'Lists the participant-only features' },
    { input: 'features participant assistant editor', result: 'Readers of your sites never load the assistant or the editor' },
    { input: 'features everyone editor', result: 'Gives the editor back to every reader' },
    { input: 'features publish', result: 'Sends the set, signed, to your host' },
  ]

  protected async execute(args: string): Promise<void> {
    const [verb = '', ...rest] = args.trim().split(/\s+/).filter(Boolean)
    if (verb === 'participant') {
      const added = (await Promise.all(rest.map(addParticipantFeature))).filter(Boolean)
      say(added.length ? 'success' : 'warning', added.length
        ? `Participant-only: ${added.join(', ')}. Run "features publish" to tell your readers.`
        : 'Name a feature by its layer name, e.g. "features participant assistant".')
      return
    }
    if (verb === 'everyone') {
      const given = rest.filter(Boolean)
      for (const name of given) await removeParticipantFeature(name)
      say('success', `Back for every reader: ${given.join(', ') || 'nothing named'}. Run "features publish" to tell them.`)
      return
    }
    if (verb === 'publish') {
      await this.#publish(rest[0] || PUBLIC_CONTENT_HOSTS[0] || '')
      return
    }
    const names = await listParticipantFeatures()
    say('info', names.length ? `Participant-only: ${names.join(', ')}` : 'No feature is participant-only yet.')
  }

  async #publish(host: string): Promise<void> {
    if (!host) { say('error', 'No host to publish to.'); return }
    const names = await listParticipantFeatures()
    const snapshot = participantSnapshot(names)
    const sig = await snapshot.sigOf()
    const sync = window.ioc?.get?.('@diamondcoreprocessor.com/HostSyncService') as HostSyncLike | undefined
    if (!sync?.publishAtoms) { say('error', 'Host sync is not available here.'); return }
    const sent = await sync.publishAtoms(host, [sig], async wanted => (wanted === sig ? snapshot.bytes : null))
    if (!sent.ok) { say('error', `The set could not be sent to ${host}: ${sent.error}`); return }
    const stamped = await setHiveRoot(host, PARTICIPANT_FEATURES_POINTER, sig)
    if (!stamped.ok) { say('error', `Your index on ${host} refused it: ${stamped.reason ?? 'unknown'}`); return }
    say('success', `Published to ${host}: readers of your sites skip ${names.length ? names.join(', ') : 'nothing'}.`)
  }
}

const _features = new FeaturesQueenBee()
window.ioc.register('@diamondcoreprocessor.com/FeaturesQueenBee', _features)
