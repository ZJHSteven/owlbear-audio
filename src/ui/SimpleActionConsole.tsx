import { useEffect, useMemo, useRef, useState } from "react";
import OBR, { buildImageUpload } from "@owlbear-rodeo/sdk";
import WaBadge from "@awesome.me/webawesome/dist/react/badge/index.js";
import WaButton from "@awesome.me/webawesome/dist/react/button/index.js";
import WaButtonGroup from "@awesome.me/webawesome/dist/react/button-group/index.js";
import WaCallout from "@awesome.me/webawesome/dist/react/callout/index.js";
import WaCard from "@awesome.me/webawesome/dist/react/card/index.js";
import WaInput from "@awesome.me/webawesome/dist/react/input/index.js";
import WaOption from "@awesome.me/webawesome/dist/react/option/index.js";
import WaProgressBar from "@awesome.me/webawesome/dist/react/progress-bar/index.js";
import WaSelect from "@awesome.me/webawesome/dist/react/select/index.js";
import WaSlider from "@awesome.me/webawesome/dist/react/slider/index.js";
import WaTab from "@awesome.me/webawesome/dist/react/tab/index.js";
import WaTabGroup from "@awesome.me/webawesome/dist/react/tab-group/index.js";
import WaTabPanel from "@awesome.me/webawesome/dist/react/tab-panel/index.js";
import WaSwitch from "@awesome.me/webawesome/dist/react/switch/index.js";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Library,
  Loader2,
  Music2,
  Pause,
  Play,
  Plus,
  Search,
  Square,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import { BackgroundClient } from "@/runtime/BackgroundClient";
import type { RuntimeSnapshot } from "@/runtime/protocol";
import type { ImportPresetId } from "@/import/transcode";
import {
  loadPendingImports,
  loadSimpleLibrary,
  mergeSimpleLibrary,
  savePendingImports,
  saveSimpleLibrary,
  type PendingImport,
  type SimpleLibraryTrack,
  type TrackCategory,
} from "@/library/simpleLibrary";

const client = new BackgroundClient();

const CATEGORY_LABELS: Record<TrackCategory, string> = {
  MUSIC: "音乐",
  AMBIENCE: "氛围",
  SFX: "音效",
};

const PRESET_LABELS: Record<ImportPresetId, string> = {
  SPEECH: "语音 · 48 kbps",
  AMBIENCE: "氛围 · 64 kbps",
  MUSIC: "音乐 · 96 kbps",
  ARCHIVE: "高质量 · 128 kbps",
};

/**
 * Owlbear SDK 在某些宿主错误路径会 reject 一个普通对象而不是 Error。
 * 旧版 `String(error)` 会直接变成 `[object Object]`，因此用户看不到真正原因。
 * 这里优先提取常见 message/error 字段，最后才做安全 JSON 序列化。
 */
function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    for (const key of ["message", "error", "reason", "detail"]) {
      if (typeof candidate[key] === "string" && candidate[key]) return candidate[key];
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "Owlbear 返回了无法解析的错误对象";
    }
  }
  return String(error);
}

