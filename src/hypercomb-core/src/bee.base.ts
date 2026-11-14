import { Effect } from "./effect.js"
import { EffectBus, type EffectHandler } from "./effect-bus.js"
import type { TraitDeclaration } from './core/trait.js'
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
      .replace(/^_+/, '')
      .replace(/(?:Worker|Drone|QueenBee|Bee)$/, '')
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

  /** Optional one-time resource warmup — invoked by ScriptPreloader after
   *  registration and before the bee participates in pulse cycles. Override
   *  to pre-rasterize glyphs, precompile shaders, prefetch assets, open
   *  long-lived connections, or hydrate caches. */
  public warmup?(): Promise<void>

  /** Optional derived-cache phase — the processor invokes this on idle
   *  time after act() completes and `synchronize` has coalesced the
   *  render. Contract: anything written here must be a pure derivation
   *  of sig-addressed inputs, keyed by the input signature, stored in a
   *  derived-cache pool — recomputable, wipe-safe, never load-bearing.
   *  Never mint truth here: no layers, no history markers, no gating.
   *  The cold path must remain complete when these records are absent. */
  public optimize?: () => Promise<void>

  /** Optional cleanup hook — override in subclasses */
  protected dispose?(): void

  /** Mark this bee as disposed, clean up effect subscriptions, call dispose() if defined */
  public markDisposed(): void {
    if (this._state === BeeState.Disposed) return
    this._state = BeeState.Disposed
    // Broadcast disposal BEFORE cleaning subscriptions — listeners must
    // see this event so they can tear down UI owned by this bee.
    // Transient: disposal is a point-in-time event, not replayable state.
    EffectBus.emitTransient('bee:disposed', { iocKey: this.iocKey })
    for (const unsub of this._effectSubs) unsub()
    this._effectSubs.length = 0
    // What the bee holds by hand goes the same way, newest first, so its
    // interface is disconnected before its own dispose() runs.
    for (const release of [...this._held].reverse()) { try { release() } catch (error) { console.error(error) } }
    this._held.clear()
    this.dispose?.()
  }

  // --------------------------------
  // what a bee holds by hand (released on dispose)
  // --------------------------------
  //
  // THE INTERFACE DISCONNECTS (jwize 2026-11-13: "we should be able upgrade
  // and not have to have a refresh … as long as the interface disconnects it
  // would be fine"). A bee that leaves while the hive runs — switched off, or
  // replaced by its next revision — must leave nothing answering in its place.
  // Effects were always let go for it (`onEffect`); a listener or a timer wired
  // through these is let go the same way, so its `dispose()` has nothing left
  // to undo.

  /** Releases this bee owns — run once, on dispose. */
  private _held = new Set<() => void>()

  /** Hold something until this bee is disposed: `release` runs then, once. The
   *  answer lets go early. A bee already disposed releases at once. */
  protected own(release: () => void): () => void {
    if (this._state === BeeState.Disposed) { release(); return () => undefined }
    this._held.add(release)
    return () => { if (this._held.delete(release)) release() }
  }

  /** A listener this bee owns: removed when the bee is disposed. */
  protected listen(
    target: EventTarget,
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): () => void {
    target.addEventListener(type, handler, options)
    return this.own(() => target.removeEventListener(type, handler, options))
  }

  /** A repeating timer this bee owns: stopped when the bee is disposed. */
  protected every(milliseconds: number, run: () => void): () => void {
    const id = setInterval(run, milliseconds)
    return this.own(() => clearInterval(id))
  }

  /** A one-shot timer this bee owns: it never fires on a disposed bee. */
  protected after(milliseconds: number, run: () => void): () => void {
    const release = (): void => clearTimeout(id)
    const id = setTimeout(() => { this._held.delete(release); run() }, milliseconds)
    return this.own(release)
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
  // genotype (feature group identity)
  // --------------------------------

  /**
   * Stable, human-readable feature-group identifier.
   * All bees sharing a genotype form a cohort whose UI contributions
   * can be toggled on/off as a unit via `genotype:set-visible`.
   */
  public genotype?: string

  // --------------------------------
  // meaning
  // --------------------------------

  public description?: string
  public grammar?: GrammarHint[]
  public links?: ProviderLink[]
  public effects?: readonly Effect[]

  /** The extension points this behaviour leaves open (core/trait.ts). A plain word means the
   *  behaviour already has its own working version and a filler may replace it; `{ word, needs: true }`
   *  is a reminder that it works properly only once something is provided. A declaration, like
   *  `listens` and `emits`: the build and the hive read it without running the bee. A view's traits
   *  are every tile's traits while it opens as that view. */
  public readonly traits?: readonly TraitDeclaration[]

  // --------------------------------
  // bee mechanics (framework-owned)
  // --------------------------------

  /** Unified framework entry point — Drone and Worker implement differently */
  public abstract pulse(grammar: string): Promise<void>
}
