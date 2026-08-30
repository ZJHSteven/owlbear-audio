import { useEffect, useMemo, useRef, useState } from "react";
import { BackgroundClient } from "../runtime/BackgroundClient";
import type { RuntimeSnapshot } from "../runtime/protocol";

const client = new BackgroundClient();

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function PlayerConsole({ ready }: { ready: boolean }) {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("正在连接房间音频…");
  const [masterDb, setMasterDb] = useState(0);
  const [muted, setMuted] = useState(false);
  const unmutedDb = useRef(0);

  const currentCue = snapshot?.transport.currentCue;
  const channel = useMemo(() => {
    if (!currentCue) return null;
    return snapshot?.channels.find((item) => item.id === `remote:${currentCue.id}`) ?? null;
  }, [currentCue, snapshot?.channels]);

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
        if (response.snapshot.transport.currentCue) {
          setMessage(
            response.snapshot.isUnlocked
              ? "已自动跟随 GM；无需手工同步。"
              : "GM 已开始播放。点一次 Enable Audio 就会自动追上当前进度。",
          );
        } else {
          setMessage("等待 GM 开始声音节目。 ");
        }
      } catch (error) {
        if (!cancelled) setMessage(`房间音频连接失败：${errorMessage(error)}`);
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
      setMessage(response.ok ? "声音已启用，已自动追到 GM 当前进度。" : response.error ?? "启用失败");
    } catch (error) {
      setMessage(`启用声音失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function setMaster(value: number) {
    setMasterDb(value);
    setMuted(value <= -90);
    if (value > -90) unmutedDb.current = value;
    try {
      const response = await client.setBusGain("MASTER", value, 0.05);
      applySnapshot(response.snapshot);
    } catch (error) {
      setMessage(`本地音量设置失败：${errorMessage(error)}`);
    }
  }

  async function toggleMute() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    await setMaster(nextMuted ? -96 : unmutedDb.current);
  }

  const phase = snapshot?.transport.phase ?? "IDLE";
  const statusLabel = !snapshot?.isUnlocked
    ? currentCue
      ? "Audio blocked"
      : "Waiting"
    : phase === "PLAYING"
      ? "Synced"
      : phase === "PAUSED"
        ? "Paused by GM"
        : phase === "STOPPED"
          ? "Stopped"
          : "Ready";

  return (
    <main className="player-shell">
      <header className="player-header">
        <div>
          <p className="eyebrow">OWLBEAR AUDIO</p>
          <h1>Room Audio</h1>
        </div>
        <span className={snapshot?.isUnlocked ? "runtime-chip ready" : "runtime-chip"}>{statusLabel}</span>
      </header>

      <section className="player-now-card">
        <span className="program-label">NOW PLAYING</span>
        <strong>{currentCue?.name ?? "Waiting for GM"}</strong>
        <small>
          {currentCue
            ? snapshot?.isUnlocked
              ? `${phase === "PAUSED" ? "Paused" : phase === "STOPPED" ? "Stopped" : "Playing"}${channel?.duration ? ` · ${channel.currentTime.toFixed(0)} / ${channel.duration.toFixed(0)}s` : ""}`
              : "This sound is ready; your browser needs one click before it can play."
            : "You don't need to choose tracks or manage the show."}
        </small>
      </section>

      {!snapshot?.isUnlocked && (
        <button className="player-enable" disabled={!ready || busy} onClick={enableAudio}>
          Enable Audio
          <small>一次即可；之后自动跟随 GM</small>
        </button>
      )}

      <section className="player-volume-card">
        <div className="player-volume-heading">
          <div>
            <strong>Your volume</strong>
            <small>只影响你自己</small>
          </div>
          <button className={muted ? "player-mute active" : "player-mute"} onClick={toggleMute}>
            {muted ? "Unmute" : "Mute"}
          </button>
        </div>
        <label className="player-volume-slider">
          <span>Quiet</span>
          <input
            type="range"
            min={-48}
            max={6}
            step={1}
            disabled={!snapshot?.isUnlocked || muted}
            value={muted ? -48 : Math.max(-48, masterDb)}
            onChange={(event) => void setMaster(Number(event.target.value))}
          />
          <span>{muted ? "Muted" : `${masterDb > 0 ? "+" : ""}${masterDb} dB`}</span>
        </label>
      </section>

      <section className="player-status" aria-live="polite">{message}</section>
      <footer className="player-footer">Playback, cue order and transitions are controlled by the GM.</footer>
    </main>
  );
}
