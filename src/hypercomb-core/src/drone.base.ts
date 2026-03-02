import { Effect } from "./effect.js"
import { GrammarHint } from "./grammar-hint.js"
import { ProviderLink } from "./provider-link.js"
import { get } from "./ioc/ioc.js"

// -------------------------------------------------
// lifecycle state machine
// -------------------------------------------------

export enum DroneState {
  Created = 'created',
  Registered = 'registered',
  Active = 'active',
  Disposed = 'disposed',
}

// -------------------------------------------------
// drone base class
// -------------------------------------------------

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
  // lifecycle state
  // --------------------------------

  private _state: DroneState = DroneState.Created
  public get state(): DroneState { return this._state }

  /** Called when registered in IoC container */
  public markRegistered(): void {
    if (this._state !== DroneState.Created) return
    this._state = DroneState.Registered
  }

  /** Optional cleanup hook — override in subclasses */
  protected dispose?(): void

  /** Mark this drone as disposed, calling dispose() if defined */
  public markDisposed(): void {
    this._state = DroneState.Disposed
    this.dispose?.()
  }

  // --------------------------------
  // dependency declaration (opt-in)
  // --------------------------------

  /** Declared dependencies — maps local names to IoC keys */
  protected deps?: Record<string, string>

  /** Resolve a declared dependency by its local name */
  protected resolve<T>(localName: string): T | undefined {
    const key = this.deps?.[localName] ?? localName
    return get<T>(key)
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
    if (this._state === DroneState.Disposed) return
    if (!(await this.sensed(grammar))) return
    await this.heartbeat(grammar)
    // heartbeat may have triggered disposal — only activate from pre-active states
    if (this._state === DroneState.Created || this._state === DroneState.Registered) {
      this._state = DroneState.Active
    }
  }
}
