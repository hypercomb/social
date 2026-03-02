import { Effect } from "./effect.js"
import { EffectBus, type EffectHandler } from "./effect-bus.js"
import { GrammarHint } from "./grammar-hint.js"
import { ProviderLink } from "./provider-link.js"

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

  /** Mark this drone as disposed, clean up effect subscriptions, call dispose() if defined */
  public markDisposed(): void {
    this._state = DroneState.Disposed
    for (const unsub of this._effectSubs) unsub()
    this._effectSubs.length = 0
    this.dispose?.()
  }

  // --------------------------------
  // effect bus (drone-to-drone communication)
  // --------------------------------

  /** Effect subscriptions — auto-cleaned on dispose */
  private _effectSubs: (() => void)[] = []

  /** Effects this drone listens for (metadata for graph visibility) */
  protected listens?: string[]

  /** Effects this drone emits (metadata for graph visibility) */
  protected emits?: string[]

  /** Emit an effect for other drones to consume */
  protected emitEffect<T = unknown>(effect: string, payload: T): void {
    EffectBus.emit(effect, payload)
  }

  /** Subscribe to an effect (auto-cleaned on dispose) */
  protected onEffect<T = unknown>(effect: string, handler: EffectHandler<T>): void {
    this._effectSubs.push(EffectBus.on(effect, handler))
  }

  /** Subscribe to an effect once (auto-cleaned on dispose) */
  protected onceEffect<T = unknown>(effect: string, handler: EffectHandler<T>): void {
    this._effectSubs.push(EffectBus.once(effect, handler))
  }

  // --------------------------------
  // dependency declaration (opt-in)
  // --------------------------------

  /** Declared dependencies — maps local names to IoC keys */
  protected deps?: Record<string, string>

  /** Resolve a declared dependency by its local name (uses window.ioc where services register) */
  protected resolve<T>(localName: string): T | undefined {
    const key = this.deps?.[localName] ?? localName
    return (globalThis as any).ioc?.get(key) as T | undefined
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
