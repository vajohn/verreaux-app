import Dexie, { type Table } from 'dexie';
import type {
  Profile,
  Series,
  Chapter,
  Page,
  BlobRecord,
  ReadingProgress,
  Bookmark,
  LogEntry,
} from './types';
import { uuid } from '../lib/uuid';

export class VerreauxDB extends Dexie {
  profiles!: Table<Profile, string>;
  series!: Table<Series, string>;
  chapters!: Table<Chapter, string>;
  pages!: Table<Page, string>;
  blobs!: Table<BlobRecord, string>;
  readingProgress!: Table<ReadingProgress, string>;
  bookmarks!: Table<Bookmark, string>;
  logs!: Table<LogEntry, string>;

  constructor(name = 'VerreauxDB') {
    super(name);

    // v1 — initial (preserved for upgrade path).
    this.version(1).stores({
      series: 'id, title, lastReadAt, importedAt',
      chapters: 'id, seriesId, [seriesId+order], order',
      pages: 'id, chapterId, [chapterId+pageNumber], pageNumber',
      blobs: 'id',
      readingProgress: 'seriesId',
    });

    // v2 — profiles, bookmarks, normalizedTitle, profileId scoping.
    this.version(2)
      .stores({
        profiles: 'id',
        series:
          'id, profileId, normalizedTitle, [profileId+normalizedTitle], lastReadAt, importedAt, sortOrder',
        chapters: 'id, seriesId, profileId, [seriesId+order], order',
        pages: 'id, chapterId, [chapterId+pageNumber], pageNumber',
        blobs: 'id',
        readingProgress: 'id, profileId, seriesId, [profileId+seriesId]',
        bookmarks: 'id, profileId, seriesId, chapterId, [profileId+seriesId]',
      })
      .upgrade(async (tx) => {
        const defaultProfileId = uuid();
        await tx.table('profiles').add({
          id: defaultProfileId,
          name: 'Reader 1',
          avatarColor: 'gold',
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
        });

        // Migrate existing series.
        await tx
          .table('series')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            s['profileId'] = defaultProfileId;
            s['originalTitle'] = s['title'] ?? '';
            s['normalizedTitle'] = String(s['title'] ?? '').trim().toLowerCase();
            s['coverBlobId'] = null;
            s['pendingCoverUrl'] = null;
            s['coverFetchAttempts'] = 0;
            s['coverSource'] = 'imported';
            const importedAt = s['importedAt'] as number | undefined;
            s['sortOrder'] = importedAt ?? Date.now();
          });

        await tx
          .table('chapters')
          .toCollection()
          .modify((c: Record<string, unknown>) => {
            c['profileId'] = defaultProfileId;
            c['originalTitle'] = c['title'] ?? '';
          });

        // Migrate readingProgress (PK was seriesId in v1; now an id UUID).
        const progRecords = await tx.table('readingProgress').toArray();
        await tx.table('readingProgress').clear();
        for (const rec of progRecords) {
          await tx.table('readingProgress').add({
            ...rec,
            id: uuid(),
            profileId: defaultProfileId,
            manuallyMarked: false,
          });
        }

        try {
          localStorage.setItem('verreaux:activeProfileId', defaultProfileId);
        } catch {
          // localStorage may not be available in workers/tests; ignore.
        }
      });

    // v3 — diagnostic logs (LogEntry). Indexed on ts so we can query newest-first
    // and prune oldest cheaply.
    this.version(3).stores({
      logs: 'id, ts, level, source, runId',
    });

    // v4 — `readingProgress.scrollPosition` changed semantics from absolute
    // scrollTop to intra-page Y offset. Old absolute values (often in the
    // thousands) would apply as oversized offsets within a single page, so
    // reset them to 0. Users resume at the top of their saved page, which is
    // the prior behavior anyway — only the (broken) intra-page nudge is lost.
    this.version(4).upgrade(async (tx) => {
      await tx
        .table('readingProgress')
        .toCollection()
        .modify((r: Record<string, unknown>) => {
          r['scrollPosition'] = 0;
        });
    });

    // v5 — `Series.sourceUrl`: provenance link used by update-from-source.
    // Non-indexed field; backfill existing rows to null explicitly.
    this.version(5).upgrade(async (tx) => {
      await tx
        .table('series')
        .toCollection()
        .modify((s: Record<string, unknown>) => {
          if (s['sourceUrl'] === undefined) s['sourceUrl'] = null;
        });
    });

    // v6 — `Series.caughtUp`: marks a series' one-time sync catch-up as done.
    // Non-indexed field; backfill existing rows to false (not yet caught up),
    // so a series that is genuinely behind a shared position still gets its
    // initial windowed catch-up. A pace-setter is never behind, so this never
    // causes an unwanted prune.
    this.version(6).upgrade(async (tx) => {
      await tx
        .table('series')
        .toCollection()
        .modify((s: Record<string, unknown>) => {
          if (s['caughtUp'] === undefined) s['caughtUp'] = false;
        });
    });
  }
}

export const db = new VerreauxDB();
