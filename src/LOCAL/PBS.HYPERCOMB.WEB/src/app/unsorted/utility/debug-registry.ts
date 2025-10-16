// state-debug-registry.ts

import { environment } from "src/environments/environment";

export class StateDebugRegistry {
    private static readonly state: Record<string, unknown> = {}

    /** expose a state class under a short name */
    public static expose(name: string, instance: unknown) {
        if (environment.production) return

        StateDebugRegistry.state[name] = instance
            ; (window as any).state = StateDebugRegistry.state  // âœ… namespaced for autocomplete
    }

    /** remove a state */
    public static remove(name: string) {
        if (environment.production) return
        delete StateDebugRegistry.state[name]
    }

    /** list all registered states */
    public static all(): Record<string, unknown> {
        if (environment.production) return {}
        return StateDebugRegistry.state
    }
}


