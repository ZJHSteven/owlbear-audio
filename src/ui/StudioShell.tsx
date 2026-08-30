import { useEffect, useMemo, useState } from "react";
import OBR, { type ImageDownload } from "@owlbear-rodeo/sdk";
import { BackgroundClient } from "../runtime/BackgroundClient";
import type { RuntimeSnapshot } from "../runtime/protocol";
import {
  loadStudioDraft,
  saveStudioDraft,
  toRuntimePlan,
  type StudioAsset,
  type StudioCue,
  type StudioDraft,
} from "../studio/model";

const MODAL_ID = "dev.zjhsteven.owlbear-audio/studio";
const DEMO_ASSET_URL = "/probes/production/oneframe-icon-64-6s.webm";
const client = new BackgroundClient();

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

async function readDuration(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const finish = (value?: number) => {
      audio.removeAttribute("src");
      audio.load();
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(), 3500);
    audio.preload = "metadata";
    audio.addEventListener(
      "loadedmetadata",
      () => {
        window.clearTimeout(timer);
        finish(Number.isFinite(audio.duration) ? audio.duration : undefined);
      },
      { once: true },
    );
    audio.addEventListener(
      "error",
      () => {
        window.clearTimeout(timer);
        finish();
      },
      { once: true },
    );
    audio.src = url;
  });
}

