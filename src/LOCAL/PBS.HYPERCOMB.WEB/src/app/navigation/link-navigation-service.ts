declare var window: any
import { Injectable, inject, effect } from '@angular/core'
import { EditorService } from '../state/interactivity/editor-service'
import { HttpsLinkResolver } from './https-link-resolver'
import { ILinkResolver } from './i-navigation-interfaces'
import { YouTubeLinkResolver } from './youtube-link-resolver'
import { Cell } from '../cells/cell'
import { COMB_STORE } from '../shared/tokens/i-comb-store.token'
import { Hypercomb } from '../core/mixins/abstraction/hypercomb.base'

@Injectable({ providedIn: 'root' })
export class LinkNavigationService extends Hypercomb {
    private readonly store = inject(COMB_STORE)
    private readonly es = inject(EditorService)
    private _cancelled = false
    private resetTimeout: any
    private isMouseOverControlBar = false
    private youtube = inject(YouTubeLinkResolver)
    private linkResolver = inject(HttpsLinkResolver)

    private get linkResolvers(): ILinkResolver[] {
        return [this.youtube, this.linkResolver]
    }

    public get cancelled(): boolean { return this._cancelled }
    public set cancelled(value: boolean) { this._cancelled = value }

    constructor() {
        super()


        effect(() => {
            this.isMouseOverControlBar = this.ls.isMouseOverControlBar()
            this.debug.log('ui', 'isMouseOverControlBar', this.isMouseOverControlBar)
        })

        // dblclick as a reactive effect
        effect(onCleanup => {
            const handler = (event: MouseEvent) => {
                void event
                if (this.state.isMobile || this.isMouseOverControlBar || this.es.isEditing()) return

                const active = this.stack.cell()
                const entry = active ? this.store.lookupData(active.cellId) : undefined

                if (!!entry) {
                    void this.openLink(entry)                            // âœ… fire-and-forget
                }
            }

            document.addEventListener('dblclick', handler)
            onCleanup(() => document.removeEventListener('dblclick', handler))
        })
    }


    public checkPopupBlocked = async (): Promise<boolean> => {
        const testPopup = window.open('', '_blank', 'width=1,height=1')
        if (testPopup) {
            testPopup.close()
            return false
        } else {
            return true
        }
    }

    public openLink = async (cell?: Cell) => {
        if (!cell) return

        const link = cell.link
        for (const resolver of this.linkResolvers) {
            if (resolver.canResolve(link)) {
                resolver.resolve(link)
                return
            }
        }
    }

    public setResetTimeout() {
        this.cancelled = true
        if (this.resetTimeout) clearTimeout(this.resetTimeout)
        this.resetTimeout = setTimeout(() => {
            this.debug.log('misc', 'reset from timeout...')
            this.cancelled = false
        }, 175)
    }
}


