// safety/brood-accept.ts
//
// THE HAND, ONCE — so the word and the surface cannot drift apart.
//
// `acceptIntoHive` refuses unless it is given two DISTINCT warnings that were
// shown and dismissed (core/brood.ts). This is where they are actually shown:
// two confirmations, in order, each saying a different true thing, and either
// one declined leaves the code held. The ids passed to the core call are the
// warnings the participant actually saw, so the record says what they were
// told, not merely that they clicked twice.
//
// The second warning exists because of a specific failure mode: an audit that
// came back clean reads like an approval. It is not one. A model read the code
// and said what it saw; no model, agent or community can accept on the
// participant's behalf, and the second dialog is where that is said out loud.

import { acceptIntoHive, refuseInBrood, requestConfirm, type BroodRecord } from '@hypercomb/core'

export const WARNING_NOT_SAFE = 'not-safe'
export const WARNING_AUDIT_IS_NOT_APPROVAL = 'audit-is-not-approval'

const short = (sig: string): string => sig.slice(0, 12)

/** How this automaton is named to a person: what it called itself, else its
 *  signature — never nothing. */
export const broodLabel = (record: BroodRecord): string => record.name?.trim() || short(record.sig)

const whereFrom = (record: BroodRecord): string =>
  record.source.zone?.trim() || record.source.packageSig?.slice(0, 12) || 'an unnamed source'

/** What the last reader made of it, in one line — or that nobody has read it. */
export const auditLine = (record: BroodRecord): string => {
  const last = record.audits.at(-1)
  if (!last) return 'Nothing has read this code yet.'
  return `${last.by} read it and says: ${last.summary}${last.recommends ? ` (${last.recommends})` : ''}`
}

/**
 * Ask twice, then let it run. Returns the updated record, or null when the
 * participant stopped at either dialog — in which case nothing was written and
 * the code stays exactly as held as it was.
 */
export const acceptByHand = async (record: BroodRecord): Promise<BroodRecord | null> => {
  const name = broodLabel(record)

  const first = await requestConfirm({
    title: 'This code is not trusted',
    message: `"${name}" arrived from ${whereFrom(record)} and has never run here. If you let it run, it runs with everything your hive can reach — your content, your keys, your identity.`,
    warning: auditLine(record),
    confirmLabel: 'I understand',
    cancelLabel: 'Keep it held',
    danger: true,
  })
  if (!first) return null

  const second = await requestConfirm({
    title: 'An audit is not an approval',
    message: `Nobody but you can accept "${name}". A reader that found nothing only means nothing was found — it is not a promise, and a community vouching for it is their judgement, not yours.`,
    warning: 'Accepting is permanent until you refuse it again. Only accept code you are willing to be responsible for.',
    confirmLabel: 'Let it run',
    cancelLabel: 'Keep it held',
    danger: true,
  })
  if (!second) return null

  return await acceptIntoHive(record.sig, [WARNING_NOT_SAFE, WARNING_AUDIT_IS_NOT_APPROVAL])
}

/** Refusing needs no ceremony: it is the safe direction, and it is reversible
 *  by the same hand that made it. */
export const refuseByHand = async (record: BroodRecord): Promise<BroodRecord | null> =>
  await refuseInBrood(record.sig)
