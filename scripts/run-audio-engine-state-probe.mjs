// v0.1 P0 regression: the Background player must never wait on AudioContext.resume().
// This fake media element exercises permission state without requiring Owlbear or speaker output.

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

  pause() {
    this.paused = true;
  }

  load() {}
  setAttribute() {}
  removeAttribute() {}
  addEventListener() {}
  removeEventListener() {}
}

globalThis.Audio = FakeAudio;
globalThis.HTMLMediaElement = { HAVE_METADATA: 1 };

const { AudioEngine } = await import("../src/audio/AudioEngine.ts");
const engine = new AudioEngine();

const unlockStarted = performance.now();
await engine.unlock();
const unlockElapsedMs = performance.now() - unlockStarted;

await engine.play("music", "https://example.invalid/test.webm", {
  busId: "MUSIC",
  loop: true,
});
const first = engine.snapshot()[0];

FakeAudio.nextPlayError = new DOMException("Autoplay blocked", "NotAllowedError");
let blockedError = null;
try {
  await engine.play("blocked", "https://example.invalid/blocked.webm", { busId: "MUSIC" });
} catch (error) {
  blockedError = error;
}
const blocked = engine.isUnlocked;

await engine.unlock();
await engine.play("blocked", "https://example.invalid/blocked.webm", { busId: "MUSIC" });
const recovered = engine.isUnlocked;

engine.setLoop("blocked", true);
const loop = engine.snapshot().find((channel) => channel.id === "blocked")?.paused === false;

const result = {
  unlockElapsedMs,
  initialPlay: first?.paused === false && first?.url.includes("test.webm"),
  blockedError: blockedError instanceof DOMException ? blockedError.name : null,
  blockedState: blocked === false,
  recoveredState: recovered === true,
  replayedAfterGesture: loop,
};

console.log(JSON.stringify(result, null, 2));
if (
  unlockElapsedMs > 50 ||
  !result.initialPlay ||
  result.blockedError !== "NotAllowedError" ||
  !result.blockedState ||
  !result.recoveredState ||
  !result.replayedAfterGesture
) {
  process.exitCode = 1;
}
