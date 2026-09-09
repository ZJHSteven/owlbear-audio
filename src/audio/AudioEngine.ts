import type { BusId } from "../core/types";

export function dbToGain(db: number): number {
  if (!Number.isFinite(db) || db <= -96) return 0;
  return 10 ** (db / 20);
}

export interface PlaybackChannelOptions {
  busId: Exclude<BusId, "MASTER">;
  gainDb?: number;
  startSeconds?: number;
  loop?: boolean;
}

export interface ChannelSnapshot {
  id: string;
  busId: Exclude<BusId, "MASTER">;
  url: string;
  paused: boolean;
  currentTime: number;
  duration: number;
  readyState: number;
  gainDb: number;
}

interface ChannelRuntime {
  id: string;
  busId: Exclude<BusId, "MASTER">;
  url: string;
  media: HTMLAudioElement;
  /** destroyChannel 时需要解绑，避免旧媒体对象结束后误触发下一首。 */
  onEnded: () => void;
  gainDb: number;
  fadeScale: number;
}

export interface AudioEngineHandlers {
  /**
   * 媒体自然播放到结尾时触发。loop=true 时浏览器不会产生 ended，因此单曲循环
   * 完全由原生媒体元素处理；列表推进只会收到真正需要“下一首”的结束事件。
   */
  onEnded?: (channelId: string) => void;
}

const DEFAULT_BUS_GAIN_DB: Record<BusId, number> = {
  MASTER: 0,
  MUSIC: 0,
  AMBIENCE: 0,
  SFX: 0,
  VOICE: 0,
};

/**
 * v0.1 的稳定播放 runtime。
 *
 * 只使用原生 HTMLAudioElement，不创建 AudioContext：
 * - 避免移动端隐藏 iframe 的 AudioContext.resume() 永久 suspended；
 * - 长音乐仍然走浏览器流式媒体管线；
 * - Action 关闭后 Background iframe 仍持有 media element，因此音乐继续；
 * - 未来需要 EQ/ducking/FX 时再引入单独的高级 Web Audio runtime。
 */
export class AudioEngine {
  private readonly busGainDb = new Map<BusId, number>(
    Object.entries(DEFAULT_BUS_GAIN_DB) as Array<[BusId, number]>,
  );
  private readonly channels = new Map<string, ChannelRuntime>();
  private playbackPermission: "UNKNOWN" | "ALLOWED" | "BLOCKED" = "UNKNOWN";
  private readonly handlers: AudioEngineHandlers;

  constructor(handlers: AudioEngineHandlers = {}) {
    this.handlers = handlers;
  }

  /**
   * 保留兼容 RPC，但 v0.1 不再有需要等待的 AudioContext 解锁动作。
   * 真正的 autoplay 是否允许由 media.play() 的 Promise 决定。
   */
  async unlock(): Promise<void> {
    this.playbackPermission = "UNKNOWN";
  }

  get isUnlocked(): boolean {
    return this.playbackPermission !== "BLOCKED";
  }

  get contextState(): AudioContextState | "UNINITIALIZED" {
    return this.playbackPermission === "BLOCKED" ? "suspended" : "running";
  }

  async preload(
    channelId: string,
    url: string,
    options: PlaybackChannelOptions,
  ): Promise<number> {
    const channel = this.getOrCreateChannel(channelId, url, options);
    if (channel.media.readyState >= HTMLMediaElement.HAVE_METADATA) {
      return Number.isFinite(channel.media.duration) ? channel.media.duration : 0;
    }

    channel.media.preload = "auto";
    channel.media.load();

    await new Promise<void>((resolve, reject) => {
      const onMetadata = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(this.mediaError(channel.media, "preload"));
      };
      const cleanup = () => {
        channel.media.removeEventListener("loadedmetadata", onMetadata);
        channel.media.removeEventListener("error", onError);
      };
      channel.media.addEventListener("loadedmetadata", onMetadata, { once: true });
      channel.media.addEventListener("error", onError, { once: true });
    });

