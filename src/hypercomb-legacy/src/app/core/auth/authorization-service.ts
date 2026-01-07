import { Injectable } from "@angular/core"

const RedirectUrl = 'RedirectUrl'

@Injectable({
  providedIn: 'root'
})
export class AuthorizationService {

  public get hasRedirect(): boolean { return !!sessionStorage.getItem(RedirectUrl) }

  public setRedirect() {
    const currentUrl = window.location.href
    sessionStorage.setItem(RedirectUrl, currentUrl)
  }

  public redirectToSavedUrl() {

    // cancel if there is no redirection url
    const redirect = sessionStorage.getItem(RedirectUrl)
    if (!redirect) return

    sessionStorage.removeItem(RedirectUrl)
    window.location.href = redirect
  }
}


