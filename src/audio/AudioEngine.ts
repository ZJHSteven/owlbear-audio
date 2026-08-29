import type { BusId } from "../core/types";

/**
 * 将 dB 转为 Web Audio GainNode 使用的线性增益。
 * -Infinity / 极低值直接钳为 0，避免浮点下溢。
 */
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
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  gainDb: number;
}

const DEFAULT_BUS_GAIN_DB: Record<BusId, number> = {
  MASTER: 0,
  MUSIC: 0,
  AMBIENCE: 0,
  SFX: 0,
  VOICE: 0,
};

/**
 * 浏览器本地唯一的播放 runtime。
 *
 * 设计约束：
 * - 不依赖 React；UI 重渲染不能销毁 transport。
 * - AudioContext 只在显式 unlock() 后创建/恢复，便于正确处理 autoplay policy。
 * - 长音乐使用 HTMLMediaElement 流式读取，避免把几十 MB 音频全部 decode 成 AudioBuffer。
 * - HTMLMediaElement 通过 MediaElementAudioSourceNode 接进 Web Audio bus graph，后续可以
 *   在不改播放器 API 的情况下加入 EQ、ducking、compressor、spatial node 等处理。
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private readonly busGains = new Map<BusId, GainNode>();
  private readonly busGainDb = new Map<BusId, number>(
    Object.entries(DEFAULT_BUS_GAIN_DB) as Array<[BusId, number]>,
  );
  private readonly channels = new Map<string, ChannelRuntime>();

  /**
   * 必须从真实用户 gesture（例如 Action 的 Enable Audio / Play 按钮）调用。
   * Chromium 允许创建 suspended AudioContext，但真正 resume / media.play 的首次授权
   * 仍受 user activation 控制，因此我们把“解锁”做成明确的产品状态，而不是偷偷重试。
   */
  async unlock(): Promise<void> {
    this.ensureGraph();

    if (!this.context) {
      throw new Error("AudioContext graph was not created");
    }

    if (this.context.state !== "running") {
      await this.context.resume();
    }

    // 通过极短的静音 oscillator 强制触发一次真实 Web Audio render quantum。
    // 它不会产生可听声音，但能让诊断界面明确知道 context 已经进入 running。
    const oscillator = this.context.createOscillator();
    const silent = this.context.createGain();
    silent.gain.value = 0;
    oscillator.connect(silent).connect(this.context.destination);
    oscillator.start();
    oscillator.stop(this.context.currentTime + 0.01);
  }

  get isUnlocked(): boolean {
    return this.context?.state === "running";
  }

  get contextState(): AudioContextState | "UNINITIALIZED" {
    return this.context?.state ?? "UNINITIALIZED";
  }

  /**
   * 预加载媒体 metadata / 浏览器缓冲，但不开始播放。
   * 返回 duration，方便 Cue/Clip 层校验 in/out 和 loop 边界。
   */
  async preload(
    channelId: string,
    url: string,
    options: PlaybackChannelOptions,
  ): Promise<number> {
    const channel = this.getOrCreateChannel(channelId, url, options);

    if (channel.media.readyState >= HTMLMediaElement.HAVE_METADATA) {
      return channel.media.duration;
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

    return channel.media.duration;
  }

  /**
   * 从指定位置播放一个 channel。
   * 第一次调用如果浏览器尚未得到用户授权，会保留原始 NotAllowedError 给上层，
   * UI 应提示用户点击 Enable Audio，而不是把它吞掉后假装“网络失败”。
   */
  async play(
    channelId: string,
    url: string,
    options: PlaybackChannelOptions,
  ): Promise<void> {
    const channel = this.getOrCreateChannel(channelId, url, options);

    if (options.startSeconds !== undefined) {
      channel.media.currentTime = Math.max(0, options.startSeconds);
    }
    channel.media.loop = options.loop ?? false;

    await channel.media.play();
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
      // 某些尚未拿到 metadata 的媒体不允许 seek；pause 已经足够完成 stop 语义。
    }
  }

  stopAll(): void {
    for (const channel of this.channels.values()) {
      channel.media.pause();
      try {
        channel.media.currentTime = 0;
      } catch {
        // 同 stop()。
      }
    }
  }

  seek(channelId: string, seconds: number): void {
    const channel = this.requireChannel(channelId);
    channel.media.currentTime = Math.max(0, seconds);
  }

  setChannelGainDb(channelId: string, gainDb: number, rampSeconds = 0): void {
    const channel = this.requireChannel(channelId);
    channel.gainDb = gainDb;
    this.rampGain(channel.gain.gain, dbToGain(gainDb), rampSeconds);
  }

  setBusGainDb(busId: BusId, gainDb: number, rampSeconds = 0): void {
    this.ensureGraph();
    const node = this.busGains.get(busId);
    if (!node) throw new Error(`Unknown bus: ${busId}`);

    this.busGainDb.set(busId, gainDb);
    this.rampGain(node.gain, dbToGain(gainDb), rampSeconds);
  }

  getBusGainDb(busId: BusId): number {
    return this.busGainDb.get(busId) ?? 0;
  }

  /**
   * 两个 channel 做 equal-power crossfade。
   *
   * 线性交叉淡化在中点会产生明显能量下陷；cos/sin 曲线更适合音乐转场。
   * 这里对 channel gain 做曲线，Bus 仍保留独立 master gain。
   */
  crossfade(fromChannelId: string, toChannelId: string, durationSeconds: number): void {
    this.ensureGraph();
    if (!this.context) throw new Error("AudioContext is not initialized");

    const from = this.requireChannel(fromChannelId);
    const to = this.requireChannel(toChannelId);
    const duration = Math.max(0.01, durationSeconds);
    const sampleCount = Math.max(32, Math.ceil(duration * 60));
    const fadeOut = new Float32Array(sampleCount);
    const fadeIn = new Float32Array(sampleCount);

    for (let i = 0; i < sampleCount; i += 1) {
      const x = i / (sampleCount - 1);
      fadeOut[i] = Math.cos((x * Math.PI) / 2);
      fadeIn[i] = Math.sin((x * Math.PI) / 2);
    }

    const now = this.context.currentTime;
    from.gain.gain.cancelScheduledValues(now);
    to.gain.gain.cancelScheduledValues(now);
    from.gain.gain.setValueAtTime(from.gain.gain.value, now);
    to.gain.gain.setValueAtTime(0, now);
    from.gain.gain.setValueCurveAtTime(fadeOut, now, duration);
    to.gain.gain.setValueCurveAtTime(fadeIn, now, duration);

    from.gainDb = -96;
    to.gainDb = 0;
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
    channel.media.removeAttribute("src");
    channel.media.load();
    channel.source.disconnect();
    channel.gain.disconnect();
    this.channels.delete(channelId);
  }

  async close(): Promise<void> {
    this.stopAll();
    for (const channelId of [...this.channels.keys()]) {
      this.destroyChannel(channelId);
    }

    if (this.context && this.context.state !== "closed") {
      await this.context.close();
    }

    this.context = null;
    this.masterGain = null;
    this.busGains.clear();
  }

  private ensureGraph(): void {
    if (this.context && this.masterGain) return;

    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) {
      throw new Error("Web Audio API is not available in this browser");
    }

    this.context = new AudioContextConstructor({ latencyHint: "interactive" });
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = dbToGain(this.busGainDb.get("MASTER") ?? 0);
    this.masterGain.connect(this.context.destination);
    this.busGains.set("MASTER", this.masterGain);

    for (const busId of ["MUSIC", "AMBIENCE", "SFX", "VOICE"] as const) {
      const gain = this.context.createGain();
      gain.gain.value = dbToGain(this.busGainDb.get(busId) ?? 0);
      gain.connect(this.masterGain);
      this.busGains.set(busId, gain);
    }
  }

  private getOrCreateChannel(
    channelId: string,
    url: string,
    options: PlaybackChannelOptions,
  ): ChannelRuntime {
    this.ensureGraph();
    if (!this.context) throw new Error("AudioContext is not initialized");

    const existing = this.channels.get(channelId);
    if (existing) {
      if (existing.url !== url || existing.busId !== options.busId) {
        this.destroyChannel(channelId);
      } else {
        if (options.gainDb !== undefined && options.gainDb !== existing.gainDb) {
          this.setChannelGainDb(channelId, options.gainDb);
        }
        return existing;
      }
    }

    const bus = this.busGains.get(options.busId);
    if (!bus) throw new Error(`Bus graph not initialized: ${options.busId}`);

    const media = new Audio();
    media.crossOrigin = "anonymous";
    media.preload = "auto";
    media.src = url;

    const source = this.context.createMediaElementSource(media);
    const gain = this.context.createGain();
    const gainDb = options.gainDb ?? 0;
    gain.gain.value = dbToGain(gainDb);
    source.connect(gain).connect(bus);

    const channel: ChannelRuntime = {
      id: channelId,
      busId: options.busId,
      url,
      media,
      source,
      gain,
      gainDb,
    };

    this.channels.set(channelId, channel);
    return channel;
  }

  private requireChannel(channelId: string): ChannelRuntime {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error(`Unknown audio channel: ${channelId}`);
    return channel;
  }

  private rampGain(param: AudioParam, target: number, durationSeconds: number): void {
    this.ensureGraph();
    if (!this.context) throw new Error("AudioContext is not initialized");

    const now = this.context.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);

    if (durationSeconds <= 0) {
      param.setValueAtTime(target, now);
      return;
    }

    param.linearRampToValueAtTime(target, now + durationSeconds);
  }

  private mediaError(media: HTMLMediaElement, phase: string): Error {
    const code = media.error?.code;
    const message = media.error?.message || "unknown media error";
    return new Error(`${phase} failed (MediaError ${code ?? "?"}): ${message}`);
  }
}

/**
 * Action / background / Studio 不应该各 new 一个引擎。
 * 在同一个 document 中统一通过这个单例取 runtime；跨 iframe 则由 coordinator 消息桥控制唯一 owner。
 */
export const audioEngine = new AudioEngine();
