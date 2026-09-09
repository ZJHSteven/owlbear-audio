import type { ImportPresetId } from "@/import/transcode";
import type { TrackCategory } from "@/library/simpleLibrary";
import type { RuntimePlaybackMode } from "@/runtime/protocol";

/**
 * Action 里的偏好全部是“这个浏览器上的本机设置”。
 *
 * 这里故意不写进 Owlbear room metadata：
 * - 转码质量、默认分类、监听音量属于 DM 自己的偏好；
 * - PLAYER 的本机音量也不应该污染房间；
 * - 真正需要跨玩家共享的只有 BackgroundCoordinator 广播出去的播放状态。
 */
export interface LocalPlayerPreferences {
  defaultPreset: ImportPresetId;
  defaultCategory: TrackCategory;
  playbackMode: RuntimePlaybackMode;
  masterDb: number;
  /** 手动切歌时的交叉淡化时长；0 表示直接切换。 */
  crossfadeSeconds: number;
}

const PREFERENCES_KEY = "owlbear-audio/preferences/v2";
const WELCOME_KEY = "owlbear-audio/welcome/v2";

export const DEFAULT_PREFERENCES: LocalPlayerPreferences = {
  defaultPreset: "MUSIC",
  defaultCategory: "MUSIC",
  playbackMode: "REPEAT_ONE",
  masterDb: 0,
  crossfadeSeconds: 1.2,
};

function isPlaybackMode(value: unknown): value is RuntimePlaybackMode {
  return value === "SEQUENTIAL" ||
    value === "REPEAT_ONE" ||
    value === "REPEAT_ALL" ||
    value === "SHUFFLE";
}

function isPreset(value: unknown): value is ImportPresetId {
  return value === "SPEECH" || value === "AMBIENCE" || value === "MUSIC" || value === "ARCHIVE";
}

function isCategory(value: unknown): value is TrackCategory {
  return value === "MUSIC" || value === "AMBIENCE" || value === "SFX";
}

/** 读取偏好时逐字段校验，避免旧 localStorage 或手工修改导致整个 Action 崩溃。 */
export function loadPlayerPreferences(): LocalPlayerPreferences {
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const value = JSON.parse(raw) as Partial<LocalPlayerPreferences>;
    return {
      defaultPreset: isPreset(value.defaultPreset) ? value.defaultPreset : DEFAULT_PREFERENCES.defaultPreset,
      defaultCategory: isCategory(value.defaultCategory)
        ? value.defaultCategory
        : DEFAULT_PREFERENCES.defaultCategory,
      playbackMode: isPlaybackMode(value.playbackMode)
        ? value.playbackMode
        : DEFAULT_PREFERENCES.playbackMode,
      masterDb: typeof value.masterDb === "number" && Number.isFinite(value.masterDb)
        ? Math.max(-48, Math.min(0, value.masterDb))
        : DEFAULT_PREFERENCES.masterDb,
      crossfadeSeconds: typeof value.crossfadeSeconds === "number" && Number.isFinite(value.crossfadeSeconds)
        ? Math.max(0, Math.min(5, value.crossfadeSeconds))
        : DEFAULT_PREFERENCES.crossfadeSeconds,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePlayerPreferences(preferences: LocalPlayerPreferences): void {
  window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}

export function hasSeenWelcome(): boolean {
  return window.localStorage.getItem(WELCOME_KEY) === "seen";
}

export function markWelcomeSeen(): void {
  window.localStorage.setItem(WELCOME_KEY, "seen");
}

export function resetWelcomeSeen(): void {
  window.localStorage.removeItem(WELCOME_KEY);
}
