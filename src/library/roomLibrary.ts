import OBR from "@owlbear-rodeo/sdk";

import type { ImportPresetId } from "@/import/transcode";
import type { SimpleLibraryTrack, TrackCategory } from "@/library/simpleLibrary";

/**
 * Owlbear room metadata 中属于本扩展的唯一键。
 *
 * 官方建议所有 metadata key 都使用反向域名/扩展命名空间，避免和其他扩展冲突。
 * 音频本体不会放进 metadata；这里只有一个很小的“索引表”。
 */
export const ROOM_LIBRARY_METADATA_KEY = "dev.zjhsteven.owlbear-audio/library";

/**
 * Owlbear 官方限制整个 room metadata 小于 16 KiB。
 *
 * 这里不直接把阈值写成 16 * 1024，而是留 256 B 余量，避免边界值在 SDK/序列化
 * 实现细节上踩线。真正检查时统计的是“房间现有全部 metadata + 我们的新索引”，
 * 因而不会只顾自己而把其他扩展的 metadata 挤爆。
 */
export const ROOM_METADATA_SAFE_LIMIT_BYTES = 16 * 1024 - 256;

/**
 * Room metadata 为了省空间使用数组元组而不是完整对象键名。
 *
 * 顺序：
 * 0 id
 * 1 name
 * 2 url
 * 3 durationSeconds（没有则 null）
 * 4 category
 * 5 group
 * 6 tags
 * 7 preset（没有则 null）
 * 8 bitrateKbps（没有则 null）
 * 9 addedAt
 *
 * mime 没有存，因为当前生产音频统一是 video/webm；读取时固定恢复。
 */
type CompactRoomTrack = [
  id: string,
  name: string,
  url: string,
  durationSeconds: number | null,
  category: TrackCategory,
  group: string,
  tags: string[],
  preset: ImportPresetId | null,
  bitrateKbps: number | null,
  addedAt: number,
];

interface RoomLibraryPayload {
  /** schema version */
  v: 1;
  /** 最后写入时间，仅用于诊断/未来冲突处理。 */
  u: number;
  /** compact tracks */
  t: CompactRoomTrack[];
}

export interface RoomLibrarySnapshot {
  tracks: SimpleLibraryTrack[];
  updatedAt: number;
}

function isCategory(value: unknown): value is TrackCategory {
  return value === "MUSIC" || value === "AMBIENCE" || value === "SFX";
}

function isPreset(value: unknown): value is ImportPresetId {
  return value === "SPEECH" || value === "AMBIENCE" || value === "MUSIC" || value === "ARCHIVE";
}

/** 把完整本机对象压成 metadata 元组，减少重复字段名带来的字节开销。 */
function compactTrack(track: SimpleLibraryTrack): CompactRoomTrack {
  return [
    track.id,
    track.name,
    track.url,
    track.durationSeconds ?? null,
    track.category,
    track.group,
    track.tags,
    track.preset ?? null,
    track.bitrateKbps ?? null,
    track.addedAt,
  ];
}

/**
 * 对 metadata 中单条元组做严格边界校验。
 *
 * 不能因为某台浏览器/旧版本写进了坏数据，就让整个 Action 在启动时崩掉；无效条目
 * 直接忽略，其余曲目仍然可以正常恢复。
 */
function expandTrack(value: unknown): SimpleLibraryTrack | null {
  if (!Array.isArray(value) || value.length < 10) return null;

  const [id, name, url, durationSeconds, category, group, tags, preset, bitrateKbps, addedAt] = value;
  if (typeof id !== "string" || typeof name !== "string" || typeof url !== "string") return null;
  if (!isCategory(category)) return null;

  return {
    id,
    name,
    url,
    mime: "video/webm",
    ...(typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
      ? { durationSeconds }
      : {}),
    category,
    group: typeof group === "string" ? group : "",
    tags: Array.isArray(tags)
      ? tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
      : [],
    ...(isPreset(preset) ? { preset } : {}),
    ...(typeof bitrateKbps === "number" && Number.isFinite(bitrateKbps)
      ? { bitrateKbps }
      : {}),
    addedAt: typeof addedAt === "number" && Number.isFinite(addedAt) ? addedAt : Date.now(),
  };
}

/**
 * 只解析我们自己的 metadata value。
 *
 * 返回 null 表示“这个房间还从未建立过共享音乐库”，这和 tracks=[] 含义不同：
 * - null：旧版本迁移时可以用本机 localStorage 去 seed 房间；
 * - []：共享库真实存在但就是空的，此时必须覆盖旧 localStorage，不能把删掉的歌复活。
 */
export function parseRoomLibraryValue(value: unknown): RoomLibrarySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<RoomLibraryPayload>;
  if (payload.v !== 1 || !Array.isArray(payload.t)) return null;

  return {
    tracks: payload.t
      .map(expandTrack)
      .filter((track): track is SimpleLibraryTrack => track !== null)
      .sort((a, b) => b.addedAt - a.addedAt),
    updatedAt: typeof payload.u === "number" && Number.isFinite(payload.u) ? payload.u : 0,
  };
}

/** 将完整曲目列表编码成可直接放入 Owlbear metadata 的小对象。 */
export function buildRoomLibraryValue(tracks: SimpleLibraryTrack[]): RoomLibraryPayload {
  return {
    v: 1,
    u: Date.now(),
    t: tracks.map(compactTrack),
  };
}

/** 返回 UTF-8 JSON 字节数；Owlbear 的 16 KiB 限制按实际传输 JSON 来估算更稳妥。 */
export function metadataUtf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** 读取当前房间的共享音乐库。null = 尚未建立。 */
export async function loadRoomLibrary(): Promise<RoomLibrarySnapshot | null> {
  const metadata = await OBR.room.getMetadata();
  return parseRoomLibraryValue(metadata[ROOM_LIBRARY_METADATA_KEY]);
}

/**
 * 保存共享音乐库，并在真正写入前检查“整个房间 metadata”的最终体积。
 *
 * 注意 setMetadata 是 partial merge，所以必须先 getMetadata 再在本地模拟 merge，才能
 * 知道加上其他扩展已有数据以后会不会超过官方 16 KiB 限制。
 */
export async function saveRoomLibrary(tracks: SimpleLibraryTrack[]): Promise<number> {
  const currentMetadata = await OBR.room.getMetadata();
  const nextValue = buildRoomLibraryValue(tracks);
  const proposedMetadata = {
    ...currentMetadata,
    [ROOM_LIBRARY_METADATA_KEY]: nextValue,
  };
  const bytes = metadataUtf8Bytes(proposedMetadata);

  if (bytes > ROOM_METADATA_SAFE_LIMIT_BYTES) {
    throw new Error(
      `房间音乐库索引已接近 Owlbear 的 16 KiB metadata 上限（当前约 ${bytes} B）。` +
      "请先移除部分曲目；后续版本会把大型音乐库迁到独立索引存储。",
    );
  }

  await OBR.room.setMetadata({ [ROOM_LIBRARY_METADATA_KEY]: nextValue });
  return bytes;
}

/**
 * 监听房间音乐库变化。
 *
 * 任何另一台电脑/手机调用 setMetadata 后，Owlbear 会把新 metadata 推到当前连接；
 * callback 收到 null 只代表 metadata 被外部清掉/还是旧房间，不应自行猜一份库。
 */
export function onRoomLibraryChange(callback: (snapshot: RoomLibrarySnapshot | null) => void): () => void {
  return OBR.room.onMetadataChange((metadata) => {
    callback(parseRoomLibraryValue(metadata[ROOM_LIBRARY_METADATA_KEY]));
  });
}
