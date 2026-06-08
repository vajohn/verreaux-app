import { db } from '../db';
import type { Profile, AvatarColor } from '../types';
import { uuid } from '../../lib/uuid';
import { yieldToReads } from '../idbYield';

export async function createProfile(
  name: string,
  avatarColor: AvatarColor = 'gold',
): Promise<Profile> {
  const profile: Profile = {
    id: uuid(),
    name,
    avatarColor,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  await db.profiles.add(profile);
  return profile;
}

export async function getAllProfiles(): Promise<Profile[]> {
  return db.profiles.toArray();
}

export async function getProfile(id: string): Promise<Profile | undefined> {
  return db.profiles.get(id);
}

export async function renameProfile(id: string, name: string): Promise<void> {
  await db.profiles.update(id, { name, lastActiveAt: Date.now() });
}

export async function touchProfile(id: string): Promise<void> {
  await db.profiles.update(id, { lastActiveAt: Date.now() });
}

// Same rationale as series.repo's DELETE_BATCH_SIZE: large IDB bulk ops
// inside a single tx can overrun the auto-commit budget and abort with
// "Attempt to delete range from database without an in-progress transaction".
// Keep blob and page row deletes outside the records tx, chunked.
const DELETE_BATCH_SIZE = 250;

/**
 * Cascading delete: removes all data scoped to the profile, including blobs.
 */
export async function deleteProfile(id: string): Promise<void> {
  // Phase 1 (outside tx): gather every id that needs to go. Bounded reads.
  const seriesList = await db.series.where('profileId').equals(id).toArray();
  const seriesIds = seriesList.map((s) => s.id);

  const allChapters = seriesIds.length
    ? await db.chapters.where('seriesId').anyOf(seriesIds).toArray()
    : [];
  const chapterIds = allChapters.map((c) => c.id);

  const allPages = chapterIds.length
    ? await db.pages.where('chapterId').anyOf(chapterIds).toArray()
    : [];
  const pageIds = allPages.map((p) => p.id);
  const pageBlobIds = allPages.map((p) => p.blobId);

  const coverBlobIds: string[] = [];
  for (const s of seriesList) {
    if (s.coverImageId) coverBlobIds.push(s.coverImageId);
    if (s.coverBlobId) coverBlobIds.push(s.coverBlobId);
  }

  // Phase 2 (outside tx): chunk-delete blobs + page rows. On a full-library
  // profile this is the only place that touches per-page data, so it MUST
  // not be wrapped in a single IDB tx.
  const allBlobIds = [...pageBlobIds, ...coverBlobIds];
  for (let i = 0; i < allBlobIds.length; i += DELETE_BATCH_SIZE) {
    await db.blobs.bulkDelete(allBlobIds.slice(i, i + DELETE_BATCH_SIZE));
    await yieldToReads();
  }
  for (let i = 0; i < pageIds.length; i += DELETE_BATCH_SIZE) {
    await db.pages.bulkDelete(pageIds.slice(i, i + DELETE_BATCH_SIZE));
    await yieldToReads();
  }

  // Phase 3 (records-only tx): chapters, series, progress, bookmarks, profile.
  await db.transaction(
    'rw',
    [db.profiles, db.series, db.chapters, db.readingProgress, db.bookmarks],
    async () => {
      if (chapterIds.length > 0) {
        await db.chapters.where('id').anyOf(chapterIds).delete();
      }
      if (seriesIds.length > 0) {
        await db.series.where('id').anyOf(seriesIds).delete();
      }
      await db.readingProgress.where('profileId').equals(id).delete();
      await db.bookmarks.where('profileId').equals(id).delete();
      await db.profiles.delete(id);
    },
  );
}
