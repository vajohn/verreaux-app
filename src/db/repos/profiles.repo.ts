import { db } from '../db';
import type { Profile, AvatarColor } from '../types';
import { uuid } from '../../lib/uuid';

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

/**
 * Cascading delete: removes all data scoped to the profile, including blobs.
 */
export async function deleteProfile(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.profiles, db.series, db.chapters, db.pages, db.blobs, db.readingProgress, db.bookmarks],
    async () => {
      const seriesList = await db.series.where('profileId').equals(id).toArray();
      for (const s of seriesList) {
        const chapters = await db.chapters.where('seriesId').equals(s.id).toArray();
        const chapterIds = chapters.map((c) => c.id);
        const pages = await db.pages.where('chapterId').anyOf(chapterIds).toArray();
        const pageBlobIds = pages.map((p) => p.blobId);
        await db.blobs.bulkDelete(pageBlobIds);
        await db.pages.where('chapterId').anyOf(chapterIds).delete();
        await db.chapters.where('seriesId').equals(s.id).delete();
        const coverIds: string[] = [];
        if (s.coverImageId) coverIds.push(s.coverImageId);
        if (s.coverBlobId) coverIds.push(s.coverBlobId);
        if (coverIds.length > 0) await db.blobs.bulkDelete(coverIds);
        await db.series.delete(s.id);
      }
      await db.readingProgress.where('profileId').equals(id).delete();
      await db.bookmarks.where('profileId').equals(id).delete();
      await db.profiles.delete(id);
    },
  );
}
