/// <reference lib="webworker" />
import JSZip from 'jszip';
import { detectImportType, type ImportContext } from './typeDetector';
import {
  runNewSeriesPipeline,
  runChapterMergePipeline,
  type WorkerOutMessage,
  type WorkerLogger,
} from './importRuntime';
import type { LogEntry, LogLevel } from '../../db/types';

type WorkerInMessage =
  | {
      type: 'START';
      file: File;
      context: ImportContext;
      targetSeriesId?: string;
      activeProfileId: string;
      runId: string;
    }
  | { type: 'CANCEL' };

const cancelToken = { cancelled: false };

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: WorkerOutMessage): void {
  ctx.postMessage(msg);
}

/**
 * Worker logger: can't write to Dexie from here without contesting the
 * schema with the main thread, so we postMessage each entry and let the main
 * thread persist it. Console.log too so devtools devs still see the trail.
 */
function makeLogger(runId: string): WorkerLogger {
  function send(level: LogLevel, source: string, msg: string, ctxValue?: unknown): void {
    let ctxStr: string | null = null;
    try {
      ctxStr =
        ctxValue === undefined
          ? null
          : JSON.stringify(ctxValue, (_k, v) => {
              if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
              return v;
            });
    } catch {
      ctxStr = '[unserializable]';
    }
    const entry: Omit<LogEntry, 'id'> = {
      ts: Date.now(),
      level,
      source: `worker.${source}`,
      msg,
      ctx: ctxStr,
      runId,
    };
    post({ type: 'LOG', entry });
    // eslint-disable-next-line no-console
    if (level === 'error') console.error(`[${entry.source}]`, msg, ctxValue);
    // eslint-disable-next-line no-console
    else if (level === 'warn') console.warn(`[${entry.source}]`, msg, ctxValue);
    // eslint-disable-next-line no-console
    else console.log(`[${entry.source}]`, msg, ctxValue);
  }
  return {
    info: (s, m, c) => send('info', s, m, c),
    warn: (s, m, c) => send('warn', s, m, c),
    error: (s, m, c) => send('error', s, m, c),
  };
}

ctx.addEventListener('message', async (e: MessageEvent<WorkerInMessage>) => {
  const data = e.data;
  if (data.type === 'CANCEL') {
    cancelToken.cancelled = true;
    return;
  }
  if (data.type !== 'START') return;

  cancelToken.cancelled = false;
  const { file, context, targetSeriesId, activeProfileId, runId } = data;
  const logger = makeLogger(runId);

  logger.info('start', 'received file', {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    context,
    hasTargetSeries: !!targetSeriesId,
  });

  try {
    let zip: JSZip;
    try {
      logger.info('zip', 'JSZip.loadAsync begin');
      const t0 = Date.now();
      zip = await JSZip.loadAsync(file);
      logger.info('zip', 'JSZip.loadAsync ok', {
        ms: Date.now() - t0,
        entryCount: Object.keys(zip.files).length,
      });
    } catch (err) {
      logger.error('zip', 'JSZip.loadAsync failed', { error: err, fileSize: file.size });
      throw new Error('This ZIP file could not be read. It may be corrupted or incomplete.');
    }

    const importType = detectImportType(zip, context);
    logger.info('detect', 'import type resolved', { importType });

    let seriesCount = 0;
    if (importType === 'type1' || importType === 'type2') {
      seriesCount = await runNewSeriesPipeline(
        zip,
        importType,
        activeProfileId,
        post,
        cancelToken,
        logger,
      );
    } else {
      if (!targetSeriesId) {
        logger.error('detect', 'missing target series for chapter update');
        throw new Error('Missing target series for chapter update.');
      }
      await runChapterMergePipeline(zip, targetSeriesId, activeProfileId, post, cancelToken, logger);
    }

    if (cancelToken.cancelled) {
      logger.info('finish', 'cancelled by user');
      post({ type: 'CANCELLED' });
      return;
    }
    logger.info('finish', 'success', { seriesCount });
    post({ type: 'SUCCESS', seriesCount });
  } catch (err) {
    if (err instanceof Error && err.message === 'CANCELLED') {
      logger.info('finish', 'cancelled (thrown)');
      post({ type: 'CANCELLED' });
      return;
    }
    const message = err instanceof Error ? err.message : 'An unknown error occurred.';
    logger.error('finish', 'failed', { error: err });
    post({ type: 'ERROR', message });
  }
});
