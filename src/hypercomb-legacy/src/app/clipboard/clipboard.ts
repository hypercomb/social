// import { signal, computed } from '@angular/core'
// import { HypercombMode } from '../core/models/enumerations'
// import { Cell } from '../cells/cell'
// import { HypercombState } from '../state/core/hypercomb-state'
// import { IClipboardState } from '../shared/tokens/i-hypercomb.token'

// // core signals
// const _items = signal<Cell[]>([])
// const _mode = signal(HypercombMode.None)

// // injected services (populated once at bootstrap)
// let _clipboard!: IClipboardState
// let _hypercomb!: HypercombState

// // one-time init called from bootstrap-globals.ts
// export function initClipboardDeps(clipboard: IClipboardState, hypercomb: HypercombState) {
//   _clipboard = clipboard
//   _hypercomb = hypercomb
// }

// // global singleton facade
// export const clipboard = {
//   // state
//   items: _items.asReadonly(),

//   // derived
//   activeClipboard: computed(() => _clipboard?.activeClipboard() ?? null),
//   count: computed(() => _items().length),
//   hasItems: computed(() => _items().length > 0),
//   viewing: computed(() => (_hypercomb?.mode() & HypercombMode.ViewingClipboard) !== 0),
//   selected: computed(() => _clipboard?.activeClipboard()?.name ?? 'none'),

//   // mutations
//   setItems(items: Cell[]): void {
//     _items.set([...items].sort((a, b) => a.index - b.index))
//   },
//   addItem(item: Cell): void {
//     _items.update(arr => [...arr, item].sort((a, b) => a.index - b.index))
//   },
//   removeItem(item: Cell): void {
//     _items.update(arr => arr.filter(x => x !== item))
//   },
//   clear(): void {
//     _items.set([])
//   },
//   copy(cell: Cell): void {
//     throw new Error('Not implemented')
//   },
//   cut(cell: Cell): void {
//     throw new Error('Not implemented')
//   },
//   open(): void {
//     throw new Error('Not implemented')
//   },
//   paste(): void {
//     throw new Error('Not implemented')
//   },
//   close(): void {
//     throw new Error('Not implemented')
//   },
// }
