import { useEffect, useMemo, useRef, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { BackgroundClient } from "../runtime/BackgroundClient";
import type { RuntimeSnapshot } from "../runtime/protocol";

const client = new BackgroundClient();
const DEMO_URL = "/probes/production/oneframe-icon-64-6s.webm";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function LiveConsole({ ready }: { ready: boolean }) {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("连接 Background audio runtime…");
  const [masterDb, setMasterDb] = useState(0);
  const [musicDb, setMusicDb] = useState(0);
  const [ambienceDb, setAmbienceDb] = useState(0);
  const lastRevision = useRef<number | null>(null);

  const currentCue = snapshot?.transport.currentCue;
  const nextCue = snapshot?.transport.nextCue;
  const currentChannel = useMemo(
    () =>
      currentCue
        ? snapshot?.channels.find((channel) => channel.id === `cue:${currentCue.id}`) ?? null
        : null,
    [currentCue, snapshot?.channels],
  );

  function applySnapshot(next: RuntimeSnapshot, external = false) {
    const previousRevision = lastRevision.current;
    setSnapshot(next);
    setMasterDb(next.busGainsDb.MASTER);
    setMusicDb(next.busGainsDb.MUSIC);
    setAmbienceDb(next.busGainsDb.AMBIENCE);
    lastRevision.current = next.transport.revision;

    if (external && previousRevision !== null && previousRevision !== next.transport.revision) {
      if (next.transport.held) setMessage("HOLD 已开启；NEXT 不会被 GO 触发。 ");
      else if (next.transport.nextCue) setMessage(`节目已更新。NEXT：${next.transport.nextCue.name}`);
      else if (next.transport.currentCue) setMessage("当前 Cue 仍在播放，节目已经没有下一步。 ");
    }
  }

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const refresh = async (quiet = false) => {
      try {
        const result = await client.snapshot();
        if (cancelled) return;
        applySnapshot(result.snapshot, quiet);
        if (!quiet) {
          setMessage(
            result.snapshot.transport.planId
              ? "Live 已连接。看 NEXT，需要时只按 GO。"
              : "还没有 Armed 的节目。打开 Studio 排好 Cue，或者先 Try Demo。",
          );
        }
      } catch (error) {
        if (!cancelled && !quiet) setMessage(`读取 Background 状态失败：${errorMessage(error)}`);
      }
    };

    void refresh(false);
    const timer = window.setInterval(() => void refresh(true), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ready]);

  async function run(
    label: string,
    work: () => Promise<{ ok: boolean; snapshot: RuntimeSnapshot; error?: string }>,
  ) {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const result = await work();
      applySnapshot(result.snapshot);
      setMessage(result.ok ? label : `${label}失败：${result.error ?? "unknown error"}`);
    } catch (error) {
      setMessage(`${label}失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function tryDemo() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const loaded = await client.loadPlan({
        id: "owlbear-audio-demo",
        name: "Demo Show",
        cues: [
          {
            id: "demo-cue",
            name: "Demo Sound",
            type: "PLAY",
            url: DEMO_URL,
            busId: "MUSIC",
            loop: true,
            fadeSeconds: 0,
          },
        ],
      });
      applySnapshot(loaded.snapshot);
      const played = await client.go();
      applySnapshot(played.snapshot);
      setMessage(played.ok ? "Demo 正在播放。现在这套 GO 链路已经完整工作。" : played.error ?? "Demo 播放失败");
    } catch (error) {
      setMessage(`Demo 播放失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function togglePause() {
    if (!currentCue || !currentChannel) return;
    if (currentChannel.paused) {
      await run("继续播放。", () =>
        client.play({
          channelId: `cue:${currentCue.id}`,
          url: currentCue.url,
          busId: currentCue.busId,
          gainDb: currentCue.gainDb,
          loop: currentCue.loop,
        }),
      );
      return;
    }
    await run("已暂停。", () => client.pause(`cue:${currentCue.id}`));
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

  async function openStudio() {
    await OBR.modal.open({
      id: "dev.zjhsteven.owlbear-audio/studio",
      url: "/?view=studio",
      fullScreen: true,
    });
  }

  function openDiagnostics() {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "storage-probe");
    window.location.href = url.toString();
  }

  const noPlan = !snapshot?.transport.planId;
  const endOfShow = Boolean(snapshot?.transport.planId && !nextCue);
  const held = snapshot?.transport.held ?? false;
  const position = currentChannel?.currentTime ?? 0;
  const duration = currentChannel?.duration ?? 0;

  return (
    <main className="live-shell">
      <header className="live-header">
        <div>
          <p className="eyebrow">OWLBEAR AUDIO</p>
          <h1>Live</h1>
        </div>
        <span className={snapshot?.isUnlocked ? "runtime-chip ready" : "runtime-chip"}>
          {snapshot?.isUnlocked ? "Audio Ready" : "Audio Locked"}
        </span>
      </header>

      {!snapshot?.isUnlocked && (
        <section className="unlock-banner">
          <div>
            <strong>首次出声需要一次点击</strong>
            <p>Chrome 需要用户手势授权。你可以点 Enable Audio，也可以直接点 GO / Try Demo。</p>
          </div>
          <button disabled={!ready || busy} onClick={() => run("声音已启用。", () => client.unlock())}>
            Enable Audio
          </button>
        </section>
      )}

      <section className="live-program">
        <div className="program-block now">
          <span className="program-label">NOW</span>
          <strong>{currentCue?.name ?? "Nothing playing"}</strong>
          <small>
            {currentCue
              ? `${currentChannel?.paused ? "Paused" : "Playing"}${duration ? ` · ${position.toFixed(0)} / ${duration.toFixed(0)}s` : ""}`
              : snapshot?.transport.planName ?? "No show loaded"}
          </small>
        </div>
        <div className="program-divider" aria-hidden="true">→</div>
        <div className="program-block next">
          <span className="program-label">NEXT</span>
          <strong>{nextCue?.name ?? (endOfShow ? "End of show" : "No cue armed")}</strong>
          <small>
            {nextCue
              ? `${nextCue.busId} · ${nextCue.loop ? "Loop" : "One pass"}${nextCue.fadeSeconds ? ` · ${nextCue.fadeSeconds}s transition` : ""}`
              : noPlan
                ? "Open Studio to prepare the next step"
                : "Nothing else will fire on GO"}
          </small>
        </div>
      </section>

      {noPlan ? (
        <section className="live-empty-actions">
          <button className="go-control" disabled={!ready || busy} onClick={tryDemo}>
            Try Demo
            <small>一次点击测试完整播放链路</small>
          </button>
          <button className="prepare-control" disabled={!ready || busy} onClick={openStudio}>
            Open Studio
            <small>找素材并排好今晚的 Cue</small>
          </button>
        </section>
      ) : (
        <section className="live-command-zone">
          <button
            className="go-control"
            disabled={!nextCue || held || busy}
            onClick={() => run(`GO：${nextCue?.name ?? "Cue"}`, () => client.go())}
          >
            GO
            <small>{held ? "HOLD 已开启" : nextCue ? `Next · ${nextCue.name}` : "End of show"}</small>
          </button>
          <button
            className={held ? "hold-control active" : "hold-control"}
            disabled={busy}
            onClick={() => run(held ? "HOLD 已解除。" : "HOLD：GO 暂时锁住。", () => client.setHold(!held))}
          >
            {held ? "RELEASE HOLD" : "HOLD"}
          </button>
        </section>
      )}

      <section className="live-safety-row">
        <button disabled={!currentChannel || busy} onClick={togglePause}>
          {currentChannel?.paused ? "▶ Resume" : "Ⅱ Pause"}
        </button>
        <button className="panic-control" disabled={!ready || busy} onClick={() => run("PANIC：所有声音已停止。", () => client.stopAll())}>
          PANIC · STOP ALL
        </button>
      </section>

      <details className="live-levels">
        <summary>Levels</summary>
        <div className="mixer-card" aria-label="essential mixer">
          <MixerRow label="Master" value={masterDb} onChange={(value) => setGain("MASTER", value, setMasterDb)} />
          <MixerRow label="Music" value={musicDb} onChange={(value) => setGain("MUSIC", value, setMusicDb)} />
          <MixerRow label="Ambience" value={ambienceDb} onChange={(value) => setGain("AMBIENCE", value, setAmbienceDb)} />
        </div>
      </details>

      <section className="live-status" aria-live="polite">{message}</section>

      <footer className="live-footer">
        {!noPlan && <button onClick={openStudio}>Edit Show</button>}
        <button onClick={openDiagnostics}>Diagnostics</button>
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
      <input type="range" min={-48} max={6} step={1} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <output>{value > 0 ? `+${value}` : value} dB</output>
    </label>
  );
}
