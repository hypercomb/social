// Shared in-view curation phase for hierarchy-backed document projections.
//
// The participant stays inside the rendered view, drills through one hierarchy
// level at a time, toggles exact tiles, and commits once with Done.

import {
  documentViewPathKey,
  type DocumentViewItem,
} from './document-view-source.js'

type CuratorOptions = {
  host: HTMLElement
  rootLabel: string
  rootSegments: readonly string[]
  items: readonly DocumentViewItem[]
  includedPaths: readonly (readonly string[])[] | undefined
  onDone(paths: readonly (readonly string[])[] | undefined): Promise<void> | void
  onCancel(): void
}

type Entry = {
  item: DocumentViewItem
  relative: readonly string[]
  key: string
  parentKey: string
}

export function openDocumentViewCurator(opts: CuratorOptions): HTMLElement {
  const entries: Entry[] = opts.items.map(item => {
    const relative = item.segments.slice(opts.rootSegments.length)
    return {
      item,
      relative,
      key: documentViewPathKey(relative),
      parentKey: documentViewPathKey(relative.slice(0, -1)),
    }
  })
  const byParent = new Map<string, Entry[]>()
  for (const entry of entries) {
    const siblings = byParent.get(entry.parentKey) ?? []
    siblings.push(entry)
    byParent.set(entry.parentKey, siblings)
  }

  const allKeys = new Set(entries.map(entry => entry.key))
  const selected = opts.includedPaths === undefined
    ? new Set(allKeys)
    : new Set(opts.includedPaths.map(documentViewPathKey).filter(key => allKeys.has(key)))
  let at: readonly string[] = []

  const overlay = document.createElement('section')
  overlay.className = 'document-curator'
  overlay.innerHTML = `<style>${CSS}</style>`
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', 'Choose document contents')

  const header = document.createElement('header')
  const heading = document.createElement('div')
  heading.className = 'curator-heading'
  const kicker = document.createElement('small')
  kicker.textContent = 'DOCUMENT CONTENTS'
  const title = document.createElement('strong')
  title.textContent = 'Choose what belongs in this view'
  heading.append(kicker, title)

  const actions = document.createElement('div')
  actions.className = 'curator-actions'
  const cancel = button('Cancel', 'curator-cancel')
  const done = button('Done', 'curator-done')
  actions.append(cancel, done)
  header.append(heading, actions)

  const nav = document.createElement('nav')
  nav.className = 'curator-nav'
  nav.setAttribute('aria-label', 'Current hierarchy location')
  const back = button('‹ Back', 'curator-back')
  const crumb = document.createElement('span')
  nav.append(back, crumb)

  const summary = document.createElement('div')
  summary.className = 'curator-summary'
  const count = document.createElement('strong')
  const all = button('Select all', 'curator-link')
  const none = button('Clear', 'curator-link')
  summary.append(count, all, none)

  const list = document.createElement('div')
  list.className = 'curator-list'
  list.setAttribute('role', 'list')

  const paint = (): void => {
    const parentKey = documentViewPathKey(at)
    const children = byParent.get(parentKey) ?? []
    crumb.textContent = [opts.rootLabel, ...at].join(' / ')
    back.hidden = at.length === 0
    count.textContent = `${selected.size} of ${entries.length} included`
    done.textContent = `Done · ${selected.size}`
    list.replaceChildren()

    if (!children.length) {
      const empty = document.createElement('p')
      empty.className = 'curator-empty'
      empty.textContent = 'Nothing deeper here.'
      list.append(empty)
      return
    }

    for (const entry of children) {
      const row = document.createElement('article')
      row.className = 'curator-row'
      row.setAttribute('role', 'listitem')

      const check = document.createElement('button')
      check.type = 'button'
      check.className = 'curator-check'
      check.classList.toggle('is-selected', selected.has(entry.key))
      check.setAttribute('aria-pressed', String(selected.has(entry.key)))
      check.setAttribute('aria-label', `${selected.has(entry.key) ? 'Exclude' : 'Include'} ${entry.item.title}`)
      check.textContent = selected.has(entry.key) ? 'check' : ''
      check.classList.add('mat-sym')
      check.addEventListener('click', () => {
        if (selected.has(entry.key)) selected.delete(entry.key)
        else selected.add(entry.key)
        paint()
      })

      const label = document.createElement('button')
      label.type = 'button'
      label.className = 'curator-label'
      label.append(text('strong', entry.item.title), text('small', entry.item.source))
      const hasChildren = (byParent.get(entry.key)?.length ?? 0) > 0
      if (hasChildren) {
        const open = document.createElement('span')
        open.className = 'mat-sym curator-open'
        open.textContent = 'chevron_right'
        label.append(open)
        label.setAttribute('aria-label', `Open ${entry.item.title}`)
        label.addEventListener('click', () => {
          at = entry.relative
          paint()
        })
      } else {
        label.addEventListener('click', () => check.click())
      }
      row.append(check, label)
      list.append(row)
    }
  }

  back.addEventListener('click', () => { at = at.slice(0, -1); paint() })
  all.addEventListener('click', () => { allKeys.forEach(key => selected.add(key)); paint() })
  none.addEventListener('click', () => { selected.clear(); paint() })
  cancel.addEventListener('click', () => { overlay.remove(); opts.onCancel() })
  done.addEventListener('click', async () => {
    done.disabled = true
    done.textContent = 'Saving…'
    const paths = selected.size === entries.length
      ? undefined
      : entries.filter(entry => selected.has(entry.key)).map(entry => entry.relative)
    try {
      await opts.onDone(paths)
      overlay.remove()
    } finally {
      done.disabled = false
    }
  })

  overlay.append(header, nav, summary, list)
  opts.host.append(overlay)
  paint()
  queueMicrotask(() => done.focus())
  return overlay
}

