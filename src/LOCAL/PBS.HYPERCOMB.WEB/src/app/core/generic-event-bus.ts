import { AppEvents } from "../helper/events/events"

// event-bus.ts
export class EventBus<Events extends Record<string, any>> {
    dispatch<K extends keyof Events>(type: K, payload: Events[K]): void {
        document.dispatchEvent(
            new CustomEvent<Events[K]>(String(type), { detail: payload })
        )
    }

    subscribe<K extends keyof Events>(
        type: K,
        handler: (payload: Events[K]) => void
    ): () => void {
        const listener = (e: Event) =>
            handler((e as CustomEvent<Events[K]>).detail)

        document.addEventListener(String(type), listener)
        return () => document.removeEventListener(String(type), listener)
    }
}

export const appEvents = new EventBus<AppEvents>()
