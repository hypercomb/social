import {
    MonoTypeOperatorFunction,
    Observable,
    OperatorFunction,
    animationFrameScheduler,
    filter,
    finalize,
    map,
    takeUntil,
    throttleTime, withLatestFrom
} from 'rxjs'

export const gateBy = <T>(gate$: Observable<boolean>): OperatorFunction<T, T> =>
  (source: Observable<T>) =>
    source.pipe(
      withLatestFrom(gate$),
      filter(([_, ok]: [T, boolean]) => ok),
      map(([v]: [T, boolean]) => v)
    )

// Mono-type (T -> T)
export const rafThrottle = <T>(): MonoTypeOperatorFunction<T> =>
  throttleTime(0, animationFrameScheduler)

/** End a session when `end$` emits run `onEnd` once. */
export const untilEnd =
  <T>(end$: Observable<unknown>, onEnd?: () => void) =>
  (source: Observable<T>) =>
    source.pipe(takeUntil(end$), finalize(() => onEnd?.()))


