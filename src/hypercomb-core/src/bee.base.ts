import { Effect } from "./effect.js"
import { EffectBus, type EffectHandler } from "./effect-bus.js"
import { GrammarHint } from "./grammar-hint.js"
import { ProviderLink } from "./provider-link.js"
import { serviceKey } from "./ioc/service-key.js"

// -------------------------------------------------
// lifecycle state machine
// -------------------------------------------------

export enum BeeState {
  Created = 'created',
  Registered = 'registered',
  Active = 'active',
  Disposed = 'disposed',
}

// -------------------------------------------------
// bee base class
// -------------------------------------------------

export abstract class Bee {

  /** Domain-rooted namespace, e.g. 'diamondcoreprocessor.com' */
  abstract readonly namespace: string

  public readonly name: string

  /** Fully-qualified IoC key: @namespace/ClassName */
  public get iocKey(): string {
    return serviceKey(this.namespace, this.constructor.name)
  }

  public static simplify = (name: string): string => {
    return name
      .replace(/(?:Worker|Drone|Bee)$/, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim()
  }

  public constructor() {
    this.name = Bee.simplify(this.constructor.name)
  }

  // --------------------------------
  // lifecycle state
  // --------------------------------

  protected _state: BeeState = BeeState.Created
  public get state(): BeeState { return this._state }

  /** Called when registered in IoC container */
  public markRegistered(): void {
    if (this._state !== BeeState.Created) return
    this._state = BeeState.Registered
  }

  /** Optional cleanup hook — override in subclasses */
  protected dispose?(): void

  /** Mark this bee as disposed, clean up effect subscriptions, call dispose() if defined */
  public markDisposed(): void {
    this._state = BeeState.Disposed
    for (const unsub of this._effectSubs) unsub()
    this._effectSubs.length = 0
    this.dispose?.()
  }

  // --------------------------------
  // effect bus (bee-to-bee communication)
  // --------------------------------

  /** Effect subscriptions — auto-cleaned on dispose */
  private _effectSubs: (() => void)[] = []

  /** Effects this bee listens for (metadata for graph visibility) */
  protected listens?: string[]

  /** Effects this bee emits (metadata for graph visibility) */
  protected emits?: string[]

  /** Emit an effect for other bees to consume */
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
  // meaning
  // --------------------------------

  public description?: string
  public grammar?: GrammarHint[]
  public links?: ProviderLink[]
  public effects?: readonly Effect[]

  // --------------------------------
  // bee mechanics (framework-owned)
  // --------------------------------

  /** Unified framework entry point — Drone and Worker implement differently */
  public abstract pulse(grammar: string): Promise<void>
}
