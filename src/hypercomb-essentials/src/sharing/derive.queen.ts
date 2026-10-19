// sharing/derive.queen.ts
//
// `derive` — read a derivation, re-derive it here, or say what you found
// (documentation/derivations.md).
//
//   derive @<host>                       what the host's sites run, what it was
//                                        derived from, and who has verified it
//   derive <record> @<host>              the same, for one derivation record
//   derive verify [<record>] @<host>     re-derive it in this hive with this
//                                        shell's own esbuild, and sign what came
//                                        out: `attest:<record>` in your index
//   derive attest <record> reproduced|differs @<host>
//                                        sign what a terminal verification found
//                                        (verify-minified-package.mjs --host)
//
// There is no default host (jwize 2026-10-11): a word with no @<host> reads
// nothing and signs nothing.

import { EffectBus, QueenBee } from '@hypercomb/core'
import { zoneDoor } from './zone-door.js'
import { publishAttestation, readAttestations, type AttestationOutcome } from './derivation-attestation.js'
import { readDerivationRecord, servedDerivation, verifyDerivation } from './derive-verify.js'

const SIG_RE = /^[a-f0-9]{64}$/
const short = (sig: string): string => `${sig.slice(0, 12)}…`

const say = (message: string): void => { EffectBus.emit('activity:log', { message, icon: 'verified' }) }
const tell = (type: 'success' | 'warning' | 'error' | 'info', message: string): void => {
  EffectBus.emit('toast:show', { type, title: 'derive', message, duration: 8000 })
}

/** The words of a `derive` line: its verb, record, outcome and host. */
export const parseDeriveArgs = (args: string): {
  verb: 'read' | 'verify' | 'attest'
  record: string
  outcome: AttestationOutcome | ''
  host: string
} => {
  const parts = args.trim().split(/\s+/).filter(Boolean)
  const host = zoneDoor(parts.find(part => part.startsWith('@'))?.slice(1) ?? '')
  const words = parts.filter(part => !part.startsWith('@')).map(part => part.toLowerCase())
  const verb = words[0] === 'verify' ? 'verify' : words[0] === 'attest' ? 'attest' : 'read'
  const record = words.find(word => SIG_RE.test(word)) ?? ''
  const outcome = words.includes('reproduced') ? 'reproduced' : words.includes('differs') ? 'differs' : ''
  return { verb, record, outcome, host }
}

export class DeriveQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'derive'
  override description = 'Read a derivation and who verified it, re-derive it here, or sign what you found'
  override options = ['@<host>', '<record> @<host>', 'verify @<host>', 'verify <record> @<host>', 'attest <record> reproduced @<host>', 'attest <record> differs @<host>']
  override examples = [
    { input: 'derive @example.com', result: 'What the sites there run was derived from, and who has verified it' },
    { input: 'derive verify @example.com', result: 'Re-derive it in this hive, and sign what came out' },
    { input: 'derive attest <record> reproduced @example.com', result: 'Sign what a terminal verification found' },
  ]

  protected async execute(args: string): Promise<void> {
    const { verb, record: named, outcome, host } = parseDeriveArgs(args)
    if (!host) { tell('warning', 'Name the host: derive @example.com, derive verify @example.com.'); return }

    let record = named
    if (!record) {
      const served = await servedDerivation(host)
      if (!served) { tell('warning', `${host} runs no derived package — name a derivation record.`); return }
      record = served.record
      say(`derive: ${host} runs ${short(served.root)}, derived by record ${short(record)}`)
    }

    if (verb === 'attest') {
      if (!outcome) { tell('warning', 'Say what you found: derive attest <record> reproduced (or differs) @<host>.'); return }
      const signed = await publishAttestation(host, record, outcome)
      if (!signed.ok) { tell('error', `Your attestation was not signed: ${signed.reason}`); return }
      tell('success', `You attested ${short(record)}: ${outcome}.`)
      return
    }

    if (verb === 'verify') {
      say(`derive: re-deriving ${short(record)} from what ${host} serves…`)
      const result = await verifyDerivation(host, record)
      if (!result.ok) { tell('warning', result.reason); return }
      say(`derive: ${result.modules} modules with ${result.ran} — ${result.outcome === 'reproduced' ? 'the same record came out' : `a different record came out (${short(result.got)})`}`)
      const signed = await publishAttestation(host, record, result.outcome, { got: result.got, ran: result.ran })
      if (!signed.ok) { tell('error', `${result.outcome} — but your attestation was not signed: ${signed.reason}`); return }
      tell(result.outcome === 'reproduced' ? 'success' : 'warning', `${short(record)} ${result.outcome}; your attestation is signed.`)
      return
    }

    const body = await readDerivationRecord(host, record)
    if (!body) { tell('warning', `${host} does not serve the record ${short(record)}.`); return }
    say(`derive: ${short(record)} is a "${body.kind}" derivation of ${short(body.from)} with ${body.tool}, ${Object.keys(body.modules ?? {}).length} modules`)
    const attestations = await readAttestations(host, record)
    const reproduced = attestations.filter(a => a.attestation.outcome === 'reproduced').length
    const differs = attestations.length - reproduced
    say(attestations.length
      ? `derive: ${attestations.length} attestation${attestations.length === 1 ? '' : 's'} — ${reproduced} reproduced, ${differs} differ${differs === 1 ? 's' : ''}`
      : 'derive: nobody has attested it yet — derive verify re-runs it here')
    for (const a of attestations) say(`derive:   ${short(a.pubkey)} ${a.attestation.outcome}${a.attestation.ran ? ` (${a.attestation.ran})` : ''}`)
  }
}

const _derive = new DeriveQueenBee()
window.ioc.register('@diamondcoreprocessor.com/DeriveQueenBee', _derive)
