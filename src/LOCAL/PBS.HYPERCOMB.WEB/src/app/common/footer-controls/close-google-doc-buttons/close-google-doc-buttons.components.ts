import { Component, HostListener } from '@angular/core'
import { HttpsLinkResolver } from 'src/app/services/navigation/https-link-resolver'
import { GoogleState } from 'src/app/state/feature/google-state'

@Component({
  standalone: true,
  selector: '[app-close-google-doc-buttons]',
  templateUrl: './close-google-doc-buttons.html',
  styleUrls: ['./close-google-doc-buttons.scss']
})
export class CloseGoogleDocButtons {

  constructor(private googleState: GoogleState, private httpsLinkResolver: HttpsLinkResolver) { }

  @HostListener('document:keydown.enter', ['$event'])
  handleEnterKey = (event: KeyboardEvent) => {
    event.preventDefault() // Prevent default Enter behavior if necessary
    this.close()
  }

  public close() {
    this.googleState.clear()
  }

  public openInNewTab() {
    const source = this.googleState.googleLink.link
    this.httpsLinkResolver.resolve(source)
    this.close()
  }
}


