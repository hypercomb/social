// sharing/trust.queen.ts
//
// `trust` — whose code may run your hive (code-trust.ts, the trust:code pool).
//
//   trust                      the domains whose code you trust
//   trust <domain>             trust it: its code runs without asking
//   trust withdraw <domain>    withdraw it: its code asks again
//
// The same consent the activation prompt's "always" and the host directory's
// "Run their code" give. No machine block, so a model is refused by default:
// trusting code is the participant's word alone.

import { EffectBus, get, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { trustCode, trustDomain, trustedCodeDomains, untrustCode } from './code-trust.js'

const toast = (message: string, type = 'info'): void => { EffectBus.emit('toast:show', { type, message }) }
const t = (key: string, fallback: string, params: Record<string, string> = {}): string => {
  const value = get<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
  return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '')
}

export class TrustQueenBee {
  readonly command = 'trust'
  readonly description = 'Say whose code may run your hive — trust a domain, withdraw it, or list them.'
  readonly descriptionKey = 'slash.trust'
  readonly options = ['<domain>', 'withdraw <domain>']

  slashComplete(args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    if (!q) return ['withdraw ', ...trustedCodeDomains()]
    if (q.startsWith('withdraw ')) {
      const partial = q.slice('withdraw '.length)
      return [...trustedCodeDomains()].filter(d => d.startsWith(partial) && d !== partial).map(d => `withdraw ${d}`)
    }
    return 'withdraw '.startsWith(q) ? ['withdraw '] : []
  }

  async invoke(args: string): Promise<void> {
    const parts = args.trim().split(/\s+/).filter(Boolean)
    if (!parts.length) {
      const domains = [...trustedCodeDomains()]
      toast(domains.length
        ? t('trust.list', 'Code you trust: {domains}', { domains: domains.join(', ') })
        : t('trust.none', 'You trust no domain\'s code yet; each asks before it runs.'))
      return
    }
    const withdraw = parts[0]!.toLowerCase() === 'withdraw'
    const domain = trustDomain(withdraw ? parts[1] : parts[0])
    if (!domain) { toast(t('trust.saydomain', 'Say trust <domain>, or trust withdraw <domain>.'), 'warning'); return }
    if (withdraw) {
      const done = await untrustCode(domain)
      toast(done
        ? t('trust.withdrawn', '{domain}\'s code asks again before it runs.', { domain })
        : t('trust.notwithdrawn', 'Trust in {domain} was not withdrawn: your hive\'s store is not ready yet.', { domain }), done ? 'success' : 'warning')
    } else {
      await trustCode(domain)
      toast(t('trust.trusted', '{domain}\'s code now runs your hive without asking.', { domain }), 'success')
    }
    EffectBus.emit('trust:changed', { domains: [...trustedCodeDomains()] })
  }
}

const _trust = new TrustQueenBee()
window.ioc.register('@diamondcoreprocessor.com/TrustQueenBee', _trust)
