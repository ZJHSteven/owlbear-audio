import { useEffect, useMemo, useState } from "react";
import OBR, { buildImageUpload, type ImageDownload } from "@owlbear-rodeo/sdk";
import { BackgroundClient } from "./runtime/BackgroundClient";
import { BackgroundCoordinator } from "./runtime/BackgroundCoordinator";
import { LiveConsole } from "./ui/LiveConsole";
import { StudioShell } from "./ui/StudioShell";
import { PlayerConsole } from "./ui/PlayerConsole";
import "./App.css";

/**
 * 当前页面只是 Phase 0 的“存储探针”，不是最终产品 UI。
 *
 * 它只做三件事：
 * 1. 把预先生成的 WebM 测试文件作为 File/Blob 交给 Owlbear SDK；
 * 2. 从 Owlbear 资产库重新选择已上传的测试资产，观察 SDK 返回的 URL/MIME/尺寸；
 * 3. 尝试直接用浏览器 audio 元素播放 Owlbear 返回的资源 URL。
 *
 * 一旦这条链路被证明成立，后续才值得投入正式的音频库、Cue、Scene、Mixer 等 UI。
 */

const PROBES = {
  audioOnly: {
    path: "/probes/probe-audio-only.webm",
    fileName: "owlbear-audio-probe-audio-only.webm",
    displayName: "Owlbear Audio Probe - Audio Only",
  },
  tinyVideo: {
    path: "/probes/probe-av.webm",
    fileName: "owlbear-audio-probe-tiny-video.webm",
    displayName: "Owlbear Audio Probe - Tiny Video + Opus",
  },
  oneFrame: {
    path: "/probes/production/oneframe-icon-64-6s.webm",
    fileName: "owlbear-audio-probe-production-envelope.webm",
    displayName: "Owlbear Audio Probe - Production Envelope",
  },
} as const;

type ProbeKey = keyof typeof PROBES;

type AssetInspection = {
  name: string;
  type: string;
  mime: string;
  width: number;
  height: number;
  url: string;
  fetchStatus?: number;
  contentType?: string | null;
  contentLength?: string | null;
  byteLength?: number;
  fetchError?: string;
};

