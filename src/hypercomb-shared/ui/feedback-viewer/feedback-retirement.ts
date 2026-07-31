// Pure projection of the feedback inbox's durable retirement records.
//
// The feedback channel is add-only: removing a source record locally does not
// prevent the relay from replaying the same bytes. These ledgers are therefore
// the authority for whether a replayed row is still open.

export type FeedbackOptimizationSnapshot = {
  sig: string
  value: any
}

export type FeedbackRetirementIndex = {
  hiddenByTarget: Map<string, string>
  seenByKey: Map<string, string>
  answeredQuestionSigs: Set<string>
  answeredQuestionIds: Set<string>
}

const HEX64 = /^[0-9a-f]{64}$/

export function indexFeedbackRetirements(
  records: readonly FeedbackOptimizationSnapshot[],
): FeedbackRetirementIndex {
  const hiddenByTarget = new Map<string, string>()
  const seenByKey = new Map<string, string>()
  const answeredQuestionSigs = new Set<string>()
  const answeredQuestionIds = new Set<string>()

  for (const { sig, value } of records) {
    const payload = value?.payload ?? {}
    if (value?.kind === 'hidden' && payload.targetKind === 'feedback-item') {
      const targetSig = String(payload.targetSig ?? '').trim().toLowerCase()
      if (HEX64.test(targetSig)) hiddenByTarget.set(targetSig, sig)
    }
    if (value?.kind === 'feedback-seen') {
      const key = String(payload.key ?? '').trim()
      if (key) seenByKey.set(key, sig)
    }
    // `qa-answer` carries the response to the routine. The routine drains and
    // removes it, so `qa-answered` is the small local tombstone that survives
    // after downstream work has consumed the response.
    if (value?.kind === 'qa-answer' || value?.kind === 'qa-answered') {
      const qSig = String(payload.qSig ?? '').trim().toLowerCase()
      const qId = String(payload.qId ?? '').trim()
      if (HEX64.test(qSig)) answeredQuestionSigs.add(qSig)
      if (qId) answeredQuestionIds.add(qId)
    }
  }

  return { hiddenByTarget, seenByKey, answeredQuestionSigs, answeredQuestionIds }
}

export function questionWasAnswered(
  index: FeedbackRetirementIndex,
  sig: string,
  qId: string,
): boolean {
  return index.answeredQuestionSigs.has(sig.trim().toLowerCase())
    || (!!qId && index.answeredQuestionIds.has(qId))
}

export function visibleFeedbackItems<T>(
  items: readonly T[],
  showHidden: boolean,
  isRetired: (item: T) => boolean,
): T[] {
  return showHidden ? [...items] : items.filter(item => !isRetired(item))
}

export type FeedbackReach = 'local' | 'children' | 'global'

export function feedbackMatchesReach(
  item: { kind: string; route: string },
  reach: FeedbackReach,
  currentRoute: string,
): boolean {
  if (reach === 'global' || item.kind === 'reply') return true
  if (reach === 'local') return item.route === currentRoute
  return item.route === currentRoute
    || currentRoute === ''
    || item.route.startsWith(`${currentRoute}/`)
}
