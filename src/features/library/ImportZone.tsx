import { useRef, useState, type DragEvent } from 'react';
import { useImportStore } from '../import/import.store';
import { startImport, cancelImport, continueImport } from '../import/importController';
import { useLibraryStore } from './library.store';
import { ProgressBar } from '../../ui/ProgressBar';
import { Button } from '../../ui/Button';
import { formatBytes } from '../../lib/formatBytes';
import './ImportZone.css';

interface ImportZoneProps {
  context: 'home' | 'series';
  targetSeriesId?: string;
}

export function ImportZone({ context, targetSeriesId }: ImportZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const state = useImportStore((s) => s.state);
  const reset = useImportStore((s) => s.reset);
  const activeProfileId = useLibraryStore((s) => s.activeProfileId);
  const [dragOver, setDragOver] = useState(false);

  function onPick(file: File): void {
    startImport({ file, context, targetSeriesId, activeProfileId });
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    if (f) onPick(f);
    e.target.value = '';
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onPick(f);
  }

  if (state.status === 'quota-warning') {
    return (
      <div className="import-zone import-zone--quota">
        <div className="type-section-label import-zone__head">Storage nearly full</div>
        <div className="type-body import-zone__msg">
          This import requires approximately {formatBytes(state.estimatedBytes)} but only{' '}
          {formatBytes(state.availableBytes)} is available. Continuing may fail or corrupt data.
        </div>
        <div className="import-zone__actions">
          <Button variant="ghost" onClick={() => { cancelImport(); reset(); }}>
            Cancel
          </Button>
          <Button onClick={() => continueImport()}>
            Continue Anyway
          </Button>
        </div>
      </div>
    );
  }

  if (state.status === 'running' || state.status === 'detecting') {
    const pct =
      state.status === 'running' ? state.pct / 100 : 0;
    const label =
      state.status === 'running'
        ? `${state.seriesName} — ${state.chapterIndex} / ${state.chapterTotal}`
        : 'Reading ZIP…';
    return (
      <div className="import-zone import-zone--active">
        <div className="type-section-label">Importing</div>
        <div className="type-body import-zone__label">{label}</div>
        <ProgressBar value={pct} />
        <div className="import-zone__actions">
          <Button variant="ghost" onClick={() => cancelImport()}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (state.status === 'success') {
    return (
      <div className="import-zone import-zone--success">
        <div className="type-section-label">Import complete</div>
        <div className="type-body">
          {state.seriesCount > 0
            ? `${state.seriesCount} ${state.seriesCount === 1 ? 'series' : 'series'} imported.`
            : 'Chapters merged into existing series.'}
        </div>
        <Button variant="ghost" onClick={() => reset()}>
          Dismiss
        </Button>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="import-zone import-zone--error">
        <div className="type-section-label">Import failed</div>
        <div className="type-body">{state.message}</div>
        <Button variant="ghost" onClick={() => reset()}>
          Try Again
        </Button>
      </div>
    );
  }

  if (state.status === 'cancelled') {
    return (
      <div className="import-zone">
        <div className="type-section-label">Cancelled</div>
        <div className="type-body">Any partial data has been removed.</div>
        <Button variant="ghost" onClick={() => reset()}>
          Dismiss
        </Button>
      </div>
    );
  }

  return (
    <div
      className={`import-zone${dragOver ? ' import-zone--drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="type-section-label import-zone__head">Import a library</div>
      <div className="type-body import-zone__msg">
        Drag a ZIP here, or choose a file to begin.
      </div>
      <Button onClick={() => inputRef.current?.click()}>Choose ZIP</Button>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        onChange={onChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}
