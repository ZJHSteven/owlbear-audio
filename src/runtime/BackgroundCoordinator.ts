import OBR from "@owlbear-rodeo/sdk";
import { AudioEngine } from "../audio/AudioEngine";
import {
  RUNTIME_COMMAND_CHANNEL,
  RUNTIME_EVENT_CHANNEL,
  isRuntimeCommand,
  type RuntimeCommand,
  type RuntimeEvent,
  type RuntimePlaybackMode,
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
  private readonly engine: AudioEngine;
  private runtimeUnsubscribe: (() => void) | null = null;
  private syncUnsubscribe: (() => void) | null = null;
  private playerUnsubscribe: (() => void) | null = null;
  private heartbeatTimer: number | null = null;

  private role: PlayerRole | null = null;
  /**
   * Owlbear 的 role 读取是异步的。旧实现只是 fire-and-forget initializeRole()，
   * 因而 Background 刚挂载时用户立刻按 GO，`this.role` 仍可能是 null：
   * 音乐本机已经播放，但第一次 authoritative broadcast 会被跳过，PLAYER 只能
   * 等 5 秒 heartbeat 补发。这正是此前“为什么要等约 5000 ms”的根因。
   *
   * 现在把初始化 Promise 保存下来；任何需要对外发布的命令都必须先 await 它。
   * heartbeat 只保留作低频纠偏，不再承担首帧启动职责。
   */
  private roleReady: Promise<PlayerRole | null> | null = null;
  private plan: RuntimePlan | null = null;
  private currentIndex = -1;
  private nextIndex = 0;
  private playbackMode: RuntimePlaybackMode = "REPEAT_ONE";
  private currentCue: RuntimePlayCue | null = null;
  private currentChannelId: string | null = null;
  private held = false;
  private phase: PlaybackPhase = "IDLE";
  private revision = 0;

  /** PLAYER 在 autoplay 尚未解锁时只记住最新状态，不反复报错。 */
  private latestRemoteState: AuthoritativePlaybackState | null = null;
  private pendingRemoteState: AuthoritativePlaybackState | null = null;
  private applyingRemoteState = false;
  private advancingAfterEnd = false;

  constructor() {
    /**
     * AudioEngine 只负责“这一条媒体怎么播”；完整歌单推进必须放在 BackgroundCoordinator。
     * 这样 Action 关闭以后，媒体自然结束仍然能按照顺序/列表循环/随机策略继续下一首。
     */
    this.engine = new AudioEngine({
      onEnded: (channelId) => {
        void this.handleChannelEnded(channelId);
      },
    });
  }

  start(): void {
    if (this.runtimeUnsubscribe) return;

    this.runtimeUnsubscribe = OBR.broadcast.onMessage(RUNTIME_COMMAND_CHANNEL, (event) => {
      if (!isRuntimeCommand(event.data)) return;
      void this.handle(event.data);
    });

    this.syncUnsubscribe = OBR.broadcast.onMessage(ROOM_SYNC_CHANNEL, (event) => {
      if (!isRoomSyncMessage(event.data)) return;
      void this.handleRoomSync(event.data);
    });

    /**
     * 不能只在 background iframe 启动瞬间调用一次 getRole()。
     *
     * Owlbear 的 iframe 与宿主握手是异步的，真实设备上偶尔会出现首次角色读取失败；
     * 旧实现 catch 后就永远保持 role=null。这样 PLAYER 在浏览器拦截 autoplay 后，
     * 即使点击“启用声音”，UNLOCK 分支也因为 `role === "PLAYER"` 不成立而不会重放
     * pendingRemoteState，于是表面上就像“PLAYER 永远初始化不了”。
     *
     * onChange 是官方 SDK 提供的持续角色来源。即使首次 getRole() 短暂失败，只要宿主
     * 后续发来 Player 状态，我们仍会恢复正确角色并重新执行 PLAYER 的 late-join 握手。
     */
    this.playerUnsubscribe = OBR.player.onChange((player) => {
      void this.applyRole(player.role);
    });

    this.roleReady = this.initializeRole();
  }

  stop(): void {
    this.runtimeUnsubscribe?.();
    this.syncUnsubscribe?.();
    this.playerUnsubscribe?.();
    this.runtimeUnsubscribe = null;
    this.syncUnsubscribe = null;
    this.playerUnsubscribe = null;
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.engine.stopAll();
  }

  /** 只用于自动化回归，生产 UI 不调用。 */
  async debugSetRoleForProbe(role: PlayerRole): Promise<void> {
    await this.applyRole(role);
    this.roleReady = Promise.resolve(role);
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
        playbackMode: this.playbackMode,
        currentCue: this.currentCue ?? undefined,
        nextCue,
        queue: this.plan?.cues ?? [],
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

  private async initializeRole(): Promise<PlayerRole | null> {
    try {
      const role = await OBR.player.getRole();
      await this.applyRole(role);
      return role;
    } catch {
      // 首次 SDK role 暂时不可读时不再“永久放弃”：onChange 与 ensureRole() 都能恢复。
      return null;
    }
  }

  /**
   * 把角色切换的所有副作用集中在这里，避免 getRole / onChange / 自动化探针三套逻辑漂移。
   *
   * 从 GM -> PLAYER 时立即读取 room checkpoint 并主动 STATE_REQUEST；从 PLAYER -> GM 时
   * 开启 heartbeat。相同角色的重复 onChange 不重复做 late-join 请求，减少无意义广播。
   */
  private async applyRole(role: PlayerRole): Promise<void> {
    const previousRole = this.role;
    this.role = role;
    this.configureHeartbeat();

    if (role !== "PLAYER") return;

    if (previousRole !== "PLAYER") {
      await this.hydrateRoomCheckpoint();
      await this.requestRoomState();
    }

    // 如果 PLAYER 之前已经收到 STATE，但当时因为 role=null / autoplay 被拦而积压，
    // 角色恢复以后马上再尝试一次；不必等下一个 5 秒 heartbeat。
    if (this.latestRemoteState && this.engine.isUnlocked) {
      this.pendingRemoteState = this.latestRemoteState;
      await this.drainRemoteStateQueue();
    }
  }

  /**
   * 等待首次 role 初始化；若 Owlbear SDK 在首次握手阶段暂时失败，再补尝试一次。
   * 调用者不需要猜 Background 是否已经“热身完毕”。
   */
  private async ensureRole(): Promise<PlayerRole | null> {
    if (!this.roleReady) this.roleReady = this.initializeRole();
    const first = await this.roleReady;
    if (first) return first;

    this.roleReady = this.initializeRole();
    return this.roleReady;
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
          this.playbackMode = command.plan.playbackMode ?? this.playbackMode;
          this.nextIndex = this.clampPlanIndex(command.plan.startIndex ?? 0);
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
          // ensureRole() 会修复“background 启动时角色读取失败”的场景；即便第二次读取
          // 仍失败，也宁可把已确认来自远端 GM 的最新 STATE 重放，而不是让按钮永久失效。
          await this.ensureRole();
          if (this.role !== "GM" && this.latestRemoteState) {
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

        case "SET_LOOP":
          this.engine.setLoop(command.channelId, command.loop);
          if (command.channelId === this.currentChannelId && this.currentCue) {
            this.currentCue = { ...this.currentCue, loop: command.loop };
            this.revision += 1;
            publish = true;
          }
          break;

        case "SET_PLAYBACK_MODE": {
          this.playbackMode = command.playbackMode;
          if (this.currentChannelId && this.currentCue) {
            const loop = command.playbackMode === "REPEAT_ONE";
            this.engine.setLoop(this.currentChannelId, loop);
            this.currentCue = { ...this.currentCue, loop };
            this.nextIndex = this.resolveFollowingIndex(this.currentIndex);
          }
          this.revision += 1;
          publish = true;
          break;
        }

        case "SET_BUS_GAIN":
          // Bus gain 是本机监听设置；PLAYER 的 Local Master 不应反向影响其他人。
          this.engine.setBusGainDb(command.busId, command.gainDb, command.rampSeconds ?? 0);
          break;
      }

      if (publish) {
        const role = await this.ensureRole();
        if (role === "GM") await this.publishAuthoritativeState(true);
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
    const sourceCue = this.plan.cues[cueIndex];
    if (!sourceCue) throw new Error("播放队列已经结束。");

    // 单曲循环是媒体层的 loop；其他三种模式必须允许 ended 冒泡给 coordinator。
    const nextCue: RuntimePlayCue = {
      ...sourceCue,
      loop: this.playbackMode === "REPEAT_ONE",
    };

    if (!this.engine.isUnlocked) await this.engine.unlock();

    const nextChannelId = `cue:${nextCue.id}`;
    const currentCue = this.currentCue;
    const currentChannelId = this.currentChannelId;
    const fadeSeconds = Math.max(0, nextCue.fadeSeconds ?? 0);

    if (
      currentCue &&
      currentChannelId &&
      currentChannelId !== nextChannelId &&
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
      if (currentCue && currentChannelId) {
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
    this.nextIndex = this.resolveFollowingIndex(cueIndex);
    this.phase = "PLAYING";
    this.revision += 1;
  }

  /**
   * 媒体自然结束后的自动推进。
   *
   * PLAYER 的 plan 永远是 null，所以不会自行“猜下一首”；它只听 GM 的 STATE。
   * GM 则根据真实播放模式决定是否继续，并在切歌后立刻广播新 authoritative state。
   */
  private async handleChannelEnded(channelId: string): Promise<void> {
    if (channelId !== this.currentChannelId || this.phase !== "PLAYING" || !this.plan) return;
    if (this.playbackMode === "REPEAT_ONE" || this.advancingAfterEnd) return;

    this.advancingAfterEnd = true;
    try {
      const atSequentialEnd =
        this.playbackMode === "SEQUENTIAL" && this.nextIndex >= this.plan.cues.length;

      if (atSequentialEnd) {
        this.phase = "STOPPED";
        this.revision += 1;
      } else {
        await this.go();
      }

      const role = await this.ensureRole();
      if (role === "GM") await this.publishAuthoritativeState(true);
    } catch {
      // 自动推进失败不应把 Background 弄死；保留 STOPPED，等待用户手动选曲。
      this.phase = "STOPPED";
      this.revision += 1;
    } finally {
      this.advancingAfterEnd = false;
    }
  }

  /** 把任意 startIndex 收敛到当前计划的合法索引。空计划统一返回 0。 */
  private clampPlanIndex(index: number): number {
    const count = this.plan?.cues.length ?? 0;
    if (count <= 0) return 0;
    return Math.max(0, Math.min(count - 1, Math.trunc(index)));
  }

  /**
   * 计算“下一次手动 Next / 自动 ended”将使用的索引。
   * REPEAT_ONE 的自动重复由 media.loop 完成，因此这里仍指向真正的下一首，确保用户
   * 点击 Next 时不会被困在当前曲目。
   */
  private resolveFollowingIndex(currentIndex: number): number {
    const count = this.plan?.cues.length ?? 0;
    if (count <= 0) return 0;

    if (this.playbackMode === "SHUFFLE") {
      if (count === 1) return 0;
      let next = currentIndex;
      while (next === currentIndex) next = Math.floor(Math.random() * count);
      return next;
    }

    if (this.playbackMode === "REPEAT_ALL" || this.playbackMode === "REPEAT_ONE") {
      return (Math.max(0, currentIndex) + 1) % count;
    }

    // SEQUENTIAL 故意允许返回 count，用这个哨兵表示“队列自然结束”。
    return Math.max(0, currentIndex) + 1;
  }

  private async handleRoomSync(message: RoomSyncMessage): Promise<void> {
    if (message.type === "STATE_REQUEST") {
      // STATE_REQUEST 很可能恰好发生在 background 刚启动时；旧实现 role=null 会直接丢掉
      // 这次请求，PLAYER 只能赌 heartbeat。现在请求到来时主动完成一次角色解析。
      const role = await this.ensureRole();
      if (role === "GM") await this.publishAuthoritativeState();
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
        try {
          await this.applyRemoteState(state);
        } catch (error) {
          if (error instanceof DOMException && error.name === "NotAllowedError") {
            // autoplay-first：只有浏览器明确拒绝时，才保留最新状态等待一次用户手势重试。
            this.pendingRemoteState = this.latestRemoteState ?? state;
            break;
          }
          throw error;
        }
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
    this.playbackMode = state.cue?.loop ? "REPEAT_ONE" : "SEQUENTIAL";
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
