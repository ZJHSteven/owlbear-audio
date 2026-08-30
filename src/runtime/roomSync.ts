import type { RuntimePlayCue } from "./protocol";

export const ROOM_SYNC_CHANNEL = "dev.zjhsteven.owlbear-audio/room-sync";
export const ROOM_CHECKPOINT_METADATA_KEY = "dev.zjhsteven.owlbear-audio/public-playback";

export interface PublicCueState {
  id: string;
  name: string;
  url: string;
  busId: RuntimePlayCue["busId"];
  gainDb?: number;
  loop?: boolean;
  transitionSeconds?: number;
}

export interface AuthoritativePlaybackState {
  revision: number;
  sentAtEpochMs: number;
  phase: "IDLE" | "PLAYING" | "PAUSED" | "STOPPED";
  cue?: PublicCueState;
  positionSeconds: number;
}

export type RoomSyncMessage =
  | {
      type: "STATE_REQUEST";
    }
  | {
      type: "STATE";
      state: AuthoritativePlaybackState;
    };

export function resolveAuthoritativePosition(
  state: Pick<AuthoritativePlaybackState, "phase" | "positionSeconds" | "sentAtEpochMs" | "cue">,
  nowEpochMs: number,
  durationSeconds: number,
): number {
  const networkElapsedSeconds =
    state.phase === "PLAYING" ? Math.max(0, nowEpochMs - state.sentAtEpochMs) / 1000 : 0;
  let target = state.positionSeconds + networkElapsedSeconds;

  if (state.cue?.loop && durationSeconds > 0) return target % durationSeconds;
  if (durationSeconds > 0) return Math.min(target, Math.max(0, durationSeconds - 0.02));
  return Math.max(0, target);
}

export function isAuthoritativePlaybackState(value: unknown): value is AuthoritativePlaybackState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AuthoritativePlaybackState>;
  return (
    typeof candidate.revision === "number" &&
    typeof candidate.sentAtEpochMs === "number" &&
    typeof candidate.positionSeconds === "number" &&
    (candidate.phase === "IDLE" ||
      candidate.phase === "PLAYING" ||
      candidate.phase === "PAUSED" ||
      candidate.phase === "STOPPED")
  );
}

export function isRoomSyncMessage(value: unknown): value is RoomSyncMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; state?: unknown };
  if (candidate.type === "STATE_REQUEST") return true;
  return candidate.type === "STATE" && isAuthoritativePlaybackState(candidate.state);
}
