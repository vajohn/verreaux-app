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
  }
}

export const db = new VerreauxDB();
