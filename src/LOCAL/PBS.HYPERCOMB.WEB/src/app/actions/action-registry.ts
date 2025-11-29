import { inject, Injectable, Signal, signal } from "@angular/core"
import { Action } from "./action-models"
import { ActionBase } from "./action.base"
import { PayloadBase } from "./action-contexts"
import { CoordinateDetector } from "../helper/detection/coordinate-detector"
import { IActionRegistry } from "../shared/tokens/i-hypercomb.token"

export interface ActionEvent {
  id: string
  status: "started" | "finished" | "failed"
  payload?: unknown
  error?: any
  timestamp: number
}
@Injectable({ providedIn: "root" })
export class ActionRegistry implements IActionRegistry {
  private entries = new Map<string, ActionEntry>()
  private readonly detector = inject(CoordinateDetector)

  private readonly _lastEvent = signal<ActionEvent | null>(null)
  public readonly lastEvent = this._lastEvent.asReadonly()

  private readonly _events = signal<ActionEvent[]>([])
  public readonly events = this._events.asReadonly()

  // register a singleton action instance
  public register<TCtx = unknown>(instance: ActionBase<TCtx>): void {
    const id = instance.id
    if (!id || this.entries.has(id)) return
    this.entries.set(id, { mode: "singleton", instance })
  }

  // register a transient factory (new instance every invoke)
  public registerFactory<TCtx = unknown>(id: string, factory: () => ActionBase<TCtx>): void {
    if (!id || this.entries.has(id)) return
    this.entries.set(id, { mode: "factory", factory })
  }

 public async invoke<TPayload extends PayloadBase = PayloadBase>(
    id: string,
    payload?: TPayload
  ): Promise<boolean> {
    const entries = this.entries
    const entry = entries.get(id)
    if (!entry) return false

    const action: Action<TPayload> =
      entry.mode === "singleton"
        ? (entry.instance as Action<TPayload>)
        : (entry.factory!() as Action<TPayload>)

    action.snapshot?.()

    // augment payload with hovered cell (works even if payload is undefined)
    const hoveredCell = this.detector.activeCell()
    if (hoveredCell) {
      if (hoveredCell.index !== undefined) {
        payload = { ...(payload ?? {}), hovered: hoveredCell } as TPayload
      }
    }

    this.pushEvent({ id, status: "started", payload })

    try {
      const ok = await evalEnabled(action.enabled, payload)
      if (!ok) return false

      await Promise.resolve(action.run(payload!))  // ctx optional

      this.pushEvent({ id, status: "finished", payload })
      return true
    } catch (err) {
      this.pushEvent({ id, status: "failed", payload, error: err })
      return false
    }
  }


  private pushEvent(evt: Omit<ActionEvent, "timestamp">) {
    const full = { ...evt, timestamp: Date.now() }
    this._lastEvent.set(full)
    this._events.update(list => [...list, full])
  }
}

interface ActionEntry {
  mode: "singleton" | "factory"
  instance?: Action<any>
  factory?: () => Action<any>
}

const isSignalBoolean = (v: unknown): v is Signal<boolean> =>
  typeof v === "function" && typeof (v as any).asReadonly === "function"

const evalEnabled = async <TContext>(
  enabled: Action<TContext>["enabled"],
  payload?: TContext
): Promise<boolean> => {
  if (enabled === undefined) return true
  if (typeof enabled === "boolean") return enabled
  if (isSignalBoolean(enabled)) return enabled() // no !!
  // function: call with optional ctx; supports () => ... and (ctx) => ...
  const res = (enabled as (p?: TContext) => boolean | Promise<boolean>)(payload)
  return typeof res === "boolean" ? res : await res
}