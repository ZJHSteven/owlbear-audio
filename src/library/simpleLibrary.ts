import type { ImportPresetId } from "../import/transcode";

export type TrackCategory = "MUSIC" | "AMBIENCE" | "SFX";

export interface SimpleLibraryTrack {
  id: string;
  name: string;
  url: string;
  mime: string;
  durationSeconds?: number;
  category: TrackCategory;
  preset?: ImportPresetId;
  bitrateKbps?: number;
  addedAt: number;
}

/**
 * 用户已经在浏览器里完成转码、但还没有从 Owlbear Asset Picker 取回 CDN URL 的素材。
 *
 * 旧版只保存文件名，因此“完成导入”以后会丢失质量、分类和时长。这里把这些信息
 * 一起暂存；即使用户关闭 Action 再回来，也能把选回来的 Owlbear 资产正确还原成
 * 音乐库条目。
 */
export interface PendingImport {
  name: string;
  category: TrackCategory;
  preset: ImportPresetId;
  durationSeconds: number;
  bitrateKbps: number;
  createdAt: number;
}

const LIBRARY_KEY = "owlbear-audio/library/v1";
const PENDING_IMPORT_KEY = "owlbear-audio/pending-import/v1";

function isCategory(value: unknown): value is TrackCategory {
  return value === "MUSIC" || value === "AMBIENCE" || value === "SFX";
}

function normalizeTrack(value: unknown): SimpleLibraryTrack | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<SimpleLibraryTrack>;
  if (typeof item.id !== "string" || typeof item.name !== "string" || typeof item.url !== "string") {
    return null;
  }

  return {
    id: item.id,
    name: item.name,
    url: item.url,
    mime: typeof item.mime === "string" ? item.mime : "video/webm",
    ...(typeof item.durationSeconds === "number" ? { durationSeconds: item.durationSeconds } : {}),
    // v0.1 旧索引没有 category；迁移时按“音乐”处理，避免升级后素材突然消失。
    category: isCategory(item.category) ? item.category : "MUSIC",
    ...(item.preset ? { preset: item.preset } : {}),
    ...(typeof item.bitrateKbps === "number" ? { bitrateKbps: item.bitrateKbps } : {}),
    addedAt: typeof item.addedAt === "number" ? item.addedAt : Date.now(),
  };
}

export function loadSimpleLibrary(): SimpleLibraryTrack[] {
  try {
    const raw = window.localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeTrack).filter((item): item is SimpleLibraryTrack => item !== null);
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

export function loadPendingImports(): PendingImport[] {
  try {
    const raw = window.localStorage.getItem(PENDING_IMPORT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((item): PendingImport[] => {
      // 兼容旧版只有文件名的 pending 数据。
      if (typeof item === "string") {
        return [{
          name: item,
          category: "MUSIC",
          preset: "MUSIC",
          durationSeconds: 0,
          bitrateKbps: 96,
          createdAt: Date.now(),
        }];
      }
      if (!item || typeof item !== "object") return [];

      const value = item as Partial<PendingImport>;
      if (typeof value.name !== "string") return [];
      return [{
        name: value.name,
        category: isCategory(value.category) ? value.category : "MUSIC",
        preset: value.preset ?? "MUSIC",
        durationSeconds: typeof value.durationSeconds === "number" ? value.durationSeconds : 0,
        bitrateKbps: typeof value.bitrateKbps === "number" ? value.bitrateKbps : 96,
        createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
      }];
    });
  } catch {
    return [];
  }
}

export function savePendingImports(imports: PendingImport[]): void {
  if (!imports.length) {
    window.localStorage.removeItem(PENDING_IMPORT_KEY);
    return;
  }
  window.localStorage.setItem(PENDING_IMPORT_KEY, JSON.stringify(imports));
}
