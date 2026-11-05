import { emit, listen } from '@tauri-apps/api/event';
import { useEffect, useRef } from 'react';

/** Event carrying the authoritative phase from the main window. */
export const BACKGROUND_CLOCK_EVENT = 'background:clock';

export interface BackgroundClock {
  /** Phase in seconds at `sentAt`. */
  phaseSeconds: number;
  speed: number;
  /** Epoch milliseconds (`Date.now()`), shared across windows. */
  sentAt: number;
}

/**
 * Broadcasts the authoritative phase. Call once per second and immediately on
 * any speed/effect/seed change.
 */
export function publishBackgroundClock(phaseSeconds: number, speed: number): void {
  const clock: BackgroundClock = { phaseSeconds, speed, sentAt: Date.now() };
  void emit(BACKGROUND_CLOCK_EVENT, clock).catch(() => {});
}

/** Extrapolates the shared phase to the current instant. */
export function clockTime(clock: BackgroundClock | null, now = Date.now()): number {
  if (!clock) return 0;
  return clock.phaseSeconds + ((now - clock.sentAt) / 1000) * clock.speed;
}

/**
 * Returns a function that yields the current shared phase. Windows that never
 * receive an event fall back to local elapsed time.
 */
export function useBackgroundClock(): () => number {
  const clockRef = useRef<BackgroundClock | null>(null);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<BackgroundClock>(BACKGROUND_CLOCK_EVENT, (event) => {
      clockRef.current = event.payload;
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {});

    return () => unlisten?.();
  }, []);

  return () => {
    if (clockRef.current) return clockTime(clockRef.current);
    return (Date.now() - startedAt.current) / 1000;
  };
}
