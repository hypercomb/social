import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SearchBarComponent } from '@hypercomb/shared';
import { AxialService } from '@hypercomb/essentials/diamondcoreprocessor.com/core/axial/axial-service';
import { PanningDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/input/pan/panning.drone';
import { PixiHostDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/pixi-host.drone';
import { ShowHoneycombDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/show-honeycomb.drone';
import { MousePanInput } from '@hypercomb/essentials/diamondcoreprocessor.com/input/pan/mouse-pan.input';
import { MousewheelZoomInput } from '@hypercomb/essentials/diamondcoreprocessor.com/input/zoom/mousewheel-zoom.input';
import { Settings } from '@hypercomb/essentials/diamondcoreprocessor.com/core/settings';
import { ZoomDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/input/zoom/zoom.drone';
import { LayerService } from 'src/hypercomb-web/src/app/layer-service';
import { NostrMeshDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/nostr/nostr-mesh.drone'
import { NostrSigner } from '@hypercomb/essentials/diamondcoreprocessor.com/nostr/nostr-signer'
import { SignatureService } from '@hypercomb/core'

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SearchBarComponent],
  templateUrl: './app.html'
})
export class App {
  protected readonly title = signal('hypercomb-dev');
  constructor() {
    const { get, list } = window.ioc
    const _ = [
      AxialService,
      LayerService,
      PanningDrone,
      PixiHostDrone,
      ShowHoneycombDrone,
      MousePanInput,
      MousewheelZoomInput,
      NostrMeshDrone,
      NostrSigner,
      Settings,
      ZoomDrone]

    queueMicrotask(async () => {
      const l = list();
      console.log('[core-adapter] ioc keys:', l)

      const hostkey = 'PixiHost'
      const host = <any>get(hostkey)!
      await host.encounter('testing')

      const showkey = 'ShowHoneycomb'
      const show = <any>get(showkey)!
      await show.encounter('testing')

      const zoomkey = 'ZoomDrone'
      const zoom = <any>get(zoomkey)!
      await zoom.encounter('testing')

      const pankey = 'PanningDrone'
      const pan = <any>get(pankey)!
      await pan.encounter('testing')

      const mesh = get('NostrMeshDrone') as any

      // 1) hard-start mesh lifecycle
      await mesh.encounter('smoke-test')

      // 2) assert mesh is started
      const dbg0 = mesh.getDebug()
      console.log('[mesh] startedAtMs', dbg0.stats.startedAtMs)

      if (!dbg0.stats.startedAtMs) {
        throw new Error('mesh did not start (heartbeat never ran)')
      }

      // 3) subscribe FIRST (this creates the bucket)
      const sig = 'hypercomb:test:alpha'

      let callbackFired = false

      const sub = mesh.subscribe(sig, (e: any) => {
        callbackFired = true
        console.log('[mesh callback]', e.relay, e.sig, e.payload)
      })

      // 4) assert bucket exists
      const dbg1 = mesh.getDebug()
      console.log('[mesh] buckets after subscribe', dbg1.buckets)

      if (!dbg1.buckets.some((b: any) => b.sig === sig)) {
        throw new Error('subscribe did not create bucket')
      }

      // 5) publish AFTER subscribe
      let ok = await mesh.publish(29010, sig, {
        test: 'smoke',
        at: Date.now()
      })

      console.log('[mesh] publish ok?', ok)

      ok = await mesh.publish(29010, sig, {
        test: 'smoke test',
        at: Date.now()
      })

      console.log('[mesh] publish ok?', ok)

      // 7) simulate show-cells mesh pickup
      const lineage = get('Lineage') as any
      const showDomain = String(lineage?.domain?.() ?? lineage?.domainLabel?.() ?? 'hypercomb.io')
      const segsRaw = lineage?.explorerSegments?.()
      const segs = Array.isArray(segsRaw)
        ? segsRaw.map((x: unknown) => String(x ?? '').trim()).filter((x: string) => x.length > 0)
        : []
      const lineageKey = segs.length > 0
        ? `/${segs.join('/')}`
        : String(lineage?.explorerLabel?.() ?? window.location.pathname ?? '/')

      const showSeedDiscriminator = 'seed:list:v1'
      const showKey = `${showDomain}-${lineageKey}-${showSeedDiscriminator}`
      const showBytes = new TextEncoder().encode(showKey)
      const showSig = await SignatureService.sign(showBytes.buffer)

      const sampleSeedsA = ['nostr.sample.alpha', 'nostr.sample.beta']
      const sampleSeedsB = ['nostr.sample.gamma']

      await mesh.publish(29010, showSig, { seeds: sampleSeedsA, publishedAtMs: Date.now() })
      await mesh.publish(29010, showSig, { seeds: sampleSeedsB, publishedAtMs: Date.now() + 1 })

      console.log('[show-sim] published seeds for show sig', { showSig, lineageKey, showDomain })

      await show.encounter('simulate-show-cells-pickup')
      window.dispatchEvent(new CustomEvent('synchronize', { detail: { source: 'app:show-sim' } }))


      // 6) final assertion (microtask flush)
      queueMicrotask(() => {
        if (!callbackFired) {
          throw new Error('publish did not trigger local callback')
        } else {
          console.log('✅ mesh smoke test passed')
        }
      })
    })
  }
}
