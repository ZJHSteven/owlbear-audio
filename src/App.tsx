import { useEffect, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import { LoaderCircleIcon } from "lucide-react";
import { BackgroundCoordinator } from "@/runtime/BackgroundCoordinator";
import { PlayerConsole } from "@/ui/PlayerConsole";
import { SimpleActionConsole } from "@/ui/SimpleActionConsole";

function App() {
  const [ready, setReady] = useState(OBR.isReady);
  const [role, setRole] = useState<"GM" | "PLAYER" | null>(null);
  const view = new URLSearchParams(window.location.search).get("view");
  const isBackground = view === "background";
  const isDevGmPreview = import.meta.env.DEV && view === "preview-gm";
  const isDevPlayerPreview = import.meta.env.DEV && view === "preview-player";

  useEffect(() => {
    if (isDevGmPreview || isDevPlayerPreview) return;
    if (OBR.isReady) return;
    return OBR.onReady(() => setReady(true));
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
    void OBR.player.getRole().then((nextRole) => {
      if (!cancelled) setRole(nextRole);
    });
    const unsubscribe = OBR.player.onChange((player) => setRole(player.role));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isDevGmPreview, isDevPlayerPreview, ready]);

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
        <span>正在连接 Owlbear Audio…</span>
      </main>
    );
  }

  return role === "PLAYER" ? <PlayerConsole ready={ready} /> : <SimpleActionConsole ready={ready} />;
}

export default App;
