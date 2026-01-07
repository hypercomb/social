

// @Injectable({
//     providedIn: 'root'
// })
// export abstract class SignalMessage {
//     protected get UserIdentifier(): string { return localStorage.getItem("user-identifier") ?? 'user identity is required' }
//     protected abstract get message(): string

//     protected get ImageDatabase(): ImageDatabase { return this.injector.get<ImageDatabase>(ImageDatabase as Type<ImageDatabase>) }
//     protected get SerializationService(): SerializationService { return this.injector.get<SerializationService>(SerializationService as Type<SerializationService>) }
//     protected get signalRService(): SignalRService { return this.injector.get<SignalRService>(SignalRService as Type<SignalRService>) }

//     constructor(private injector: Injector) { }

//     public cleanup = async (...args: any[]) => {
//         return
//         this.onCleanup(...args)
//     }
//     protected onCleanup = async (...args: any[]) => { }

//     public send = async (...args: any[]) => {
//         return
//         try {
//             const parameters = await this.overrideArgs(...args)
//             if (await this.internalCanSend(this.message, ...parameters)) {
//                 await this.setup(...parameters)

// this.debug.log('http', `sending messag ${this.message} (${parameters[0]}, ${parameters[1]}, ${parameters[2]}}`)
//                 this.signalRService.sendMessage(this.message, this.UserIdentifier, ...parameters)
//             }
//             await this.cleanup(...args)
//         }
//         catch (err) {
//            // debugger
//             throw err
//         }
//     }

//     protected setup = async (...args: any[]) => { }
//     protected canSend = async (...args: any[]): Promise<boolean> => {
//         return true
//     }

//     private internalCanSend = async (...args: any[]): Promise<boolean> => {
//         return this.signalRService.isConnected() && await this.canSend(this.message, ...args)
//     }

//     protected overrideArgs = async (...args: any[]): Promise<any[]> => {
//         return args
//     }
// }


