import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent } from "@angular/common/http"
import { Injectable, inject } from "@angular/core"
import { OidcSecurityService } from "angular-auth-oidc-client"
import { Observable, switchMap } from "rxjs"
import { Constants } from "src/app/helper/constants"
import { Hypercomb } from "../mixins/abstraction/hypercomb.base"

@Injectable()
export class OidcTokenInterceptor extends Hypercomb implements HttpInterceptor {
    private secureEndpoints: string[] = [Constants.jsonAiQuery, Constants.imageGeneration, Constants.publishQuery, Constants.storeImage, Constants.validateQuery]
    private oidcSecurityService = inject(OidcSecurityService)

    intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
        // Check if the request URL matches the criteria
        this.debug.log('http', `instercepting: ${req.url}`)

        if (this.secureEndpoints.some(url => req.url.toLowerCase().startsWith(url.toLowerCase()))) {

            // Add the token for these requests
            return this.oidcSecurityService.getAccessToken().pipe(
                switchMap(token => {
                    const headers = req.headers.set('Authorization', `Bearer ${token}`)
                    const authReq = req.clone({ headers })
                    return next.handle(authReq)
                })
            )
        }

        // For other requests, don't modify the request
        return next.handle(req)
    }
}


