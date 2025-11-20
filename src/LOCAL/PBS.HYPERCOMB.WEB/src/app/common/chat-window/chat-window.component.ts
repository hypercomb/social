import { CdkDragMove } from '@angular/cdk/drag-drop'
import { AfterViewInit, Component, effect, ElementRef, inject, OnDestroy, OnInit, ViewChild } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { environment } from 'src/environments/environment'
import { HypercombMode } from '../../core/models/enumerations'
import { HypercombData } from 'src/app/actions/hypercomb-data'
// import { AiService } from 'src/app/ai/ai-service'
import { HONEYCOMB_SVC } from 'src/app/shared/tokens/i-comb-service.token'

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

  public async sendMessage() {
    if (!this.newMessage.trim()) return


    // get the hierarchy to give to the AI.
    const tiles  = []
    const hierarchy = this.hierarchyService.toStringHierarchy(tiles)

    this.debug.log('misc', 'Hierarchy:', hierarchy)

    this.messages.push({ content: this.newMessage, isUser: true })

    try {
      await this.aiService.handleTileCreation(this.newMessage)

      this.messages.push({
        content: 'Tiles have been added to the hive.',
        isUser: false,
      })
    } catch (error) {
      console.error('Error processing message:', error)
      let errorMessage = 'Sorry, I encountered an error processing your request.'
      if (error instanceof Error && error.message.includes('LM Studio')) {
        errorMessage = error.message
      } else {
        errorMessage += ' Please try again.'
      }
      this.messages.push({ content: errorMessage, isUser: false })
    }

    // this.newMessage = ''
  }

  public ngOnDestroy() {
    this.chatwindowRef.nativeElement.removeEventListener('keyup', this.handleKeyup)
  }

}


