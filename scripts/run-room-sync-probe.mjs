const CDP = "http://127.0.0.1:9222";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function targets() {
  return fetch(`${CDP}/json`).then((response) => response.json());
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });
  return {
    send,
    close: () => ws.close(),
    evaluate: async (expression, awaitPromise = true) => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
      return result.result.value;
    },
  };
}

async function clickPoint(client, x, y) {
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

async function clickButton(client, needle) {
  const button = await client.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((element) => element.textContent?.includes(${JSON.stringify(needle)}));
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, disabled: button.disabled, text: button.innerText };
  })()`);
  if (!button) throw new Error(`Button not found: ${needle}`);
  if (button.disabled) throw new Error(`Button disabled: ${needle}`);
  await clickPoint(client, button.x, button.y);
}

async function openFreshRoom(roomUrl) {
  const before = new Set((await targets()).map((target) => target.id));
  const page = await fetch(`${CDP}/json/new?${encodeURIComponent(roomUrl)}`, { method: "PUT" }).then((response) => response.json());
  const pageClient = await connect(page);
  let frames = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(350);
    frames = (await targets()).filter(
      (target) => !before.has(target.id) && target.type === "iframe" && target.url.startsWith("http://localhost:5199/"),
    );
    if (frames.some((target) => target.url.includes("view=background")) && frames.some((target) => !target.url.includes("view=background"))) break;
  }
  const background = frames.find((target) => target.url.includes("view=background"));
  const action = frames.find((target) => !target.url.includes("view=background") && !target.url.includes("view=studio"));
  if (!background || !action) throw new Error("Fresh room runtime frames missing");
  return { page, pageClient, background, action };
}

async function waitCoordinator(client) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await client.evaluate(`Boolean(window.__OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__)`)) return;
    await sleep(100);
  }
  throw new Error("Background coordinator not ready");
}

async function snapshot(client) {
  return client.evaluate(`window.__OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__?.snapshot() ?? null`);
}

async function main() {
  const list = await targets();
  const existingRoom = list.find((target) => target.type === "page" && target.url.includes("owlbear.rodeo/room/") && target.title === "Owlbear Rodeo");
  if (!existingRoom) throw new Error("No Owlbear room target found");

  const gm = await openFreshRoom(existingRoom.url);
  const player = await openFreshRoom(existingRoom.url);
  const gmBg = await connect(gm.background);
  const gmAction = await connect(gm.action);
  const playerBg = await connect(player.background);
  const playerAction = await connect(player.action);

  try {
    await waitCoordinator(gmBg);
    await waitCoordinator(playerBg);
    await sleep(300);

    await gmBg.evaluate(`window.__OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__.debugSetRoleForProbe('GM')`);
    await playerBg.evaluate(`window.__OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__.debugSetRoleForProbe('PLAYER')`);
    await sleep(350);

    await gmAction.evaluate(`window.__OWLBEAR_AUDIO_OPEN_ACTION__?.()`);
    await playerAction.evaluate(`window.__OWLBEAR_AUDIO_OPEN_ACTION__?.()`);
    await sleep(300);

    await clickButton(gmAction, "Try Demo");
    await sleep(850);

    const gmPlaying = await snapshot(gmBg);
    const playerBeforeUnlock = await snapshot(playerBg);

    await clickButton(playerAction, "Enable Audio");
    await sleep(900);
    const playerAfterUnlock = await snapshot(playerBg);

    await sleep(5200);
    const gmHeartbeat = await snapshot(gmBg);
    const playerHeartbeat = await snapshot(playerBg);

    await clickButton(gmAction, "Ⅱ Pause");
    await sleep(650);
    const gmPaused = await snapshot(gmBg);
    const playerPaused = await snapshot(playerBg);

    await clickButton(gmAction, "▶ Resume");
    await sleep(700);
    const gmResumed = await snapshot(gmBg);
    const playerResumed = await snapshot(playerBg);

    await clickButton(gmAction, "PANIC · STOP ALL");
    await sleep(700);
    const gmStopped = await snapshot(gmBg);
    const playerStopped = await snapshot(playerBg);

    await gmAction.evaluate(`(async () => {
      const { BackgroundClient } = await import('/src/runtime/BackgroundClient.ts');
      const client = new BackgroundClient();
      window.__OWLBEAR_AUDIO_SYNC_TEST_CLIENT__ = client;
      await client.loadPlan({
        id: 'crossfade-probe',
        name: 'Crossfade Probe',
        cues: [
          {
            id: 'fade-a', name: 'Fade A', type: 'PLAY',
            url: '/probes/production/oneframe-icon-64-6s.webm',
            busId: 'MUSIC', loop: true, fadeSeconds: 0,
          },
          {
            id: 'fade-b', name: 'Fade B', type: 'PLAY',
            url: '/probes/production/oneframe-icon-64-6s.webm',
            busId: 'MUSIC', loop: true, fadeSeconds: 2.5,
          },
        ],
      });
      await client.go();
    })()`);
    await sleep(800);
    const gmFadeA = await snapshot(gmBg);
    const playerFadeA = await snapshot(playerBg);

    await gmAction.evaluate(`window.__OWLBEAR_AUDIO_SYNC_TEST_CLIENT__.go()`);
    await sleep(900);
    const gmDuringFade = await snapshot(gmBg);
    const playerDuringFade = await snapshot(playerBg);

    await sleep(2250);
    const gmAfterFade = await snapshot(gmBg);
    const playerAfterFade = await snapshot(playerBg);

    console.log(JSON.stringify({
      gmPlaying,
      playerBeforeUnlock,
      playerAfterUnlock,
      gmHeartbeat,
      playerHeartbeat,
      gmPaused,
      playerPaused,
      gmResumed,
      playerResumed,
      gmStopped,
      playerStopped,
      gmFadeA,
      playerFadeA,
      gmDuringFade,
      playerDuringFade,
      gmAfterFade,
      playerAfterFade,
    }, null, 2));
  } finally {
    gmAction.close();
    playerAction.close();
    gmBg.close();
    playerBg.close();
    gm.pageClient.close();
    player.pageClient.close();
    await fetch(`${CDP}/json/close/${gm.page.id}`);
    await fetch(`${CDP}/json/close/${player.page.id}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
