import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DraftPayloadCacheService } from '../core/draft-payload-cache.service';
import { ModuleResolverService, type ModuleFileV1 } from '../core/module-resolver.service';

const DOMAINS_KEY = 'dcp.domains';
const LAST_MODULE_KEY = 'dcp.lastModuleSignature';

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
  readonly domains = signal<string[]>(this.loadDomains());
  readonly input = signal('');
  readonly moduleSignature = signal<string>(this.loadLastModuleSignature());
  readonly moduleBusy = signal(false);
  readonly moduleError = signal<string | null>(null);
  readonly resolvedModule = signal<ModuleFileV1 | null>(null);

  readonly actions = computed(() => {
    const module = this.resolvedModule();
    return module?.actions ?? [];
  });

  // -----------------------------
  // private fields
  // -----------------------------
  private readonly router = inject(Router);
  private readonly cache = inject(DraftPayloadCacheService);
  private readonly resolver = inject(ModuleResolverService);

  // -----------------------------
  // domains
  // -----------------------------
  protected add(): void {
    const raw = this.input().trim();
    if (!raw) return;

    try {
      const url = new URL(raw);
      const scope =
        url.pathname && url.pathname !== '/'
          ? `${url.origin}${url.pathname.replace(/\/+$/, '')}`
          : url.origin;

      if (this.domains().includes(scope)) {
        this.input.set('');
        return;
      }

      const next = [...this.domains(), scope];
      this.domains.set(next);
      localStorage.setItem(DOMAINS_KEY, JSON.stringify(next));
      this.input.set('');
    } catch {
      // ignore invalid urls
    }
  }

  protected remove(domain: string): void {
    const next = this.domains().filter(d => d !== domain);
    this.domains.set(next);
    localStorage.setItem(DOMAINS_KEY, JSON.stringify(next));
  }

  // -----------------------------
  // module loading
  // -----------------------------
  protected loadModule = async (): Promise<void> => {
    this.moduleBusy.set(true);
    this.moduleError.set(null);
    this.resolvedModule.set(null);

    try {
      const sig = (this.moduleSignature() ?? '').trim();
      if (!sig) throw new Error('enter a module signature');

      localStorage.setItem(LAST_MODULE_KEY, sig);

      const resolved = await this.resolver.resolve(sig, this.domains());
      this.resolvedModule.set(resolved.module);

      // cache each action payload under its signature so the inspector can open instantly
      for (const item of resolved.module.actions) {
        // Ensure we're not caching the 'id' and are using the payload with the updated structure
        const { signature, payload } = item;
        this.cache.set(signature, JSON.stringify(payload));
      }
    } catch (e: any) {
      this.moduleError.set(e?.message ?? 'failed to load module');
    } finally {
      this.moduleBusy.set(false);
    }
  };

  protected openAction = async (signature: string): Promise<void> => {
    const sig = (signature ?? '').trim();
    if (!sig) return;
    await this.router.navigateByUrl(`/inspect/${sig}`);
  };

  // -----------------------------
  // storage
  // -----------------------------
  private loadDomains(): string[] {
    try {
      return JSON.parse(localStorage.getItem(DOMAINS_KEY) ?? '[]');
    } catch {
      return [];
    }
  }

  private loadLastModuleSignature(): string {
    try {
      return localStorage.getItem(LAST_MODULE_KEY) ?? '';
    } catch {
      return '';
    }
  }
}
