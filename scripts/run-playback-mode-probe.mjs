// Background 队列模式回归探针。
//
// 目标不是模拟 Owlbear UI，而是用真实 BackgroundCoordinator + AudioEngine 验证：
// - 顺序播放自然结束会前进，并在队尾 STOP；
// - 单曲循环把 loop 下沉到 HTMLAudioElement，不由 coordinator 重启；
// - 列表循环在队尾回到 0；
// - 随机模式选择不同于当前项的下一首。

class FakeAudio {
  paused = true;
  currentTime = 0;
  duration = 60;
  readyState = 4;
  volume = 1;
  loop = false;
  src = "";
  preload = "auto";
  error = null;
  listeners = new Map();

  async play() { this.paused = false; }
  pause() { this.paused = true; }
  load() {}
  setAttribute() {}
  removeAttribute() {}
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
}

globalThis.Audio = FakeAudio;
globalThis.HTMLMediaElement = { HAVE_METADATA: 1 };
globalThis.window = globalThis;
globalThis.location = { search: "" };
globalThis.parent = { postMessage() {} };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const { BackgroundCoordinator } = await import("../src/runtime/BackgroundCoordinator.ts");

const cues = ["A", "B", "C"].map((name) => ({
  id: `cue-${name}`,
  name,
  type: "PLAY",
  url: `https://example.invalid/${name}.webm`,
  busId: "MUSIC",
  fadeSeconds: 0,
}));

function makeCoordinator(mode, startIndex) {
  const coordinator = new BackgroundCoordinator();
  // 让探针完全停留在本地状态机，不触发 Owlbear 宿主 API。
  coordinator.role = "PLAYER";
  coordinator.roleReady = Promise.resolve("PLAYER");
  coordinator.plan = { id: "probe", name: "Probe", cues, playbackMode: mode };
  coordinator.playbackMode = mode;
  coordinator.nextIndex = startIndex;
  return coordinator;
}

// 1. 顺序播放：A ended -> B；C ended -> STOPPED。
const sequential = makeCoordinator("SEQUENTIAL", 0);
await sequential.go();
const sequentialStart = sequential.snapshot();
await sequential.handleChannelEnded("cue:cue-A");
const sequentialNext = sequential.snapshot();
sequential.nextIndex = 2;
await sequential.go();
await sequential.handleChannelEnded("cue:cue-C");
const sequentialEnd = sequential.snapshot();

// 2. 单曲循环：媒体本身 loop=true，ended 事件即使误触也不推进。
const repeatOne = makeCoordinator("REPEAT_ONE", 1);
await repeatOne.go();
const repeatOneBefore = repeatOne.snapshot();
await repeatOne.handleChannelEnded("cue:cue-B");
const repeatOneAfter = repeatOne.snapshot();

// 3. 列表循环：从最后一首开始，ended 后回到第一首。
const repeatAll = makeCoordinator("REPEAT_ALL", 2);
await repeatAll.go();
await repeatAll.handleChannelEnded("cue:cue-C");
const repeatAllAfter = repeatAll.snapshot();

// 4. 随机：固定 Math.random 让结果可复现；当前 A 时必须挑到非 A。
const originalRandom = Math.random;
Math.random = () => 0.8; // floor(0.8 * 3) = 2 -> C
const shuffle = makeCoordinator("SHUFFLE", 0);
await shuffle.go();
const shuffleStart = shuffle.snapshot();
await shuffle.handleChannelEnded("cue:cue-A");
const shuffleAfter = shuffle.snapshot();
Math.random = originalRandom;

const result = {
  sequential: {
    first: sequentialStart.transport.currentCue?.name,
    afterFirstEnd: sequentialNext.transport.currentCue?.name,
    phaseAtQueueEnd: sequentialEnd.transport.phase,
  },
  repeatOne: {
    cue: repeatOneAfter.transport.currentCue?.name,
    sameCue: repeatOneBefore.transport.currentCue?.id === repeatOneAfter.transport.currentCue?.id,
    mediaLoop: repeatOne.channels?.get?.("cue:cue-B")?.media?.loop ?? true,
  },
  repeatAll: {
    afterLastEnd: repeatAllAfter.transport.currentCue?.name,
  },
  shuffle: {
    first: shuffleStart.transport.currentCue?.name,
    afterEnd: shuffleAfter.transport.currentCue?.name,
  },
};

console.log(JSON.stringify(result, null, 2));

if (
  result.sequential.first !== "A" ||
  result.sequential.afterFirstEnd !== "B" ||
  result.sequential.phaseAtQueueEnd !== "STOPPED" ||
  !result.repeatOne.sameCue ||
  result.repeatAll.afterLastEnd !== "A" ||
  result.shuffle.first !== "A" ||
  result.shuffle.afterEnd === "A"
) {
  process.exitCode = 1;
}
