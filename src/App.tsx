import { useEffect, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";
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
      const root = document.documentElement;
      root.classList.toggle("dark", theme.mode === "DARK");
      root.style.setProperty("--background", theme.background.default);
      root.style.setProperty("--foreground", theme.text.primary);
      root.style.setProperty("--card", theme.background.paper);
      root.style.setProperty("--card-foreground", theme.text.primary);
      root.style.setProperty("--popover", theme.background.paper);
      root.style.setProperty("--popover-foreground", theme.text.primary);
      root.style.setProperty("--primary", theme.primary.main);
      root.style.setProperty("--primary-foreground", theme.primary.contrastText);
      root.style.setProperty("--muted-foreground", theme.text.secondary);
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
    return <main aria-label="Owlbear Audio background runtime" className="hidden" />;
  }

  if (role === null) {
    return (
      <main className="grid h-[min(620px,100dvh)] place-items-center bg-background px-6 text-center text-sm text-muted-foreground">
        正在连接 Owlbear Audio…
      </main>
    );
  }

  return role === "PLAYER" ? <PlayerConsole ready={ready} /> : <SimpleActionConsole ready={ready} />;
}

export default App;
