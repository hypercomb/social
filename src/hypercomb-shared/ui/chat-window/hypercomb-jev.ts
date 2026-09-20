// Shell contract for the replaceable essentials decision service. No module
// import: the web shell resolves services from the signed installation.
export const JEV_IOC_KEY = '@hypercomb.social/JevDecision'
export const JEV_MODEL = '~typesafe/jev-latest'
export interface Proposal { readonly id: string; readonly label: string; readonly plan: string }
export interface Decision {
  readonly outcome: 'selected' | 'participant' | 'revise'
  readonly selected?: string
  readonly rejected: readonly string[]
  readonly reason: string
  readonly model: string
  readonly answers: Record<string, unknown>
  readonly usage?: { inputTokens?: number; outputTokens?: number; cost?: number }
}
export interface JevLike {
  ready(providerId: string): boolean
  evaluate(input: unknown, source: { providerId: string; system: string; messages: readonly { content: string }[] }, signal?: AbortSignal): Promise<Decision>
}
interface UsageAttempt {
  readonly category?: string
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number; readonly estimatedCostUsd?: number }
}

/** Only measured provider usage is counted; absent counts remain visible. */
export const formatJevUsage = (attempts: readonly UsageAttempt[]): string => {
  const summarize = (rows: readonly UsageAttempt[]): string => {
    if (!rows.length) return 'no calls'
    const count = (key: 'inputTokens' | 'outputTokens', label: string): string => {
      const measured = rows.map(row => row.usage?.[key])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
      if (!measured.length) return `${label} unavailable`
      const total = measured.reduce((sum, value) => sum + value, 0)
      return `${total} ${label}${measured.length < rows.length ? ' (partial)' : ''}`
    }
    return `${count('inputTokens', 'input')}, ${count('outputTokens', 'output')}`
  }
  return `Tokens — workers: ${summarize(attempts.filter(row => row.category !== 'jev-decision'))}; Jev: ${summarize(attempts.filter(row => row.category === 'jev-decision'))}.`
}
interface ResourceWriter { putResource?(blob: Blob, options: { emit: boolean }): Promise<string> }
const resource = (store: ResourceWriter, value: unknown): Promise<string | undefined> =>
  store.putResource?.(new Blob([JSON.stringify(value)], { type: 'application/json' }), { emit: false }) ?? Promise.resolve(undefined)

/** Durable provenance references immutable content; only the wire packet is inline. */
export const persistJevInput = async (store: ResourceWriter | undefined, input: {
  request: string; doctrine: string; evidence: readonly string[]; proposals: readonly Proposal[]
}): Promise<string | undefined> => {
  if (!store?.putResource) return undefined
  const request = await resource(store, input.request)
  const doctrine = await resource(store, input.doctrine)
  const evidence = await Promise.all(input.evidence.map(value => resource(store, value)))
  const proposals = await Promise.all(input.proposals.map(async proposal => resource(store, {
    id: proposal.id, label: await resource(store, proposal.label), plan: await resource(store, proposal.plan),
  })))
  return resource(store, { kind: 'jev-input', model: JEV_MODEL, rubric: 2, request, doctrine, evidence, proposals })
}

export const persistJevReceipt = async (store: ResourceWriter | undefined, source: string, result: Decision): Promise<string | undefined> => {
  if (!store?.putResource) return undefined
  return resource(store, { ...result, kind: 'jev-decision', source, requestedModel: JEV_MODEL,
    reason: await resource(store, result.reason), answers: await resource(store, result.answers),
  })
}
export const JEV_WORK_INSTRUCTION =
  'DIRECTIONS. For a consequential choice, after reading the relevant facts, end a round with one closed `hypercomb-propose` fence containing JSON: '
  + '{"proposals":[{"id":"a","label":"Short choice label","plan":"Concrete approach and tradeoffs"},{"id":"b","label":"Another label","plan":"Alternative approach and tradeoffs"}]}. '
  + 'Use two or three distinct proposals, ids of lowercase letters/digits/underscores, labels under 70 characters, each plan under 2000 characters. '
  + 'Jev evaluates these against the participant request, doctrine and observed evidence. Wait for the decision before implementing. Do not manufacture alternatives for straightforward work. '
  + 'Start with the existing Hypercomb primitives and participant values. Outside techniques are useful only when they fit that architecture; novelty is not a reason to replace it. If a proposal conflicts with doctrine, revise it instead of asking the participant to approve the conflict. '
  + 'While working, emit only work blocks, without progress essays. Prose is shown after the work is finished or a participant choice is required. '
  + 'After changing the hive, read the affected content to verify the result before your final response. A command receipt proves execution, not correctness.'

export const parseProposals = (lines: readonly string[]): readonly Proposal[] => {
  if (lines.join('\n').length > 7_000) throw new Error('Proposals exceed the decision budget')
  const value = JSON.parse(lines.join('\n')) as { proposals?: unknown }
  if (!value || !Array.isArray(value.proposals) || value.proposals.length < 2 || value.proposals.length > 3) throw new Error('Provide two or three proposals')
  const proposals = value.proposals.map((p: unknown): Proposal => {
    if (!p || typeof p !== 'object') throw new Error('Invalid proposal')
    const row = p as Record<string, unknown>
    if (typeof row['id'] !== 'string' || !/^[a-z][a-z0-9_-]{0,23}$/.test(row['id']) || row['id'] === 'none'
      || typeof row['label'] !== 'string' || !row['label'].trim() || row['label'].length > 70
      || /[\u0000-\u001f\u007f`~]/.test(row['label']) || row['label'].trim() === 'Choose a different direction'
      || typeof row['plan'] !== 'string' || !row['plan'].trim() || row['plan'].length > 2_000) throw new Error('Invalid proposal')
    return { id: row['id'], label: row['label'].trim(), plan: row['plan'].trim() }
  })
  if (new Set(proposals.map(p => p.id)).size !== proposals.length || new Set(proposals.map(p => p.label)).size !== proposals.length) throw new Error('Proposals must have distinct ids and labels')
  return proposals
}

/** The question itself is normal persisted conversation text, so the next
 * worker sees both alternatives and the participant's answer after reload. */
export const proposalQuestion = (proposals: readonly Proposal[], reason: string): string => {
  const details = proposals.map(p => `**${p.label.replace(/[\r\n`*]/g, ' ')}**\n${p.plan.replace(/[`~]/g, '')}`).join('\n\n')
  return `${reason}\n\n${details}\n\n\`\`\`hypercomb-question\n${JSON.stringify({
    prompt: 'Which direction should the hive take?', options: [...proposals.map(p => p.label), 'Choose a different direction'],
  })}\n\`\`\``
}
