/**
 * Owlbear Audio 的领域模型。
 *
 * 这里刻意不依赖 React、Owlbear SDK 或 Web Audio API：
 * UI、同步层和播放引擎都只依赖这些纯数据结构，避免以后把某个 iframe
 * 的生命周期误当成“节目状态”的生命周期。
 */

export type AssetId = string;
export type ClipId = string;
export type CueId = string;
export type SceneId = string;
export type ShowId = string;

export type BusId = "MASTER" | "MUSIC" | "AMBIENCE" | "SFX" | "VOICE";

export type AssetSourceType = "owlbear-asset" | "local-import";

export interface OwlbearAssetLocator {
  /** Owlbear downloadImages() 当前解析出的媒体 URL。 */
  url: string;
  mime: "video/webm" | string;
  width: number;
  height: number;

  /**
   * 当前 SDK 没有公开稳定的“asset id -> URL”重新解析 API，因此暂时把 URL
   * 当 locator 的一部分保存。后续若找到更可靠的公开引用方式，再在 schema
   * migration 中扩展，而不是让播放引擎直接认识 Owlbear 内部数据库 id。
   */
  resolvedAt: number;
}

export interface AudioAsset {
  id: AssetId;
  displayName: string;
  sourceType: AssetSourceType;
  originalFileName?: string;

  /** 内容 hash 用于去重和恢复本地索引。 */
  contentHash?: string;

  durationSeconds: number;
  container: "webm" | string;
  audioCodec: "opus" | string;
  audioBitrateKbps?: number;
  sampleRateHz?: number;
  channels?: number;

  /** 生产 envelope 当前固定只有一个 64x64 VP9 封面帧。 */
  envelopeVersion?: number;

  owlbear?: OwlbearAssetLocator;
  tags: string[];

  /** LUFS 等分析信息可以导入后异步补齐。 */
  integratedLufs?: number;
  truePeakDbtp?: number;
  waveformCacheKey?: string;

  importedAt: number;
}

export interface ClipMarker {
  id: string;
  timeSeconds: number;
  label: string;
  kind?: "HOT_CUE" | "INTRO" | "LOOP_IN" | "LOOP_OUT" | "CLIMAX" | "OUTRO" | "CUSTOM";
}

export interface LoopRegion {
  startSeconds: number;
  endSeconds: number;

  /**
   * Devamp=true 表示 loop 可以持续无限次，但收到 EXIT_LOOP 后在合法边界退出。
   */
  devamp?: boolean;
}

export interface AudioClip {
  id: ClipId;
  assetId: AssetId;
  name: string;

  inSeconds: number;
  outSeconds?: number;
  gainDb: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;

  loop?: LoopRegion;
  markers: ClipMarker[];

  bpm?: number;
  beatOffsetSeconds?: number;
}

export type CueType =
  | "PLAY"
  | "STOP"
  | "PAUSE"
  | "RESUME"
  | "FADE"
  | "WAIT"
  | "LOAD"
  | "DEVAMP"
  | "SET_PARAM"
  | "START_SCENE"
  | "RANDOM_CHOICE"
  | "GROUP";

interface CueBase {
  id: CueId;
  name: string;
  type: CueType;

  /** 启动后立刻启动下一 Cue。 */
  autoContinue?: boolean;

  /** 当前 Cue 自然完成后启动下一 Cue。 */
  autoFollow?: boolean;
}

export interface PlayCue extends CueBase {
  type: "PLAY";
  clipId: ClipId;
  busId: Exclude<BusId, "MASTER">;
  fadeInSeconds?: number;
}

export interface StopCue extends CueBase {
  type: "STOP";
  busId?: BusId;
  fadeOutSeconds?: number;
}

export interface PauseCue extends CueBase {
  type: "PAUSE";
  busId?: BusId;
}

export interface ResumeCue extends CueBase {
  type: "RESUME";
  busId?: BusId;
}

export interface FadeCue extends CueBase {
  type: "FADE";
  busId: BusId;
  targetGainDb: number;
  durationSeconds: number;
}

export interface WaitCue extends CueBase {
  type: "WAIT";
  durationSeconds: number;
}

export interface LoadCue extends CueBase {
  type: "LOAD";
  clipIds: ClipId[];
}

export interface DevampCue extends CueBase {
  type: "DEVAMP";
  busId?: Exclude<BusId, "MASTER">;
}

export interface SetParamCue extends CueBase {
  type: "SET_PARAM";
  busId: BusId;
  parameter: "GAIN_DB" | "MUTE";
  value: number | boolean;
}

export interface StartSceneCue extends CueBase {
  type: "START_SCENE";
  sceneId: SceneId;
}

export interface RandomChoiceCue extends CueBase {
  type: "RANDOM_CHOICE";
  choices: Array<{ cueId: CueId; weight: number }>;
}

export interface GroupCue extends CueBase {
  type: "GROUP";
  cueIds: CueId[];
  mode: "PARALLEL" | "SEQUENTIAL";
}

export type Cue =
  | PlayCue
  | StopCue
  | PauseCue
  | ResumeCue
  | FadeCue
  | WaitCue
  | LoadCue
  | DevampCue
  | SetParamCue
  | StartSceneCue
  | RandomChoiceCue
  | GroupCue;

export interface BusDefinition {
  id: BusId;
  name: string;
  gainDb: number;
  muted: boolean;
}

export interface SceneLayerState {
  busId: Exclude<BusId, "MASTER">;
  clipId?: ClipId;
  gainDb?: number;
  keepCurrent?: boolean;
}

export interface AudioScene {
  id: SceneId;
  name: string;
  layers: SceneLayerState[];
  transitionSeconds: number;
  transitionCurve: "EQUAL_POWER" | "LINEAR";
}

export interface CueStack {
  id: ShowId;
  name: string;
  cueIds: CueId[];
}

export interface PadBank {
  id: string;
  name: string;
  cueIds: CueId[];
}

export type TransportPhase = "IDLE" | "LOADING" | "PLAYING" | "PAUSED" | "ERROR";

/**
 * 这是可以跨 UI surface / broadcast 复制的“小状态”，不能塞 AudioNode、DOM 元素或大对象。
 */
export interface TransportState {
  revision: number;
  phase: TransportPhase;
  showId?: ShowId;
  currentCueId?: CueId;
  armedCueId?: CueId;
  sceneId?: SceneId;

  /** GM 发出 authoritative PLAY 时的墙钟时间戳。 */
  startedAtEpochMs?: number;
  positionSeconds?: number;

  error?: string;
}
