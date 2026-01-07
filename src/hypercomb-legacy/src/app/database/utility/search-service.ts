import { Injectable } from "@angular/core"

@Injectable({
  providedIn: 'root'
})
export class Searcservice {
  constructor() { }

  public searchImage(query: string) {
    const searchUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`
    window.open(searchUrl, '_blank')
  }
}


