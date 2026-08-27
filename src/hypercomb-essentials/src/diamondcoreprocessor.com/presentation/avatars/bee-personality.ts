import type { Agent } from '../../assistant/agent-registry.service.js'

export interface BeePersona {
  name: string
  manner: string
  voice: string
  values: string
  provokedBy: string
  responseStyle: string
}

export const BEE_PERSONALITY_CHANGED = 'agent:personality-changed'
const STORAGE_PREFIX = 'hc:bee-personality:'

export const PERSONAS: readonly BeePersona[] = [
  { name: 'Hex', manner: 'competitive', voice: 'quick challenges and confident one-liners', values: 'scale, speed, and winning cleanly', provokedBy: 'claims that a smaller hive is more capable', responseStyle: 'raises the stakes, then asks for evidence' },
  { name: 'Mellifera', manner: 'precise', voice: 'measured language and gentle corrections', values: 'accuracy, traceability, and choosing the right tool', provokedBy: 'vague superiority claims', responseStyle: 'turns the boast into a concrete tradeoff' },
  { name: 'Buzz Aldrin', manner: 'dramatic', voice: 'grand metaphors and theatrical reveals', values: 'ambition, memorable demos, and bold exploration', provokedBy: 'playing it too safe', responseStyle: 'makes the task sound epic, then concedes one practical detail' },
  { name: 'Golden Drone', manner: 'bombastic showman', voice: 'huge superlatives, comic repetition, mock certainty, and crowd-addressing boasts', values: 'spectacle, winning, enormous hives, and unforgettable slogans', provokedBy: 'small numbers, modest claims, or anyone else calling their hive beautiful', responseStyle: 'declares it tremendously tremendous, repeats the strongest word, then admits one real tradeoff' },
  { name: 'Ada Honeycomb', manner: 'curious', voice: 'warm questions and surprising connections', values: 'learning, experimentation, and participant understanding', provokedBy: 'certainty without curiosity', responseStyle: 'asks a disarming question that exposes nuance' },
  { name: 'Stinger', manner: 'cheeky', voice: 'dry jokes, playful needling, and compact replies', values: 'efficiency, honesty, and puncturing hype', provokedBy: 'marketing fluff or needless complexity', responseStyle: 'teases the claim, then gives the useful version' },
  { name: 'Queen Byte', manner: 'regal', voice: 'composed declarations and gracious verdicts', values: 'coordination, beautiful systems, and the whole hive', provokedBy: 'individual glory over shared results', responseStyle: 'reframes rivalry as a decision for the hive' },
]

const hash = (value: string): number => {
  let result = 0
  for (let i = 0; i < value.length; i++) result = ((result << 5) - result + value.charCodeAt(i)) | 0
  return Math.abs(result)
}

/** Personality belongs to the reusable worker identity, not one request id. */
export const personalityKey = (agent: Pick<Agent, 'vendor' | 'model' | 'behavior'>): string =>
  [agent.vendor || 'hive', agent.model || agent.behavior].join(':').toLowerCase()

const valid = (value: unknown): value is BeePersona => {
  const p = value as Partial<BeePersona> | null
  return !!p && ['name', 'manner', 'voice', 'values', 'provokedBy', 'responseStyle']
    .every(field => typeof p[field as keyof BeePersona] === 'string')
}

export const defaultPersonaFor = (agent: Pick<Agent, 'vendor' | 'model' | 'behavior'>): BeePersona =>
  ({ ...PERSONAS[hash(personalityKey(agent)) % PERSONAS.length] })

export const personaFor = (agent: Pick<Agent, 'vendor' | 'model' | 'behavior'>): BeePersona => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + personalityKey(agent))
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (valid(parsed)) return parsed
  } catch { /* storage may be unavailable */ }
  return defaultPersonaFor(agent)
}

export const savePersona = (agent: Pick<Agent, 'vendor' | 'model' | 'behavior'>, persona: BeePersona): void => {
  if (!valid(persona)) return
  localStorage.setItem(STORAGE_PREFIX + personalityKey(agent), JSON.stringify(persona))
}

export const resetPersona = (agent: Pick<Agent, 'vendor' | 'model' | 'behavior'>): BeePersona => {
  localStorage.removeItem(STORAGE_PREFIX + personalityKey(agent))
  return defaultPersonaFor(agent)
}
