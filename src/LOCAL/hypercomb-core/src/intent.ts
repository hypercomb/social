import { Effect } from './effect.js'
import { GrammarHint } from './grammar-hint.js'
import { Source } from './source.js'

export interface Intent {
  // stable identity
  readonly signature: string

  // human-facing
  readonly title: string
  readonly summary?: string

  // informational only
  readonly effects?: readonly Effect[]
  readonly grammar?: readonly GrammarHint[]

  // where code may be obtained
  readonly sources: readonly Source[]
}


