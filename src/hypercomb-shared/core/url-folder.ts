// hypercomb-shared/core/url-folder.ts
//
// THE HOST'S FOLDER. A page's hive location is its URL path: '/garden/kitchen'.
// A host served in a folder beside another build on one origin (hypercomb.com
// serves the minimal host at /minimal/) declares that folder as its page's
// <base href>. The path under the folder is the hive location, and every
// address the shell writes goes back under it. At a domain's root the base is
// '/' (or there is none) and nothing changes.

/** The folder this page's host is served from: its <base href>, or '/'. */
export const urlFolder = (): string => {
  try {
    const base = document.querySelector<HTMLBaseElement>('base[href]')
    if (!base) return '/'
    const path = new URL(base.href).pathname
    return path.endsWith('/') ? path : path.replace(/[^/]*$/, '')
  } catch { return '/' }
}

/** The hive path of a URL path: the path without the host's folder. */
export const hivePathname = (pathname: string = window.location.pathname): string => {
  const folder = urlFolder()
  if (folder === '/') return pathname
  if (pathname.startsWith(folder)) return '/' + pathname.slice(folder.length)
  if (`${pathname}/` === folder) return '/'
  return pathname
}

/** The URL path that shows hive path `hivePath` in this host's folder. */
export const folderPath = (hivePath: string): string => {
  const folder = urlFolder()
  return folder === '/' ? hivePath : folder + hivePath.replace(/^\/+/, '')
}
