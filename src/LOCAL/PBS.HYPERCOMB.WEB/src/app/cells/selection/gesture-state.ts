import { signal } from "@angular/core"

// true whenever ANY drag gesture is taking place (move tiles or ctrl-select)
export const isDraggingGesture = signal(false)
