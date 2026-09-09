import OBR from "@owlbear-rodeo/sdk";
import {
  RUNTIME_COMMAND_CHANNEL,
  RUNTIME_EVENT_CHANNEL,
  type RuntimeCommandInput,
  type RuntimeEvent,
  type RuntimePlan,
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
  private readyUntil = 0;

  private async sendRaw(command: RuntimeCommandInput, timeoutMs: number): Promise<RuntimeResponse> {
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
        reject(new Error(`Background ${command.type} 未在 ${timeoutMs}ms 内响应`));
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

  private async ensureReady(maxWaitMs = 2500): Promise<void> {
    if (Date.now() < this.readyUntil) return;

    const startedAt = performance.now();
    let delayMs = 80;
    let lastError: unknown = null;
    while (performance.now() - startedAt < maxWaitMs) {
      try {
        await this.sendRaw({ type: "GET_SNAPSHOT" }, 350);
        this.readyUntil = Date.now() + 2000;
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        delayMs = Math.min(400, Math.round(delayMs * 1.6));
      }
    }

    const detail = lastError instanceof Error ? `：${lastError.message}` : "";
    throw new Error(`Owlbear Audio 后台播放器未启动${detail}`);
  }

  async send(command: RuntimeCommandInput, timeoutMs?: number): Promise<RuntimeResponse> {
    if (command.type !== "GET_SNAPSHOT") await this.ensureReady();
    const effectiveTimeout = timeoutMs ?? (command.type === "PLAY" || command.type === "GO" ? 8000 : 1800);
    const response = await this.sendRaw(command, effectiveTimeout);
    this.readyUntil = Date.now() + 2000;
    return response;
  }

  snapshot(): Promise<RuntimeResponse> {
    return this.sendRaw({ type: "GET_SNAPSHOT" }, 700);
  }

  loadPlan(plan: RuntimePlan): Promise<RuntimeResponse> {
    return this.send({ type: "LOAD_PLAN", plan });
  }

  go(): Promise<RuntimeResponse> {
    return this.send({ type: "GO" });
  }

  setHold(hold: boolean): Promise<RuntimeResponse> {
    return this.send({ type: "SET_HOLD", hold });
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

  setLoop(channelId: string, loop: boolean): Promise<RuntimeResponse> {
    return this.send({ type: "SET_LOOP", channelId, loop });
  }

  setBusGain(
    busId: "MASTER" | "MUSIC" | "AMBIENCE" | "SFX" | "VOICE",
    gainDb: number,
    rampSeconds = 0,
  ): Promise<RuntimeResponse> {
    return this.send({ type: "SET_BUS_GAIN", busId, gainDb, rampSeconds });
  }
}
