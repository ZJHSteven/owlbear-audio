import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Conversion,
  Input,
  Output,
  Quality,
  WebMOutputFormat,
  canEncode,
  canEncodeVideo,
} from "mediabunny";

export type ImportPresetId = "SPEECH" | "AMBIENCE" | "MUSIC" | "ARCHIVE";

export interface ImportPreset {
  id: ImportPresetId;
  label: string;
  bitrateKbps: number;
  description: string;
}

export const IMPORT_PRESETS: Record<ImportPresetId, ImportPreset> = {
  SPEECH: {
    id: "SPEECH",
    label: "Speech",
    bitrateKbps: 48,
    description: "Narration, voice notes and dialogue.",
  },
  AMBIENCE: {
    id: "AMBIENCE",
    label: "Ambience",
    bitrateKbps: 64,
    description: "Long room tone, weather and environmental beds.",
  },
  MUSIC: {
    id: "MUSIC",
    label: "Music",
    bitrateKbps: 96,
    description: "Default for soundtrack music and most table playback.",
  },
  ARCHIVE: {
    id: "ARCHIVE",
    label: "Archive",
    bitrateKbps: 128,
    description: "Higher quality when Owlbear storage is less constrained.",
  },
};

export interface ProductionTranscodeResult {
  file: File;
  contentHash: string;
  durationSeconds: number;
  inputBytes: number;
  outputBytes: number;
  bitrateKbps: number;
  preset: ImportPresetId;
}

export interface ProductionTranscodeOptions {
  preset?: ImportPresetId;
  onProgress?: (progress: number) => void;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function outputName(inputName: string): string {
  const stem = inputName.replace(/\.[^.]+$/, "").trim() || "audio";
  return `${stem}.owlbear-audio.webm`;
}

function makeCoverCanvas(): HTMLCanvasElement | OffscreenCanvas {
  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(64, 64)
    : Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas is not available for the audio cover frame");

  context.fillStyle = "#171922";
  context.fillRect(0, 0, 64, 64);
  context.fillStyle = "#f4f4f5";

  const bars = [18, 30, 42, 26, 36];
  const width = 6;
  const gap = 5;
  const totalWidth = bars.length * width + (bars.length - 1) * gap;
  let x = (64 - totalWidth) / 2;
  for (const height of bars) {
    const y = (64 - height) / 2;
    context.roundRect(x, y, width, height, 3);
    context.fill();
    x += width + gap;
  }

  return canvas;
}

/**
 * Convert a local media file into Owlbear Audio's production storage envelope:
 * - primary audio only
 * - Opus at 48 kHz and a user-facing storage preset
 * - one 64x64 VP9 cover frame at t=0
 * - WebM container
 *
 * Mediabunny is intentionally imported only by Studio/import code. Live Console and
 * Background playback never need this module, so conversion machinery stays off the live path.
 */
export async function transcodeToProductionWebm(
  inputFile: File,
  options: ProductionTranscodeOptions = {},
): Promise<ProductionTranscodeResult> {
  const presetId = options.preset ?? "MUSIC";
  const preset = IMPORT_PRESETS[presetId];

  if (!(await canEncode("opus"))) {
    throw new Error("This browser cannot encode Opus with WebCodecs");
  }
  if (!(await canEncodeVideo("vp9", { width: 64, height: 64 }))) {
    throw new Error("This browser cannot encode the VP9 cover frame required by Owlbear");
  }

  const input = new Input({
    source: new BlobSource(inputFile),
    formats: ALL_FORMATS,
  });

  try {
    if (!(await input.canRead())) {
      throw new Error(`Unsupported or unreadable media file: ${inputFile.name}`);
    }

    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) throw new Error("The selected file has no audio track");
    if (!(await audioTrack.canDecode())) {
      const codec = await audioTrack.getCodec();
      throw new Error(`This browser cannot decode the source audio codec${codec ? ` (${codec})` : ""}`);
    }

    const durationSeconds = await input.computeDuration([audioTrack]);
    const target = new BufferTarget();
    const output = new Output({
      format: new WebMOutputFormat(),
      target,
    });

    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      video: { discard: true },
      audio: {
        codec: "opus",
        sampleRate: 48_000,
        quality: new Quality({ bitrate: preset.bitrateKbps * 1000, bitrateMode: "variable" }),
        forceTranscode: true,
      },
      composable: true,
      showWarnings: false,
    });

    if (!conversion.isValid || conversion.utilizedTracks.length === 0) {
      const reasons = conversion.discardedTracks.map((item) => item.reason).join(", ");
      throw new Error(`Audio conversion is not valid${reasons ? `: ${reasons}` : ""}`);
    }

    if (options.onProgress) {
      conversion.onProgress = (progress) => options.onProgress?.(Math.max(0, Math.min(1, progress)));
    }

    const coverSource = new CanvasSource(makeCoverCanvas(), {
      codec: "vp9",
      quality: new Quality({ bitrate: 8_000 }),
    });
    output.addVideoTrack(coverSource, { frameRate: 1 });

    await output.start();
    await Promise.all([
      conversion.execute(),
      coverSource.add(0, 0.04, { keyFrame: true }).then(() => coverSource.close()),
    ]);
    await output.finalize();

    if (!target.buffer) throw new Error("Media conversion finished without producing a WebM buffer");
    const contentHash = await sha256Hex(target.buffer);
    const file = new File([target.buffer], outputName(inputFile.name), { type: "video/webm" });
    return {
      file,
      contentHash,
      durationSeconds,
      inputBytes: inputFile.size,
      outputBytes: file.size,
      bitrateKbps: preset.bitrateKbps,
      preset: presetId,
    };
  } finally {
    input.dispose();
  }
}
