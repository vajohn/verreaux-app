import { useEffect } from 'react';

/**
 * useEscape — calls `callback` when the Escape key is pressed.
 * Attaches a keydown listener on the document and cleans up on unmount.
 */
export function useEscape(callback: () => void): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        callback();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [callback]);
}
