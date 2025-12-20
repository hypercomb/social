// src/app/common/overlays/intent-field-overlay.component.ts

import {
  Component,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  Input
} from '@angular/core'

import {
  IntentFieldSnapshot,
  IntentParticle,
  SafetyClass
} from '../../core/intent/models/intent-field.model'

import { IntentPlane } from '../../core/intent/models/intent.model'

const PLANES: IntentPlane[] = [
  'action',
  'object',
  'focus',
  'control',
  'safety'
]

@Component({
  selector: 'hc-intent-field-overlay',
  standalone: true,
  template: `<canvas #canvas class="intent-overlay"></canvas>`,
  styleUrls: ['./intent-field-overlay.scss']
})
export class IntentFieldOverlayComponent
  implements AfterViewInit, OnDestroy {

  @ViewChild('canvas', { static: true })
  private canvas!: ElementRef<HTMLCanvasElement>

  @Input()
  snapshot!: IntentFieldSnapshot

  private ctx!: CanvasRenderingContext2D
  private rafId = 0

  // --------------------------------------------------
  // lifecycle
  // --------------------------------------------------

  public ngAfterViewInit(): void {
    const el = this.canvas.nativeElement
    const ctx = el.getContext('2d')
    if (!ctx) return

    this.ctx = ctx
    this.resize()
    this.loop()
  }

  public ngOnDestroy(): void {
    cancelAnimationFrame(this.rafId)
  }

  // --------------------------------------------------
  // render loop
  // --------------------------------------------------

  private loop = (): void => {
    this.clear()
    this.drawPlanes()

    if (this.snapshot) {
      this.drawParticles(this.snapshot.particles)

      if (this.snapshot.pendingBridge) {
        this.drawBridgeIndicator()
      }
    }

    this.rafId = requestAnimationFrame(this.loop)
  }

  // --------------------------------------------------
  // drawing
  // --------------------------------------------------

  private clear(): void {
    const el = this.canvas.nativeElement
    this.ctx.clearRect(0, 0, el.width, el.height)
  }

  private drawPlanes(): void {
    const el = this.canvas.nativeElement
    const bandHeight = el.height / PLANES.length

    this.ctx.strokeStyle = '#2a2a2a'
    this.ctx.lineWidth = 1

    for (let i = 0; i < PLANES.length; i++) {
      const y = i * bandHeight
      this.ctx.beginPath()
      this.ctx.moveTo(0, y)
      this.ctx.lineTo(el.width, y)
      this.ctx.stroke()
    }
  }

  private drawParticles(particles: IntentParticle[]): void {
    const el = this.canvas.nativeElement
    const bandHeight = el.height / PLANES.length

    for (const p of particles) {
      const planeIndex = PLANES.indexOf(p.plane)
      if (planeIndex === -1) continue

      const y =
        planeIndex * bandHeight +
        bandHeight / 2

      // intent identity must be stable and string-based
      const x = this.stableX(p.intent.key, el.width)
      const radius = 6 + p.weight * 12
      const alpha = Math.max(0, 1 - p.ageMs / 2000)

      this.ctx.globalAlpha = alpha
      this.ctx.fillStyle = this.colorFor(
        this.visualSafetyFor(p.safetyClass)
      )

      this.ctx.beginPath()
      this.ctx.arc(x, y, radius, 0, Math.PI * 2)
      this.ctx.fill()
    }

    this.ctx.globalAlpha = 1
  }

  private drawBridgeIndicator(): void {
    const el = this.canvas.nativeElement

    this.ctx.strokeStyle = '#ffffff'
    this.ctx.lineWidth = 2
    this.ctx.strokeRect(4, 4, el.width - 8, el.height - 8)
  }

  // --------------------------------------------------
  // helpers
  // --------------------------------------------------

  private resize(): void {
    const el = this.canvas.nativeElement
    el.width = el.clientWidth
    el.height = el.clientHeight
  }

  private stableX(id: string, width: number): number {
    let hash = 0
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i)
      hash |= 0
    }

    return Math.abs(hash % (width - 40)) + 20
  }

  // core safety → visual semantics adapter
  private visualSafetyFor(
    safety: SafetyClass
  ): 'safe' | 'caution' | 'danger' {
    switch (safety) {
      case 'safe':
        return 'safe'
      case 'restricted':
        return 'caution'
      case 'unsafe':
        return 'danger'
    }
  }

  private colorFor(
    safety: 'safe' | 'caution' | 'danger'
  ): string {
    switch (safety) {
      case 'safe':
        return '#4caf50'
      case 'caution':
        return '#ffc107'
      case 'danger':
        return '#f44336'
    }
  }
}
