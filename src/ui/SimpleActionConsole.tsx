import { useEffect, useMemo, useState } from "react";
import OBR, { buildImageUpload } from "@owlbear-rodeo/sdk";
import {
  LibraryIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { BackgroundClient } from "@/runtime/BackgroundClient";
import type {
  RuntimePlayCue,
  RuntimePlaybackMode,
  RuntimeSnapshot,
} from "@/runtime/protocol";
import { ImportDialog } from "@/ui/ImportDialog";
import { LibrarySidebar, type LibraryFilter } from "@/ui/LibrarySidebar";
import { NowPlayingBar } from "@/ui/NowPlayingBar";
import { QueueSheet } from "@/ui/QueueSheet";
import { SettingsPanel } from "@/ui/SettingsPanel";
import { TrackList } from "@/ui/TrackList";
import { WelcomeDialog } from "@/ui/WelcomeDialog";
import { CATEGORY_LABELS, errorText } from "@/ui/playerDisplay";
import {
  hasSeenWelcome,
  loadPlayerPreferences,
  markWelcomeSeen,
  resetWelcomeSeen,
  savePlayerPreferences,
  type LocalPlayerPreferences,
} from "@/ui/playerPreferences";

const client = new BackgroundClient();

/**
 * 把音乐库条目转换为 Background Runtime 能持久持有的 Cue。
 *
 * Cue id 故意使用独立 UUID：同一首曲目允许多次进入队列，不会因为 library id 相同
 * 而复用同一个 HTMLAudioElement channel。音乐库和队列的关联通过 url 判断即可。
 */
function cueFromTrack(track: SimpleLibraryTrack, fadeSeconds: number): RuntimePlayCue {
  return {
    id: crypto.randomUUID(),
    name: track.name,
    type: "PLAY",
    url: track.url,
    busId: track.category,
    loop: false,
    fadeSeconds,
  };
}

function fileDisplayName(file: File): string {
  return file.name.replace(/\.[^.]+$/, "").trim() || "未命名音频";
}

function trackMatchesFilter(track: SimpleLibraryTrack, filter: LibraryFilter): boolean {
  if (filter.kind === "ALL") return true;
  if (filter.kind === "CATEGORY") return track.category === filter.category;
  return track.group === filter.group;
}

function trackMatchesQuery(track: SimpleLibraryTrack, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [track.name, track.group, ...track.tags]
    .some((value) => value.toLocaleLowerCase().includes(needle));
}

/**
 * GM / DM 的唯一 Action 页面。
 *
 * 页面本身不拥有 <audio>。它只做三件事：
 * 1) 管理浏览器本地的音乐库索引；
 * 2) 调 Owlbear Assets 完成转码后的云端保存/选回；
 * 3) 通过 LOCAL broadcast 遥控隐藏 BackgroundCoordinator。
 *
 * 因此 Action 关闭以后，队列、播放模式和实际 HTMLAudioElement 都不会被 React 卸载。
 */
export function SimpleActionConsole({ ready }: { ready: boolean }) {
  const [tracks, setTracks] = useState<SimpleLibraryTrack[]>(() => loadSimpleLibrary());
  const [pendingImports, setPendingImports] = useState<PendingImport[]>(() => loadPendingImports());
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [preferences, setPreferences] = useState<LocalPlayerPreferences>(() => loadPlayerPreferences());
  const [welcomeOpen, setWelcomeOpen] = useState(() => !hasSeenWelcome());
  const [importOpen, setImportOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"library" | "settings">("library");
  const [filter, setFilter] = useState<LibraryFilter>({ kind: "ALL" });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState("准备就绪");

  const currentCue = snapshot?.transport.currentCue;
  const currentChannel = useMemo(() => {
    if (!currentCue) return null;
    return snapshot?.channels.find((channel) => channel.url === currentCue.url) ?? null;
  }, [currentCue, snapshot?.channels]);
  const currentLibraryTrack = useMemo(() => {
    if (!currentCue) return null;
    return tracks.find((track) => track.url === currentCue.url) ?? null;
  }, [currentCue, tracks]);
  const visibleTracks = useMemo(
    () => tracks.filter((track) => trackMatchesFilter(track, filter) && trackMatchesQuery(track, query)),
    [filter, query, tracks],
  );

  function persistTracks(next: SimpleLibraryTrack[]) {
    setTracks(next);
    saveSimpleLibrary(next);
  }

  function persistPending(next: PendingImport[]) {
    setPendingImports(next);
    savePendingImports(next);
  }

  function persistPreferences(next: LocalPlayerPreferences) {
    setPreferences(next);
    savePlayerPreferences(next);
  }

  /**
   * Action 只轮询 LOCAL snapshot，不通过网络轮询房间。
   * 真实 GM→PLAYER 同步仍由 BackgroundCoordinator 的 Owlbear broadcast 完成。
   */
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        const response = await client.snapshot();
        if (!cancelled) setSnapshot(response.snapshot);
      } catch {
        // Background iframe 与 Action 并行初始化，首次 1~2 次失败是可恢复的。
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 400);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ready]);

  /** 首次挂载时把本机偏好的真实播放模式/音量同步进隐藏 Background。 */
  useEffect(() => {
    if (!ready) return;
    void client.setPlaybackMode(preferences.playbackMode).catch(() => undefined);
    void client.setBusGain("MASTER", preferences.masterDb, 0).catch(() => undefined);
    // 只做首次恢复；后续用户改设置由对应 handler 即时写入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function importFiles(
    files: File[],
    preset: ImportPresetId,
    category: TrackCategory,
  ) {
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
            .description(`Owlbear Audio · ${CATEGORY_LABELS[category]} · ${result.bitrateKbps} kbps`)
            .build(),
        );
        staged.push({
          name,
          category,
          preset: result.preset,
          durationSeconds: result.durationSeconds,
          bitrateKbps: result.bitrateKbps,
          createdAt: Date.now(),
        });
      }

      persistPending([...pendingImports, ...staged]);
      setStatus("转换完成。请在 Owlbear 原生保存窗口确认保存；完成后会继续登记播放地址。");
      await OBR.assets.uploadImages(uploads, "ATTACHMENT");

      // uploadImages() 成功返回代表宿主保存流程已经结束。公开 API 不返回新 Asset URL，
      // 所以在同一次“添加音频”流程里紧接着打开 picker，让用户选回刚保存的文件。
      await recoverPendingImports([...pendingImports, ...staged]);
    } catch (error) {
      setStatus(`导入失败：${errorText(error)}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function recoverPendingImports(sourcePending = pendingImports) {
    if (!ready || busy || sourcePending.length === 0) return;
    setBusy(true);
    try {
      const search = sourcePending[0]?.name ?? "";
      const selected = await OBR.assets.downloadImages(sourcePending.length > 1, search, "ATTACHMENT");
      const supported = selected.filter((asset) => asset.image.mime === "video/webm");
      const remaining = [...sourcePending];

      const added: SimpleLibraryTrack[] = supported.map((asset) => {
        const matchedIndex = remaining.findIndex((item) => item.name === asset.name);
        const matched = matchedIndex >= 0 ? remaining.splice(matchedIndex, 1)[0] : undefined;
        return {
          id: crypto.randomUUID(),
          name: asset.name,
          url: asset.image.url,
          mime: asset.image.mime,
          ...(matched?.durationSeconds ? { durationSeconds: matched.durationSeconds } : {}),
          category: matched?.category ?? preferences.defaultCategory,
          group: "",
          tags: [],
          ...(matched?.preset ? { preset: matched.preset } : {}),
          ...(matched?.bitrateKbps ? { bitrateKbps: matched.bitrateKbps } : {}),
          addedAt: Date.now(),
        };
      });

      persistTracks(mergeSimpleLibrary(tracks, added));
      persistPending(remaining);
      if (added.length > 0) {
        setStatus(`已把 ${added.length} 个音频加入音乐库。`);
        setImportOpen(false);
      } else {
        setStatus("没有选回可播放的 WebM 音频；可以稍后在“添加音频”里继续登记。");
      }
    } catch (error) {
      setStatus(`登记音频失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function queueWithTrack(track: SimpleLibraryTrack, position: "NOW" | "NEXT" | "END"): RuntimePlayCue[] {
    const currentQueue = snapshot?.transport.queue ?? [];
    const nextCue = cueFromTrack(track, preferences.crossfadeSeconds);

    if (position === "NOW") {
      // “立即播放”默认以当前可见音乐库作为后续列表，更符合普通播放器直觉。
      const visibleQueue = visibleTracks.map((item) => cueFromTrack(item, preferences.crossfadeSeconds));
      const selectedIndex = visibleTracks.findIndex((item) => item.id === track.id);
      if (selectedIndex < 0) return [nextCue];
      return visibleQueue;
    }

    if (currentQueue.length === 0) return [nextCue];
    if (position === "END") return [...currentQueue, nextCue];

    const currentIndex = Math.max(0, snapshot?.transport.currentIndex ?? 0);
    return [
      ...currentQueue.slice(0, currentIndex + 1),
      nextCue,
      ...currentQueue.slice(currentIndex + 1),
    ];
  }

  async function loadQueue(queue: RuntimePlayCue[], startIndex?: number, go = false) {
    const response = await client.loadPlan({
      id: "owlbear-audio-library",
      name: "Owlbear Audio Library",
      cues: queue,
      ...(startIndex !== undefined ? { startIndex } : {}),
      playbackMode: preferences.playbackMode,
    });
    setSnapshot(response.snapshot);
    if (!response.ok) throw new Error(response.error ?? "加载播放队列失败");
    if (!go) return response;
    const started = await client.go();
    setSnapshot(started.snapshot);
    if (!started.ok) throw new Error(started.error ?? "播放失败");
    return started;
  }

  async function playNow(track: SimpleLibraryTrack) {
    if (busy) return;
    setBusy(true);
    try {
      const queue = queueWithTrack(track, "NOW");
      const startIndex = visibleTracks.findIndex((item) => item.id === track.id);
      await loadQueue(queue, Math.max(0, startIndex), true);
      setStatus(`正在播放：${track.name}`);
    } catch (error) {
      setStatus(`播放失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function addTrackToQueue(track: SimpleLibraryTrack, position: "NEXT" | "END") {
    try {
      const queue = queueWithTrack(track, position);
      await loadQueue(queue);
      setStatus(position === "NEXT" ? `下一首将播放：${track.name}` : `已加入队列：${track.name}`);
    } catch (error) {
      setStatus(`更新队列失败：${errorText(error)}`);
    }
  }

  async function playQueueCue(cueId: string) {
    const queue = snapshot?.transport.queue ?? [];
    const index = queue.findIndex((cue) => cue.id === cueId);
    if (index < 0) return;
    try {
      await loadQueue(queue, index, true);
    } catch (error) {
      setStatus(`切换曲目失败：${errorText(error)}`);
    }
  }

  async function removeQueueCue(cueId: string) {
    const queue = snapshot?.transport.queue ?? [];
    const currentId = snapshot?.transport.currentCue?.id;
    const next = queue.filter((cue) => cue.id !== cueId || cue.id === currentId);
    try {
      await loadQueue(next);
    } catch (error) {
      setStatus(`移除队列曲目失败：${errorText(error)}`);
    }
  }

  async function togglePlayback() {
    if (!currentCue || !currentChannel) return;
    try {
      const response = currentChannel.paused
        ? await client.play({
            channelId: currentChannel.id,
            url: currentCue.url,
            busId: currentCue.busId,
            gainDb: currentCue.gainDb,
            loop: snapshot?.transport.playbackMode === "REPEAT_ONE",
          })
        : await client.pause(currentChannel.id);
      setSnapshot(response.snapshot);
    } catch (error) {
      setStatus(`播放控制失败：${errorText(error)}`);
    }
  }

  async function seek(seconds: number) {
    if (!currentChannel) return;
    try {
      const response = await client.seek(currentChannel.id, seconds);
      setSnapshot(response.snapshot);
    } catch (error) {
      setStatus(`跳转失败：${errorText(error)}`);
    }
  }

  async function step(direction: -1 | 1) {
    const queue = snapshot?.transport.queue ?? [];
    if (!queue.length) return;
    const currentIndex = Math.max(0, snapshot?.transport.currentIndex ?? 0);
    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = preferences.playbackMode === "REPEAT_ALL" ? queue.length - 1 : 0;
    if (nextIndex >= queue.length) nextIndex = preferences.playbackMode === "REPEAT_ALL" ? 0 : queue.length - 1;
    try {
      await loadQueue(queue, nextIndex, true);
    } catch (error) {
      setStatus(`切换曲目失败：${errorText(error)}`);
    }
  }

  async function changePlaybackMode(mode: RuntimePlaybackMode) {
    const next = { ...preferences, playbackMode: mode };
    persistPreferences(next);
    try {
      const response = await client.setPlaybackMode(mode);
      setSnapshot(response.snapshot);
    } catch (error) {
      setStatus(`播放模式设置失败：${errorText(error)}`);
    }
  }

  async function changeMasterDb(db: number) {
    const next = { ...preferences, masterDb: db };
    persistPreferences(next);
    try {
      const response = await client.setBusGain("MASTER", db, 0.05);
      setSnapshot(response.snapshot);
    } catch (error) {
      setStatus(`音量设置失败：${errorText(error)}`);
    }
  }

  function changePreferences(next: LocalPlayerPreferences) {
    const playbackChanged = next.playbackMode !== preferences.playbackMode;
    const volumeChanged = next.masterDb !== preferences.masterDb;
    persistPreferences(next);
    if (playbackChanged) void client.setPlaybackMode(next.playbackMode).then((r) => setSnapshot(r.snapshot));
    if (volumeChanged) void client.setBusGain("MASTER", next.masterDb, 0.05).then((r) => setSnapshot(r.snapshot));
  }

  function removeLibraryTrack(track: SimpleLibraryTrack) {
    persistTracks(tracks.filter((item) => item.id !== track.id));
    setStatus(`已从本机音乐库移除“${track.name}”。Owlbear 云端文件不会被删除。`);
  }

  const filterTitle = filter.kind === "ALL"
    ? "全部音频"
    : filter.kind === "CATEGORY"
      ? CATEGORY_LABELS[filter.category]
      : filter.group;
  const playing = snapshot?.transport.phase === "PLAYING" && currentChannel?.paused === false;
  const paused = snapshot?.transport.phase === "PAUSED" || Boolean(currentChannel?.paused);
  const duration = currentChannel?.duration && Number.isFinite(currentChannel.duration)
    ? currentChannel.duration
    : currentLibraryTrack?.durationSeconds ?? 0;
  const currentTime = currentChannel?.currentTime ?? 0;
  const queue = snapshot?.transport.queue ?? [];
  const currentIndex = snapshot?.transport.currentIndex ?? -1;

  return (
    <main className="flex h-[min(640px,100dvh)] min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <WelcomeDialog
        open={welcomeOpen}
        onAcknowledge={() => {
          markWelcomeSeen();
          setWelcomeOpen(false);
        }}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        defaultPreset={preferences.defaultPreset}
        defaultCategory={preferences.defaultCategory}
        busy={busy}
        progress={progress}
        status={status}
        pendingCount={pendingImports.length}
        onImport={(files, preset, category) => void importFiles(files, preset, category)}
        onRecoverPending={() => void recoverPendingImports()}
      />

      <QueueSheet
        open={queueOpen}
        onOpenChange={setQueueOpen}
        queue={queue}
        currentCueId={currentCue?.id}
        onPlayCue={(cueId) => void playQueueCue(cueId)}
        onRemoveCue={(cueId) => void removeQueueCue(cueId)}
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as "library" | "settings")}
        className="min-h-0 flex-1 gap-0"
      >
        <header className="flex items-center gap-2 border-b px-3 py-2.5">
          {activeTab === "library" ? (
            <LibrarySidebar tracks={tracks} filter={filter} onFilterChange={setFilter} />
          ) : (
            <div className="size-7" />
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Owlbear Audio</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {activeTab === "library" ? filterTitle : "设置"}
            </p>
          </div>

          <TabsList variant="line" className="h-7">
            <TabsTrigger value="library" aria-label="音乐库">
              <LibraryIcon data-icon="inline-start" />
              音乐库
            </TabsTrigger>
            <TabsTrigger value="settings" aria-label="设置">
              <SettingsIcon data-icon="inline-start" />
              设置
            </TabsTrigger>
          </TabsList>
        </header>

        <TabsContent value="library" className="min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 px-3 py-3">
              <InputGroup className="flex-1">
                <InputGroupAddon><SearchIcon /></InputGroupAddon>
                <InputGroupInput
                  value={query}
                  placeholder="搜索曲目、文件夹或标签"
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              </InputGroup>
              <Button size="sm" onClick={() => setImportOpen(true)}>
                <PlusIcon data-icon="inline-start" />
                添加音频
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1 px-2 pb-3">
              {visibleTracks.length === 0 ? (
                <Empty className="min-h-72 border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><LibraryIcon /></EmptyMedia>
                    <EmptyTitle>{tracks.length === 0 ? "上传你的第一个音频" : "没有匹配的音频"}</EmptyTitle>
                    <EmptyDescription>
                      {tracks.length === 0
                        ? "支持批量选择常见音频格式，浏览器会先转成 Opus/WebM，再交给 Owlbear 保存。"
                        : "换一个分类或搜索词试试。"}
                    </EmptyDescription>
                  </EmptyHeader>
                  {tracks.length === 0 && (
                    <EmptyContent>
                      <Button onClick={() => setImportOpen(true)}>
                        <PlusIcon data-icon="inline-start" />
                        添加音频
                      </Button>
                    </EmptyContent>
                  )}
                </Empty>
              ) : (
                <TrackList
                  tracks={visibleTracks}
                  currentCueId={currentLibraryTrack?.id}
                  busy={busy}
                  onPlayNow={(track) => void playNow(track)}
                  onPlayNext={(track) => void addTrackToQueue(track, "NEXT")}
                  onAddToQueue={(track) => void addTrackToQueue(track, "END")}
                  onRemove={removeLibraryTrack}
                />
              )}
            </ScrollArea>

            {status !== "准备就绪" && (
              <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground" role="status">
                {status}
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="settings" className="min-h-0 flex-1 overflow-auto">
          <SettingsPanel
            preferences={preferences}
            snapshot={snapshot}
            onPreferencesChange={changePreferences}
            onResetWelcome={() => {
              resetWelcomeSeen();
              setWelcomeOpen(true);
            }}
          />
        </TabsContent>
      </Tabs>

      <NowPlayingBar
        trackName={currentCue?.name}
        playing={playing}
        paused={paused}
        currentTime={currentTime}
        duration={duration}
        masterDb={snapshot?.busGainsDb.MASTER ?? preferences.masterDb}
        playbackMode={snapshot?.transport.playbackMode ?? preferences.playbackMode}
        canGoPrevious={queue.length > 0 && currentIndex > 0}
        canGoNext={queue.length > 0 && (currentIndex < queue.length - 1 || preferences.playbackMode === "REPEAT_ALL")}
        onTogglePlayback={() => void togglePlayback()}
        onPrevious={() => void step(-1)}
        onNext={() => void step(1)}
        onSeek={(seconds) => void seek(seconds)}
        onMasterDbChange={(db) => void changeMasterDb(db)}
        onPlaybackModeChange={(mode) => void changePlaybackMode(mode)}
        onOpenQueue={() => setQueueOpen(true)}
      />
    </main>
  );
}
