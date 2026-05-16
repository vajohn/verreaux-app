import { useRef, useCallback } from 'react';

const LONG_PRESS_MS = 700;

interface LongPressHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
}

/**
 * Returns pointer-event handlers that call `callback` after 700 ms of
 * continuous press without movement. Cancels on pointer-up, -leave, or -cancel.
 */
export function useLongPress(callback: () => void, ms = LONG_PRESS_MS): LongPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only primary pointer (not right-click, not multi-touch secondary)
      if (!e.isPrimary) return;
      clear();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        callback();
      }, ms);
    },
    [callback, clear, ms],
  );

  const onPointerUp = useCallback(() => clear(), [clear]);
  const onPointerLeave = useCallback(() => clear(), [clear]);
  const onPointerCancel = useCallback(() => clear(), [clear]);

  return { onPointerDown, onPointerUp, onPointerLeave, onPointerCancel };
}
