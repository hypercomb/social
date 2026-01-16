import { Effect } from "./effect.js"
import { GrammarHint } from "./grammar-hint.js"
import { ProviderLink } from "./provider-link.js"

export abstract class Action {

  public readonly name: string

  public constructor() {  
    this.name = this.constructor.name
      .replace(/Action$/, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim()
    }

  // --------------------------------
  // author intent (overrideable)
  // --------------------------------

  // default: always enabled
  public enabled = (): boolean | Promise<boolean> => true

  // --------------------------------   
  // meaning
  // --------------------------------

  public description?: string
  public grammar?: GrammarHint[]
  public links?: ProviderLink[]
  public effects?: readonly Effect[]

  // --------------------------------
  // framework gate
  // --------------------------------

  public canExecute = async (): Promise<boolean> => {
    return await this.enabled()
  }

  // --------------------------------
  // execution
  // --------------------------------

  protected abstract run: () => Promise<void>

  public async execute(): Promise<void> {
    if (!(await this.canExecute())) return
    await this.run()
  }
}
