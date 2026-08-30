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
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const messageId = ++id;
      pending.set(messageId, { resolve, reject });
      ws.send(JSON.stringify({ id: messageId, method, params }));
    });
  return {
    close: () => ws.close(),
    send,
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
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, disabled: button.disabled };
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
  const gmBg = await connect(gm.background);
  const gmAction = await connect(gm.action);
  let player = null;
  let playerBg = null;
  let playerAction = null;

  try {
    await waitCoordinator(gmBg);
    await gmBg.evaluate(`window.__OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__.debugSetRoleForProbe('GM')`);
    await gmAction.evaluate(`window.__OWLBEAR_AUDIO_OPEN_ACTION__?.()`);
    await sleep(300);
    await clickButton(gmAction, "Try Demo");

    // 两个完整 6.028s loop 后再让 PLAYER 加入，真实验证跨循环晚加入。
    await sleep(13200);
    const gmBeforeJoin = await snapshot(gmBg);

    player = await openFreshRoom(existingRoom.url);
    playerBg = await connect(player.background);
    playerAction = await connect(player.action);
    await waitCoordinator(playerBg);
    await playerBg.evaluate(`window.__OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__.debugSetRoleForProbe('PLAYER')`);
    await playerAction.evaluate(`window.__OWLBEAR_AUDIO_OPEN_ACTION__?.()`);
    await sleep(700);

    const playerBeforeUnlock = await snapshot(playerBg);
    await clickButton(playerAction, "Enable Audio");
    await sleep(1100);

    const gmAfterUnlock = await snapshot(gmBg);
    const playerAfterUnlock = await snapshot(playerBg);
    const gmChannel = gmAfterUnlock.channels.find((channel) => channel.id === "cue:demo-cue");
    const playerChannel = playerAfterUnlock.channels.find((channel) => channel.id === "remote:demo-cue");
    const driftSeconds = gmChannel && playerChannel
      ? Math.min(
          Math.abs(gmChannel.currentTime - playerChannel.currentTime),
          6.028 - Math.abs(gmChannel.currentTime - playerChannel.currentTime),
        )
      : null;

    console.log(JSON.stringify({ gmBeforeJoin, playerBeforeUnlock, gmAfterUnlock, playerAfterUnlock, driftSeconds }, null, 2));
    if (driftSeconds === null || driftSeconds > 0.15) {
      throw new Error(`Late-join drift too large: ${driftSeconds}`);
    }
  } finally {
    gmAction.close();
    gmBg.close();
    gm.pageClient.close();
    await fetch(`${CDP}/json/close/${gm.page.id}`);
    if (playerAction) playerAction.close();
    if (playerBg) playerBg.close();
    if (player) {
      player.pageClient.close();
      await fetch(`${CDP}/json/close/${player.page.id}`);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
