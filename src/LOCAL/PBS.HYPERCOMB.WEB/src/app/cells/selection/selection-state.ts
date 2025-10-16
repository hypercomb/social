// import { DestroyRef, Injectable, computed, inject, signal } from "@angular/core"
// import { takeUntilDestroyed } from "@angular/core/rxjs-interop"
// import { fromEvent } from "rxjs"
// import { KeyboardState } from "src/app/interactivity/keyboard/keyboard-state"
// import { Cell } from "src/app/cells/cell"

// @Injectable({ providedIn: 'root' })
// export class SelectionState {
//   private readonly ks = inject(KeyboardState)
//   public readonly canSelect = computed(() => this.ks.primary() || this.override())
//   private readonly override = signal(false)      // set true while in clipboard mode

//   protected readonly _items = signal<Cell[]>([])
//   public readonly items = this._items.asReadonly()
//   public readonly hasItems = computed(() => this._items().length > 0)
//   private readonly _latest = signal<Cell | null>(null)
//   public readonly latest = this._latest.asReadonly()

//   constructor() {

//     const destroyRef = inject(DestroyRef)

//     fromEvent(window, 'blur')
//       .pipe(takeUntilDestroyed(destroyRef))
//       .subscribe(() => this.override.set(false))
//   }

//   public add(item: Cell) {
//     this._items.update(arr => [...arr, item])
//     this._latest.set(item)
//   }

//   public clear() {
//     this._items.set([])
//   }

//   public remove(predicate: (item: Cell) => boolean) {
//     this._items.update(arr => arr.filter(i => !predicate(i)))
//   }

//   public toggle(item: Cell, predicate: (existing: Cell) => boolean) {
//     const exists = this._items().some(predicate)
//     if (exists) {
//       this.remove(predicate)
//     } else {
//       this.add(item)
//     }
//   }


//   // clipboard (or any feature) toggles this to allow selection w/o Ctrl
//   public setCanSelect(can: boolean) {
//     this.override.set(can)
//   }
// }


