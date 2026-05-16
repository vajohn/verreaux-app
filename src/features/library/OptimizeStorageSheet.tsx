import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../ui/Button';
import { ProgressBar } from '../../ui/ProgressBar';
import { useEscape } from '../../lib/useEscape';
import { useLibraryStore } from './library.store';
import { runOptimizeStorage, type OptimizeProgress } from './optimizeStorage';
import { formatBytes } from '../../lib/formatBytes';

interface OptimizeStorageSheetProps {
  onClose: () => void;
}

export function OptimizeStorageSheet({ onClose }: OptimizeStorageSheetProps) {
  const profileId = useLibraryStore((s) => s.activeProfileId);
  const refreshStorageUsed = useLibraryStore((s) => s.refreshStorageUsed);

  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState<OptimizeProgress>({
    processed: 0,
    total: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    skipped: 0,
  });
  const abortRef = useRef<AbortController | null>(null);

  const handleEscape = useCallback(() => {
    if (running) return;
    onClose();
  }, [running, onClose]);

  useEscape(handleEscape);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function start(): Promise<void> {
    setRunning(true);
    setDone(false);
    setProgress({ processed: 0, total: 0, bytesBefore: 0, bytesAfter: 0, skipped: 0 });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const final = await runOptimizeStorage({
      profileId,
      onProgress: setProgress,
      signal: ctrl.signal,
    });
    setProgress(final);
    setRunning(false);
    setDone(true);
    await refreshStorageUsed();
  }

  function cancel(): void {
    abortRef.current?.abort();
  }

  const pct = progress.total > 0 ? progress.processed / progress.total : 0;
  const saved = Math.max(0, progress.bytesBefore - progress.bytesAfter);

  return (
    <div className="confirm-sheet" role="dialog" aria-modal="true">
      <div className="confirm-sheet__inner">
        <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
          Optimize Storage
        </div>
        <div className="type-body">
          Recompresses imported page images for the active profile down to 1600px JPEG 0.85.
          Storage typically drops 30–60% with comparable on-screen quality.
        </div>
        <div className="type-nav-label" style={{ color: 'var(--color-text-muted)' }}>
          Bookmarks, progress, and chapter structure are untouched. Cancel any time;
          finished pages stay compressed.
        </div>

        {(running || done) && (
          <>
            <ProgressBar value={pct} />
            <div className="type-nav-label" style={{ color: 'var(--color-text-muted)' }}>
              {progress.processed} / {progress.total} pages · saved{' '}
              <strong>{formatBytes(saved)}</strong>
              {progress.skipped > 0 ? ` · ${progress.skipped} skipped` : ''}
            </div>
          </>
        )}

        <div className="confirm-sheet__actions">
          {!running && !done && (
            <>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button onClick={() => void start()}>Start</Button>
            </>
          )}
          {running && (
            <>
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
              <Button disabled>Running…</Button>
            </>
          )}
          {done && !running && (
            <>
              <Button variant="ghost" onClick={() => void start()}>
                Run again
              </Button>
              <Button onClick={onClose}>Close</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
