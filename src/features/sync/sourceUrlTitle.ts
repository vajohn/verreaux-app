/** Best-effort readable title from a series source URL. The import renames the
 *  series from the ZIP manifest on success; this is only the placeholder shown
 *  while a freshly-created shell series is downloading. */
export function titleFromSourceUrl(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return 'New series'; }
  const segs = u.pathname.split('/').filter(Boolean);
  if (segs.length === 0) return u.host;
  const titleCase = (s: string) =>
    s.replace(/[-_]+/g, ' ').trim().replace(/\s+/g, ' ')
      .split(' ').map((w) => w ? w[0]!.toUpperCase() + w.slice(1) : w).join(' ');
  const last = segs[segs.length - 1]!;
  // A purely-numeric final segment (an id) reads better with its parent segment.
  if (/^\d+$/.test(last) && segs.length >= 2) return `${titleCase(segs[segs.length - 2]!)} ${last}`;
  return titleCase(last) || u.host;
}
