// diamond-core-processor/src/app/sentinel/sentinel.component.ts
//
// Headless component — no visible UI.
// Loaded via /sentinel route in a hidden iframe by hypercomb-web.
// Accepts a MessagePort handshake and delegates content requests
// to SentinelHandler.

import { Component, inject, OnDestroy, OnInit } from '@angular/core'
import { SentinelHandler } from './sentinel-handler'

const ALLOWED_ORIGINS = [
  'http://localhost:4200',
  'http://localhost:4201',
  'http://localhost:4210',
  'https://hypercom.io',
  'https://www.hypercom.io'
]

@Component({
  selector: 'dcp-sentinel',
  standalone: true,
  template: '',
  styles: [':host { display: none }']
})
export class SentinelComponent implements OnInit, OnDestroy {

  #handler = inject(SentinelHandler)
  #port: MessagePort | null = null
  #onMessage = (e: MessageEvent) => this.#handleHandshake(e)

  ngOnInit(): void {
    window.addEventListener('message', this.#onMessage)
    console.log('[sentinel] ready — waiting for handshake')

    // Announce to parent that the sentinel is ready to accept a handshake.
    // The iframe 'load' event fires before Angular mounts this component,
    // so the parent's postMessage would arrive before we're listening.
    // Instead, we announce ourselves and let the parent respond with the port.
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ scope: 'dcp-sentinel', type: 'sentinel-ready' }, '*')
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('message', this.#onMessage)
    this.#port?.close()
  }

  #handleHandshake(e: MessageEvent): void {
    if (!ALLOWED_ORIGINS.includes(e.origin)) return
    if (e.data?.scope !== 'dcp-sentinel' || e.data?.type !== 'handshake') return

    const port = e.ports?.[0]
    if (!port) return

    this.#port = port
    port.onmessage = (ev) => this.#handler.handle(ev.data, port)
    port.postMessage({ type: 'ready' })

    console.log(`[sentinel] handshake accepted from ${e.origin}`)
  }
}
