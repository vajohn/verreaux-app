/**
 * Diagnostic logger backed by IndexedDB (via Dexie).
 *
 * Why a custom logger when devtools exists:
 * - On a phone / installed PWA there is no console to open. When an import
 *   crashes silently in the background worker, we need a viewable, exportable
 *   trail so the user can share what happened.
 *
 * Design:
 * - One IndexedDB table (`logs`) is the single source of truth.
 * - Logs are capped at MAX_ENTRIES; we prune oldest on each write batch.
 * - Writes are fire-and-forget (no awaits) but batched on a microtask so a
 *   burst of logs doesn't slam IDB with one tx per entry.
 * - Errors are serialized to {name, message, stack}; arbitrary ctx is
 *   JSON-stringified with a fallback toString() for non-serializable values.
 * - Workers post LOG messages to the main thread; the main thread is the only
 *   writer (avoids cross-context Dexie schema collision).
 */
import { db } from '../db/db';
import type { LogEntry, LogLevel } from '../db/types';
import { uuid } from './uuid';

const MAX_ENTRIES = 500;
const FLUSH_DELAY_MS = 50;

let runId: string | null = null;
let pending: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function safeStringify(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value, (_k, v) => {
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack };
      }
      // Sets/Maps and other non-serializables → tag with type for debuggability.
      if (typeof v === 'bigint') return `${v.toString()}n`;
      if (v instanceof Map) return { __type: 'Map', entries: Array.from(v.entries()) };
      if (v instanceof Set) return { __type: 'Set', values: Array.from(v.values()) };
      return v;
    });
  } catch {
    try {
      return String(value);
    } catch {
      return '[unserializable]';
    }
  }
}

function consoleEmit(entry: LogEntry): void {
  if (typeof console === 'undefined') return;
  const tag = `[${entry.source}]`;
  const args: unknown[] = [tag, entry.msg];
  if (entry.ctx) args.push(JSON.parse(entry.ctx));
  // eslint-disable-next-line no-console
  if (entry.level === 'error') console.error(...args);
  // eslint-disable-next-line no-console
  else if (entry.level === 'warn') console.warn(...args);
  // eslint-disable-next-line no-console
  else console.log(...args);
}

function scheduleFlush(): void {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow();
  }, FLUSH_DELAY_MS);
}

async function flushNow(): Promise<void> {
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  try {
    await db.logs.bulkAdd(batch);
    await pruneIfNeeded();
  } catch (err) {
    // Last resort — surface to console so this layer never silently fails.
    // eslint-disable-next-line no-console
    console.error('[log] failed to persist batch', err);
  }
}

async function pruneIfNeeded(): Promise<void> {
  const count = await db.logs.count();
  if (count <= MAX_ENTRIES) return;
  const excess = count - MAX_ENTRIES;
  const oldest = await db.logs.orderBy('ts').limit(excess).primaryKeys();
  if (oldest.length > 0) await db.logs.bulkDelete(oldest);
}

function emit(level: LogLevel, source: string, msg: string, ctx?: unknown): void {
  const entry: LogEntry = {
    id: uuid(),
    ts: Date.now(),
    level,
    source,
    msg,
    ctx: safeStringify(ctx),
    runId,
  };
  consoleEmit(entry);
  pending.push(entry);
  scheduleFlush();
}

export const log = {
  info(source: string, msg: string, ctx?: unknown): void {
    emit('info', source, msg, ctx);
  },
  warn(source: string, msg: string, ctx?: unknown): void {
    emit('warn', source, msg, ctx);
  },
  error(source: string, msg: string, ctx?: unknown): void {
    emit('error', source, msg, ctx);
  },
  /** Group subsequent log entries under one correlation id (e.g. one import). */
  beginRun(label: string): string {
    runId = uuid();
    emit('info', 'run', `BEGIN ${label}`, { runId });
    return runId;
  },
  endRun(label: string, ctx?: unknown): void {
    emit('info', 'run', `END ${label}`, ctx);
    runId = null;
  },
  /** Accept a fully-formed entry from a worker (already-stringified ctx). */
  ingestRemote(entry: Omit<LogEntry, 'id'>): void {
    const e: LogEntry = { id: uuid(), ...entry };
    consoleEmit(e);
    pending.push(e);
    scheduleFlush();
  },
};

export async function getLogs(opts?: {
  level?: LogLevel;
  runId?: string;
  limit?: number;
}): Promise<LogEntry[]> {
  let coll = db.logs.orderBy('ts').reverse();
  if (opts?.level) coll = coll.filter((e) => e.level === opts.level);
  if (opts?.runId) coll = coll.filter((e) => e.runId === opts.runId);
  if (opts?.limit) coll = coll.limit(opts.limit);
  return coll.toArray();
}

export async function clearLogs(): Promise<void> {
  pending = [];
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await db.logs.clear();
}

export function formatLogsAsText(entries: readonly LogEntry[]): string {
  return entries
    .map((e) => {
      const iso = new Date(e.ts).toISOString();
      const head = `${iso} ${e.level.toUpperCase().padEnd(5)} [${e.source}] ${e.msg}`;
      return e.ctx ? `${head}\n  ${e.ctx}` : head;
    })
    .join('\n');
}

/** Wire global error handlers so uncaught failures are captured too. */
export function installGlobalLogHandlers(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => {
    log.error('window.error', e.message, {
      filename: e.filename,
      line: e.lineno,
      col: e.colno,
      error: e.error,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    log.error('unhandledrejection', 'Promise rejected', { reason: e.reason });
  });
}
