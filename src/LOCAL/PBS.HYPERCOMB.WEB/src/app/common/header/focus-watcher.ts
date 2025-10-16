import { Directive, ElementRef, EventEmitter, HostListener, Input, Output } from '@angular/core'

@Directive({
  standalone: true,
  selector: '[app-focus-watcher]'
})
export class FocusWatcherDirective {
  @Input() isFocused: boolean = false // Property to toggle
  @Output() focusChange = new EventEmitter<boolean>() // Emit focus changes

  constructor(private element: ElementRef) { }

  @HostListener('focus') onFocus() {
    this.isFocused = true // Turn on the property
    this.focusChange.emit(this.isFocused) // Emit the focus state
  }

  @HostListener('blur') onBlur() {
    this.isFocused = false // Turn off the property
    this.focusChange.emit(this.isFocused) // Emit the focus state
  }
}


