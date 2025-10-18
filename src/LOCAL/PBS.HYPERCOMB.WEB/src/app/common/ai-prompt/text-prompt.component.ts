
@Component({
  standalone: true,
  imports: [FormsModule, SubmitOnEnterDirective],
  selector: 'app-text-prompt',
  templateUrl: './text-prompt.component.html',
  styleUrls: ['./text-prompt.component.scss']
})
export class TextPromptComponent extends Hypercomb implements AfterViewInit {

  @Input() buttonName: string = 'Submit'
  @Input() placeholder: string = 'Enter text here...'
  @Input() mode: HypercombMode = HypercombMode.None
  @Input() value: string = ''
  @Output() submit: EventEmitter<string> = new EventEmitter<string>()

  @ViewChild('textInput') textInput!: ElementRef


  public showInstructions: boolean = false
  public readonly aiPromptMode = HypercombMode.AiPrompt

  constructor() {
    super()

    effect(() => {
      const current = this.state.mode()

      if (current === this.mode) {
        this.showModal()
        this.showInstructions = false
      }
    })
  }


  ngAfterViewInit() {
    this.textInput.nativeElement.focus()
  }

  reset() {
    this.value = ''
    this.showInstructions = false
    this.state.removeMode(HypercombMode.HiveCreation)
    this.state.removeMode(HypercombMode.AiPrompt)
  }

  showModal() {
    this.value = 'block'
  }

  async submitValue() {
    this.submit.emit(this.value)
    // Don't reset if we're in AI prompt mode and waiting for clarification
    if (this.mode !== HypercombMode.AiPrompt) {
      this.reset()
    }
  }

}



