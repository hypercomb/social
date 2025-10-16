import { Directive, EventEmitter, HostListener, Output } from '@angular/core'

@Directive({
  standalone: true,
  selector: '[submit-on-enter]' // Use this selector to apply the directive
})
export class SubmitOnEnterDirective {
  // Output event emitter to emit when the Enter key is pressed
  @Output() enterPressed = new EventEmitter<void>()

  // Listen for the keydown event on the host element
  @HostListener('keydown.enter', ['$event']) onEnter(event: KeyboardEvent) {

    // Prevent default action of the event if needed
    event.preventDefault()

    // Emit the custom event, which can be listened to by a parent component
    this.enterPressed.emit()
  }

  constructor() {
    // console.log("created new submit on enter...")
  }
}


