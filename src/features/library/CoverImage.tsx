import { useEffect, useRef, useState } from 'react';
import { db } from '../../db/db';

interface CoverImageProps {
  blobId: string | null;
  alt: string;
  className?: string;
}

/**
 * Loads a Blob from IDB and renders it as an img via object URL.
 * Revokes the object URL on unmount and on blobId change.
 */
export function CoverImage({ blobId, alt, className }: CoverImageProps) {
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!blobId) {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      setUrl(null);
      return;
    }
    (async () => {
      const record = await db.blobs.get(blobId);
      if (cancelled) return;
      if (!record) {
        setUrl(null);
        return;
      }
      const next = URL.createObjectURL(record.blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = next;
      setUrl(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [blobId]);

  useEffect(() => {
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, []);

  if (!url) {
    return <div className={className} aria-label={alt} />;
  }
  return <img src={url} alt={alt} className={className} />;
}
