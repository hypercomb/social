import { Injectable, signal, computed, Signal, Injector, effect } from "@angular/core"
import { toSignal } from "@angular/core/rxjs-interop"
import { Observable } from "rxjs"
import { POLICY } from "src/app/core/models/enumerations"

@Injectable({ providedIn: "root" })
export class PolicyService {
  private readonly blockers = signal<Record<POLICY, boolean>>({} as Record<POLICY, boolean>)

  // ──────────────────────────────
  // global state (good for debugging / quick checks)
  // ──────────────────────────────
  public readonly isBlocked = computed(() =>
    Object.values(this.blockers()).some(Boolean)
  )

  public readonly isAllowed = computed(() => !this.isBlocked())

  // ──────────────────────────────
  // combinators
  // ──────────────────────────────

  /** true if all given policies are active */
  public all(...names: POLICY[]): Signal<boolean> {
    return computed(() => names.length > 0 && names.every(n => !!this.blockers()[n]))
  }

  /** true if at least one of the given policies is active */
  public any(...names: POLICY[]): Signal<boolean> {
    return computed(() => names.some(n => !!this.blockers()[n]))
  }

  /** true if none of the given policies are active */
  public none(...names: POLICY[]): Signal<boolean> {
    return computed(() => names.every(n => !this.blockers()[n]))
  }

  // ──────────────────────────────
  // mutation helpers
  // ──────────────────────────────

  public setBlocker(name: POLICY, active: boolean) {
    this.blockers.update(m =>
      m[name] === active ? m : { ...m, [name]: active }
    )
  }

  public has(name: POLICY): boolean {
    return !!this.blockers()[name]
  }

  public unregister(name: POLICY) {
    this.blockers.update(m => {
      if (!(name in m)) return m
      const { [name]: _, ...rest } = m
      return rest as Record<POLICY, boolean>
    })
  }

  public clear() {
    this.blockers.set({} as Record<POLICY, boolean>)
  }

  // ──────────────────────────────
  // registration (signals & observables)
  // ──────────────────────────────

  public registerSignal(name: POLICY, s: Signal<boolean>, injector: Injector): () => void {
    const eff = effect(onCleanup => {
      this.setBlocker(name, s())
      onCleanup(() => this.unregister(name))
    }, { injector })

    return () => eff.destroy()
  }

  public register$(name: POLICY, o$: Observable<boolean>, injector: Injector): () => void {
    const sig = toSignal(o$, { initialValue: false, injector })
    return this.registerSignal(name, sig, injector)
  }

  // ──────────────────────────────
  // debugging
  // ──────────────────────────────

  public debugDump(): void {
    console.log("🔎 policy state:", {
      isBlocked: this.isBlocked(),
      isAllowed: this.isAllowed(),
      blockers: this.blockers()
    })
  }
}
