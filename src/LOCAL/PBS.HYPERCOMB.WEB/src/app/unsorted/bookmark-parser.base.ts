// bookmark-parser.base.ts
import { Injectable } from "@angular/core"
import { BookMarkData } from "../core/models/bookmarks"

interface Bookmark {
    link: string
    name: string
    ico: string // As before, favicon extraction is non-trivial.
}


@Injectable({
    providedIn: 'root'
})
export class BookmakrParser {
    bookmarks: any[] = []
    constructor() { }

    extractBookmarksFromHTML() {
        const htmlContent = BookMarkData

        const parser = new DOMParser()
        const doc = parser.parseFromString(htmlContent, 'text/html')
        const anchors = <any>doc.querySelectorAll('a')

        for (const anchor of anchors) {
            const link = <string>anchor.href
            const name = <string>anchor.textContent
            const ico = anchor.getAttribute('ICON') || ''
            this.bookmarks.push({ link, name, ico })
        }
    }

}
