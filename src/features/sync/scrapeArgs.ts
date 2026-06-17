/** Build the scraper CLI range args from optional UI inputs. An empty or
 *  omitted field falls back to the full series: `--from 0 --to latest`.
 *  `to` may be a chapter number or the literal "latest". */
export function buildScrapeArgs(from?: string | null, to?: string | null): string {
  const f = (from ?? '').trim() || '0';
  const t = (to ?? '').trim() || 'latest';
  return `--from ${f} --to ${t}`;
}
