import { Injectable, inject, signal, computed, WritableSignal } from "@angular/core"
import { Settings } from "src/app/core/settings"

@Injectable({ providedIn: "root" })
export class KeyboardState {
  private readonly settings = inject(Settings)

  // writable signals
  private readonly _keyDown: WritableSignal<KeyboardEvent | null> = signal(null)
  private readonly _keyUp: WritableSignal<KeyboardEvent | null> = signal(null)

  // public readonly signals
  public readonly keyDown = this._keyDown.asReadonly()
  public readonly keyUp = this._keyUp.asReadonly()

  private readonly _pressed = signal<Set<string>>(new Set())
  public readonly pressed = this._pressed.asReadonly()

  // base helpers
  public isDown = (key: string) =>
    computed(() => this._pressed().has(key.toLowerCase()))

  public readonly ctrl = computed(() => this._pressed().has("ctrl"))
  public readonly shift = computed(() => this._pressed().has("shift"))
  public readonly alt = computed(() => this._pressed().has("alt"))
  public readonly meta = computed(() => this._pressed().has("meta"))

  public readonly primary = computed(() =>
    this.settings.isMac ? this.meta() : this.ctrl()
  )
  public readonly secondary = computed(() =>
    this.settings.isMac ? this.ctrl() : this.meta()
  )

  private readonly opts = { capture: true } as const

  constructor() {
    window.addEventListener("keydown", this.handleDown as EventListener, this.opts)
    window.addEventListener("keyup", this.handleUp as EventListener, this.opts)
  }

  public dispose(target: HTMLElement | Window = window) {
    target.removeEventListener("keydown", this.handleDown as EventListener, this.opts)
    target.removeEventListener("keyup", this.handleUp as EventListener, this.opts)
    this._pressed.set(new Set())
  }

  // let consumers clear events after handling
  public done() {
    this._keyDown.set(null)
    this._keyUp.set(null)
  }

  // 🔑 fluent matcher
  public when(ev: KeyboardEvent) {
    const evKey = this.normalize(ev.key)
    return {
      key: (
        key: string,
        opts?: {
          ctrl?: boolean
          shift?: boolean
          alt?: boolean
          meta?: boolean
          primary?: boolean
        }
      ) => {
        if (evKey !== key) return false

        if (opts?.ctrl !== undefined && ev.ctrlKey !== opts.ctrl) return false
        if (opts?.shift !== undefined && ev.shiftKey !== opts.shift) return false
        if (opts?.alt !== undefined && ev.altKey !== opts.alt) return false
        if (opts?.meta !== undefined && ev.metaKey !== opts.meta) return false

        if (opts?.primary !== undefined) {
          const isMac = /Mac|iMac|Macintosh/.test(navigator.userAgent)
          const actual = isMac ? ev.metaKey : ev.ctrlKey
          if (actual !== opts.primary) return false
        }

        return true
      },

      only: (key: string) => {
        if (evKey !== key) return false
        return !ev.ctrlKey && !ev.shiftKey && !ev.altKey && !ev.metaKey
      },
    }
  }

  private handleDown = (e: KeyboardEvent) => {
    const set = new Set(this._pressed())
    set.add(this.normalize(e.key))

    if (e.ctrlKey) set.add("ctrl")
    if (e.metaKey) set.add("meta")
    if (e.shiftKey) set.add("shift")
    if (e.altKey) set.add("alt")

    const isMac = /Mac|iMac|Macintosh/.test(navigator.userAgent)
    if (isMac && e.metaKey) set.add("primary")
    if (!isMac && e.ctrlKey) set.add("primary")

    this._pressed.set(set)
    this._keyDown.set(e)
  }

  private handleUp = (e: KeyboardEvent) => {
    const set = new Set(this._pressed())
    set.delete(this.normalize(e.key))

    set.delete("ctrl")
    if (e.ctrlKey) set.add("ctrl")
    set.delete("meta")
    if (e.metaKey) set.add("meta")
    set.delete("shift")
    if (e.shiftKey) set.add("shift")
    set.delete("alt")
    if (e.altKey) set.add("alt")

    const isMac = /Mac|iMac|Macintosh/.test(navigator.userAgent)
    set.delete("primary")
    if (isMac && e.metaKey) set.add("primary")
    if (!isMac && e.ctrlKey) set.add("primary")

    this._pressed.set(set)
    this._keyUp.set(e)
  }

  private normalize(key: string): string {
    const k = key.toLowerCase()
    if (k === "control") return "ctrl"
    if (k === " ") return "space"
    return k
  }
}
