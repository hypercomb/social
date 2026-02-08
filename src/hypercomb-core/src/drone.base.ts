import { Effect } from "./effect.js"
import { GrammarHint } from "./grammar-hint.js"
import { register } from "./ioc/ioc.js"
import { ProviderLink } from "./provider-link.js"

export abstract class Drone {

  public readonly name: string

  public static simplify = (name: string): string => {
    return name
      .replace(/Drone$/, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim()
  }

  public constructor() {
    this.name = Drone.simplify(this.constructor.name)
  }

  // --------------------------------
  // developer intent (overrideable)
  // --------------------------------

  // does this drone perceive relevance right now?
  protected sense = (grammar: string): boolean | Promise<boolean> => true


  // developer-defined behavior
  protected heartbeat: (grammar: string) => Promise<void> = async () => { }

  // --------------------------------
  // meaning
  // --------------------------------

  public description?: string
  public grammar?: GrammarHint[]
  public links?: ProviderLink[]
  public effects?: readonly Effect[]

  // --------------------------------
  // drone mechanics (framework-owned)
  // --------------------------------

  // should this drone act on this pulse?
  public sensed = async (grammar: string): Promise<boolean> => {
    return await this.sense(grammar)
  }

  // single framework entrypoint
  public async encounter(grammar: string): Promise<void> {
    if (!(await this.sensed(grammar))) return
    await this.heartbeat(grammar)
  }
}
