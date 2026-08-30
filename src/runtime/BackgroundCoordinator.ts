import OBR from "@owlbear-rodeo/sdk";
import { AudioEngine } from "../audio/AudioEngine";
import {
  RUNTIME_COMMAND_CHANNEL,
  RUNTIME_EVENT_CHANNEL,
  isRuntimeCommand,
  type RuntimeCommand,
  type RuntimeEvent,
  type RuntimePlan,
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
  private plan: RuntimePlan | null = null;
  private currentIndex = -1;
  private nextIndex = 0;
  private currentCue: RuntimePlan["cues"][number] | null = null;
  private currentChannelId: string | null = null;
  private held = false;
  private revision = 0;

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
    const nextCue = this.plan?.cues[this.nextIndex];

    return {
      contextState: this.engine.contextState,
      isUnlocked: this.engine.isUnlocked,
      transport: {
        revision: this.revision,
        planId: this.plan?.id,
        planName: this.plan?.name,
        held: this.held,
        currentIndex: this.currentIndex,
        nextIndex: this.nextIndex,
        currentCue: this.currentCue ?? undefined,
        nextCue,
      },
      busGainsDb: {
        MASTER: this.engine.getBusGainDb("MASTER"),
        MUSIC: this.engine.getBusGainDb("MUSIC"),
        AMBIENCE: this.engine.getBusGainDb("AMBIENCE"),
        SFX: this.engine.getBusGainDb("SFX"),
        VOICE: this.engine.getBusGainDb("VOICE"),
      },
      channels: this.engine.snapshot(),
    };
  }

  private async handle(command: RuntimeCommand): Promise<void> {
    try {
      switch (command.type) {
        case "GET_SNAPSHOT":
          break;

        case "LOAD_PLAN":
          this.plan = command.plan;
          this.currentIndex = -1;
          this.nextIndex = 0;
          this.held = false;
          this.revision += 1;
          break;

        case "GO":
          await this.go();
          break;

        case "SET_HOLD":
          this.held = command.hold;
          this.revision += 1;
          break;

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

  private async go(): Promise<void> {
    if (!this.plan) throw new Error("No show is loaded. Open Studio and load a show first.");
    if (this.held) throw new Error("Show is on HOLD. Release HOLD before GO.");

    const cueIndex = this.nextIndex;
    const nextCue = this.plan.cues[cueIndex];
    if (!nextCue) throw new Error("End of show: there is no next cue.");

    if (!this.engine.isUnlocked) await this.engine.unlock();

    const nextChannelId = `cue:${nextCue.id}`;
    const currentCue = this.currentCue;
    const currentChannelId = this.currentChannelId;
    const fadeSeconds = Math.max(0, nextCue.fadeSeconds ?? 0);

    if (
      currentCue &&
      currentChannelId &&
      currentCue.busId === nextCue.busId &&
      fadeSeconds > 0
    ) {
      await this.engine.play(nextChannelId, nextCue.url, {
        busId: nextCue.busId,
        gainDb: -96,
        loop: nextCue.loop ?? false,
      });
      this.engine.crossfade(currentChannelId, nextChannelId, fadeSeconds);
      window.setTimeout(() => {
        this.engine.stop(currentChannelId);
        this.engine.destroyChannel(currentChannelId);
      }, Math.ceil(fadeSeconds * 1000) + 80);
    } else {
      if (currentCue && currentChannelId && currentCue.busId === nextCue.busId) {
        this.engine.stop(currentChannelId);
        this.engine.destroyChannel(currentChannelId);
      }
      await this.engine.play(nextChannelId, nextCue.url, {
        busId: nextCue.busId,
        gainDb: nextCue.gainDb ?? 0,
        loop: nextCue.loop ?? false,
      });
    }

    this.currentCue = nextCue;
    this.currentChannelId = nextChannelId;
    this.currentIndex = cueIndex;
    this.nextIndex = cueIndex + 1;
    this.revision += 1;
  }

  private async ack(event: RuntimeEvent): Promise<void> {
    await OBR.broadcast.sendMessage(RUNTIME_EVENT_CHANNEL, event, { destination: "LOCAL" });
  }
}
