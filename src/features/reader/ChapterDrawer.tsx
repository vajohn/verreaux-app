import { useState } from 'react';
import type { Chapter, Bookmark } from '../../db/types';
import { deleteBookmark } from '../../db/repos/bookmarks.repo';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { useEscape } from '../../lib/useEscape';
import './ChapterDrawer.css';

interface ChapterDrawerProps {
  chapters: Chapter[];
  currentChapterId: string | null;
  bookmarks: Bookmark[];
  seriesId: string;
  onSelectChapter: (chapterId: string) => void;
  onSelectBookmark: (bookmark: Bookmark) => void;
  onClose: () => void;
  onBookmarksChange: () => void;
}

export function ChapterDrawer({
  chapters,
  currentChapterId,
  bookmarks,
  onSelectChapter,
  onSelectBookmark,
  onClose,
  onBookmarksChange,
}: ChapterDrawerProps) {
  const [bookmarkToDelete, setBookmarkToDelete] = useState<Bookmark | null>(null);

  useEscape(() => {
    if (bookmarkToDelete) {
      setBookmarkToDelete(null);
    } else {
      onClose();
    }
  });

  async function handleDeleteBookmark(b: Bookmark) {
    await deleteBookmark(b.id);
    setBookmarkToDelete(null);
    onBookmarksChange();
  }

  return (
    <>
      <div className="chapter-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="chapter-drawer" role="dialog" aria-label="Chapters and bookmarks">
        <div className="chapter-drawer__header">
          <span className="type-section-label">Chapters</span>
          <button className="chapter-drawer__close type-button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="chapter-drawer__list">
          {chapters.map((c) => {
            const isActive = c.id === currentChapterId;
            return (
              <button
                key={c.id}
                className={`chapter-drawer__item type-body${isActive ? ' chapter-drawer__item--active' : ''}`}
                onClick={() => {
                  onSelectChapter(c.id);
                  onClose();
                }}
              >
                <span className="chapter-drawer__order type-nav-label">
                  {Number.isInteger(c.order) ? c.order : c.order.toFixed(1)}
                </span>
                <span className="chapter-drawer__title">{c.title}</span>
                {isActive && <span className="chapter-drawer__active-dot" aria-label="Current chapter" />}
              </button>
            );
          })}
        </div>

        <div className="chapter-drawer__section-head">
          <span className="type-section-label">Bookmarks</span>
        </div>
        {bookmarks.length === 0 ? (
          <div className="chapter-drawer__bookmarks-empty type-body">
            No bookmarks yet — long-press a page to add one.
          </div>
        ) : (
          <div className="chapter-drawer__list">
            {bookmarks.map((b) => {
              const ch = chapters.find((c) => c.id === b.chapterId);
              return (
                <div key={b.id} className="chapter-drawer__bookmark-row">
                  <button
                    className="chapter-drawer__bookmark type-body"
                    onClick={() => {
                      onSelectBookmark(b);
                      onClose();
                    }}
                  >
                    <span className="chapter-drawer__bookmark-info">
                      {ch ? ch.title : 'Unknown chapter'} — p.{b.pageIndex + 1}
                      {b.note && (
                        <span className="chapter-drawer__bookmark-note type-meta-italic">
                          {' '}{b.note}
                        </span>
                      )}
                    </span>
                    <span className="type-nav-label chapter-drawer__bookmark-time">
                      {formatRelativeTime(b.createdAt)}
                    </span>
                  </button>
                  <button
                    className="chapter-drawer__bookmark-delete type-button"
                    aria-label="Delete bookmark"
                    onClick={() => setBookmarkToDelete(b)}
                  >
                    Del
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {bookmarkToDelete && (
        <div className="chapter-drawer-confirm" role="dialog" aria-modal="true">
          <div className="chapter-drawer-confirm__inner">
            <div className="type-section-label" style={{ color: 'var(--color-gold)' }}>
              Delete bookmark?
            </div>
            <div className="type-body">
              This cannot be undone.
            </div>
            <div className="chapter-drawer-confirm__actions">
              <button
                className="reader-icon-btn type-button"
                onClick={() => setBookmarkToDelete(null)}
              >
                Cancel
              </button>
              <button
                className="reader-icon-btn reader-icon-btn--gold type-button"
                onClick={() => handleDeleteBookmark(bookmarkToDelete)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
