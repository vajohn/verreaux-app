import { useCallback, useEffect, useState } from 'react';
import { clearLogs, formatLogsAsText, getLogs } from '../../lib/log';
import type { LogEntry, LogLevel } from '../../db/types';
import { useEscape } from '../../lib/useEscape';
import './DebugViewer.css';

interface DebugViewerProps {
  onClose: () => void;
}

type Filter = 'all' | LogLevel;

const LEVEL_FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

export function DebugViewer({ onClose }: DebugViewerProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const reload = useCallback(async () => {
    const all = await getLogs({ limit: 500 });
    setEntries(all);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEscape(onClose);

  const visible = entries.filter((e) => filter === 'all' || e.level === filter);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(formatLogsAsText(visible));
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      setCopyStatus('failed');
      setTimeout(() => setCopyStatus('idle'), 2000);
    }
  }

  function handleExport(): void {
    const text = formatLogsAsText(visible);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `verreaux-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleClear(): Promise<void> {
    await clearLogs();
    await reload();
  }

  return (
    <div className="confirm-sheet" role="dialog" aria-modal="true">
      <div className="confirm-sheet__inner debug-viewer">
        <div className="debug-viewer__head">
          <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
            Diagnostic Logs
          </div>
          <button className="settings-toggle type-button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="debug-viewer__filters">
          {LEVEL_FILTERS.map((f) => (
            <button
              key={f.value}
              className={`settings-toggle type-button${filter === f.value ? ' settings-toggle--on' : ''}`}
              onClick={() => setFilter(f.value)}
              aria-pressed={filter === f.value}
            >
              {f.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <span className="type-nav-label" style={{ color: 'var(--color-text-muted)' }}>
            {visible.length} / {entries.length}
          </span>
        </div>

        <div className="debug-viewer__list">
          {visible.length === 0 ? (
            <div className="type-body" style={{ color: 'var(--color-text-muted)', padding: 12 }}>
              No log entries.
            </div>
          ) : (
            visible.map((e) => (
              <div key={e.id} className={`debug-entry debug-entry--${e.level}`}>
                <div className="debug-entry__head">
                  <span className="debug-entry__time">
                    {new Date(e.ts).toISOString().slice(11, 23)}
                  </span>
                  <span className="debug-entry__level">{e.level.toUpperCase()}</span>
                  <span className="debug-entry__source">{e.source}</span>
                </div>
                <div className="debug-entry__msg">{e.msg}</div>
                {e.ctx && <pre className="debug-entry__ctx">{prettyCtx(e.ctx)}</pre>}
              </div>
            ))
          )}
        </div>

        <div className="debug-viewer__actions">
          <button className="settings-toggle type-button" onClick={() => void reload()}>
            Refresh
          </button>
          <button className="settings-toggle type-button" onClick={() => void handleCopy()}>
            {copyStatus === 'copied' ? 'Copied!' : copyStatus === 'failed' ? 'Copy failed' : 'Copy'}
          </button>
          <button className="settings-toggle type-button" onClick={handleExport}>
            Export .txt
          </button>
          <button
            className="settings-toggle settings-toggle--gold type-button"
            onClick={() => void handleClear()}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

function prettyCtx(ctx: string): string {
  try {
    return JSON.stringify(JSON.parse(ctx), null, 2);
  } catch {
    return ctx;
  }
}
