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
    send,
    close: () => ws.close(),
    evaluate: async (expression, awaitPromise = true) => {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
      }
      return result.result.value;
    },
  };
}

async function clickPoint(client, x, y) {
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

async function main() {
  let list = await targets();
  const targetIdsBefore = new Set(list.map((target) => target.id));
  const existingRoom = list.find(
    (target) => target.type === "page" && target.url.includes("owlbear.rodeo/room/") && target.title === "Owlbear Rodeo",
  );
  if (!existingRoom) throw new Error("No Owlbear room target found");

  // A new top-level browsing context is required because Chrome can preserve
  // sticky user activation across ordinary reloads of an existing tab.
  const freshRoom = await fetch(`${CDP}/json/new?${encodeURIComponent(existingRoom.url)}`, {
    method: "PUT",
  }).then((response) => response.json());

  const roomClient = await connect(freshRoom);
  await roomClient.send("Page.enable");

  let freshLocalFrames = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(500);
    list = await targets();
    freshLocalFrames = list.filter(
      (target) =>
        !targetIdsBefore.has(target.id) &&
        target.type === "iframe" &&
        target.url.startsWith("http://localhost:5199/"),
    );
    if (
      freshLocalFrames.some((target) => target.url.includes("view=background")) &&
      freshLocalFrames.some((target) => !target.url.includes("view=background"))
    ) {
      break;
    }
  }

  const background = freshLocalFrames.find((target) => target.url.includes("view=background"));
  const action = freshLocalFrames.find((target) => !target.url.includes("view=background"));

  if (!background || !action) {
    throw new Error(
      `Missing runtime targets in fresh tab: background=${Boolean(background)} action=${Boolean(action)}`,
    );
  }

  const backgroundClient = await connect(background);
  const actionClient = await connect(action);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const coordinatorReady = await backgroundClient.evaluate(
      `Boolean(window.__OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__)`,
    );
    if (coordinatorReady) break;
    await sleep(100);
  }

  const initialBackground = await backgroundClient.evaluate(`({
    activation: {
      isActive: navigator.userActivation.isActive,
      hasBeenActive: navigator.userActivation.hasBeenActive,
    },
    snapshot: window.__OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__?.snapshot() ?? null,
    visibility: document.visibilityState,
  })`);

  // Opening the popover is intentionally programmatic: it must not provide user activation.
  // The only real gesture in this test is the subsequent CDP mouse click on the Action button.
  await actionClient.evaluate(`window.__OWLBEAR_AUDIO_OPEN_ACTION__?.()`);
  await sleep(350);

  const probeButton = await actionClient.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((element) => element.textContent?.includes('▶ Play'));
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, disabled: button.disabled };
  })()`);

  if (!probeButton || probeButton.disabled) throw new Error("Background probe button unavailable");

  await clickPoint(actionClient, probeButton.x, probeButton.y);
  await sleep(5000);

  const after = await backgroundClient.evaluate(`({
    activation: {
      isActive: navigator.userActivation.isActive,
      hasBeenActive: navigator.userActivation.hasBeenActive,
    },
    snapshot: window.__OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__?.snapshot() ?? null,
  })`);

  await sleep(1800);
  const later = await backgroundClient.evaluate(
    `window.__OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__?.snapshot() ?? null`,
  );

  await actionClient.evaluate(`location.reload()`, false);
  await sleep(1400);
  await actionClient.evaluate(`window.__OWLBEAR_AUDIO_OPEN_ACTION__?.()`);
  await sleep(250);
  const recoveredAction = await actionClient.evaluate(`({
    text: document.body.innerText,
    pauseDisabled: [...document.querySelectorAll('button')]
      .find((element) => element.textContent?.includes('Ⅱ Pause'))?.disabled ?? null,
  })`);

  const pauseButton = await actionClient.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((element) => element.textContent?.includes('Ⅱ Pause'));
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, disabled: button.disabled };
  })()`);
  if (!pauseButton || pauseButton.disabled) throw new Error("Pause button unavailable");
  await clickPoint(actionClient, pauseButton.x, pauseButton.y);
  await sleep(350);
  const paused = await backgroundClient.evaluate(
    `window.__OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__?.snapshot() ?? null`,
  );

  const playAgain = await actionClient.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((element) => element.textContent?.includes('▶ Play'));
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, disabled: button.disabled };
  })()`);
  if (!playAgain || playAgain.disabled) throw new Error("Play button unavailable after pause");
  await clickPoint(actionClient, playAgain.x, playAgain.y);
  await sleep(350);

  const panicButton = await actionClient.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((element) => element.textContent?.includes('PANIC · STOP ALL'));
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, disabled: button.disabled };
  })()`);
  if (!panicButton || panicButton.disabled) throw new Error("Panic button unavailable");
  await clickPoint(actionClient, panicButton.x, panicButton.y);
  await sleep(350);
  const panicked = await backgroundClient.evaluate(
    `window.__OWLBEAR_AUDIO_BACKGROUND_COORDINATOR__?.snapshot() ?? null`,
  );

  console.log(
    JSON.stringify({ initialBackground, after, later, recoveredAction, paused, panicked }, null, 2),
  );

  actionClient.close();
  backgroundClient.close();
  roomClient.close();
  await fetch(`${CDP}/json/close/${freshRoom.id}`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
