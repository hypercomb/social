// diamondcoreprocessor.com/meeting/meeting-audio.ts

/**
 * Spatial audio for HypercombMeeting.
 *
 * Positions each participant's audio at their hex slot angle using Web Audio API.
 * HRTF panning gives realistic directionality — each voice comes from its hex position.
 *
 * Ring 1 angles (default Hypercomb 1+6):
 *   Slot 0: 180° (left)       → (-1,  0,  0)
 *   Slot 1: 120° (upper-left) → (-0.5, 0, -0.87)
 *   Slot 2:  60° (upper-right)→ ( 0.5, 0, -0.87)
 *   Slot 3:   0° (right)      → ( 1,   0,  0)
 *   Slot 4: 300° (lower-right)→ ( 0.5, 0,  0.87)
 *   Slot 5: 240° (lower-left) → (-0.5, 0,  0.87)
 */

type SpatialNode = {
  source: MediaStreamAudioSourceNode
  panner: PannerNode
  gain: GainNode
}

export class MeetingSpatialAudio {
  #ctx: AudioContext | null = null
  #nodes: Map<string, SpatialNode> = new Map()

  /** Lazily create AudioContext (must be called after user gesture). */
  #ensureCtx(): AudioContext {
    if (!this.#ctx) {
      this.#ctx = new AudioContext({ sampleRate: 48000 })
      // listener at origin, facing forward (-Z)
      const l = this.#ctx.listener
      if (l.positionX) {
        l.positionX.value = 0; l.positionY.value = 0; l.positionZ.value = 0
        l.forwardX.value = 0; l.forwardY.value = 0; l.forwardZ.value = -1
        l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0
      }
    }
    if (this.#ctx.state === 'suspended') this.#ctx.resume()
    return this.#ctx
  }

  /**
   * Compute 3D position for a slot.
   * Ring 1 slots (0–5) are at unit distance, ring 2 (6–17) at distance 2, etc.
   */
  #slotPosition(slotIndex: number): [number, number, number] {
    // determine ring and position within ring
    let ring = 1
    let ringStart = 0
    let ringSize = 6

    while (slotIndex >= ringStart + ringSize) {
      ringStart += ringSize
      ring++
      ringSize = ring * 6
    }

    const posInRing = slotIndex - ringStart
    const totalInRing = ring * 6
    // start at 180° (left), go counterclockwise
    const angle = Math.PI - (posInRing / totalInRing) * 2 * Math.PI

    const dist = ring  // unit distance per ring
    return [
      dist * Math.cos(angle),
      0,
      dist * Math.sin(angle),
    ]
  }

  addParticipant(peerId: string, slotIndex: number, stream: MediaStream): void {
    this.removeParticipant(peerId)

    const ctx = this.#ensureCtx()
    const [x, y, z] = this.#slotPosition(slotIndex)

    const source = ctx.createMediaStreamSource(stream)

    const panner = ctx.createPanner()
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'inverse'
    panner.refDistance = 1
    panner.maxDistance = 10
    panner.rolloffFactor = 1
    panner.coneInnerAngle = 360
    panner.coneOuterAngle = 0
    panner.coneOuterGain = 0
    if (panner.positionX) {
      panner.positionX.value = x
      panner.positionY.value = y
      panner.positionZ.value = z
    } else {
      panner.setPosition(x, y, z)
    }

    const gain = ctx.createGain()
    gain.gain.value = 1.0

    source.connect(panner).connect(gain).connect(ctx.destination)

    this.#nodes.set(peerId, { source, panner, gain })
  }

  removeParticipant(peerId: string): void {
    const node = this.#nodes.get(peerId)
    if (!node) return
    node.source.disconnect()
    node.panner.disconnect()
    node.gain.disconnect()
    this.#nodes.delete(peerId)
  }

  setVolume(peerId: string, volume: number): void {
    const node = this.#nodes.get(peerId)
    if (node) node.gain.gain.value = Math.max(0, Math.min(1, volume))
  }

  get participantCount(): number { return this.#nodes.size }

  dispose(): void {
    for (const [id] of this.#nodes) this.removeParticipant(id)
    this.#ctx?.close()
    this.#ctx = null
  }
}
