import OBR from "@owlbear-rodeo/sdk";
import { AudioEngine } from "../audio/AudioEngine";
import {
  RUNTIME_COMMAND_CHANNEL,
  RUNTIME_EVENT_CHANNEL,
  isRuntimeCommand,
  type RuntimeCommand,
  type RuntimeEvent,
  type RuntimeSnapshot,
} from "./protocol";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * Background iframe 内唯一的播放协调器。
 *
 * Action / Modal / Tool Action 都只发送命令，不直接拥有音频节点。
 * 这样 UI 生命周期与 transport 生命周期彻底解耦。
 */
export class BackgroundCoordinator {
  private readonly engine = new AudioEngine();
  private unsubscribe: (() => void) | null = null;

  start(): void {
    if (this.unsubscribe) return;

    this.unsubscribe = OBR.broadcast.onMessage(RUNTIME_COMMAND_CHANNEL, (event) => {
      if (!isRuntimeCommand(event.data)) return;
      void this.handle(event.data);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.engine.stopAll();
  }

  snapshot(): RuntimeSnapshot {
    return {
      contextState: this.engine.contextState,
      isUnlocked: this.engine.isUnlocked,
      channels: this.engine.snapshot(),
    };
  }

  private async handle(command: RuntimeCommand): Promise<void> {
    try {
      switch (command.type) {
        case "UNLOCK":
          await this.engine.unlock();
          break;

        case "PLAY":
          // 首次 PLAY 也允许顺便完成 unlock；如果没有真实 user activation，
          // 浏览器会在这里抛 NotAllowedError，上层即可提示用户点击 Enable Audio。
          if (!this.engine.isUnlocked) await this.engine.unlock();
          await this.engine.play(command.channelId, command.url, {
            busId: command.busId,
            gainDb: command.gainDb,
            startSeconds: command.startSeconds,
            loop: command.loop,
          });
          break;

        case "PAUSE":
          this.engine.pause(command.channelId);
          break;

        case "STOP":
          this.engine.stop(command.channelId);
          break;

        case "STOP_ALL":
          this.engine.stopAll();
          break;

        case "SEEK":
          this.engine.seek(command.channelId, command.seconds);
          break;

        case "SET_BUS_GAIN":
          this.engine.setBusGainDb(command.busId, command.gainDb, command.rampSeconds ?? 0);
          break;
      }

      await this.ack({
        type: "ACK",
        commandId: command.id,
        ok: true,
        snapshot: this.snapshot(),
      });
    } catch (error) {
      await this.ack({
        type: "ACK",
        commandId: command.id,
        ok: false,
        error: errorMessage(error),
        snapshot: this.snapshot(),
      });
    }
  }

  private async ack(event: RuntimeEvent): Promise<void> {
    await OBR.broadcast.sendMessage(RUNTIME_EVENT_CHANNEL, event, { destination: "LOCAL" });
  }
}
