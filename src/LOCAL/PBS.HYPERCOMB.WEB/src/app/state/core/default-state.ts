import { Injectable, signal } from "@angular/core"

@Injectable({ providedIn: 'root' })
export class CombState {
    readonly canvas = signal<HTMLCanvasElement | null>(null)
}


