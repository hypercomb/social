/** Probe in preference order, with bounded overlap so an unreachable host
 * cannot block a healthy mirror. The probe must verify bytes before returning
 * a value and respect cancellation. Null means that host could not serve it. */
export const firstAvailableHost = async <T>(
  hosts: readonly string[],
  probe: (host: string, signal: AbortSignal) => Promise<T | null>,
): Promise<T | null> => {
  const controller = new AbortController()
  let next = 0
  let winner: T | null = null
  const worker = async (): Promise<void> => {
    while (!controller.signal.aborted && next < hosts.length) {
      const host = hosts[next++]
      try {
        const value = await probe(host, controller.signal)
        if (value !== null && !controller.signal.aborted) {
          winner = value
          controller.abort()
        }
      } catch { /* try the next host */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, hosts.length) }, worker))
  return winner
}
