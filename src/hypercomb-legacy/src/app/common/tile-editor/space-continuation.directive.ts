import { Directive, ElementRef, HostListener } from '@angular/core'

@Directive({
  standalone: true,
  selector: '[app-space-continuation]'
})
export class SpaceContinuationDirective {
  constructor(private elementRef: ElementRef) { }

  // Listen for keydown events on the host element
  @HostListener('keydown', ['$event'])
  handleKeydown(event: KeyboardEvent) {
    const inputElem = this.elementRef.nativeElement

    // Check if the pressed key is a space and the element is focused
    if (event.key === ' ' && inputElem === document.activeElement) {
      // If the selection starts at 0 and spans the entire input
      if (inputElem.selectionStart === 0 && inputElem.selectionEnd === inputElem.value.length) {
        // Move the cursor to the end and add a space
        inputElem.selectionStart = inputElem.selectionEnd = inputElem.value.length
        inputElem.value = (<string>inputElem.value).trimEnd() + ' '
        event.preventDefault() // Prevent the default space behavior
      }
    }
  }
}


