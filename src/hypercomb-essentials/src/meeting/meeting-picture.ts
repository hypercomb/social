// meeting/meeting-picture.ts
//
// IS THERE A PICTURE? Video is off by default (jwize, 2026-11-02: "if we are
// showing video we need it to be off by default"). A person whose camera is
// off still sends a stream, for their voice, and the SFU still hands every
// subscriber a video track for them: one that carries no frames, so the
// browser marks it muted. A face is shown only where a live, unmuted video
// track is; everywhere else the seat stays, and the sound still plays.

export const showsPicture = (stream: MediaStream | null | undefined): boolean =>
  !!stream?.getVideoTracks().some(track => track.readyState === 'live' && track.enabled && !track.muted)

/** Call `changed` whenever any video track of `stream` starts or stops
 *  carrying a picture. Each track is watched once. */
const watched = new WeakSet<MediaStreamTrack>()
export const watchPicture = (stream: MediaStream, changed: () => void): void => {
  for (const track of stream.getVideoTracks()) {
    if (watched.has(track)) continue
    watched.add(track)
    track.addEventListener('mute', changed)
    track.addEventListener('unmute', changed)
    track.addEventListener('ended', changed)
  }
}
