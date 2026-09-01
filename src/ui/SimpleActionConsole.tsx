import { useEffect, useMemo, useRef, useState } from "react";
import OBR, { buildImageUpload } from "@owlbear-rodeo/sdk";
import { Download, Library, Loader2, Music2, Pause, Play, Plus, Search, Square, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { BackgroundClient } from "@/runtime/BackgroundClient";
import type { RuntimeSnapshot } from "@/runtime/protocol";
import {
  loadPendingImportNames,
  loadSimpleLibrary,
  mergeSimpleLibrary,
  savePendingImportNames,
  saveSimpleLibrary,
  type SimpleLibraryTrack,
} from "@/library/simpleLibrary";

const client = new BackgroundClient();

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function fileDisplayName(file: File): string {
  return file.name.replace(/\.[^.]+$/, "").trim() || "未命名音频";
}

export function SimpleActionConsole({ ready }: { ready: boolean }) {
  const [tracks, setTracks] = useState<SimpleLibraryTrack[]>(() => loadSimpleLibrary());
  const [pendingNames, setPendingNames] = useState<string[]>(() => loadPendingImportNames());
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState("从电脑导入音乐，或从 Owlbear Audio 取回已有音频。");
  const [masterDb, setMasterDb] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentCue = snapshot?.transport.phase === "PLAYING" || snapshot?.transport.phase === "PAUSED"
    ? snapshot.transport.currentCue
    : undefined;
  const currentChannel = useMemo(
    () => currentCue ? snapshot?.channels.find((channel) => channel.id === `cue:${currentCue.id}`) ?? null : null,
    [currentCue, snapshot?.channels],
  );

  const visibleTracks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return tracks;
    return tracks.filter((track) => track.name.toLocaleLowerCase().includes(needle));
  }, [query, tracks]);

  function persistTracks(next: SimpleLibraryTrack[]) {
    setTracks(next);
    saveSimpleLibrary(next);
  }

  function persistPending(names: string[]) {
    setPendingNames(names);
    savePendingImportNames(names);
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
        // Action 重新挂载时 Background 可能还在握手；下一轮轮询会自动恢复。
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
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
      const names: string[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const source = files[index];
        const name = fileDisplayName(source);
        setStatus(`正在转换 ${index + 1}/${files.length}：${name}`);
        const result = await transcodeToProductionWebm(source, {
          preset: "MUSIC",
          onProgress: (value) => setProgress((index + value) / files.length),
        });
        uploads.push(
          buildImageUpload(result.file)
            .name(name)
            .description("Owlbear Audio 音频资产")
            .build(),
        );
        names.push(name);
      }

      persistPending(names);
      setStatus("转换完成。请在 Owlbear 保存窗口中选择 “Owlbear Audio” 保存位置并上传；完成后回来点“完成导入”。");
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
      const search = linkPending ? pendingNames[0] ?? "" : "";
      const multiple = !linkPending || pendingNames.length > 1;
      const selected = await OBR.assets.downloadImages(multiple, search, "ATTACHMENT");
      const supported = selected.filter((asset) => asset.image.mime === "video/webm");
      const added: SimpleLibraryTrack[] = supported.map((asset) => ({
        id: crypto.randomUUID(),
        name: asset.name,
        url: asset.image.url,
        mime: asset.image.mime,
        addedAt: Date.now(),
      }));
      const merged = mergeSimpleLibrary(tracks, added);
      persistTracks(merged);
      if (linkPending) persistPending([]);
      setStatus(added.length ? `已加入 ${added.length} 个音频。` : "没有选择可播放的 Owlbear Audio WebM。" );
    } catch (error) {
      setStatus(`读取 Owlbear 音频失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function playTrack(track: SimpleLibraryTrack) {
    if (!ready || busy) return;
    setBusy(true);
    setStatus(`正在播放：${track.name}`);
    try {
      // 同一个真实用户点击里完成浏览器音频解锁；用户不需要理解“Enable Audio”。
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
            loop: true,
            fadeSeconds: currentCue ? 1.2 : 0,
          },
        ],
      });
      const response = await client.go();
      setSnapshot(response.snapshot);
      if (!response.ok) throw new Error(response.error ?? "播放失败");
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
    } catch (error) {
      setStatus(`控制播放失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function stopPlayback() {
    setBusy(true);
    try {
      const response = await client.stopAll();
      setSnapshot(response.snapshot);
      setStatus("已停止播放。");
    } finally {
      setBusy(false);
    }
  }

  async function setMaster(value: number) {
    setMasterDb(value);
    try {
      const response = await client.setBusGain("MASTER", value, 0.05);
      setSnapshot(response.snapshot);
    } catch (error) {
      setStatus(`音量设置失败：${errorText(error)}`);
    }
  }

  function removeTrack(track: SimpleLibraryTrack) {
    persistTracks(tracks.filter((item) => item.id !== track.id));
    setStatus(`已从本机音乐库移除“${track.name}”。Owlbear 云端资产不会被删除。`);
  }

  return (
    <main className="flex h-[min(620px,100dvh)] min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Music2 className="size-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">Owlbear Audio</h1>
              <p className="text-xs text-muted-foreground">音乐与环境音</p>
            </div>
          </div>
        </div>
        <Badge variant="secondary" className="shrink-0">{tracks.length} 首</Badge>
      </header>

      {currentCue && (
        <section className="border-b bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Music2 className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">正在播放</p>
              <p className="truncate text-sm font-semibold">{currentCue.name}</p>
            </div>
            <Button size="icon-lg" variant="outline" onClick={() => void togglePause()} disabled={busy} aria-label={currentChannel?.paused ? "继续播放" : "暂停"}>
              {currentChannel?.paused ? <Play /> : <Pause />}
            </Button>
            <Button size="icon-lg" variant="outline" onClick={() => void stopPlayback()} disabled={busy} aria-label="停止">
              <Square />
            </Button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="w-9 text-xs text-muted-foreground">音量</span>
            <Slider min={-48} max={6} step={1} value={[masterDb]} onValueChange={(value) => void setMaster(value[0] ?? 0)} className="flex-1" />
            <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{masterDb > 0 ? "+" : ""}{masterDb} dB</span>
          </div>
        </section>
      )}

      <section className="flex min-h-0 flex-1 flex-col px-3 pt-3">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索音乐…" className="h-10 pl-9" />
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2 pb-3">
            {visibleTracks.length ? visibleTracks.map((track) => (
              <Card key={track.id} className="py-0 shadow-none">
                <CardContent className="flex items-center gap-2 p-2.5">
                  <Button size="icon-lg" onClick={() => void playTrack(track)} disabled={busy} aria-label={`播放 ${track.name}`}>
                    <Play />
                  </Button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{track.name}</p>
                    <p className="truncate text-xs text-muted-foreground">Owlbear Audio · 循环播放</p>
                  </div>
                  <Button size="icon-lg" variant="ghost" onClick={() => removeTrack(track)} aria-label={`从音乐库移除 ${track.name}`}>
                    <Trash2 />
                  </Button>
                </CardContent>
              </Card>
            )) : (
              <div className="flex min-h-44 flex-col items-center justify-center px-6 text-center">
                <div className="mb-3 grid size-11 place-items-center rounded-2xl bg-muted"><Library className="size-5 text-muted-foreground" /></div>
                <p className="text-sm font-medium">{query ? "没有找到音乐" : "音乐库还是空的"}</p>
                {!query && <p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground">从电脑导入 MP3、WAV、M4A 等文件；插件会自动转换后存进 Owlbear。</p>}
              </div>
            )}
          </div>
        </ScrollArea>
      </section>

      <footer className="space-y-2 border-t bg-background p-3">
        {progress !== null && <Progress value={Math.round(progress * 100)} />}
        {pendingNames.length > 0 && (
          <Button className="h-11 w-full" variant="secondary" disabled={busy} onClick={() => void selectFromOwlbear(true)}>
            <Download /> 完成导入 · {pendingNames.length}
          </Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button className="h-11" disabled={busy} onClick={() => fileInputRef.current?.click()}>
            {busy ? <Loader2 className="animate-spin" /> : <Upload />} 从电脑导入
          </Button>
          <Button className="h-11" variant="outline" disabled={busy} onClick={() => void selectFromOwlbear(false)}>
            <Plus /> 添加已有音频
          </Button>
        </div>
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          multiple
          accept="audio/*,video/mp4,video/webm,.m4a,.mp3,.wav,.ogg,.flac,.aac"
          onChange={(event) => void importFiles(Array.from(event.target.files ?? []))}
        />
        <p className="min-h-8 px-1 text-[11px] leading-4 text-muted-foreground" role="status">{status}</p>
      </footer>
    </main>
  );
}
