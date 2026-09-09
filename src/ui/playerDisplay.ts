import type { ImportPresetId } from "@/import/transcode";
import type { TrackCategory } from "@/library/simpleLibrary";
import type { RuntimePlaybackMode } from "@/runtime/protocol";

/**
 * 只放“如何显示”的纯数据与格式化函数。
 *
 * UI 组件会频繁使用这些标签；集中后能避免 GM、PLAYER、设置页各写一套中文，
 * 也让运行时协议继续保持英文枚举，不把展示文案耦合到底层状态机。
 */
export const CATEGORY_LABELS: Record<TrackCategory, string> = {
  MUSIC: "音乐",
  AMBIENCE: "氛围",
  SFX: "音效",
};

export const PRESET_LABELS: Record<ImportPresetId, string> = {
  SPEECH: "语音 · 48 kbps",
  AMBIENCE: "氛围 · 64 kbps",
  MUSIC: "音乐 · 96 kbps",
  ARCHIVE: "高质量 · 128 kbps",
};

export const PLAYBACK_MODE_LABELS: Record<RuntimePlaybackMode, string> = {
  SEQUENTIAL: "顺序播放",
  REPEAT_ONE: "单曲循环",
  REPEAT_ALL: "列表循环",
  SHUFFLE: "随机播放",
};

export const PLAYBACK_MODE_ORDER: RuntimePlaybackMode[] = [
  "SEQUENTIAL",
  "REPEAT_ONE",
  "REPEAT_ALL",
  "SHUFFLE",
];

export function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const whole = Math.floor(value);
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * shadcn base-nova 的 Slider 底层来自 Base UI，它同时支持单值和多 thumb 范围值，
 * 因而 TypeScript 回调类型是 `number | readonly number[]`。本项目所有 Slider 都是
 * 单 thumb，所以在 UI 边界统一收窄成 number，避免每个事件处理器重复写类型判断。
 */
export function singleSliderValue(value: number | readonly number[]): number {
  return typeof value === "number" ? value : (value[0] ?? 0);
}

/**
 * Owlbear SDK 某些失败路径 reject 的不是 Error，而是普通对象。
 * 直接 String(object) 只会显示令人困惑的 `[object Object]`，所以统一展开常见字段。
 */
export function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    for (const key of ["message", "error", "reason", "detail"]) {
      if (typeof value[key] === "string" && value[key]) return value[key];
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "Owlbear 返回了无法解析的错误对象";
    }
  }
  return String(error);
}
