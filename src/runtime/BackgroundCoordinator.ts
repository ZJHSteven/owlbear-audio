import OBR from "@owlbear-rodeo/sdk";
import { AudioEngine } from "../audio/AudioEngine";
import {
  RUNTIME_COMMAND_CHANNEL,
  RUNTIME_EVENT_CHANNEL,
  isRuntimeCommand,
  type RuntimeCommand,
  type RuntimeEvent,
  type RuntimePlan,
  type RuntimePlayCue,
  type RuntimeSnapshot,
} from "./protocol";
import {
  ROOM_CHECKPOINT_METADATA_KEY,
  ROOM_SYNC_CHANNEL,
  isAuthoritativePlaybackState,
  isRoomSyncMessage,
  resolveAuthoritativePosition,
  type AuthoritativePlaybackState,
  type RoomSyncMessage,
} from "./roomSync";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

type PlayerRole = "GM" | "PLAYER";
type PlaybackPhase = RuntimeSnapshot["transport"]["phase"];

/**
 * Background iframe 内唯一的播放协调器。
 *
 * 本地 Action / Modal / Tool Action 只发送 LOCAL RPC；
 * GM 的 coordinator 额外把“当前正在发生什么”广播给 REMOTE 玩家，
 * 但不会广播 NEXT、Cue Stack 或其他 GM 私密编排信息。
 */
export class BackgroundCoordinator {
  private readonly engine = new AudioEngine();
  private runtimeUnsubscribe: (() => void) | null = null;
  private syncUnsubscribe: (() => void) | null = null;
  private heartbeatTimer: number | null = null;

  private role: PlayerRole | null = null;
  private plan: RuntimePlan | null = null;
  private currentIndex = -1;
  private nextIndex = 0;
  private currentCue: RuntimePlayCue | null = null;
  private currentChannelId: string | null = null;
  private held = false;
  private phase: PlaybackPhase = "IDLE";
  private revision = 0;

  /** PLAYER 在 autoplay 尚未解锁时只记住最新状态，不反复报错。 */
  private latestRemoteState: AuthoritativePlaybackState | null = null;
  private pendingRemoteState: AuthoritativePlaybackState | null = null;
  private applyingRemoteState = false;

  start(): void {
    if (this.runtimeUnsubscribe) return;

    this.runtimeUnsubscribe = OBR.broadcast.onMessage(RUNTIME_COMMAND_CHANNEL, (event) => {
      if (!isRuntimeCommand(event.data)) return;
      void this.handle(event.data);
    });

    this.syncUnsubscribe = OBR.broadcast.onMessage(ROOM_SYNC_CHANNEL, (event) => {
      if (!isRoomSyncMessage(event.data)) return;
      this.handleRoomSync(event.data);
    });

    void this.initializeRole();
  }

  stop(): void {
    this.runtimeUnsubscribe?.();
    this.syncUnsubscribe?.();
    this.runtimeUnsubscribe = null;
    this.syncUnsubscribe = null;
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.engine.stopAll();
  }

  /** 只用于自动化回归，生产 UI 不调用。 */
  async debugSetRoleForProbe(role: PlayerRole): Promise<void> {
    this.role = role;
    this.configureHeartbeat();
    if (role === "PLAYER") {
      await this.hydrateRoomCheckpoint();
      await this.requestRoomState();
    }
  }

