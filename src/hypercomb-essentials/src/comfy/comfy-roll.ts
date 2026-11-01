// comfy/comfy-roll.ts
//
// TWO WAYS TO FILL THE PROMPT. One is built from the tile the participant
// has selected. The other is built only from common picture words. Each
// call is a new roll. Neither starts a picture.

const SIG = /^[0-9a-f]{64}$/i
const SKIP = new Set(['small', 'large', 'flat', 'imageSig', 'point', 'generation', 'kind'])

const LIGHT = [
  'soft side light',
  'morning window light',
  'warm lamp light',
  'cool north light',
  'low evening light',
  'bright even light',
] as const

const MANNER = [
  'painted illustration',
  'clean emblem',
  'quiet photograph',
  'rich colored drawing',
  'simple icon',
  'soft watercolor',
] as const

const GROUND = [
  'against a quiet ground',
  'with simple surroundings',
  'on a plain field',
  'centered and uncluttered',
  'in open air',
] as const

const SUBJECTS = [
  'a single brass lantern',
  'a gold compass',
  'a ceramic cup',
  'a folded paper boat',
  'a glass inkwell',
  'a wooden chair',
  'a stone arch',
  'a linen curtain',
  'a copper kettle',
  'a small sailing boat',
  'a potted fern',
  'a leather journal',
] as const

const PLACES = [
  'on a wooden table',
  'in soft fog',
  'by a window',
  'in a quiet room',
  'on pale stone',
  'against a deep blue ground',
] as const

const pick = <T>(list: readonly T[], rng: () => number): T => {
  const at = Math.min(list.length - 1, Math.floor(rng() * list.length))
  return list[at] as T
}

const phrase = (value: string): string =>
  value.trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()

const remember = (into: string[], seen: Set<string>, raw: string): void => {
  const text = phrase(raw)
  if (!text || text.length > 80 || SIG.test(text)) return
  const key = text.toLowerCase()
  if (seen.has(key)) return
  seen.add(key)
  into.push(text)
}

const walk = (value: unknown, into: string[], seen: Set<string>, depth: number): void => {
  if (into.length >= 8 || depth > 2) return
  if (typeof value === 'string') { remember(into, seen, value); return }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, into, seen, depth + 1)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (SKIP.has(key)) continue
    walk(inner, into, seen, depth + 1)
  }
}

/** The tile's own words, name first. Picture signatures are left out. */
export const tilePhrases = (name: string, props: unknown): string[] => {
  const into: string[] = []
  const seen = new Set<string>()
  remember(into, seen, name)
  walk(props, into, seen, 0)
  return into
}

const dress = (rng: () => number): string[] => [
  pick(LIGHT, rng),
  pick(MANNER, rng),
  pick(GROUND, rng),
]

/** A new picture prompt whose subject is this tile. */
export const promptFromTile = (name: string, props: unknown, rng: () => number = Math.random): string => {
  const phrases = tilePhrases(name, props)
  const subject = phrases[0] ?? ''
  if (!subject) return ''
  const rest = phrases.slice(1)
  const extra: string[] = []
  const count = rest.length ? 1 + Math.floor(rng() * Math.min(2, rest.length)) : 0
  const pool = [...rest]
  for (let i = 0; i < count; i++) {
    const at = Math.floor(rng() * pool.length)
    const [held] = pool.splice(at, 1)
    if (held) extra.push(held)
  }
  return [subject, ...extra, ...dress(rng)].join(', ')
}

/** A new picture prompt from common words alone. */
export const promptFromWords = (rng: () => number = Math.random): string =>
  [pick(SUBJECTS, rng), pick(PLACES, rng), ...dress(rng)].join(', ')

/** Directions a prompt could take, from the same common words, when no agent
 *  is there to write them. Each is a different kind of thing to add, and no
 *  two are the same phrase. */
export const rollDirections = (count: number, rng: () => number = Math.random): { title: string; text: string }[] => {
  const banks: readonly { title: string; words: readonly string[] }[] = [
    { title: 'the light', words: LIGHT },
    { title: 'the manner', words: MANNER },
    { title: 'the ground', words: GROUND },
    { title: 'the place', words: PLACES },
  ]
  const out: { title: string; text: string }[] = []
  const seen = new Set<string>()
  for (let i = 0; out.length < count && i < count * 4; i++) {
    const bank = banks[i % banks.length] as (typeof banks)[number]
    const words = pick(bank.words, rng)
    if (seen.has(words)) continue
    seen.add(words)
    // The words are the tile; what kind of thing they change is the reading.
    out.push({ title: words, text: `${bank.title}: ${words}` })
  }
  return out
}

