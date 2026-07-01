const KEY = "verreaux:searchSources:disabled";
function readDisabled(): Set<string> {
  try { const raw = localStorage.getItem(KEY); return new Set(raw ? (JSON.parse(raw) as string[]) : []); }
  catch { return new Set(); }
}
function writeDisabled(s: Set<string>): void {
  try { localStorage.setItem(KEY, JSON.stringify([...s])); } catch { /* storage unavailable */ }
}
export function isSourceEnabled(id: string): boolean { return !readDisabled().has(id); }
export function setSourceEnabled(id: string, enabled: boolean): void {
  const s = readDisabled();
  if (enabled) s.delete(id); else s.add(id);
  writeDisabled(s);
}
/** Given all known source ids, return the enabled subset (preserving order). */
export function getEnabledSources(allIds: string[]): string[] {
  const disabled = readDisabled();
  return allIds.filter((id) => !disabled.has(id));
}
