import { AfterViewInit, Component, inject } from '@angular/core'
import { YouTubePlayerModule } from '@angular/youtube-player'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { CoordinateDetector } from 'src/app/helper/detection/coordinate-detector'
import { YoutubeService } from 'src/app/navigation/youtube-service'
import { ScreenService } from 'src/app/services/screen-service'


@Component({
  standalone: true,
  selector: 'app-youtube-viewer',
  imports: [YouTubePlayerModule],
  templateUrl: './youtube-viewer.component.html',
  styleUrl: './youtube-viewer.component.scss'
})
export class YoutubeViewerComponent extends Hypercomb implements AfterViewInit {
  private readonly youtubeService = inject(YoutubeService)
  private readonly screen = inject(ScreenService)
  private readonly detector = inject(CoordinateDetector)

  public currentVideoId = ''
  public width = 0
  public height = 0

  constructor(

  ) {
    super()
    this.width = this.screen.windowWidth()
    this.height = (this.width * 9) / 16 // maintain 16:9 aspect ratio
  }

  ngAfterViewInit() {
    const cell = this.detector.activeCell() 
    if (!cell?.link) return

    const parsed = this.youtubeService.parse(cell.link)
    if (parsed?.videoId) {
      this.loadVideo(parsed.videoId)
      this.debug.log('misc', cell)
    }
  }

  public loadVideo = (id: string) => {
    this.currentVideoId = id
  }
}


