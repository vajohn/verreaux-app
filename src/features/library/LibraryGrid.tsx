import { useRef } from 'react';
import type { Series } from '../../db/types';
import { SeriesCard } from './SeriesCard';
import { useLibraryStore } from './library.store';
import { setSortOrder } from '../../db/repos/series.repo';
import './LibraryGrid.css';

interface LibraryGridProps {
  series: Series[];
  profileId: string;
  showTimestamps?: boolean;
  emptyText?: string;
}

export function LibraryGrid({ series, profileId, showTimestamps, emptyText }: LibraryGridProps) {
  const librarySort = useLibraryStore((s) => s.librarySort);
  const loadLibrary = useLibraryStore((s) => s.loadLibrary);
  const dragIndexRef = useRef<number>(-1);

  if (series.length === 0) {
    return (
      <div className="library-grid__empty type-body">
        {emptyText ?? 'No series yet. Import a ZIP to get started.'}
      </div>
    );
  }

  const isDraggable = librarySort === 'custom';

  function handleDragStart(index: number) {
    dragIndexRef.current = index;
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIndexRef.current === index) return;
    // Visual hint only — actual swap on drop
  }

  async function handleDrop(e: React.DragEvent, dropIndex: number) {
    e.preventDefault();
    const dragIndex = dragIndexRef.current;
    if (dragIndex === dropIndex || dragIndex < 0) return;

    const dragItem = series[dragIndex];
    const dropItem = series[dropIndex];
    if (!dragItem || !dropItem) return;

    // Swap sortOrder values
    await setSortOrder(dragItem.id, dropItem.sortOrder);
    await setSortOrder(dropItem.id, dragItem.sortOrder);
    dragIndexRef.current = -1;
    await loadLibrary();
  }

  async function handleMoveUp(index: number) {
    if (index <= 0) return;
    const current = series[index];
    const prev = series[index - 1];
    if (!current || !prev) return;
    await setSortOrder(current.id, prev.sortOrder);
    await setSortOrder(prev.id, current.sortOrder);
    await loadLibrary();
  }

  async function handleMoveDown(index: number) {
    if (index >= series.length - 1) return;
    const current = series[index];
    const next = series[index + 1];
    if (!current || !next) return;
    await setSortOrder(current.id, next.sortOrder);
    await setSortOrder(next.id, current.sortOrder);
    await loadLibrary();
  }

  return (
    <div className="library-grid">
      {series.map((s, index) => (
        <div
          key={s.id}
          draggable={isDraggable}
          onDragStart={isDraggable ? () => handleDragStart(index) : undefined}
          onDragOver={isDraggable ? (e) => handleDragOver(e, index) : undefined}
          onDrop={isDraggable ? (e) => { void handleDrop(e, index); } : undefined}
          className={isDraggable ? 'library-grid__draggable' : undefined}
        >
          {isDraggable && (
            <div className="library-grid__sort-arrows" aria-label={`Reorder ${s.title}`}>
              <button
                className="library-grid__sort-btn type-button"
                onClick={() => { void handleMoveUp(index); }}
                disabled={index === 0}
                aria-label={`Move ${s.title} up`}
              >
                ^
              </button>
              <button
                className="library-grid__sort-btn type-button"
                onClick={() => { void handleMoveDown(index); }}
                disabled={index === series.length - 1}
                aria-label={`Move ${s.title} down`}
              >
                v
              </button>
            </div>
          )}
          <SeriesCard series={s} profileId={profileId} showTimestamp={showTimestamps} />
        </div>
      ))}
    </div>
  );
}
