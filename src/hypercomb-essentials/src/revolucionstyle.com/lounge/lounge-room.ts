// THE ROOM — one logical piece, however it is framed.
//
// A lounge is not a page about a lounge. It is a sig-addressed bundle that
// paints a three.js room into whatever element it is given, plus the art it
// hangs on the walls. That whole thing is ONE artifact, and this module is
// the only code that knows how to bring it up:
//
//     const room = mountLoungeRoom(host, payload)
//
// Every FRAME borrows it. The view frame (lounge-view.drone.ts) gives it the
// whole viewport with two chips of chrome; the website page gives it a stage
// inside a reading column with a concierge beside it; a future frame may hang
// it in a panel. They diverge in what surrounds the room and never in the
// room — which is what "the same logical piece, used in different places"
// has to mean if it is to mean anything.
//
// THE RECORD is `visual:lounge:room` on the cell, and it names its parts by
// signature the way every other composed thing here does:
//
//     { version: 1, bundleSig, art: { lounge: <sig>, ... } }
//
// So the cell IS the room. Not "a cell that links to a room", not "a page in
// a site that happens to render a room" — the tile carries the room's
// identity, which is why it can be adopted, shared, and walked into on its
// own. A SECOND room is a second `bundleSig` on a second tile: same
// behaviour, different world.

import { RESOURCE_URL_PREFIX } from '@hypercomb/core'
import { listDecorations } from '../../diamondcoreprocessor.com/commands/decoration-manifest.js'

/** The ViewMode token this room opens as. */
export const LOUNGE_VIEW = 'lounge'
/** The decoration kind that makes a cell a room. */
export const LOUNGE_KIND = 'visual:lounge:room'

const SIG_RE = /^[0-9a-f]{64}$/

/** Payload of a `visual:lounge:room` record. Everything except the bundle is
 *  optional — a room with no art hangs its own painted prints, which is the
 *  bundle's documented fallback. */
export interface LoungeRoomPayload {
  readonly version: 1
  /** The room bundle — an IIFE resource that boots into `mount`. Required:
   *  without it there is no room, and the frame falls through rather than
   *  mounting an empty box. */
  readonly bundleSig: string
  /** Wall art by frame key (`lounge`, `cigars`, `journal`, ...) → resource sig
   *  of the picture to hang. Signatures, never inline bytes: the same tile
   *  art the hive already holds, referenced not copied. */
  readonly art?: Readonly<Record<string, string>>
  /** Camera presets a frame may offer as chips, in the order to offer them.
   *  Names the bundle knows (`room`, `fire`, `gallery`, `humidor`, `chair`,
   *  `darts`, ...). Absent = the frame's own default set. */
  readonly views?: readonly string[]
  /** Tooltip / toggle label for this particular room. */
  readonly label?: string
  /** This room's own glyph on the toggle strip. */
  readonly icon?: string
  /** Which room the bundle boots into when it can build more than one —
   *  the lounge bundle knows 'lounge' (default) and 'bar' (EL BAR, the shop).
   *  A second room can be a second bundleSig OR the same bundle told to
   *  stand a different world up; the record decides. */
  readonly room?: string
}

/** The camera chips a frame offers when the record names none. The order is
 *  the tour: where you land, the fire, the pictures, the humidor, the chair
 *  you would actually sit in, the oche. */
export const DEFAULT_LOUNGE_VIEWS = ['room', 'fire', 'gallery', 'humidor', 'chair', 'darts'] as const

/** The camera chips this record asks for — its own list, else the default
 *  tour. Blank entries are dropped rather than rendered as empty chips. */
export function loungeViews(payload: LoungeRoomPayload | null): readonly string[] {
  const named = (payload?.views ?? []).map(v => String(v ?? '').trim()).filter(Boolean)
  return named.length ? named : [...DEFAULT_LOUNGE_VIEWS]
}

/** Whether a record is a usable room. A record with no `bundleSig` is not a
 *  room — a frame that mounted it would show an empty box and trap the
 *  participant inside it. */
export function isRoomRecord(payload: unknown): payload is LoungeRoomPayload {
  const sig = (payload as { bundleSig?: unknown } | null)?.bundleSig
  return typeof sig === 'string' && SIG_RE.test(sig)
}

/** The room record on this cell, or null when the cell is not a room. */
export async function loungeRoomAt(segments: readonly string[]): Promise<LoungeRoomPayload | null> {
  try {
    const records = await listDecorations<LoungeRoomPayload>({
      kind: LOUNGE_KIND,
      segments: [...segments],
    })
    for (const found of records) {
      const payload = found.record?.payload
      if (isRoomRecord(payload)) return payload
    }
  } catch { /* cold read — the caller treats a miss as "not a room" */ }
  return null
}

/** `<sig>` → the URL the service worker serves it from. The `tail` matters:
 *  content type is guessed from the URL's extension, so the bundle MUST be
 *  asked for as `.../lounge-3d.js` or it comes back as a blob the browser
 *  refuses to execute. */
export function resourceUrl(sig: string, tail: string): string {
  return `${RESOURCE_URL_PREFIX}${sig}/${tail}`
}

/** The wall art, resolved from signatures to URLs the room can load. Entries
 *  that are not signatures are dropped — a frame hangs what it has. */
