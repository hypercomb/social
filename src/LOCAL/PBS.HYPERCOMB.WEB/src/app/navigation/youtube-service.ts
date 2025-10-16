import { Injectable } from "@angular/core"
import { IYouTubeLink } from "./i-navigation-interfaces"

@Injectable({ providedIn: 'root' })
export class YoutubeService {

  public parse(link: string): IYouTubeLink | null {
    let url: URL
    try {
      url = new URL(link)
    } catch {
      return null
    }

    const host = url.hostname.toLowerCase()
    let videoId: string | null = null

    if (host === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] || null
    }

    if (!videoId && host.includes("youtube.com")) {
      if (url.pathname === "/watch") {
        videoId = url.searchParams.get("v")
      } else if (url.pathname.startsWith("/embed/")) {
        videoId = url.pathname.split("/")[2] || null
      } else if (url.pathname.startsWith("/shorts/")) {
        videoId = url.pathname.split("/")[2] || null
      }
    }

    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return null
    }

    return { link, videoId }
  }
}


