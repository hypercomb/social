// src/app/home/home.component.ts
import { Component, computed, inject, signal } from '@angular/core'
import { Router } from '@angular/router'
import { DraftPayloadCacheService } from '../core/draft-payload-cache.service'
import { ModuleResolverService, type ModuleDroneV1, type ResolvedModule } from '../core/module-resolver.service'

const DOMAINS_KEY = 'dcp.domains'
const LAST_MODULE_KEY = 'dcp.lastModuleSignature'

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent {

  // -----------------------------
  // state
  // -----------------------------
  public readonly domains = signal<string[]>(this.loadDomains())
  public readonly input = signal('')
  public readonly moduleSignature = signal<string>(this.loadLastModuleSignature())
  public readonly moduleBusy = signal(false)
  public readonly moduleError = signal<string | null>(null)
  public readonly resolvedModule = signal<ResolvedModule | null>(null)

  public readonly moduleName = computed((): string => {
    const m = this.resolvedModule()?.module
    const name = (m?.module?.name ?? '').trim()
    return name || 'unnamed module'
  })

  public readonly drones = computed((): ModuleDroneV1[] => {
    return this.resolvedModule()?.module.drones ?? []
  })

  // -----------------------------
  // private fields
  // -----------------------------
  private readonly router = inject(Router)
  private readonly cache = inject(DraftPayloadCacheService)
  private readonly resolver = inject(ModuleResolverService)

  // -----------------------------
  // domains
  // -----------------------------
  protected add(): void {
    const raw = this.input().trim()
    if (!raw) return

    try {
      const url = new URL(raw)
      const scope = url.pathname && url.pathname !== '/' ? `${url.origin}${url.pathname.replace(/\/+$/, '')}` : url.origin

      if (this.domains().includes(scope)) {
        this.input.set('')
        return
      }

      const next = [...this.domains(), scope]
      this.domains.set(next)
      localStorage.setItem(DOMAINS_KEY, JSON.stringify(next))
      this.input.set('')
    } catch {
      // ignore invalid urls
    }
  }

  protected remove(domain: string): void {
    const next = this.domains().filter(d => d !== domain)
    this.domains.set(next)
    localStorage.setItem(DOMAINS_KEY, JSON.stringify(next))
  }

  // -----------------------------
  // display helpers (names from payload, fallback to source bytes)
  // -----------------------------
  protected actionTitle = (a: ModuleDroneV1): string => {
    const fromMeta = (a?.payload?.drone?.name ?? '').trim()
    if (fromMeta) return fromMeta

    const fromSource = this.inferTitleFromSource(a)
    return fromSource || 'untitled action'
  }

  protected actionDescription = (a: ModuleDroneV1): string => {
    return (a?.payload?.drone?.description ?? '').trim()
  }

  private inferTitleFromSource(a: ModuleDroneV1): string {
    const entry = (a?.payload?.source?.entry ?? '').trim()
    if (!entry) return ''

    const encoded = a?.payload?.source?.files?.[entry] ?? ''
    if (!encoded) return ''

    try {
      const source = atob(encoded)
      const m = source.match(/\bclass\s+([A-Za-z0-9_]+)\s+extends\b/)
      return (m?.[1] ?? '').trim()
    } catch {
      return ''
    }
  }

  // -----------------------------
  // module loading
  // -----------------------------
  protected loadModule = async (): Promise<void> => {
    this.moduleBusy.set(true)
    this.moduleError.set(null)
    this.resolvedModule.set(null)

    try {
      const sig = (this.moduleSignature() ?? '').trim()
      if (!sig) throw new Error('enter a module signature')

      localStorage.setItem(LAST_MODULE_KEY, sig)

      const resolved = await this.resolver.resolve(sig, this.domains())
      this.resolvedModule.set(resolved)

      // cache each action payload under its signature so the inspector can open instantly
      for (const item of resolved.module.drones) {
        const { signature, payload } = item
        this.cache.set(signature, JSON.stringify(payload))
      }
    } catch (e: any) {
      this.moduleError.set(e?.message ?? 'failed to load module')
    } finally {
      this.moduleBusy.set(false)
    }
  }

  protected openAction = async (signature: string): Promise<void> => {
    const sig = (signature ?? '').trim()
    if (!sig) return
    await this.router.navigateByUrl(`/inspect/${sig}`)
  }

  // -----------------------------
  // storage
  // -----------------------------
  private loadDomains(): string[] {
    try {
      return JSON.parse(localStorage.getItem(DOMAINS_KEY) ?? '[]')
    } catch {
      return []
    }
  }

  private loadLastModuleSignature(): string {
    try {
      return localStorage.getItem(LAST_MODULE_KEY) ?? ''
    } catch {
      return ''
    }
  }
}
