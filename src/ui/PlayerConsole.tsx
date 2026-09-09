import { useEffect, useMemo, useRef, useState } from "react";
import WaBadge from "@awesome.me/webawesome/dist/react/badge/index.js";
import WaButton from "@awesome.me/webawesome/dist/react/button/index.js";
import WaCallout from "@awesome.me/webawesome/dist/react/callout/index.js";
import WaCard from "@awesome.me/webawesome/dist/react/card/index.js";
import WaProgressBar from "@awesome.me/webawesome/dist/react/progress-bar/index.js";
import WaSlider from "@awesome.me/webawesome/dist/react/slider/index.js";
import { Music2, Volume2, VolumeX } from "lucide-react";
import { BackgroundClient } from "@/runtime/BackgroundClient";
import type { RuntimeSnapshot } from "@/runtime/protocol";

const client = new BackgroundClient();

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const whole = Math.floor(value);
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, "0")}`;
}

export function PlayerConsole({ ready }: { ready: boolean }) {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("等待 GM 播放音频。");
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
        if (!response.snapshot.transport.currentCue) setMessage("等待 GM 播放音频。");
        else if (!response.snapshot.isUnlocked) setMessage("GM 已开始播放。点一次“启用声音”即可加入。");
        else setMessage("正在自动跟随 GM；位置变化会即时同步，heartbeat 只负责低频纠偏。");
      } catch (error) {
        if (!cancelled) setMessage(`连接房间音频失败：${errorText(error)}`);
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
      if (!response.ok) setMessage(response.error ?? "音量设置失败");
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
        ? "GM 已暂停"
        : phase === "STOPPED"
          ? "已停止"
          : "已同步";
  const duration = channel?.duration && Number.isFinite(channel.duration) ? channel.duration : 0;
  const currentTime = Math.min(channel?.currentTime ?? 0, duration || Number.POSITIVE_INFINITY);
  const progress = duration > 0 ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;

  return (
    <main className="wa-stack wa-gap-s">
      <WaCard appearance="filled-outlined">
        <div className="wa-split wa-gap-s">
          <div className="wa-cluster wa-gap-s">
            <Music2 size={22} />
            <div>
              <strong>Owlbear Audio</strong>
              <div><small>PLAYER 房间音频</small></div>
            </div>
          </div>
          <WaBadge variant={status === "已同步" ? "success" : "neutral"} appearance="outlined">{status}</WaBadge>
        </div>
      </WaCard>

      <WaCard appearance="outlined">
        <div className="wa-stack wa-gap-s">
          <div>
            <small>正在播放</small>
            <div><strong>{currentCue?.name ?? "暂无音频"}</strong></div>
          </div>
          <WaProgressBar value={progress} />
          <div className="wa-split wa-gap-s">
            <small>{formatTime(currentTime)}</small>
            <small>{formatTime(duration)}</small>
          </div>
          {currentCue?.loop && <WaBadge variant="brand" appearance="outlined">循环播放</WaBadge>}
        </div>
      </WaCard>

      {!snapshot?.isUnlocked && currentCue && (
        <WaButton variant="brand" appearance="filled" loading={busy} onClick={() => void enableAudio()}>
          <Volume2 slot="start" size={16} />
          启用声音
        </WaButton>
      )}

      <WaCard appearance="outlined">
        <div className="wa-stack wa-gap-s">
          <div className="wa-split wa-gap-s">
            <div>
              <strong>我的音量</strong>
              <div><small>只影响你自己，不会改变 GM 或其他玩家</small></div>
            </div>
            <WaButton
              appearance="outlined"
              disabled={!snapshot?.isUnlocked}
              aria-label={muted ? "取消静音" : "静音"}
              onClick={() => void toggleMute()}
            >
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </WaButton>
          </div>
          <WaSlider
            aria-label="我的音量"
            min={-48}
            max={6}
            step={1}
            value={muted ? -48 : Math.max(-48, masterDb)}
            disabled={!snapshot?.isUnlocked || muted}
            onInput={(event) => setMasterDb(event.currentTarget.value)}
            onChange={(event) => void setMaster(event.currentTarget.value)}
          />
          <small>{muted ? "静音" : `${masterDb > 0 ? "+" : ""}${masterDb} dB`}</small>
        </div>
      </WaCard>

      <WaCallout variant="neutral" appearance="plain" role="status">{message}</WaCallout>
    </main>
  );
}
