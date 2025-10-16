import { Injectable, inject } from "@angular/core"
import { HypercombMode } from "../core/models/enumerations"
import { ServiceBase } from "../core/mixins/abstraction/service-base"
import { GoogleState } from "../state/feature/google-state"
import { ILinkResolver, IGoogleLink } from "./i-navigation-interfaces"

@Injectable({ providedIn: 'root' })
export class GoogleLinkResolver extends ServiceBase implements ILinkResolver {
    private readonly googleState = inject(GoogleState)

    public resolve(link: string) {
        const googleLink = this.parseGoogleLink(link)
        if (!googleLink) {
            throw new Error("Cannot resolve the provided link.")
        }
        this.state.setMode(HypercombMode.ViewingGoogleDocument)
        this.googleState.setGoogleLink(googleLink)
    }

    public canResolve(link: string): boolean {
        const resolvable = !!this.parseGoogleLink(link)
        return resolvable
    }

    private parseGoogleLink(link: string): IGoogleLink | null {
        const match = link.match(/https:\/\/docs\.google\.com\/(presentation|document)\/d\/e\/(2PACX-[\w-]+)\/(embed|pub)/)

        if (!match) {
            return null
        }

        const type = match[1] // Extract the type (presentation or document)
        const identifier = match[2] // Extract the identifier
        const params = new URL(link).searchParams.toString() // Extract query parameters if any

        return { link, type, identifier, params }
    }


}


