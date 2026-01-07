// src/action.base.ts
import { GrammarHint } from './grammar-hint.js'
import { ProviderLink } from './provider-link.js'
import { Effect } from './effect.js'

export abstract class Action {

  // --------------------------------
  // identity (derived, not editable)
  // --------------------------------

  public readonly name: string

  public constructor() {
    this.name = this.constructor.name
      .replace(/Action$/, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim()
  }

  // --------------------------------
  // meaning (signed)
  // --------------------------------

  public description?: string
  public grammar?: GrammarHint[]
  public links?: ProviderLink[]
  public effects?: readonly Effect[]

  // --------------------------------
  // execution
  // --------------------------------

  // must be arrow fn for toString()
  protected abstract run: () => Promise<void>

  public async execute(): Promise<void> {
    await this.run()
  }
}
