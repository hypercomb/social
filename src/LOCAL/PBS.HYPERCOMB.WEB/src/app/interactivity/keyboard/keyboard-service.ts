import { Injectable, inject, computed } from "@angular/core"
import { KeyboardState } from "./keyboard-state"

@Injectable({ providedIn: "root" })
export class KeyboardService {
    private readonly ks = inject(KeyboardState)

    // expose a signal: true if space is currently down
    public readonly spaceDown = computed(() => this.ks.isDown("space")())

    // could also expose convenience signals for ctrl, shift, etc.
    public readonly ctrlDown = this.ks.ctrl
    public readonly shiftDown = this.ks.shift
}
