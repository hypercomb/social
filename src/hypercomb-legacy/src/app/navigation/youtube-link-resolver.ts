import { Injectable, inject } from "@angular/core"
import { HypercombMode } from "../core/models/enumerations"
import { Hypercomb } from "../core/mixins/abstraction/hypercomb.base"
import { ILinkResolver } from "./i-navigation-interfaces"
import { YoutubeService } from "./youtube-service"

@Injectable({ providedIn: 'root' })
export class YouTubeLinkResolver extends Hypercomb implements ILinkResolver {
  private readonly youtube = inject(YoutubeService)

  public resolve(link: string): boolean {
    const url = (link ?? '').trim()
    if (!url) return false

    const id = this.youtube.parse(url) // should return videoId or null
    if (!id) return false
    this.state.setMode(HypercombMode.YoutubeViewer)
    return true
  }

  public canResolve(link: string): boolean {
    const url = (link ?? '').trim()
    return !!url && !!this.youtube.parse(url)
  }
}


