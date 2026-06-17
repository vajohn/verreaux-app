import ImportWorker from './import.worker?worker';
import type { ImportContext } from './typeDetector';
import { useImportStore } from './import.store';
import { useLibraryStore } from '../library/library.store';
import { log } from '../../lib/log';
import type { LogEntry } from '../../db/types';
import { uuid } from '../../lib/uuid';

export interface StartArgs {
  file: File;
  context: ImportContext;
  targetSeriesId?: string;
  activeProfileId: string;
}

// Fraction of quota that triggers the warning banner before the import starts.
const QUOTA_WARN_THRESHOLD = 0.8;

let currentWorker: Worker | null = null;

export function cancelImport(): void {
  if (currentWorker) {
    currentWorker.postMessage({ type: 'CANCEL' });
  }
  useImportStore.getState().setPendingArgs(null);
}

// Called when the user acknowledges the quota warning and wants to proceed.
// Quota check is performed on the main thread before posting START so that
// the worker message protocol stays simple (no round-trip QUOTA_WARNING /
// CONTINUE handshake needed).
export function continueImport(): void {
  const store = useImportStore.getState();
  const args = store.pendingArgs;
  if (!args) return;
  store.setPendingArgs(null);
  launchWorker(args);
}

export function startImport(args: StartArgs): void {
  if (currentWorker) {
    currentWorker.terminate();
    currentWorker = null;
  }
  useImportStore.getState().setState({ status: 'detecting' });

  // Quota check runs on the main thread before sending START to the worker.
  // navigator.storage.estimate() is available here, which keeps the worker
  // protocol simple — no QUOTA_WARNING / CONTINUE round-trip required.
  void (async () => {
    let estimatedBytes = 0;
    let availableBytes = 0;
    let usage = 0;
    let quota = 0;

    try {
      // Use arrayBuffer to measure the compressed file size as a conservative
      // lower bound for the storage the import will occupy.
      estimatedBytes = args.file.size;
      const estimate = await navigator.storage.estimate();
      usage = estimate.usage ?? 0;
      quota = estimate.quota ?? 0;
      availableBytes = quota - usage;
    } catch {
      // If the estimate API is unavailable, skip the check and proceed.
    }

    if (quota > 0 && usage + estimatedBytes > QUOTA_WARN_THRESHOLD * quota) {
      useImportStore.getState().setState({
        status: 'quota-warning',
        estimatedBytes,
        availableBytes,
      });
      useImportStore.getState().setPendingArgs(args);
      return;
    }

    launchWorker(args);
  })();
}

function launchWorker(args: StartArgs): void {
  const w = new ImportWorker();
  currentWorker = w;
  useImportStore.getState().setState({ status: 'detecting' });

  const runId = uuid();
  log.info('import', 'launch worker', {
    runId,
    fileName: args.file.name,
    fileSize: args.file.size,
    context: args.context,
  });

  w.onmessage = (e: MessageEvent) => {
    const msg = e.data as
      | {
          type: 'PROGRESS';
          seriesName: string;
          chapterIndex: number;
          chapterTotal: number;
          pct: number;
          eta: number | null;
        }
      | { type: 'SUCCESS'; seriesCount: number }
      | { type: 'ERROR'; message: string }
      | { type: 'CANCELLED' }
      | { type: 'LOG'; entry: Omit<LogEntry, 'id'> };

    if (msg.type === 'LOG') {
      log.ingestRemote(msg.entry);
      return;
    }

    if (msg.type === 'PROGRESS') {
      useImportStore.getState().setState({
        status: 'running',
        seriesName: msg.seriesName,
        chapterIndex: msg.chapterIndex,
        chapterTotal: msg.chapterTotal,
        pct: msg.pct,
        eta: msg.eta,
      });
    } else if (msg.type === 'SUCCESS') {
      log.info('import', 'success', { runId, seriesCount: msg.seriesCount });
      useImportStore.getState().setState({ status: 'success', seriesCount: msg.seriesCount });
      void useLibraryStore.getState().loadLibrary();
      void useLibraryStore.getState().refreshStorageUsed();
      w.terminate();
      currentWorker = null;
    } else if (msg.type === 'ERROR') {
      log.error('import', 'reported error', { runId, message: msg.message });
      useImportStore.getState().setState({ status: 'error', message: msg.message });
      w.terminate();
      currentWorker = null;
    } else if (msg.type === 'CANCELLED') {
      log.info('import', 'cancelled', { runId });
      useImportStore.getState().setState({ status: 'cancelled' });
      w.terminate();
      currentWorker = null;
    }
  };

  w.onerror = (e: ErrorEvent) => {
    log.error('import', 'worker crashed', {
      runId,
      message: e.message,
      filename: e.filename,
      line: e.lineno,
      col: e.colno,
    });
    useImportStore.getState().setState({ status: 'error', message: e.message || 'Worker crashed' });
    w.terminate();
    currentWorker = null;
  };

  w.postMessage({
    type: 'START',
    file: args.file,
    context: args.context,
    targetSeriesId: args.targetSeriesId,
    activeProfileId: args.activeProfileId,
    runId,
  });
}

/**
 * Start an import and resolve when it finishes, reject on error / quota stall.
 * Used by the sync catch-up orchestrator, which must run prune + position
 * updates AFTER the import worker has written the fetched chapters.
 */
export function importToCompletion(args: StartArgs): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const unsub = useImportStore.subscribe((store) => {
      const st = store.state.status;
      if (st === 'success') { unsub(); resolve(); }
      else if (st === 'error') { unsub(); reject(new Error((store.state as { message?: string }).message ?? 'Import failed.')); }
      else if (st === 'cancelled') { unsub(); reject(new Error('Import cancelled.')); }
      else if (st === 'quota-warning') { unsub(); useImportStore.getState().setPendingArgs(null); reject(new Error('Not enough storage to import. Free space and retry.')); }
    });
    startImport(args);
  });
}
