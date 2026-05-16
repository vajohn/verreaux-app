/// <reference lib="webworker" />
import JSZip from 'jszip';
import { detectImportType, type ImportContext } from './typeDetector';
import {
  runNewSeriesPipeline,
  runChapterMergePipeline,
  type WorkerOutMessage,
} from './importRuntime';

type WorkerInMessage =
  | {
      type: 'START';
      file: File;
      context: ImportContext;
      targetSeriesId?: string;
      activeProfileId: string;
    }
  | { type: 'CANCEL' };

const cancelToken = { cancelled: false };

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: WorkerOutMessage): void {
  ctx.postMessage(msg);
}

ctx.addEventListener('message', async (e: MessageEvent<WorkerInMessage>) => {
  const data = e.data;
  if (data.type === 'CANCEL') {
    cancelToken.cancelled = true;
    return;
  }
  if (data.type !== 'START') return;

  cancelToken.cancelled = false;
  const { file, context, targetSeriesId, activeProfileId } = data;

  try {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch {
      throw new Error('This ZIP file could not be read. It may be corrupted or incomplete.');
    }

    const importType = detectImportType(zip, context);

    let seriesCount = 0;
    if (importType === 'type1' || importType === 'type2') {
      seriesCount = await runNewSeriesPipeline(
        zip,
        importType,
        activeProfileId,
        post,
        cancelToken,
      );
    } else {
      if (!targetSeriesId) throw new Error('Missing target series for chapter update.');
      await runChapterMergePipeline(zip, targetSeriesId, activeProfileId, post, cancelToken);
    }

    if (cancelToken.cancelled) {
      post({ type: 'CANCELLED' });
      return;
    }
    post({ type: 'SUCCESS', seriesCount });
  } catch (err) {
    if (err instanceof Error && err.message === 'CANCELLED') {
      post({ type: 'CANCELLED' });
      return;
    }
    const message = err instanceof Error ? err.message : 'An unknown error occurred.';
    post({ type: 'ERROR', message });
  }
});
