import { CdkDragMove } from '@angular/cdk/drag-drop'
import { AfterViewInit, Component, effect, ElementRef, inject, OnDestroy, OnInit, ViewChild } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { environment } from 'src/environments/environment'
import { HypercombMode } from '../../core/models/enumerations'
import { HypercombData } from 'src/app/actions/hypercomb-data'
import { HierarchyService } from 'src/app/services/hiearchy-service'
import { AiListQuery } from 'src/app/ai/ai-list-query'

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
  private readonly hierarchyService = inject(HierarchyService)
  private readonly aiQuery = inject(AiListQuery)  

  @ViewChild('chatwindow', { static: true }) chatwindowRef!: ElementRef<HTMLDivElement>

  messages: ChatMessage[] = []
  newMessage = ''
  panelWidth = 400
  minWidth = 400
  maxWidth = 600

  constructor() {
    super()

    effect(() => {
      const message = this.state.logOutput()

      if (!environment.production) return

      this.debug.log('misc', 'Output changed:', message)

      const chatMessage: ChatMessage = {
        content: message,
        isUser: false
      }
      this.messages.push(chatMessage)
    })
  }

  public handleKeyup = (event: KeyboardEvent) => {
    if (!(event.key === 'i' && event.altKey) || event.ctrlKey || event.shiftKey || event.repeat) return

    event.preventDefault()
    event.stopPropagation()
    this.state.clearToolMode()
  }

  public ngAfterViewInit() {
    setTimeout(() => this.state.ignoreShortcuts = true, 50)

    const element = this.chatwindowRef.nativeElement

    element.focus() // Ensure it can receive keyboard events
    element.addEventListener('keyup', this.handleKeyup)
  }

  get isOpen(): boolean {
    return this.state.hasMode(HypercombMode.ShowChat)
  }

  ngOnInit() {

    // Set chat window to open by default
    this.messages.push({
      content: 'Hi! I can help you manage your hives and tiles. I understand the current state of your workspace and can assist with operations like creating, updating, or querying cell.',
      isUser: false
    })
  }

  onDragMoved(event: CdkDragMove) {
    const newWidth = this.panelWidth + event.distance.x
    this.panelWidth = Math.max(this.minWidth, Math.min(this.maxWidth, newWidth))
  }

  // Delegates tile creation to AiService

  // Inside ChatWindowComponent — replace your sendMessage() with this:

  public async sendMessage() {
    if (!this.newMessage.trim()) return

    const userInput = this.newMessage.trim()
    this.messages.push({ content: userInput, isUser: true })

    // 1. Build current hierarchy string for context
    const rootTiles: any[] = []
    // const hierarchyContext = this.hierarchyService.toStringHierarchy(rootTiles)

    // this.debug.log('misc', 'Sending hierarchy context to AI:', hierarchyContext)

    // 2. Append to messages so AI sees full context
    this.messages.push({
      content: 'Thinking...',
      isUser: false
    })

    try {
      // Use your existing AiListQuery service (injected or via DI)
      // Angular 14+ inject() works in methods too

      // Call it — it will:
      // - Send prompt + hierarchy context to LM Studio
      // - Get back clean list
      // - Auto-create child cells under the currently active/hovered cell
      const generatedItems = await this.aiQuery.query(userInput + ' (use current hierarchy as parent)')

      // Update the "Thinking..." message
      this.messages[this.messages.length - 1] = {
        content: generatedItems.length
          ? `Added ${generatedItems.length} new items as children:\n• ${generatedItems.join('\n• ')}`
          : 'No valid items were generated.',
        isUser: false
      }

    } catch (error: any) {
      console.error('AI Query failed:', error)

      let msg = 'Sorry, something went wrong.'
      if (error.message?.includes('fetch') || error.message?.includes('NetworkError')) {
        msg = 'Cannot reach LM Studio. Is the local server running on port 1234?'
      } else if (error.message?.includes('LM Studio')) {
        msg = error.message
      }

      this.messages[this.messages.length - 1] = {
        content: msg,
        isUser: false
      }
    } finally {
      this.newMessage = ''
    }
  }
  public ngOnDestroy() {
    this.state.ignoreShortcuts = false
    this.chatwindowRef.nativeElement.removeEventListener('keyup', this.handleKeyup)
  }

}


