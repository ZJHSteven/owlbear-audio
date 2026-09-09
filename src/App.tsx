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

  useEffect(() => {
    if (OBR.isReady) return;
    return OBR.onReady(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    const applyTheme = (theme: Awaited<ReturnType<typeof OBR.theme.getTheme>>) => {
      // shadcn 使用 `.dark` 读取同一套 neutral design tokens。
      // 这里只跟随 Owlbear 宿主的明暗模式，不额外把 Owlbear 的品牌色灌进播放器，
      // 从而保持和 Family AI 一致的黑/白/灰视觉。
      document.documentElement.classList.toggle("dark", theme.mode === "DARK");
    };

    void OBR.theme.getTheme().then(applyTheme);
    return OBR.theme.onChange(applyTheme);
  }, [ready]);

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

  useEffect(() => {
    if (!ready || !isBackground) return;
    const coordinator = new BackgroundCoordinator();
    coordinator.start();
    return () => coordinator.stop();
  }, [isBackground, ready]);

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
