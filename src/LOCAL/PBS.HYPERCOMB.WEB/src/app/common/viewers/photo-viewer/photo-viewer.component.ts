import { Component, HostListener } from "@angular/core"
import { Events } from "src/app/helper/events/events"
import { PhotoState } from "src/app/state/feature/photo-state"

@Component({
  standalone: true,
  selector: 'app-photo-viewer',
  templateUrl: './photo-viewer.component.html',
  styleUrls: ['./photo-viewer.component.scss']
})
export class PhotoViewerComponent {
  constructor(private photoState: PhotoState) { }
  public get imageUrl(): string { return this.photoState.imageUrl }

  @HostListener(Events.EscapeCancel, ['$event'])
  close = () => {
    this.photoState.imageUrl = ''
  }
}

