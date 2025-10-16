// import { Injectable } from "@angular/core"
// import { ServiceBase } from "src/app/services/abstraction/service-base"
// import { Constants } from "src/app/unsorted/constants"

// @Injectable({
//   providedIn: 'root'
// })
// export class SignalRService extends ServiceBase {
//   private hubConnection!: HubConnection

//   public startConnection() {
//     // return
//     // this.hubConnection = new HubConnectionBuilder()
//     //   // .configureLogging(LogLevel.Debug)
//     //   .withAutomaticReconnect()
//     //   .withUrl(Constants.connection)
//     //   .withServerTimeout(60 * 1000 * 15)
//     //   .build()


//     // this.hubConnection
//     //   .start()
//     //   .then(() => console.log('Connection started'))
//     //   .catch(err => {

//     //     console.error('Error while starting connection: ' + err)
//     //   })
//   }

//   public sendMessage(message: string, ...args: any[]) {
//     return
//     this.hubConnection.invoke(message, args)
//       .catch(err => console.error(err))
//   }

//   public registerOnServerEvents(methodName: string, action: (...args: any[]) => void) {
//     return
//     this.hubConnection.on(methodName, action)
//   }

//   public unregisterOnServerEvents(methodName: string) {
//     return
//     this.hubConnection.off(methodName)
//   }

//   public isConnected(): boolean {
//     return true
//     // return this.hubConnection.state === HubConnectionState.Connected
//   }
// }