/**
 * 把任意错误整理为稳定的文本。
 * SDK、fetch 和浏览器媒体 API 都可能抛出不同类型的异常，统一处理便于测试记录。
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

const BACKGROUND_PROBE_URL = "/probes/production/oneframe-icon-64-6s.webm";
const backgroundClient = new BackgroundClient();

function App() {
  const [ready, setReady] = useState(OBR.isReady);
  const [role, setRole] = useState<"GM" | "PLAYER" | null>(null);
  const [busy, setBusy] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [inspection, setInspection] = useState<AssetInspection | null>(null);

  /**
   * Owlbear iframe 可能在 React 首次渲染后才完成 SDK 握手。
   * onReady 返回取消订阅函数，因此直接交给 useEffect 清理。
   */
  useEffect(() => {
    if (OBR.isReady) {
      setReady(true);
      return;
    }

    return OBR.onReady(() => {
      setReady(true);
      setLogLines((current) => [...current, "SDK ready：已连接 Owlbear Rodeo。"]);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void OBR.player.getRole().then((nextRole) => {
      if (!cancelled) setRole(nextRole);
    });
    const unsubscribe = OBR.player.onChange((player) => setRole(player.role));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [ready]);

  const audioUrl = useMemo(() => inspection?.url ?? "", [inspection]);
  const view = new URLSearchParams(window.location.search).get("view");
  const isBackground = view === "background";

  useEffect(() => {
    if (!ready || isBackground) return;

    const windowWithProbe = window as Window & {
      __OWLBEAR_AUDIO_OPEN_ACTION__?: () => Promise<void>;
    };
    windowWithProbe.__OWLBEAR_AUDIO_OPEN_ACTION__ = () => OBR.action.open();

    return () => {
      delete windowWithProbe.__OWLBEAR_AUDIO_OPEN_ACTION__;
    };
  }, [isBackground, ready]);

  useEffect(() => {
    if (!ready || !isBackground) return;

    const coordinator = new BackgroundCoordinator();
    coordinator.start();

    const debugWindow = window as Window & {
      __OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__?: BackgroundCoordinator;
    };
    debugWindow.__OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__ = coordinator;

    return () => {
      coordinator.stop();
      delete debugWindow.__OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__;
    };
  }, [isBackground, ready]);

  /**
   * 将一条消息追加到页面日志。
   * 时间只用于人工区分步骤，不参与任何同步逻辑。
   */
  function log(message: string) {
    const time = new Date().toLocaleTimeString();
    setLogLines((current) => [...current, `[${time}] ${message}`]);
  }

  /**
   * 从 Vite 静态资源取回已经由 ffmpeg 生成的 WebM 探针，重新构造 File 后交给 Owlbear。
   *
   * 注意：官方文档也建议“读取原文件 -> 新建 File”，因为跨 iframe 传递原始 File 引用时
   * 浏览器安全策略可能导致宿主无法继续读取文件。这里主动复制字节可以避免这类干扰。
   */
  async function uploadProbe(key: ProbeKey) {
    if (!ready || busy) return;

    const probe = PROBES[key];
    setBusy(true);
    log(`准备上传：${probe.displayName}`);

    try {
      const response = await fetch(probe.path);
      if (!response.ok) {
        throw new Error(`读取本地探针失败：HTTP ${response.status}`);
      }

      const bytes = await response.arrayBuffer();
      const file = new File([bytes], probe.fileName, { type: "video/webm" });

      log(`探针已读入浏览器：${file.size} bytes，MIME=${file.type}`);

      const upload = buildImageUpload(file)
        .name(probe.displayName)
        .description("Owlbear Audio storage feasibility probe; safe to delete after testing.")
        .build();

      // ATTACHMENT 最接近“非地图、非 Token 的普通媒体附件”语义，避免污染地图/角色资产分类。
      await OBR.assets.uploadImages([upload], "ATTACHMENT");
      log("Owlbear uploadImages() 已返回。若资产选择/保存界面完成，则上传链路已走通。 ");
    } catch (error) {
      log(`上传失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * 让 Owlbear 打开自己的资产选择器，再把选中的资产信息返回给扩展。
   *
   * 除了记录 SDK 给出的 MIME/尺寸/URL，这里还尝试 fetch 整个资源：
   * - fetch 成功：说明扩展 iframe 对资产 URL 具备足够的 CORS 访问能力，可进一步做缓存/分析。
   * - fetch 失败但 <audio> 能播：仍然可以使用 URL 做媒体播放，只是无法直接读原始字节。
   */
  async function inspectAsset() {
    if (!ready || busy) return;

    setBusy(true);
    log("打开 Owlbear 资产选择器，准备回读测试资产……");

    try {
      const selected = await OBR.assets.downloadImages(
        false,
        "Owlbear Audio Probe",
        "ATTACHMENT",
      );

      const asset: ImageDownload | undefined = selected[0];
      if (!asset) {
        log("没有选择资产。 ");
        return;
      }

      const baseInspection: AssetInspection = {
        name: asset.name,
        type: asset.type,
        mime: asset.image.mime,
        width: asset.image.width,
        height: asset.image.height,
        url: asset.image.url,
      };

      // 暴露给浏览器自动化测试，便于 CDP 从 iframe 执行上下文中取回 CDN URL。
      (window as Window & { __OWLBEAR_AUDIO_LAST_ASSET__?: AssetInspection }).__OWLBEAR_AUDIO_LAST_ASSET__ =
        baseInspection;

      setInspection(baseInspection);
      log(
        `已取回：${asset.name}；type=${asset.type}；mime=${asset.image.mime}；` +
          `${asset.image.width}×${asset.image.height}`,
      );

      try {
        const response = await fetch(asset.image.url);
        const bytes = await response.arrayBuffer();
        const detailed: AssetInspection = {
          ...baseInspection,
          fetchStatus: response.status,
          contentType: response.headers.get("content-type"),
          contentLength: response.headers.get("content-length"),
          byteLength: bytes.byteLength,
        };

        (window as Window & { __OWLBEAR_AUDIO_LAST_ASSET__?: AssetInspection }).__OWLBEAR_AUDIO_LAST_ASSET__ =
          detailed;
        setInspection(detailed);
        log(
          `fetch 成功：HTTP ${response.status}；Content-Type=${detailed.contentType ?? "(none)"}；` +
            `实际读取 ${bytes.byteLength} bytes。`,
        );
      } catch (error) {
        const fetchError = errorMessage(error);
        const detailed: AssetInspection = { ...baseInspection, fetchError };
        (window as Window & { __OWLBEAR_AUDIO_LAST_ASSET__?: AssetInspection }).__OWLBEAR_AUDIO_LAST_ASSET__ =
          detailed;
        setInspection(detailed);
        log(`资产 URL fetch 失败：${fetchError}`);
      }
    } catch (error) {
      log(`回读失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Owlbear Modal API 原生支持 fullScreen。
   * 这里只验证“Action 小窗 -> 全屏工作台”的产品形态确实能由官方 SDK 直接实现。
   */
  async function runBackgroundProbe() {
    if (!ready) return;

    log("发送 PLAY → Background runtime；该点击同时承担首次音频解锁。 ");
    try {
      const response = await backgroundClient.play({
        channelId: "probe-music",
        url: BACKGROUND_PROBE_URL,
        busId: "MUSIC",
        loop: true,
      });
      if (!response.ok) {
        log(`Background PLAY 被拒绝：${response.error ?? "unknown error"}`);
        return;
      }
      log(
        `Background PLAY ACK：context=${response.snapshot.contextState}；` +
          `unlocked=${response.snapshot.isUnlocked}；channels=${response.snapshot.channels.length}`,
      );
    } catch (error) {
      log(`Background PLAY 失败：${errorMessage(error)}`);
    }
  }

  async function openStudio() {
    if (!ready) return;

    try {
      await OBR.modal.open({
        id: "dev.zjhsteven.owlbear-audio/studio",
        url: "/?view=studio",
        fullScreen: true,
      });
      log("已请求打开全屏 Studio Modal。 ");
    } catch (error) {
      log(`打开全屏 Studio 失败：${errorMessage(error)}`);
    }
  }

  const isStudio = view === "studio";
  const isStorageProbe = view === "storage-probe";

  if (isBackground) {
    return <main aria-label="Owlbear Audio background runtime" />;
  }

  if (isStudio) {
    if (role === "PLAYER") {
      return (
        <main className="role-blocked-shell">
          <strong>Studio is controlled by the GM.</strong>
          <p>Players only need Room Audio and their own local volume.</p>
        </main>
      );
    }
    return <StudioShell ready={ready} />;
  }

  if (!isStorageProbe) {
    if (role === "PLAYER") return <PlayerConsole ready={ready} />;
    if (role === null) return <main className="role-loading">Connecting room audio…</main>;
    return <LiveConsole ready={ready} />;
  }

  return (
    <main className="probe-shell">
      <header>
        <h1>Owlbear Audio Lab</h1>
        <p className={ready ? "status ready" : "status"}>
          {ready ? "SDK 已连接" : "等待 Owlbear SDK……"}
        </p>
      </header>

      <section className="probe-section">
        <h2>1. WebM 存储探针</h2>
        <p>先试纯 Opus 音轨 WebM；若失败，再试带 16×16 极低码率 VP9 视频轨的 WebM。</p>
        <div className="button-stack">
          <button disabled={!ready || busy} onClick={() => uploadProbe("audioOnly")}>
            上传 Audio-only WebM
          </button>
          <button disabled={!ready || busy} onClick={() => uploadProbe("tinyVideo")}>
            上传 Tiny-video WebM + Opus
          </button>
          <button disabled={!ready || busy} onClick={() => uploadProbe("oneFrame")}>
            上传 One-frame WebM + Opus
          </button>
        </div>
      </section>

      <section className="probe-section">
        <h2>2. 回读与播放</h2>
        <button disabled={!ready || busy} onClick={inspectAsset}>
          从 Owlbear 资产库选择并检查
        </button>

        {inspection && (
          <div className="inspection">
            <dl>
              <dt>Name</dt>
              <dd>{inspection.name}</dd>
              <dt>Asset type</dt>
              <dd>{inspection.type}</dd>
              <dt>MIME</dt>
              <dd>{inspection.mime}</dd>
              <dt>Dimensions</dt>
              <dd>
                {inspection.width} × {inspection.height}
              </dd>
              <dt>Fetched bytes</dt>
              <dd>{inspection.byteLength ?? "未能读取"}</dd>
            </dl>

            <audio controls preload="metadata" src={audioUrl}>
              当前浏览器无法播放该资源。
            </audio>
          </div>
        )}
      </section>

      <section className="probe-section">
        <h2>3. Runtime / UI 容器能力</h2>
        <div className="button-stack">
          <button disabled={!ready} onClick={runBackgroundProbe}>
            Broadcast → Background 播放
          </button>
          <button disabled={!ready} onClick={openStudio}>
            打开全屏 Studio 验证页
          </button>
        </div>
      </section>

      <section className="probe-section log-section">
        <h2>日志</h2>
        <pre>{logLines.length ? logLines.join("\n") : "尚未执行测试。"}</pre>
      </section>
    </main>
  );
}

export default App;
