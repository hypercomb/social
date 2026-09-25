// presentation/fonts/fonts.boot.drone.ts
//
// THE PACKAGE'S OWN FACES. The minimal host ships only the faces its own
// panel renders (Inter and upright Source Serif 4). The icon face and the
// italic reading serif belong to this package: the build signs their bytes
// and names them, with their descriptors, in the root layer's `resources`
// (scripts/build-module.ts, presentation/fonts/package-fonts.ts), so an
// install holds them like any other atom.
//
// This boot bee reads those entries from the installed root layer and
// declares each face ONLY where the page has none for that family and style.
// Every host keeps working as it is: a shell that already declares the face
// (the Angular shells, through fonts.css) is left alone, and a lean host gets
// the package's copy. Bytes are read through the Store rather than a URL
// route, so the same path holds on OPFS, on the native store, and on a host
// fetch after a local miss.

import { Drone, INSTALL_IOC_KEY, get, type InstallProvider } from '@hypercomb/core'

type StoreLike = {
  getLayerPoolBytes?: (signature: string) => Promise<Uint8Array | null>
  getResource?: (signature: string) => Promise<Blob | null>
}

type FontResource = {
  sig: string
  kind: 'font'
  family: string
  style: string
  weight: string
  display: string
  unicodeRange?: string
}

const SIG_RE = /^[a-f0-9]{64}$/

const unquote = (family: string): string => family.replace(/^["']|["']$/g, '')

/** A face for this family and style is already declared by the page. */
const declared = (font: FontResource): boolean =>
  [...document.fonts].some(face => unquote(face.family) === font.family && face.style === font.style)

/** The font entries the installed package's root layer names. */
const fontResources = async (store: StoreLike): Promise<FontResource[]> => {
  const root = get<InstallProvider>(INSTALL_IOC_KEY)?.installedSig?.()
  if (!root || !SIG_RE.test(root)) return []
  const bytes = await store.getLayerPoolBytes?.(root)
  if (!bytes) return []
  try {
    const layer = JSON.parse(new TextDecoder().decode(bytes)) as { resources?: unknown }
    return (Array.isArray(layer.resources) ? layer.resources : []).filter((entry): entry is FontResource =>
      !!entry && typeof entry === 'object'
      && (entry as FontResource).kind === 'font'
      && SIG_RE.test(String((entry as FontResource).sig))
      && typeof (entry as FontResource).family === 'string')
  } catch { return [] }
}

const declare = async (store: StoreLike): Promise<void> => {
  for (const font of await fontResources(store)) {
    if (declared(font)) continue
    try {
      const blob = await store.getResource?.(font.sig)
      if (!blob || blob.size === 0) continue
      const face = new FontFace(font.family, `url(${URL.createObjectURL(blob)}) format('woff2')`, {
        style: font.style,
        weight: font.weight,
        display: font.display as FontDisplay,
        ...(font.unicodeRange ? { unicodeRange: font.unicodeRange } : {}),
      })
      document.fonts.add(face)
    } catch (error) {
      console.warn(`[fonts] ${font.family} ${font.style} could not be declared`, error)
    }
  }
}

export class FontsBootDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'Package faces at boot: declares the icon face and the italic reading serif from the package\'s own signed resources, only where the page has none.'

  protected override sense = (): boolean => false
}

window.ioc.whenReady<StoreLike>('@hypercomb.social/Store', store => { void declare(store) })

window.ioc.register('@diamondcoreprocessor.com/FontsBootDrone', new FontsBootDrone())