function fileDisplayName(file: File): string {
  return file.name.replace(/\.[^.]+$/, "").trim() || "未命名音频";
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const whole = Math.floor(value);
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function matchesQuery(track: SimpleLibraryTrack, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || track.name.toLocaleLowerCase().includes(needle);
}

export function SimpleActionConsole({ ready }: { ready: boolean }) {
  const [tracks, setTracks] = useState<SimpleLibraryTrack[]>(() => loadSimpleLibrary());
  const [pendingImports, setPendingImports] = useState<PendingImport[]>(() => loadPendingImports());
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState("可以从电脑导入，或从 Owlbear Audio Collection 加入已有音频。");
  const [masterDb, setMasterDb] = useState(0);
  const [importCategory, setImportCategory] = useState<TrackCategory>("MUSIC");
  const [preset, setPreset] = useState<ImportPresetId>("MUSIC");
  const [defaultLoop, setDefaultLoop] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentCue = snapshot?.transport.phase === "PLAYING" || snapshot?.transport.phase === "PAUSED"
    ? snapshot.transport.currentCue
    : undefined;
  const currentChannel = useMemo(
    () => currentCue ? snapshot?.channels.find((channel) => channel.id === `cue:${currentCue.id}`) ?? null : null,
    [currentCue, snapshot?.channels],
  );
  const currentTrack = useMemo(
    () => currentCue ? tracks.find((track) => track.url === currentCue.url || track.id === currentCue.id) ?? null : null,
    [currentCue, tracks],
  );
  const loopEnabled = currentCue?.loop ?? defaultLoop;
  const searchedTracks = useMemo(() => tracks.filter((track) => matchesQuery(track, query)), [query, tracks]);

  function persistTracks(next: SimpleLibraryTrack[]) {
    setTracks(next);
    saveSimpleLibrary(next);
  }

  function persistPending(next: PendingImport[]) {
    setPendingImports(next);
    savePendingImports(next);
  }

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await client.snapshot();
        if (cancelled) return;
        setSnapshot(response.snapshot);
        setMasterDb(response.snapshot.busGainsDb.MASTER);
      } catch {
        // Background iframe 和 Action 是并行挂载的；短暂握手失败交给下一轮恢复。
      }
    };
    void refresh();
    // 400 ms 只查询同一浏览器里的 Background snapshot，用于让进度条看起来连续；
    // 真正的跨玩家网络同步仍由 coordinator 的即时广播 + 低频 heartbeat 负责。
    const timer = window.setInterval(() => void refresh(), 400);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ready]);

  async function importFiles(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true);
    setProgress(0);
    try {
      const { transcodeToProductionWebm } = await import("@/import/transcode");
      const uploads = [];
      const staged: PendingImport[] = [];

      for (let index = 0; index < files.length; index += 1) {
        const source = files[index];
        const name = fileDisplayName(source);
        setStatus(`正在转换 ${index + 1}/${files.length}：${name}`);
        const result = await transcodeToProductionWebm(source, {
          preset,
          onProgress: (value) => setProgress((index + value) / files.length),
        });

        uploads.push(
          buildImageUpload(result.file)
            .name(name)
            .description(`Owlbear Audio · ${CATEGORY_LABELS[importCategory]} · ${result.bitrateKbps} kbps`)
            .build(),
        );
        staged.push({
          name,
          category: importCategory,
          preset: result.preset,
          durationSeconds: result.durationSeconds,
          bitrateKbps: result.bitrateKbps,
          createdAt: Date.now(),
        });
      }

      persistPending([...pendingImports, ...staged]);
      setStatus("转换完成。请在 Owlbear 保存窗口中选择专用的 “Owlbear Audio” Collection；保存完成后回来点“完成导入”。");
      // 官方 SDK 只负责打开宿主保存流程，并不会返回新资产 URL；因此不能在这里
      // 紧接着自动 downloadImages()，否则会和宿主保存器产生 modal 时序冲突。
      await OBR.assets.uploadImages(uploads, "ATTACHMENT");
    } catch (error) {
      setStatus(`导入失败：${errorText(error)}`);
    } finally {
      setBusy(false);
      setProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function selectFromOwlbear(linkPending = false) {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const search = linkPending ? pendingImports[0]?.name ?? "" : "";
      const multiple = !linkPending || pendingImports.length > 1;
      const selected = await OBR.assets.downloadImages(multiple, search, "ATTACHMENT");
      const supported = selected.filter((asset) => asset.image.mime === "video/webm");

      // 同名素材允许存在，因此不能用一个 Map 覆盖；每选回一个同名资产就消耗一条
      // pending metadata。这样批量导入两个相同文件名也不会丢分类/质量信息。
      const remainingPending = [...pendingImports];
      const added: SimpleLibraryTrack[] = supported.map((asset) => {
        const matchedIndex = linkPending
          ? remainingPending.findIndex((item) => item.name === asset.name)
          : -1;
        const matched = matchedIndex >= 0 ? remainingPending.splice(matchedIndex, 1)[0] : undefined;
        return {
          id: crypto.randomUUID(),
          name: asset.name,
          url: asset.image.url,
          mime: asset.image.mime,
          ...(matched?.durationSeconds ? { durationSeconds: matched.durationSeconds } : {}),
          category: matched?.category ?? importCategory,
          ...(matched?.preset ? { preset: matched.preset } : {}),
          ...(matched?.bitrateKbps ? { bitrateKbps: matched.bitrateKbps } : {}),
          addedAt: Date.now(),
        };
      });

      persistTracks(mergeSimpleLibrary(tracks, added));
      if (linkPending) persistPending(remainingPending);

      if (!selected.length) {
        setStatus("没有选择任何 Owlbear 资产。");
      } else if (!added.length) {
        setStatus("所选资产不是 Owlbear Audio 可播放的 WebM；请从专用 Collection 选择已导入音频。");
      } else {
        const suffix = selected.length !== supported.length ? `；另有 ${selected.length - supported.length} 个非 WebM 被忽略` : "";
        setStatus(`已加入 ${added.length} 个音频${suffix}。`);
      }
    } catch (error) {
      setStatus(`读取 Owlbear 音频失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function playTrack(track: SimpleLibraryTrack, loop = defaultLoop) {
    if (!ready || busy) return;
    setBusy(true);
    setStatus(`正在播放：${track.name}`);
    try {
      await client.unlock();
      await client.loadPlan({
        id: "owlbear-audio-simple-player",
        name: "Owlbear Audio",
        cues: [
          {
            id: track.id,
            name: track.name,
            type: "PLAY",
            url: track.url,
            busId: "MUSIC",
            loop,
            fadeSeconds: currentCue ? 1.2 : 0,
          },
        ],
      });
      const response = await client.go();
      setSnapshot(response.snapshot);
      if (!response.ok) throw new Error(response.error ?? "播放失败");
      setDefaultLoop(loop);
    } catch (error) {
      setStatus(`播放失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function togglePause() {
    if (!currentCue || !currentChannel) return;
    setBusy(true);
    try {
      const response = currentChannel.paused
        ? await client.play({
            channelId: `cue:${currentCue.id}`,
            url: currentCue.url,
            busId: currentCue.busId,
            gainDb: currentCue.gainDb,
            loop: currentCue.loop,
          })
        : await client.pause(`cue:${currentCue.id}`);
      setSnapshot(response.snapshot);
      if (!response.ok) throw new Error(response.error ?? "播放控制失败");
    } catch (error) {
      setStatus(`控制播放失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function stopPlayback() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await client.stopAll();
      setSnapshot(response.snapshot);
      setStatus("已停止播放。");
    } catch (error) {
      setStatus(`停止失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function seek(seconds: number) {
    if (!currentCue || !currentChannel) return;
    try {
      const response = await client.seek(`cue:${currentCue.id}`, seconds);
      setSnapshot(response.snapshot);
      if (!response.ok) throw new Error(response.error ?? "跳转失败");
    } catch (error) {
      setStatus(`进度跳转失败：${errorText(error)}`);
    }
  }

  async function toggleLoop() {
    const next = !loopEnabled;
    setDefaultLoop(next);
    if (!currentCue || !currentChannel) return;
    try {
      const response = await client.setLoop(`cue:${currentCue.id}`, next);
      setSnapshot(response.snapshot);
      if (!response.ok) throw new Error(response.error ?? "循环设置失败");
    } catch (error) {
      setStatus(`循环设置失败：${errorText(error)}`);
    }
  }

  async function stepTrack(direction: -1 | 1) {
    if (!tracks.length) return;
    const currentIndex = currentTrack ? tracks.findIndex((item) => item.url === currentTrack.url) : -1;
    const base = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
    const nextIndex = (base + direction + tracks.length) % tracks.length;
    await playTrack(tracks[nextIndex], loopEnabled);
  }

  async function setMaster(value: number) {
    setMasterDb(value);
    try {
      const response = await client.setBusGain("MASTER", value, 0.05);
      setSnapshot(response.snapshot);
      if (!response.ok) throw new Error(response.error ?? "音量设置失败");
    } catch (error) {
      setStatus(`音量设置失败：${errorText(error)}`);
    }
  }

  function removeTrack(track: SimpleLibraryTrack) {
    persistTracks(tracks.filter((item) => item.id !== track.id));
    setStatus(`已从本机索引移除“${track.name}”。Owlbear Audio Collection 中的云端文件不会被删除。`);
  }

  function renderTrackList(category?: TrackCategory) {
    const filtered = category
      ? searchedTracks.filter((track) => track.category === category)
      : searchedTracks;

    if (!filtered.length) {
      return (
        <WaCallout variant="neutral" appearance="plain">
          {query ? "当前标签下没有匹配的音频。" : "这里还没有音频。可以先从电脑导入，或添加 Owlbear Audio Collection 中的已有音频。"}
        </WaCallout>
      );
    }

    return (
      <div className="wa-stack wa-gap-xs">
        {filtered.map((track) => (
          <WaCard key={track.id} appearance="outlined">
            <div className="wa-split wa-gap-s">
              <div className="wa-cluster wa-gap-s">
                <WaButton
                  size="small"
                  variant="brand"
                  appearance="filled"
                  disabled={busy}
                  aria-label={`播放 ${track.name}`}
                  onClick={() => void playTrack(track)}
                >
                  <Play size={16} />
                </WaButton>
                <div>
                  <strong>{track.name}</strong>
                  <div>
                    <small>
                      {CATEGORY_LABELS[track.category]}
                      {track.bitrateKbps ? ` · ${track.bitrateKbps} kbps` : ""}
                      {track.durationSeconds ? ` · ${formatTime(track.durationSeconds)}` : ""}
                    </small>
                  </div>
                </div>
              </div>
              <WaButton
                size="small"
                appearance="plain"
                variant="danger"
                aria-label={`从本机索引移除 ${track.name}`}
                onClick={() => removeTrack(track)}
              >
                <Trash2 size={16} />
              </WaButton>
            </div>
          </WaCard>
        ))}
      </div>
    );
  }

  const duration = currentChannel?.duration && Number.isFinite(currentChannel.duration)
    ? currentChannel.duration
    : currentTrack?.durationSeconds ?? 0;
  const currentTime = Math.min(currentChannel?.currentTime ?? 0, duration || Number.POSITIVE_INFINITY);

  return (
    <main className="wa-stack wa-gap-s">
      <WaCard appearance="filled-outlined">
        <div className="wa-split wa-gap-s">
          <div className="wa-cluster wa-gap-s">
            <Music2 size={22} />
            <div>
              <strong>Owlbear Audio</strong>
              <div><small>GM 音频控制台</small></div>
            </div>
          </div>
          <WaBadge variant="brand" appearance="outlined">{tracks.length} 个音频</WaBadge>
        </div>
      </WaCard>

      <WaCard appearance="outlined">
        <div className="wa-stack wa-gap-s">
          <strong>导入与管理</strong>
          <div className="wa-grid wa-gap-s">
            <WaSelect
              label="素材分类"
              value={importCategory}
              onChange={(event) => setImportCategory(event.currentTarget.value as TrackCategory)}
            >
              <WaOption value="MUSIC">音乐</WaOption>
              <WaOption value="AMBIENCE">氛围</WaOption>
              <WaOption value="SFX">音效</WaOption>
            </WaSelect>
            <WaSelect
              label="转码质量"
              value={preset}
              onChange={(event) => setPreset(event.currentTarget.value as ImportPresetId)}
            >
              <WaOption value="SPEECH">{PRESET_LABELS.SPEECH}</WaOption>
              <WaOption value="AMBIENCE">{PRESET_LABELS.AMBIENCE}</WaOption>
              <WaOption value="MUSIC">{PRESET_LABELS.MUSIC}</WaOption>
              <WaOption value="ARCHIVE">{PRESET_LABELS.ARCHIVE}</WaOption>
            </WaSelect>
          </div>

          <div className="wa-grid wa-gap-s">
            <WaButton
              variant="brand"
              appearance="filled"
              loading={busy && progress !== null}
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload slot="start" size={16} />
              从电脑导入
            </WaButton>
            <WaButton appearance="outlined" disabled={busy} onClick={() => void selectFromOwlbear(false)}>
              <Plus slot="start" size={16} />
              添加已有音频
            </WaButton>
          </div>

          {progress !== null && <WaProgressBar value={Math.round(progress * 100)} />}

          {pendingImports.length > 0 && (
            <WaCallout variant="brand" appearance="outlined">
              <div className="wa-stack wa-gap-xs">
                <strong>{pendingImports.length} 个音频已完成本地转码</strong>
                <span>在 Owlbear 原生保存器把它们放进 “Owlbear Audio” Collection 后，再点下面按钮取回正式 CDN 资产。</span>
                <WaButton disabled={busy} onClick={() => void selectFromOwlbear(true)}>
                  <Download slot="start" size={16} />
                  完成导入
                </WaButton>
              </div>
            </WaCallout>
          )}

          <input
            ref={fileInputRef}
            hidden
            type="file"
            multiple
            accept="audio/*,video/mp4,video/webm,.m4a,.mp3,.wav,.ogg,.flac,.aac"
            onChange={(event) => void importFiles(Array.from(event.target.files ?? []))}
          />
        </div>
      </WaCard>

      <WaCard appearance="outlined">
        <div className="wa-stack wa-gap-s">
          <div className="wa-split wa-gap-s">
            <div className="wa-cluster wa-gap-xs"><Library size={18} /><strong>音频库</strong></div>
            {busy && <Loader2 size={16} />}
          </div>
          <WaInput
            placeholder="搜索音频…"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value ?? "")}
          >
            <Search slot="start" size={16} />
          </WaInput>
          <WaTabGroup>
            <WaTab panel="all" active>全部</WaTab>
            <WaTab panel="music">音乐</WaTab>
            <WaTab panel="ambience">氛围</WaTab>
            <WaTab panel="sfx">音效</WaTab>
            <WaTabPanel name="all" active>{renderTrackList()}</WaTabPanel>
            <WaTabPanel name="music">{renderTrackList("MUSIC")}</WaTabPanel>
            <WaTabPanel name="ambience">{renderTrackList("AMBIENCE")}</WaTabPanel>
            <WaTabPanel name="sfx">{renderTrackList("SFX")}</WaTabPanel>
          </WaTabGroup>
        </div>
      </WaCard>

      <WaCard appearance="filled-outlined">
        <div className="wa-stack wa-gap-s">
          <div className="wa-split wa-gap-s">
            <div className="wa-cluster wa-gap-s">
              <Music2 size={20} />
              <div>
                <small>正在播放</small>
                <div><strong>{currentCue?.name ?? "暂无音频"}</strong></div>
              </div>
            </div>
            <WaBadge variant={snapshot?.transport.phase === "PLAYING" ? "success" : "neutral"} appearance="outlined">
              {snapshot?.transport.phase === "PLAYING" ? "播放中" : snapshot?.transport.phase === "PAUSED" ? "已暂停" : "空闲"}
            </WaBadge>
          </div>

          <WaSlider
            aria-label="播放进度"
            min={0}
            max={Math.max(1, duration)}
            step={0.1}
            value={currentTime}
            disabled={!currentCue || !duration}
            withTooltip
            onChange={(event) => void seek(event.currentTarget.value)}
          />
          <div className="wa-split wa-gap-s">
            <small>{formatTime(currentTime)}</small>
            <small>{formatTime(duration)}</small>
          </div>

          <div className="wa-split wa-gap-s">
            <WaButtonGroup label="播放控制">
              <WaButton disabled={!tracks.length || busy} aria-label="上一首" onClick={() => void stepTrack(-1)}>
                <ChevronLeft size={18} />
              </WaButton>
              <WaButton
                variant="brand"
                appearance="filled"
                disabled={!currentCue || !currentChannel || busy}
                aria-label={currentChannel?.paused ? "继续播放" : "暂停"}
                onClick={() => void togglePause()}
              >
                {currentChannel?.paused ? <Play size={18} /> : <Pause size={18} />}
              </WaButton>
              <WaButton disabled={!tracks.length || busy} aria-label="下一首" onClick={() => void stepTrack(1)}>
                <ChevronRight size={18} />
              </WaButton>
              <WaButton disabled={!currentCue || busy} aria-label="停止" onClick={() => void stopPlayback()}>
                <Square size={16} />
              </WaButton>
            </WaButtonGroup>
            <WaSwitch checked={loopEnabled} onChange={() => void toggleLoop()}>循环</WaSwitch>
          </div>

          <div className="wa-stack wa-gap-xs">
            <div className="wa-cluster wa-gap-xs"><Volume2 size={16} /><small>本机音量 · {masterDb > 0 ? "+" : ""}{masterDb} dB</small></div>
            <WaSlider
              aria-label="本机音量"
              min={-48}
              max={6}
              step={1}
              value={masterDb}
              onInput={(event) => setMasterDb(event.currentTarget.value)}
              onChange={(event) => void setMaster(event.currentTarget.value)}
            />
          </div>
        </div>
      </WaCard>

      <WaCallout variant="neutral" appearance="plain" role="status">{status}</WaCallout>
    </main>
  );
}
