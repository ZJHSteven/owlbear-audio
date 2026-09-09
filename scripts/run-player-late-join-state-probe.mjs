// PLAYER late-join state-machine regression without Owlbear UI.
// Uses the real BackgroundCoordinator + AudioEngine and only fakes HTMLAudioElement.

class FakeAudio {
  static nextPlayError = null;

  paused = true;
  currentTime = 0;
  duration = 120;
  readyState = 4;
  volume = 1;
  loop = false;
  src = "";
  preload = "auto";
  error = null;

  async play() {
    if (FakeAudio.nextPlayError) {
      const error = FakeAudio.nextPlayError;
      FakeAudio.nextPlayError = null;
      throw error;
    }
    this.paused = false;
  }

  pause() { this.paused = true; }
  load() {}
  setAttribute() {}
  removeAttribute() {}
  addEventListener() {}
  removeEventListener() {}
}

globalThis.Audio = FakeAudio;
globalThis.HTMLMediaElement = { HAVE_METADATA: 1 };
globalThis.window = globalThis;
// Owlbear SDK 在模块加载时会读取 window.location，并注册 message listener。
// 这个探针不会真正调用宿主 API，所以只需提供最小浏览器形状，避免 Node 环境
// 因为缺少 DOM 全局对象而在“导入 SDK”阶段提前退出。
globalThis.location = { search: "" };
globalThis.parent = { postMessage() {} };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const { BackgroundCoordinator } = await import("../src/runtime/BackgroundCoordinator.ts");

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function state(revision, phase, positionSeconds, sentAgoMs = 0) {
  return {
    type: "STATE",
    state: {
      revision,
      sentAtEpochMs: Date.now() - sentAgoMs,
      phase,
      cue: phase === "STOPPED" || phase === "IDLE" ? undefined : {
        id: "late-join-track",
        name: "Late Join Track",
        url: "https://example.invalid/late-join.webm",
        busId: "MUSIC",
        loop: true,
        transitionSeconds: 0,
      },
      positionSeconds,
    },
  };
}

const coordinator = new BackgroundCoordinator();
coordinator.role = "PLAYER";

// 1) A player joins while GM is already 10s into a looping track; state itself is 2s old.
coordinator.handleRoomSync(state(1, "PLAYING", 10, 2000));
await sleep(10);
const joined = coordinator.snapshot();
const joinedChannel = joined.channels.find((channel) => channel.id === "remote:late-join-track");

// 2) GM pauses at a precise position.
coordinator.handleRoomSync(state(2, "PAUSED", 31.5));
await sleep(10);
const paused = coordinator.snapshot();
const pausedChannel = paused.channels.find((channel) => channel.id === "remote:late-join-track");

// 3) GM stops.
coordinator.handleRoomSync(state(3, "STOPPED", 0));
await sleep(10);
const stopped = coordinator.snapshot();

// 4) A separate player is blocked by autoplay once, then succeeds after a gesture retry.
const blockedCoordinator = new BackgroundCoordinator();
blockedCoordinator.role = "PLAYER";
FakeAudio.nextPlayError = new DOMException("Autoplay blocked", "NotAllowedError");
blockedCoordinator.handleRoomSync(state(1, "PLAYING", 22, 500));
await sleep(10);
const blocked = blockedCoordinator.snapshot();

await blockedCoordinator.engine.unlock();
await blockedCoordinator.drainRemoteStateQueue();
await sleep(5);
const recovered = blockedCoordinator.snapshot();
const recoveredChannel = recovered.channels.find((channel) => channel.id === "remote:late-join-track");

const result = {
  lateJoin: {
    cue: joined.transport.currentCue?.name,
    playing: joinedChannel?.paused === false,
    position: joinedChannel?.currentTime,
    expectedApprox: 12,
  },
  pauseFollow: {
    paused: pausedChannel?.paused === true,
    position: pausedChannel?.currentTime,
  },
  stopFollow: {
    phase: stopped.transport.phase,
    channelCount: stopped.channels.length,
  },
  autoplayFallback: {
    blocked: blocked.isUnlocked === false,
    recovered: recovered.isUnlocked === true && recoveredChannel?.paused === false,
    recoveredPosition: recoveredChannel?.currentTime,
  },
};

console.log(JSON.stringify(result, null, 2));

if (
  !result.lateJoin.playing ||
  Math.abs((result.lateJoin.position ?? 0) - 12) > 0.15 ||
  !result.pauseFollow.paused ||
  Math.abs((result.pauseFollow.position ?? 0) - 31.5) > 0.01 ||
  result.stopFollow.phase !== "STOPPED" ||
  result.stopFollow.channelCount !== 0 ||
  !result.autoplayFallback.blocked ||
  !result.autoplayFallback.recovered
) {
  process.exitCode = 1;
}