function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export function StudioShell({ ready }: { ready: boolean }) {
  const [draft, setDraft] = useState<StudioDraft>(() => loadStudioDraft());
  const [selectedCueId, setSelectedCueId] = useState<string | null>(draft.cues[0]?.id ?? null);
  const [search, setSearch] = useState("");
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("准备素材，然后把 Cue 排成今晚的节目。 ");

  useEffect(() => {
    saveStudioDraft(draft);
  }, [draft]);

  useEffect(() => {
    if (!ready) return;
    void client
      .snapshot()
      .then((response) => setRuntime(response.snapshot))
      .catch(() => undefined);
  }, [ready]);

  const filteredAssets = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return draft.assets;
    return draft.assets.filter((asset) => asset.name.toLocaleLowerCase().includes(needle));
  }, [draft.assets, search]);

  const selectedCue = draft.cues.find((cue) => cue.id === selectedCueId) ?? null;
  const selectedAsset = selectedCue
    ? draft.assets.find((asset) => asset.id === selectedCue.assetId) ?? null
    : null;

  function updateDraft(updater: (current: StudioDraft) => StudioDraft) {
    setDraft((current) => updater(current));
  }

  function addAsset(asset: StudioAsset) {
    updateDraft((current) => {
      const duplicate = current.assets.find((item) => item.url === asset.url);
      if (duplicate) return current;
      return { ...current, assets: [...current.assets, asset] };
    });
  }

  async function importFromOwlbear() {
    if (!ready || busy) return;
    setBusy(true);
    setMessage("打开 Owlbear 资产选择器…请进入 Owlbear Audio Collection 选择声音。 ");
    try {
      const selected = await OBR.assets.downloadImages(true, "", "ATTACHMENT");
      if (!selected.length) {
        setMessage("没有选择素材。 ");
        return;
      }

      const supported = selected.filter((asset) => asset.image.mime === "video/webm");
      const additions = await Promise.all(
        supported.map(async (asset: ImageDownload): Promise<StudioAsset> => ({
          id: crypto.randomUUID(),
          name: asset.name,
          url: asset.image.url,
          mime: asset.image.mime,
          durationSeconds: await readDuration(asset.image.url),
          source: "owlbear",
          addedAt: Date.now(),
        })),
      );

      updateDraft((current) => {
        const knownUrls = new Set(current.assets.map((asset) => asset.url));
        return {
          ...current,
          assets: [...current.assets, ...additions.filter((asset) => !knownUrls.has(asset.url))],
        };
      });
      setMessage(
        supported.length === selected.length
          ? `已加入 ${additions.length} 个声音素材。`
          : `已加入 ${additions.length} 个 WebM 音频；跳过 ${selected.length - supported.length} 个非音频附件。`,
      );
    } catch (error) {
      setMessage(`读取 Owlbear 资产失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function addDemo() {
    const duration = await readDuration(DEMO_ASSET_URL);
    addAsset({
      id: crypto.randomUUID(),
      name: "Demo Sound",
      url: DEMO_ASSET_URL,
      mime: "video/webm",
      durationSeconds: duration,
      source: "demo",
      addedAt: Date.now(),
    });
    setMessage("Demo Sound 已加入 Library。点 + Cue 把它放进今晚的节目。 ");
  }

  function addCue(asset: StudioAsset) {
    const cue: StudioCue = {
      id: crypto.randomUUID(),
      name: asset.name,
      assetId: asset.id,
      busId: "MUSIC",
      gainDb: 0,
      loop: false,
      fadeSeconds: draft.cues.length ? 2.5 : 0,
    };
    updateDraft((current) => ({ ...current, cues: [...current.cues, cue] }));
    setSelectedCueId(cue.id);
    setMessage(`已把“${asset.name}”加入 Cue Stack。`);
  }

  function patchCue(patch: Partial<StudioCue>) {
    if (!selectedCueId) return;
    updateDraft((current) => ({
      ...current,
      cues: current.cues.map((cue) => (cue.id === selectedCueId ? { ...cue, ...patch } : cue)),
    }));
  }

  function moveCue(id: string, direction: -1 | 1) {
    updateDraft((current) => {
      const index = current.cues.findIndex((cue) => cue.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.cues.length) return current;
      const cues = [...current.cues];
      [cues[index], cues[target]] = [cues[target], cues[index]];
      return { ...current, cues };
    });
  }

  function removeCue(id: string) {
    updateDraft((current) => ({ ...current, cues: current.cues.filter((cue) => cue.id !== id) }));
    if (selectedCueId === id) setSelectedCueId(null);
  }

  async function loadToLive() {
    if (!ready || busy || !draft.cues.length) return;
    setBusy(true);
    setMessage("正在把节目交给 Live runtime…");
    try {
      const response = await client.loadPlan(toRuntimePlan(draft));
      setRuntime(response.snapshot);
      setMessage(response.ok ? "节目已 Armed。Live Console 的 GO 现在会执行第一条 Cue。" : response.error ?? "加载失败");
    } catch (error) {
      setMessage(`加载到 Live 失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function go() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const response = await client.go();
      setRuntime(response.snapshot);
      setMessage(response.ok ? `GO：${response.snapshot.transport.currentCue?.name ?? "Cue"}` : response.error ?? "GO 失败");
    } catch (error) {
      setMessage(`GO 失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function enterLive() {
    await OBR.action.open();
    await OBR.modal.close(MODAL_ID);
  }

  const nextLabel = runtime?.transport.nextCue?.name ?? (draft.cues[0]?.name || "No cue armed");
  const nowLabel = runtime?.transport.currentCue?.name ?? "Nothing playing";

  return (
    <main className="studio-shell">
      <header className="studio-topbar">
        <div className="studio-title-group">
          <span className="eyebrow">PREPARE</span>
          <input
            className="show-name-input"
            aria-label="Show name"
            value={draft.name}
            onChange={(event) => updateDraft((current) => ({ ...current, name: event.target.value }))}
          />
        </div>
        <div className="studio-top-actions">
          <span className={runtime?.isUnlocked ? "runtime-chip ready" : "runtime-chip"}>
            {runtime?.isUnlocked ? "Audio Ready" : "Audio Locked"}
          </span>
          <button className="secondary-action" onClick={enterLive}>Enter Live</button>
        </div>
      </header>

      <section className="director-grid">
        <aside className="director-panel library-panel" aria-label="Library">
          <div className="panel-heading">
            <div>
              <span className="step-kicker">1 · FIND</span>
              <h2>Library</h2>
            </div>
            <button className="compact-action" disabled={busy} onClick={importFromOwlbear}>+ Add</button>
          </div>
          <input
            className="library-search"
            type="search"
            placeholder="Search sounds…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          {filteredAssets.length ? (
            <div className="asset-list">
              {filteredAssets.map((asset) => (
                <article className="asset-row" key={asset.id}>
                  <div className="asset-icon" aria-hidden="true">♫</div>
                  <div className="asset-copy">
                    <strong>{asset.name}</strong>
                    <small>{formatDuration(asset.durationSeconds)} · {asset.source === "owlbear" ? "Owlbear Audio" : "Demo"}</small>
                  </div>
                  <button className="asset-add-cue" onClick={() => addCue(asset)} aria-label={`Add ${asset.name} as cue`}>
                    + Cue
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="guided-empty">
              <div className="empty-symbol">♫</div>
              <strong>先放进一个声音</strong>
              <p>从 Owlbear Audio Collection 选择已有素材；或者先用 Demo 跑一遍完整流程。</p>
              <button className="primary-inline" disabled={busy} onClick={importFromOwlbear}>Add from Owlbear</button>
              <button className="text-action" onClick={addDemo}>Try Demo Sound</button>
            </div>
          )}
        </aside>

        <section className="director-panel cue-panel" aria-label="Cue stack">
          <div className="panel-heading cue-heading">
            <div>
              <span className="step-kicker">2 · BUILD</span>
              <h2>Cue Stack</h2>
            </div>
            <button className="load-live-action" disabled={!draft.cues.length || busy} onClick={loadToLive}>
              Arm for Live
            </button>
          </div>

          {draft.cues.length ? (
            <div className="cue-stack-list">
              {draft.cues.map((cue, index) => {
                const asset = draft.assets.find((item) => item.id === cue.assetId);
                const selected = cue.id === selectedCueId;
                return (
                  <article
                    className={selected ? "cue-row selected" : "cue-row"}
                    key={cue.id}
                    onClick={() => setSelectedCueId(cue.id)}
                  >
                    <div className="cue-number">{String(index + 1).padStart(2, "0")}</div>
                    <div className="cue-type">PLAY</div>
                    <div className="cue-copy">
                      <strong>{cue.name}</strong>
                      <small>
                        {cue.busId} · {cue.loop ? "Loop" : "One pass"} · {cue.fadeSeconds ? `${cue.fadeSeconds.toFixed(1)}s fade` : "Cut in"}
                        {asset?.durationSeconds ? ` · ${formatDuration(asset.durationSeconds)}` : ""}
                      </small>
                    </div>
                    <div className="cue-row-actions" onClick={(event) => event.stopPropagation()}>
                      <button disabled={index === 0} onClick={() => moveCue(cue.id, -1)} aria-label="Move cue up">↑</button>
                      <button disabled={index === draft.cues.length - 1} onClick={() => moveCue(cue.id, 1)} aria-label="Move cue down">↓</button>
                      <button onClick={() => removeCue(cue.id)} aria-label="Remove cue">×</button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="guided-empty cue-empty">
              <div className="empty-symbol">→</div>
              <strong>把今晚的“下一步”排在这里</strong>
              <p>点左侧素材的 <b>+ Cue</b>。默认直接创建 Play Cue，不先问一堆技术参数。</p>
            </div>
          )}
        </section>

        <aside className="director-panel inspector-panel" aria-label="Inspector">
          <div className="panel-heading">
            <div>
              <span className="step-kicker">3 · TUNE</span>
              <h2>Inspector</h2>
            </div>
          </div>

          {selectedCue ? (
            <div className="inspector-form">
              <label>
                <span>Cue name</span>
                <input value={selectedCue.name} onChange={(event) => patchCue({ name: event.target.value })} />
              </label>
              <label>
                <span>Output</span>
                <select value={selectedCue.busId} onChange={(event) => patchCue({ busId: event.target.value as StudioCue["busId"] })}>
                  <option value="MUSIC">Music</option>
                  <option value="AMBIENCE">Ambience</option>
                  <option value="SFX">SFX</option>
                  <option value="VOICE">Voice</option>
                </select>
              </label>
              <label className="range-field">
                <span>Transition <b>{selectedCue.fadeSeconds.toFixed(1)}s</b></span>
                <input type="range" min="0" max="10" step="0.1" value={selectedCue.fadeSeconds} onChange={(event) => patchCue({ fadeSeconds: Number(event.target.value) })} />
              </label>
              <label className="range-field">
                <span>Gain <b>{selectedCue.gainDb} dB</b></span>
                <input type="range" min="-30" max="6" step="1" value={selectedCue.gainDb} onChange={(event) => patchCue({ gainDb: Number(event.target.value) })} />
              </label>
              <label className="toggle-field">
                <input type="checkbox" checked={selectedCue.loop} onChange={(event) => patchCue({ loop: event.target.checked })} />
                <span>
                  <strong>Loop until next GO</strong>
                  <small>适合战斗、环境音等时长不可预测的段落。</small>
                </span>
              </label>
              <div className="inspector-source">
                <span>Source</span>
                <strong>{selectedAsset?.name ?? "Missing asset"}</strong>
              </div>
              <details className="advanced-details">
                <summary>Advanced</summary>
                <p>Hot Cue、Loop Region、Devamp exit、EQ、Deck 等高级能力会在这里渐进展开，不占普通用户默认视野。</p>
              </details>
            </div>
          ) : (
            <div className="guided-empty inspector-empty">
              <strong>选一条 Cue 再调细节</strong>
              <p>没有选中对象时，不用一屏灰掉的参数干扰你。先完成左 → 中的主流程。</p>
            </div>
          )}
        </aside>
      </section>

      <footer className="studio-transport">
        <div className="transport-state-block">
          <span>NOW</span>
          <strong>{nowLabel}</strong>
        </div>
        <div className="transport-arrow">→</div>
        <div className="transport-state-block next">
          <span>NEXT</span>
          <strong>{nextLabel}</strong>
        </div>
        <button className="studio-go" disabled={!runtime?.transport.nextCue || runtime.transport.held || busy} onClick={go}>
          GO
        </button>
        <div className="studio-message" role="status">{message}</div>
      </footer>
    </main>
  );
}
