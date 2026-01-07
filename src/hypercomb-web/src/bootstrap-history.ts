// src/bootstrap/bootstrap-history.ts

export const bootstrapHistory = async (): Promise<void> => {
  const path = window.location.pathname
  const segments = path.split('/').filter(Boolean)

  if (!segments.length) return

  // guard: only bootstrap once per load
  const state = window.history.state as any
  if (state?.__bootstrapped === true) return

  const root = await navigator.storage.getDirectory()

  // find deepest existing lineage
  const existing: string[] = []
  let dir = root

  for (const seg of segments) {
    try {
      dir = await dir.getDirectoryHandle(seg, { create: false })
      existing.push(seg)
    } catch (err) {
      const name = (err as DOMException | undefined)?.name
      if (name === 'NotFoundError') break
      throw err
    }
  }

  // reset to root as the base entry
  window.history.replaceState(
    { __bootstrapped: true, i: 0 },
    '',
    '/'
  )

  let current = ''
  let index = 0

  // seed history only up to existing folders
  for (const seg of existing) {
    current += `/${seg}`
    index++

    window.history.pushState(
      { i: index },
      '',
      current
    )
  }
}
