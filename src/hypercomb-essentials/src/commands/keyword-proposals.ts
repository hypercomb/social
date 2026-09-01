// Transcript → keyword proposal primitives.
//
// Generation is deliberately split from the view: the Claude Bridge responder
// may return fenced JSON, prose around JSON, or a bare array, while selection
// and persistence remain participant actions in the view.

export type KeywordProposalGroup = {
  readonly name: string
  readonly keywords: readonly string[]
}

const MAX_GROUPS = 8
const MAX_PER_GROUP = 12
const MAX_KEYWORD_LENGTH = 48

const cleanKeyword = (value: unknown): string => String(value ?? '')
  .trim()
  .replace(/^#+/, '')
  .replace(/\s+/g, ' ')
  .replace(/^[,.;:()[\]{}'"`~]+|[,.;:()[\]{}'"`~]+$/g, '')
  .slice(0, MAX_KEYWORD_LENGTH)

const title = (value: unknown, fallback: string): string => {
  const clean = cleanKeyword(value)
  return clean || fallback
}

export function normalizeKeywordGroups(input: unknown): KeywordProposalGroup[] {
  const source = Array.isArray(input)
    ? input
    : (input && typeof input === 'object'
        ? ((input as { groups?: unknown }).groups ?? (input as { keywords?: unknown }).keywords)
        : [])
  if (!Array.isArray(source)) return []
  if (source.every(value => value === null || typeof value !== 'object')) {
    return normalizeKeywordGroups([{ name: 'Keywords', keywords: source }])
  }

  const seen = new Set<string>()
  const groups: KeywordProposalGroup[] = []
  for (let groupIndex = 0; groupIndex < source.length && groups.length < MAX_GROUPS; groupIndex++) {
    const raw = source[groupIndex]
    const groupName = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? title((raw as { name?: unknown; group?: unknown; category?: unknown }).name
        ?? (raw as { group?: unknown }).group
        ?? (raw as { category?: unknown }).category, `Group ${groupIndex + 1}`)
      : 'Keywords'
    const values = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object'
        ? ((raw as { keywords?: unknown; items?: unknown; values?: unknown }).keywords
          ?? (raw as { items?: unknown }).items
          ?? (raw as { values?: unknown }).values)
        : []
    if (!Array.isArray(values)) continue

    const keywords: string[] = []
    for (const value of values) {
      const keyword = cleanKeyword(
        value && typeof value === 'object'
          ? ((value as { keyword?: unknown; name?: unknown; label?: unknown }).keyword
            ?? (value as { name?: unknown }).name
            ?? (value as { label?: unknown }).label)
          : value,
      )
      const key = keyword.toLocaleLowerCase()
      if (!keyword || seen.has(key)) continue
      seen.add(key)
      keywords.push(keyword)
      if (keywords.length >= MAX_PER_GROUP) break
    }
    if (keywords.length) groups.push({ name: groupName, keywords })
  }
  return groups
}

/** Accept the common shapes an LLM returns without trusting prose as data. */
export function parseKeywordProposal(text: string): KeywordProposalGroup[] {
  const raw = String(text ?? '').trim()
  if (!raw) return []
  const candidates = [
    raw,
    ...[...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(match => match[1]),
  ]
  const objectStart = raw.indexOf('{')
  const objectEnd = raw.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(raw.slice(objectStart, objectEnd + 1))
  const arrayStart = raw.indexOf('[')
  const arrayEnd = raw.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(raw.slice(arrayStart, arrayEnd + 1))

  for (const candidate of candidates) {
    try {
      const groups = normalizeKeywordGroups(JSON.parse(candidate))
      if (groups.length) return groups
    } catch { /* try the next bounded JSON candidate */ }
  }
  return []
}

export function keywordGenerationPrompt(transcript: string): string {
  return `Extract a compact, useful keyword system from the transcript below.
Return ONLY JSON in this exact shape:
{"groups":[{"name":"topic family","keywords":["keyword","short key phrase"]}]}

Rules:
- 3 to 7 logical groups, ordered from central themes to supporting context.
- 3 to 10 distinct keywords per group.
- Prefer concepts, people, projects, places, decisions, and actions actually present.
- Use short human-readable phrases, not sentences.
- Do not invent facts, explanations, scores, colours, or markdown.

TRANSCRIPT
${transcript.trim()}`
}
