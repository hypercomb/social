// src/app/common/chat-window/chat-window.component.ts
import { CdkDragMove } from '@angular/cdk/drag-drop'
import { AfterViewInit, Component, effect, ElementRef, inject, OnDestroy, OnInit, ViewChild } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { environment } from 'src/environments/environment'
import { HypercombMode } from '../../core/models/enumerations'
import { HypercombData } from 'src/app/actions/hypercomb-data'
import { MODIFY_COMB_SVC } from 'src/app/shared/tokens/i-comb-service.token'
import { CELL_CREATOR, CELL_FACTORY } from 'src/app/inversion-of-control/tokens/tile-factory.token'
import { TILE_FACTORY } from 'src/app/shared/tokens/i-hypercomb.token'
import { Cell } from 'src/app/cells/cell'
import { ImagePreloader } from 'src/app/hive/rendering/image-preloader.service'
import { HONEYCOMB_STORE, STAGING_ST } from 'src/app/shared/tokens/i-comb-store.token'
import { PIXI_MANAGER } from 'src/app/shared/tokens/i-pixi-manager.token'

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
  private readonly tileFactory = inject(TILE_FACTORY)
  private readonly store = inject(HONEYCOMB_STORE)
  private readonly pixi = inject(PIXI_MANAGER)

  @ViewChild('chatwindow', { static: true }) chatwindowRef!: ElementRef<HTMLDivElement>

  messages: ChatMessage[] = []
  newMessage = ''
  panelWidth = 400
  minWidth = 400
  maxWidth = 600

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
    type: 'json_schema',
    json_schema: {
      name: 'FlatNamedList',
      schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            detail: { type: 'string' }
          },
          required: ['name', 'detail']
        },
        minItems: 1,
        maxItems: 20
      }
    }
  }

  constructor() {
    super()

    effect(() => {
      const message = this.state.logOutput()
      if (!environment.production) return
      this.messages.push({ content: message, isUser: false })
    })
  }

  public ngOnInit() {
    this.messages.push({
      content: 'Hi! I now create tiles instantly just like ghost hover.',
      isUser: false
    })
  }

  public ngAfterViewInit() {
    setTimeout(() => (this.state.ignoreShortcuts = true), 50)
    const element = this.chatwindowRef.nativeElement
    element.focus()
    element.addEventListener('keyup', this.handleKeyup)
  }

  public ngOnDestroy() {
    this.state.ignoreShortcuts = false
    this.chatwindowRef.nativeElement.removeEventListener('keyup', this.handleKeyup)
  }

  get isOpen(): boolean {
    return this.state.hasMode(HypercombMode.ShowChat)
  }

  // ---------------------------------------------------------------------
  // MAIN MESSAGE HANDLER
  // ---------------------------------------------------------------------

  public async sendMessage(): Promise<void> {
    if (!this.newMessage.trim()) return

    const userInput = this.newMessage.trim()
    this.messages.push({ content: userInput, isUser: true })
    this.messages.push({ content: 'Thinking...', isUser: false })

    try {
      const count = this.extractCount(userInput) ?? 10
      const cleanedPrompt = this.stripCount(userInput)

      const response = await fetch('http://127.0.0.1:4220/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.2-3b-instruct',
          temperature: 0.15,
          top_p: 0.85,
          top_k: 40,
          min_p: 0.05,
          repeat_penalty: 1.1,
          response_format: this.SCHEMA,
          messages: [
            { role: 'system', content: this.SYSTEM + `\nRequested count: ${count}` },
            { role: 'user', content: cleanedPrompt }
          ]
        })
      })

      if (!response.ok) {
        this.messages[this.messages.length - 1].content =
          `Error: ${response.status} ${await response.text()}`
        this.newMessage = ''
        return
      }

      const raw = (await response.json())?.choices?.[0]?.message?.content ?? ''
      const items = this.extractArray(raw)
      if (!items.length) {
        this.messages[this.messages.length - 1].content = 'Invalid output — no list returned.'
        return
      }

      const parent = this.stack.cell()
      if (!parent) {
        this.messages[this.messages.length - 1].content = 'Select a tile first.'
        return
      }

      // ---------------------------------------------------------------
      // index allocation:
      // - load all existing children
      // - build a set of used indexes
      // - start at 0 and advance until a free index is found for each item
      // ---------------------------------------------------------------

      // you can swap this for whatever method returns children for this parent
      const indexes = await this.store.cells().map(c => c.index)

      let index = 0
      const createdNames: string[] = []

      for (const item of items) {
        // advance index until we find a free slot
        while (indexes.includes(index)) {
          index++
        }

        await this.create(item, parent, index)
        createdNames.push(item.name)
        index++ // move to the next candidate index
      }

      await this.modify.updateHasChildren(parent)
      this.messages[this.messages.length - 1].content =
        `Created:\n• ${createdNames.join('\n• ')}`

    } catch {
      this.messages[this.messages.length - 1].content =
        'Could not reach LM Studio (port 4220)'
    }

    this.newMessage = ''
  }

  // ---------------------------------------------------------------------
  // TILE CREATION (USES PROVIDED INDEX)
  // ---------------------------------------------------------------------

 private async create(item: any, parent: Cell, index: number): Promise<void> {
  // create a ghost entry (temporary visual like before)
  const ghost = await this.creator.createGhost({ index, hive: parent.hive })
  if (!ghost) return

  // render the ghost immediately for instant feedback
  const tile = await this.tileFactory.create(ghost as unknown as Cell)
  tile.alpha = 0.6
  tile.eventMode = 'none'
  tile.zIndex = 200

  const container = this.pixi.container
  if (container) {
    container.sortableChildren = true
    container.addChild(tile)
  }

  // build the real cell based on the ghost data
  const newCell = this.creator.newCell({
    name: item.name,
    index,
    hive: parent.hive,
    sourceId: parent.cellId,
    imageHash: ghost.imageHash
  })
  newCell.setKind('Cell')

  // save to db
  const saved = await this.modify.addCell(newCell)

  // replace the ghost with the final cell
  if (container && tile.parent) {
    tile.parent.removeChild(tile)
    tile.destroy({ children: true })
  }

  const finalTile = await this.tileFactory.create(saved)
  finalTile.alpha = 1
  finalTile.eventMode = 'static'
  finalTile.zIndex = 200

  if (container) {
    container.addChild(finalTile)
    container.sortableChildren = true
  }
}


  // ---------------------------------------------------------------------
  // UTILITIES
  // ---------------------------------------------------------------------

  private extractArray(text: string): any[] {
    try { const p = JSON.parse(text); if (Array.isArray(p)) return p } catch { }
    const m = text.match(/\[[\s\S]*\]/g) || []
    for (const x of m.sort((a, b) => b.length - a.length)) try {
      const p = JSON.parse(x); if (Array.isArray(p)) return p
    } catch { }
    return []
  }

  private extractCount(input: string): number | null {
    const m = input.match(/(?:^|\D)(\d{1,2})(?:\D|$)/)
    return m ? Math.min(Math.max(+m[1], 1), 20) : null
  }

  private stripCount(input: string): string {
    return input.replace(/\d{1,2}/, '').replace(/[|:]/g, '').trim()
  }

  public handleKeyup(event: KeyboardEvent) {
    if (!(event.key === 'i' && event.altKey) || event.ctrlKey || event.shiftKey || event.repeat) return
    event.preventDefault()
    this.state.clearToolMode()
  }

  onDragMoved(event: CdkDragMove) {
    this.panelWidth = Math.min(this.maxWidth, Math.max(this.minWidth, this.panelWidth + event.distance.x))
  }
}
