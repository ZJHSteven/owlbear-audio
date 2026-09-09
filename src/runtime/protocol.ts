import type { BusId } from "../core/types";

export const RUNTIME_COMMAND_CHANNEL = "dev.zjhsteven.owlbear-audio/runtime-command";
export const RUNTIME_EVENT_CHANNEL = "dev.zjhsteven.owlbear-audio/runtime-event";

export interface RuntimePlayCue {
  id: string;
  name: string;
  type: "PLAY";
  url: string;
  busId: Exclude<BusId, "MASTER">;
  gainDb?: number;
  loop?: boolean;
  fadeSeconds?: number;
}

/**
 * 第一阶段播放器的四种整队列播放策略。
 *
 * 注意：这是 Background Runtime 的真实行为，不只是 Action 里的图标状态。
 * REPEAT_ONE 由底层 HTMLAudioElement.loop 实现；另外三种在媒体 ended 后由
 * BackgroundCoordinator 选择并启动下一首，因此 Action 关闭后仍然生效。
 */
export type RuntimePlaybackMode =
  | "SEQUENTIAL"
  | "REPEAT_ONE"
  | "REPEAT_ALL"
  | "SHUFFLE";

export interface RuntimePlan {
  id: string;
  name: string;
  cues: RuntimePlayCue[];
  /** 本次载入后第一次 GO 要播放的索引，默认 0。 */
  startIndex?: number;
  /** 队列播放策略，默认保持 Background 当前设置。 */
  playbackMode?: RuntimePlaybackMode;
}

export type RuntimeCommand =
  | {
      id: string;
      type: "GET_SNAPSHOT";
    }
  | {
      id: string;
      type: "LOAD_PLAN";
      plan: RuntimePlan;
    }
  | {
      id: string;
      type: "GO";
    }
  | {
      id: string;
      type: "SET_HOLD";
      hold: boolean;
    }
  | {
      id: string;
      type: "UNLOCK";
    }
  | {
      id: string;
      type: "PLAY";
      channelId: string;
      url: string;
      busId: Exclude<BusId, "MASTER">;
      gainDb?: number;
      startSeconds?: number;
      loop?: boolean;
    }
  | {
      id: string;
      type: "PAUSE";
      channelId: string;
    }
  | {
      id: string;
      type: "STOP";
      channelId: string;
    }
  | {
      id: string;
      type: "STOP_ALL";
    }
  | {
      id: string;
      type: "SEEK";
      channelId: string;
      seconds: number;
    }
  | {
      id: string;
      type: "SET_LOOP";
      channelId: string;
      loop: boolean;
    }
  | {
      id: string;
      type: "SET_PLAYBACK_MODE";
      playbackMode: RuntimePlaybackMode;
    }
  | {
      id: string;
      type: "SET_BUS_GAIN";
      busId: BusId;
      gainDb: number;
      rampSeconds?: number;
    };

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
export type RuntimeCommandInput = WithoutId<RuntimeCommand>;

export interface RuntimeSnapshot {
  contextState: AudioContextState | "UNINITIALIZED";
  isUnlocked: boolean;
  transport: {
    revision: number;
    phase: "IDLE" | "PLAYING" | "PAUSED" | "STOPPED";
    planId?: string;
    planName?: string;
    held: boolean;
    currentIndex: number;
    nextIndex: number;
    playbackMode: RuntimePlaybackMode;
    currentCue?: RuntimePlayCue;
    nextCue?: RuntimePlayCue;
    /** LOCAL snapshot 可以暴露完整队列；跨玩家 STATE 不会发送这个字段。 */
    queue: RuntimePlayCue[];
  };
  busGainsDb: Record<BusId, number>;
  channels: Array<{
    id: string;
    busId: Exclude<BusId, "MASTER">;
    url: string;
    paused: boolean;
    currentTime: number;
    duration: number;
    readyState: number;
    gainDb: number;
  }>;
}

export type RuntimeEvent =
  | {
      type: "ACK";
      commandId: string;
      ok: true;
      snapshot: RuntimeSnapshot;
    }
  | {
      type: "ACK";
      commandId: string;
      ok: false;
      error: string;
      snapshot: RuntimeSnapshot;
    };

export function isRuntimeCommand(value: unknown): value is RuntimeCommand {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { id?: unknown; type?: unknown };
  return typeof candidate.id === "string" && typeof candidate.type === "string";
}
