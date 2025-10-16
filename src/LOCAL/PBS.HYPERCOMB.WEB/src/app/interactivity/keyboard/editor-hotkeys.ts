// editor-hotkeys.ts

import { Injectable, inject } from "@angular/core"
import { HypercombMode } from "src/app/core/models/enumerations"
import { ServiceBase } from "src/app/core/mixins/abstraction/service-base"
import { KeyboardState } from "./keyboard-state"

@Injectable({ providedIn: 'root' })
export class EditorHotkeys extends ServiceBase {
    private readonly ks = inject(KeyboardState)
    constructor() {
        super()

        // r â†’ move mode on keyup
        this.ks.registerAction('moveMode', {
            onUp: async (_ev: KeyboardEvent) => {
                this.state.toggleToolMode(HypercombMode.Move)
                this.selectionService.clear()
            }
        })

        // hold space to pan continuously
        this.kb.whileHeld({ keys: ['space'], tick: (dt) => this.panService.tick(dt) })

        // sequence: g then g â†’ go to grid view
        this.kb.registerSequence({ sequence: ['g', 'g'], onMatch: () => this.nav.goGrid() })
    }
}