export function artUrls(payload: LoungeRoomPayload | null): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, sig] of Object.entries(payload?.art ?? {})) {
    if (typeof sig === 'string' && SIG_RE.test(sig)) out[key] = resourceUrl(sig, 'art.png')
  }
  return out
}

/** What the bundle reads off `window` before it boots. Mirrors the config
 *  the website page has always written — one shape, two callers. */
interface LoungeConfig {
  mount: string
  fallback: string
  controls?: string
  art?: Record<string, string>
  room?: string
}

type LoungeApi = {
  setSlot(id: string, on: boolean): void
  view(name: string): void
  frame(): void
  ready?: Promise<boolean>
}

type LoungeWindow = Window & {
  REV_LOUNGE?: LoungeConfig
  RevLounge3D?: LoungeApi
}

/** How many rooms this document has brought up — the mount ids have to be
 *  unique per host, since the bundle finds its stage with a selector. */
let mountCounter = 0

export interface MountedRoom {
  /** The element the room painted into. */
  readonly stage: HTMLElement
  /** Drive the room once it is up — camera presets, prop switches. Resolves
   *  when the bundle has published its API, or null when the room never came
   *  up (no WebGL: the fallback is showing instead). */
  ready(): Promise<LoungeApi | null>
  /** Take the room down. The bundle disposes itself the moment its canvas
   *  leaves the document, so removing the nodes IS the teardown — this also
   *  drops the config and the script node so a second mount starts clean. */
  teardown(): void
}

/**
 * Bring the room up inside `host`.
 *
 * The caller owns `host` — its size, its position, its chrome. This function
 * owns everything from the stage inwards. That line is the whole point: a
 * frame can put the room in a viewport or in a column without either frame
 * knowing anything about three.js, and the room cannot know or care which
 * frame it is in.
 *
 * PASSIVE, as the bundle is by doctrine: it boots on idle, pauses when the
 * tab is hidden, and never sits on the boot path. Nothing here awaits the
 * scene — the mount returns as soon as the script is on its way.
 */
export function mountLoungeRoom(host: HTMLElement, payload: LoungeRoomPayload): MountedRoom {
  const id = `hc-lounge-${++mountCounter}`
  const win = window as LoungeWindow

  const stage = document.createElement('div')
  stage.id = id
  stage.setAttribute('role', 'img')
  stage.setAttribute('aria-label', payload.room === 'bar'
    ? 'A three-dimensional bar: a long counter with brass rail and stools, ' +
      'shelves of bottles before a mirror, and a display case of goods for sale'
    : 'A three-dimensional cigar lounge: a fire in the hearth, leather wingbacks, ' +
      'framed art on the walls, a humidor cabinet, and a cigar going in the ashtray')
  stage.style.cssText = 'position:absolute;inset:0;overflow:hidden'
  // Without this the hive's wheel-zoom handler preventDefaults every wheel
  // event over the canvas and the room cannot be dollied.
  stage.setAttribute('data-consumes-wheel', '')

  // The bundle unhides this instead of the stage when WebGL is unavailable or
  // the scene throws. A room that fails silently reads as a broken tile, so
  // the fallback says what happened in the room's own voice.
  const fallback = document.createElement('div')
  fallback.id = `${id}-fallback`
  fallback.hidden = true
  fallback.style.cssText =
    'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
    'padding:2rem;text-align:center;color:#e8d9ae;' +
    'font:1rem/1.5 Georgia,"Times New Roman",serif'
  const line = document.createElement('p')
  line.textContent = 'The room needs WebGL, and this browser is not giving it up.'
  line.style.cssText = 'margin:0;max-width:32ch;opacity:.8'
  fallback.appendChild(line)

  host.append(stage, fallback)

  const art = artUrls(payload)

  // Config BEFORE the script: the bundle reads it at boot, and boot is
  // scheduled by the script's own evaluation.
  win.REV_LOUNGE = {
    mount: `#${id}`,
    fallback: `#${id}-fallback`,
    ...(Object.keys(art).length ? { art } : {}),
    ...(payload.room ? { room: payload.room } : {}),
  }

  const script = document.createElement('script')
  script.src = resourceUrl(payload.bundleSig, 'lounge-3d.js')
  script.async = true
  document.head.appendChild(script)

  let torn = false

  const ready = async (): Promise<LoungeApi | null> => {
    // The bundle announces itself by publishing the API and firing
    // `lounge3d:ready` on the stage. Whichever comes first wins; a room that
    // never boots (no WebGL — the fallback is showing) resolves null rather
    // than hanging a caller forever.
    if (win.RevLounge3D) return win.RevLounge3D
    return new Promise<LoungeApi | null>(resolve => {
      const settle = (): void => {
        clearTimeout(timer)
        stage.removeEventListener('lounge3d:ready', settle)
        resolve(torn ? null : win.RevLounge3D ?? null)
      }
      const timer = setTimeout(settle, 6000)
      stage.addEventListener('lounge3d:ready', settle, { once: true })
    })
  }

  return {
    stage,
    ready,
    teardown(): void {
      if (torn) return
      torn = true
      script.remove()
      // Dropping the nodes is what tells the bundle's animation loop to
      // dispose — it checks `canvas.isConnected` every frame.
      stage.remove()
      fallback.remove()
      if (win.REV_LOUNGE?.mount === `#${id}`) delete win.REV_LOUNGE
    },
  }
}