function button(label: string, className: string): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = className
  el.textContent = label
  return el
}

function text<K extends 'strong' | 'small'>(tag: K, value: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  el.textContent = value
  return el
}

const CSS = `
.document-curator{position:fixed;inset:0;z-index:20;display:flex;flex-direction:column;background:#101715;color:#e9f0ed;font:14px/1.4 Inter,system-ui,sans-serif}.document-curator>header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px 24px;border-bottom:1px solid #304039;background:#151f1c}.curator-heading{display:flex;flex-direction:column;gap:3px}.curator-heading small{color:#80aa9b;letter-spacing:.16em;font-size:9px}.curator-heading strong{font-size:17px}.curator-actions{display:flex;gap:8px}.curator-actions button,.curator-back,.curator-link{border:1px solid #3c5149;border-radius:6px;background:#1d2b26;color:#d7e5df;padding:8px 13px;cursor:pointer}.curator-done{border-color:#78a994!important;background:#2d5a4a!important;color:#fff!important;font-weight:800}.curator-nav{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 24px;border-bottom:1px solid #27342f;color:#aabcb5}.curator-back{padding:5px 9px}.curator-summary{display:flex;align-items:center;gap:12px;padding:12px 24px;color:#90a49c}.curator-summary strong{margin-right:auto}.curator-link{padding:4px 8px;background:transparent}.curator-list{flex:1;overflow:auto;padding:6px 18px 32px}.curator-row{display:grid;grid-template-columns:42px 1fr;align-items:center;max-width:900px;margin:8px auto;border:1px solid #2c3b35;border-radius:8px;background:#16201d}.curator-check{display:grid;place-items:center;width:24px;height:24px;margin:auto;border:1px solid #50655d;border-radius:5px;background:#101715;color:#fff;cursor:pointer}.curator-check.is-selected{border-color:#83b6a3;background:#39715d}.curator-label{display:grid;grid-template-columns:1fr auto;gap:3px 12px;min-width:0;padding:13px 14px;border:0;border-left:1px solid #293731;background:transparent;color:inherit;text-align:left;cursor:pointer}.curator-label strong{overflow:hidden;text-overflow:ellipsis}.curator-label small{grid-column:1;color:#82958e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.curator-open{grid-column:2;grid-row:1/3;align-self:center;color:#86a89c}.curator-empty{padding:60px;text-align:center;color:#788a83}.document-curator button:focus-visible{outline:2px solid #a5d4c3;outline-offset:2px}@media(max-width:599px){.document-curator>header{padding:13px 14px}.curator-heading strong{font-size:14px}.curator-nav,.curator-summary{padding-inline:14px}.curator-list{padding-inline:8px}.curator-actions{gap:4px}.curator-actions button{padding:7px 9px}.curator-row{grid-template-columns:38px 1fr}}
`
