// hypercomb-shared/ui/host-panel/host-panel.component.ts
//
// The Host panel — the executable makes anybody a host (native shell only).
//
// Point and click: pick the published folder (native dialog — the renderer
// never supplies a path), the app serves it on a loopback port, cloudflared
// puts the owner's domain on it. The visitor chain is
// domain → Cloudflare edge → tunnel → this app; the tunnel is a dumb pipe,
// so whatever the app serves IS the domain. Full doctrine:
// documentation/read-only-deployment.md.
//
// Registered as a shell surface ONLY when the Tauri bridge is present, so
// web builds never mount it — the gate is registration, per the registry
// paradigm. All state lives Rust-side; this panel is a thin, polled face
// over the hosting_* IPC commands (the app CSP forbids fetching localhost,
// so status never probes the port directly).

import { Component, OnDestroy, signal } from '@angular/core'
import { registerShellSurface } from '../../core/shell-surface-registry'
import { TranslatePipe } from '../../core/i18n.pipe'

interface HostingStatus {
  folder: string | null
  serving: boolean
  port: number | null
  domain: string | null
  tunnel_running: boolean
  cloudflared: boolean
}

const invoke = (command: string, args?: Record<string, unknown>): Promise<unknown> => {
  const tauri = (window as { __TAURI__?: { core?: { invoke?: (c: string, a?: unknown) => Promise<unknown> } } }).__TAURI__
  const call = tauri?.core?.invoke
  return call ? call(command, args) : Promise.reject(new Error('no native bridge'))
}

const nativeAvailable = (): boolean =>
  typeof window !== 'undefined' && '__TAURI__' in window

const CLOUDFLARED_DOWNLOADS =
  'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'

@Component({
  selector: 'hc-host-panel',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './host-panel.component.html',
  styleUrls: ['./host-panel.component.scss'],
})
export class HostPanelComponent implements OnDestroy {

  readonly open = signal(false)
  readonly status = signal<HostingStatus | null>(null)
  readonly busy = signal(false)
  readonly message = signal('')
  readonly domainDraft = signal('')

  #poll: ReturnType<typeof setInterval> | null = null

  toggle(): void {
    this.open.update(open => !open)
    if (this.open()) {
      void this.refresh()
      this.#poll = setInterval(() => { void this.refresh() }, 5000)
    } else if (this.#poll) {
      clearInterval(this.#poll)
      this.#poll = null
    }
  }

  async refresh(): Promise<void> {
    try {
      const status = await invoke('hosting_status') as HostingStatus
      this.status.set(status)
      if (!this.domainDraft() && status.domain) this.domainDraft.set(status.domain)
    } catch { /* native bridge gone — leave the last status standing */ }
  }

  async pickFolder(): Promise<void> {
    await this.#run(async () => {
      await invoke('hosting_pick_folder')
      return ''
    })
  }

  async startServing(): Promise<void> {
    await this.#run(async () => {
      const port = await invoke('hosting_serve_start') as number
      return `:${port}`
    })
  }

  async stopServing(): Promise<void> {
    await this.#run(async () => { await invoke('hosting_serve_stop'); return '' })
  }

  async login(): Promise<void> {
    await this.#run(async () => { await invoke('hosting_tunnel_login'); return '' })
  }

  async goLive(): Promise<void> {
    const domain = this.domainDraft().trim()
    await this.#run(async () => await invoke('hosting_go_live', { domain }) as string)
  }

  async goOffline(): Promise<void> {
    await this.#run(async () => { await invoke('hosting_go_offline'); return '' })
  }

  onDomainInput(event: Event): void {
    this.domainDraft.set((event.target as HTMLInputElement).value)
  }

  openLive(): void {
    const domain = this.status()?.domain
    if (domain) void invoke('open_external', { url: `https://${domain}` })
  }

  getCloudflared(): void {
    void invoke('open_external', { url: CLOUDFLARED_DOWNLOADS })
  }

  /** Run one action; surface its outcome; re-read the truth from Rust. */
  async #run(action: () => Promise<string>): Promise<void> {
    if (this.busy()) return
    this.busy.set(true)
    this.message.set('')
    try {
      this.message.set(await action())
    } catch (error) {
      this.message.set(String(error))
    } finally {
      this.busy.set(false)
      await this.refresh()
    }
  }

  ngOnDestroy(): void {
    if (this.#poll) clearInterval(this.#poll)
  }
}

// Native only: on the web shell this file may load, but the surface never
// registers — absence of registration IS the gate.
if (nativeAvailable()) {
  registerShellSurface({ name: 'host-panel', component: HostPanelComponent, order: 460 })
}
