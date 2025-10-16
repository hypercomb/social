import { Component, ElementRef, OnInit, ViewChild } from '@angular/core'
import Konva from 'konva'

@Component({
  standalone: true,
  selector: 'app-editable-text', // SUSPECT NOT USED
  templateUrl: './editable-text.component.html',
  styleUrls: ['./editable-text.component.scss']
})
export class EditableTextComponent implements OnInit {
  @ViewChild('container', { static: true }) container!: ElementRef

  private stage!: Konva.Stage
  private layer!: Konva.Layer
  private textNode!: Konva.Text
  private transformer!: Konva.Transformer

  ngOnInit() {
    this.initStage()
    this.initLayer()
    this.initTextNode()
    this.initTransformer()
    this.addDoubleClickEventListener()
    this.layer.add(this.textNode)
    this.layer.add(this.transformer)
    this.stage.add(this.layer)
  }

  private initStage() {
    this.stage = new Konva.Stage({
      container: this.container.nativeElement,
      width: window.innerWidth,
      height: window.innerHeight
    })
  }

  private initLayer() {
    this.layer = new Konva.Layer()
  }

  private initTextNode() {
    this.textNode = new Konva.Text({
      text: 'Some text here',
      x: 50,
      y: 80,
      fontSize: 20,
      draggable: true,
      width: 200
    })

    this.textNode.on('transform', () => {
      this.textNode.setAttrs({
        width: this.textNode.width() * this.textNode.scaleX(),
        scaleX: 1
      })
    })
  }

  private initTransformer() {
    this.transformer = new Konva.Transformer({
      nodes: [this.textNode],
      enabledAnchors: ['middle-left', 'middle-right'],
      boundBoxFunc: (oldBox, newBox) => {
        newBox.width = Math.max(30, newBox.width)
        return newBox
      }
    })
  }

  private addDoubleClickEventListener() {
    this.textNode.on('dblclick dbltap', () => {
      this.textNode.hide()
      this.transformer.hide()
      this.createTextarea()
    })
  }

  private createTextarea() {
    const textPosition = this.textNode.absolutePosition()
    const areaPosition = {
      x: this.stage.container().offsetLeft + textPosition.x,
      y: this.stage.container().offsetTop + textPosition.y
    }

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)

    this.setStyle(textarea, areaPosition)

    textarea.value = this.textNode.text()
    textarea.focus()

    const removeTextarea = () => {
      if (textarea.parentNode) {
        textarea.parentNode.removeChild(textarea)
      }
      window.removeEventListener('click', handleOutsideClick)
      this.textNode.show()
      this.transformer.show()
      this.transformer.forceUpdate()
    }

    const handleOutsideClick = (e: MouseEvent) => {
      if (e.target !== textarea) {
        this.textNode.text(textarea.value)
        removeTextarea()
      }
    }

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        this.textNode.text(textarea.value)
        removeTextarea()
      }
      if (e.key === 'Escape') {
        removeTextarea()
      }
    })

    setTimeout(() => {
      window.addEventListener('click', handleOutsideClick)
    })
  }

  private setStyle(textarea: HTMLTextAreaElement, areaPosition: { x: number y: number }) {
    textarea.style.position = 'absolute'
    textarea.style.top = areaPosition.y + 'px'
    textarea.style.left = areaPosition.x + 'px'
    textarea.style.width = this.textNode.width() - this.textNode.padding() * 2 + 'px'
    textarea.style.height = this.textNode.height() - this.textNode.padding() * 2 + 5 + 'px'
    textarea.style.fontSize = this.textNode.fontSize() + 'px'
    textarea.style.border = 'none'
    textarea.style.padding = '0px'
    textarea.style.margin = '0px'
    textarea.style.overflow = 'hidden'
    textarea.style.background = 'none'
    textarea.style.outline = 'none'
    textarea.style.resize = 'none'
    textarea.style.lineHeight = this.textNode.lineHeight().toString()
    textarea.style.fontFamily = this.textNode.fontFamily()
    textarea.style.transformOrigin = 'left top'
    textarea.style.textAlign = this.textNode.align()

    const textColor = this.textNode.fill()
    if (typeof textColor === 'string') {
      textarea.style.color = textColor
    }

    let transform = ''
    if (this.textNode.rotation()) {
      transform += 'rotateZ(' + this.textNode.rotation() + 'deg)'
    }

    const px = navigator.userAgent.toLowerCase().indexOf('firefox') > -1 ? 2 + Math.round(this.textNode.fontSize() / 20) : 0
    transform += 'translateY(-' + px + 'px)'
    textarea.style.transform = transform

    textarea.style.height = 'auto'
    textarea.style.height = textarea.scrollHeight + 3 + 'px'
  }
}


