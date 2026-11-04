// meeting/meeting-picture.ts
//
// IS THERE A PICTURE? The camera stays off until that person shares it
// (jwize, 2026-11-02, and the flower click on 2026-11-03). Voice still
// arrives on its own. A face is drawn only where a live, unmuted video track
// is; everywhere else the seat keeps the name and picture, and the sound
// still plays.

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
