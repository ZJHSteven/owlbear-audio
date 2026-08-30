const CDP = "http://127.0.0.1:9222";
const STORAGE_KEY = "owlbear-audio/studio-draft/v1";
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
    send,
    close: () => ws.close(),
    evaluate: async (expression, awaitPromise = true) => {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise,
        returnByValue: true,
      });
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
    const button = [...document.querySelectorAll('button')]
      .find((element) => element.textContent?.includes(${JSON.stringify(needle)}));
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, disabled: button.disabled, text: button.innerText };
  })()`);
  if (!button) throw new Error(`Button not found: ${needle}`);
  if (button.disabled) throw new Error(`Button disabled: ${needle}`);
  await clickPoint(client, button.x, button.y);
  return button.text;
}

async function waitForLocalFrames(beforeIds) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(350);
    const list = await targets();
    const fresh = list.filter(
      (target) => !beforeIds.has(target.id) && target.type === "iframe" && target.url.startsWith("http://localhost:5199/"),
    );
    const background = fresh.find((target) => target.url.includes("view=background"));
    const action = fresh.find((target) => !target.url.includes("view=background") && !target.url.includes("view=studio"));
    if (background && action) return { background, action };
  }
  throw new Error("Fresh Action/Background frames not found");
}

async function main() {
  const initialTargets = await targets();
  const beforeIds = new Set(initialTargets.map((target) => target.id));
  const existingRoom = initialTargets.find(
    (target) => target.type === "page" && target.url.includes("owlbear.rodeo/room/") && target.title === "Owlbear Rodeo",
  );
  if (!existingRoom) throw new Error("No Owlbear room target found");

  const freshRoom = await fetch(`${CDP}/json/new?${encodeURIComponent(existingRoom.url)}`, { method: "PUT" }).then((response) => response.json());
  const roomClient = await connect(freshRoom);
  const { background, action } = await waitForLocalFrames(beforeIds);
  const backgroundClient = await connect(background);
  const actionClient = await connect(action);

  try {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (await backgroundClient.evaluate(`Boolean(window.__OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__)`)) break;
      await sleep(100);
    }

    const originalDraft = await actionClient.evaluate(`localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`);
    await actionClient.evaluate(`window.__OWLBEAR_AUDIO_OPEN_ACTION__?.()`);
    await sleep(350);

    const firstAction = await actionClient.evaluate(`document.body.innerText`);
    await clickButton(actionClient, "Try Demo");
    await sleep(1000);
    const demoSnapshot = await backgroundClient.evaluate(`window.__OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__?.snapshot()`);

    const targetIdsBeforeStudio = new Set((await targets()).map((target) => target.id));
    await clickButton(actionClient, "Edit Show");

    let studioTarget;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(250);
      studioTarget = (await targets()).find(
        (target) => !targetIdsBeforeStudio.has(target.id) && target.type === "iframe" && target.url.includes("view=studio"),
      );
      if (studioTarget) break;
    }
    if (!studioTarget) throw new Error("Studio iframe did not open");
    const studioClient = await connect(studioTarget);

    await studioClient.evaluate(`localStorage.removeItem(${JSON.stringify(STORAGE_KEY)}); location.reload()`, false);
    await sleep(900);
    const emptyStudio = await studioClient.evaluate(`document.body.innerText`);
    await clickButton(studioClient, "Try Demo Sound");
    await sleep(350);
    const afterAsset = await studioClient.evaluate(`document.body.innerText`);
    await clickButton(studioClient, "+ Cue");
    await sleep(250);
    const afterCue = await studioClient.evaluate(`document.body.innerText`);
    await clickButton(studioClient, "Arm for Live");
    await sleep(400);
    const armedSnapshot = await backgroundClient.evaluate(`window.__OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__?.snapshot()`);

    await clickButton(studioClient, "Enter Live");
    await sleep(450);
    await actionClient.evaluate(`window.__OWLBEAR_AUDIO_OPEN_ACTION__?.()`);
    await sleep(250);
    const armedAction = await actionClient.evaluate(`document.body.innerText`);
    await clickButton(actionClient, "GO");
    await sleep(900);
    const goSnapshot = await backgroundClient.evaluate(`window.__OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__?.snapshot()`);

    console.log(
      JSON.stringify(
        {
          firstAction: firstAction.slice(0, 600),
          demoSnapshot,
          emptyStudio: emptyStudio.slice(0, 800),
          afterAsset: afterAsset.slice(0, 900),
          afterCue: afterCue.slice(0, 1200),
          armedSnapshot,
          armedAction: armedAction.slice(0, 800),
          goSnapshot,
        },
        null,
        2,
      ),
    );

    if (originalDraft === null) {
      await actionClient.evaluate(`localStorage.removeItem(${JSON.stringify(STORAGE_KEY)})`);
    } else {
      await actionClient.evaluate(`localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(originalDraft)})`);
    }

    studioClient.close();
  } finally {
    actionClient.close();
    backgroundClient.close();
    roomClient.close();
    await fetch(`${CDP}/json/close/${freshRoom.id}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
