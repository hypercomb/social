import { Component, OnInit, OnDestroy, AfterViewInit, inject, ViewChild, ElementRef } from "@angular/core"
import { FormsModule } from "@angular/forms"
import { HypercombData } from "src/app/actions/hypercomb-data"
import { AiService } from "src/app/ai/ai-service"
import { IndexAllocator } from "src/app/ai/index-allocator"
import { LmClient } from "src/app/ai/lm-client"
import { TileCreationService } from "src/app/ai/tile-creation.service"
import { HypercombMode } from "src/app/core/models/enumerations"
import { HONEYCOMB_STORE } from "src/app/shared/tokens/i-honeycomb-store.token"
import { CdkDragMove } from '@angular/cdk/drag-drop'

@Component({
  standalone: true,
  selector: 'app-chat-window',
  templateUrl: './chat-window.component.html',
  imports: [FormsModule],
  styleUrls: ['./chat-window.component.scss']
})
export class ChatWindowComponent extends HypercombData implements OnInit, OnDestroy, AfterViewInit {

  private readonly ai = inject(AiService)
  private readonly tiles = inject(TileCreationService)
  private readonly indexes = inject(IndexAllocator)
  private readonly store = inject(HONEYCOMB_STORE)

  @ViewChild('chatwindow', { static: true })
  chatwindowRef!: ElementRef<HTMLDivElement>

  messages: any[] = []
  newMessage = ''
  followupMode = false // <-- important toggle flag

  panelWidth = 400
  minWidth = 400
  maxWidth = 600

  constructor() {
    super()
  }

  ngOnInit() {
    setTimeout(() => (this.state.ignoreShortcuts = true), 50)
    this.messages.push({ content: "Hi! I now create tiles instantly.", isUser: false })
  }

  ngAfterViewInit() {
    this.chatwindowRef.nativeElement.focus()
  }

  ngOnDestroy() {
    this.state.ignoreShortcuts = false
  }

  get isOpen(): boolean {
    return this.state.hasMode(HypercombMode.ShowChat)
  }

  // ---------------------------------------------------------
  // MAIN LOGIC
  // ---------------------------------------------------------

  public async sendMessage(): Promise<void> {
    if (!this.newMessage.trim()) return

    const userInput = this.newMessage.trim()
    this.messages.push({ content: userInput, isUser: true })
    this.messages.push({ content: "Thinking...", isUser: false })

    try {
      const count = this.extractCount(userInput) ?? 10
      const topic = this.stripCount(userInput)

      const body = this.followupMode
        ? LmClient.buildFollowupRequest(topic, count)
        : LmClient.buildDefaultRequest(topic, count)

      const response = await fetch("http://127.0.0.1:4220/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })

      if (!response.ok) throw new Error(await response.text())

      const raw = (await response.json())?.choices?.[0]?.message?.content ?? ""
      const items = this.extractArray(raw)

      if (!items.length) {
        this.messages[this.messages.length - 1].content = "Invalid output — no list returned."
        return
      }

      const parent = this.stack.cell()
      if (!parent) {
        this.messages[this.messages.length - 1].content = "Select a tile first."
        return
      }

      const used = await this.store.cells().map(c => c.index)
      const createdNames: string[] = []

      for (const item of items) {
        const index = this.indexes.nextFreeIndex(used)
        used.push(index)
        createdNames.push(await this.tiles.createTile(item, parent, index))
      }

      this.messages[this.messages.length - 1].content =
        "Created:\n• " + createdNames.join("\n• ")

    } catch {
      this.messages[this.messages.length - 1].content = "AI error."
    }

    this.newMessage = ''
  }

  // ---------------------------------------------------------
  // UTILITIES
  // ---------------------------------------------------------

  private extractArray(text: string): any[] {
    try {
      const p = JSON.parse(text)
      if (Array.isArray(p)) return p
    } catch {}

    const matches = text.match(/\[[\s\S]*\]/g) || []
    for (const chunk of matches.sort((a, b) => b.length - a.length)) {
      try {
        const arr = JSON.parse(chunk)
        if (Array.isArray(arr)) return arr
      } catch {}
    }
    return []
  }

  private extractCount(input: string): number | null {
    const m = input.match(/(?:^|\D)(\d{1,2})(?:\D|$)/)
    return m ? Math.min(Math.max(+m[1], 1), 20) : null
  }

  private stripCount(input: string): string {
    return input.replace(/\d{1,2}/, "").replace(/[|:]/g, "").trim()
  }

  onDragMoved(event: CdkDragMove) {
    this.panelWidth = Math.min(
      this.maxWidth,
      Math.max(this.minWidth, this.panelWidth + event.distance.x)
    )
  }
}
