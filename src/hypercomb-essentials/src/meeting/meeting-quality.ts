// meeting/meeting-quality.ts
//
// HOW GOOD A MEETING LOOKS, IN ONE PLACE. The lobby offers three choices and
// the hive drone applies them; both read this table, so what the lobby says is
// what the camera is asked for.
//
// The meeting is a full mesh, so the camera is encoded and uploaded once PER
// PEER. Each choice is therefore a shared uplink budget, split across the open
// connections between a floor and a ceiling: one peer gets the ceiling, six
// peers split the budget down toward the floor.
//
// Every number is a starting point to play with. Any of them can be overridden
// without a rebuild, for every choice at once:
//   localStorage.setItem('hc:meeting:<name>', '<number>')   then rejoin
// names: width, height, fps, uplink, min-peer, max-peer.

export type Quality = 'auto' | 'sharp' | 'saver'

export const QUALITIES: readonly Quality[] = ['saver', 'auto', 'sharp']

type Preset = {
  width: number
  height: number
  fps: number
  /** Total video bits per second the camera may spend across all peers. */
  uplink: number
  /** The most one peer is given, and the least. */
  maxPeer: number
  minPeer: number
}

const PRESETS: Readonly<Record<Quality, Preset>> = {
  saver: { width: 640, height: 360, fps: 24, uplink: 1_000_000, maxPeer: 500_000, minPeer: 150_000 },
  auto: { width: 1280, height: 720, fps: 30, uplink: 3_000_000, maxPeer: 1_500_000, minPeer: 300_000 },
  sharp: { width: 1920, height: 1080, fps: 30, uplink: 6_000_000, maxPeer: 2_500_000, minPeer: 500_000 },
}

export const isQuality = (value: unknown): value is Quality =>
  value === 'saver' || value === 'auto' || value === 'sharp'

/** A number the participant set by hand wins over the choice's own. */
const tuned = (name: string, fallback: number): number => {
  try {
    const n = Number(localStorage.getItem(`hc:meeting:${name}`))
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch { return fallback }
}

export type Devices = { camera?: string; microphone?: string }

/** The video half, as `ideal` — never `exact` — so a camera that cannot do the
 *  size still opens. A chosen device is the one exact thing: it was picked. */
export const videoConstraints = (quality: Quality, camera?: string): MediaTrackConstraints => {
  const p = PRESETS[quality]
  return {
    ...(camera ? { deviceId: { exact: camera } } : {}),
    width: { ideal: tuned('width', p.width) },
    height: { ideal: tuned('height', p.height) },
    frameRate: { ideal: tuned('fps', p.fps) },
  }
}

export const audioConstraints = (microphone?: string): MediaTrackConstraints => ({
  ...(microphone ? { deviceId: { exact: microphone } } : {}),
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
})

export const qualityConstraints = (quality: Quality, devices: Devices = {}): MediaStreamConstraints => ({
  video: videoConstraints(quality, devices.camera),
  audio: audioConstraints(devices.microphone),
})

export const frameRateOf = (quality: Quality): number => tuned('fps', PRESETS[quality].fps)

/** Video bitrate for ONE connection, given how many are open. */
export const bitrateOf = (quality: Quality, peers: number): number => {
  const p = PRESETS[quality]
  const budget = tuned('uplink', p.uplink)
  const ceiling = tuned('max-peer', p.maxPeer)
  const floor = tuned('min-peer', p.minPeer)
  return Math.round(Math.min(ceiling, Math.max(floor, budget / Math.max(1, peers))))
}

/** What a choice asks for, for the lobby to say out loud. */
export const describeQuality = (quality: Quality): { width: number; height: number; fps: number; maxMbps: number } => {
  const p = PRESETS[quality]
  return {
    width: tuned('width', p.width),
    height: tuned('height', p.height),
    fps: tuned('fps', p.fps),
    maxMbps: Math.round((tuned('max-peer', p.maxPeer) / 1_000_000) * 10) / 10,
  }
}
