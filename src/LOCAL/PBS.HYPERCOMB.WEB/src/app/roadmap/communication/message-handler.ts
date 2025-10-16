// import { Injectable, Injector } from "@angular/core"
// import { DataServiceBase } from "src/app/actions/command.base"
// import { SerializationService } from "src/app/database/persistence/serialization-service"
// import { HypercombState } from "src/app/state/core/hypercomb-state"
// import { CellManager } from "src/app/tile/management/tile-manager"
// import { ContextStack } from "src/app/unsorted/controller/context-stack"
// import { NotificationService } from "src/app/unsorted/utility/notification-service"
// import { Type } from "ts-morph"

// @Injectable({
//     providedIn: 'root'
// })
// export abstract class MessageHandler extends DataServiceBase {

//     private subscription?: (...args: any[]) => void
//     protected get AllowCollaboration(): boolean { return window.localStorage.getItem("AllowCollaboration") == "true" }

//     protected get HypercombState(): HypercombState { return this.injector.get(HypercombState ) }
//     protected get NotificationService(): NotificationService { return this.injector.get(NotificationService) }
//     protected get SerializationService(): SerializationService { return this.injector.get(SerializationService) }
//     protected get SignalRService(): SignalRService { return this.injector.get<SignalRService>(SignalRService as Type<SignalRService>) }
//     protected get StorageManager(): StorageManager { return this.injector.get<StorageManager>(StorageManager as Type<StorageManager>) }
//     protected get CellManager(): CellManager { return this.injector.get<CellManager>(CellManager as Type<CellManager>) }
//     protected get ContextStack(): ContextStack { return this.injector.get<ContextStack>(ContextStack as Type<ContextStack>) }

//     public abstract get method(): string

//     protected abstract onHandle(...args: any)

//     constructor(injector: Injector) {
//         super(injector)
//     }

//     protected abstract canHandle(...args: any[]): Promise<boolean>

//     protected handle = async (...args: any[]) => {
//         if (!this.AllowCollaboration) {
//             this.debug.log('ui', "Collaboration is disabled")
//             return
//         }

//         if (!await this.canHandle(...args)) {
//             this.debug.log('error', "canHandle returned false")
//             return
//         }
//         await this.onHandle(...args)
//         this.subscription?.call(args)
//     }

//     protected IsSender = async (sender: string): Promise<boolean> => {
//         return localStorage.getItem("user-identifier") == sender
//     }

//     public register = () => {
//         this.SignalRService.registerOnServerEvents(this.method, this.handle)
//     }

//     public subscribe = (handler: (...args: any[]) => void) => {
//         this.subscription = handler
//     }

//     public unregister = () => {
//         this.SignalRService.unregisterOnServerEvents(this.method)
//     }
// }


