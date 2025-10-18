// import { Injectable, inject } from "@angular/core"
// import AWN, { AwnOptions } from 'awesome-notifications'
// import { HypercombMode } from "src/app/core/models/enumerations"
// import { HypercombMixin } from "src/app/core/mixins/abstraction/service-base"
// import { HypercombState } from "src/app/state/core/hypercomb-state"

// @Injectable({
//     providedIn: 'root'
// })
// export class NotificationService extends HypercombMixin(AWN) {

//     constructor() {
//         super({ durations: { info: 0, success: 0, warning: 0 } })
//     }

//     public override info(message: string, options?: AwnOptions | undefined, timeout: number = 2000) {
//         if (this.state.hasMode(HypercombMode.Busy)) new HTMLElement() // suppress override return needs when busy

//         const result = super.info(message, options)

//         setTimeout(() => {
//             result.delete()
//         }, timeout)

//         return result
//     }

//     public override success(message: string, options?: AwnOptions | undefined, timeout: number = 2000) {
//         if (this.state.hasMode(HypercombMode.Busy)) new HTMLElement() // suppress override return needs when busy

//         const result = super.success(message, options)

//         setTimeout(() => {
//             result.delete()
//         }, timeout)
//         return result
//     }

//     public override warning(message: string, options?: AwnOptions | undefined, timeout: number = 2000) {
//         if (this.state.hasMode(HypercombMode.Busy)) new HTMLElement() // suppress override return needs when busy

//         const result = super.warning(message, options)
//         setTimeout(() => {
//             result.delete()
//         }, timeout)
//         return result
//     }

// }


