/** Parse the targeted keyword-request form without assigning it feature
 * attachment semantics: `tile@keywords optional transcript`. */
const TARGETED_KEYWORDS_RE = /^([^@:\[\/!#~\s]+)@keywords(?:\s+([\s\S]*))?$/i

export type TargetedKeywordsInput = {
  readonly target: string
  readonly transcript: string
}

export function parseTargetedKeywordsInput(value: string): TargetedKeywordsInput | null {
  const match = String(value ?? '').trim().match(TARGETED_KEYWORDS_RE)
  if (!match) return null
  return {
    target: match[1],
    transcript: String(match[2] ?? '').trim(),
  }
}

