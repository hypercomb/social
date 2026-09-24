// safety/brood-risk.ts
//
// HOW RISKY IS WHAT THE BROOD HOLDS — one level and its reasons, composed by
// code from what the brood already knows (jwize, 2026-09-23: "do llm scans
// and JEV scans on the brood and then give a risk level"). The readers list
// and JEV judges; this only composes, so the level can never say more than
// they did:
//   · the SCAN — what the code reaches (core code-reach.ts), on a flag the
//     draft door placed or an audit `brood scan` recorded;
//   · the READINGS — each reader's recommendation, JEV's among them;
//   · a community you follow that refused it.
// HIGH: it reaches secrets and keys, runs text as code or is disguised, or
// anyone recommends refusing it. MEDIUM: it reaches the network, stored data
// or a way out of the page, or a reader could not tell. LOW: read, accepted,
// and reaching nothing of the kind. UNREAD: nothing has read it yet.
//
// A level is advice, like every reading: only the hand lets held code run.

import { reachPhrase, type BroodRecord, type CodeReach } from '@hypercomb/core'

export type BroodRiskLevel = 'high' | 'medium' | 'low' | 'unread'
export type BroodRisk = { readonly level: BroodRiskLevel; readonly reasons: readonly string[] }

/** Reaches that alone make code high risk. */
const GRAVE: readonly CodeReach[] = ['secrets', 'eval', 'disguise']

const readerName = (by: string): string => (by === 'jev' ? 'JEV' : by)

export const riskOf = (record: BroodRecord): BroodRisk => {
  const reaches = new Set<CodeReach>()
  for (const flag of record.flags ?? []) for (const reach of flag.reaches ?? []) reaches.add(reach)
  for (const audit of record.audits) for (const reach of audit.reaches ?? []) reaches.add(reach)
  const grave = [...reaches].filter(reach => GRAVE.includes(reach))
  const other = [...reaches].filter(reach => !GRAVE.includes(reach))

  const readings = record.audits.filter(audit => audit.by !== 'scan')
  // A reader that held it (a flag placed by a reading) refused it as surely
  // as one that only said so.
  const refusers = new Set([
    ...readings.filter(audit => audit.recommends === 'refuse').map(audit => audit.by),
    ...(record.flags ?? []).filter(flag => flag.by !== 'scan').map(flag => flag.by),
  ])
  const communityRefused = record.vouches.some(vouch => vouch.verdict === 'refused')

  const reasons: string[] = []
  if (grave.length) reasons.push(`it reaches ${reachPhrase(grave)}`)
  for (const by of refusers) reasons.push(`${readerName(by)} recommends refusing it`)
  if (communityRefused) reasons.push('a community you follow refused it')
  if (reasons.length) {
    if (other.length) reasons.push(`it reaches ${reachPhrase(other)}`)
    return { level: 'high', reasons }
  }
  if (other.length) reasons.push(`it reaches ${reachPhrase(other)}`)
  if (readings.some(audit => audit.recommends === 'unclear')) reasons.push('a reader could not tell')
  if (reasons.length) return { level: 'medium', reasons }
  const accepted = readings.filter(audit => audit.recommends === 'accept')
  if (accepted.length) return { level: 'low', reasons: [`${readerName(accepted.at(-1)!.by)} read it and found nothing of concern`] }
  const scanned = record.audits.some(audit => audit.by === 'scan')
  return { level: 'unread', reasons: [scanned ? 'the scan found nothing it looks for; no reader yet' : 'nothing has read it yet'] }
}

const LEVEL_WORD: Readonly<Record<BroodRiskLevel, string>> = { high: 'High', medium: 'Medium', low: 'Low', unread: 'Unread' }

/** "High — it reaches secrets and keys; JEV recommends refusing it". */
export const riskLine = (risk: BroodRisk): string => `${LEVEL_WORD[risk.level]} — ${risk.reasons.join('; ')}`
