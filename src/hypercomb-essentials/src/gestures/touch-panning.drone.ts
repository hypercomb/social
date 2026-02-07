// // src/app/pixi/touch-panning.service.ts
// import { Injectable, effect, inject, signal } from '@angular/core'

// // minimal contract: whoever owns the viewport/camera implements this and registers it in ioc
// export interface PanTarget {
//   panBy: (dx: number, dy: number) => void
// }

// type Point = { x: number; y: number }
// type PointerEventLike = { pointerId: number; pointerType?: string }

// @Injectable({ providedIn: 'root' })
// export class TouchPanningService {

//   // state
//   private readonly isPanning = signal(false)

//   private activePointerId: number | null = null
//   private lastPos: Point | null = null

//   // track which pointer id is the mouse so we can ignore it for touch pan
//   private mousePointerId: number | null = null

//   constructor() {
//     effect(() => {
//       const positions = this.ps.pointerPositions()
//       const lastMove = this.ps.pointerMoveEvent() as PointerEventLike | null
//       const lastDown = this.ps.pointerDownEvent() as PointerEventLike | null
//       const lastUp = this.ps.pointerUpEvent?.() as PointerEventLike | null

//       // update mouse pointer id from latest mouse event
//       const last = lastMove ?? lastDown ?? lastUp
//       if (last && last.pointerType === 'mouse') {
//         this.mousePointerId = last.pointerId
//       }

//       const allEntries = Array.from(positions.entries()) as [number, Point][]

//       // drop mouse pointer from the set so remaining entries behave as touches
//       const touchEntries = allEntries.filter(([id]) => id !== this.mousePointerId)
//       const count = touchEntries.length

//       // no touch pointers -> end pan
//       if (count === 0) {
//         if (this.isPanning()) this.stopPan()
//         return
//       }

//       // if we are already panning, update from the active pointer only
//       if (this.isPanning()) {
//         if (this.activePointerId == null) {
//           this.stopPan()
//           return
//         }

//         const p = positions.get(this.activePointerId)
//         if (!p) {
//           this.stopPan()
//           return
//         }

//         this.updatePan(p)
//         return
//       }

//       // start pan when exactly 1 touch exists
//       // if 2+ touches exist, do nothing here (pinch/other recognizers can act)
//       if (count === 1) {
//         const [pointerId, p] = touchEntries[0]
//         this.beginPan(p.x, p.y, pointerId)
//         return
//       }
//     })
//   }

//   // -------------------------------------------------
//   // public api (used by other services if needed)
//   // -------------------------------------------------

//   public beginPanFromTouch = (x: number, y: number, pointerId: number): void => {
//     this.beginPan(x, y, pointerId)
//   }

//   public cancelPanSession = (): void => {
//     this.stopPan()
//   }

//   // optional toggles if you want higher-level orchestration later
//   private disabled = false

//   public disable = (): void => {
//     this.disabled = true
//     this.stopPan()
//   }

//   public enable = (): void => {
//     this.disabled = false
//   }

//   // -------------------------------------------------
//   // internal
//   // -------------------------------------------------

//   private beginPan = (x: number, y: number, pointerId: number): void => {
//     if (this.disabled) return

//     this.activePointerId = pointerId
//     this.lastPos = { x, y }
//     this.isPanning.set(true)
//   }

//   private updatePan = (p: Point): void => {
//     if (this.disabled) return
//     if (!this.lastPos) {
//       this.lastPos = { x: p.x, y: p.y }
//       return
//     }

//     const dx = p.x - this.lastPos.x
//     const dy = p.y - this.lastPos.y

//     // small jitter -> ignore
//     if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
//       return
//     }

//     this.lastPos = { x: p.x, y: p.y }

//     // apply pan through ioc if present (keeps deps near the root)
//     const target = this.getPanTarget()
//     target?.panBy(dx, dy)
//   }

//   private stopPan = (): void => {
//     if (!this.isPanning()) return

//     this.isPanning.set(false)
//     this.activePointerId = null
//     this.lastPos = null
//   }

//   private getPanTarget = (): PanTarget | null => {
//     const ioc = (window as any)?.ioc
//     if (!ioc?.get) return null
//     try {
//       return ioc.get('Pan Target') as PanTarget
//     } catch {
//       return null
//     }
//   }
// }
