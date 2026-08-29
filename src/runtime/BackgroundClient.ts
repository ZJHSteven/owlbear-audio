import OBR from "@owlbear-rodeo/sdk";
import {
  RUNTIME_COMMAND_CHANNEL,
  RUNTIME_EVENT_CHANNEL,
  type RuntimeCommandInput,
  type RuntimeEvent,
  type RuntimeSnapshot,
} from "./protocol";

export interface RuntimeResponse {
  ok: boolean;
  snapshot: RuntimeSnapshot;
  error?: string;
}

/**
 * Action / Modal / Tool Action 共用的本地 Background RPC 客户端。
 * 每条命令带 command id；Background 用 LOCAL broadcast 回 ACK。
 */
export class BackgroundClient {
  async send(command: RuntimeCommandInput, timeoutMs = 5000): Promise<RuntimeResponse> {
    const id = crypto.randomUUID();

    return new Promise<RuntimeResponse>((resolve, reject) => {
      let settled = false;
      const cleanup = OBR.broadcast.onMessage(RUNTIME_EVENT_CHANNEL, (event) => {
        const data = event.data as RuntimeEvent | null;
        if (!data || data.type !== "ACK" || data.commandId !== id) return;

        settled = true;
        window.clearTimeout(timeout);
        cleanup();
        resolve({
          ok: data.ok,
          snapshot: data.snapshot,
          ...(data.ok ? {} : { error: data.error }),
        });
      });

      const timeout = window.setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(new Error(`Background command ${command.type} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      void OBR.broadcast
        .sendMessage(RUNTIME_COMMAND_CHANNEL, { ...command, id }, { destination: "LOCAL" })
        .catch((error) => {
          if (settled) return;
          window.clearTimeout(timeout);
          cleanup();
          reject(error);
        });
    });
  }

  unlock(): Promise<RuntimeResponse> {
    return this.send({ type: "UNLOCK" });
  }

  play(options: {
    channelId: string;
    url: string;
    busId: "MUSIC" | "AMBIENCE" | "SFX" | "VOICE";
    gainDb?: number;
    startSeconds?: number;
    loop?: boolean;
  }): Promise<RuntimeResponse> {
    return this.send({ type: "PLAY", ...options });
  }

  pause(channelId: string): Promise<RuntimeResponse> {
    return this.send({ type: "PAUSE", channelId });
  }

  stop(channelId: string): Promise<RuntimeResponse> {
    return this.send({ type: "STOP", channelId });
  }

  stopAll(): Promise<RuntimeResponse> {
    return this.send({ type: "STOP_ALL" });
  }

  seek(channelId: string, seconds: number): Promise<RuntimeResponse> {
    return this.send({ type: "SEEK", channelId, seconds });
  }

  setBusGain(
    busId: "MASTER" | "MUSIC" | "AMBIENCE" | "SFX" | "VOICE",
    gainDb: number,
    rampSeconds = 0,
  ): Promise<RuntimeResponse> {
    return this.send({ type: "SET_BUS_GAIN", busId, gainDb, rampSeconds });
  }
}
