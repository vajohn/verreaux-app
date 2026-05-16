import { db } from './db';
import type { Profile } from './types';
import { uuid } from '../lib/uuid';

export const ACTIVE_PROFILE_KEY = 'verreaux:activeProfileId';

/**
 * Ensures at least one profile exists in the DB and that the active profile
 * id is present in localStorage. Returns the active profile id.
 */
export async function bootstrapDefaultProfile(): Promise<string> {
  await db.open();
  const existing = await db.profiles.toArray();
  let activeId: string | null = null;
  try {
    activeId = localStorage.getItem(ACTIVE_PROFILE_KEY);
  } catch {
    activeId = null;
  }

  if (existing.length === 0) {
    const profile: Profile = {
      id: uuid(),
      name: 'Reader 1',
      avatarColor: 'gold',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    await db.profiles.add(profile);
    activeId = profile.id;
  } else if (!activeId || !existing.find((p) => p.id === activeId)) {
    activeId = existing[0]!.id;
  }

  try {
    if (activeId) localStorage.setItem(ACTIVE_PROFILE_KEY, activeId);
  } catch {
    // ignore
  }
  return activeId!;
}

export function getActiveProfileId(): string {
  try {
    const v = localStorage.getItem(ACTIVE_PROFILE_KEY);
    if (v) return v;
  } catch {
    // ignore
  }
  return '';
}
