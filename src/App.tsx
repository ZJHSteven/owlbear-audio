import { useEffect, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { LoaderCircleIcon } from "lucide-react";
import { BackgroundCoordinator } from "@/runtime/BackgroundCoordinator";
import { PlayerConsole } from "@/ui/PlayerConsole";
import { SimpleActionConsole } from "@/ui/SimpleActionConsole";

/**
 * 只供浏览器/CDP 排障读取，不参与产品逻辑。
 *
 * Owlbear 的 Action / background 都在跨域 iframe 中运行，宿主握手问题如果只显示一个
 * “正在连接”很难区分到底是 SDK 没 ready，还是 player.getRole() 失败。把极少量状态
 * 暴露在 window 上，可以在真实 PLAYER 浏览器里直接检查，而无需加入 Debug UI。
 */
interface OwlbearAudioDiagnostics {
  sdkReady: boolean;
  role: "GM" | "PLAYER" | null;
  roleAttempts: number;
  lastRoleError: string | null;
}

type DiagnosticWindow = Window & {
  __OWLBEAR_AUDIO_DIAGNOSTICS__?: OwlbearAudioDiagnostics;
};

function diagnosticError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function App() {
  const [ready, setReady] = useState(OBR.isReady);
  const [role, setRole] = useState<"GM" | "PLAYER" | null>(null);
  const [roleAttempts, setRoleAttempts] = useState(0);
  const [lastRoleError, setLastRoleError] = useState<string | null>(null);
  const view = new URLSearchParams(window.location.search).get("view");
  const isBackground = view === "background";
  const isDevGmPreview = import.meta.env.DEV && view === "preview-gm";
  const isDevPlayerPreview = import.meta.env.DEV && view === "preview-player";

  useEffect(() => {
    if (isDevGmPreview || isDevPlayerPreview) return;
    let cancelled = false;

    const markReady = () => {
      if (!cancelled) setReady(true);
    };

    // 正常路径仍然使用官方 onReady；额外轮询 OBR.isReady 是为了修复真实 PLAYER 中
    // “iframe 已加载但 React 永远没有跨过 ready=false”的异常。轮询只持续到 ready。
    if (OBR.isReady) markReady();
    const unsubscribe = OBR.onReady(markReady);
    const timer = window.setInterval(() => {
      if (OBR.isReady) markReady();
    }, 250);

    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [isDevGmPreview, isDevPlayerPreview]);

  useEffect(() => {
    if (isDevGmPreview || isDevPlayerPreview) return;
    if (!ready) return;
    const applyTheme = (theme: Awaited<ReturnType<typeof OBR.theme.getTheme>>) => {
      // shadcn 使用 `.dark` 读取同一套 neutral design tokens。
      // 这里只跟随 Owlbear 宿主的明暗模式，不额外把 Owlbear 的品牌色灌进播放器，
      // 从而保持和 Family AI 一致的黑/白/灰视觉。
      document.documentElement.classList.toggle("dark", theme.mode === "DARK");
    };

    void OBR.theme.getTheme().then(applyTheme);
    return OBR.theme.onChange(applyTheme);
  }, [isDevGmPreview, isDevPlayerPreview, ready]);

  useEffect(() => {
    if (isDevGmPreview || isDevPlayerPreview) return;
    if (!ready) return;
    let cancelled = false;
    let resolvedOnce = false;

    const refreshRole = async () => {
      if (cancelled || resolvedOnce) return;
      setRoleAttempts((value) => value + 1);
      try {
        const nextRole = await OBR.player.getRole();
        if (cancelled) return;
        resolvedOnce = true;
        setLastRoleError(null);
        setRole(nextRole);
      } catch (error) {
        if (!cancelled) setLastRoleError(diagnosticError(error));
      }
    };

    // onChange 是角色后续变化的权威来源；getRole 的定时重试只负责首次 bootstrap。
    // 一旦成功一次便停止重试，因此正常情况下不会给 Owlbear 宿主制造持续 RPC 压力。
    void refreshRole();
    const retryTimer = window.setInterval(() => void refreshRole(), 500);
    const unsubscribe = OBR.player.onChange((player) => {
      resolvedOnce = true;
      setLastRoleError(null);
      setRole(player.role);
    });
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(retryTimer);
    };
  }, [isDevGmPreview, isDevPlayerPreview, ready]);

  useEffect(() => {
    if (isDevGmPreview || isDevPlayerPreview) return;
    const target = window as DiagnosticWindow;
    target.__OWLBEAR_AUDIO_DIAGNOSTICS__ = {
      sdkReady: ready,
      role,
      roleAttempts,
      lastRoleError,
    };
    return () => {
      delete target.__OWLBEAR_AUDIO_DIAGNOSTICS__;
    };
  }, [isDevGmPreview, isDevPlayerPreview, lastRoleError, ready, role, roleAttempts]);

  useEffect(() => {
    if (isDevGmPreview || isDevPlayerPreview) return;
    if (!ready || !isBackground) return;
    const coordinator = new BackgroundCoordinator();
    coordinator.start();
    return () => coordinator.stop();
  }, [isBackground, isDevGmPreview, isDevPlayerPreview, ready]);

  // 纯视觉回归入口：只在 `vite dev` 时存在，不进入真实 Owlbear 功能路径。
  // 它绕过 iframe 握手，让 CDP 可以检查 shadcn 布局；功能 E2E 仍必须进真实房间。
  if (isDevGmPreview) return <SimpleActionConsole ready={false} />;
  if (isDevPlayerPreview) return <PlayerConsole ready={false} />;

  if (isBackground) {
    return <main aria-label="Owlbear Audio background runtime" hidden />;
  }

  if (role === null) {
    return (
      <main className="flex min-h-56 flex-col items-center justify-center gap-3 bg-background text-sm text-muted-foreground">
        <LoaderCircleIcon className="size-5 animate-spin" />
        <span>{ready ? "正在识别 Owlbear 玩家角色…" : "正在等待 Owlbear SDK 握手…"}</span>
        {ready && lastRoleError && (
          <span className="max-w-80 px-4 text-center text-xs text-muted-foreground">
            正在自动重试：{lastRoleError}
          </span>
        )}
      </main>
    );
  }

  return role === "PLAYER" ? <PlayerConsole ready={ready} /> : <SimpleActionConsole ready={ready} />;
}

export default App;
