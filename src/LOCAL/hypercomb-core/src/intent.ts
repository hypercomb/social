import { Effect } from './effect'
import { GrammarHint } from './grammar-hint'
import { Source } from './source'

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


export * from './effect'
export * from './grammar-hint'
export * from './source'
export * from './intent'
export * from './fixtures/sample-code'
