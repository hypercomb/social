import { Injectable } from "@angular/core"
import { ILinkResolver } from "./i-navigation-interfaces"

@Injectable({ providedIn: 'root' })
export class HttpsLinkResolver implements ILinkResolver {

    public resolve(link: string) {
        if (!this.canResolve(link)) {
            throw new Error("Cannot resolve the link.")
        }
        // Open the link in a new background tab
        window.open(link, '_blank')
    }

    public canResolve(link: string): boolean {
        const httpsPattern = /^https:\/\//
        return httpsPattern.test(link)
    }
}


