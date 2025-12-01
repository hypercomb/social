import { CdkDragMove } from '@angular/cdk/drag-drop'
import { AfterViewInit, Component, effect, ElementRef, inject, OnDestroy, OnInit, ViewChild } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { environment } from 'src/environments/environment'
import { HypercombMode } from '../../core/models/enumerations'
import { HypercombData } from 'src/app/actions/hypercomb-data'
import { HierarchyService } from 'src/app/services/hiearchy-service'
import { MODIFY_COMB_SVC } from 'src/app/shared/tokens/i-comb-service.token'
import { CELL_CREATOR } from 'src/app/inversion-of-control/tokens/tile-factory.token'

interface ChatMessage {
  content: string
  isUser?: boolean
}

@Component({
  standalone: true,
  imports: [FormsModule],
  selector: 'app-chat-window',
  templateUrl: './chat-window.component.html',
  styleUrls: ['./chat-window.component.scss']
})
export class ChatWindowComponent extends HypercombData implements OnInit, OnDestroy, AfterViewInit {
 private readonly modify = inject(MODIFY_COMB_SVC)
 private readonly creator = inject(CELL_CREATOR)

  private readonly hierarchyService = inject(HierarchyService)

  @ViewChild('chatwindow', { static: true }) chatwindowRef!: ElementRef<HTMLDivElement>

  messages: ChatMessage[] = []
  newMessage = ''
  panelWidth = 400
  minWidth = 400
  maxWidth = 600

  // ---------------------------
  // SYSTEM PROMPT + SCHEMA
  // ---------------------------

  private readonly SYSTEM = `
You are a precise list generator.

Your job:
Given a single subject, produce a flat JSON array where each element is an object with:
- "name": a short 1–3 word label directly related to the subject
- "detail": a concise descriptive phrase (5–12 words)

Rules:
1. The list size is determined by user instruction.
2. If no count is given, output exactly 10 items.
3. Items must be unique.
4. Format is strictly: { "name": "...", "detail": "..." }.
5. Output ONLY the JSON array. No markdown, no text.
6. Must conform to the provided JSON schema.
`

  private readonly SCHEMA = {
    type: "json_schema",
    json_schema: {
      name: "FlatNamedList",
      schema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            detail: { type: "string" }
          },
          required: ["name", "detail"]
        },
        minItems: 1,
        maxItems: 20
      }
    }
  }

  // ---------------------------

  constructor() {
    super()

    effect(() => {
      const message = this.state.logOutput()
      if (!environment.production) return

      this.messages.push({
        content: message,
        isUser: false
      })
    })
  }

  // ---------------------------

  public ngAfterViewInit() {
    setTimeout(() => this.state.ignoreShortcuts = true, 50)
    const element = this.chatwindowRef.nativeElement
    element.focus()
    element.addEventListener('keyup', this.handleKeyup)
  }

  public ngOnInit() {
    this.messages.push({
      content: 'Hi! I can help you generate lists, organize tiles, and assist with your workspace.',
      isUser: false
    })
  }

  public ngOnDestroy() {
    this.state.ignoreShortcuts = false
    this.chatwindowRef.nativeElement.removeEventListener('keyup', this.handleKeyup)
  }

  get isOpen(): boolean {
    return this.state.hasMode(HypercombMode.ShowChat)
  }

  // ---------------------------
  // CHAT SEND MESSAGE
  // ---------------------------

 public async sendMessage() {
  if (!this.newMessage.trim()) return

  const userInput = this.newMessage.trim()
  this.messages.push({ content: userInput, isUser: true })

  // show thinking bubble
  this.messages.push({ content: 'Thinking...', isUser: false })

  try {
    // determine requested count
    const count = this.extractCount(userInput) ?? 10
    const cleanedPrompt = this.stripCount(userInput)

    // -------------------------
    // CALL LM STUDIO
    // -------------------------
    const response = await fetch("http://127.0.0.1:4220/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.2-3b-instruct",
        response_format: this.SCHEMA,
        messages: [
          {
            role: "system",
            content: this.SYSTEM + `\nRequested count: ${count}`
          },
          {
            role: "user",
            content: cleanedPrompt
          }
        ]
      })
    })

    if (!response.ok) {
      this.messages[this.messages.length - 1] = {
        content: `Error: ${response.status} ${await response.text()}`,
        isUser: false
      }
      this.newMessage = ''
      return
    }

    const data = await response.json()
    const raw = data?.choices?.[0]?.message?.content ?? ""
    const items = this.extractArray(raw)

    if (!items.length) {
      this.messages[this.messages.length - 1] = {
        content: 'No valid items returned.',
        isUser: false
      }
      return
    }

    // -------------------------
    // CREATE TILES IN HIVE
    // -------------------------
    const parent = this.stack.cell()
    if (!parent) {
      this.messages[this.messages.length - 1] = {
        content: 'No active parent tile selected.',
        isUser: false
      }
      return
    }

    // get existing children count → next index
    let index = await this.repository.fetchChildCount(parent.cellId!)

    const createdNames: string[] = []

    for (const item of items) {
      const newTile = this.creator.newCell({
        name: item.name,
        index,
        hive: parent.hive,
        sourceId: parent.cellId,
        hasChildrenFlag: "false",
        imageHash: "" // optionally add default tile image
      })

      await this.modify.addCell(newTile)
      index++
      createdNames.push(item.name)
    }

    // update parent flag
    await this.modify.updateHasChildren(parent)

    // -------------------------
    // UPDATE CHAT WINDOW
    // -------------------------
    this.messages[this.messages.length - 1] = {
      content: createdNames.length
        ? `Created ${createdNames.length} tiles:\n• ${createdNames.join('\n• ')}`
        : "No tiles created.",
      isUser: false
    }

  } catch (err) {
    console.error(err)
    this.messages[this.messages.length - 1] = {
      content: 'Could not connect to LM Studio on port 4220.',
      isUser: false
    }
  }

  this.newMessage = ''
}


  // ---------------------------
  // HELPERS
  // ---------------------------

  private extractArray(text: string): any[] {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) return parsed
    } catch {}

    const matches = text.match(/\[[\s\S]*\]/g) || []
    for (const m of matches.sort((a, b) => b.length - a.length)) {
      try {
        const parsed = JSON.parse(m)
        if (Array.isArray(parsed)) return parsed
      } catch {}
    }
    return []
  }

  private extractCount(input: string): number | null {
    const m = input.match(/(?:^|\D)(\d{1,2})(?:\D|$)/)
    if (!m) return null
    const n = parseInt(m[1], 10)
    if (isNaN(n)) return null
    return Math.min(Math.max(n, 1), 20)
  }

  private stripCount(input: string): string {
    return input.replace(/\d{1,2}/, '').replace(/[|:]/g, '').trim()
  }

  public handleKeyup(event: KeyboardEvent) {
    if (!(event.key === 'i' && event.altKey) || event.ctrlKey || event.shiftKey || event.repeat) return
    event.preventDefault()
    event.stopPropagation()
    this.state.clearToolMode()
  }

  // ---------------------------

  onDragMoved(event: CdkDragMove) {
    const newWidth = this.panelWidth + event.distance.x
    this.panelWidth = Math.max(this.minWidth, Math.min(this.maxWidth, newWidth))
  }
}
