// Paste into the browser console (DevTools) on a running hive.
// Counts everything in window.ioc, grouped by namespace, and lists every key.
// Usage after pasting:  iocCensus()        -> summary + full table
//                       iocCensus('Queen') -> only keys containing "Queen"
//                       iocWatch()         -> log every FUTURE registration with a running count
(() => {
  const ioc = window.ioc
  if (!ioc) { console.warn('[ioc-census] window.ioc is not installed yet'); return }

  const kindOf = (value) => {
    if (value === null || value === undefined) return String(value)
    if (typeof value === 'function') return 'function'
    if (typeof value !== 'object') return typeof value
    return value.constructor?.name || 'object'
  }

  window.iocCensus = (filter) => {
    const needle = filter ? String(filter).toLowerCase() : ''
    const keys = ioc.list().filter(k => !needle || k.toLowerCase().includes(needle))

    const rows = keys.map(key => ({ key, type: kindOf(ioc.get(key)) }))

    const byNamespace = {}
    for (const { key } of rows) {
      const ns = key.startsWith('@') ? key.slice(0, key.indexOf('/') > 0 ? key.indexOf('/') : undefined) : '(unscoped)'
      byNamespace[ns] = (byNamespace[ns] || 0) + 1
    }

    console.group(`[ioc-census] ${rows.length} registered${needle ? ` (filter "${filter}")` : ''}`)
    console.log('by namespace:')
    console.table(Object.entries(byNamespace).sort((a, b) => b[1] - a[1]).map(([namespace, count]) => ({ namespace, count })))
    console.log('all keys:')
    console.table(rows)
    const refused = window.__hcSecondInstances
    if (refused?.length) console.warn('[ioc-census] second instances refused (module ran twice):', refused)
    console.groupEnd()
    return rows.map(r => r.key)
  }

  window.iocWatch = () => {
    let n = ioc.list().length
    const off = ioc.onRegister((key, value) => console.log(`[ioc +${++n}] ${key}  (${kindOf(value)})`))
    console.log(`[ioc-watch] watching; ${n} already registered. Call the returned function to stop.`)
    window.iocWatchStop = off
    return off
  }

  console.log('[ioc-census] ready: iocCensus([filter]) and iocWatch(). Now:', ioc.list().length, 'keys')
})()
