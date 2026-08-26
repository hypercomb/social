// Read subscription headroom from an installed agent CLI without spending a
// model turn. Codex exposes it through its authenticated app-server protocol.

const { spawn } = require('child_process')

const unknown = (source, message = 'Usage limits are not reported by this CLI') => ({
  status: 'unknown', source, message, checkedAt: Date.now(), windows: [],
})

const normalizeWindow = (label, value) => {
  if (!value || typeof value.usedPercent !== 'number') return null
  return {
    label,
    remainingPercent: Math.max(0, Math.min(100, 100 - value.usedPercent)),
    ...(typeof value.resetsAt === 'number' ? { resetsAt: value.resetsAt } : {}),
    ...(typeof value.windowDurationMins === 'number' ? { durationMinutes: value.windowDurationMins } : {}),
  }
}

function codexUsage(bin) {
  return new Promise(resolve => {
    const child = spawn(bin, ['app-server', '--stdio'], {
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    })
    let buffer = ''
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill() } catch {}
      resolve(value)
    }
    const timer = setTimeout(() => finish(unknown('codex app-server', 'Usage check timed out')), 12_000)
    const send = value => child.stdin.write(`${JSON.stringify(value)}\n`)
    child.on('error', () => finish(unknown('codex app-server', 'Usage service unavailable')))
    child.stdout.on('data', chunk => {
      buffer += String(chunk)
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        let message
        try { message = JSON.parse(line) } catch { continue }
        if (message.id === 1 && message.result) {
          send({ method: 'initialized', params: {} })
          send({ method: 'account/rateLimits/read', id: 2 })
          continue
        }
        if (message.id !== 2) continue
        if (message.error || !message.result) {
          const detail = String(message.error?.message || '').trim()
          finish(unknown('codex app-server', detail || 'Usage limits unavailable for this account'))
          return
        }
        const result = message.result
        const byId = result.rateLimitsByLimitId
        const snapshots = byId && Object.keys(byId).length ? Object.values(byId) : [result.rateLimits]
        const windows = []
        let exhausted = false
        let plan = ''
        let credits = null
        for (const snapshot of snapshots) {
          if (!snapshot) continue
          plan ||= String(snapshot.planType || '')
          exhausted ||= !!snapshot.rateLimitReachedType || snapshot.spendControlReached === true
          credits ||= snapshot.credits || null
          const prefix = String(snapshot.limitName || snapshot.limitId || '').trim()
          const primary = normalizeWindow(prefix ? `${prefix} · session` : 'Session', snapshot.primary)
          const secondary = normalizeWindow(prefix ? `${prefix} · weekly` : 'Weekly', snapshot.secondary)
          if (primary) windows.push(primary)
          if (secondary) windows.push(secondary)
        }
        const lowest = windows.length ? Math.min(...windows.map(entry => entry.remainingPercent)) : 100
        finish({
          status: exhausted || lowest <= 0 ? 'exhausted' : lowest <= 20 ? 'limited' : 'available',
          source: 'codex app-server', checkedAt: Date.now(), windows,
          ...(plan ? { plan } : {}),
          ...(credits ? { credits: {
            hasCredits: credits.hasCredits === true,
            unlimited: credits.unlimited === true,
            ...(credits.balance != null ? { balance: String(credits.balance) } : {}),
          } } : {}),
        })
      }
    })
    send({
      method: 'initialize', id: 1,
      params: {
        clientInfo: { name: 'hypercomb-bridge', title: 'Hypercomb Bridge', version: '1' },
        capabilities: { experimentalApi: true, requestAttestation: false },
      },
    })
  })
}

async function subscriptionUsage(agent) {
  if (!agent?.installed) return unknown('CLI probe', 'CLI is not installed')
  if (agent.usageProbe === 'codex-app-server') return codexUsage(agent.bin)
  return unknown(`${agent.label} CLI`)
}

module.exports = { subscriptionUsage, normalizeWindow }
