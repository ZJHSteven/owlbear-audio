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
  const room = list.find(
    (target) => target.type === "page" && target.id === "A278D02945F69A6AF56C37589E10EC2C",
  ) ?? list.find(
    (target) => target.type === "page" && target.url.includes("owlbear.rodeo/room/") && target.title === "Owlbear Rodeo",
  );

  if (!room) throw new Error("No Owlbear room target found");

  const roomClient = await connect(room);
  await roomClient.send("Page.enable");
  await roomClient.send("Page.reload", { ignoreCache: true });
  await sleep(2500);

  list = await targets();
  const background = list.find(
    (target) => target.type === "iframe" && target.url.startsWith("http://localhost:5199/") && target.url.includes("view=background"),
  );
  const action = list.find(
    (target) => target.type === "iframe" && target.url.startsWith("http://localhost:5199/") && !target.url.includes("view=background"),
  );

  if (!background || !action) {
    throw new Error(`Missing runtime targets: background=${Boolean(background)} action=${Boolean(action)}`);
  }

  const backgroundClient = await connect(background);
  const actionClient = await connect(action);

  const initialBackground = await backgroundClient.evaluate(`({
    activation: {
      isActive: navigator.userActivation.isActive,
      hasBeenActive: navigator.userActivation.hasBeenActive,
    },
    probe: window.__OWLBEAR_AUDIO_BACKGROUND_PROBE__ ?? null,
    visibility: document.visibilityState,
  })`);

  if (initialBackground.probe?.audio) {
    await backgroundClient.evaluate(`window.__OWLBEAR_AUDIO_BACKGROUND_PROBE__.audio.pause()`);
  }
  await backgroundClient.evaluate(`delete window.__OWLBEAR_AUDIO_BACKGROUND_PROBE__`);

  // Opening the popover is intentionally programmatic: it must not provide user activation.
  // The only real gesture in this test is the subsequent CDP mouse click on the Action button.
  await actionClient.evaluate(`window.__OWLBEAR_AUDIO_OPEN_ACTION__?.()`);
  await sleep(350);

  const probeButton = await actionClient.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((element) => element.textContent?.includes('Broadcast → Background'));
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, disabled: button.disabled };
  })()`);

  if (!probeButton || probeButton.disabled) throw new Error("Background probe button unavailable");

  await clickPoint(actionClient, probeButton.x, probeButton.y);
  await sleep(1200);

  const after = await backgroundClient.evaluate(`(() => {
    const probe = window.__OWLBEAR_AUDIO_BACKGROUND_PROBE__;
    return {
      activation: {
        isActive: navigator.userActivation.isActive,
        hasBeenActive: navigator.userActivation.hasBeenActive,
      },
      probe: probe ? {
        nonce: probe.nonce,
        receivedAt: probe.receivedAt,
        started: probe.started,
        currentTime: probe.audio.currentTime,
        paused: probe.audio.paused,
        readyState: probe.audio.readyState,
        error: probe.error,
      } : null,
    };
  })()`);

  await sleep(1300);
  const later = await backgroundClient.evaluate(`(() => {
    const probe = window.__OWLBEAR_AUDIO_BACKGROUND_PROBE__;
    return probe ? {
      currentTime: probe.audio.currentTime,
      paused: probe.audio.paused,
      ended: probe.audio.ended,
    } : null;
  })()`);

  console.log(JSON.stringify({ initialBackground, after, later }, null, 2));

  actionClient.close();
  backgroundClient.close();
  roomClient.close();
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