    return Number.isFinite(channel.media.duration) ? channel.media.duration : 0;
  }

  async play(
    channelId: string,
    url: string,
    options: PlaybackChannelOptions,
  ): Promise<void> {
    const channel = this.getOrCreateChannel(channelId, url, options);
    channel.media.loop = options.loop ?? false;
    if (options.startSeconds !== undefined) {
      channel.media.currentTime = Math.max(0, options.startSeconds);
    }
    this.applyChannelVolume(channel);
    try {
      await channel.media.play();
      this.playbackPermission = "ALLOWED";
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        this.playbackPermission = "BLOCKED";
      }
      throw error;
    }
  }

  pause(channelId: string): void {
    this.channels.get(channelId)?.media.pause();
  }

  stop(channelId: string): void {
    const channel = this.channels.get(channelId);
    if (!channel) return;
    channel.media.pause();
    try {
      channel.media.currentTime = 0;
    } catch {
      // metadata 尚未可用时 pause 已足够完成 stop 语义。
    }
  }

  stopAll(): void {
    for (const channel of this.channels.values()) this.stop(channel.id);
  }

  seek(channelId: string, seconds: number): void {
    this.requireChannel(channelId).media.currentTime = Math.max(0, seconds);
  }

  /**
   * 只修改已有播放通道的整轨循环状态，不重新 load / play 媒体。
   *
   * 这样 GM 在 Action 里切换“循环”时不会产生一次可听见的重启，也不会改变
   * currentTime。PLAYER 端随后会从 authoritative state 收到同一个 loop 状态。
   */
  setLoop(channelId: string, loop: boolean): void {
    this.requireChannel(channelId).media.loop = loop;
  }

  setChannelGainDb(channelId: string, gainDb: number, rampSeconds = 0): void {
    const channel = this.requireChannel(channelId);
    if (rampSeconds <= 0) {
      channel.gainDb = gainDb;
      this.applyChannelVolume(channel);
      return;
    }
    const start = channel.gainDb;
    this.animate(rampSeconds, (progress) => {
      channel.gainDb = start + (gainDb - start) * progress;
      this.applyChannelVolume(channel);
    });
  }

  setBusGainDb(busId: BusId, gainDb: number, rampSeconds = 0): void {
    const previous = this.getBusGainDb(busId);
    if (rampSeconds <= 0) {
      this.busGainDb.set(busId, gainDb);
      this.refreshVolumes();
      return;
    }
    this.animate(rampSeconds, (progress) => {
      this.busGainDb.set(busId, previous + (gainDb - previous) * progress);
      this.refreshVolumes();
    });
  }

  getBusGainDb(busId: BusId): number {
    return this.busGainDb.get(busId) ?? 0;
  }

  /** 轻量 equal-power crossfade；使用 timer，隐藏 Background 时也不会依赖 RAF。 */
  crossfade(fromChannelId: string, toChannelId: string, durationSeconds: number): void {
    const from = this.requireChannel(fromChannelId);
    const to = this.requireChannel(toChannelId);
    to.gainDb = 0;
    from.fadeScale = 1;
    to.fadeScale = 0;
    this.applyChannelVolume(from);
    this.applyChannelVolume(to);

    this.animate(Math.max(0.01, durationSeconds), (progress) => {
      from.fadeScale = Math.cos((progress * Math.PI) / 2);
      to.fadeScale = Math.sin((progress * Math.PI) / 2);
      this.applyChannelVolume(from);
      this.applyChannelVolume(to);
      if (progress >= 1) {
        from.gainDb = -96;
        to.gainDb = 0;
      }
    });
  }

  snapshot(): ChannelSnapshot[] {
    return [...this.channels.values()].map((channel) => ({
      id: channel.id,
      busId: channel.busId,
      url: channel.url,
      paused: channel.media.paused,
      currentTime: channel.media.currentTime,
      duration: Number.isFinite(channel.media.duration) ? channel.media.duration : 0,
      readyState: channel.media.readyState,
      gainDb: channel.gainDb,
    }));
  }

  destroyChannel(channelId: string): void {
    const channel = this.channels.get(channelId);
    if (!channel) return;
    channel.media.pause();
    channel.media.removeEventListener("ended", channel.onEnded);
    channel.media.removeAttribute("src");
    channel.media.load();
    this.channels.delete(channelId);
  }

  async close(): Promise<void> {
    this.stopAll();
    for (const channelId of [...this.channels.keys()]) this.destroyChannel(channelId);
  }

  private getOrCreateChannel(
    channelId: string,
    url: string,
    options: PlaybackChannelOptions,
  ): ChannelRuntime {
    const existing = this.channels.get(channelId);
    if (existing) {
      if (existing.url !== url || existing.busId !== options.busId) {
        this.destroyChannel(channelId);
      } else {
        if (options.gainDb !== undefined) existing.gainDb = options.gainDb;
        existing.media.loop = options.loop ?? existing.media.loop;
        this.applyChannelVolume(existing);
        return existing;
      }
    }

    const media = new Audio();
    media.crossOrigin = "anonymous";
    media.preload = "auto";
    media.src = url;
    media.loop = options.loop ?? false;
    media.setAttribute("playsinline", "");

    const onEnded = () => {
      this.handlers.onEnded?.(channelId);
    };
    media.addEventListener("ended", onEnded);

    const channel: ChannelRuntime = {
      id: channelId,
      busId: options.busId,
      url,
      media,
      onEnded,
      gainDb: options.gainDb ?? 0,
      fadeScale: 1,
    };
    this.channels.set(channelId, channel);
    this.applyChannelVolume(channel);
    return channel;
  }

  private requireChannel(channelId: string): ChannelRuntime {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error(`Unknown audio channel: ${channelId}`);
    return channel;
  }

  private applyChannelVolume(channel: ChannelRuntime): void {
    const totalDb =
      channel.gainDb +
      this.getBusGainDb(channel.busId) +
      this.getBusGainDb("MASTER");
    const linear = dbToGain(totalDb) * channel.fadeScale;
    channel.media.volume = Math.max(0, Math.min(1, linear));
  }

  private refreshVolumes(): void {
    for (const channel of this.channels.values()) this.applyChannelVolume(channel);
  }

  private animate(durationSeconds: number, update: (progress: number) => void): void {
    const durationMs = Math.max(1, durationSeconds * 1000);
    const startedAt = performance.now();
    update(0);
    const timer = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
      update(progress);
      if (progress >= 1) window.clearInterval(timer);
    }, 32);
  }

  private mediaError(media: HTMLMediaElement, phase: string): Error {
    const code = media.error?.code;
    const message = media.error?.message || "unknown media error";
    return new Error(`${phase} failed (MediaError ${code ?? "?"}): ${message}`);
  }
}

export const audioEngine = new AudioEngine();
