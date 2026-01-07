import { HttpClient } from "@angular/common/http"
import { Injectable } from "@angular/core"
import { firstValueFrom, map, catchError, of } from "rxjs"

@Injectable({
  providedIn: 'root'
})
export class WakeupService {

  constructor(private http: HttpClient) {
    // Start the periodic reset
    //this.startPeriodicReset()
  }

  public initialize = async () => {
    // const maxRetries = 18 // 90 seconds / 5 seconds
    // let attempts = 0
    // const url = Constants.accountsUrl

    // const retry = async () => {
    //   if (attempts >= maxRetries) {
    //     console.error('Failed to wake up the server after multiple attempts.')
    //     return
    //   }
    //   attempts++
    //   const result = await this.makeRequest(url)
    //   if (result) {
    //     this.state.awake = true

    //     // Notify the component or perform an action when a 200 status code is encountered
    //     // console.log('Server is up, showing the sign-in button.')
    //     return
    //   }
    //   await this.delay(5000)
    //   await retry()
    // }

    // await retry()
  }

  private async makeRequest(url: string): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.http.get(url, { observe: 'response' }).pipe(
          map(response => response.status >= 200 && response.status < 300),
          catchError(() => of(false))
        )
      )
      return response
    } catch (error) {
      return false
    }
  }

  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private startPeriodicReset() {
    // setInterval(() => {
    //   this.state.awake = false
    //   console.log('Resetting awake state and reinitializing.')
    //   this.initialize()
    // }, 300000) // 300000 ms = 5 minutes
  }
}


