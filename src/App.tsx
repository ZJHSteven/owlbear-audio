import { useEffect, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
import WaSpinner from "@awesome.me/webawesome/dist/react/spinner/index.js";
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
      // Web Awesome 的 dark theme 由官方 `wa-dark` class 控制；组件内部 Shadow DOM
      // 会读取同一套 design tokens，因此不再维护一份 shadcn/Tailwind 主题变量镜像。
      document.documentElement.classList.toggle("wa-dark", theme.mode === "DARK");
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
      <main className="wa-stack wa-align-items-center wa-gap-s">
        <WaSpinner />
        <span>正在连接 Owlbear Audio…</span>
      </main>
    );
  }

  return role === "PLAYER" ? <PlayerConsole ready={ready} /> : <SimpleActionConsole ready={ready} />;
}

export default App;
