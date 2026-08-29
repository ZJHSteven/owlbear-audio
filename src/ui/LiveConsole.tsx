import { useEffect, useMemo, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { BackgroundClient } from "../runtime/BackgroundClient";
import type { RuntimeSnapshot } from "../runtime/protocol";

const client = new BackgroundClient();
const DEMO_URL = "/probes/production/oneframe-icon-64-6s.webm";
const MUSIC_CHANNEL = "live-music";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function LiveConsole({ ready }: { ready: boolean }) {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Background runtime 尚未解锁");
  const [masterDb, setMasterDb] = useState(0);
  const [musicDb, setMusicDb] = useState(0);
  const [ambienceDb, setAmbienceDb] = useState(0);

  const music = useMemo(
    () => snapshot?.channels.find((channel) => channel.id === MUSIC_CHANNEL) ?? null,
    [snapshot],
  );

  function applySnapshot(next: RuntimeSnapshot) {
    setSnapshot(next);
    setMasterDb(next.busGainsDb.MASTER);
    setMusicDb(next.busGainsDb.MUSIC);
    setAmbienceDb(next.busGainsDb.AMBIENCE);
  }

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;
    void client
      .snapshot()
      .then((result) => {
        if (cancelled) return;
        applySnapshot(result.snapshot);
        setMessage(result.snapshot.isUnlocked ? "已连接 Background audio runtime" : "Background runtime 尚未解锁");
      })
      .catch((error) => {
        if (!cancelled) setMessage(`读取 Background 状态失败：${errorMessage(error)}`);
      });

    return () => {
      cancelled = true;
    };
  }, [ready]);

  async function run(label: string, work: () => Promise<{ ok: boolean; snapshot: RuntimeSnapshot; error?: string }>) {
    if (!ready || busy) return;
    setBusy(true);
    setMessage(`${label}…`);
    try {
      const result = await work();
      applySnapshot(result.snapshot);
      setMessage(result.ok ? `${label} 完成` : `${label} 失败：${result.error ?? "unknown error"}`);
    } catch (error) {
      setMessage(`${label} 失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function setGain(
    busId: "MASTER" | "MUSIC" | "AMBIENCE",
    value: number,
    setter: (value: number) => void,
  ) {
    setter(value);
    try {
      const result = await client.setBusGain(busId, value, 0.05);
      applySnapshot(result.snapshot);
      if (!result.ok) setMessage(`${busId} 音量设置失败：${result.error ?? "unknown error"}`);
    } catch (error) {
      setMessage(`${busId} 音量设置失败：${errorMessage(error)}`);
    }
  }

  function openDiagnostics() {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "storage-probe");
    window.location.href = url.toString();
  }

  async function openStudio() {
    await OBR.modal.open({
      id: "dev.zjhsteven.owlbear-audio/studio",
      url: "/?view=studio",
      fullScreen: true,
    });
  }

  const runtimeLabel = snapshot
    ? `${snapshot.contextState}${snapshot.isUnlocked ? " · Audio Ready" : " · Locked"}`
    : "UNINITIALIZED";

  return (
    <main className="live-shell">
      <header className="live-header">
        <div>
          <p className="eyebrow">OWLBEAR AUDIO</p>
          <h1>Live Console</h1>
        </div>
        <span className={snapshot?.isUnlocked ? "runtime-chip ready" : "runtime-chip"}>{runtimeLabel}</span>
      </header>

      <section className="now-card">
        <div className="now-copy">
          <span className="eyebrow">NOW PLAYING</span>
          <strong>{music ? "Runtime Test Music" : "No music armed"}</strong>
          <small>
            {music
              ? `${music.paused ? "Paused" : "Playing"} · ${music.currentTime.toFixed(1)} / ${music.duration.toFixed(1)} s`
              : "下一阶段会在这里显示 Cue / Scene / Devamp 状态"}
          </small>
        </div>
      </section>

      <section className="transport-grid" aria-label="transport controls">
        <button
          className="primary-control"
          disabled={!ready || busy}
          onClick={() => run("Enable Audio", () => client.unlock())}
        >
          Enable Audio
        </button>
        <button
          className="primary-control"
          disabled={!ready || busy}
          onClick={() =>
            run("Play", () =>
              client.play({
                channelId: MUSIC_CHANNEL,
                url: DEMO_URL,
                busId: "MUSIC",
                loop: true,
              }),
            )
          }
        >
          ▶ Play
        </button>
        <button disabled={!ready || busy || !music} onClick={() => run("Pause", () => client.pause(MUSIC_CHANNEL))}>
          Ⅱ Pause
        </button>
        <button disabled={!ready || busy || !music} onClick={() => run("Stop", () => client.stop(MUSIC_CHANNEL))}>
          ■ Stop
        </button>
        <button className="panic-control" disabled={!ready || busy} onClick={() => run("PANIC", () => client.stopAll())}>
          PANIC · STOP ALL
        </button>
      </section>

      <section className="mixer-card" aria-label="essential mixer">
        <MixerRow label="Master" value={masterDb} onChange={(value) => setGain("MASTER", value, setMasterDb)} />
        <MixerRow label="Music" value={musicDb} onChange={(value) => setGain("MUSIC", value, setMusicDb)} />
        <MixerRow label="Ambience" value={ambienceDb} onChange={(value) => setGain("AMBIENCE", value, setAmbienceDb)} />
      </section>

      <section className="live-status" aria-live="polite">
        {message}
      </section>

      <footer className="live-footer">
        <button disabled={!ready} onClick={openStudio}>
          Open Full Studio
        </button>
        <button disabled={!ready} onClick={openDiagnostics}>
          Storage Diagnostics
        </button>
      </footer>
    </main>
  );
}

function MixerRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mixer-row">
      <span>{label}</span>
      <input
        type="range"
        min={-48}
        max={6}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{value > 0 ? `+${value}` : value} dB</output>
    </label>
  );
}
