export interface SimpleLibraryTrack {
  id: string;
  name: string;
  url: string;
  mime: string;
  durationSeconds?: number;
  addedAt: number;
}

const LIBRARY_KEY = "owlbear-audio/library/v1";
const PENDING_IMPORT_KEY = "owlbear-audio/pending-import/v1";

export function loadSimpleLibrary(): SimpleLibraryTrack[] {
  try {
    const raw = window.localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SimpleLibraryTrack =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as SimpleLibraryTrack).id === "string" &&
        typeof (item as SimpleLibraryTrack).name === "string" &&
        typeof (item as SimpleLibraryTrack).url === "string",
    );
  } catch {
    return [];
  }
}

export function saveSimpleLibrary(tracks: SimpleLibraryTrack[]): void {
  window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(tracks));
}

export function mergeSimpleLibrary(
  current: SimpleLibraryTrack[],
  incoming: SimpleLibraryTrack[],
): SimpleLibraryTrack[] {
  const byUrl = new Map(current.map((track) => [track.url, track]));
  for (const track of incoming) byUrl.set(track.url, track);
  return [...byUrl.values()].sort((a, b) => b.addedAt - a.addedAt);
}

export function loadPendingImportNames(): string[] {
  try {
    const raw = window.localStorage.getItem(PENDING_IMPORT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function savePendingImportNames(names: string[]): void {
  if (!names.length) {
    window.localStorage.removeItem(PENDING_IMPORT_KEY);
    return;
  }
  window.localStorage.setItem(PENDING_IMPORT_KEY, JSON.stringify(names));
}
