import { Injectable, inject, effect } from "@angular/core"
import { Router } from "@angular/router"
import { OidcSecurityService } from "angular-auth-oidc-client"
import { Hypercomb } from "../mixins/abstraction/hypercomb.base"

@Injectable({ providedIn: 'root' })
export class Autservice extends Hypercomb {
    private readonly router = inject(Router)

    constructor() {
        super()

        // shortcut: "." to sign out
        effect(() => {
            const e = this.ks.keyUp()
            if (!e) return

            if (this.ks.when(e).only('.')) {
                e.preventDefault()
                this.signOut()
            }
        })
    }
    public signIn = async () => {
        try {
            // const returnUrl = this.router.url
            // localStorage.setItem('returnUrl', returnUrl)
            // await this.oidcSecurityService.authorize()
        } catch (err) {
            console.error('Sign-in failed', err)
        }
    }

    public signOut = () => {
        // this.oidcSecurityService.logoff().subscribe({
        //     next: () => this.debug.log('auth', 'Sign-out initiated'),
        //     error: (err) => console.error('Sign-out failed', err),
        // })
    }
}


