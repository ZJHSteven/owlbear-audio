import { useEffect, useMemo, useRef, useState } from "react";
import { Music2, Volume2, VolumeX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { BackgroundClient } from "@/runtime/BackgroundClient";
import type { RuntimeSnapshot } from "@/runtime/protocol";

const client = new BackgroundClient();

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function PlayerConsole({ ready }: { ready: boolean }) {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("等待 GM 播放音乐。");
  const [masterDb, setMasterDb] = useState(0);
  const [muted, setMuted] = useState(false);
  const unmutedDb = useRef(0);

  const currentCue = snapshot?.transport.currentCue;
  const channel = useMemo(
    () => currentCue ? snapshot?.channels.find((item) => item.id === `remote:${currentCue.id}`) ?? null : null,
    [currentCue, snapshot?.channels],
  );

  function applySnapshot(next: RuntimeSnapshot) {
    setSnapshot(next);
    const nextMaster = next.busGainsDb.MASTER;
    setMasterDb(nextMaster);
    if (nextMaster > -90) unmutedDb.current = nextMaster;
  }

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await client.snapshot();
        if (cancelled) return;
        applySnapshot(response.snapshot);
        if (!response.snapshot.transport.currentCue) setMessage("等待 GM 播放音乐。");
        else if (!response.snapshot.isUnlocked) setMessage("GM 已开始播放。点一次“启用声音”即可加入。" );
        else setMessage("已跟随 GM，同步会自动保持。" );
      } catch (error) {
        if (!cancelled) setMessage(`连接房间音频失败：${errorText(error)}`);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ready]);

  async function enableAudio() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const response = await client.unlock();
      applySnapshot(response.snapshot);
      setMessage(response.ok ? "声音已启用。" : response.error ?? "启用声音失败");
    } catch (error) {
      setMessage(`启用声音失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function setMaster(value: number) {
    setMasterDb(value);
    if (value > -90) unmutedDb.current = value;
    try {
      const response = await client.setBusGain("MASTER", value, 0.05);
      applySnapshot(response.snapshot);
    } catch (error) {
      setMessage(`音量设置失败：${errorText(error)}`);
    }
  }

  async function toggleMute() {
    const next = !muted;
    setMuted(next);
    await setMaster(next ? -96 : unmutedDb.current);
  }

  const phase = snapshot?.transport.phase ?? "IDLE";
  const status = !currentCue
    ? "等待中"
    : !snapshot?.isUnlocked
      ? "需要启用"
      : phase === "PAUSED"
        ? "已暂停"
        : phase === "STOPPED"
          ? "已停止"
          : "已同步";

  return (
    <main className="flex h-[min(620px,100dvh)] w-full flex-col bg-background p-4 text-foreground">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><Music2 className="size-4" /></div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">Owlbear Audio</h1>
            <p className="text-xs text-muted-foreground">房间音频</p>
          </div>
        </div>
        <Badge variant="secondary">{status}</Badge>
      </header>

      <Card className="shadow-none">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">正在播放</p>
          <p className="mt-1 truncate text-base font-semibold">{currentCue?.name ?? "暂无音乐"}</p>
          {channel?.duration ? (
            <p className="mt-1 text-xs tabular-nums text-muted-foreground">{Math.floor(channel.currentTime)} / {Math.floor(channel.duration)} 秒</p>
          ) : null}
        </CardContent>
      </Card>

      {!snapshot?.isUnlocked && currentCue && (
        <Button className="mt-3 h-11" onClick={() => void enableAudio()} disabled={busy}>
          <Volume2 /> 启用声音
        </Button>
      )}

      <Card className="mt-3 shadow-none">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">我的音量</p>
              <p className="text-xs text-muted-foreground">只影响你自己</p>
            </div>
            <Button size="icon-lg" variant="outline" onClick={() => void toggleMute()} disabled={!snapshot?.isUnlocked} aria-label={muted ? "取消静音" : "静音"}>
              {muted ? <VolumeX /> : <Volume2 />}
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <Slider
              className="flex-1"
              min={-48}
              max={6}
              step={1}
              value={[muted ? -48 : Math.max(-48, masterDb)]}
              disabled={!snapshot?.isUnlocked || muted}
              onValueChange={(value) => void setMaster(value[0] ?? 0)}
            />
            <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{muted ? "静音" : `${masterDb > 0 ? "+" : ""}${masterDb} dB`}</span>
          </div>
        </CardContent>
      </Card>

      <p className="mt-auto pt-4 text-xs leading-5 text-muted-foreground" role="status">{message}</p>
    </main>
  );
}
