// hypercomb-core/src/ioc/service-key.ts

// -------------------------------------------------
// key construction
// -------------------------------------------------

/** Build a fully-qualified IoC key: `@namespace/Name` */
export const serviceKey = (namespace: string, name: string): string =>
  `@${namespace}/${name}`

/** Extract namespace and name from a qualified key, or null if unqualified. */
export const parseServiceKey = (key: string): { namespace: string; name: string } | null => {
  if (!key.startsWith('@')) return null
  const last = key.lastIndexOf('/')
  if (last < 1) return null
  return { namespace: key.slice(1, last), name: key.slice(last + 1) }
}
