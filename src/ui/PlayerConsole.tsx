import { useEffect, useMemo, useRef, useState } from "react";
import {
  HeadphonesIcon,
  Music2Icon,
  RadioIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import type { RuntimeSnapshot } from "@/runtime/protocol";
import { BackgroundClient } from "@/runtime/BackgroundClient";
import { errorText, formatTime, singleSliderValue } from "@/ui/playerDisplay";

const client = new BackgroundClient();

/**
 * PLAYER 页面故意比 GM 简单很多：没有音乐库、队列、播放模式或切歌按钮。
 * PLAYER 只负责确认自己已经连接到 Background、在浏览器需要时完成一次媒体手势，
 * 然后查看当前曲目与调整“只影响本机”的音量。
 */
export function PlayerConsole({ ready }: { ready: boolean }) {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [message, setMessage] = useState("正在连接房间音频…");
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [masterDb, setMasterDb] = useState(0);
  const unmutedDb = useRef(0);

  const currentCue = snapshot?.transport.currentCue;
  const channel = useMemo(() => {
    if (!currentCue) return null;
    return snapshot?.channels.find((item) => item.url === currentCue.url) ?? null;
  }, [currentCue, snapshot?.channels]);

  function applySnapshot(next: RuntimeSnapshot) {
    setSnapshot(next);
    const nextMaster = next.busGainsDb.MASTER;
    setMasterDb(nextMaster);
    if (nextMaster > -48) unmutedDb.current = nextMaster;

    if (next.role === null) {
      setMessage("Background 正在等待 Owlbear 角色握手；会自动重试。 ");
    } else if (!next.transport.currentCue) {
      setMessage("已连接。等待 DM 播放音频。");
    } else if (!next.isUnlocked) {
      setMessage("浏览器阻止了自动播放，请点一次“启用声音”。");
    } else {
      setMessage("已连接并自动跟随 DM。");
    }
  }

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        const response = await client.snapshot();
        if (!cancelled) applySnapshot(response.snapshot);
      } catch (error) {
        if (!cancelled) setMessage(`后台播放器未连接：${errorText(error)}`);
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 400);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ready]);

  async function enableAudio() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await client.unlock();
      applySnapshot(response.snapshot);
      if (!response.ok) throw new Error(response.error ?? "启用声音失败");
      setMessage(response.snapshot.isUnlocked
        ? "声音已启用，正在跟随 DM。"
        : "浏览器仍阻止播放，请检查该站点的媒体权限后再试。"
      );
    } catch (error) {
      setMessage(`启用声音失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function changeMasterDb(db: number) {
    setMasterDb(db);
    if (db > -48) unmutedDb.current = db;
    try {
      const response = await client.setBusGain("MASTER", db, 0.05);
      setSnapshot(response.snapshot);
    } catch (error) {
      setMessage(`音量设置失败：${errorText(error)}`);
    }
  }

  async function toggleMute() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    await changeMasterDb(nextMuted ? -48 : unmutedDb.current);
  }

  const duration = channel?.duration && Number.isFinite(channel.duration) ? channel.duration : 0;
  const currentTime = Math.max(0, channel?.currentTime ?? 0);
  const progress = duration > 0 ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;
  const connected = snapshot?.role === "PLAYER";
  const playing = snapshot?.transport.phase === "PLAYING" && channel?.paused === false;

  return (
    <main className="flex h-[min(520px,100dvh)] flex-col bg-background p-4 text-foreground">
      <header className="flex items-center gap-3 border-b pb-4">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <HeadphonesIcon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold">Owlbear Audio</h1>
            <Badge variant={connected ? "secondary" : "outline"}>
              {connected ? "PLAYER 已连接" : "正在连接"}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">房间音频由 DM 统一控制</p>
        </div>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-5 py-6 text-center">
        <div className="flex size-20 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-sm ring-1 ring-foreground/5">
          {playing ? <RadioIcon className="size-8" /> : <Music2Icon className="size-8" />}
        </div>
        <div className="max-w-72">
          <p className="truncate text-base font-medium">{currentCue?.name ?? "还没有正在播放的音频"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {currentCue ? (playing ? "正在与 DM 同步播放" : "等待 DM 继续播放") : "DM 开始播放后会自动出现在这里"}
          </p>
        </div>

        <div className="w-full max-w-80">
          <Progress value={progress} />
          <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {currentCue && snapshot?.isUnlocked === false && (
          <Button disabled={busy} onClick={() => void enableAudio()}>
            <Volume2Icon data-icon="inline-start" />
            启用声音
          </Button>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">我的音量</p>
            <p className="text-xs text-muted-foreground">只影响你当前浏览器</p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={muted ? "取消静音" : "静音"} onClick={() => void toggleMute()}>
            {muted ? <VolumeXIcon /> : <Volume2Icon />}
          </Button>
        </div>
        <Slider
          min={-48}
          max={0}
          step={1}
          value={muted ? -48 : masterDb}
          disabled={!snapshot}
          onValueChange={(value) => setMasterDb(singleSliderValue(value))}
          onValueCommitted={(value) => void changeMasterDb(singleSliderValue(value))}
        />
        <Alert className="py-2.5">
          <AlertTitle className="text-xs">连接状态</AlertTitle>
          <AlertDescription className="text-xs">{message}</AlertDescription>
        </Alert>
      </section>
    </main>
  );
}
