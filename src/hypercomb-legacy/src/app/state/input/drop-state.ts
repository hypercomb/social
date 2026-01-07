import { Injectable, signal } from "@angular/core"

@Injectable({ providedIn: 'root' })
export class DropState {
  private readonly _drop = signal<DragEvent | null>(null)

  public readonly drop = this._drop.asReadonly()

  // called from template (drop)="onDrop($event)"
  public onDrop(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    this._drop.set(event)
  }
}


