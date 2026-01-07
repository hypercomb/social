import { Component, ElementRef, HostListener, ViewChild, computed, signal, effect, inject } from '@angular/core'
import { DomSanitizer } from '@angular/platform-browser'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { HypercombMode } from 'src/app/core/models/enumerations'
import { Events } from 'src/app/helper/events/events'
import { GoogleState } from 'src/app/state/feature/google-state'

@Component({
  standalone: true,
  selector: 'app-google-docs-viewer',
  templateUrl: './google-docs-viewer.component.html',
  styleUrls: ['./google-docs-viewer.component.scss']
})
export class GoogleDocsViewerComponent extends Hypercomb {
  @ViewChild('doc', { static: false }) doc!: ElementRef<HTMLIFrameElement>
private googleState = inject( GoogleState)

  // expose as a signal instead of getter
  public readonly isShowingGoogleDocument = computed(() =>
    this.state.hasMode(HypercombMode.ViewingGoogleDocument)
  )

  // reactive source
  public readonly source = signal<any>(undefined)

  private readonly googleLink = this.googleState.googleLink()

  constructor( private sanitizer: DomSanitizer) {
    super( )

    effect(() => {
      const googleLink = this.googleState.googleLink()
      if (!googleLink?.identifier) {
        this.state.removeMode(HypercombMode.ViewingGoogleDocument)
        this.source.set(undefined)
        return
      }

      const { identifier, params, type } = googleLink
      this.state.setMode(HypercombMode.ViewingGoogleDocument)

      switch (type) {
        case 'document':
          this.source.set(
            this.sanitizer.bypassSecurityTrustResourceUrl(
              `https://docs.google.com/${type}/d/e/${identifier}/pub?${params}`
            )
          )
          break
        case 'presentation':
          this.source.set(
            this.sanitizer.bypassSecurityTrustResourceUrl(
              `https://docs.google.com/${type}/d/e/${identifier}/embed?${params}`
            )
          )
          break
      }
    })
  }

  @HostListener(Events.EscapeCancel, ['$event'])
  clear = () => {
    this.googleState.clear()
  }
}
