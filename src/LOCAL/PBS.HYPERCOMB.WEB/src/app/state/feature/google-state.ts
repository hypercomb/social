import { Injectable, signal } from "@angular/core"
import { IGoogleLink } from "src/app/navigation/i-navigation-interfaces"

@Injectable({
  providedIn: 'root'
})
export class GoogleState {

  // signal is the single source of truth
  private readonly _googleLink = signal<IGoogleLink>({} as IGoogleLink)

  // expose as readonly for consumers
  public readonly googleLink = this._googleLink.asReadonly()

  public blocked = true

  // convenience getter
  public get currentLink(): IGoogleLink {
    return this._googleLink()
  }

  // convenience setter
  public set currentLink(value: IGoogleLink) {
    this._googleLink.set(value)
  }

  public clear() {
    this._googleLink.set({} as IGoogleLink)
  }

  public setGoogleLink = (googleLink: IGoogleLink) => {
    this._googleLink.set(googleLink)
  }
}


