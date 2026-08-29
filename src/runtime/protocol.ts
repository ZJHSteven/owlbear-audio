import type { BusId } from "../core/types";

export const RUNTIME_COMMAND_CHANNEL = "dev.zjhsteven.owlbear-audio/runtime-command";
export const RUNTIME_EVENT_CHANNEL = "dev.zjhsteven.owlbear-audio/runtime-event";

export type RuntimeCommand =
  | {
      id: string;
      type: "GET_SNAPSHOT";
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