  snapshot(): RuntimeSnapshot {
    const nextCue = this.plan?.cues[this.nextIndex];

    return {
      contextState: this.engine.contextState,
      isUnlocked: this.engine.isUnlocked,
      transport: {
        revision: this.revision,
        phase: this.phase,
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

  private async initializeRole(): Promise<void> {
    try {
      this.role = await OBR.player.getRole();
      this.configureHeartbeat();
      if (this.role === "PLAYER") {
        await this.hydrateRoomCheckpoint();
        await this.requestRoomState();
      }
    } catch {
      // SDK role 暂时不可读时，本地 RPC 仍可工作；下一次页面重建会重新初始化。
    }
  }

  private configureHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.role !== "GM") return;
    this.heartbeatTimer = window.setInterval(() => {
      if (this.phase === "PLAYING") void this.publishAuthoritativeState();
    }, 5000);
  }

  private async handle(command: RuntimeCommand): Promise<void> {
    try {
      let publish = false;

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
          publish = true;
          break;

        case "SET_HOLD":
          this.held = command.hold;
          this.revision += 1;
          break;

        case "UNLOCK":
          await this.engine.unlock();
          if (this.role === "PLAYER" && this.latestRemoteState) {
            this.pendingRemoteState = this.latestRemoteState;
            await this.drainRemoteStateQueue();
          }
          break;

        case "PLAY":
          if (!this.engine.isUnlocked) await this.engine.unlock();
          await this.engine.play(command.channelId, command.url, {
            busId: command.busId,
            gainDb: command.gainDb,
            startSeconds: command.startSeconds,
            loop: command.loop,
          });
          if (command.channelId === this.currentChannelId) {
            this.phase = "PLAYING";
            this.revision += 1;
            publish = true;
          }
          break;

        case "PAUSE":
          this.engine.pause(command.channelId);
          if (command.channelId === this.currentChannelId) {
            this.phase = "PAUSED";
            this.revision += 1;
            publish = true;
          }
          break;

        case "STOP":
          this.engine.stop(command.channelId);
          if (command.channelId === this.currentChannelId) {
            this.phase = "STOPPED";
            this.revision += 1;
            publish = true;
          }
          break;

        case "STOP_ALL":
          this.engine.stopAll();
          this.phase = this.currentCue ? "STOPPED" : "IDLE";
          this.revision += 1;
          publish = true;
          break;

        case "SEEK":
          this.engine.seek(command.channelId, command.seconds);
          if (command.channelId === this.currentChannelId) {
            this.revision += 1;
            publish = true;
          }
          break;

        case "SET_BUS_GAIN":
          // Bus gain 是本机监听设置；PLAYER 的 Local Master 不应反向影响其他人。
          this.engine.setBusGainDb(command.busId, command.gainDb, command.rampSeconds ?? 0);
          break;
      }

      if (publish && this.role === "GM") await this.publishAuthoritativeState(true);

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

    if (currentCue && currentChannelId && currentCue.busId === nextCue.busId && fadeSeconds > 0) {
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
    this.phase = "PLAYING";
    this.revision += 1;
  }

  private handleRoomSync(message: RoomSyncMessage): void {
    if (message.type === "STATE_REQUEST") {
      if (this.role === "GM") void this.publishAuthoritativeState();
      return;
    }

    if (this.role === "GM") return;
    if (this.latestRemoteState && message.state.revision < this.latestRemoteState.revision) return;

    this.latestRemoteState = message.state;

    // 即使声音尚未解锁，也先更新 NOW，让玩家知道 GM 当前在播什么。
    // pending 使用 latest-wins：如果 preload A 时 B/C 又来了，只保留最新状态，
    // 不让陈旧异步任务在稍后反向覆盖现场真相。
    this.adoptRemoteMetadata(message.state);
    this.pendingRemoteState = message.state;
    if (this.engine.isUnlocked) void this.drainRemoteStateQueue();
  }

  private async drainRemoteStateQueue(): Promise<void> {
    if (this.applyingRemoteState) return;
    this.applyingRemoteState = true;

    try {
      while (this.pendingRemoteState && this.engine.isUnlocked) {
        const state = this.pendingRemoteState;
        this.pendingRemoteState = null;

        // 只有仍然是最新或并列最新的 revision 才值得真正碰播放器。
        if (this.latestRemoteState && state.revision < this.latestRemoteState.revision) continue;
        await this.applyRemoteState(state);
      }
    } finally {
      this.applyingRemoteState = false;
      // await apply 的最后瞬间可能又收到了新 STATE；finally 后重新 drain，
      // 避免 pending 在竞态窗口里永久挂住。
      if (this.pendingRemoteState && this.engine.isUnlocked) void this.drainRemoteStateQueue();
    }
  }

  private adoptRemoteMetadata(state: AuthoritativePlaybackState): void {
    this.revision = Math.max(this.revision, state.revision);
    this.phase = state.phase;
    this.plan = null;
    this.currentIndex = -1;
    this.nextIndex = 0;
    this.held = false;
    this.currentCue = state.cue
      ? {
          id: state.cue.id,
          name: state.cue.name,
          type: "PLAY",
          url: state.cue.url,
          busId: state.cue.busId,
          gainDb: state.cue.gainDb,
          loop: state.cue.loop,
          fadeSeconds: state.cue.transitionSeconds,
        }
      : null;
  }

  private async applyRemoteState(state: AuthoritativePlaybackState): Promise<void> {
    const previousChannelId = this.currentChannelId;
    const previousCue = this.currentCue;
    this.adoptRemoteMetadata(state);

    if (!state.cue || state.phase === "IDLE" || state.phase === "STOPPED") {
      if (previousChannelId) {
        this.engine.stop(previousChannelId);
        this.engine.destroyChannel(previousChannelId);
      }
      this.currentChannelId = null;
      return;
    }

    const channelId = `remote:${state.cue.id}`;
    const duration = await this.engine.preload(channelId, state.cue.url, {
      busId: state.cue.busId,
      gainDb: state.cue.gainDb ?? 0,
      loop: state.cue.loop ?? false,
    });

    const nowEpochMs = Date.now();
    const networkElapsedSeconds = Math.max(0, nowEpochMs - state.sentAtEpochMs) / 1000;
    const targetPosition = resolveAuthoritativePosition(state, nowEpochMs, duration);

    const sameCue = previousCue?.id === state.cue.id && previousChannelId === channelId;

    if (state.phase === "PAUSED") {
      if (!sameCue) {
        await this.engine.play(channelId, state.cue.url, {
          busId: state.cue.busId,
          gainDb: state.cue.gainDb ?? 0,
          startSeconds: targetPosition,
          loop: state.cue.loop ?? false,
        });
      } else {
        this.engine.seek(channelId, targetPosition);
      }
      this.engine.pause(channelId);
      this.currentChannelId = channelId;
      return;
    }

    if (!sameCue) {
      const transitionSeconds = Math.max(0, state.cue.transitionSeconds ?? 0);
      const remainingTransitionSeconds = Math.max(0, transitionSeconds - networkElapsedSeconds);
      if (
        previousChannelId &&
        previousCue?.busId === state.cue.busId &&
        remainingTransitionSeconds > 0.05
      ) {
        await this.engine.play(channelId, state.cue.url, {
          busId: state.cue.busId,
          gainDb: -96,
          startSeconds: targetPosition,
          loop: state.cue.loop ?? false,
        });
        // REMOTE 状态必然比 GM 晚到。媒体 position 直接追到 authoritative clock，
        // fade 则只执行剩余时长，使玩家和 GM 在同一个墙钟点完成转场，
        // 而不是把整条 fade 从“收到消息时”重新播放一遍。
        this.engine.crossfade(previousChannelId, channelId, remainingTransitionSeconds);
        window.setTimeout(() => {
          this.engine.stop(previousChannelId);
          this.engine.destroyChannel(previousChannelId);
        }, Math.ceil(remainingTransitionSeconds * 1000) + 80);
      } else {
        if (previousChannelId) {
          this.engine.stop(previousChannelId);
          this.engine.destroyChannel(previousChannelId);
        }
        await this.engine.play(channelId, state.cue.url, {
          busId: state.cue.busId,
          gainDb: state.cue.gainDb ?? 0,
          startSeconds: targetPosition,
          loop: state.cue.loop ?? false,
        });
      }
      this.currentChannelId = channelId;
      return;
    }

    const channel = this.engine.snapshot().find((item) => item.id === channelId);
    if (!channel) {
      await this.engine.play(channelId, state.cue.url, {
        busId: state.cue.busId,
        gainDb: state.cue.gainDb ?? 0,
        startSeconds: targetPosition,
        loop: state.cue.loop ?? false,
      });
      this.currentChannelId = channelId;
      return;
    }

    if (channel.paused) {
      this.engine.seek(channelId, targetPosition);
      await this.engine.play(channelId, state.cue.url, {
        busId: state.cue.busId,
        gainDb: state.cue.gainDb ?? 0,
        loop: state.cue.loop ?? false,
      });
      return;
    }

    // Heartbeat 使用低频硬纠偏；后续可在小漂移时改成短时 playbackRate 微调。
    if (Math.abs(channel.currentTime - targetPosition) > 0.35) {
      this.engine.seek(channelId, targetPosition);
    }
  }

  private buildAuthoritativeState(): AuthoritativePlaybackState {
    const channel = this.currentChannelId
      ? this.engine.snapshot().find((item) => item.id === this.currentChannelId)
      : undefined;

    return {
      revision: this.revision,
      sentAtEpochMs: Date.now(),
      phase: this.phase,
      cue: this.currentCue
        ? {
            id: this.currentCue.id,
            name: this.currentCue.name,
            url: this.currentCue.url,
            busId: this.currentCue.busId,
            gainDb: this.currentCue.gainDb,
            loop: this.currentCue.loop,
            transitionSeconds: this.currentCue.fadeSeconds,
          }
        : undefined,
      positionSeconds: channel?.currentTime ?? 0,
    };
  }

  private async publishAuthoritativeState(persistCheckpoint = false): Promise<void> {
    const state = this.buildAuthoritativeState();
    if (persistCheckpoint) {
      await OBR.room.setMetadata({ [ROOM_CHECKPOINT_METADATA_KEY]: state });
    }
    await OBR.broadcast.sendMessage(
      ROOM_SYNC_CHANNEL,
      { type: "STATE", state } satisfies RoomSyncMessage,
      { destination: "REMOTE" },
    );
  }

  private async hydrateRoomCheckpoint(): Promise<void> {
    try {
      const metadata = await OBR.room.getMetadata();
      const checkpoint = metadata[ROOM_CHECKPOINT_METADATA_KEY];
      if (!isAuthoritativePlaybackState(checkpoint)) return;
      if (this.latestRemoteState && checkpoint.revision < this.latestRemoteState.revision) return;

      this.latestRemoteState = checkpoint;
      this.pendingRemoteState = checkpoint;
      this.adoptRemoteMetadata(checkpoint);
      if (this.engine.isUnlocked) await this.drainRemoteStateQueue();
    } catch {
      // Metadata 只做快速恢复；失败时仍可依靠 STATE_REQUEST + heartbeat。
    }
  }

  private async requestRoomState(): Promise<void> {
    await OBR.broadcast.sendMessage(
      ROOM_SYNC_CHANNEL,
      { type: "STATE_REQUEST" } satisfies RoomSyncMessage,
      { destination: "REMOTE" },
    );
  }

  private async ack(event: RuntimeEvent): Promise<void> {
    await OBR.broadcast.sendMessage(RUNTIME_EVENT_CHANNEL, event, { destination: "LOCAL" });
  }
}
