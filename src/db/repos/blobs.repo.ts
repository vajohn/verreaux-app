import { db } from '../db';
import type { BlobRecord } from '../types';
import { uuid } from '../../lib/uuid';

export async function addBlob(blob: Blob): Promise<string> {
  const id = uuid();
  await db.blobs.add({ id, blob });
  return id;
}

export async function getBlob(id: string): Promise<BlobRecord | undefined> {
  return db.blobs.get(id);
}

export async function deleteBlob(id: string): Promise<void> {
  await db.blobs.delete(id);
}
